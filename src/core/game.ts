import { Board } from './board';
import { PUZZLE_COUNT, rollFromSeed } from './dice';
import { PIECES, cellKey, normalize, type Cell, type Piece, type PieceId } from './pieces';
import { hint as solverHint, solve, type Hint } from './solver';

export interface TrayPiece {
  id: PieceId;
  name: string;
  /** Current orientation, normalized. */
  cells: Cell[];
  placed: boolean;
  /** Where it sits when placed. */
  at?: Cell;
}

export interface GameHint extends Hint {
  /** True when the existing layout could not be finished and was cleared first. */
  cleared: boolean;
}

const BY_ID = new Map<PieceId, Piece>(PIECES.map((p) => [p.id, p]));

/** One puzzle in progress: the roll, the board, the tray, and the clock. */
export class Game {
  seed!: number;
  blockers!: Cell[];
  board!: Board;
  private orientations!: Map<PieceId, Cell[]>;
  private startedAt!: number;
  private solvedAt: number | null = null;
  private readonly now: () => number;

  constructor(seed?: number, now: () => number = Date.now) {
    this.now = now;
    this.reset(seed);
  }

  reset(seed: number = Math.floor(Math.random() * PUZZLE_COUNT)): void {
    this.seed = seed;
    this.blockers = rollFromSeed(seed);
    this.board = new Board(this.blockers);
    this.orientations = new Map(PIECES.map((p) => [p.id, p.orientations[0]]));
    this.startedAt = this.now();
    this.solvedAt = null;
  }

  pieces(): TrayPiece[] {
    return PIECES.map((p) => {
      const placement = this.board.placements.get(p.id);
      return {
        id: p.id,
        name: p.name,
        cells: this.orientation(p.id),
        placed: placement !== undefined,
        at: placement?.at,
      };
    });
  }

  orientation(id: PieceId): Cell[] {
    return this.orientations.get(id)!;
  }

  rotate(id: PieceId): void {
    this.setOrientation(id, this.orientation(id).map((c) => ({ r: c.c, c: -c.r })));
  }

  flip(id: PieceId): void {
    this.setOrientation(id, this.orientation(id).map((c) => ({ r: c.r, c: -c.c })));
  }

  /** Place the piece with its origin on `at`. Returns false (and changes nothing) if illegal. */
  drop(id: PieceId, at: Cell): boolean {
    const previous = this.board.placements.get(id);
    if (previous) this.board.remove(id);
    const cells = this.orientation(id);
    if (this.board.canPlace(cells, at)) {
      this.board.place(id, cells, at);
      this.checkSolved();
      return true;
    }
    if (previous) this.board.place(id, previous.cells, previous.at);
    return false;
  }

  pickUp(id: PieceId): void {
    this.board.remove(id);
  }

  solvable(): boolean {
    return solve(this.board) !== null;
  }

  /** Place one correct piece. Clears the board first if the current layout is a dead end. */
  hint(): GameHint | null {
    if (this.isSolved()) return null;
    let cleared = false;
    let h = solverHint(this.board);
    if (!h) {
      for (const id of [...this.board.placements.keys()]) this.board.remove(id);
      cleared = true;
      h = solverHint(this.board);
      if (!h) return null;
    }
    this.orientations.set(h.id, h.cells);
    this.board.place(h.id, h.cells, h.at);
    this.checkSolved();
    return { ...h, cleared };
  }

  isSolved(): boolean {
    return this.board.isSolved();
  }

  elapsedMs(): number {
    return (this.solvedAt ?? this.now()) - this.startedAt;
  }

  private setOrientation(id: PieceId, raw: Cell[]): void {
    const normalized = normalize(raw);
    const piece = BY_ID.get(id)!;
    const key = cellKey(normalized);
    const match = piece.orientations.find((o) => cellKey(o) === key);
    if (!match) throw new Error(`Orientation not found for ${id}: ${key}`);
    this.board.remove(id);
    this.orientations.set(id, match);
  }

  private checkSolved(): void {
    if (this.solvedAt === null && this.board.isSolved()) this.solvedAt = this.now();
  }
}
