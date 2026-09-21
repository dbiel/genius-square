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
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  updateDoc,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { firebaseConfig } from './firebase-config';
import { assignName, makeRoomCode, normalizeRoomCode, rollAgreed, type RoomPlayers } from './rules';

const HEARTBEAT_MS = 20_000;
const ONLINE_WINDOW_MS = 60_000;
/** Rooms and players are deleted by a Firestore TTL policy a day after their last activity. */
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

function expiry(): Timestamp {
  return Timestamp.fromMillis(Date.now() + ROOM_TTL_MS);
}

/**
 * Delete a few rooms nobody has touched for a day (players first, then the
 * room). Runs whenever someone creates a room, so the collection stays small
 * without a server. Best effort.
 */
export async function sweepExpiredRooms(max = 5): Promise<number> {
  const d = firestore();
  const stale = await getDocs(query(collection(d, 'rooms'), where('expiresAt', '<', Timestamp.now()), limit(max)));
  let removed = 0;
  for (const room of stale.docs) {
    try {
      const players = await getDocs(collection(d, 'rooms', room.id, 'players'));
      await Promise.all(players.docs.map((p) => deleteDoc(p.ref)));
      await deleteDoc(room.ref);
      removed++;
    } catch {
      /* someone else got it, or rules said no */
    }
  }
  return removed;
}

/** A placed piece as sent over the wire: [orientation index, row, col]. */
export type WirePlacements = Record<string, [number, number, number]>;

export interface RoomPlayerState {
  id: string;
  name: string;
  placed: number;
  placements: WirePlacements;
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

/**
 * Firestore with a persistent on-device cache: writes made offline (a solve on
 * a plane) are queued in IndexedDB and sent automatically the next time the
 * app is open with a connection. No save button needed.
 */
function firestore(): Firestore {
  app ??= initializeApp(firebaseConfig);
  if (!db) {
    try {
      db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
    } catch {
      db = initializeFirestore(app, {});
    }
  }
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
    void sweepExpiredRooms().catch(() => undefined);
    let code = makeRoomCode();
    for (let tries = 0; tries < 5; tries++) {
      if (!(await getDoc(doc(d, 'rooms', code))).exists()) break;
      code = makeRoomCode();
    }
    await setDoc(doc(d, 'rooms', code), { seed, createdAt: serverTimestamp(), expiresAt: expiry() });
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
      placements: {},
      solvedMs: null,
      seed,
      expiresAt: expiry(),
    });
    await updateDoc(doc(d, 'rooms', this.code), { expiresAt: expiry() }).catch(() => undefined);
    this.heartbeat = setInterval(() => void updateDoc(this.playerRef(), { lastSeen: serverTimestamp(), expiresAt: expiry() }).catch(() => undefined), HEARTBEAT_MS);
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
            placements: (v.placements as WirePlacements) ?? {},
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
        placements: p.placements,
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
      await updateDoc(doc(firestore(), 'rooms', this.code), { seed: p.seed, proposal: deleteField(), expiresAt: expiry() });
    } finally {
      this.committingSeed = null;
    }
  }

  get me(): string {
    return this.playerId;
  }

  async setPlaced(placed: number, placements: WirePlacements): Promise<void> {
    await updateDoc(this.playerRef(), { placed, placements, lastSeen: serverTimestamp() }).catch(() => undefined);
  }

  async setSolved(ms: number, placements: WirePlacements): Promise<void> {
    await updateDoc(this.playerRef(), { solvedMs: ms, placed: 29, placements, lastSeen: serverTimestamp() }).catch(() => undefined);
  }

  /** Reset my progress for a new seed. */
  async startPuzzle(seed: number): Promise<void> {
    await updateDoc(this.playerRef(), { placed: 0, placements: {}, solvedMs: null, seed, lastSeen: serverTimestamp() }).catch(() => undefined);
  }

  /** Propose a new puzzle (I count as agreed), or agree to the one on the table. */
  async roll(seed: number): Promise<void> {
    const room = doc(firestore(), 'rooms', this.code);
    const current = this.roomData?.proposal;
    if (current) {
      await updateDoc(room, { [`proposal.ready.${this.playerId}`]: true, expiresAt: expiry() });
    } else {
      await updateDoc(room, { proposal: { seed, by: this.playerId, ready: { [this.playerId]: true } }, expiresAt: expiry() });
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

export async function recentTimes(count = 10): Promise<TimeEntry[]> {
  const snap = await getDocs(query(collectionGroup(firestore(), 'entries'), orderBy('at', 'desc'), limit(count)));
  return snap.docs.map((d) => toEntry(d.data()));
}

function toEntry(v: Record<string, unknown>): TimeEntry {
  return { name: v.name as string, ms: v.ms as number, seed: v.seed as number, at: millis(v.at) };
}
