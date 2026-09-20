import type { Cell, PieceId } from './pieces';

export const SIZE = 6;
export const BLOCKER = 'blocker';

export type CellContent = PieceId | typeof BLOCKER | null;

export interface Placement {
  /** The orientation used, normalized to the origin. */
  cells: Cell[];
  /** Board cell the orientation's origin sits on. */
  at: Cell;
}

/** A 6x6 board holding blockers and placed pieces. Mutable; use clone() for snapshots. */
export class Board {
  private readonly grid: CellContent[];
  readonly placements = new Map<PieceId, Placement>();

  constructor(blockers: Cell[]) {
    this.grid = new Array<CellContent>(SIZE * SIZE).fill(null);
    for (const cell of blockers) this.grid[index(cell)] = BLOCKER;
  }

  get(cell: Cell): CellContent {
    return this.grid[index(cell)];
  }

  emptyCount(): number {
    let n = 0;
    for (const content of this.grid) if (content === null) n++;
    return n;
  }

  isSolved(): boolean {
    return this.emptyCount() === 0;
  }

  canPlace(cells: Cell[], at: Cell): boolean {
    for (const cell of cells) {
      const r = at.r + cell.r;
      const c = at.c + cell.c;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return false;
      if (this.grid[r * SIZE + c] !== null) return false;
    }
    return true;
  }

  place(id: PieceId, cells: Cell[], at: Cell): void {
    if (this.placements.has(id)) throw new Error(`Piece ${id} is already on the board`);
    if (!this.canPlace(cells, at)) throw new Error(`Cannot place ${id} at ${at.r},${at.c}`);
    for (const cell of cells) this.grid[(at.r + cell.r) * SIZE + at.c + cell.c] = id;
    this.placements.set(id, { cells, at });
  }

  remove(id: PieceId): void {
    const placement = this.placements.get(id);
    if (!placement) return;
    for (const cell of placement.cells) {
      this.grid[(placement.at.r + cell.r) * SIZE + placement.at.c + cell.c] = null;
    }
    this.placements.delete(id);
  }

  clone(): Board {
    const copy = new Board([]);
    for (let i = 0; i < this.grid.length; i++) copy.grid[i] = this.grid[i];
    for (const [id, p] of this.placements) copy.placements.set(id, { cells: p.cells, at: { ...p.at } });
    return copy;
  }

}

function index(cell: Cell): number {
  if (cell.r < 0 || cell.r >= SIZE || cell.c < 0 || cell.c >= SIZE) {
    throw new RangeError(`Cell off the board: ${cell.r},${cell.c}`);
  }
  return cell.r * SIZE + cell.c;
}
