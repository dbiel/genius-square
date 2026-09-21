/** Pure multiplayer rules, no network. */

/** Letters that are hard to misread on a phone: no I or O. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 4;

export function makeRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return code;
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

export function isRoomCode(input: string): boolean {
  const code = normalizeRoomCode(input);
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}

/** A default "Player N" (or blank) name takes the join position; anything else is kept. */
export function assignName(name: string, position: number): string {
  const trimmed = name.trim();
  if (trimmed === '' || /^player\s*\d*$/i.test(trimmed)) return `Player ${position}`;
  return trimmed;
}

export interface RoomPlayer {
  name: string;
  online: boolean;
}

export type RoomPlayers = Record<string, RoomPlayer>;

/** A roll proposal goes through once every online player has agreed. */
export function rollAgreed(players: RoomPlayers, ready: Record<string, boolean> | undefined): boolean {
  if (!ready) return false;
  const online = Object.entries(players).filter(([, p]) => p.online);
  return online.length > 0 && online.every(([id]) => ready[id] === true);
}
