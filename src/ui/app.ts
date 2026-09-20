import { Game, type GameHint } from '../core/game';
import { DICE, squareName } from '../core/dice';
import { SIZE } from '../core/board';
import type { Cell, PieceId } from '../core/pieces';
import { BLOCKER_COLOR, BOARD_COLOR, PIECE_COLORS } from './colors';
import { UNIT, pegSvg, pieceBounds, pieceSvg } from './tiles';
import { sound } from './sound';

const MARGIN = 0.9; // label gutter, in cells
const LIFT = 0.8; // cells the dragged piece floats above the finger
const BEST_KEY = 'gs.best';
const TIMER_KEY = 'gs.showTimer';
const KID_KEY = 'gs.kid';
const MUTE_KEY = 'gs.mute';

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

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class App {
  private game = new Game();
  private selected: PieceId | null = null;
  private drag: Drag | null = null;
  private showTimer = readStorage(TIMER_KEY) !== '0';
  private kidMode = readStorage(KID_KEY) === '1';
  private flashId: PieceId | null = null;
  private overlay: 'none' | 'rolling' | 'won' = 'none';
  private wonIsBest = false;
  private previousBest: string | null = null;
  private diceFaces: string[] = [];
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    sound.setMuted(readStorage(MUTE_KEY) === '1');
    document.documentElement.classList.toggle('kid', this.kidMode);
    root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    window.addEventListener('resize', () => this.fit());
    setInterval(() => this.tickClock(), 250);
    this.fit();
    this.roll();
  }

  // ---------- layout ----------

  private fit(): void {
    const landscape = window.innerWidth > window.innerHeight && window.innerWidth >= 700;
    const w = window.innerWidth - 24;
    const h = window.innerHeight - 24;
    const cell = landscape
      ? Math.min((h - 80) / (SIZE + MARGIN), (w * 0.55) / (SIZE + MARGIN))
      : Math.min(w / (SIZE + MARGIN), (h - 260) / (SIZE + MARGIN));
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
          <span class="puzzle">#${String(this.game.seed).padStart(5, '0')}</span>
          <span class="clock ${this.showTimer && !this.kidMode ? '' : 'hidden'}">${formatMs(this.game.elapsedMs())}</span>
        </div>
      </header>
      <section class="stage">
        <div class="board-wrap">${this.boardSvg()}</div>
        <div class="tray">${this.trayHtml()}</div>
      </section>
      <nav class="controls">
        <button class="btn primary" data-action="roll">Roll</button>
        <button class="btn" data-action="flip">Flip</button>
        <button class="btn" data-action="hint">${this.kidMode ? 'Help' : 'Hint'}</button>
        <button class="btn ghost ${this.showTimer && !this.kidMode ? '' : 'off'}" data-action="timer" title="Show or hide the clock">Timer</button>
        <button class="btn ghost ${sound.isMuted() ? 'off' : ''}" data-action="mute" title="Sound on or off">Sound</button>
        <button class="btn ghost ${this.kidMode ? 'on' : ''}" data-action="kid" title="Bigger pieces, no clock">Kid</button>
      </nav>
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
    return this.game
      .pieces()
      .map((p) => {
        const { w, h } = pieceBounds(p.cells);
        const cls = ['piece', p.placed ? 'placed' : '', this.selected === p.id ? 'selected' : ''].join(' ');
        return `<svg class="${cls}" data-piece="${p.id}" style="--w:${w};--h:${h}" viewBox="0 0 ${w * UNIT} ${h * UNIT}">${pieceSvg(p.cells, PIECE_COLORS[p.id])}</svg>`;
      })
      .join('');
  }

  private overlayHtml(): string {
    if (this.overlay === 'rolling') {
      return `<div class="overlay"><div class="card"><h2>ROLLING</h2><div class="dice">${this.diceFaces
        .map((f) => `<div class="die rolling">${f}</div>`)
        .join('')}</div></div></div>`;
    }
    if (this.overlay === 'won') {
      const ms = this.game.elapsedMs();
      const bestLine = this.wonIsBest
        ? '<span class="best">NEW BEST!</span>'
        : `<span class="best">BEST ${formatMs(Number(this.previousBest))}</span>`;
      return `<div class="overlay"><div class="card">
        <h2>SOLVED!</h2>
        <p>TIME ${formatMs(ms)}<br>${bestLine}</p>
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

  private roll(): void {
    this.selected = null;
    this.flashId = null;
    this.overlay = 'rolling';
    sound.unlock();
    sound.roll();
    const target = new Game();
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
    this.selected = null;
    this.render();
    setTimeout(() => {
      this.flashId = null;
      this.afterMove();
    }, 1600);
  }

  private flip(): void {
    if (!this.selected) return;
    sound.rotate();
    this.game.flip(this.selected);
    this.render();
  }

  private toggleMute(): void {
    sound.setMuted(!sound.isMuted());
    writeStorage(MUTE_KEY, sound.isMuted() ? '1' : '0');
    if (!sound.isMuted()) sound.rotate();
    this.render();
  }

  private toggleKid(): void {
    this.kidMode = !this.kidMode;
    writeStorage(KID_KEY, this.kidMode ? '1' : '0');
    document.documentElement.classList.toggle('kid', this.kidMode);
    this.fit();
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
      this.previousBest = readStorage(BEST_KEY);
      this.wonIsBest = this.previousBest === null || ms < Number(this.previousBest);
      if (this.wonIsBest) writeStorage(BEST_KEY, String(ms));
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
      else if (action === 'flip') this.flip();
      else if (action === 'timer') this.toggleTimer();
      else if (action === 'mute') this.toggleMute();
      else if (action === 'kid') this.toggleKid();
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
    this.selected = id;
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
