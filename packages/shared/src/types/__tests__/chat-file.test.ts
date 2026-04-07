import { describe, it, expect } from 'vitest';
import {
  TH_CHAT_SPEC,
  TH_CHAT_SPEC_VERSION,
  thChatFileSchema,
  thChatFloorSchema,
  thChatPageSchema,
  thChatMessageSchema,
} from '../chat-file.js';

// ── Helper ─────────────────────────────────────────

function makeMinimalMessage(overrides?: Record<string, unknown>) {
  return {
    seq: 0,
    role: 'assistant',
    content: 'Hello',
    content_format: 'text',
    token_count: 2,
    is_hidden: false,
    source: null,
    created_at: 1700000000000,
    _original_id: 'msg_001',
    ...overrides,
  };
}

function makeMinimalPage(overrides?: Record<string, unknown>) {
  return {
    page_no: 0,
    page_kind: 'output',
    is_active: true,
    version: 1,
    checksum: null,
    created_at: 1700000000000,
    updated_at: 1700000000000,
    _original_id: 'page_001',
    messages: [makeMinimalMessage()],
    ...overrides,
  };
}

function makeMinimalFloor(overrides?: Record<string, unknown>) {
  return {
    floor_no: 0,
    branch_id: 'main',
    parent_floor_id_ref: null,
    state: 'committed',
    token_in: 0,
    token_out: 10,
    metadata: null,
    created_at: 1700000000000,
    updated_at: 1700000000000,
    _original_id: 'floor_001',
    pages: [makeMinimalPage()],
    ...overrides,
  };
}

function makeMinimalFile(overrides?: Record<string, unknown>) {
  return {
    spec: TH_CHAT_SPEC,
    spec_version: TH_CHAT_SPEC_VERSION,
    exported_at: 1700000000000,
    data: {
      title: 'Test Chat',
      status: 'active',
      created_at: 1700000000000,
      updated_at: 1700000000000,
      character_snapshot: null,
      user_snapshot: null,
      character_sync_policy: 'pin',
      floors: [makeMinimalFloor()],
    },
    ...overrides,
  };
}

// ── thChatFileSchema ───────────────────────────────

describe('thChatFileSchema', () => {
  it('validates a complete minimal file', () => {
    const result = thChatFileSchema.safeParse(makeMinimalFile());
    expect(result.success).toBe(true);
  });

  it('rejects missing spec field', () => {
    const file = makeMinimalFile();
    delete (file as Record<string, unknown>).spec;
    const result = thChatFileSchema.safeParse(file);
    expect(result.success).toBe(false);
  });

  it('rejects wrong spec value', () => {
    const result = thChatFileSchema.safeParse(makeMinimalFile({ spec: 'wrong' }));
    expect(result.success).toBe(false);
  });

  it('rejects missing spec_version', () => {
    const file = makeMinimalFile();
    delete (file as Record<string, unknown>).spec_version;
    const result = thChatFileSchema.safeParse(file);
    expect(result.success).toBe(false);
  });

  it('accepts empty floors array', () => {
    const file = makeMinimalFile();
    (file.data as Record<string, unknown>).floors = [];
    const result = thChatFileSchema.safeParse(file);
    expect(result.success).toBe(true);
  });

  it('accepts optional variables', () => {
    const file = makeMinimalFile();
    (file.data as Record<string, unknown>).variables = [
      { scope: 'chat', scope_id_ref: null, key: 'test', value: 42, updated_at: 1700000000000 },
      { scope: 'branch', scope_id_ref: 'alt-1', key: 'route', value: 'branch-only', updated_at: 1700000000001 },
    ];
    const result = thChatFileSchema.safeParse(file);
    expect(result.success).toBe(true);
  });

  it('accepts memory v2 metadata and extended edge relations', () => {
    const file = makeMinimalFile();
    (file.data as Record<string, unknown>).memories = {
      items: [{
        _original_id: 'mem_001',
        scope: 'chat',
        scope_id_ref: null,
        type: 'summary',
        summary_tier: 'macro',
        content: { text: 'macro summary' },
        importance: 0.8,
        confidence: 1.0,
        source_floor_id_ref: null,
        source_message_id_ref: null,
        status: 'active',
        lifecycle_status: 'compacted',
        source_job_id: 'memory-job:compact_macro:session-1:mem-3',
        token_count_estimate: 128,
        last_used_at: 1700000000100,
        coverage_start_floor_no: 1,
        coverage_end_floor_no: 6,
        derived_from_count: 3,
        created_at: 1700000000000,
        updated_at: 1700000000200,
      }],
      edges: [{
        from_id_ref: 'mem_001',
        to_id_ref: 'mem_002',
        relation: 'derived_from',
        created_at: 1700000000200,
      }],
    };
    const result = thChatFileSchema.safeParse(file);
    expect(result.success).toBe(true);
  });

  it('passes without variables or memories', () => {
    const result = thChatFileSchema.safeParse(makeMinimalFile());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data.variables).toBeUndefined();
      expect(result.data.data.memories).toBeUndefined();
    }
  });
});

// ── thChatFloorSchema ──────────────────────────────

describe('thChatFloorSchema', () => {
  it('rejects invalid state', () => {
    const result = thChatFloorSchema.safeParse(makeMinimalFloor({ state: 'unknown' }));
    expect(result.success).toBe(false);
  });

  it('rejects missing _original_id', () => {
    const floor = makeMinimalFloor();
    delete (floor as Record<string, unknown>)._original_id;
    const result = thChatFloorSchema.safeParse(floor);
    expect(result.success).toBe(false);
  });

  it('accepts optional superseded floor linkage fields', () => {
    const result = thChatFloorSchema.safeParse(makeMinimalFloor({
      superseded_at: 1700000000100,
      superseded_by_floor_id_ref: 'floor_002',
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.superseded_at).toBe(1700000000100);
      expect(result.data.superseded_by_floor_id_ref).toBe('floor_002');
    }
  });
});

// ── thChatPageSchema ───────────────────────────────

describe('thChatPageSchema', () => {
  it('rejects missing _original_id', () => {
    const page = makeMinimalPage();
    delete (page as Record<string, unknown>)._original_id;
    const result = thChatPageSchema.safeParse(page);
    expect(result.success).toBe(false);
  });
});

// ── thChatMessageSchema ────────────────────────────

describe('thChatMessageSchema', () => {
  it('rejects invalid role', () => {
    const result = thChatMessageSchema.safeParse(makeMinimalMessage({ role: 'invalid' }));
    expect(result.success).toBe(false);
  });

  it('rejects missing _original_id', () => {
    const msg = makeMinimalMessage();
    delete (msg as Record<string, unknown>)._original_id;
    const result = thChatMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('accepts all valid roles', () => {
    for (const role of ['user', 'assistant', 'system', 'narrator']) {
      const result = thChatMessageSchema.safeParse(makeMinimalMessage({ role }));
      expect(result.success).toBe(true);
    }
  });
});
