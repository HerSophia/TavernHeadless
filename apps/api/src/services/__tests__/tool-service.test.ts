import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createDatabase, type AppDb } from '../../db/client.js';
import { accounts } from '../../db/schema.js';
import { ToolService, type CreateDefinitionInput } from '../tool-service.js';
import { DEFAULT_ADMIN_ACCOUNT_ID } from '../../accounts/constants.js';

// ── helpers ──────────────────────────────────────────────

function makeInput(overrides?: Partial<CreateDefinitionInput>): CreateDefinitionInput {
  return {
    name: 'test_tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: { x: { type: 'number' } } },
    side_effect_level: 'none',
    allowed_slots: ['narrator'],
    source: 'custom',
    handler_type: 'script',
    handler: { script: 'return args.x' },
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────

describe('ToolService', () => {
  let db: AppDb;
  let closeDb: () => void;
  let service: ToolService;

  beforeEach(async () => {
    const conn = createDatabase(':memory:');
    db = conn.db;
    closeDb = conn.close;

    const now = Date.now();
    await db.insert(accounts).values({
      id: 'acc-other',
      name: 'Other Account',
      role: 'user',
      status: 'active',
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });

    service = new ToolService(db);
  });

  afterEach(() => {
    closeDb();
  });

  // ── builtin tools ──────────────────────────────────

  describe('listBuiltinTools', () => {
    it('returns a non-empty list of builtin tools', async () => {
      const tools = await service.listBuiltinTools();
      expect(tools.length).toBeGreaterThan(0);
      for (const t of tools) {
        expect(t.source).toBe('builtin');
        expect(t.name).toBeTruthy();
      }
    });
  });

  // ── CRUD ───────────────────────────────────────────

  describe('createDefinition', () => {
    it('creates and returns a tool definition', async () => {
      const result = await service.createDefinition(makeInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      expect(result.id).toBeTruthy();
      expect(result.name).toBe('test_tool');
      expect(result.description).toBe('A test tool');
      expect(result.side_effect_level).toBe('none');
      expect(result.handler_type).toBe('script');
      expect(result.enabled).toBe(true);
    });
  });

  describe('getDefinition', () => {
    it('returns null for non-existent id', async () => {
      const result = await service.getDefinition('nope', DEFAULT_ADMIN_ACCOUNT_ID);
      expect(result).toBeNull();
    });

    it('returns created definition by id', async () => {
      const created = await service.createDefinition(makeInput(), DEFAULT_ADMIN_ACCOUNT_ID);
      const fetched = await service.getDefinition(created.id, DEFAULT_ADMIN_ACCOUNT_ID);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe('test_tool');
    });

    it('returns null when definition belongs to another account', async () => {
      const created = await service.createDefinition(makeInput(), DEFAULT_ADMIN_ACCOUNT_ID);
      const fetched = await service.getDefinition(created.id, 'acc-other');

      expect(fetched).toBeNull();
    });
  });

  describe('listDefinitions', () => {
    it('lists definitions with pagination', async () => {
      await service.createDefinition(makeInput({ name: 'tool_a' }), DEFAULT_ADMIN_ACCOUNT_ID);
      await service.createDefinition(makeInput({ name: 'tool_b' }), DEFAULT_ADMIN_ACCOUNT_ID);

      const result = await service.listDefinitions({ accountId: DEFAULT_ADMIN_ACCOUNT_ID });
      expect(result.definitions).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe('updateDefinition', () => {
    it('updates name and description', async () => {
      const created = await service.createDefinition(makeInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      const updated = await service.updateDefinition(created.id, DEFAULT_ADMIN_ACCOUNT_ID, {
        name: 'renamed_tool',
        description: 'Updated description',
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('renamed_tool');
      expect(updated!.description).toBe('Updated description');
    });

    it('updates parameters and side_effect_level', async () => {
      const created = await service.createDefinition(makeInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      const updated = await service.updateDefinition(created.id, DEFAULT_ADMIN_ACCOUNT_ID, {
        parameters: { type: 'object', properties: { y: { type: 'string' } } },
        side_effect_level: 'sandbox',
      });

      expect(updated!.side_effect_level).toBe('sandbox');
    });

    it('updates allowed_slots, source, source_id, handler_type, handler', async () => {
      const created = await service.createDefinition(makeInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      const updated = await service.updateDefinition(created.id, DEFAULT_ADMIN_ACCOUNT_ID, {
        allowed_slots: ['director'],
        source: 'preset',
        source_id: 'preset-123',
        handler_type: 'prompt',
        handler: { prompt: 'do something' },
      });

      expect(updated!.source).toBe('preset');
      expect(updated!.source_id).toBe('preset-123');
      expect(updated!.handler_type).toBe('prompt');
    });

    it('returns unchanged definition when no fields are provided', async () => {
      const created = await service.createDefinition(makeInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      const result = await service.updateDefinition(created.id, DEFAULT_ADMIN_ACCOUNT_ID, {});
      expect(result!.name).toBe(created.name);
    });

    it('returns null for non-existent id', async () => {
      const result = await service.updateDefinition('nope', DEFAULT_ADMIN_ACCOUNT_ID, { name: 'x' });
      expect(result).toBeNull();
    });
  });

  describe('deleteDefinition', () => {
    it('deletes existing definition', async () => {
      const created = await service.createDefinition(makeInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      const ok = await service.deleteDefinition(created.id, DEFAULT_ADMIN_ACCOUNT_ID);
      expect(ok).toBe(true);

      const fetched = await service.getDefinition(created.id, DEFAULT_ADMIN_ACCOUNT_ID);
      expect(fetched).toBeNull();
    });

    it('returns false for non-existent id', async () => {
      const ok = await service.deleteDefinition('nope', DEFAULT_ADMIN_ACCOUNT_ID);
      expect(ok).toBe(false);
    });
  });

  describe('toggleDefinition', () => {
    it('toggles enabled flag', async () => {
      const created = await service.createDefinition(makeInput(), DEFAULT_ADMIN_ACCOUNT_ID);
      expect(created.enabled).toBe(true);

      const disabled = await service.toggleDefinition(created.id, DEFAULT_ADMIN_ACCOUNT_ID, false);
      expect(disabled!.enabled).toBe(false);

      const enabled = await service.toggleDefinition(created.id, DEFAULT_ADMIN_ACCOUNT_ID, true);
      expect(enabled!.enabled).toBe(true);
    });

    it('returns null for non-existent id', async () => {
      const result = await service.toggleDefinition('nope', DEFAULT_ADMIN_ACCOUNT_ID, true);
      expect(result).toBeNull();
    });
  });

  // ── call records ───────────────────────────────────

  describe('queryCallRecords', () => {
    it('returns empty list when no records exist', async () => {
      const result = await service.queryCallRecords({ accountId: DEFAULT_ADMIN_ACCOUNT_ID });
      expect(result.records).toEqual([]);
      expect(result.total).toBe(0);
    });
  });
});
