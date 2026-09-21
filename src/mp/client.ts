import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { firebaseConfig } from './firebase-config';
import { assignName, makeRoomCode, normalizeRoomCode, rollAgreed, type RoomPlayers } from './rules';

const HEARTBEAT_MS = 20_000;
const ONLINE_WINDOW_MS = 60_000;

export interface RoomPlayerState {
  id: string;
  name: string;
  placed: number;
  solvedMs: number | null;
  online: boolean;
  joinedAt: number;
}

export interface RoomState {
  code: string;
  seed: number;
  proposal: { seed: number; by: string; ready: Record<string, boolean> } | null;
  players: RoomPlayerState[];
}

export interface TimeEntry {
  name: string;
  ms: number;
  seed: number;
  at: number;
}

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

function firestore(): Firestore {
  app ??= initializeApp(firebaseConfig);
  db ??= getFirestore(app);
  return db;
}

function millis(t: unknown): number {
  return t && typeof (t as Timestamp).toMillis === 'function' ? (t as Timestamp).toMillis() : 0;
}

/** One player's connection to one room. Create with `create()` or `join()`. */
export class RoomClient {
  readonly code: string;
  private readonly playerId: string;
  private readonly onState: (state: RoomState) => void;
  private roomData: { seed: number; proposal: RoomState['proposal'] } | null = null;
  private playerData = new Map<string, Omit<RoomPlayerState, 'id' | 'online'> & { lastSeen: number }>();
  private unsubs: Unsubscribe[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private committingSeed: number | null = null;

  private constructor(code: string, playerId: string, onState: (state: RoomState) => void) {
    this.code = code;
    this.playerId = playerId;
    this.onState = onState;
  }

  static async create(playerId: string, name: string, seed: number, onState: (s: RoomState) => void): Promise<RoomClient> {
    const d = firestore();
    let code = makeRoomCode();
    for (let tries = 0; tries < 5; tries++) {
      if (!(await getDoc(doc(d, 'rooms', code))).exists()) break;
      code = makeRoomCode();
    }
    await setDoc(doc(d, 'rooms', code), { seed, createdAt: serverTimestamp() });
    const client = new RoomClient(code, playerId, onState);
    await client.enter(name, seed, 1);
    return client;
  }

  static async join(playerId: string, name: string, rawCode: string, onState: (s: RoomState) => void): Promise<RoomClient> {
    const d = firestore();
    const code = normalizeRoomCode(rawCode);
    const room = await getDoc(doc(d, 'rooms', code));
    if (!room.exists()) throw new Error('No room with that code');
    const others = await getDocs(collection(d, 'rooms', code, 'players'));
    const client = new RoomClient(code, playerId, onState);
    await client.enter(name, room.data().seed as number, others.size + 1);
    return client;
  }

  private async enter(name: string, seed: number, position: number): Promise<void> {
    const d = firestore();
    await setDoc(this.playerRef(), {
      name: assignName(name, position),
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
      placed: 0,
      solvedMs: null,
      seed,
    });
    this.heartbeat = setInterval(() => void updateDoc(this.playerRef(), { lastSeen: serverTimestamp() }).catch(() => undefined), HEARTBEAT_MS);
    this.unsubs.push(
      onSnapshot(doc(d, 'rooms', this.code), (snap) => {
        const data = snap.data();
        if (!data) return;
        this.roomData = { seed: data.seed as number, proposal: (data.proposal as RoomState['proposal']) ?? null };
        this.emit();
      }),
      onSnapshot(collection(d, 'rooms', this.code, 'players'), (snap) => {
        this.playerData.clear();
        for (const p of snap.docs) {
          const v = p.data();
          this.playerData.set(p.id, {
            name: v.name as string,
            placed: (v.placed as number) ?? 0,
            solvedMs: (v.solvedMs as number | null) ?? null,
            joinedAt: millis(v.joinedAt),
            lastSeen: millis(v.lastSeen),
          });
        }
        this.emit();
      }),
    );
  }

  private playerRef() {
    return doc(firestore(), 'rooms', this.code, 'players', this.playerId);
  }

  private snapshot(): RoomState | null {
    if (!this.roomData) return null;
    const now = Date.now();
    const players: RoomPlayerState[] = [...this.playerData.entries()]
      .map(([id, p]) => ({
        id,
        name: p.name,
        placed: p.placed,
        solvedMs: p.solvedMs,
        joinedAt: p.joinedAt,
        online: id === this.playerId || now - p.lastSeen < ONLINE_WINDOW_MS,
      }))
      .sort((a, b) => a.joinedAt - b.joinedAt);
    return { code: this.code, seed: this.roomData.seed, proposal: this.roomData.proposal, players };
  }

  private emit(): void {
    const state = this.snapshot();
    if (!state) return;
    this.onState(state);
    void this.commitIfAgreed(state);
  }

  /** When every online player has agreed to a proposal, move the room to that seed. Idempotent. */
  private async commitIfAgreed(state: RoomState): Promise<void> {
    const p = state.proposal;
    if (!p || this.committingSeed === p.seed) return;
    const players: RoomPlayers = Object.fromEntries(state.players.map((x) => [x.id, { name: x.name, online: x.online }]));
    if (!rollAgreed(players, p.ready)) return;
    this.committingSeed = p.seed;
    try {
      await updateDoc(doc(firestore(), 'rooms', this.code), { seed: p.seed, proposal: deleteField() });
    } finally {
      this.committingSeed = null;
    }
  }

  get me(): string {
    return this.playerId;
  }

  async setPlaced(placed: number): Promise<void> {
    await updateDoc(this.playerRef(), { placed, lastSeen: serverTimestamp() }).catch(() => undefined);
  }

  async setSolved(ms: number): Promise<void> {
    await updateDoc(this.playerRef(), { solvedMs: ms, placed: 29, lastSeen: serverTimestamp() }).catch(() => undefined);
  }

  /** Reset my progress for a new seed. */
  async startPuzzle(seed: number): Promise<void> {
    await updateDoc(this.playerRef(), { placed: 0, solvedMs: null, seed, lastSeen: serverTimestamp() }).catch(() => undefined);
  }

  /** Propose a new puzzle (I count as agreed), or agree to the one on the table. */
  async roll(seed: number): Promise<void> {
    const room = doc(firestore(), 'rooms', this.code);
    const current = this.roomData?.proposal;
    if (current) {
      await updateDoc(room, { [`proposal.ready.${this.playerId}`]: true });
    } else {
      await updateDoc(room, { proposal: { seed, by: this.playerId, ready: { [this.playerId]: true } } });
    }
  }

  async leave(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const u of this.unsubs) u();
    this.unsubs = [];
    await deleteDoc(this.playerRef()).catch(() => undefined);
  }
}

// ---------- times (global, no room needed) ----------

export async function recordTime(entry: TimeEntry): Promise<void> {
  await addDoc(collection(firestore(), 'times', String(entry.seed), 'entries'), { ...entry, at: serverTimestamp() });
}

export async function bestTimeFor(seed: number): Promise<TimeEntry | null> {
  const snap = await getDocs(query(collection(firestore(), 'times', String(seed), 'entries'), orderBy('ms'), limit(1)));
  const d = snap.docs[0];
  return d ? toEntry(d.data()) : null;
}

export async function topTimes(count = 10): Promise<TimeEntry[]> {
  const snap = await getDocs(query(collectionGroup(firestore(), 'entries'), orderBy('ms'), limit(count)));
  return snap.docs.map((d) => toEntry(d.data()));
}

function toEntry(v: Record<string, unknown>): TimeEntry {
  return { name: v.name as string, ms: v.ms as number, seed: v.seed as number, at: millis(v.at) };
}
