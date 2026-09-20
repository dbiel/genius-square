import { Board, SIZE, type Placement } from './board';
import { PIECES, type Cell, type Piece, type PieceId } from './pieces';

export type Solution = Map<PieceId, Placement>;

export interface Hint extends Placement {
  id: PieceId;
}

/**
 * Find placements for every piece not yet on the board so that the board is
 * full. Returns null when impossible. The given board is not modified.
 */
export function solve(board: Board): Solution | null {
  const work = board.clone();
  const solution: Solution = new Map();
  return search(work, remainingPieces(work), solution, () => true) ? solution : null;
}

/** Count complete solutions, stopping early once `limit` is reached. */
export function countSolutions(board: Board, limit = Infinity): number {
  const work = board.clone();
  let count = 0;
  search(work, remainingPieces(work), new Map(), () => ++count >= limit);
  return count;
}

/** One placement of an unplaced piece that is part of some complete solution. */
export function hint(board: Board): Hint | null {
  const solution = solve(board);
  if (!solution || solution.size === 0) return null;
  const [id, placement] = solution.entries().next().value as [PieceId, Placement];
  return { id, ...placement };
}

function remainingPieces(board: Board): Piece[] {
  return PIECES.filter((p) => !board.placements.has(p.id)).sort((a, b) => b.size - a.size);
}

function firstEmpty(board: Board): Cell | null {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board.get({ r, c }) === null) return { r, c };
    }
  }
  return null;
}

/**
 * Backtracking search. Always fills the first empty cell in reading order. The
 * piece cell landing there must be the orientation's first cell (orientations
 * are sorted row-major), because any earlier cell would already have been
 * empty. `onSolved` is called for each complete solution; returning true stops
 * the search.
 */
function search(board: Board, remaining: Piece[], solution: Solution, onSolved: () => boolean): boolean {
  const target = firstEmpty(board);
  if (!target) return remaining.length === 0 && onSolved();
  for (let i = 0; i < remaining.length; i++) {
    const piece = remaining[i];
    const rest = remaining.slice(0, i).concat(remaining.slice(i + 1));
    for (const cells of piece.orientations) {
      const at = { r: target.r - cells[0].r, c: target.c - cells[0].c };
      if (!board.canPlace(cells, at)) continue;
      board.place(piece.id, cells, at);
      solution.set(piece.id, { cells, at });
      if (search(board, rest, solution, onSolved)) return true;
      solution.delete(piece.id);
      board.remove(piece.id);
    }
  }
  return false;
}
