import type { PieceId } from '../core/pieces';

/** Piece colors matched to the physical set (photo of David's copy, 2026-09-20). */
export const PIECE_COLORS: Record<PieceId, string> = {
  dot: '#3d4fc4',
  domino: '#b5793a',
  bar3: '#f0872a',
  smallL: '#b94b8f',
  bar4: '#8a7d70',
  square: '#4fba48',
  t: '#f2e229',
  bigL: '#63b6d9',
  s: '#e8402c',
};

export const BLOCKER_COLOR = '#c99a5b';
export const BOARD_COLOR = '#23232a';
export const CELL_COLOR = '#15151b';
