import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

import { MissingAccountContextError } from '../../accounts/account-context.js';
import { createDatabase, type AppDb } from '../../db/client.js';
import { accounts, sessions, floors, messagePages, memoryEdges, memoryItems, messages, variables } from '../../db/schema.js';
import { DEFAULT_ADMIN_ACCOUNT_ID } from '../../accounts/constants.js';
import { stringifyJsonField } from '../../lib/http.js';
import {
  TH_CHAT_SPEC,
  TH_CHAT_SPEC_VERSION,
  buildBranchMemoryScopeId,
  buildBranchVariableScopeId,
} from '@tavern/shared';
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

function serializeThChatForAccount(
  db: AppDb,
  sessionId: string,
  options: Partial<Parameters<typeof serializeSessionToThChat>[2]> = {},
) {
  return serializeSessionToThChat(db, sessionId, { accountId: ACCOUNT_ID, ...options });
}

function serializeStJsonlForAccount(
  db: AppDb,
  sessionId: string,
  options: Partial<Parameters<typeof serializeSessionToStJsonl>[2]> = {},
) {
  return serializeSessionToStJsonl(db, sessionId, { accountId: ACCOUNT_ID, ...options });
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
    const result = serializeThChatForAccount(db, sessionId);

    expect(result.spec).toBe(TH_CHAT_SPEC);
    expect(result.spec_version).toBe(TH_CHAT_SPEC_VERSION);
    expect(typeof result.exported_at).toBe('number');
    expect(result.export_source).toBe('tavern_headless');
  });

  it('maps session fields correctly', () => {
    const { sessionId } = seedMinimalSession(db);
    const result = serializeThChatForAccount(db, sessionId);

    expect(result.data.title).toBe('Test Chat');
    expect(result.data.status).toBe('active');
    expect(result.data.character_snapshot).toEqual({ name: 'Alice' });
    expect(result.data.user_snapshot).toEqual({ name: 'Bob' });
    expect(result.data.character_sync_policy).toBe('pin');
  });

  it('nests floor → page → message tree', () => {
    const { sessionId, floorId, page1Id, msg1Id } = seedMinimalSession(db);
    const result = serializeThChatForAccount(db, sessionId);

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
    const result = serializeThChatForAccount(db, sessionId);

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

  it('preserves superseded floor history in thchat export', () => {
    const { sessionId, floorId } = seedMinimalSession(db);
    const replacementFloorId = nanoid();

    db.update(floors)
      .set({ supersededAt: NOW + 1, supersededByFloorId: replacementFloorId, updatedAt: NOW + 1 })
      .where(eq(floors.id, floorId))
      .run();
    const replacementPageId = nanoid();
    const replacementMessageId = nanoid();

    db.insert(floors).values({
      id: replacementFloorId,
      sessionId,
      floorNo: 0,
      branchId: 'main',
      parentFloorId: floorId,
      state: 'committed',
      tokenIn: 7,
      tokenOut: 8,
      metadataJson: null,
      createdAt: NOW + 2,
      updatedAt: NOW + 2,
    }).run();

    db.insert(messagePages).values({
      id: replacementPageId,
      floorId: replacementFloorId,
      pageNo: 0,
      pageKind: 'output',
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: NOW + 2,
      updatedAt: NOW + 2,
    }).run();

    db.insert(messages).values({
      id: replacementMessageId,
      pageId: replacementPageId,
      seq: 0,
      role: 'assistant',
      content: 'Replacement live reply',
      contentFormat: 'text',
      tokenCount: 4,
      isHidden: false,
      source: null,
      createdAt: NOW + 2,
    }).run();

    const result = serializeThChatForAccount(db, sessionId);

    expect(result.data.floors).toHaveLength(2);
    expect(result.data.floors[0]).toMatchObject({
      _original_id: floorId,
      superseded_at: NOW + 1,
      superseded_by_floor_id_ref: replacementFloorId,
    });
    expect(result.data.floors[0]!.pages[0]!.messages[0]!.content).toBe('Hello World');
    expect(result.data.floors[1]).toMatchObject({
      _original_id: replacementFloorId,
      superseded_at: null,
      superseded_by_floor_id_ref: null,
    });
    expect(result.data.floors[1]!.pages[0]!.messages[0]!.content).toBe('Replacement live reply');
  });

  it('throws on non-existent session', () => {
    expect(() => serializeThChatForAccount(db, 'nonexistent')).toThrow('Session not found');
  });

  it('rejects missing account context in multi-account mode', () => {
    const { sessionId } = seedMinimalSession(db);

    expect(() => serializeSessionToThChat(db, sessionId, { accountMode: 'multi' })).toThrow(MissingAccountContextError);
  });

  it('excludes variables when includeVariables=false', () => {
    const { sessionId } = seedMinimalSession(db);

    // 插入一个变量
    db.insert(variables).values({
      id: nanoid(),
      accountId: ACCOUNT_ID,
      scope: 'chat',
      scopeId: sessionId,
      key: 'test_var',
      valueJson: JSON.stringify(42),
      updatedAt: NOW,
    }).run();

    const withVars = serializeThChatForAccount(db, sessionId, { includeVariables: true });
    expect(withVars.data.variables).toHaveLength(1);

    const withoutVars = serializeThChatForAccount(db, sessionId, { includeVariables: false });
    expect(withoutVars.data.variables).toBeUndefined();
  });

  it('filters exported variables by account', () => {
    const { sessionId } = seedMinimalSession(db);
    const branchScopeId = buildBranchVariableScopeId(sessionId, 'main');

    db.insert(accounts).values({
      id: 'account-b',
      name: 'Account B',
      createdAt: NOW,
      updatedAt: NOW,
    }).run();

    db.insert(variables).values([
      {
        id: nanoid(),
        accountId: ACCOUNT_ID,
        scope: 'chat',
        scopeId: sessionId,
        key: 'local_var',
        valueJson: JSON.stringify(42),
        updatedAt: NOW,
      },
      {
        id: nanoid(),
        accountId: ACCOUNT_ID,
        scope: 'branch',
        scopeId: branchScopeId,
        key: 'branch_var',
        valueJson: JSON.stringify('campfire'),
        updatedAt: NOW,
      },
      {
        id: nanoid(),
        accountId: 'account-b',
        scope: 'chat',
        scopeId: sessionId,
        key: 'foreign_var',
        valueJson: JSON.stringify(99),
        updatedAt: NOW,
      },
    ]).run();

    const result = serializeThChatForAccount(db, sessionId, { includeVariables: true });
    expect(result.data.variables).toEqual([
      { scope: 'chat', scope_id_ref: null, key: 'local_var', value: 42, updated_at: NOW },
      {
        scope: 'branch',
        scope_id_ref: 'main',
        key: 'branch_var',
        value: 'campfire',
        updated_at: NOW,
      },
    ]);
  });

  it('exports memory v2 metadata and extended relations in thchat format', () => {
    const { sessionId, floorId, msg1Id } = seedMinimalSession(db);
    const microMemoryId = nanoid();
    const branchMemoryId = nanoid();
    const macroMemoryId = nanoid();

    db.insert(memoryItems).values([
      {
        id: microMemoryId,
        accountId: ACCOUNT_ID,
        scope: 'chat',
        scopeId: sessionId,
        type: 'summary',
        summaryTier: 'micro',
        contentJson: JSON.stringify({ text: 'micro summary' }),
        factKey: null,
        importance: 0.6,
        confidence: 1,
        sourceFloorId: floorId,
        sourceMessageId: msg1Id,
        status: 'active',
        lifecycleStatus: 'active',
        sourceJobId: 'memory-job:ingest_turn:floor-1',
        tokenCountEstimate: 48,
        lastUsedAt: NOW + 1,
        coverageStartFloorNo: 0,
        coverageEndFloorNo: 0,
        derivedFromCount: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: branchMemoryId,
        accountId: ACCOUNT_ID,
        scope: 'branch',
        scopeId: buildBranchMemoryScopeId(sessionId, 'main'),
        type: 'fact',
        summaryTier: null,
        contentJson: JSON.stringify({ text: 'branch fact' }),
        factKey: 'branch_fact',
        importance: 0.7,
        confidence: 1,
        sourceFloorId: floorId,
        sourceMessageId: msg1Id,
        status: 'active',
        lifecycleStatus: 'active',
        sourceJobId: 'memory-job:ingest_turn:floor-1',
        tokenCountEstimate: 32,
        lastUsedAt: NOW + 1,
        coverageStartFloorNo: null,
        coverageEndFloorNo: null,
        derivedFromCount: null,
        createdAt: NOW,
        updatedAt: NOW + 5,
      },
      {
        id: macroMemoryId,
        accountId: ACCOUNT_ID,
        scope: 'chat',
        scopeId: sessionId,
        type: 'summary',
        summaryTier: 'macro',
        contentJson: JSON.stringify({ text: 'macro summary' }),
        factKey: null,
        importance: 0.9,
        confidence: 1,
        sourceFloorId: floorId,
        sourceMessageId: msg1Id,
        status: 'active',
        lifecycleStatus: 'compacted',
        sourceJobId: 'memory-job:compact_macro:chat:session-1:scope-micro-3',
        tokenCountEstimate: 96,
        lastUsedAt: NOW + 2,
        coverageStartFloorNo: 0,
        coverageEndFloorNo: 4,
        derivedFromCount: 3,
        createdAt: NOW,
        updatedAt: NOW + 10,
      },
    ]).run();

    db.insert(memoryEdges).values({
      id: nanoid(),
      accountId: ACCOUNT_ID,
      fromId: macroMemoryId,
      toId: microMemoryId,
      relation: 'derived_from',
      createdAt: NOW + 10,
    }).run();

    const result = serializeThChatForAccount(db, sessionId, { includeMemories: true });

    expect(result.data.memories).toEqual({
      items: expect.arrayContaining([
        expect.objectContaining({ _original_id: microMemoryId, summary_tier: 'micro', lifecycle_status: 'active', source_job_id: 'memory-job:ingest_turn:floor-1', token_count_estimate: 48 }),
        expect.objectContaining({ _original_id: branchMemoryId, scope: 'branch', scope_id_ref: 'main', type: 'fact', content: { text: 'branch fact' } }),
        expect.objectContaining({ _original_id: macroMemoryId, summary_tier: 'macro', lifecycle_status: 'compacted', source_job_id: 'memory-job:compact_macro:chat:session-1:scope-micro-3', coverage_start_floor_no: 0, coverage_end_floor_no: 4, derived_from_count: 3 }),
      ]),
      edges: [
        expect.objectContaining({ from_id_ref: macroMemoryId, to_id_ref: microMemoryId, relation: 'derived_from' }),
      ],
    });
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
    const jsonl = serializeStJsonlForAccount(db, sessionId);
    const lines = jsonl.split('\n');
    const header = JSON.parse(lines[0]!);

    expect(header.user_name).toBe('Bob');
    expect(header.character_name).toBe('Alice');
    expect(header.chat_metadata.th_export).toBe(true);
  });

  it('outputs message lines with correct fields', () => {
    const { sessionId } = seedMinimalSession(db);
    const jsonl = serializeStJsonlForAccount(db, sessionId);
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
    const jsonl = serializeStJsonlForAccount(db, sessionId);
    const lines = jsonl.split('\n');
    const msg = JSON.parse(lines[1]!);

    expect(msg.swipes).toEqual(['Hello World', 'Hi there']);
    expect(msg.swipe_id).toBe(0); // version 1 is active
  });

  it('omits superseded floors from st jsonl export', () => {
    const { sessionId, floorId } = seedMinimalSession(db);
    const replacementFloorId = nanoid();
    const replacementPageId = nanoid();

    db.update(floors)
      .set({ supersededAt: NOW + 1, supersededByFloorId: replacementFloorId, updatedAt: NOW + 1 })
      .where(eq(floors.id, floorId))
      .run();

    db.insert(floors).values({
      id: replacementFloorId,
      sessionId,
      floorNo: 0,
      branchId: 'main',
      parentFloorId: floorId,
      state: 'committed',
      tokenIn: 0,
      tokenOut: 0,
      createdAt: NOW + 2,
      updatedAt: NOW + 2,
    }).run();

    db.insert(messagePages).values({
      id: replacementPageId,
      floorId: replacementFloorId,
      pageNo: 0,
      pageKind: 'output',
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: NOW + 2,
      updatedAt: NOW + 2,
    }).run();

    db.insert(messages).values({
      id: nanoid(),
      pageId: replacementPageId,
      seq: 0,
      role: 'assistant',
      content: 'Replacement live reply',
      contentFormat: 'text',
      tokenCount: 4,
      isHidden: false,
      source: null,
      createdAt: NOW + 2,
    }).run();

    const jsonl = serializeStJsonlForAccount(db, sessionId);
    expect(jsonl).toContain('Replacement live reply');
    expect(jsonl).not.toContain('Hello World');
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

    const jsonl = serializeStJsonlForAccount(db, sessionId);
    const lines = jsonl.split('\n');

    // header + 1 msg from main branch only
    expect(lines).toHaveLength(2);
    expect(lines[1]).not.toContain('Branch message');
  });

  it('throws on non-existent session', () => {
    expect(() => serializeStJsonlForAccount(db, 'nonexistent')).toThrow('Session not found');
  });

  it('throws when the session belongs to another account', () => {
    const { sessionId } = seedMinimalSession(db);

    expect(() => serializeStJsonlForAccount(db, sessionId, { accountId: 'account-b' })).toThrow('Session not found');
  });
});
