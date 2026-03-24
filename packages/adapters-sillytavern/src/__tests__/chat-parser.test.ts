import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseChatFile, parseSendDate, groupMessagesIntoFloors } from '../parsers/chat-parser.js';

// ── parseSendDate ───────────────────────────────────

describe('parseSendDate', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns the number directly when given a number', () => {
    expect(parseSendDate(1735689600000)).toBe(1735689600000);
  });

  it('parses ISO 8601 string', () => {
    expect(parseSendDate('2026-03-24T10:00:00.000Z')).toBe(Date.parse('2026-03-24T10:00:00.000Z'));
  });

  it('parses human-readable date string', () => {
    // Date.parse can handle some human-readable formats
    const result = parseSendDate('March 24, 2026');
    expect(result).toBe(Date.parse('March 24, 2026'));
    expect(result).toBeGreaterThan(0);
  });

  it('returns Date.now() for unparseable string', () => {
    const fakeNow = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(fakeNow);
    expect(parseSendDate('not a date')).toBe(fakeNow);
  });

  it('returns Date.now() for undefined', () => {
    const fakeNow = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(fakeNow);
    expect(parseSendDate(undefined)).toBe(fakeNow);
  });

  it('returns Date.now() for null', () => {
    const fakeNow = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(fakeNow);
    expect(parseSendDate(null)).toBe(fakeNow);
  });
});

// ── parseChatFile ───────────────────────────────────

describe('parseChatFile', () => {
  const validHeader = '{"chat_metadata":{},"user_name":"unused","character_name":"Alice"}';
  const userMsg = '{"name":"User","is_user":true,"mes":"Hello"}';
  const assistantMsg = '{"name":"Alice","is_user":false,"mes":"Hi there!","swipes":["Hi there!","Hey!"],"swipe_id":0}';

  it('parses a normal jsonl file', () => {
    const content = [validHeader, userMsg, assistantMsg].join('\n');
    const result = parseChatFile(content);

    expect(result.header.chat_metadata).toEqual({});
    expect(result.header.user_name).toBe('unused');
    expect(result.header.character_name).toBe('Alice');
    expect(result.messages).toHaveLength(2);
    expect(result.skippedLines).toBe(0);
  });

  it('skips empty lines and counts them', () => {
    const content = [validHeader, '', '  ', userMsg, ''].join('\n');
    const result = parseChatFile(content);

    expect(result.messages).toHaveLength(1);
    expect(result.skippedLines).toBe(3); // two empty lines + trailing empty
  });

  it('skips unparseable lines without failing', () => {
    const content = [validHeader, 'not json at all', userMsg].join('\n');
    const result = parseChatFile(content);

    expect(result.messages).toHaveLength(1);
    expect(result.skippedLines).toBe(1);
  });

  it('accepts header with only user_name', () => {
    const content = ['{"user_name":"test"}', userMsg].join('\n');
    const result = parseChatFile(content);

    expect(result.header.user_name).toBe('test');
    expect(result.messages).toHaveLength(1);
  });

  it('accepts header with only name', () => {
    const content = ['{"name":"test"}', userMsg].join('\n');
    const result = parseChatFile(content);

    expect(result.header.name).toBe('test');
  });

  it('throws when header has none of the required fields', () => {
    const content = ['{"something_else":true}', userMsg].join('\n');
    expect(() => parseChatFile(content)).toThrow('must contain at least one of');
  });

  it('throws for completely empty content', () => {
    expect(() => parseChatFile('')).toThrow('empty');
    expect(() => parseChatFile('\n\n')).toThrow('empty');
  });

  it('flattens Chub Chat mes object', () => {
    const chubMsg = '{"name":"User","is_user":true,"mes":{"message":"Hello from Chub"}}';
    const content = [validHeader, chubMsg].join('\n');
    const result = parseChatFile(content);

    expect(result.messages[0]!.mes).toBe('Hello from Chub');
  });

  it('flattens Chub Chat swipes objects', () => {
    const chubMsg = '{"name":"Alice","is_user":false,"mes":"v1","swipes":[{"message":"v1"},{"message":"v2"}]}';
    const content = [validHeader, chubMsg].join('\n');
    const result = parseChatFile(content);

    expect(result.messages[0]!.swipes).toEqual(['v1', 'v2']);
  });

  it('provides defaults for missing optional fields', () => {
    const minimalMsg = '{"name":"User","is_user":true,"mes":"test"}';
    const content = [validHeader, minimalMsg].join('\n');
    const result = parseChatFile(content);
    const msg = result.messages[0]!;

    expect(msg.extra).toBeUndefined();
    expect(msg.swipes).toBeUndefined();
    expect(msg.swipe_id).toBeUndefined();
    expect(msg.is_system).toBeUndefined();
    expect(msg.send_date).toBeUndefined();
  });

  it('skips message lines that fail Zod validation', () => {
    // missing required "name" field
    const badMsg = '{"is_user":true,"mes":"no name"}';
    const content = [validHeader, badMsg, userMsg].join('\n');
    const result = parseChatFile(content);

    expect(result.messages).toHaveLength(1);
    expect(result.skippedLines).toBe(1);
  });
});

// ── groupMessagesIntoFloors ─────────────────────────

describe('groupMessagesIntoFloors', () => {
  it('returns empty array for empty messages', () => {
    expect(groupMessagesIntoFloors([])).toEqual([]);
  });

  it('groups user-assistant pairs into floors', () => {
    const msgs = [
      { name: 'User', is_user: true, mes: 'Q1' },
      { name: 'Alice', is_user: false, mes: 'A1' },
      { name: 'User', is_user: true, mes: 'Q2' },
      { name: 'Alice', is_user: false, mes: 'A2' },
    ];
    const floors = groupMessagesIntoFloors(msgs);

    expect(floors).toHaveLength(2);
    expect(floors[0]!.floorNo).toBe(0);
    expect(floors[0]!.messages).toHaveLength(2);
    expect(floors[0]!.messages[0]!.role).toBe('user');
    expect(floors[0]!.messages[0]!.pageKind).toBe('input');
    expect(floors[0]!.messages[1]!.role).toBe('assistant');
    expect(floors[0]!.messages[1]!.pageKind).toBe('output');

    expect(floors[1]!.floorNo).toBe(1);
    expect(floors[1]!.messages).toHaveLength(2);
  });

  it('puts leading assistant (greeting) in floor 0 without user', () => {
    const msgs = [
      { name: 'Alice', is_user: false, mes: 'Hello! I am Alice.' },
      { name: 'User', is_user: true, mes: 'Hi' },
      { name: 'Alice', is_user: false, mes: 'How can I help?' },
    ];
    const floors = groupMessagesIntoFloors(msgs);

    expect(floors).toHaveLength(2);
    // Floor 0: greeting only
    expect(floors[0]!.floorNo).toBe(0);
    expect(floors[0]!.messages).toHaveLength(1);
    expect(floors[0]!.messages[0]!.role).toBe('assistant');
    expect(floors[0]!.messages[0]!.pageKind).toBe('output');
    // Floor 1: user + assistant
    expect(floors[1]!.floorNo).toBe(1);
    expect(floors[1]!.messages).toHaveLength(2);
  });

  it('groups consecutive assistant messages in the same floor', () => {
    const msgs = [
      { name: 'Alice', is_user: false, mes: 'Part 1' },
      { name: 'Alice', is_user: false, mes: 'Part 2' },
    ];
    const floors = groupMessagesIntoFloors(msgs);

    expect(floors).toHaveLength(1);
    expect(floors[0]!.messages).toHaveLength(2);
    expect(floors[0]!.messages[0]!.pageNo).toBe(0);
    expect(floors[0]!.messages[1]!.pageNo).toBe(1);
  });

  it('marks is_system messages as hidden in current floor', () => {
    const msgs = [
      { name: 'User', is_user: true, mes: 'test' },
      { name: 'System', is_user: false, mes: 'narration', is_system: true },
      { name: 'Alice', is_user: false, mes: 'reply' },
    ];
    const floors = groupMessagesIntoFloors(msgs);

    expect(floors).toHaveLength(1);
    expect(floors[0]!.messages).toHaveLength(3);
    expect(floors[0]!.messages[1]!.isHidden).toBe(true);
    expect(floors[0]!.messages[1]!.role).toBe('system');
  });

  it('preserves swipes and swipeId', () => {
    const msgs = [
      { name: 'User', is_user: true, mes: 'Q' },
      { name: 'Alice', is_user: false, mes: 'A1', swipes: ['A1', 'A2', 'A3'], swipe_id: 1 },
    ];
    const floors = groupMessagesIntoFloors(msgs);

    const assistantMsg = floors[0]!.messages[1]!;
    expect(assistantMsg.swipes).toEqual(['A1', 'A2', 'A3']);
    expect(assistantMsg.swipeId).toBe(1);
  });

  it('assigns correct pageNo for system messages', () => {
    const msgs = [
      { name: 'System', is_user: false, mes: 'System message', is_system: true },
      { name: 'User', is_user: true, mes: 'Hello' },
    ];
    const floors = groupMessagesIntoFloors(msgs);

    // system message creates floor 0, user opens floor 1
    expect(floors).toHaveLength(2);
    expect(floors[0]!.messages[0]!.isHidden).toBe(true);
    expect(floors[1]!.messages[0]!.role).toBe('user');
  });

  it('handles user-only messages (no assistant reply)', () => {
    const msgs = [
      { name: 'User', is_user: true, mes: 'Just a question' },
    ];
    const floors = groupMessagesIntoFloors(msgs);

    expect(floors).toHaveLength(1);
    expect(floors[0]!.messages).toHaveLength(1);
    expect(floors[0]!.messages[0]!.role).toBe('user');
  });
});
