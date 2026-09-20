/** A board cell. Row 0 is the top (board row 1), column 0 is the left (board column A). */
export interface Cell {
  r: number;
  c: number;
}

export type PieceId =
  | 'dot'
  | 'domino'
  | 'bar3'
  | 'smallL'
  | 'bar4'
  | 'square'
  | 't'
  | 'bigL'
  | 's';

export interface Piece {
  id: PieceId;
  name: string;
  size: number;
  /** Every distinct rotation/flip, each normalized to the origin and sorted by row then column. */
  orientations: Cell[][];
}

/** Shift cells so the minimum row and column are 0, sorted row-major. */
export function normalize(cells: Cell[]): Cell[] {
  const minR = Math.min(...cells.map((c) => c.r));
  const minC = Math.min(...cells.map((c) => c.c));
  return cells
    .map((c) => ({ r: c.r - minR, c: c.c - minC }))
    .sort((a, b) => a.r - b.r || a.c - b.c);
}

export function cellKey(cells: Cell[]): string {
  return cells.map((c) => `${c.r},${c.c}`).join(' ');
}

/** Rotate 90 degrees clockwise: (r, c) -> (c, -r). */
function rotate(cells: Cell[]): Cell[] {
  return cells.map((c) => ({ r: c.c, c: -c.r }));
}

/** Mirror left-right: (r, c) -> (r, -c). */
function flip(cells: Cell[]): Cell[] {
  return cells.map((c) => ({ r: c.r, c: -c.c }));
}

/** All unique orientations (4 rotations x 2 flips, deduplicated) of a shape. */
export function orientationsOf(shape: Cell[]): Cell[][] {
  const seen = new Map<string, Cell[]>();
  let current = shape;
  for (let i = 0; i < 4; i++) {
    for (const variant of [current, flip(current)]) {
      const normalized = normalize(variant);
      seen.set(cellKey(normalized), normalized);
    }
    current = rotate(current);
  }
  return [...seen.values()];
}

function piece(id: PieceId, name: string, shape: Cell[]): Piece {
  return { id, name, size: shape.length, orientations: orientationsOf(shape) };
}

const X = (r: number, c: number): Cell => ({ r, c });

export const PIECES: Piece[] = [
  piece('dot', 'Dot', [X(0, 0)]),
  piece('domino', 'Domino', [X(0, 0), X(0, 1)]),
  piece('bar3', 'Bar 3', [X(0, 0), X(0, 1), X(0, 2)]),
  piece('smallL', 'Small L', [X(0, 0), X(1, 0), X(1, 1)]),
  piece('bar4', 'Bar 4', [X(0, 0), X(0, 1), X(0, 2), X(0, 3)]),
  piece('square', 'Square', [X(0, 0), X(0, 1), X(1, 0), X(1, 1)]),
  piece('t', 'T', [X(0, 0), X(0, 1), X(0, 2), X(1, 1)]),
  piece('bigL', 'Big L', [X(0, 0), X(1, 0), X(2, 0), X(2, 1)]),
  piece('s', 'S', [X(0, 1), X(0, 2), X(1, 0), X(1, 1)]),
];
