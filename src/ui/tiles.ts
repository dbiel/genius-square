import type { Cell } from '../core/pieces';

/** Size of one cell in SVG user units. */
export const UNIT = 100;

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 0xff;
    const out = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
    return Math.round(Math.max(0, Math.min(255, out)));
  };
  return `rgb(${ch(16)} ${ch(8)} ${ch(0)})`;
}

/** One bevelled cube, the way the wooden pieces look. */
export function cubeSvg(x: number, y: number, color: string): string {
  const b = UNIT * 0.14; // bevel width
  const u = UNIT;
  const light = shade(color, 0.45);
  const dark = shade(color, -0.4);
  return (
    `<g transform="translate(${x} ${y})">` +
    `<rect width="${u}" height="${u}" fill="${dark}"/>` +
    `<polygon points="0,0 ${u},0 ${u - b},${b} ${b},${b} ${b},${u - b} 0,${u}" fill="${light}"/>` +
    `<rect x="${b}" y="${b}" width="${u - 2 * b}" height="${u - 2 * b}" fill="${color}"/>` +
    `</g>`
  );
}

/** A whole piece drawn from its cells, origin at (0,0). */
export function pieceSvg(cells: Cell[], color: string): string {
  return cells.map((c) => cubeSvg(c.c * UNIT, c.r * UNIT, color)).join('');
}

export function pieceBounds(cells: Cell[]): { w: number; h: number } {
  return {
    w: Math.max(...cells.map((c) => c.c)) + 1,
    h: Math.max(...cells.map((c) => c.r)) + 1,
  };
}

/** Round wooden peg for a blocker. */
export function pegSvg(x: number, y: number, color: string): string {
  const cx = x + UNIT / 2;
  const cy = y + UNIT / 2;
  const r = UNIT * 0.38;
  return (
    `<circle cx="${cx}" cy="${cy + 6}" r="${r}" fill="${shade(color, -0.45)}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>` +
    `<circle cx="${cx - r * 0.3}" cy="${cy - r * 0.3}" r="${r * 0.35}" fill="${shade(color, 0.3)}" opacity="0.7"/>`
  );
}
