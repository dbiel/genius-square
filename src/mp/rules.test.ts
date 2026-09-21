import { describe, expect, test } from 'vitest';
import { makeRoomCode, isRoomCode, assignName, rollAgreed, type RoomPlayers } from './rules';

describe('room codes', () => {
  test('are four letters from an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeRoomCode();
      expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/); // no I or O
    }
  });

  test('use the supplied random source', () => {
    expect(makeRoomCode(() => 0)).toBe('AAAA');
    expect(makeRoomCode(() => 0.999999)).toBe('ZZZZ');
  });

  test('isRoomCode accepts upper or lower case and trims', () => {
    expect(isRoomCode(' abcd ')).toBe(true);
    expect(isRoomCode('ABCD')).toBe(true);
    expect(isRoomCode('ABC')).toBe(false);
    expect(isRoomCode('ABIO')).toBe(false);
  });
});

describe('assignName', () => {
  test('keeps a custom name', () => {
    expect(assignName('Griffin', 3)).toBe('Griffin');
  });

  test('renames a default "Player N" to the join position', () => {
    expect(assignName('Player 1', 1)).toBe('Player 1');
    expect(assignName('Player 1', 2)).toBe('Player 2');
    expect(assignName('player 7', 3)).toBe('Player 3');
  });

  test('blank becomes the join position too', () => {
    expect(assignName('   ', 4)).toBe('Player 4');
  });
});

describe('rollAgreed', () => {
  const players: RoomPlayers = {
    a: { name: 'A', online: true },
    b: { name: 'B', online: true },
    c: { name: 'C', online: false },
  };

  test('is false until every online player is ready', () => {
    expect(rollAgreed(players, { a: true })).toBe(false);
  });

  test('is true when all online players are ready, ignoring offline ones', () => {
    expect(rollAgreed(players, { a: true, b: true })).toBe(true);
  });

  test('is false with no ready map', () => {
    expect(rollAgreed(players, undefined)).toBe(false);
  });
});
