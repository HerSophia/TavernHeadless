import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

import * as retryModule from '../../lib/retry.js';
import { createDatabase, type AppDb } from '../../db/client.js';
import {
  characters,
  characterVersions,
  presets,
  worldbooks,
  worldbookEntries,
  regexProfiles,
  accounts,
} from '../../db/schema.js';
import { ResourceToolProvider } from '../resource-tool-provider.js';
import type { ToolExecutionContext } from '@tavern/core';

// ── Helpers ──────────────────────────────────────────────

const ACCOUNT_A = 'account-a';
const ACCOUNT_B = 'account-b';

function makeContext(accountId: string = ACCOUNT_A): ToolExecutionContext {
  return {
    sessionId: 'sess-1',
    accountId,
    floorId: 'floor-1',
    pageId: 'page-1',
    callerSlot: 'narrator',
    variableContext: {
      sessionId: 'sess-1',
      floorId: 'floor-1',
      pageId: 'page-1',
    },
  };
}

function makeContextWithoutAccountId(): ToolExecutionContext {
  return {
    sessionId: 'sess-1',
    floorId: 'floor-1',
    pageId: 'page-1',
    callerSlot: 'narrator',
    variableContext: {
      sessionId: 'sess-1',
      floorId: 'floor-1',
      pageId: 'page-1',
    },
  };
}

describe('ResourceToolProvider', () => {
  let db: AppDb;
  let closeDb: () => void;
  let provider: ResourceToolProvider;

  beforeEach(async () => {
    const conn = createDatabase(':memory:');
    db = conn.db;
    closeDb = conn.close;
    provider = new ResourceToolProvider(db);

    // 插入测试用账户
    const now = Date.now();
    await db.insert(accounts).values([
      { id: ACCOUNT_A, name: 'Test A', role: 'admin', status: 'active', isDefault: true, createdAt: now, updatedAt: now },
      { id: ACCOUNT_B, name: 'Test B', role: 'user', status: 'active', isDefault: false, createdAt: now, updatedAt: now },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDb();
  });

  // ── listTools ──────────────────────────────────────────

  it('lists 23 resource tools', async () => {
    const tools = await provider.listTools();
    expect(tools).toHaveLength(23);
    const names = tools.map((t) => t.name);
    expect(names).toContain('create_character');
    expect(names).toContain('update_character');
    expect(names).toContain('get_character');
    expect(names).toContain('list_characters');
    expect(names).toContain('create_worldbook');
    expect(names).toContain('create_worldbook_entry');
    expect(names).toContain('update_worldbook_entry');
    expect(names).toContain('get_worldbook');
    expect(names).toContain('list_worldbooks');
    expect(names).toContain('create_regex_rule');
    expect(names).toContain('update_regex_rule');
    expect(names).toContain('get_regex_profile');
    // Batch 3
    expect(names).toContain('list_regex_profiles');
    expect(names).toContain('list_presets');
    expect(names).toContain('list_worldbook_entries');
    expect(names).toContain('list_character_versions');
    expect(names).toContain('get_worldbook_entry');
    expect(names).toContain('get_regex_rule');
    expect(names).toContain('get_preset');
    expect(names).toContain('get_preset_entry');
    expect(names).toContain('create_regex_profile');
    expect(names).toContain('create_preset_entry');
    expect(names).toContain('update_preset_entry');
  });

  // ── Unknown tool ───────────────────────────────────────

  it('returns error for unknown tool name', async () => {
    const result = await provider.executeTool('nonexistent_tool', {}, makeContext());
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Unknown resource tool');
  });

  // ── Missing accountId ─────────────────────────────────

  it('returns error when accountId is missing', async () => {
    const result = await provider.executeTool('list_characters', {}, makeContextWithoutAccountId());
    expect(result.error).toBeDefined();
    expect(result.error).toContain('accountId');
  });

  // ── Character tools ───────────────────────────────────

  describe('create_character', () => {
    it('creates a character with version', async () => {
      const result = await provider.executeTool(
        'create_character',
        { name: 'Alice', description: 'A brave adventurer', first_mes: 'Hello!' },
        makeContext(),
      );

      expect(result.error).toBeUndefined();
      const data = result.data as Record<string, unknown>;
      expect(data.character_id).toBeDefined();
      expect(data.version_id).toBeDefined();
      expect(data.name).toBe('Alice');

      // Verify DB
      const [charRow] = await db.select().from(characters).limit(1);
      expect(charRow!.name).toBe('Alice');
      expect(charRow!.source).toBe('tool');
      expect(charRow!.accountId).toBe(ACCOUNT_A);
      expect(charRow!.latestVersionNo).toBe(1);
      expect(charRow!.revision).toBe(0);

      const [versionRow] = await db.select().from(characterVersions).limit(1);
      expect(versionRow!.versionNo).toBe(1);
      const snapshot = JSON.parse(versionRow!.dataJson);
      expect(snapshot.name).toBe('Alice');
      expect(snapshot.description).toBe('A brave adventurer');
      expect(snapshot.greeting).toBe('Hello!');
    });

    it('returns error when name is missing', async () => {
      const result = await provider.executeTool(
        'create_character',
        {},
        makeContext(),
      );
      expect(result.error).toContain('name');
    });

    it('returns error when name is empty string', async () => {
      const result = await provider.executeTool(
        'create_character',
        { name: '   ' },
        makeContext(),
      );
      expect(result.error).toContain('name');
    });

    it('returns a busy message when sqlite write retry is exhausted', async () => {
      vi.spyOn(retryModule, 'executeWithSqliteBusyRetry').mockRejectedValueOnce(
        new retryModule.ResourceBusyError('database is locked'),
      );

      const result = await provider.executeTool('create_character', { name: 'Busy Alice' }, makeContext());

      expect(result.error).toBe('Resource is temporarily busy, please retry');
    });
  });

  describe('update_character', () => {
    let characterId: string;

    beforeEach(async () => {
      const result = await provider.executeTool(
        'create_character',
        { name: 'Bob', description: 'Original desc', first_mes: 'Hi' },
        makeContext(),
      );
      characterId = (result.data as Record<string, unknown>).character_id as string;
    });

    it('creates a new version with merged snapshot', async () => {
      const result = await provider.executeTool(
        'update_character',
        { character_id: characterId, description: 'Updated desc', personality: 'Brave' },
        makeContext(),
      );

      expect(result.error).toBeUndefined();
      const data = result.data as Record<string, unknown>;
      expect(data.version_no).toBe(2);

      // Verify the new version has merged fields
      const versions = await db.select().from(characterVersions);
      expect(versions).toHaveLength(2);

      const latestSnapshot = JSON.parse(versions[1]!.dataJson);
      expect(latestSnapshot.description).toBe('Updated desc');
      expect(latestSnapshot.personality).toBe('Brave');
      // Preserved from original
      expect(latestSnapshot.greeting).toBe('Hi');
      expect(latestSnapshot.name).toBe('Bob');

      const [charRow] = await db.select().from(characters).where(eq(characters.id, characterId)).limit(1);
      expect(charRow!.latestVersionNo).toBe(2);
      expect(charRow!.revision).toBe(1);
    });

    it('updates character name when changed', async () => {
      await provider.executeTool(
        'update_character',
        { character_id: characterId, name: 'Bobby' },
        makeContext(),
      );

      const [charRow] = await db.select().from(characters).limit(1);
      expect(charRow!.name).toBe('Bobby');
    });

    it('returns error for nonexistent character', async () => {
      const result = await provider.executeTool(
        'update_character',
        { character_id: 'nonexistent', description: 'Fail' },
        makeContext(),
      );
      expect(result.error).toContain('not found');
    });

    it('returns error when character_id is missing', async () => {
      const result = await provider.executeTool(
        'update_character',
        { description: 'Fail' },
        makeContext(),
      );
      expect(result.error).toContain('character_id');
    });
  });

  describe('get_character', () => {
    it('returns character with latest snapshot', async () => {
      const createResult = await provider.executeTool(
        'create_character',
        { name: 'Charlie', description: 'Desc', first_mes: 'Greetings' },
        makeContext(),
      );
      const charId = (createResult.data as Record<string, unknown>).character_id as string;

      const result = await provider.executeTool(
        'get_character',
        { character_id: charId },
        makeContext(),
      );

      expect(result.error).toBeUndefined();
      const data = result.data as Record<string, unknown>;
      expect(data.name).toBe('Charlie');
      expect(data.latest_version_no).toBe(1);

      const snapshot = data.snapshot as Record<string, unknown>;
      expect(snapshot.first_mes).toBe('Greetings');
      expect(snapshot.description).toBe('Desc');
    });

    it('returns error for nonexistent character', async () => {
      const result = await provider.executeTool(
        'get_character',
        { character_id: 'nonexistent' },
        makeContext(),
      );
      expect(result.error).toContain('not found');
    });
  });

  describe('list_characters', () => {
    it('lists characters for account', async () => {
      await provider.executeTool('create_character', { name: 'Alice' }, makeContext());
      await provider.executeTool('create_character', { name: 'Bob' }, makeContext());

      const result = await provider.executeTool('list_characters', {}, makeContext());
      expect(result.error).toBeUndefined();
      const data = result.data as Array<Record<string, unknown>>;
      expect(data).toHaveLength(2);
    });

    it('supports keyword filtering', async () => {
      await provider.executeTool('create_character', { name: 'Alice Wonderland' }, makeContext());
      await provider.executeTool('create_character', { name: 'Bob Builder' }, makeContext());

      const result = await provider.executeTool(
        'list_characters',
        { keyword: 'Alice' },
        makeContext(),
      );
      const data = result.data as Array<Record<string, unknown>>;
      expect(data).toHaveLength(1);
      expect(data[0]!.name).toBe('Alice Wonderland');
    });
  });

  // ── accountId isolation ─────────────────────────────

  describe('accountId isolation', () => {
    it('account A cannot read account B characters', async () => {
      // Create as A
      const createResult = await provider.executeTool(
        'create_character',
        { name: 'Secret' },
        makeContext(ACCOUNT_A),
      );
      const charId = (createResult.data as Record<string, unknown>).character_id as string;

      // Read as B
      const result = await provider.executeTool(
        'get_character',
        { character_id: charId },
        makeContext(ACCOUNT_B),
      );
      expect(result.error).toContain('not found');
    });

    it('account A cannot update account B characters', async () => {
      const createResult = await provider.executeTool(
        'create_character',
        { name: 'Secret' },
        makeContext(ACCOUNT_A),
      );
      const charId = (createResult.data as Record<string, unknown>).character_id as string;

      const result = await provider.executeTool(
        'update_character',
        { character_id: charId, name: 'Hacked' },
        makeContext(ACCOUNT_B),
      );
      expect(result.error).toContain('not found');
    });

    it('list_characters only shows own characters', async () => {
      await provider.executeTool('create_character', { name: 'Char A' }, makeContext(ACCOUNT_A));
      await provider.executeTool('create_character', { name: 'Char B' }, makeContext(ACCOUNT_B));

      const resultA = await provider.executeTool('list_characters', {}, makeContext(ACCOUNT_A));
      const resultB = await provider.executeTool('list_characters', {}, makeContext(ACCOUNT_B));

      expect((resultA.data as unknown[]).length).toBe(1);
      expect((resultB.data as unknown[]).length).toBe(1);
    });
  });

  // ── Worldbook tools ───────────────────────────────────

  describe('create_worldbook', () => {
    it('creates a worldbook', async () => {
      const result = await provider.executeTool(
        'create_worldbook',
        { name: 'My World' },
        makeContext(),
      );

      expect(result.error).toBeUndefined();
      const data = result.data as Record<string, unknown>;
      expect(data.id).toBeDefined();
      expect(data.name).toBe('My World');

      const [row] = await db.select().from(worldbooks).limit(1);
      expect(row!.name).toBe('My World');
      expect(row!.source).toBe('tool');
      expect(row!.accountId).toBe(ACCOUNT_A);
    });

    it('returns error when name is missing', async () => {
      const result = await provider.executeTool('create_worldbook', {}, makeContext());
      expect(result.error).toContain('name');
    });
  });

  describe('create_worldbook_entry', () => {
    let worldbookId: string;

    beforeEach(async () => {
      const result = await provider.executeTool(
        'create_worldbook',
        { name: 'Test WB' },
        makeContext(),
      );
      worldbookId = (result.data as Record<string, unknown>).id as string;
    });

    it('creates entry with auto-incrementing uid', async () => {
      const result1 = await provider.executeTool(
        'create_worldbook_entry',
        { worldbook_id: worldbookId, keys: ['dragon'], content: 'A fire-breathing creature' },
        makeContext(),
      );
      expect(result1.error).toBeUndefined();
      const data1 = result1.data as Record<string, unknown>;
      expect(data1.uid).toBe(0);

      const result2 = await provider.executeTool(
        'create_worldbook_entry',
        { worldbook_id: worldbookId, keys: ['elf'], content: 'Pointy ears' },
        makeContext(),
      );
      const data2 = result2.data as Record<string, unknown>;
      expect(data2.uid).toBe(1);
    });

    it('uses correct default values', async () => {
      await provider.executeTool(
        'create_worldbook_entry',
        { worldbook_id: worldbookId, keys: ['test'], content: 'Content' },
        makeContext(),
      );

      const [entry] = await db.select().from(worldbookEntries).limit(1);
      expect(entry!.selective).toBe(true);
      expect(entry!.selectiveLogic).toBe(0);
      expect(entry!.constant).toBe(false);
      expect(entry!.position).toBe(0);
      expect(entry!.order).toBe(100);
      expect(entry!.depth).toBe(4);
      expect(entry!.role).toBe(0);
      expect(entry!.disable).toBe(false);
    });

    it('returns error for nonexistent worldbook', async () => {
      const result = await provider.executeTool(
        'create_worldbook_entry',
        { worldbook_id: 'nonexistent', keys: ['a'], content: 'b' },
        makeContext(),
      );
      expect(result.error).toContain('not found');
    });

    it('returns error when keys is missing', async () => {
      const result = await provider.executeTool(
        'create_worldbook_entry',
        { worldbook_id: worldbookId, content: 'b' },
        makeContext(),
      );
      expect(result.error).toContain('keys');
    });

    it('returns error when content is missing', async () => {
      const result = await provider.executeTool(
        'create_worldbook_entry',
        { worldbook_id: worldbookId, keys: ['a'] },
        makeContext(),
      );
      expect(result.error).toContain('content');
    });
  });

  describe('update_worldbook_entry', () => {
    let worldbookId: string;
    let entryId: string;

    beforeEach(async () => {
      const wbResult = await provider.executeTool(
        'create_worldbook',
        { name: 'WB' },
        makeContext(),
      );
      worldbookId = (wbResult.data as Record<string, unknown>).id as string;

      const entryResult = await provider.executeTool(
        'create_worldbook_entry',
        { worldbook_id: worldbookId, keys: ['key1'], content: 'Original content', comment: 'My entry' },
        makeContext(),
      );
      entryId = (entryResult.data as Record<string, unknown>).id as string;
    });

    it('updates entry partially', async () => {
      const result = await provider.executeTool(
        'update_worldbook_entry',
        { worldbook_id: worldbookId, entry_id: entryId, content: 'Updated content' },
        makeContext(),
      );

      expect(result.error).toBeUndefined();
      const data = result.data as Record<string, unknown>;
      expect(data.content).toBe('Updated content');
      // Keys should be preserved
      expect(data.keys).toEqual(['key1']);
    });

    it('updates keys', async () => {
      const result = await provider.executeTool(
        'update_worldbook_entry',
        { worldbook_id: worldbookId, entry_id: entryId, keys: ['new_key'] },
        makeContext(),
      );

      expect(result.error).toBeUndefined();
      const data = result.data as Record<string, unknown>;
      expect(data.keys).toEqual(['new_key']);
    });

    it('returns error for nonexistent entry', async () => {
      const result = await provider.executeTool(
        'update_worldbook_entry',
        { worldbook_id: worldbookId, entry_id: 'nonexistent', content: 'Fail' },
        makeContext(),
      );
      expect(result.error).toContain('not found');
    });

    it('returns error when worldbook_id is missing', async () => {
      const result = await provider.executeTool(
        'update_worldbook_entry',
        { entry_id: entryId, content: 'Fail' },
        makeContext(),
      );
      expect(result.error).toContain('worldbook_id');
    });
  });

  describe('get_worldbook', () => {
    it('returns worldbook with entries', async () => {
      const wbResult = await provider.executeTool(
        'create_worldbook',
        { name: 'My WB' },
        makeContext(),
      );
      const wbId = (wbResult.data as Record<string, unknown>).id as string;

      await provider.executeTool(
        'create_worldbook_entry',
        { worldbook_id: wbId, keys: ['dragon'], content: 'Fire' },
        makeContext(),
      );
      await provider.executeTool(
        'create_worldbook_entry',
        { worldbook_id: wbId, keys: ['elf'], content: 'Forest' },
        makeContext(),
      );

      const result = await provider.executeTool(
        'get_worldbook',
        { worldbook_id: wbId },
        makeContext(),
      );

      expect(result.error).toBeUndefined();
      const data = result.data as Record<string, unknown>;
      expect(data.name).toBe('My WB');
      expect((data.entries as unknown[]).length).toBe(2);
    });

    it('returns error for nonexistent worldbook', async () => {
      const result = await provider.executeTool(
        'get_worldbook',
        { worldbook_id: 'nonexistent' },
        makeContext(),
      );
      expect(result.error).toContain('not found');
    });
  });

  describe('list_worldbooks', () => {
    it('lists worldbooks for account', async () => {
      await provider.executeTool('create_worldbook', { name: 'WB1' }, makeContext());
      await provider.executeTool('create_worldbook', { name: 'WB2' }, makeContext());

      const result = await provider.executeTool('list_worldbooks', {}, makeContext());
      expect(result.error).toBeUndefined();
      const data = result.data as Array<Record<string, unknown>>;
      expect(data).toHaveLength(2);
    });

    it('respects limit', async () => {
      await provider.executeTool('create_worldbook', { name: 'WB1' }, makeContext());
      await provider.executeTool('create_worldbook', { name: 'WB2' }, makeContext());
      await provider.executeTool('create_worldbook', { name: 'WB3' }, makeContext());

      const result = await provider.executeTool('list_worldbooks', { limit: 2 }, makeContext());
      const data = result.data as Array<Record<string, unknown>>;
      expect(data).toHaveLength(2);
    });
  });

  // ── Regex tools ───────────────────────────────────────

  describe('regex tools', () => {
    let profileId: string;

    beforeEach(async () => {
      // Manually insert a regex profile (normally done via import)
      profileId = nanoid();
      const now = Date.now();
      await db.insert(regexProfiles).values({
        id: profileId,
        name: 'Test Profile',
        source: 'tool',
        accountId: ACCOUNT_A,
        dataJson: '[]',
        createdAt: now,
        updatedAt: now,
      });
    });

    describe('create_regex_rule', () => {
      it('appends a rule to the profile', async () => {
        const result = await provider.executeTool(
          'create_regex_rule',
          {
            profile_id: profileId,
            script_name: 'Remove stars',
            find_regex: '\\*+',
            replace_string: '',
          },
          makeContext(),
        );

        expect(result.error).toBeUndefined();
        const data = result.data as Record<string, unknown>;
        expect(data.rule_index).toBe(0);
        expect(data.script_name).toBe('Remove stars');

        // Verify in DB
        const [profile] = await db.select().from(regexProfiles).limit(1);
        const scripts = JSON.parse(profile!.dataJson);
        expect(scripts).toHaveLength(1);
        expect(scripts[0].findRegex).toBe('\\*+');
        expect(scripts[0].placement).toEqual([2]); // default AI output
      });

      it('increments rule_index for subsequent rules', async () => {
        await provider.executeTool(
          'create_regex_rule',
          { profile_id: profileId, find_regex: 'a', replace_string: 'b' },
          makeContext(),
        );
        const result = await provider.executeTool(
          'create_regex_rule',
          { profile_id: profileId, find_regex: 'c', replace_string: 'd' },
          makeContext(),
        );
        const data = result.data as Record<string, unknown>;
        expect(data.rule_index).toBe(1);
      });

      it('returns error for nonexistent profile', async () => {
        const result = await provider.executeTool(
          'create_regex_rule',
          { profile_id: 'nonexistent', find_regex: 'a', replace_string: 'b' },
          makeContext(),
        );
        expect(result.error).toContain('not found');
      });

      it('returns error when find_regex is missing', async () => {
        const result = await provider.executeTool(
          'create_regex_rule',
          { profile_id: profileId, replace_string: 'b' },
          makeContext(),
        );
        expect(result.error).toContain('find_regex');
      });
    });

    describe('update_regex_rule', () => {
      beforeEach(async () => {
        await provider.executeTool(
          'create_regex_rule',
          { profile_id: profileId, script_name: 'Rule 0', find_regex: 'old', replace_string: 'new' },
          makeContext(),
        );
      });

      it('updates an existing rule', async () => {
        const result = await provider.executeTool(
          'update_regex_rule',
          { profile_id: profileId, rule_index: 0, find_regex: 'updated', script_name: 'Updated Rule' },
          makeContext(),
        );

        expect(result.error).toBeUndefined();
        const data = result.data as Record<string, unknown>;
        expect(data.find_regex).toBe('updated');
        expect(data.script_name).toBe('Updated Rule');

        // Verify preserved fields
        const [profile] = await db.select().from(regexProfiles).limit(1);
        const scripts = JSON.parse(profile!.dataJson);
        expect(scripts[0].replaceString).toBe('new'); // unchanged
      });

      it('returns error for out-of-range index', async () => {
        const result = await provider.executeTool(
          'update_regex_rule',
          { profile_id: profileId, rule_index: 99, find_regex: 'fail' },
          makeContext(),
        );
        expect(result.error).toContain('out of range');
      });

      it('returns error for negative index', async () => {
        const result = await provider.executeTool(
          'update_regex_rule',
          { profile_id: profileId, rule_index: -1, find_regex: 'fail' },
          makeContext(),
        );
        expect(result.error).toContain('non-negative');
      });
    });

    describe('get_regex_profile', () => {
      it('returns profile with rules', async () => {
        await provider.executeTool(
          'create_regex_rule',
          { profile_id: profileId, script_name: 'Rule A', find_regex: 'a', replace_string: 'b', placement: [1, 2] },
          makeContext(),
        );

        const result = await provider.executeTool(
          'get_regex_profile',
          { profile_id: profileId },
          makeContext(),
        );

        expect(result.error).toBeUndefined();
        const data = result.data as Record<string, unknown>;
        expect(data.name).toBe('Test Profile');
        const rules = data.rules as Array<Record<string, unknown>>;
        expect(rules).toHaveLength(1);
        expect(rules[0]!.index).toBe(0);
        expect(rules[0]!.script_name).toBe('Rule A');
        expect(rules[0]!.placement).toEqual([1, 2]);
      });

      it('returns error for nonexistent profile', async () => {
        const result = await provider.executeTool(
          'get_regex_profile',
          { profile_id: 'nonexistent' },
          makeContext(),
        );
        expect(result.error).toContain('not found');
      });

      it('respects accountId isolation', async () => {
        const result = await provider.executeTool(
          'get_regex_profile',
          { profile_id: profileId },
          makeContext(ACCOUNT_B),
        );
        expect(result.error).toContain('not found');
      });
    });
  });

  // ── Batch 3: list_regex_profiles ──────────────────────

  describe('list_regex_profiles', () => {
    beforeEach(async () => {
      const now = Date.now();
      await db.insert(regexProfiles).values([
        { id: 'rp-1', name: 'Profile One', source: 'tool', accountId: ACCOUNT_A, dataJson: '[]', createdAt: now, updatedAt: now },
        { id: 'rp-2', name: 'Profile Two', source: 'tool', accountId: ACCOUNT_A, dataJson: '[]', createdAt: now + 1, updatedAt: now + 1 },
        { id: 'rp-b', name: 'Profile B', source: 'tool', accountId: ACCOUNT_B, dataJson: '[]', createdAt: now, updatedAt: now },
      ]);
    });

    it('returns profiles for current account', async () => {
      const result = await provider.executeTool('list_regex_profiles', {}, makeContext());
      const data = result.data as any[];
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe('rp-2'); // most recently updated first
      expect(data[1].id).toBe('rp-1');
    });

    it('respects limit', async () => {
      const result = await provider.executeTool('list_regex_profiles', { limit: 1 }, makeContext());
      const data = result.data as any[];
      expect(data).toHaveLength(1);
    });

    it('accountId isolation', async () => {
      const result = await provider.executeTool('list_regex_profiles', {}, makeContext(ACCOUNT_B));
      const data = result.data as any[];
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('rp-b');
    });
  });

  // ── Batch 3: list_presets ─────────────────────────────

  describe('list_presets', () => {
    beforeEach(async () => {
      const now = Date.now();
      const minimalPresetJson = JSON.stringify({
        prompts: [{ identifier: 'main', role: 'system', content: 'Hello', name: 'Main', system_prompt: true, marker: false, injection_position: 0 }],
        prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }] }],
      });
      await db.insert(presets).values([
        { id: 'ps-1', name: 'Preset One', source: 'sillytavern', accountId: ACCOUNT_A, dataJson: minimalPresetJson, createdAt: now, updatedAt: now },
        { id: 'ps-2', name: 'Preset Two', source: 'tool', accountId: ACCOUNT_A, dataJson: minimalPresetJson, createdAt: now + 1, updatedAt: now + 1 },
        { id: 'ps-b', name: 'Preset B', source: 'tool', accountId: ACCOUNT_B, dataJson: minimalPresetJson, createdAt: now, updatedAt: now },
      ]);
    });

    it('returns presets for current account', async () => {
      const result = await provider.executeTool('list_presets', {}, makeContext());
      const data = result.data as any[];
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe('ps-2');
    });

    it('respects limit', async () => {
      const result = await provider.executeTool('list_presets', { limit: 1 }, makeContext());
      const data = result.data as any[];
      expect(data).toHaveLength(1);
    });

    it('accountId isolation', async () => {
      const result = await provider.executeTool('list_presets', {}, makeContext(ACCOUNT_B));
      const data = result.data as any[];
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('ps-b');
    });
  });

  // ── Batch 3: list_worldbook_entries ───────────────────

  describe('list_worldbook_entries', () => {
    let worldbookId: string;

    beforeEach(async () => {
      const wbResult = await provider.executeTool('create_worldbook', { name: 'WB Test' }, makeContext());
      worldbookId = (wbResult.data as any).id;
      await provider.executeTool('create_worldbook_entry', {
        worldbook_id: worldbookId, keys: ['k1'], content: 'Content One', comment: 'Entry One',
      }, makeContext());
      await provider.executeTool('create_worldbook_entry', {
        worldbook_id: worldbookId, keys: ['k2', 'k3'], content: 'Content Two', comment: 'Entry Two',
      }, makeContext());
    });

    it('returns entry summaries without content', async () => {
      const result = await provider.executeTool('list_worldbook_entries', { worldbook_id: worldbookId }, makeContext());
      const data = result.data as any;
      expect(data.worldbook_id).toBe(worldbookId);
      expect(data.worldbook_name).toBe('WB Test');
      expect(data.entries).toHaveLength(2);
      // Should NOT contain content field
      expect(data.entries[0]).not.toHaveProperty('content');
      expect(data.entries[0].comment).toBe('Entry One');
      expect(data.entries[0].keys).toEqual(['k1']);
    });

    it('returns error for nonexistent worldbook', async () => {
      const result = await provider.executeTool('list_worldbook_entries', { worldbook_id: 'nope' }, makeContext());
      expect(result.error).toContain('not found');
    });

    it('worldbook_id is required', async () => {
      const result = await provider.executeTool('list_worldbook_entries', {}, makeContext());
      expect(result.error).toContain('worldbook_id is required');
    });

    it('respects limit', async () => {
      const result = await provider.executeTool('list_worldbook_entries', { worldbook_id: worldbookId, limit: 1 }, makeContext());
      const data = result.data as any;
      expect(data.entries).toHaveLength(1);
    });
  });

  // ── Batch 3: list_character_versions ──────────────────

  describe('list_character_versions', () => {
    let characterId: string;

    beforeEach(async () => {
      const createResult = await provider.executeTool('create_character', {
        name: 'VersionTest', description: 'v1',
      }, makeContext());
      characterId = (createResult.data as any).character_id;
      // Create a second version
      await provider.executeTool('update_character', {
        character_id: characterId, description: 'v2',
      }, makeContext());
    });

    it('returns version list with snapshot_name', async () => {
      const result = await provider.executeTool('list_character_versions', { character_id: characterId }, makeContext());
      const data = result.data as any;
      expect(data.character_id).toBe(characterId);
      expect(data.character_name).toBe('VersionTest');
      expect(data.versions).toHaveLength(2);
      // Newest first (desc)
      expect(data.versions[0].version_no).toBe(2);
      expect(data.versions[1].version_no).toBe(1);
      expect(data.versions[0].snapshot_name).toBe('VersionTest');
      expect(data.versions[0].content_hash).toBeTruthy();
    });

    it('returns error for nonexistent character', async () => {
      const result = await provider.executeTool('list_character_versions', { character_id: 'nope' }, makeContext());
      expect(result.error).toContain('not found');
    });

    it('respects limit', async () => {
      const result = await provider.executeTool('list_character_versions', { character_id: characterId, limit: 1 }, makeContext());
      const data = result.data as any;
      expect(data.versions).toHaveLength(1);
    });
  });

  // ── Batch 3: get_worldbook_entry ──────────────────────

  describe('get_worldbook_entry', () => {
    let worldbookId: string;
    let entryId: string;

    beforeEach(async () => {
      const wbResult = await provider.executeTool('create_worldbook', { name: 'WB Single' }, makeContext());
      worldbookId = (wbResult.data as any).id;
      const entryResult = await provider.executeTool('create_worldbook_entry', {
        worldbook_id: worldbookId, keys: ['hero'], content: 'Hero desc', comment: 'Hero',
      }, makeContext());
      entryId = (entryResult.data as any).id;
    });

    it('returns full entry with content', async () => {
      const result = await provider.executeTool('get_worldbook_entry', {
        worldbook_id: worldbookId, entry_id: entryId,
      }, makeContext());
      const data = result.data as any;
      expect(data.id).toBe(entryId);
      expect(data.content).toBe('Hero desc');
      expect(data.comment).toBe('Hero');
      expect(data.keys).toEqual(['hero']);
      expect(data.worldbook_id).toBe(worldbookId);
    });

    it('returns error for nonexistent entry', async () => {
      const result = await provider.executeTool('get_worldbook_entry', {
        worldbook_id: worldbookId, entry_id: 'nope',
      }, makeContext());
      expect(result.error).toContain('not found');
    });

    it('returns error for nonexistent worldbook', async () => {
      const result = await provider.executeTool('get_worldbook_entry', {
        worldbook_id: 'nope', entry_id: entryId,
      }, makeContext());
      expect(result.error).toContain('not found');
    });

    it('requires both worldbook_id and entry_id', async () => {
      const r1 = await provider.executeTool('get_worldbook_entry', { worldbook_id: worldbookId }, makeContext());
      expect(r1.error).toContain('entry_id is required');
      const r2 = await provider.executeTool('get_worldbook_entry', { entry_id: entryId }, makeContext());
      expect(r2.error).toContain('worldbook_id is required');
    });
  });

  // ── Batch 3: get_regex_rule ───────────────────────────

  describe('get_regex_rule', () => {
    const profileId = 'rp-rule-test';

    beforeEach(async () => {
      const now = Date.now();
      const scripts = [
        { id: 'r1', scriptName: 'Rule One', findRegex: '/hello/', replaceString: 'hi', trimStrings: [], placement: [2], disabled: false, substituteRegex: 0, minDepth: 0, maxDepth: 0 },
        { id: 'r2', scriptName: 'Rule Two', findRegex: '/world/', replaceString: 'earth', trimStrings: [], placement: [1], disabled: true, substituteRegex: 0, minDepth: 0, maxDepth: 0 },
      ];
      await db.insert(regexProfiles).values({
        id: profileId, name: 'Rule Test', source: 'tool', accountId: ACCOUNT_A,
        dataJson: JSON.stringify(scripts), createdAt: now, updatedAt: now,
      });
    });

    it('returns a single rule', async () => {
      const result = await provider.executeTool('get_regex_rule', { profile_id: profileId, rule_index: 0 }, makeContext());
      const data = result.data as any;
      expect(data.index).toBe(0);
      expect(data.script_name).toBe('Rule One');
      expect(data.find_regex).toBe('/hello/');
      expect(data.replace_string).toBe('hi');
      expect(data.disabled).toBe(false);
    });

    it('returns second rule', async () => {
      const result = await provider.executeTool('get_regex_rule', { profile_id: profileId, rule_index: 1 }, makeContext());
      const data = result.data as any;
      expect(data.index).toBe(1);
      expect(data.script_name).toBe('Rule Two');
      expect(data.disabled).toBe(true);
    });

    it('returns error for out-of-range index', async () => {
      const result = await provider.executeTool('get_regex_rule', { profile_id: profileId, rule_index: 5 }, makeContext());
      expect(result.error).toContain('out of range');
    });

    it('returns error for nonexistent profile', async () => {
      const result = await provider.executeTool('get_regex_rule', { profile_id: 'nope', rule_index: 0 }, makeContext());
      expect(result.error).toContain('not found');
    });
  });

  // ── Batch 3: get_preset / get_preset_entry ────────────

  describe('get_preset and get_preset_entry', () => {
    const presetId = 'ps-read-test';

    beforeEach(async () => {
      const now = Date.now();
      const presetJson = JSON.stringify({
        prompts: [
          { identifier: 'main', role: 'system', content: 'Main prompt text', name: 'Main', system_prompt: true, marker: false, injection_position: 0 },
          { identifier: 'jailbreak', role: 'system', content: 'JB text', name: 'Jailbreak', system_prompt: false, marker: false, injection_position: 1 },
        ],
        prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }, { identifier: 'jailbreak', enabled: false }] }],
      });
      await db.insert(presets).values({
        id: presetId, name: 'Read Test', source: 'sillytavern', accountId: ACCOUNT_A,
        dataJson: presetJson, createdAt: now, updatedAt: now,
      });
    });

    it('get_preset returns preset with entries', async () => {
      const result = await provider.executeTool('get_preset', { preset_id: presetId }, makeContext());
      const data = result.data as any;
      expect(data.id).toBe(presetId);
      expect(data.name).toBe('Read Test');
      expect(data.entries).toHaveLength(2);
      expect(data.entries[0].identifier).toBe('main');
      expect(data.entries[0].content).toBe('Main prompt text');
      expect(data.entries[1].identifier).toBe('jailbreak');
      expect(data.entries[1].enabled).toBe(false);
    });

    it('get_preset returns error for nonexistent preset', async () => {
      const result = await provider.executeTool('get_preset', { preset_id: 'nope' }, makeContext());
      expect(result.error).toContain('not found');
    });

    it('get_preset accountId isolation', async () => {
      const result = await provider.executeTool('get_preset', { preset_id: presetId }, makeContext(ACCOUNT_B));
      expect(result.error).toContain('not found');
    });

    it('get_preset_entry returns a single entry', async () => {
      const result = await provider.executeTool('get_preset_entry', {
        preset_id: presetId, identifier: 'jailbreak',
      }, makeContext());
      const data = result.data as any;
      expect(data.identifier).toBe('jailbreak');
      expect(data.content).toBe('JB text');
      expect(data.enabled).toBe(false);
    });

    it('get_preset_entry returns error for nonexistent identifier', async () => {
      const result = await provider.executeTool('get_preset_entry', {
        preset_id: presetId, identifier: 'nope',
      }, makeContext());
      expect(result.error).toContain('not found');
    });

    it('get_preset_entry requires preset_id and identifier', async () => {
      const r1 = await provider.executeTool('get_preset_entry', { preset_id: presetId }, makeContext());
      expect(r1.error).toContain('identifier is required');
      const r2 = await provider.executeTool('get_preset_entry', { identifier: 'main' }, makeContext());
      expect(r2.error).toContain('preset_id is required');
    });
  });

  // ── Batch 3: create_regex_profile ─────────────────────

  describe('create_regex_profile', () => {
    it('creates an empty profile', async () => {
      const result = await provider.executeTool('create_regex_profile', { name: 'New Profile' }, makeContext());
      const data = result.data as any;
      expect(data.id).toBeTruthy();
      expect(data.name).toBe('New Profile');
      expect(data.source).toBe('tool');

      // Verify in DB
      const [row] = await db.select().from(regexProfiles).where(eq(regexProfiles.id, data.id)).limit(1);
      expect(row).toBeTruthy();
      expect(row!.dataJson).toBe('[]');
      expect(row!.accountId).toBe(ACCOUNT_A);
    });

    it('returns error when name is missing', async () => {
      const result = await provider.executeTool('create_regex_profile', {}, makeContext());
      expect(result.error).toContain('name is required');
    });

    it('accountId isolation', async () => {
      const result = await provider.executeTool('create_regex_profile', { name: 'P' }, makeContext(ACCOUNT_B));
      const data = result.data as any;
      const [row] = await db.select().from(regexProfiles).where(eq(regexProfiles.id, data.id)).limit(1);
      expect(row!.accountId).toBe(ACCOUNT_B);
    });
  });

  // ── Batch 3: create_preset_entry ──────────────────────

  describe('create_preset_entry', () => {
    const presetId = 'ps-create-entry-test';

    beforeEach(async () => {
      const now = Date.now();
      const presetJson = JSON.stringify({
        prompts: [
          { identifier: 'main', role: 'system', content: 'Main', name: 'Main', system_prompt: true, marker: false, injection_position: 0 },
        ],
        prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }] }],
      });
      await db.insert(presets).values({
        id: presetId, name: 'Create Entry Test', source: 'tool', accountId: ACCOUNT_A,
        dataJson: presetJson, createdAt: now, updatedAt: now,
      });
    });

    it('createsentry', async () => {
      const result = await provider.executeTool('create_preset_entry', {
        preset_id: presetId, identifier: 'custom1', name: 'My Custom', content: 'Custom text', role: 'user',
      }, makeContext());
      const data = result.data as any;
      expect(data.identifier).toBe('custom1');
      expect(data.name).toBe('My Custom');
      expect(data.content).toBe('Custom text');
      expect(data.role).toBe('user');
      expect(data.enabled).toBe(true);
    });

    it('returns error for duplicate identifier', async () => {
      const result = await provider.executeTool('create_preset_entry', {
        preset_id: presetId, identifier: 'main', content: 'Dup',
      }, makeContext());
      expect(result.error).toContain('already exists');
    });

    it('returns error for nonexistent preset', async () => {
      const result = await provider.executeTool('create_preset_entry', {
        preset_id: 'nope', identifier: 'x', content: 'Y',
      }, makeContext());
      expect(result.error).toContain('not found');
    });

    it('requires preset_id and identifier', async () => {
      const r1 = await provider.executeTool('create_preset_entry', { preset_id: presetId }, makeContext());
      expect(r1.error).toContain('identifier is required');
      const r2 = await provider.executeTool('create_preset_entry', { identifier: 'x' }, makeContext());
      expect(r2.error).toContain('preset_id is required');
    });
  });

  // ── Batch 3: update_preset_entry ──────────────────────

  describe('update_preset_entry', () => {
    const presetId = 'ps-update-entry-test';

    beforeEach(async () => {
      const now = Date.now();
      const presetJson = JSON.stringify({
        prompts: [
          { identifier: 'main', role: 'system', content: 'Original', name: 'Main', system_prompt: true, marker: false, injection_position: 0 },
        ],
        prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }] }],
      });
      await db.insert(presets).values({
        id: presetId, name: 'Update Entry Test', source: 'tool', accountId: ACCOUNT_A,
        dataJson: presetJson, createdAt: now, updatedAt: now,
      });
    });

    it('updates content and preserves other fields', async () => {
      const result = await provider.executeTool('update_preset_entry', {
        preset_id: presetId, identifier: 'main', content: 'Updated text',
      }, makeContext());
      const data = result.data as any;
      expect(data.content).toBe('Updated text');
      expect(data.name).toBe('Main');
      expect(data.system_prompt).toBe(true);
    });

    it('returns error for nonexistent identifier', async () => {
      const result = await provider.executeTool('update_preset_entry', {
        preset_id: presetId, identifier: 'nope', content: 'X',
      }, makeContext());
      expect(result.error).toContain('not found');
    });

    it('returns error when no fields provided', async () => {
      const result = await provider.executeTool('update_preset_entry', {
        preset_id: presetId, identifier: 'main',
      }, makeContext());
      expect(result.error).toContain('At least one field');
    });

    it('requires preset_id and identifier', async () => {
      const r1 = await provider.executeTool('update_preset_entry', { preset_id: presetId }, makeContext());
      expect(r1.error).toContain('identifier is required');
      const r2 = await provider.executeTool('update_preset_entry', { identifier: 'main' }, makeContext());
      expect(r2.error).toContain('preset_id is required');
    });
  });

});
