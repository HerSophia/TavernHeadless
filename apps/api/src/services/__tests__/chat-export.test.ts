import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

import { createDatabase, type AppDb } from '../../db/client.js';
import { sessions, floors, messagePages, messages, variables, memoryItems, memoryEdges } from '../../db/schema.js';
import { DEFAULT_ADMIN_ACCOUNT_ID } from '../../accounts/constants.js';
import { stringifyJsonField } from '../../lib/http.js';
import { TH_CHAT_SPEC, TH_CHAT_SPEC_VERSION } from '@tavern/shared';
import {
  serializeSessionToThChat,
  serializeSessionToStJsonl,
} from '../chat-export.js';

// ── helpers ────────────────────────────────────────

const NOW = 1700000000000;
const ACCOUNT_ID = DEFAULT_ADMIN_ACCOUNT_ID;

interface SeedResult {
  sessionId: string;
  floorId: string;
  page1Id: string;
  page2Id: string;
  msg1Id: string;
  msg2Id: string;
}

/** 插入一个最小可测 session：1 floor, 2 pages (version 1+2), 1 msg each */
function seedMinimalSession(db: AppDb): SeedResult {
  const sessionId = nanoid();
  const floorId = nanoid();
  const page1Id = nanoid();
  const page2Id = nanoid();
  const msg1Id = nanoid();
  const msg2Id = nanoid();

  db.insert(sessions).values({
    id: sessionId,
    title: 'Test Chat',
    status: 'active',
    accountId: ACCOUNT_ID,
    characterSnapshotJson: stringifyJsonField({ name: 'Alice' }),
    userSnapshotJson: stringifyJsonField({ name: 'Bob' }),
    characterSyncPolicy: 'pin',
    metadataJson: stringifyJsonField({ custom_key: 'custom_val' }),
    createdAt: NOW,
    updatedAt: NOW,
  }).run();

  db.insert(floors).values({
    id: floorId,
    sessionId,
    floorNo: 0,
    branchId: 'main',
    parentFloorId: null,
    state: 'committed',
    tokenIn: 5,
    tokenOut: 10,
    metadataJson: null,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();

  // page version 1 (active)
  db.insert(messagePages).values({
    id: page1Id,
    floorId,
    pageNo: 0,
    pageKind: 'output',
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();

  // page version 2 (inactive swipe)
  db.insert(messagePages).values({
    id: page2Id,
    floorId,
    pageNo: 0,
    pageKind: 'output',
    isActive: false,
    version: 2,
    checksum: null,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();

  db.insert(messages).values({
    id: msg1Id,
    pageId: page1Id,
    seq: 0,
    role: 'assistant',
    content: 'Hello World',
    contentFormat: 'text',
    tokenCount: 3,
    isHidden: false,
    source: null,
    createdAt: NOW,
  }).run();

  db.insert(messages).values({
    id: msg2Id,
    pageId: page2Id,
    seq: 0,
    role: 'assistant',
    content: 'Hi there',
    contentFormat: 'text',
    tokenCount: 2,
    isHidden: false,
    source: null,
    createdAt: NOW,
  }).run();

  return { sessionId, floorId, page1Id, page2Id, msg1Id, msg2Id };
}

// ── tests ─────────────────────────────────────────

describe('serializeSessionToThChat', () => {
  let db: AppDb;
  let closeDb: () => void;

  beforeEach(() => {
    const conn = createDatabase(':memory:');
    db = conn.db;
    closeDb = conn.close;
  });

  afterEach(() => {
    closeDb();
  });

  it('produces correct envelope fields', () => {
    const { sessionId } = seedMinimalSession(db);
    const result = serializeSessionToThChat(db, sessionId);

    expect(result.spec).toBe(TH_CHAT_SPEC);
    expect(result.spec_version).toBe(TH_CHAT_SPEC_VERSION);
    expect(typeof result.exported_at).toBe('number');
    expect(result.export_source).toBe('tavern_headless');
  });

  it('maps session fields correctly', () => {
    const { sessionId } = seedMinimalSession(db);
    const result = serializeSessionToThChat(db, sessionId);

    expect(result.data.title).toBe('Test Chat');
    expect(result.data.status).toBe('active');
    expect(result.data.character_snapshot).toEqual({ name: 'Alice' });
    expect(result.data.user_snapshot).toEqual({ name: 'Bob' });
    expect(result.data.character_sync_policy).toBe('pin');
  });

  it('nests floor → page → message tree', () => {
    const { sessionId, floorId, page1Id, msg1Id } = seedMinimalSession(db);
    const result = serializeSessionToThChat(db, sessionId);

    expect(result.data.floors).toHaveLength(1);
    const floor = result.data.floors[0]!;
    expect(floor._original_id).toBe(floorId);
    expect(floor.floor_no).toBe(0);

    // 2 pages (2 versions)
    expect(floor.pages).toHaveLength(2);
    const activePage = floor.pages.find(p => p.is_active)!;
    expect(activePage._original_id).toBe(page1Id);
    expect(activePage.messages).toHaveLength(1);
    expect(activePage.messages[0]!._original_id).toBe(msg1Id);
    expect(activePage.messages[0]!.content).toBe('Hello World');
  });

  it('includes _original_id on all entities', () => {
    const { sessionId, floorId, page1Id, page2Id, msg1Id, msg2Id } = seedMinimalSession(db);
    const result = serializeSessionToThChat(db, sessionId);

    const ids = new Set<string>();
    for (const f of result.data.floors) {
      ids.add(f._original_id);
      for (const p of f.pages) {
        ids.add(p._original_id);
        for (const m of p.messages) {
          ids.add(m._original_id);
        }
      }
    }

    expect(ids.has(floorId)).toBe(true);
    expect(ids.has(page1Id)).toBe(true);
    expect(ids.has(page2Id)).toBe(true);
    expect(ids.has(msg1Id)).toBe(true);
    expect(ids.has(msg2Id)).toBe(true);
  });

  it('throws on non-existent session', () => {
    expect(() => serializeSessionToThChat(db, 'nonexistent')).toThrow('Session not found');
  });

  it('excludes variables when includeVariables=false', () => {
    const { sessionId } = seedMinimalSession(db);

    // 插入一个变量
    db.insert(variables).values({
      id: nanoid(),
      scope: 'chat',
      scopeId: sessionId,
      key: 'test_var',
      valueJson: JSON.stringify(42),
      updatedAt: NOW,
    }).run();

    const withVars = serializeSessionToThChat(db, sessionId, { includeVariables: true });
    expect(withVars.data.variables).toHaveLength(1);

    const withoutVars = serializeSessionToThChat(db, sessionId, { includeVariables: false });
    expect(withoutVars.data.variables).toBeUndefined();
  });
});

describe('serializeSessionToStJsonl', () => {
  let db: AppDb;
  let closeDb: () => void;

  beforeEach(() => {
    const conn = createDatabase(':memory:');
    db = conn.db;
    closeDb = conn.close;
  });

  afterEach(() => {
    closeDb();
  });

  it('outputs correct header line', () => {
    const { sessionId } = seedMinimalSession(db);
    const jsonl = serializeSessionToStJsonl(db, sessionId);
    const lines = jsonl.split('\n');
    const header = JSON.parse(lines[0]!);

    expect(header.user_name).toBe('Bob');
    expect(header.character_name).toBe('Alice');
    expect(header.chat_metadata.th_export).toBe(true);
  });

  it('outputs message lines with correct fields', () => {
    const { sessionId } = seedMinimalSession(db);
    const jsonl = serializeSessionToStJsonl(db, sessionId);
    const lines = jsonl.split('\n');

    expect(lines.length).toBeGreaterThanOrEqual(2);
    const msg = JSON.parse(lines[1]!);

    expect(msg.name).toBe('Alice');
    expect(msg.is_user).toBe(false);
    expect(msg.mes).toBe('Hello World');
    expect(typeof msg.send_date).toBe('number');
  });

  it('merges multi-version pages into swipes', () => {
    const { sessionId } = seedMinimalSession(db);
    const jsonl = serializeSessionToStJsonl(db, sessionId);
    const lines = jsonl.split('\n');
    const msg = JSON.parse(lines[1]!);

    expect(msg.swipes).toEqual(['Hello World', 'Hi there']);
    expect(msg.swipe_id).toBe(0); // version 1 is active
  });

  it('only outputs main branch committed floors', () => {
    const { sessionId, floorId } = seedMinimalSession(db);

    // 插入一个非 main 分支的 floor
    const otherFloorId = nanoid();
    db.insert(floors).values({
      id: otherFloorId,
      sessionId,
      floorNo: 1,
      branchId: 'branch-alt',
      parentFloorId: floorId,
      state: 'committed',
      tokenIn: 0,
      tokenOut: 0,
      createdAt: NOW,
      updatedAt: NOW,
    }).run();

    const otherPageId = nanoid();
    db.insert(messagePages).values({
      id: otherPageId,
      floorId: otherFloorId,
      pageNo: 0,
      pageKind: 'output',
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: NOW,
      updatedAt: NOW,
    }).run();

    db.insert(messages).values({
      id: nanoid(),
      pageId: otherPageId,
      seq: 0,
      role: 'assistant',
      content: 'Branch message',
      contentFormat: 'text',
      tokenCount: 2,
      isHidden: false,
      source: null,
      createdAt: NOW,
    }).run();

    const jsonl = serializeSessionToStJsonl(db, sessionId);
    const lines = jsonl.split('\n');

    // header + 1 msg from main branch only
    expect(lines).toHaveLength(2);
    expect(lines[1]).not.toContain('Branch message');
  });

  it('throws on non-existent session', () => {
    expect(() => serializeSessionToStJsonl(db, 'nonexistent')).toThrow('Session not found');
  });
});
