/**
 * ResourceToolProvider — 23 resource management tools for LLM tool calling.
 *
 * Allows LLMs to proactively read, create, and update resources
 * (character cards, worldbooks, regex profiles, presets) during conversations.
 *
 * Implements ToolProvider interface, registered to ToolRegistry alongside
 * BuiltinToolProvider. Transparent to the existing pipeline.
 */

import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { eq, and, like, desc, max } from 'drizzle-orm';

import type {
  ToolProviderType,
  ToolProvider,
  ToolDefinition,
  ToolCallResult,
  ToolExecutionContext,
  InstanceSlot,
} from '@tavern/core';

import type { AppDb, DbExecutor } from '../db/client.js';
import {
  characters,
  characterVersions,
  worldbooks,
  worldbookEntries,
  regexProfiles,
  presets,
} from '../db/schema.js';
import { parseJsonField } from '../lib/http.js';
import {
  CHARACTER_VERSION_CONSTRAINT_MAPPING,
  ResourceWriteRouteError,
  assertRevisionWriteApplied,
  executeResourceWrite,
  withResourceWriteCas,
} from '../services/resource-write.js';
import { parsePreset } from '@tavern/adapters-sillytavern';
import {
  type JsonRecord,
  normalizeStoredPreset,
  findPromptInRaw,
  addPromptToRaw,
  updatePromptFieldsInRaw,
  getEditorEntryFromRaw,
  getAllEditorEntriesFromRaw,
} from '../lib/preset-utils.js';

// ── Tool Definitions ────────────────────────────────────────

/** 资源工具公共属性 */
const RESOURCE_COMMON = {
  allowedSlots: [] as InstanceSlot[], // 空数组 = 所有槽位均可使用
  source: 'builtin' as const,
} satisfies Pick<ToolDefinition, 'allowedSlots' | 'source'>;

const RESOURCE_TOOLS: ToolDefinition[] = [
  // ── Character tools ──────────────────────���───────────
  {
    name: 'create_character',
    description:
      'Create a new character card. Returns the character ID and first version ID. The name field is required.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Character name (required)' },
        description: { type: 'string', description: 'Character description' },
        personality: {
          type: 'string',
          description: 'Personality summary',
        },
        scenario: { type: 'string', description: 'Scenario / setting' },
        first_mes: {
          type: 'string',
          description: 'First (greeting) message',
        },
        mes_example: {
          type: 'string',
          description: 'Example dialogue',
        },
      },
      required: ['name'],
    },
    sideEffectLevel: 'irreversible',
    ...RESOURCE_COMMON,
  },
  {
    name: 'update_character',
    description:
      'Create a new version snapshot for an existing character card. Only provided fields are updated; omitted fields keep their previous values.',
    parameters: {
      type: 'object',
      properties: {
        character_id: {
          type: 'string',
          description: 'ID of the character to update (required)',
        },
        name: { type: 'string', description: 'New character name' },
        description: { type: 'string', description: 'New description' },
        personality: { type: 'string', description: 'New personality' },
        scenario: { type: 'string', description: 'New scenario' },
        first_mes: { type: 'string', description: 'New greeting message' },
        mes_example: {
          type: 'string',
          description: 'New example dialogue',
        },
      },
      required: ['character_id'],
    },
    sideEffectLevel: 'irreversible',
    ...RESOURCE_COMMON,
  },
  {
    name: 'get_character',
    description:
      'Read a character card with its latest version snapshot.',
    parameters: {
      type: 'object',
      properties: {
        character_id: {
          type: 'string',
          description: 'ID of the character to read (required)',
        },
      },
      required: ['character_id'],
    },
    sideEffectLevel: 'none',
    ...RESOURCE_COMMON,
  },
  {
    name: 'list_characters',
    description:
      'List all active character cards for the current account. Supports keyword search and pagination.',
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: 'Filter by name (substring match)',
        },
        limit: {
          type: 'number',
          description: 'Max results (default 20, max 50)',
        },
      },
    },
    sideEffectLevel: 'none',
    ...RESOURCE_COMMON,
  },

  // ── Worldbook tools ──────────────────────────────────
  {
    name: 'create_worldbook',
    description:
      'Create a new empty worldbook. Returns the worldbook ID.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Worldbook name (required)' },
      },
      required: ['name'],
    },
    sideEffectLevel: 'irreversible',
    ...RESOURCE_COMMON,
  },
  {
    name: 'create_worldbook_entry',
    description:
      'Create a new entry in a worldbook. Keys and content are required.',
    parameters: {
      type: 'object',
      properties: {
        worldbook_id: {
          type: 'string',
          description: 'ID of the worldbook (required)',
        },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Trigger keywords (required)',
        },
        content: {
          type: 'string',
          description: 'Entry content text (required)',
        },
        comment: { type: 'string', description: 'Entry comment / label' },
        keys_secondary: {
          type: 'array',
          items: { type: 'string' },
          description: 'Secondary keys (for selective mode)',
        },
        selective: {
          type: 'boolean',
          description: 'Enable selective mode (default true)',
        },
        constant: {
          type: 'boolean',
          description: 'Always active (default false)',
        },
        position: {
          type: 'number',
          description: 'Injection position 0-6 (default 0)',
        },
        order: {
          type: 'number',
          description: 'Priority order (default 100)',
        },
        depth: {
          type: 'number',
          description: 'Injection depth (default 4)',
        },
        disable: {
          type: 'boolean',
          description: 'Disable this entry (default false)',
        },
      },
      required: ['worldbook_id', 'keys', 'content'],
    },
    sideEffectLevel: 'irreversible',
    ...RESOURCE_COMMON,
  },
  {
    name: 'update_worldbook_entry',
    description:
      'Update an existing worldbook entry. Only provided fields are updated.',
    parameters: {
      type: 'object',
      properties: {
        worldbook_id: {
          type: 'string',
          description: 'ID of the worldbook (required)',
        },
        entry_id: {
          type: 'string',
          description: 'ID of the entry to update (required)',
        },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'New trigger keywords',
        },
        content: { type: 'string', description: 'New content text' },
        comment: { type: 'string', description: 'New comment / label' },
        keys_secondary: {
          type: 'array',
          items: { type: 'string' },
          description: 'New secondary keys',
        },
        selective: { type: 'boolean', description: 'Enable selective mode' },
        constant: { type: 'boolean', description: 'Always active' },
        position: {
          type: 'number',
          description: 'Injection position 0-6',
        },
        order: { type: 'number', description: 'Priority order' },
        depth: { type: 'number', description: 'Injection depth' },
        disable: { type: 'boolean', description: 'Disable this entry' },
      },
      required: ['worldbook_id', 'entry_id'],
    },
    sideEffectLevel: 'irreversible',
    ...RESOURCE_COMMON,
  },
  {
    name: 'get_worldbook',
    description:
      'Read a worldbook with all its entries.',
    parameters: {
      type: 'object',
      properties: {
        worldbook_id: {
          type: 'string',
          description: 'ID of the worldbook to read (required)',
        },
      },
      required: ['worldbook_id'],
    },
    sideEffectLevel: 'none',
    ...RESOURCE_COMMON,
  },
  {
    name: 'list_worldbooks',
    description:
      'List all worldbooks for the current account.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max results (default 20, max 50)',
        },
      },
    },
    sideEffectLevel: 'none',
    ...RESOURCE_COMMON,
  },

  // ── Regex profile tools ──────────────────────────────
  {
    name: 'create_regex_rule',
    description:
      'Add a new regex rule to an existing regex profile. Returns the rule index.',
    parameters: {
      type: 'object',
      properties: {
        profile_id: {
          type: 'string',
          description: 'ID of the regex profile (required)',
        },
        script_name: {
          type: 'string',
          description: 'Human-readable rule name',
        },
        find_regex: {
          type: 'string',
          description: 'Regex pattern to find (required)',
        },
        replace_string: {
          type: 'string',
          description: 'Replacement string (required)',
        },
        trim_strings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Strings to trim from result',
        },
        placement: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Where to apply: 1=user_input, 2=ai_output, 3=slash_command, 5=world_info (default [2])',
        },
        disabled: {
          type: 'boolean',
          description: 'Disable this rule (default false)',
        },
      },
      required: ['profile_id', 'find_regex', 'replace_string'],
    },
    sideEffectLevel: 'irreversible',
    ...RESOURCE_COMMON,
  },
  {
    name: 'update_regex_rule',
    description:
      'Update an existing regex rule in a profile by its 0-based index.',
    parameters: {
      type: 'object',
      properties: {
        profile_id: {
          type: 'string',
          description: 'ID of the regex profile (required)',
        },
        rule_index: {
          type: 'number',
          description: '0-based index of the rule to update (required)',
        },
        script_name: { type: 'string', description: 'New rule name' },
        find_regex: { type: 'string', description: 'New regex pattern' },
        replace_string: {
          type: 'string',
          description: 'New replacement string',
        },
        trim_strings: {
          type: 'array',
          items: { type: 'string' },
          description: 'New trim strings',
        },
        placement: {
          type: 'array',
          items: { type: 'number' },
          description: 'New placement array',
        },
        disabled: { type: 'boolean', description: 'Disable / enable rule' },
      },
      required: ['profile_id', 'rule_index'],
    },
    sideEffectLevel: 'irreversible',
    ...RESOURCE_COMMON,
  },
  {
    name: 'get_regex_profile',
    description:
      'Read a regex profile with all its rules.',
    parameters: {
      type: 'object',
      properties: {
        profile_id: {
          type: 'string',
          description: 'ID of the regex profile to read (required)',
        },
      },
      required: ['profile_id'],
    },
    sideEffectLevel: 'none',
    ...RESOURCE_COMMON,
  },

  // ── Batch 3 — List tools ───────────────────────────────
  {
    name: 'list_regex_profiles',
    description:
      'List all regex profiles for the current account. Returns id, name, source, and updated_at.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Max items to return (default 20, max 50)',
        },
      },
    },
    sideEffectLevel: 'none',
    ...RESOURCE_COMMON,
  },
  {
    name: 'list_presets',
    description:
      'List all presets (prompt ordering templates) for the current account. Returns id, name, source, and updated_at.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Max items to return (default 20, max 50)',
        },
      },
    },
    sideEffectLevel: 'none',
    ...RESOURCE_COMMON,
  },
  {
    name: 'list_worldbook_entries',
    description:
      'List worldbook entry summaries (comment, keys, uid, order, disable) WITHOUT content. ' +
      'Use get_worldbook_entry to read a specific entry\'s full content afterward.',
    parameters: {
      type: 'object',
      properties: {
        worldbook_id: {
          type: 'string',
          description: 'ID of the worldbook (required)',
        },
        limit: {
          type: 'integer',
          description: 'Max entries to return (default 50, max 200)',
        },
      },
      required: ['worldbook_id'],
    },
    sideEffectLevel: 'none',
    ...RESOURCE_COMMON,
  },
  {
    name: 'list_character_versions',
    description:
      'List version history for a character card. Returns version_id, version_no, snapshot_name, content_hash, and created_at.',
    parameters: {
      type: 'object',
      properties: {
        character_id: {
          type: 'string',
          description: 'ID of the character card (required)',
        },
        limit: {
          type: 'integer',
          description: 'Max versions to return (default 10, max 50)',
        },
      },
      required: ['character_id'],
    },
    sideEffectLevel: 'none',
    ...RESOURCE_COMMON,
  },

  // ── Batch 3 — Fine-grained read tools ──────────────────
  {
    name: 'get_worldbook_entry',
    description:
      'Read a single worldbook entry by ID, including full content. Use list_worldbook_entries first to find the entry_id.',
    parameters: {
      type: 'object',
      properties: {
        worldbook_id: {
          type: 'string',
          description: 'ID of the worldbook (required)',
        },
        entry_id: {
          type: 'string',
          description: 'ID of the entry to read (required)',
        },
      },
      required: ['worldbook_id', 'entry_id'],
    },
    sideEffectLevel: 'none',
    ...RESOURCE_COMMON,
  },
  {
    name: 'get_regex_rule',
    description:
      'Read a single regex rule by profile ID and rule index (0-based).',
    parameters: {
      type: 'object',
      properties: {
        profile_id: {
          type: 'string',
          description: 'ID of the regex profile (required)',
        },
        rule_index: {
          type: 'integer',
          description: '0-based index of the rule within the profile (required)',
        },
      },
      required: ['profile_id', 'rule_index'],
    },
    sideEffectLevel: 'none',
    ...RESOURCE_COMMON,
  },
  {
    name: 'get_preset',
    description:
      'Read a preset with all its prompt entries. Returns id, name, source, and the ordered list of entries.',
    parameters: {
      type: 'object',
      properties: {
        preset_id: {
          type: 'string',
          description: 'ID of the preset to read (required)',
        },
      },
      required: ['preset_id'],
    },
    sideEffectLevel: 'none',
    ...RESOURCE_COMMON,
  },
  {
    name: 'get_preset_entry',
    description:
      'Read a single prompt entry from a preset by its identifier.',
    parameters: {
      type: 'object',
      properties: {
        preset_id: {
          type: 'string',
          description: 'ID of the preset (required)',
        },
        identifier: {
          type: 'string',
          description: 'Identifier of the prompt entry (required)',
        },
      },
      required: ['preset_id', 'identifier'],
    },
    sideEffectLevel: 'none',
    ...RESOURCE_COMMON,
  },

  // ── Batch 3 — Create / Write tools ─────────────────────
  {
    name: 'create_regex_profile',
    description:
      'Create a new empty regex profile. Use create_regex_rule afterward to add rules.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Profile name (required)' },
      },
      required: ['name'],
    },
    sideEffectLevel: 'irreversible',
    ...RESOURCE_COMMON,
  },
  {
    name: 'create_preset_entry',
    description:
      'Create a new prompt entry in a preset. The identifier must be unique within the preset.',
    parameters: {
      type: 'object',
      properties: {
        preset_id: {
          type: 'string',
          description: 'ID of the preset (required)',
        },
        identifier: {
          type: 'string',
          description: 'Unique identifier for the entry (required, alphanumeric/underscore/hyphen)',
        },
        name: { type: 'string', description: 'Display name of the prompt entry' },
        role: {
          type: 'string',
          enum: ['assistant', 'system', 'user'],
          description: 'Message role (default: system)',
        },
        content: { type: 'string', description: 'Prompt text content' },
        system_prompt: { type: 'boolean', description: 'Whether this is a system prompt (default: false)' },
        marker: { type: 'boolean', description: 'Whether this is a marker entry (default: false)' },
        injection_position: { type: 'integer', description: 'Injection position (default: 0)' },
        enabled: { type: 'boolean', description: 'Whether the entry is enabled (default: true)' },
      },
      required: ['preset_id', 'identifier'],
    },
    sideEffectLevel: 'irreversible',
    ...RESOURCE_COMMON,
  },
  {
    name: 'update_preset_entry',
    description:
      'Update an existing prompt entry in a preset. Only provided fields are changed.',
    parameters: {
      type: 'object',
      properties: {
        preset_id: {
          type: 'string',
          description: 'ID of the preset (required)',
        },
        identifier: {
          type: 'string',
          description: 'Identifier of the entry to update (required)',
        },
        name: { type: 'string', description: 'Display name of the prompt entry' },
        role: {
          type: 'string',
          enum: ['assistant', 'system', 'user'],
          description: 'Message role',
        },
        content: { type: 'string', description: 'Prompt text content' },
        system_prompt: { type: 'boolean', description: 'Whether this is a system prompt' },
        marker: { type: 'boolean', description: 'Whether this is a marker entry' },
        injection_position: { type: 'integer', description: 'Injection position' },
        enabled: { type: 'boolean', description: 'Whether the entry is enabled' },
      },
      required: ['preset_id', 'identifier'],
    },
    sideEffectLevel: 'irreversible',
    ...RESOURCE_COMMON,
  },
];

// ── Helpers ─────────────────────────────────────────────

interface CharacterSnapshot {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  exampleDialogue?: string;
  greeting?: string;
}

interface RegexScript {
  id: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  placement: number[];
  disabled: boolean;
  substituteRegex: number;
  minDepth: number;
  maxDepth: number;
}

function requireAccountId(context: ToolExecutionContext): string {
  if (!context.accountId) {
    throw new Error('accountId is required for resource tools');
  }
  return context.accountId;
}

function clampLimit(input: unknown, defaultVal = 20, maxVal = 50): number {
  const n = typeof input === 'number' ? input : defaultVal;
  return Math.min(Math.max(1, Math.floor(n)), maxVal);
}

function computeContentHash(json: string): string {
  return createHash('sha256').update(json).digest('hex');
}

function loadOwnedCharacter(tx: DbExecutor, characterId: string, accountId: string) {
  return tx
    .select()
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.accountId, accountId)))
    .limit(1)
    .get();
}

function loadCharacterVersionByNo(tx: DbExecutor, characterId: string, versionNo: number) {
  return tx
    .select()
    .from(characterVersions)
    .where(and(eq(characterVersions.characterId, characterId), eq(characterVersions.versionNo, versionNo)))
    .limit(1)
    .get();
}

function createToolCharacterRevisionConflictError() {
  return new ResourceWriteRouteError(
    409,
    'character_revision_conflict',
    'Character has been modified by another operation',
  );
}

// ── ResourceToolProvider ────────────────────────────────

export class ResourceToolProvider implements ToolProvider {
  readonly id = 'resource';
  readonly type = 'builtin' as const;

  constructor(private readonly db: AppDb) {}

  async listTools(): Promise<ToolDefinition[]> {
    return RESOURCE_TOOLS;
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    try {
      switch (name) {
        // Character
        case 'create_character':
          return await this.handleCreateCharacter(args, context);
        case 'update_character':
          return await this.handleUpdateCharacter(args, context);
        case 'get_character':
          return await this.handleGetCharacter(args, context);
        case 'list_characters':
          return await this.handleListCharacters(args, context);

        // Worldbook
        case 'create_worldbook':
          return await this.handleCreateWorldbook(args, context);
        case 'create_worldbook_entry':
          return await this.handleCreateWorldbookEntry(args, context);
        case 'update_worldbook_entry':
          return await this.handleUpdateWorldbookEntry(args, context);
        case 'get_worldbook':
          return await this.handleGetWorldbook(args, context);
        case 'list_worldbooks':
          return await this.handleListWorldbooks(args, context);

        // Regex
        case 'create_regex_rule':
          return await this.handleCreateRegexRule(args, context);
        case 'update_regex_rule':
          return await this.handleUpdateRegexRule(args, context);
        case 'get_regex_profile':
          return await this.handleGetRegexProfile(args, context);

        // Batch 3 — List tools
        case 'list_regex_profiles':
          return await this.handleListRegexProfiles(args, context);
        case 'list_presets':
          return await this.handleListPresets(args, context);
        case 'list_worldbook_entries':
          return await this.handleListWorldbookEntries(args, context);
        case 'list_character_versions':
          return await this.handleListCharacterVersions(args, context);

        // Batch 3 — Fine-grained read
        case 'get_worldbook_entry':
          return await this.handleGetWorldbookEntry(args, context);
        case 'get_regex_rule':
          return await this.handleGetRegexRule(args, context);
        case 'get_preset':
          return await this.handleGetPreset(args, context);
        case 'get_preset_entry':
          return await this.handleGetPresetEntry(args, context);

        // Batch 3 — Create / Write
        case 'create_regex_profile':
          return await this.handleCreateRegexProfile(args, context);
        case 'create_preset_entry':
          return await this.handleCreatePresetEntry(args, context);
        case 'update_preset_entry':
          return await this.handleUpdatePresetEntry(args, context);

        default:
          return { error: `Unknown resource tool: ${name}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: message };
    }
  }

  // ── Character handlers ────────────────────────────────

  private async handleCreateCharacter(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const name = args.name as string | undefined;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return { error: 'name is required and must be a non-empty string' };
    }

    const snapshot: CharacterSnapshot = {
      name: name.trim(),
      description: typeof args.description === 'string' ? args.description : undefined,
      personality: typeof args.personality === 'string' ? args.personality : undefined,
      scenario: typeof args.scenario === 'string' ? args.scenario : undefined,
      greeting: typeof args.first_mes === 'string' ? args.first_mes : undefined,
      exampleDialogue: typeof args.mes_example === 'string' ? args.mes_example : undefined,
    };

    const characterId = nanoid();
    const versionId = nanoid();
    const snapshotJson = JSON.stringify(snapshot);
    const contentHash = computeContentHash(snapshotJson);
    const now = Date.now();

    const created = await executeResourceWrite(() =>
      this.db.transaction((tx) => {
        tx.insert(characters)
          .values({
            id: characterId,
            name: snapshot.name,
            source: 'tool',
            accountId,
            status: 'active',
            revision: 0,
            latestVersionNo: 1,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        tx.insert(characterVersions)
          .values({
            id: versionId,
            characterId,
            versionNo: 1,
            dataJson: snapshotJson,
            contentHash,
            createdAt: now,
          })
          .run();

        return {
          characterId,
          versionId,
          name: snapshot.name,
        };
      }),
    );

    return {
      data: {
        character_id: created.characterId,
        version_id: created.versionId,
        name: created.name,
      },
    };
  }

  private async handleUpdateCharacter(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const characterId = args.character_id as string | undefined;
    if (!characterId) {
      return { error: 'character_id is required' };
    }

    const updated = await withResourceWriteCas({
      db: this.db,
      load: (tx) => loadOwnedCharacter(tx, characterId, accountId),
      getRevision: (row) => row.revision,
      onMissing: () => new ResourceWriteRouteError(404, 'not_found', `Character not found: ${characterId}`),
      onRevisionConflict: createToolCharacterRevisionConflictError,
      validateLoaded: (row) => {
        if (row.status !== 'active') {
          throw new ResourceWriteRouteError(404, 'not_found', `Character not found: ${characterId}`);
        }
      },
      constraintMappings: [CHARACTER_VERSION_CONSTRAINT_MAPPING],
      mutate: ({ tx, row }) => {
        const latestVersion =
          row.latestVersionNo > 0 ? loadCharacterVersionByNo(tx, row.id, row.latestVersionNo) : undefined;

        if (!latestVersion) {
          throw new Error(`No version found for character: ${characterId}`);
        }

        const oldSnapshot: CharacterSnapshot = JSON.parse(latestVersion.dataJson);
        const newSnapshot: CharacterSnapshot = { ...oldSnapshot };

        if (typeof args.name === 'string' && args.name.trim() !== '') {
          newSnapshot.name = (args.name as string).trim();
        }
        if (typeof args.description === 'string') newSnapshot.description = args.description as string;
        if (typeof args.personality === 'string') newSnapshot.personality = args.personality as string;
        if (typeof args.scenario === 'string') newSnapshot.scenario = args.scenario as string;
        if (typeof args.first_mes === 'string') newSnapshot.greeting = args.first_mes as string;
        if (typeof args.mes_example === 'string') newSnapshot.exampleDialogue = args.mes_example as string;

        const newVersionNo = row.latestVersionNo + 1;
        const newVersionId = nanoid();
        const snapshotJson = JSON.stringify(newSnapshot);
        const contentHash = computeContentHash(snapshotJson);
        const now = Date.now();
        const updates: Partial<typeof characters.$inferInsert> = {
          latestVersionNo: newVersionNo,
          revision: row.revision + 1,
          updatedAt: now,
        };

        if (newSnapshot.name !== oldSnapshot.name) {
          updates.name = newSnapshot.name;
        }

        const updateResult = tx
          .update(characters)
          .set(updates)
          .where(
            and(
              eq(characters.id, row.id),
              eq(characters.accountId, accountId),
              eq(characters.revision, row.revision),
            ),
          )
          .run();

        assertRevisionWriteApplied(updateResult.changes, createToolCharacterRevisionConflictError);

        tx.insert(characterVersions)
          .values({
            id: newVersionId,
            characterId: row.id,
            versionNo: newVersionNo,
            dataJson: snapshotJson,
            contentHash,
            createdAt: now,
          })
          .run();

        return {
          characterId: row.id,
          versionId: newVersionId,
          versionNo: newVersionNo,
        };
      },
    });

    return {
      data: {
        character_id: updated.characterId,
        version_id: updated.versionId,
        version_no: updated.versionNo,
      },
    };
  }

  private async handleGetCharacter(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const characterId = args.character_id as string | undefined;
    if (!characterId) {
      return { error: 'character_id is required' };
    }

    const [charRow] = await this.db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.accountId, accountId),
        ),
      )
      .limit(1);

    if (!charRow) {
      return { error: `Character not found: ${characterId}` };
    }

    const [latestVersion] = await this.db
      .select()
      .from(characterVersions)
      .where(eq(characterVersions.characterId, characterId))
      .orderBy(desc(characterVersions.versionNo))
      .limit(1);

    const snapshot: CharacterSnapshot | null = latestVersion
      ? JSON.parse(latestVersion.dataJson)
      : null;

    return {
      data: {
        id: charRow.id,
        name: charRow.name,
        source: charRow.source,
        status: charRow.status,
        latest_version_no: latestVersion?.versionNo ?? null,
        snapshot: snapshot
          ? {
              name: snapshot.name,
              description: snapshot.description ?? '',
              personality: snapshot.personality ?? '',
              scenario: snapshot.scenario ?? '',
              first_mes: snapshot.greeting ?? '',
              mes_example: snapshot.exampleDialogue ?? '',
            }
          : null,
      },
    };
  }

  private async handleListCharacters(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const limit = clampLimit(args.limit);
    const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : '';

    const conditions = [
      eq(characters.accountId, accountId),
      eq(characters.status, 'active'),
    ];
    if (keyword) {
      conditions.push(like(characters.name, `%${keyword}%`));
    }

    const rows = await this.db
      .select({
        id: characters.id,
        name: characters.name,
        source: characters.source,
        updatedAt: characters.updatedAt,
      })
      .from(characters)
      .where(and(...conditions))
      .orderBy(desc(characters.updatedAt))
      .limit(limit);

    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        source: r.source,
        updated_at: r.updatedAt,
      })),
    };
  }

  // ── Worldbook handlers ────────────────────────────────

  private async handleCreateWorldbook(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const name = args.name as string | undefined;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return { error: 'name is required and must be a non-empty string' };
    }

    const id = nanoid();
    const now = Date.now();

    await this.db.insert(worldbooks).values({
      id,
      name: name.trim(),
      source: 'tool',
      accountId,
      dataJson: '{}',
      createdAt: now,
      updatedAt: now,
    });

    return { data: { id, name: name.trim() } };
  }

  private async handleCreateWorldbookEntry(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const worldbookId = args.worldbook_id as string | undefined;
    if (!worldbookId) {
      return { error: 'worldbook_id is required' };
    }

    const keys = args.keys;
    if (!Array.isArray(keys) || keys.length === 0) {
      return { error: 'keys is required and must be a non-empty array of strings' };
    }
    const content = args.content as string | undefined;
    if (typeof content !== 'string') {
      return { error: 'content is required and must be a string' };
    }

    // 验证世界书归属
    const [wb] = await this.db
      .select()
      .from(worldbooks)
      .where(
        and(
          eq(worldbooks.id, worldbookId),
          eq(worldbooks.accountId, accountId),
        ),
      )
      .limit(1);

    if (!wb) {
      return { error: `Worldbook not found: ${worldbookId}` };
    }

    // 计算 next uid
    const [maxRow] = await this.db
      .select({ maxUid: max(worldbookEntries.uid) })
      .from(worldbookEntries)
      .where(eq(worldbookEntries.worldbookId, worldbookId));
    const nextUid = (maxRow?.maxUid ?? -1) + 1;

    const entryId = nanoid();
    const now = Date.now();

    await this.db.insert(worldbookEntries).values({
      id: entryId,
      worldbookId,
      uid: nextUid,
      comment: typeof args.comment === 'string' ? args.comment : '',
      content,
      keysJson: JSON.stringify(keys),
      keysSecondaryJson: Array.isArray(args.keys_secondary)
        ? JSON.stringify(args.keys_secondary)
        : '[]',
      selective: typeof args.selective === 'boolean' ? args.selective : true,
      selectiveLogic: 0,
      constant: typeof args.constant === 'boolean' ? args.constant : false,
      position: typeof args.position === 'number' ? args.position : 0,
      order: typeof args.order === 'number' ? args.order : 100,
      depth: typeof args.depth === 'number' ? args.depth : 4,
      role: 0,
      disable: typeof args.disable === 'boolean' ? args.disable : false,
      createdAt: now,
      updatedAt: now,
    });

    // 更新世界书 updatedAt
    await this.db
      .update(worldbooks)
      .set({ updatedAt: now })
      .where(eq(worldbooks.id, worldbookId));

    return {
      data: {
        id: entryId,
        worldbook_id: worldbookId,
        uid: nextUid,
        keys,
        comment: typeof args.comment === 'string' ? args.comment : '',
      },
    };
  }

  private async handleUpdateWorldbookEntry(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const worldbookId = args.worldbook_id as string | undefined;
    const entryId = args.entry_id as string | undefined;
    if (!worldbookId) return { error: 'worldbook_id is required' };
    if (!entryId) return { error: 'entry_id is required' };

    // 验证世界书归属
    const [wb] = await this.db
      .select()
      .from(worldbooks)
      .where(
        and(
          eq(worldbooks.id, worldbookId),
          eq(worldbooks.accountId, accountId),
        ),
      )
      .limit(1);
    if (!wb) return { error: `Worldbook not found: ${worldbookId}` };

    // 验证条目存在
    const [entry] = await this.db
      .select()
      .from(worldbookEntries)
      .where(
        and(
          eq(worldbookEntries.id, entryId),
          eq(worldbookEntries.worldbookId, worldbookId),
        ),
      )
      .limit(1);
    if (!entry) return { error: `Entry not found: ${entryId}` };

    // 构建更新对象
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (Array.isArray(args.keys)) updates.keysJson = JSON.stringify(args.keys);
    if (typeof args.content === 'string') updates.content = args.content;
    if (typeof args.comment === 'string') updates.comment = args.comment;
    if (Array.isArray(args.keys_secondary))
      updates.keysSecondaryJson = JSON.stringify(args.keys_secondary);
    if (typeof args.selective === 'boolean') updates.selective = args.selective;
    if (typeof args.constant === 'boolean') updates.constant = args.constant;
    if (typeof args.position === 'number') updates.position = args.position;
    if (typeof args.order === 'number') updates.order = args.order;
    if (typeof args.depth === 'number') updates.depth = args.depth;
    if (typeof args.disable === 'boolean') updates.disable = args.disable;

    await this.db
      .update(worldbookEntries)
      .set(updates)
      .where(eq(worldbookEntries.id, entryId));

    // 更新世界书 updatedAt
    await this.db
      .update(worldbooks)
      .set({ updatedAt: Date.now() })
      .where(eq(worldbooks.id, worldbookId));

    // 读回更新后的条目
    const [updated] = await this.db
      .select()
      .from(worldbookEntries)
      .where(eq(worldbookEntries.id, entryId))
      .limit(1);

    if (!updated) {
      return { error: `Failed to read back updated entry: ${entryId}` };
    }

    return {
      data: {
        id: updated.id,
        worldbook_id: updated.worldbookId,
        uid: updated.uid,
        keys: JSON.parse(updated.keysJson),
        content: updated.content,
        comment: updated.comment,
      },
    };
  }

  private async handleGetWorldbook(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const worldbookId = args.worldbook_id as string | undefined;
    if (!worldbookId) return { error: 'worldbook_id is required' };

    const [wb] = await this.db
      .select()
      .from(worldbooks)
      .where(
        and(
          eq(worldbooks.id, worldbookId),
          eq(worldbooks.accountId, accountId),
        ),
      )
      .limit(1);
    if (!wb) return { error: `Worldbook not found: ${worldbookId}` };

    const entries = await this.db
      .select()
      .from(worldbookEntries)
      .where(eq(worldbookEntries.worldbookId, worldbookId))
      .orderBy(worldbookEntries.order);

    return {
      data: {
        id: wb.id,
        name: wb.name,
        source: wb.source,
        entries: entries.map((e) => ({
          id: e.id,
          uid: e.uid,
          keys: JSON.parse(e.keysJson),
          keys_secondary: JSON.parse(e.keysSecondaryJson),
          content: e.content,
          comment: e.comment,
          selective: e.selective,
          constant: e.constant,
          position: e.position,
          order: e.order,
          depth: e.depth,
          disable: e.disable,
        })),
      },
    };
  }

  private async handleListWorldbooks(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const limit = clampLimit(args.limit);

    const rows = await this.db
      .select({
        id: worldbooks.id,
        name: worldbooks.name,
        source: worldbooks.source,
        updatedAt: worldbooks.updatedAt,
      })
      .from(worldbooks)
      .where(eq(worldbooks.accountId, accountId))
      .orderBy(desc(worldbooks.updatedAt))
      .limit(limit);

    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        source: r.source,
        updated_at: r.updatedAt,
      })),
    };
  }

  // ── Regex handlers ────────────────────────────────────

  private async handleCreateRegexRule(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const profileId = args.profile_id as string | undefined;
    if (!profileId) return { error: 'profile_id is required' };

    const findRegex = args.find_regex as string | undefined;
    if (typeof findRegex !== 'string' || findRegex === '') {
      return { error: 'find_regex is required and must be a non-empty string' };
    }
    const replaceString = args.replace_string;
    if (typeof replaceString !== 'string') {
      return { error: 'replace_string is required and must be a string' };
    }

    // 查询配置文件
    const [profile] = await this.db
      .select()
      .from(regexProfiles)
      .where(
        and(
          eq(regexProfiles.id, profileId),
          eq(regexProfiles.accountId, accountId),
        ),
      )
      .limit(1);
    if (!profile) return { error: `Regex profile not found: ${profileId}` };

    // 解析现有规则
    let scripts: RegexScript[];
    try {
      scripts = JSON.parse(profile.dataJson);
      if (!Array.isArray(scripts)) scripts = [];
    } catch {
      scripts = [];
    }

    // 构造新规则
    const newRule: RegexScript = {
      id: nanoid(),
      scriptName: typeof args.script_name === 'string' ? args.script_name : '',
      findRegex,
      replaceString: replaceString as string,
      trimStrings: Array.isArray(args.trim_strings)
        ? (args.trim_strings as string[])
        : [],
      placement: Array.isArray(args.placement)
        ? (args.placement as number[])
        : [2],
      disabled: typeof args.disabled === 'boolean' ? args.disabled : false,
      substituteRegex: 0,
      minDepth: 0,
      maxDepth: 0,
    };

    scripts.push(newRule);
    const ruleIndex = scripts.length - 1;

    await this.db
      .update(regexProfiles)
      .set({
        dataJson: JSON.stringify(scripts),
        updatedAt: Date.now(),
      })
      .where(eq(regexProfiles.id, profileId));

    return {
      data: {
        rule_index: ruleIndex,
        script_name: newRule.scriptName,
        find_regex: newRule.findRegex,
      },
    };
  }

  private async handleUpdateRegexRule(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const profileId = args.profile_id as string | undefined;
    if (!profileId) return { error: 'profile_id is required' };

    const ruleIndex = args.rule_index;
    if (typeof ruleIndex !== 'number' || !Number.isInteger(ruleIndex) || ruleIndex < 0) {
      return { error: 'rule_index is required and must be a non-negative integer' };
    }

    // 查询配置文件
    const [profile] = await this.db
      .select()
      .from(regexProfiles)
      .where(
        and(
          eq(regexProfiles.id, profileId),
          eq(regexProfiles.accountId, accountId),
        ),
      )
      .limit(1);
    if (!profile) return { error: `Regex profile not found: ${profileId}` };

    let scripts: RegexScript[];
    try {
      scripts = JSON.parse(profile.dataJson);
      if (!Array.isArray(scripts)) scripts = [];
    } catch {
      scripts = [];
    }

    if (ruleIndex >= scripts.length) {
      return {
        error: `rule_index ${ruleIndex} out of range (profile has ${scripts.length} rules)`,
      };
    }

    // 合并更新
    const rule = scripts[ruleIndex];
    if (!rule) {
      return {
        error: `rule_index ${ruleIndex} out of range (profile has ${scripts.length} rules)`,
      };
    }
    if (typeof args.script_name === 'string') rule!.scriptName = args.script_name;
    if (typeof args.find_regex === 'string') rule!.findRegex = args.find_regex;
    if (typeof args.replace_string === 'string') rule!.replaceString = args.replace_string;
    if (Array.isArray(args.trim_strings)) rule!.trimStrings = args.trim_strings as string[];
    if (Array.isArray(args.placement)) rule!.placement = args.placement as number[];
    if (typeof args.disabled === 'boolean') rule!.disabled = args.disabled;

    await this.db
      .update(regexProfiles)
      .set({
        dataJson: JSON.stringify(scripts),
        updatedAt: Date.now(),
      })
      .where(eq(regexProfiles.id, profileId));

    return {
      data: {
        rule_index: ruleIndex,
        script_name: rule!.scriptName,
        find_regex: rule!.findRegex,
      },
    };
  }

  private async handleGetRegexProfile(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const profileId = args.profile_id as string | undefined;
    if (!profileId) return { error: 'profile_id is required' };

    const [profile] = await this.db
      .select()
      .from(regexProfiles)
      .where(
        and(
          eq(regexProfiles.id, profileId),
          eq(regexProfiles.accountId, accountId),
        ),
      )
      .limit(1);
    if (!profile) return { error: `Regex profile not found: ${profileId}` };

    let scripts: RegexScript[];
    try {
      scripts = JSON.parse(profile.dataJson);
      if (!Array.isArray(scripts)) scripts = [];
    } catch {
      scripts = [];
    }

    return {
      data: {
        id: profile.id,
        name: profile.name,
        source: profile.source,
        rules: scripts.map((s, index) => ({
          index,
          script_name: s.scriptName,
          find_regex: s.findRegex,
          replace_string: s.replaceString,
          trim_strings: s.trimStrings,
          placement: s.placement,
          disabled: s.disabled,
        })),
      },
    };
  }

  // ── Batch 3 — Preset helpers (private) ──────────────────

  private loadPresetRawForTool(
    presetId: string,
    accountId: string,
  ): { row: typeof presets.$inferSelect; raw: JsonRecord } | null {
    const [row] = this.db
      .select()
      .from(presets)
      .where(and(eq(presets.id, presetId), eq(presets.accountId, accountId)))
      .limit(1)
      .all();
    if (!row) return null;
    const normalized = normalizeStoredPreset(parseJsonField(row.dataJson) as JsonRecord);
    return { row, raw: normalized.raw };
  }

  private savePresetRawForTool(
    presetId: string,
    accountId: string,
    raw: JsonRecord,
    now: number,
  ): void {
    this.db
      .update(presets)
      .set({ dataJson: JSON.stringify(raw), updatedAt: now })
      .where(and(eq(presets.id, presetId), eq(presets.accountId, accountId)))
      .run();
  }

  private validatePresetRawForTool(raw: JsonRecord): string | null {
    try {
      parsePreset(raw as Record<string, unknown>);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  // ── Batch 3 — List handlers ────────────────────────────

  private async handleListRegexProfiles(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const limit = clampLimit(args.limit, 20, 50);

    const rows = await this.db
      .select({
        id: regexProfiles.id,
        name: regexProfiles.name,
        source: regexProfiles.source,
        updatedAt: regexProfiles.updatedAt,
      })
      .from(regexProfiles)
      .where(eq(regexProfiles.accountId, accountId))
      .orderBy(desc(regexProfiles.updatedAt))
      .limit(limit);

    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        source: r.source,
        updated_at: r.updatedAt,
      })),
    };
  }

  private async handleListPresets(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const limit = clampLimit(args.limit, 20, 50);

    const rows = await this.db
      .select({
        id: presets.id,
        name: presets.name,
        source: presets.source,
        updatedAt: presets.updatedAt,
      })
      .from(presets)
      .where(eq(presets.accountId, accountId))
      .orderBy(desc(presets.updatedAt))
      .limit(limit);

    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        source: r.source,
        updated_at: r.updatedAt,
      })),
    };
  }

  private async handleListWorldbookEntries(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const worldbookId = args.worldbook_id as string | undefined;
    if (!worldbookId) return { error: 'worldbook_id is required' };

    // Verify worldbook belongs to current account
    const [wb] = await this.db
      .select()
      .from(worldbooks)
      .where(
        and(
          eq(worldbooks.id, worldbookId),
          eq(worldbooks.accountId, accountId),
        ),
      )
      .limit(1);
    if (!wb) return { error: `Worldbook not found: ${worldbookId}` };

    const limit = clampLimit(args.limit, 50, 200);
    const entries = await this.db
      .select()
      .from(worldbookEntries)
      .where(eq(worldbookEntries.worldbookId, worldbookId))
      .orderBy(worldbookEntries.order)
      .limit(limit);

    return {
      data: {
        worldbook_id: wb.id,
        worldbook_name: wb.name,
        entries: entries.map((e) => ({
          id: e.id,
          uid: e.uid,
          comment: e.comment,
          keys: JSON.parse(e.keysJson),
          keys_secondary: JSON.parse(e.keysSecondaryJson),
          order: e.order,
          disable: e.disable,
        })),
      },
    };
  }

  private async handleListCharacterVersions(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const characterId = args.character_id as string | undefined;
    if (!characterId) return { error: 'character_id is required' };

    // Verify character belongs to current account
    const [charRow] = await this.db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.accountId, accountId),
        ),
      )
      .limit(1);
    if (!charRow) return { error: `Character not found: ${characterId}` };

    const limit = clampLimit(args.limit, 10, 50);
    const rows = await this.db
      .select()
      .from(characterVersions)
      .where(eq(characterVersions.characterId, characterId))
      .orderBy(desc(characterVersions.versionNo))
      .limit(limit);

    return {
      data: {
        character_id: charRow.id,
        character_name: charRow.name,
        versions: rows.map((v) => {
          let snapshotName = '';
          try {
            const snap = JSON.parse(v.dataJson) as CharacterSnapshot;
            snapshotName = snap.name ?? '';
          } catch { /* ignore */ }
          return {
            version_id: v.id,
            version_no: v.versionNo,
            snapshot_name: snapshotName,
            content_hash: v.contentHash,
            created_at: v.createdAt,
          };
        }),
      },
    };
  }

  // ── Batch 3 — Fine-grained read handlers ───────────────

  private async handleGetWorldbookEntry(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const worldbookId = args.worldbook_id as string | undefined;
    const entryId = args.entry_id as string | undefined;
    if (!worldbookId) return { error: 'worldbook_id is required' };
    if (!entryId) return { error: 'entry_id is required' };

    // Verify worldbook belongs to current account
    const [wb] = await this.db
      .select()
      .from(worldbooks)
      .where(
        and(
          eq(worldbooks.id, worldbookId),
          eq(worldbooks.accountId, accountId),
        ),
      )
      .limit(1);
    if (!wb) return { error: `Worldbook not found: ${worldbookId}` };

    const [entry] = await this.db
      .select()
      .from(worldbookEntries)
      .where(
        and(
          eq(worldbookEntries.id, entryId),
          eq(worldbookEntries.worldbookId, worldbookId),
        ),
      )
      .limit(1);
    if (!entry) return { error: `Entry not found: ${entryId}` };

    return {
      data: {
        id: entry.id,
        worldbook_id: worldbookId,
        uid: entry.uid,
        comment: entry.comment,
        keys: JSON.parse(entry.keysJson),
        keys_secondary: JSON.parse(entry.keysSecondaryJson),
        content: entry.content,
        selective: entry.selective,
        constant: entry.constant,
        position: entry.position,
        order: entry.order,
        depth: entry.depth,
        disable: entry.disable,
      },
    };
  }

  private async handleGetRegexRule(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const profileId = args.profile_id as string | undefined;
    if (!profileId) return { error: 'profile_id is required' };

    const ruleIndex = args.rule_index;
    if (typeof ruleIndex !== 'number' || !Number.isInteger(ruleIndex) || ruleIndex < 0) {
      return { error: 'rule_index is required and must be a non-negative integer' };
    }

    const [profile] = await this.db
      .select()
      .from(regexProfiles)
      .where(
        and(
          eq(regexProfiles.id, profileId),
          eq(regexProfiles.accountId, accountId),
        ),
      )
      .limit(1);
    if (!profile) return { error: `Regex profile not found: ${profileId}` };

    let scripts: RegexScript[];
    try {
      scripts = JSON.parse(profile.dataJson);
      if (!Array.isArray(scripts)) scripts = [];
    } catch {
      scripts = [];
    }

    if (ruleIndex >= scripts.length) {
      return {
        error: `rule_index ${ruleIndex} out of range (profile has ${scripts.length} rules)`,
      };
    }

    const s = scripts[ruleIndex]!;
    return {
      data: {
        index: ruleIndex,
        script_name: s.scriptName,
        find_regex: s.findRegex,
        replace_string: s.replaceString,
        trim_strings: s.trimStrings,
        placement: s.placement,
        disabled: s.disabled,
      },
    };
  }

  private async handleGetPreset(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const presetId = args.preset_id as string | undefined;
    if (!presetId) return { error: 'preset_id is required' };

    const loaded = this.loadPresetRawForTool(presetId, accountId);
    if (!loaded) return { error: `Preset not found: ${presetId}` };

    const { entries } = getAllEditorEntriesFromRaw(loaded.raw);
    return {
      data: {
        id: loaded.row.id,
        name: loaded.row.name,
        source: loaded.row.source,
        entries: entries.map((e) => ({
          identifier: e.identifier,
          name: e.name,
          role: e.role,
          content: e.content,
          system_prompt: e.system_prompt,
          marker: e.marker,
          injection_position: e.injection_position,
          enabled: e.enabled,
        })),
      },
    };
  }

  private async handleGetPresetEntry(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const presetId = args.preset_id as string | undefined;
    const identifier = args.identifier as string | undefined;
    if (!presetId) return { error: 'preset_id is required' };
    if (!identifier) return { error: 'identifier is required' };

    const loaded = this.loadPresetRawForTool(presetId, accountId);
    if (!loaded) return { error: `Preset not found: ${presetId}` };

    const entry = getEditorEntryFromRaw(loaded.raw, identifier);
    if (!entry) return { error: `Entry not found: ${identifier}` };

    return {
      data: {
        identifier: entry.identifier,
        name: entry.name,
        role: entry.role,
        content: entry.content,
        system_prompt: entry.system_prompt,
        marker: entry.marker,
        injection_position: entry.injection_position,
        enabled: entry.enabled,
      },
    };
  }

  // ── Batch 3 — Create / Write handlers ──────────────────

  private async handleCreateRegexProfile(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const name = args.name as string | undefined;
    if (!name) return { error: 'name is required' };

    const id = nanoid();
    const now = Date.now();

    await this.db.insert(regexProfiles).values({
      id,
      name,
      source: 'tool',
      accountId,
      dataJson: '[]',
      createdAt: now,
      updatedAt: now,
    });

    return { data: { id, name, source: 'tool' } };
  }

  private async handleCreatePresetEntry(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const presetId = args.preset_id as string | undefined;
    const identifier = args.identifier as string | undefined;
    if (!presetId) return { error: 'preset_id is required' };
    if (!identifier) return { error: 'identifier is required' };

    const loaded = this.loadPresetRawForTool(presetId, accountId);
    if (!loaded) return { error: `Preset not found: ${presetId}` };

    const { raw } = loaded;

    // Check for duplicate identifier
    if (findPromptInRaw(raw, identifier)) {
      return { error: `Entry with identifier '${identifier}' already exists` };
    }

    const enabled = typeof args.enabled === 'boolean' ? args.enabled : true;
    const promptData: Record<string, unknown> = {
      identifier,
      name: typeof args.name === 'string' ? args.name : '',
      role: typeof args.role === 'string' ? args.role : 'system',
      content: typeof args.content === 'string' ? args.content : '',
      system_prompt: typeof args.system_prompt === 'boolean' ? args.system_prompt : false,
      marker: typeof args.marker === 'boolean' ? args.marker : false,
      injection_position: typeof args.injection_position === 'number' ? args.injection_position : 0,
      enabled,
    };

    addPromptToRaw(raw, promptData as JsonRecord, enabled);

    const validationError = this.validatePresetRawForTool(raw);
    if (validationError) {
      return { error: `Preset validation failed: ${validationError}` };
    }

    this.savePresetRawForTool(presetId, accountId, raw, Date.now());

    const entry = getEditorEntryFromRaw(raw, identifier);
    return {
      data: entry
        ? {
            identifier: entry.identifier,
            name: entry.name,
            role: entry.role,
            content: entry.content,
            system_prompt: entry.system_prompt,
            marker: entry.marker,
            injection_position: entry.injection_position,
            enabled: entry.enabled,
          }
        : { identifier },
    };
  }

  private async handleUpdatePresetEntry(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const accountId = requireAccountId(context);
    const presetId = args.preset_id as string | undefined;
    const identifier = args.identifier as string | undefined;
    if (!presetId) return { error: 'preset_id is required' };
    if (!identifier) return { error: 'identifier is required' };

    const loaded = this.loadPresetRawForTool(presetId, accountId);
    if (!loaded) return { error: `Preset not found: ${presetId}` };

    const { raw } = loaded;

    if (!findPromptInRaw(raw, identifier)) {
      return { error: `Entry not found: ${identifier}` };
    }

    // Build fields object with only provided values
    const fields: Record<string, unknown> = {};
    if (typeof args.name === 'string') fields.name = args.name;
    if (typeof args.role === 'string') fields.role = args.role;
    if (typeof args.content === 'string') fields.content = args.content;
    if (typeof args.system_prompt === 'boolean') fields.system_prompt = args.system_prompt;
    if (typeof args.marker === 'boolean') fields.marker = args.marker;
    if (typeof args.injection_position === 'number') fields.injection_position = args.injection_position;
    if (typeof args.enabled === 'boolean') fields.enabled = args.enabled;

    if (Object.keys(fields).length === 0) {
      return { error: 'At least one field to update is required' };
    }

    updatePromptFieldsInRaw(raw, identifier, fields as JsonRecord);

    const validationError = this.validatePresetRawForTool(raw);
    if (validationError) {
      return { error: `Preset validation failed: ${validationError}` };
    }

    this.savePresetRawForTool(presetId, accountId, raw, Date.now());

    const entry = getEditorEntryFromRaw(raw, identifier);
    return {
      data: entry
        ? {
            identifier: entry.identifier,
            name: entry.name,
            role: entry.role,
            content: entry.content,
            system_prompt: entry.system_prompt,
            marker: entry.marker,
            injection_position: entry.injection_position,
            enabled: entry.enabled,
          }
        : { identifier },
    };
  }

}
