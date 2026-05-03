import { describe, expect, it } from 'vitest';

import {
  TH_BACKUP_KIND,
  TH_BACKUP_SPEC,
  TH_BACKUP_SPEC_VERSION,
  thBackupFileSchema,
} from '../backup-file.js';

function makeMinimalBackup(overrides?: Record<string, unknown>) {
  return {
    spec: TH_BACKUP_SPEC,
    spec_version: TH_BACKUP_SPEC_VERSION,
    backup_kind: TH_BACKUP_KIND,
    created_at: 1700000000000,
    source: {
      account_id: 'default-admin',
      app_version: '0.2.0-beta.3',
    },
    included_domains: ['characters', 'worldbooks', 'sessions'],
    options: {
      include_secrets: false,
    },
    resources: {
      characters: [
        {
          id: 'char-old-1',
          name: 'Alice',
          status: 'active',
          source: 'sillytavern',
          created_at: 1700000000000,
          updated_at: 1700000001000,
          latest_version_no: 1,
          versions: [
            {
              id: 'charver-old-1',
              version_no: 1,
              data: { name: 'Alice' },
              content_hash: 'hash-1',
              source_artifact: {
                data: { spec: 'card' },
                format: 'character_card_v2',
                digest: 'sha256:test',
              },
              created_at: 1700000000000,
            },
          ],
        },
      ],
      worldbooks: [
        {
          id: 'wb-old-1',
          name: 'Lorebook',
          source: 'sillytavern',
          created_at: 1700000000000,
          updated_at: 1700000001000,
          version: 2,
          data: { scanDepth: 3 },
          entries: [
            {
              id: 'wbe-old-1',
              uid: 1,
              comment: '',
              content: 'Kingdom lore',
              keys: ['kingdom'],
              keys_secondary: [],
              selective: true,
              selective_logic: 0,
              constant: false,
              position: 0,
              order: 100,
              depth: 4,
              role: 0,
              disable: false,
              scan_depth: null,
              case_sensitive: null,
              match_whole_words: null,
              exclude_recursion: false,
              prevent_recursion: false,
              delay_until_recursion: null,
              outlet_name: '',
              extra: {},
              created_at: 1700000000000,
              updated_at: 1700000001000,
            },
          ],
        },
      ],
    },
    sessions: [
      {
        id: 'session-old-1',
        title: 'Story A',
        status: 'active',
        created_at: 1700000000000,
        updated_at: 1700000001000,
        prompt_mode: 'native',
        model_provider: 'openai-compatible',
        model_name: 'model-x',
        model_params: { temperature: 0.8 },
        metadata: { label: 'demo' },
        character_binding: {
          character_id_ref: 'char-old-1',
          character_version_id_ref: 'charver-old-1',
          character_sync_policy: 'pin',
          snapshot: { name: 'Alice' },
        },
        user_binding: {
          user_id: 'user-old-1',
          snapshot: { name: 'User' },
        },
        profile_binding: {
          worldbook_id_ref: 'wb-old-1',
          preset_id: 'preset-old-1',
          regex_profile_id: 'regex-old-1',
        },
        branches: [
          {
            branch_id: 'main',
            source_floor_id_ref: null,
            source_branch_id: null,
            created_at: 1700000000000,
            updated_at: 1700000000000,
          },
        ],
        floors: [
          {
            id: 'floor-old-1',
            floor_no: 0,
            branch_id: 'main',
            parent_floor_id_ref: null,
            superseded_at: null,
            superseded_by_floor_id_ref: null,
            state: 'committed',
            token_in: 0,
            token_out: 10,
            metadata: null,
            created_at: 1700000000000,
            updated_at: 1700000000000,
            pages: [
              {
                id: 'page-old-1',
                page_no: 0,
                page_kind: 'output',
                is_active: true,
                version: 1,
                checksum: null,
                created_at: 1700000000000,
                updated_at: 1700000000000,
                messages: [
                  {
                    id: 'message-old-1',
                    seq: 0,
                    role: 'assistant',
                    content: 'Hello',
                    content_format: 'text',
                    token_count: 2,
                    is_hidden: false,
                    source: null,
                    created_at: 1700000000000,
                  },
                ],
              },
            ],
          },
        ],
        variables: [
          {
            scope: 'chat',
            scope_id_ref: null,
            key: 'mood',
            value: 'calm',
            updated_at: 1700000001000,
          },
        ],
        branch_local_variable_snapshots: [
          {
            floor_id_ref: 'floor-old-1',
            branch_id: 'main',
            snapshot_version: 2,
            values: { mood: 'calm' },
            provenance: {
              mood: {
                source_scope: 'branch',
                source_scope_id_ref: 'main',
                source_variable_id: 'var-old-1',
                source_updated_at: 1700000000000,
                inherited_from_floor_id_ref: null,
                inherited_from_branch_id: 'main',
                origin_kind: 'authored',
              },
            },
            created_at: 1700000001000,
          },
        ],
        memories: {
          items: [
            {
              id: 'memory-old-1',
              scope: 'chat',
              scope_id_ref: null,
              type: 'summary',
              summary_tier: 'macro',
              content: { text: 'summary' },
              importance: 0.9,
              confidence: 1,
              source_floor_id_ref: 'floor-old-1',
              source_message_id_ref: 'message-old-1',
              status: 'active',
              lifecycle_status: 'active',
              source_job_id: null,
              token_count_estimate: 32,
              last_used_at: 1700000002000,
              coverage_start_floor_no: 0,
              coverage_end_floor_no: 0,
              derived_from_count: 1,
              created_at: 1700000000000,
              updated_at: 1700000001000,
            },
          ],
          edges: [],
        },
      },
    ],
    extensions: {
      secrets: {
        mode: 'excluded',
      },
    },
    ...overrides,
  };
}

describe('thBackupFileSchema', () => {
  it('validates a minimal complete backup file', () => {
    const result = thBackupFileSchema.safeParse(makeMinimalBackup());
    expect(result.success).toBe(true);
  });

  it('rejects wrong spec values', () => {
    const result = thBackupFileSchema.safeParse(makeMinimalBackup({ spec: 'wrong-spec' }));
    expect(result.success).toBe(false);
  });

  it('keeps canonical nested session structures', () => {
    const result = thBackupFileSchema.parse(makeMinimalBackup());
    expect(result.resources.characters[0]?.versions[0]?.source_artifact?.format).toBe('character_card_v2');
    expect(result.resources.worldbooks[0]?.entries[0]?.keys).toEqual(['kingdom']);
    expect(result.sessions[0]?.branches[0]?.branch_id).toBe('main');
    expect(result.sessions[0]?.branch_local_variable_snapshots[0]?.provenance?.mood?.source_scope_id_ref).toBe('main');
    expect(result.sessions[0]?.memories.items[0]?.summary_tier).toBe('macro');
  });
});
