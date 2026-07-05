import { describe, it, expect } from 'vitest';
import { parseWorldBook } from '../parsers/worldbook-parser.js';

describe('parseWorldBook', () => {
  it('parses object-style entries', () => {
    const json = {
      entries: {
        '0': {
          uid: 0,
          key: ['Alice'],
          content: 'Alice is a mage.',
          comment: 'Alice entry',
        },
        '1': {
          uid: 1,
          key: ['Bob'],
          content: 'Bob is a knight.',
        },
      },
    };

    const wb = parseWorldBook(json, 'Test Book');

    expect(wb.name).toBe('Test Book');
    expect(wb.entries).toHaveLength(2);
    expect(wb.entries[0]!.key).toEqual(['Alice']);
    expect(wb.entries[0]!.content).toBe('Alice is a mage.');
    expect(wb.entries[0]!.comment).toBe('Alice entry');
    // Default values
    expect(wb.entries[0]!.selective).toBe(true);
    expect(wb.entries[0]!.constant).toBe(false);
    expect(wb.entries[0]!.position).toBe(0); // BEFORE
    expect(wb.entries[0]!.order).toBe(100);
    expect(wb.entries[0]!.disable).toBe(false);
  });

  it('parses array-style entries (v2 character_book)', () => {
    const json = {
      entries: [
        {
          keys: ['dragon'],
          secondary_keys: ['fire'],
          content: 'A fire dragon.',
          enabled: true,
          insertion_order: 50,
          selective: true,
        },
      ],
    };

    const wb = parseWorldBook(json);
    expect(wb.entries).toHaveLength(1);
    expect(wb.entries[0]!.key).toEqual(['dragon']);
    expect(wb.entries[0]!.keysecondary).toEqual(['fire']);
    expect(wb.entries[0]!.order).toBe(50);
    expect(wb.entries[0]!.disable).toBe(false);
  });

  it('handles v2 extensions fields', () => {
    const json = {
      entries: {
        '0': {
          uid: 0,
          key: ['test'],
          content: 'test',
          extensions: {
            position: 4, // AT_DEPTH
            depth: 2,
            role: 1, // USER
            scan_depth: 5,
            case_sensitive: true,
            match_whole_words: true,
            exclude_recursion: true,
            prevent_recursion: true,
            delay_until_recursion: 2,
            outlet_name: 'LoreOutlet',
          },
        },
      },
    };

    const wb = parseWorldBook(json);
    const entry = wb.entries[0]!;

    expect(entry.position).toBe(4);
    expect(entry.depth).toBe(2);
    expect(entry.role).toBe(1);
    expect(entry.scanDepth).toBe(5);
    expect(entry.caseSensitive).toBe(true);
    expect(entry.matchWholeWords).toBe(true);
    expect(entry.excludeRecursion).toBe(true);
    expect(entry.preventRecursion).toBe(true);
    expect(entry.delayUntilRecursion).toBe(2);
    expect(entry.outletName).toBe('LoreOutlet');
  });

  it('maps v2 enabled to disable', () => {
    const json = {
      entries: [
        { key: ['a'], content: 'a', enabled: false },
        { key: ['b'], content: 'b', enabled: true },
      ],
    };

    const wb = parseWorldBook(json);
    expect(wb.entries[0]!.disable).toBe(true);
    expect(wb.entries[1]!.disable).toBe(false);
  });

  it('assigns uid from index when missing', () => {
    const json = {
      entries: [
        { key: ['a'], content: 'a' },
        { key: ['b'], content: 'b' },
      ],
    };

    const wb = parseWorldBook(json);
    expect(wb.entries[0]!.uid).toBe(0);
    expect(wb.entries[1]!.uid).toBe(1);
  });

  it('uses provided name or fallback', () => {
    expect(parseWorldBook({ entries: [] }, 'My Book').name).toBe('My Book');
    expect(parseWorldBook({ entries: [], name: 'JSON Name' }).name).toBe('JSON Name');
    expect(parseWorldBook({ entries: [] }).name).toBe('Unnamed');
  });

  it('parses top-level global settings', () => {
    const wb = parseWorldBook({
      entries: [],
      scanDepth: 5,
      caseSensitive: true,
      matchWholeWords: true,
      recursive: true,
      maxRecursionSteps: 4,
    });

    expect(wb).toMatchObject({ scanDepth: 5, caseSensitive: true, matchWholeWords: true, recursive: true, maxRecursionSteps: 4 });
  });

  it('fills default global settings', () => {
    const wb = parseWorldBook({ entries: [] });
    expect(wb.scanDepth).toBe(2);
    expect(wb.caseSensitive).toBe(false);
    expect(wb.matchWholeWords).toBe(false);
    expect(wb.recursive).toBe(false);
    expect(wb.maxRecursionSteps).toBe(0);
  });

  it('handles empty entries', () => {
    const wb = parseWorldBook({ entries: {} });
    expect(wb.entries).toHaveLength(0);
  });

  // ── #233: ST v2/v3 规范里 entry.position 是 string ──────────

  it('maps string position "before_char" to BEFORE (0)', () => {
    const wb = parseWorldBook({
      entries: [{ key: ['a'], content: 'a', position: 'before_char' }],
    });
    expect(wb.entries[0]!.position).toBe(0);
  });

  it('maps string position "after_char" to AFTER (1)', () => {
    const wb = parseWorldBook({
      entries: [{ key: ['a'], content: 'a', position: 'after_char' }],
    });
    expect(wb.entries[0]!.position).toBe(1);
  });

  it('maps unrecognized string position to AFTER (1) per ST binary tolerance', () => {
    const wb = parseWorldBook({
      entries: [{ key: ['a'], content: 'a', position: 'somewhere_else' }],
    });
    expect(wb.entries[0]!.position).toBe(1);
  });

  it('prefers numeric extensions.position over string top-level position', () => {
    const wb = parseWorldBook({
      entries: [
        { key: ['a'], content: 'a', position: 'after_char', extensions: { position: 4 } },
      ],
    });
    expect(wb.entries[0]!.position).toBe(4); // AT_DEPTH from extensions wins
  });

  it('keeps numeric top-level position working (regression)', () => {
    const wb = parseWorldBook({
      entries: [{ key: ['a'], content: 'a', position: 2 }],
    });
    expect(wb.entries[0]!.position).toBe(2); // AN_TOP
  });

  it('falls back to BEFORE (0) when position is null', () => {
    const wb = parseWorldBook({
      entries: [{ key: ['a'], content: 'a', position: null }],
    });
    expect(wb.entries[0]!.position).toBe(0);
  });

  it('parses a spec-compliant v2 character_book entry with string position without throwing', () => {
    const characterBook = {
      name: 'Embedded Lore',
      entries: [
        {
          keys: ['dragon'],
          secondary_keys: [],
          content: 'A fire dragon guards the keep.',
          enabled: true,
          insertion_order: 10,
          position: 'after_char',
          extensions: {},
        },
      ],
    };

    expect(() => parseWorldBook(characterBook)).not.toThrow();
    const wb = parseWorldBook(characterBook);
    expect(wb.entries).toHaveLength(1);
    expect(wb.entries[0]!.position).toBe(1);
    expect(wb.entries[0]!.content).toBe('A fire dragon guards the keep.');
  });
});
