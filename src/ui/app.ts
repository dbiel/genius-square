import { Game, type GameHint } from '../core/game';
import { DICE, squareName } from '../core/dice';
import { SIZE } from '../core/board';
import { PIECES, type Cell, type PieceId } from '../core/pieces';
import { BLOCKER_COLOR, BOARD_COLOR, PIECE_COLORS } from './colors';
import { UNIT, pegSvg, pieceBounds, pieceSvg } from './tiles';
import { sound } from './sound';
import { LEVEL_COUNT, levelOf, randomSeedForLevel } from '../core/levels';
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

function readPuzzleBests(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(readStorage(PUZZLE_BESTS_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
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
    this.fit();
    this.roll(seedFromLocation());
  }

  // ---------- layout ----------

  private fit(): void {
    const landscape = window.innerWidth > window.innerHeight && window.innerWidth >= 700;
    const w = window.innerWidth - 24;
    const h = window.innerHeight - 24;
    const cell = landscape
      ? Math.min((h - 80) / (SIZE + MARGIN), (w * 0.55) / (SIZE + MARGIN))
      : Math.min(w / (SIZE + MARGIN), (h - 170) / (SIZE + MARGIN + TRAY_CELLS * 0.62 + 0.8));
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
          <span class="puzzle">#${String(this.game.seed).padStart(5, '0')} LV${levelOf(this.game.seed)}</span>
          <span class="clock ${this.showTimer ? '' : 'hidden'}">${formatMs(this.game.elapsedMs())}</span>
          <button class="burger" data-action="menu" aria-label="Menu"><span></span><span></span><span></span></button>
        </div>
      </header>
      <section class="stage">
        <div class="board-wrap">${this.boardSvg()}</div>
        <div class="tray">${this.trayHtml()}</div>
      </section>
      <nav class="controls">
        <button class="btn primary" data-action="roll">Roll</button>
        <div class="level" title="Difficulty for the next roll">
          <button class="btn ghost step" data-action="level-down" ${this.level <= 1 ? 'disabled' : ''}>-</button>
          <span class="level-value">LV ${this.level}</span>
          <button class="btn ghost step" data-action="level-up" ${this.level >= LEVEL_COUNT ? 'disabled' : ''}>+</button>
        </div>
      </nav>
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
    return `<div class="menu-backdrop" data-action="menu"></div>
      <aside class="menu">
        <div class="menu-head"><span>MENU</span><button class="btn ghost step" data-action="menu">X</button></div>
        <button class="btn primary wide" data-action="roll">Roll</button>
        <div class="menu-row">
          <button class="btn ghost ${this.showTimer ? '' : 'off'}" data-action="timer">Timer</button>
          <button class="btn ghost ${sound.isMuted() ? 'off' : ''}" data-action="mute">Sound</button>
        </div>
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
        <button class="btn ghost wide" disabled>Multiplayer <small>soon</small></button>
        <button class="btn ghost wide" disabled>Times <small>soon</small></button>
      </aside>`;
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
          PERSONAL BEST: ${formatMs(w.overallBest)}
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

  private toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
    sound.unlock();
    this.render();
  }

  private onSubmit(e: Event): void {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
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
    if (this.game.isSolved()) {
      const ms = this.game.elapsedMs();
      const seed = String(this.game.seed);
      const puzzleBests = readPuzzleBests();
      const prevPuzzle = puzzleBests[seed];
      const puzzleNew = prevPuzzle === undefined || ms < prevPuzzle;
      if (puzzleNew) {
        puzzleBests[seed] = ms;
        writeStorage(PUZZLE_BESTS_KEY, JSON.stringify(puzzleBests));
      }
      const prevOverall = readStorage(BEST_KEY);
      const overallNew = prevOverall === null || ms < Number(prevOverall);
      if (overallNew) writeStorage(BEST_KEY, String(ms));
      this.won = {
        ms,
        puzzleBest: puzzleNew ? ms : prevPuzzle!,
        puzzleNew,
        overallBest: overallNew ? ms : Number(prevOverall),
        overallNew,
      };
      this.overlay = 'won';
      this.render();
      sound.win();
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
      return;
    }
    if (this.overlay !== 'none' || this.drag) return;
    const el = target.closest<HTMLElement>('[data-piece]');
    if (!el) return;
    e.preventDefault();
    const id = el.dataset.piece as PieceId;
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
