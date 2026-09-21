import { Game, type GameHint } from '../core/game';
import { DICE, squareName } from '../core/dice';
import { SIZE } from '../core/board';
import { PIECES, type Cell, type PieceId } from '../core/pieces';
import { BLOCKER_COLOR, BOARD_COLOR, PIECE_COLORS } from './colors';
import { UNIT, pegSvg, pieceBounds, pieceSvg } from './tiles';
import { sound } from './sound';
import { LEVEL_COUNT, levelOf, randomSeedForLevel } from '../core/levels';
import { LEVEL_BANDS, TOTAL_SOLUTIONS } from '../core/levels-data';
import { RoomClient, bestTimeFor, recentTimes, recordTime, topTimes, type RoomState, type TimeEntry } from '../mp/client';
import { isRoomCode } from '../mp/rules';
import { PUZZLE_COUNT } from '../core/dice';

const MARGIN = 0.9; // label gutter, in cells
const LIFT = 0.8; // cells the dragged piece floats above the finger
/** Pieces whose mirror image cannot be reached by rotating: only these need a Flip button. */
const CHIRAL = new Set<PieceId>(['bigL', 's']);
/** Fixed tray rows. Each piece keeps its slot no matter how it is turned. */
const TRAY_ROWS: PieceId[][] = [
  ['dot', 'domino', 'bar3', 'smallL'],
  ['bar4', 'square', 't'],
  ['bigL', 's'],
];
/** Tray height in board cells: the tallest slot of each row, summed. */
const TRAY_CELLS = 3 + 4 + 3;
const BEST_KEY = 'gs.best';
const PUZZLE_BESTS_KEY = 'gs.puzzleBests';
const TIMER_KEY = 'gs.showTimer';
const MUTE_KEY = 'gs.mute';
const LEVEL_KEY = 'gs.level';
const DEFAULT_LEVEL = 3;
const NAME_KEY = 'gs.name';
const DEFAULT_NAME = 'Player 1';
const PLAYER_ID_KEY = 'gs.playerId';

// Chunky pixel icons, drawn on an 8x8 grid so they match the font.
const ICON_CLOCK = `<svg viewBox="0 0 8 8" shape-rendering="crispEdges"><path fill="currentColor" d="M2 0h4v1H2zM1 1h1v1H1zM6 1h1v1H6zM0 2h1v4H0zM7 2h1v4H7zM1 6h1v1H1zM6 6h1v1H6zM2 7h4v1H2zM3 2h1v3H3zM4 4h2v1H4z"/></svg>`;
const ICON_SOUND = `<svg viewBox="0 0 8 8" shape-rendering="crispEdges"><path fill="currentColor" d="M0 3h1v2H0zM1 2h1v4H1zM2 1h1v6H2zM3 0h1v8H3zM5 2h1v1H5zM6 1h1v1H6zM5 5h1v1H5zM6 6h1v1H6zM7 2h1v4H7z"/></svg>`;

interface Drag {
  id: PieceId;
  cells: Cell[];
  startX: number;
  startY: number;
  startedAt: number;
  /** Pointer offset from the piece origin, in board pixels. */
  offX: number;
  offY: number;
  ghost: HTMLElement;
  moved: boolean;
}

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Puzzle number from the URL, gs.davidbiel.com/12345 (or a legacy #12345), or undefined. */
function seedFromLocation(): number | undefined {
  const raw = location.pathname.replace(/^\/+|\/+$/g, '') || location.hash.slice(1);
  if (!/^\d{1,5}$/.test(raw)) return undefined;
  const n = Number(raw);
  return n < PUZZLE_COUNT ? n : undefined;
}

interface Best {
  ms: number;
  /** Epoch ms when set (0 for records saved before dates were kept). */
  at: number;
}

function readPuzzleBests(): Record<string, Best> {
  try {
    const parsed: unknown = JSON.parse(readStorage(PUZZLE_BESTS_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, Best> = {};
    for (const [seed, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number') out[seed] = { ms: v, at: 0 };
      else if (v && typeof v === 'object' && typeof (v as Best).ms === 'number') out[seed] = v as Best;
    }
    return out;
  } catch {
    return {};
  }
}

/** Fastest solve across all puzzles, or null. */
function overallBest(bests: Record<string, Best>): { seed: number; ms: number } | null {
  let top: { seed: number; ms: number } | null = null;
  for (const [seed, b] of Object.entries(bests)) if (!top || b.ms < top.ms) top = { seed: Number(seed), ms: b.ms };
  return top;
}

function formatDate(at: number): string {
  if (!at) return '';
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function playerIdentity(): string {
  const existing = readStorage(PLAYER_ID_KEY);
  if (existing) return existing;
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  writeStorage(PLAYER_ID_KEY, id);
  return id;
}

function clampLevel(n: number): number {
  return Math.min(LEVEL_COUNT, Math.max(1, Math.round(n)));
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class App {
  private game = new Game();
  private drag: Drag | null = null;
  private showTimer = readStorage(TIMER_KEY) !== '0';
  private level = clampLevel(Number(readStorage(LEVEL_KEY)) || DEFAULT_LEVEL);
  private menuOpen = false;
  private bestsSort: 'fastest' | 'recent' = 'fastest';
  private menuView: 'main' | 'help' | 'mp' | 'times' = 'main';
  private timesScope: 'mine' | 'everyone' = 'mine';
  private readonly playerId = playerIdentity();
  private room: RoomClient | null = null;
  private roomState: RoomState | null = null;
  /** Players whose finish we've already reacted to, per seed. */
  private announced = new Set<string>();
  private roomBusy = false;
  private roomError = '';
  private toBeat: TimeEntry | null = null;
  private times: TimeEntry[] | null = null;
  /** Called just before a new roll starts; main.ts uses it to apply a waiting update. */
  onRollStart: (() => void) | null = null;
  private playerName = (readStorage(NAME_KEY) ?? '').trim() || DEFAULT_NAME;
  private flashId: PieceId | null = null;
  private overlay: 'none' | 'rolling' | 'won' = 'none';
  private won: { ms: number; puzzleBest: number; puzzleNew: boolean; overallBest: number; overallNew: boolean } | null = null;
  private diceFaces: string[] = [];
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    sound.setMuted(readStorage(MUTE_KEY) === '1');
    root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    root.addEventListener('change', (e) => this.onChange(e));
    root.addEventListener('submit', (e) => this.onSubmit(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    window.addEventListener('resize', () => this.fit());
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'h' && !(e.target instanceof HTMLInputElement) && this.overlay === 'none') this.hint();
    });
    setInterval(() => this.tickClock(), 250);
    window.addEventListener('pagehide', () => void this.room?.leave());
    this.fit();
    this.startRoll(seedFromLocation());
  }

  // ---------- layout ----------

  private fit(): void {
    const landscape = window.innerWidth > window.innerHeight && window.innerWidth >= 700;
    const w = window.innerWidth - 24;
    const h = window.innerHeight - 24;
    const cell = landscape
      ? Math.min((h - 80) / (SIZE + MARGIN), (w * 0.55) / (SIZE + MARGIN))
      : Math.min(w / (SIZE + MARGIN), (h - 110) / (SIZE + MARGIN + TRAY_CELLS * 0.62 + 0.8));
    document.documentElement.style.setProperty('--cell', `${Math.max(34, Math.floor(cell))}px`);
  }

  private cellPx(): number {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell'));
  }

  private boardOrigin(): { x: number; y: number } {
    const svg = this.root.querySelector<SVGSVGElement>('svg.board')!;
    const rect = svg.getBoundingClientRect();
    const cell = this.cellPx();
    return { x: rect.left + MARGIN * cell, y: rect.top + MARGIN * cell };
  }

  // ---------- rendering ----------

  render(): void {
    this.root.innerHTML = `
      <header class="topbar">
        <div class="title">GENIUS SQUARE</div>
        <div class="status">
          <span class="puzzle">#${String(this.game.seed).padStart(5, '0')} LV${levelOf(this.game.seed)}${this.toBeat ? `<small class="tobeat">TO BEAT ${formatMs(this.toBeat.ms)} ${escapeHtml(this.toBeat.name)}</small>` : ''}</span>
          ${this.showTimer
            ? `<span class="clock" data-action="timer" title="Tap to hide the clock">${formatMs(this.game.elapsedMs())}</span>`
            : `<button class="icon small" data-action="timer" aria-label="Show clock" title="Tap to show the clock">${ICON_CLOCK}</button>`}
        </div>
        <div class="icons">
          <button class="icon ${sound.isMuted() ? 'off' : ''}" data-action="mute" aria-label="Sound" title="Sound on or off">${ICON_SOUND}</button>
          <button class="burger" data-action="menu" aria-label="Menu"><span></span><span></span><span></span></button>
        </div>
      </header>
      ${this.roomStripHtml()}
      <section class="stage">
        <div class="board-wrap">${this.boardSvg()}</div>
        <div class="tray">${this.trayHtml()}</div>
      </section>
      ${this.menuHtml()}
      ${this.overlayHtml()}
    `;
  }

  private boardSvg(): string {
    const total = (SIZE + MARGIN) * UNIT;
    const off = MARGIN * UNIT;
    let out = `<svg class="board" viewBox="0 0 ${total} ${total}">`;
    out += `<rect x="${off - 14}" y="${off - 14}" width="${SIZE * UNIT + 28}" height="${SIZE * UNIT + 28}" rx="10" fill="${BOARD_COLOR}"/>`;
    for (let i = 0; i < SIZE; i++) {
      out += `<text class="label" x="${off + i * UNIT + UNIT / 2}" y="${off - 30}" text-anchor="middle">${i + 1}</text>`;
      out += `<text class="label" x="${off - 34}" y="${off + i * UNIT + UNIT / 2 + 14}" text-anchor="middle">${'ABCDEF'[i]}</text>`;
    }
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        out += `<rect class="grid-cell" data-r="${r}" data-c="${c}" x="${off + c * UNIT + 4}" y="${off + r * UNIT + 4}" width="${UNIT - 8}" height="${UNIT - 8}"/>`;
      }
    }
    for (const b of this.game.blockers) out += pegSvg(off + b.c * UNIT, off + b.r * UNIT, BLOCKER_COLOR);
    for (const p of this.game.pieces()) {
      if (!p.placed || !p.at) continue;
      const lifted = this.drag?.id === p.id ? 'lifted' : '';
      const flash = this.flashId === p.id ? 'flash' : '';
      out += `<g class="placed ${lifted} ${flash}" data-piece="${p.id}" transform="translate(${off + p.at.c * UNIT} ${off + p.at.r * UNIT})">`;
      out += pieceSvg(p.cells, PIECE_COLORS[p.id]).replaceAll('<g ', '<g class="cube" ');
      out += `</g>`;
    }
    return out + `</svg>`;
  }

  private trayHtml(): string {
    const pieces = new Map(this.game.pieces().map((p) => [p.id, p]));
    return TRAY_ROWS.map((row) => {
      const slots = row.map((id) => {
        const p = pieces.get(id)!;
        const { w, h } = pieceBounds(p.cells);
        const n = Math.max(...PIECES.find((x) => x.id === id)!.orientations.map((o) => Math.max(pieceBounds(o).w, pieceBounds(o).h)));
        const cls = ['piece', p.placed ? 'placed' : ''].join(' ');
        const svg = `<svg class="${cls}" data-piece="${p.id}" style="--w:${w};--h:${h}" viewBox="0 0 ${w * UNIT} ${h * UNIT}">${pieceSvg(p.cells, PIECE_COLORS[p.id])}</svg>`;
        const flip = CHIRAL.has(p.id) ? `<button class="flip" data-action="flip" data-flip="${p.id}">Flip</button>` : '';
        return `<div class="slot"><div class="well" style="--n:${n}">${svg}</div>${flip}</div>`;
      });
      return `<div class="tray-row">${slots.join('')}</div>`;
    }).join('');
  }

  private menuHtml(): string {
    if (!this.menuOpen) return '';
    const body =
      this.menuView === 'help' ? this.helpHtml()
      : this.menuView === 'mp' ? this.mpHtml()
      : this.menuView === 'times' ? this.timesHtml()
      : this.mainMenuHtml();
    return `<div class="menu-backdrop" data-action="menu"></div><aside class="menu ${this.menuView === 'help' ? 'wide' : ''}">${body}</aside>`;
  }

  private mainMenuHtml(): string {
    return `
        <div class="menu-head"><span>MENU</span><button class="btn ghost step" data-action="menu">X</button></div>
        <button class="btn primary wide" data-action="roll">Roll</button>
        <div class="level" title="Difficulty for the next roll">
          <button class="btn ghost step" data-action="level-down" ${this.level <= 1 ? 'disabled' : ''}>-</button>
          <span class="level-value">LEVEL ${this.level}</span>
          <button class="btn ghost step" data-action="level-up" ${this.level >= LEVEL_COUNT ? 'disabled' : ''}>+</button>
        </div>
        <button class="btn ghost wide" data-action="times">Times</button>
        <label class="menu-field">
          <span>PLAYER</span>
          <input class="name" name="playerName" type="text" maxlength="16" autocomplete="off" autocapitalize="words" value="${escapeHtml(this.playerName)}" />
        </label>
        <form class="menu-field" data-form="puzzle">
          <span>PUZZLE # (0 to ${PUZZLE_COUNT - 1})</span>
          <div class="menu-row">
            <input class="name" name="puzzle" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" placeholder="${this.game.seed}" autocomplete="off" />
            <button class="btn ghost" type="submit">Go</button>
          </div>
        </form>
        <div class="menu-row">
          <button class="btn ghost ${this.room ? 'on' : ''}" data-action="mp">${this.room ? `Room ${this.room.code}` : 'Multiplayer'}</button>
          <button class="btn ghost" data-action="help">Help</button>
        </div>`;
  }

  private mpHtml(): string {
    const head = `<div class="menu-head"><button class="btn ghost step" data-action="menu-main">&lt;</button><span>MULTIPLAYER</span><button class="btn ghost step" data-action="menu">X</button></div>`;
    if (this.room && this.roomState) {
      const players = this.roomState.players
        .map((p) => `<div class="best-row ${p.online ? '' : 'offline'}"><span class="best-time">${p.solvedMs !== null ? formatMs(p.solvedMs) : `${p.placed}/29`}</span><span class="best-info">${escapeHtml(p.name)}${p.id === this.playerId ? ' (you)' : ''}<small>${p.online ? 'online' : 'away'}</small></span></div>`)
        .join('');
      return `${head}
        <div class="pb-box"><span>ROOM CODE</span><strong>${this.room.code}</strong><small>friends join from the menu with this code</small></div>
        <div class="menu-sub">${this.roomState.players.length} PLAYER${this.roomState.players.length === 1 ? '' : 'S'}, SAME PUZZLE</div>
        <div class="best-list">${players}</div>
        <p class="menu-note">Roll asks everyone to roll. The new puzzle starts when all players have pressed Roll.</p>
        <button class="btn ghost wide" data-action="leave">Leave room</button>`;
    }
    return `${head}
        <p class="menu-note">Play the same puzzle as your friends and see each other's progress live.</p>
        <button class="btn primary wide" data-action="create-room" ${this.roomBusy ? 'disabled' : ''}>Create a room</button>
        <form class="menu-field" data-form="join">
          <span>OR JOIN WITH A CODE</span>
          <div class="menu-row">
            <input class="name code ${this.roomError ? 'bad' : ''}" name="code" type="text" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD" />
            <button class="btn ghost" type="submit" ${this.roomBusy ? 'disabled' : ''}>Join</button>
          </div>
          ${this.roomError ? `<span class="menu-error">${escapeHtml(this.roomError)}</span>` : ''}
        </form>`;
  }

  private timesHtml(): string {
    const head = `<div class="menu-head"><button class="btn ghost step" data-action="menu-main">&lt;</button><span>TIMES</span><button class="btn ghost step" data-action="menu">X</button></div>`;
    const scope = `<div class="menu-row">
        <button class="btn ghost ${this.timesScope === 'mine' ? 'on' : ''}" data-action="scope-mine">Mine</button>
        <button class="btn ghost ${this.timesScope === 'everyone' ? 'on' : ''}" data-action="scope-everyone">Everyone</button>
      </div>`;
    const sort = (label: string) => `<div class="menu-row sort">
        <span class="menu-sub">${label}</span>
        <button class="btn ghost step ${this.bestsSort === 'fastest' ? 'on' : ''}" data-action="sort-fastest">Fastest</button>
        <button class="btn ghost step ${this.bestsSort === 'recent' ? 'on' : ''}" data-action="sort-recent">Recent</button>
      </div>`;
    const row = (r: { seed: number; ms: number; at: number; name?: string }, top: boolean) => `<div class="best-row ${top ? 'top' : ''}">
        <span class="best-time">${formatMs(r.ms)}</span>
        <span class="best-info">${r.name ? `${escapeHtml(r.name)} ` : ''}#${String(r.seed).padStart(5, '0')} LV${levelOf(r.seed)}<small>${formatDate(r.at)}</small></span>
        <button class="btn ghost step" data-action="play" data-seed="${r.seed}">Play</button>
      </div>`;

    if (this.timesScope === 'mine') {
      const bests = readPuzzleBests();
      const top = overallBest(bests);
      const rows = Object.entries(bests)
        .map(([seed, b]) => ({ seed: Number(seed), ...b }))
        .sort((a, b) => (this.bestsSort === 'recent' ? b.at - a.at || a.ms - b.ms : a.ms - b.ms || a.seed - b.seed));
      const list = rows.length ? rows.map((r) => row(r, top !== null && r.seed === top.seed)).join('') : '<p class="menu-note">No solves on this device yet. Go fill a square!</p>';
      return `${head}${scope}
        <div class="pb-box">
          <span>PERSONAL BEST</span>
          ${top ? `<strong>${formatMs(top.ms)}</strong><small>puzzle #${String(top.seed).padStart(5, '0')}</small>` : '<strong>--:--</strong>'}
        </div>
        ${sort(`${rows.length} PUZZLE${rows.length === 1 ? '' : 'S'} SOLVED`)}
        <div class="best-list">${list}</div>`;
    }

    const list = this.times === null
      ? '<p class="menu-note">Loading…</p>'
      : this.times.length
        ? this.times.map((t, i) => row(t, i === 0 && this.bestsSort === 'fastest')).join('')
        : '<p class="menu-note">No times yet.</p>';
    return `${head}${scope}${sort(this.bestsSort === 'recent' ? 'LATEST SOLVES, EVERYONE' : 'FASTEST SOLVES, EVERYONE')}<div class="best-list">${list}</div>`;
  }

  private roomStripHtml(): string {
    if (!this.room || !this.roomState) return '';
    const st = this.roomState;
    const p = st.proposal;
    const ready = p?.ready ?? {};
    const iAgreed = ready[this.playerId] === true;
    const proposer = p ? st.players.find((x) => x.id === p.by)?.name ?? 'Someone' : '';
    const waiting = p ? st.players.filter((x) => x.online && !ready[x.id]).map((x) => x.name) : [];
    const players = st.players
      .map((x) => `<div class="rp ${x.online ? '' : 'offline'} ${x.solvedMs !== null ? 'done' : ''}">
          <span class="rp-name">${escapeHtml(x.name)}</span>
          <span class="rp-bar"><span style="width:${Math.round((x.placed / 29) * 100)}%"></span></span>
          <span class="rp-time">${x.solvedMs !== null ? formatMs(x.solvedMs) : `${x.placed}/29`}</span>
        </div>`)
      .join('');
    const banner = p
      ? `<div class="rp-banner">${iAgreed ? `WAITING FOR ${waiting.map(escapeHtml).join(', ') || '…'}` : `${escapeHtml(proposer)} WANTS TO ROLL`}${iAgreed ? '' : ' <button class="btn primary step" data-action="roll">Roll</button>'}</div>`
      : '';
    return `<section class="room"><div class="rp-head">ROOM ${this.room.code}</div>${players}${banner}</section>`;
  }

  private helpHtml(): string {
    const fmt = (n: number) => n.toLocaleString('en-US');
    const rows = LEVEL_BANDS.map(
      ([puzzles, min, max, mean], i) =>
        `<tr><td>${i + 1}</td><td>${fmt(puzzles)}</td><td>${fmt(min)}</td><td>${fmt(max)}</td><td>${fmt(mean)}</td></tr>`,
    ).join('');
    return `
        <div class="menu-head"><button class="btn ghost step" data-action="menu-main">&lt;</button><span>HELP</span><button class="btn ghost step" data-action="menu">X</button></div>
        <div class="help">
          <h3>HOW TO PLAY</h3>
          <p>The Genius Square is a 6 by 6 board. Roll the seven dice: each one names a square, like C2. Put a blocker on every square rolled.</p>
          <p>Now fill every other square with the nine pieces. Pieces can be turned and flipped. Nothing may overlap or hang off the board.</p>
          <p>Every roll can be solved, usually many ways. There are ${fmt(PUZZLE_COUNT)} different rolls. Play solo against the clock, or race: everyone gets the same roll, first to fill the board wins.</p>

          <h3>USING THE APP</h3>
          <p><b>Drag</b> a piece from the tray onto the board with one finger. Green means it fits, red means it doesn't. Let go off the board to put it back.</p>
          <p><b>Tap</b> a piece to turn it a quarter turn. Only the light blue L and the red S have a mirror shape, so they have <b>Flip</b> buttons.</p>
          <p><b>Tap a greyed-out</b> piece in the tray to pull it back off the board.</p>
          <p><b>Menu:</b> Roll starts a new puzzle at the chosen Level (1 easiest, ${LEVEL_COUNT} hardest). Timer and Sound switch the clock and audio. Times lists your fastest solves on this device and everyone's fastest overall. Puzzle # jumps to any puzzle by number.</p>
          <p><b>Links:</b> the address bar always shows the current puzzle, like /12345. Share it and someone else gets the same roll.</p>
          <p><b>Install:</b> in Safari tap Share, then Add to Home Screen. It works offline after that.</p>

          <h3>PUZZLE STATS</h3>
          <p>Every one of the ${fmt(PUZZLE_COUNT)} rolls was solved every possible way by computer. All together that's ${fmt(TOTAL_SOLUTIONS)} solutions. Fewer solutions means a harder puzzle, so the rolls are ranked by solution count and split into ${LEVEL_COUNT} equal levels.</p>
          <div class="table-wrap"><table class="stats">
            <thead><tr><th>LV</th><th>PUZZLES</th><th>FEWEST</th><th>MOST</th><th>AVERAGE</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
          <p class="menu-note">Fewest / most / average = solutions per puzzle at that level.</p>
        </div>`;
  }

  private overlayHtml(): string {
    if (this.overlay === 'rolling') {
      return `<div class="overlay"><div class="card"><h2>ROLLING</h2><div class="dice">${this.diceFaces
        .map((f) => `<div class="die rolling">${f}</div>`)
        .join('')}</div></div></div>`;
    }
    if (this.overlay === 'won' && this.won) {
      const w = this.won;
      return `<div class="overlay"><div class="card">
        <h2>SOLVED!</h2>
        <p class="time">TIME ${formatMs(w.ms)}</p>
        <p class="bests">
          PUZZLE #${this.game.seed} BEST: ${formatMs(w.puzzleBest)}${w.puzzleNew ? ' <span class="best">NEW!</span>' : ''}<br>
          PERSONAL BEST: ${formatMs(w.overallBest)}${this.toBeat && this.toBeat.ms < w.ms ? `<br>TO BEAT: ${formatMs(this.toBeat.ms)} BY ${escapeHtml(this.toBeat.name).toUpperCase()}` : ''}
        </p>
        ${w.overallNew ? '<p class="pb">PERSONAL BEST!</p>' : ''}
        <button class="btn primary" data-action="roll">Roll again</button>
      </div></div><canvas class="confetti"></canvas>`;
    }
    return '';
  }

  private tickClock(): void {
    const clock = this.root.querySelector('.clock');
    if (clock && this.overlay === 'none') clock.textContent = formatMs(this.game.elapsedMs());
  }

  // ---------- actions ----------

  private roll(seed?: number): void {
    if (this.room && this.overlay !== 'rolling') {
      this.menuOpen = false;
      sound.unlock();
      sound.rotate();
      void this.room.roll(seed ?? randomSeedForLevel(this.level)).catch(() => undefined);
      this.render();
      return;
    }
    this.startRoll(seed);
  }

  /** Roll locally (solo, or the room agreed on a seed). */
  /** True when no piece is on the board and nothing is in progress: safe to reload. */
  isIdle(): boolean {
    return this.overlay === 'none' && this.game.board.placements.size === 0 && !this.room;
  }

  private startRoll(seed?: number): void {
    this.onRollStart?.();
    this.flashId = null;
    this.menuOpen = false;
    this.overlay = 'rolling';
    sound.unlock();
    sound.roll();
    const target = new Game(seed ?? randomSeedForLevel(this.level));
    let ticks = 0;
    const spin = setInterval(() => {
      this.diceFaces = DICE.map((die) => die[Math.floor(Math.random() * die.length)]);
      this.render();
      if (++ticks >= 7) {
        clearInterval(spin);
        this.diceFaces = target.blockers.map(squareName);
        this.render();
        this.root.querySelectorAll('.die').forEach((d) => d.classList.remove('rolling'));
        setTimeout(() => {
          this.game = target;
          this.overlay = 'none';
          history.replaceState(null, '', `/${target.seed}`);
          this.toBeat = null;
          void this.loadToBeat(target.seed);
          void this.room?.startPuzzle(target.seed);
          this.render();
        }, 700);
      }
    }, 110);
  }

  private hint(): void {
    const h: GameHint | null = this.game.hint();
    if (!h) return;
    sound.drop();
    this.flashId = h.id;
    this.render();
    setTimeout(() => {
      this.flashId = null;
      this.afterMove();
    }, 1600);
  }

  private flip(id: PieceId): void {
    sound.unlock();
    sound.rotate();
    const was = this.game.board.placements.get(id)?.at;
    this.game.flip(id);
    if (was) this.game.drop(id, was);
    this.afterMove();
  }

  // ---------- multiplayer ----------

  private onRoomState(state: RoomState): void {
    const first = this.roomState === null;
    this.roomState = state;
    // Someone else finished this puzzle before me: play the sad Fifth once per player.
    if (!first && state.seed === this.game.seed && !this.game.isSolved()) {
      for (const p of state.players) {
        const key = `${state.seed}:${p.id}`;
        if (p.id !== this.playerId && p.solvedMs !== null && !this.announced.has(key)) {
          this.announced.add(key);
          sound.lose();
        }
      }
    }
    if ((first || state.seed !== this.game.seed) && this.overlay !== 'rolling' && state.seed !== this.game.seed) {
      this.startRoll(state.seed);
      return;
    }
    this.render();
  }

  private async createRoom(): Promise<void> {
    if (this.roomBusy) return;
    this.roomBusy = true;
    this.roomError = '';
    this.render();
    try {
      this.room = await RoomClient.create(this.playerId, this.playerName, this.game.seed, (s) => this.onRoomState(s));
      sound.menu();
    } catch (err) {
      this.roomError = 'Could not create a room. Online?';
      console.error(err);
    } finally {
      this.roomBusy = false;
      this.render();
    }
  }

  private async joinRoom(code: string): Promise<void> {
    if (this.roomBusy) return;
    this.roomBusy = true;
    this.roomError = '';
    this.render();
    try {
      this.room = await RoomClient.join(this.playerId, this.playerName, code, (s) => this.onRoomState(s));
      sound.menu();
    } catch (err) {
      this.roomError = err instanceof Error && /No room/.test(err.message) ? 'No room with that code' : 'Could not join. Online?';
      console.error(err);
    } finally {
      this.roomBusy = false;
      this.render();
    }
  }

  private async leaveRoom(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.roomState = null;
    this.render();
    await room?.leave();
  }

  private async loadToBeat(seed: number): Promise<void> {
    try {
      const best = await bestTimeFor(seed);
      if (this.game.seed === seed) {
        this.toBeat = best;
        this.render();
      }
    } catch {
      /* offline */
    }
  }

  private async loadTimes(): Promise<void> {
    this.times = null;
    this.render();
    const want = this.bestsSort;
    try {
      const list = await (want === 'recent' ? recentTimes(20) : topTimes(20));
      if (this.bestsSort !== want) return;
      this.times = list;
    } catch {
      this.times = [];
    }
    if (this.menuView === 'times') this.render();
  }

  private toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
    this.menuView = 'main';
    sound.unlock();
    if (this.menuOpen) sound.menu();
    this.render();
  }

  private onSubmit(e: Event): void {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    if (form.dataset.form === 'join') {
      const input = form.elements.namedItem('code') as HTMLInputElement;
      if (!isRoomCode(input.value)) {
        this.roomError = 'Codes are 4 letters';
        sound.error();
        this.render();
        return;
      }
      void this.joinRoom(input.value);
      return;
    }
    if (form.dataset.form !== 'puzzle') return;
    const input = form.elements.namedItem('puzzle') as HTMLInputElement;
    const n = Number(input.value.trim());
    if (!Number.isInteger(n) || n < 0 || n >= PUZZLE_COUNT) {
      sound.error();
      input.classList.add('bad');
      return;
    }
    this.roll(n);
  }

  private onChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.name === 'playerName') {
      this.playerName = input.value.trim() || DEFAULT_NAME;
      writeStorage(NAME_KEY, this.playerName);
      input.value = this.playerName;
    }
  }

  private setLevel(level: number): void {
    this.level = clampLevel(level);
    writeStorage(LEVEL_KEY, String(this.level));
    sound.rotate();
    this.render();
  }

  private toggleMute(): void {
    sound.setMuted(!sound.isMuted());
    writeStorage(MUTE_KEY, sound.isMuted() ? '1' : '0');
    if (!sound.isMuted()) sound.rotate();
    this.render();
  }


  private toggleTimer(): void {
    this.showTimer = !this.showTimer;
    writeStorage(TIMER_KEY, this.showTimer ? '1' : '0');
    this.render();
  }

  private afterMove(): void {
    if (this.overlay === 'won') return;
    void this.room?.setPlaced(29 - this.game.board.emptyCount());
    if (this.game.isSolved()) {
      const ms = this.game.elapsedMs();
      void this.room?.setSolved(ms);
      recordTime({ name: this.playerName, ms, seed: this.game.seed, at: 0 }).catch(() => undefined);
      const seed = String(this.game.seed);
      const puzzleBests = readPuzzleBests();
      const prevPuzzle = puzzleBests[seed]?.ms;
      const prevOverall = overallBest(puzzleBests)?.ms ?? null;
      const puzzleNew = prevPuzzle === undefined || ms < prevPuzzle;
      const overallNew = prevOverall === null || ms < prevOverall;
      if (puzzleNew) {
        puzzleBests[seed] = { ms, at: Date.now() };
        writeStorage(PUZZLE_BESTS_KEY, JSON.stringify(puzzleBests));
      }
      if (overallNew) writeStorage(BEST_KEY, String(ms));
      this.won = {
        ms,
        puzzleBest: puzzleNew ? ms : prevPuzzle!,
        puzzleNew,
        overallBest: overallNew ? ms : prevOverall!,
        overallNew,
      };
      this.overlay = 'won';
      this.render();
      sound.win(this.won.overallNew);
      this.confetti();
      return;
    }
    this.render();
  }

  // ---------- pointer input ----------

  private onPointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    const button = target.closest<HTMLElement>('[data-action]');
    if (button) {
      e.preventDefault();
      const action = button.dataset.action;
      if (action === 'roll') this.roll();
      else if (action === 'hint') this.hint();
      else if (action === 'flip') this.flip(button.dataset.flip as PieceId);
      else if (action === 'timer') this.toggleTimer();
      else if (action === 'mute') this.toggleMute();
      else if (action === 'level-down') this.setLevel(this.level - 1);
      else if (action === 'level-up') this.setLevel(this.level + 1);
      else if (action === 'menu') this.toggleMenu();
      else if (action === 'menu-main') { this.menuView = 'main'; this.render(); }
      else if (action === 'help') { this.menuOpen = true; this.menuView = 'help'; sound.unlock(); sound.rotate(); this.render(); }
      else if (action === 'mp') { this.menuView = 'mp'; this.roomError = ''; sound.rotate(); this.render(); }
      else if (action === 'times') { this.menuView = 'times'; sound.rotate(); this.render(); if (this.timesScope === 'everyone') void this.loadTimes(); }
      else if (action === 'scope-mine') { this.timesScope = 'mine'; sound.rotate(); this.render(); }
      else if (action === 'scope-everyone') { this.timesScope = 'everyone'; sound.rotate(); this.render(); void this.loadTimes(); }
      else if (action === 'create-room') void this.createRoom();
      else if (action === 'sort-fastest' || action === 'sort-recent') { this.bestsSort = action === 'sort-recent' ? 'recent' : 'fastest'; sound.rotate(); this.render(); if (this.timesScope === 'everyone') void this.loadTimes(); }
      else if (action === 'leave') void this.leaveRoom();
      else if (action === 'play') this.roll(Number(button.dataset.seed));
      return;
    }
    if (this.overlay !== 'none' || this.drag) return;
    const el = target.closest<HTMLElement>('[data-piece]');
    if (!el) return;
    e.preventDefault();
    const id = el.dataset.piece as PieceId;
    if (el.classList.contains('placed')) {
      // Recall: a greyed-out tray piece comes back off the board.
      sound.unlock();
      sound.pickUp();
      this.game.pickUp(id);
      this.render();
      return;
    }
    const cells = this.game.orientation(id);
    const cell = this.cellPx();
    const rect = el.getBoundingClientRect();
    const scale = el.classList.contains('piece') ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tray-scale')) : 1;
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    const { w, h } = pieceBounds(cells);
    ghost.innerHTML = `<svg width="${w * cell}" height="${h * cell}" viewBox="0 0 ${w * UNIT} ${h * UNIT}">${pieceSvg(cells, PIECE_COLORS[id])}</svg>`;
    document.body.appendChild(ghost);
    this.drag = {
      id,
      cells,
      startX: e.clientX,
      startY: e.clientY,
      startedAt: performance.now(),
      offX: (e.clientX - rect.left) / scale,
      offY: (e.clientY - rect.top) / scale + LIFT * cell,
      ghost,
      moved: false,
    };
    sound.unlock();
    sound.pickUp();
    this.positionGhost(e);
    this.render();
  }

  private ghostOrigin(drag: Drag, e: PointerEvent): { x: number; y: number } {
    return { x: e.clientX - drag.offX, y: e.clientY - drag.offY };
  }

  private positionGhost(e: PointerEvent): void {
    const { x, y } = this.ghostOrigin(this.drag!, e);
    this.drag!.ghost.style.transform = `translate(${x}px, ${y}px)`;
  }

  /** Board cell the dragged piece's origin would land on, or null when off the board. */
  private targetCell(drag: Drag, e: PointerEvent): Cell | null {
    const { x, y } = this.ghostOrigin(drag, e);
    const origin = this.boardOrigin();
    const cell = this.cellPx();
    const c = Math.round((x - origin.x) / cell);
    const r = Math.round((y - origin.y) / cell);
    const { w, h } = pieceBounds(drag.cells);
    if (r < -h || c < -w || r > SIZE || c > SIZE) return null;
    return { r, c };
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.drag) return;
    if (Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY) > 8) this.drag.moved = true;
    if (!this.drag.moved) return;
    this.positionGhost(e);
    this.root.querySelectorAll('.grid-cell').forEach((g) => g.classList.remove('ok', 'bad'));
    const at = this.targetCell(this.drag, e);
    if (!at) return;
    const ok = this.game.board.canPlace(this.drag.cells, at) || this.game.board.placements.get(this.drag.id)?.at === at;
    for (const c of this.drag.cells) {
      const g = this.root.querySelector(`.grid-cell[data-r="${at.r + c.r}"][data-c="${at.c + c.c}"]`);
      g?.classList.add(ok ? 'ok' : 'bad');
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    drag.ghost.remove();
    const quick = performance.now() - drag.startedAt < 400;
    if (!drag.moved && quick) {
      const was = this.game.board.placements.get(drag.id)?.at;
      sound.rotate();
      this.game.rotate(drag.id);
      if (was) this.game.drop(drag.id, was);
      this.afterMove();
      return;
    }
    if (!drag.moved) {
      this.render();
      return;
    }
    const at = this.targetCell(drag, e);
    if (at === null) {
      this.game.pickUp(drag.id);
      this.afterMove();
      return;
    }
    if (this.game.drop(drag.id, at)) {
      if (!this.game.isSolved()) sound.drop();
      this.afterMove();
      return;
    }
    sound.error();
    this.render();
    this.root.querySelector(`.tray .piece[data-piece="${drag.id}"]`)?.classList.add('bounce');
  }

  // ---------- celebration ----------

  private confetti(): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>('canvas.confetti');
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d')!;
    const colors = Object.values(PIECE_COLORS);
    const bits = Array.from({ length: 140 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.5,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      s: 6 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    const start = performance.now();
    const frame = (t: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const b of bits) {
        b.x += b.vx;
        b.y += b.vy;
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x, b.y, b.s, b.s);
      }
      if (t - start < 4000 && canvas.isConnected) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}
