import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_ADMIN_ACCOUNT_ID } from '../../accounts/constants.js';
import { createDatabase, type DatabaseConnection } from '../../db/client.js';
import { accounts } from '../../db/schema.js';
import { McpService, McpServiceError } from '../../services/mcp-service.js';
import type { CreateMcpServerInput } from '../types.js';

describe('McpService', () => {
  let database: DatabaseConnection;
  let service: McpService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    service = new McpService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  async function createAccount(id: string, name = id): Promise<void> {
    const now = Date.now();
    await database.db.insert(accounts).values({
      id,
      name,
      role: 'user',
      status: 'active',
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  function makeStdioInput(overrides: Partial<CreateMcpServerInput> = {}): CreateMcpServerInput {
    return {
      name: 'test-server',
      transport: 'stdio',
      stdio: { command: 'node', args: ['server.js'] },
      ...overrides,
    };
  }

  function makeHttpInput(overrides: Partial<CreateMcpServerInput> = {}): CreateMcpServerInput {
    return {
      name: 'http-server',
      transport: 'http',
      http: { url: 'http://localhost:8080/mcp' },
      ...overrides,
    };
  }

  describe('createConfig', () => {
    it('创建 stdio 服务器配置', async () => {
      const result = await service.createConfig(makeStdioInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      expect(result.id).toBeTruthy();
      expect(result.name).toBe('test-server');
      expect(result.transport).toBe('stdio');
      expect(result.stdio).toEqual({ command: 'node', args: ['server.js'] });
      expect(result.http).toBeUndefined();
      expect(result.enabled).toBe(true);
      expect(result.connect_timeout_ms).toBe(30000);
      expect(result.call_timeout_ms).toBe(60000);
      expect(result.tool_refresh_interval_ms).toBe(300000);
      expect(result.default_side_effect_level).toBe('irreversible');
      expect(result.created_at).toBeGreaterThan(0);
      expect(result.updated_at).toBe(result.created_at);
    });

    it('创建 http 服务器配置', async () => {
      const result = await service.createConfig(
        makeHttpInput({
          tool_prefix: 'web_',
          connect_timeout_ms: 10000,
          default_side_effect_level: 'none',
        }),
        DEFAULT_ADMIN_ACCOUNT_ID,
      );

      expect(result.transport).toBe('http');
      expect(result.http).toEqual({ url: 'http://localhost:8080/mcp' });
      expect(result.tool_prefix).toBe('web_');
      expect(result.connect_timeout_ms).toBe(10000);
      expect(result.default_side_effect_level).toBe('none');
    });

    it('同一账号内 name 重复时抛出 name_conflict', async () => {
      await service.createConfig(makeStdioInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      await expect(
        service.createConfig(makeStdioInput(), DEFAULT_ADMIN_ACCOUNT_ID)
      ).rejects.toThrow(McpServiceError);

      try {
        await service.createConfig(makeStdioInput(), DEFAULT_ADMIN_ACCOUNT_ID);
      } catch (error) {
        expect((error as McpServiceError).code).toBe('name_conflict');
      }
    });

    it('不同账号可以创建同名配置', async () => {
      await createAccount('acc-other', 'Other Account');

      const first = await service.createConfig(
        makeStdioInput({ name: 'shared-server' }),
        DEFAULT_ADMIN_ACCOUNT_ID,
      );
      const second = await service.createConfig(
        makeStdioInput({ name: 'shared-server' }),
        'acc-other',
      );

      expect(second.id).not.toBe(first.id);
      expect(second.name).toBe(first.name);
    });

    it('stdio 传输缺少 stdio 配置时抛出 invalid_config', async () => {
      await expect(
        service.createConfig(
          {
            name: 'bad',
            transport: 'stdio',
          },
          DEFAULT_ADMIN_ACCOUNT_ID,
        )
      ).rejects.toThrow(McpServiceError);
    });

    it('http 传输缺少 http 配置时抛出 invalid_config', async () => {
      await expect(
        service.createConfig(
          {
            name: 'bad',
            transport: 'http',
          },
          DEFAULT_ADMIN_ACCOUNT_ID,
        )
      ).rejects.toThrow(McpServiceError);
    });

    it('可以创建为禁用状态', async () => {
      const result = await service.createConfig(
        makeStdioInput({ enabled: false }),
        DEFAULT_ADMIN_ACCOUNT_ID,
      );
      expect(result.enabled).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('获取存在的配置', async () => {
      const created = await service.createConfig(makeStdioInput(), DEFAULT_ADMIN_ACCOUNT_ID);
      const fetched = await service.getConfig(created.id, DEFAULT_ADMIN_ACCOUNT_ID);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe('test-server');
    });

    it('跨账号读取时返回 null', async () => {
      await createAccount('acc-other', 'Other Account');
      const created = await service.createConfig(makeStdioInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      const fetched = await service.getConfig(created.id, 'acc-other');
      expect(fetched).toBeNull();
    });

    it('不存在时返回 null', async () => {
      const result = await service.getConfig('nonexistent', DEFAULT_ADMIN_ACCOUNT_ID);
      expect(result).toBeNull();
    });
  });

  describe('listConfigs', () => {
    it('返回当前账号的所有配置', async () => {
      await service.createConfig(makeStdioInput({ name: 'a' }), DEFAULT_ADMIN_ACCOUNT_ID);
      await service.createConfig(makeHttpInput({ name: 'b' }), DEFAULT_ADMIN_ACCOUNT_ID);

      const { configs, total } = await service.listConfigs(DEFAULT_ADMIN_ACCOUNT_ID);
      expect(configs).toHaveLength(2);
      expect(total).toBe(2);
    });

    it('不会列出其他账号的配置', async () => {
      await createAccount('acc-other', 'Other Account');
      await service.createConfig(makeStdioInput({ name: 'admin-config' }), DEFAULT_ADMIN_ACCOUNT_ID);
      await service.createConfig(makeStdioInput({ name: 'other-config' }), 'acc-other');

      const adminResult = await service.listConfigs(DEFAULT_ADMIN_ACCOUNT_ID);
      const otherResult = await service.listConfigs('acc-other');

      expect(adminResult.configs).toHaveLength(1);
      expect(adminResult.configs[0]!.name).toBe('admin-config');
      expect(otherResult.configs).toHaveLength(1);
      expect(otherResult.configs[0]!.name).toBe('other-config');
    });

    it('按 enabled 过滤', async () => {
      await service.createConfig(
        makeStdioInput({ name: 'enabled-one', enabled: true }),
        DEFAULT_ADMIN_ACCOUNT_ID,
      );
      await service.createConfig(
        makeStdioInput({ name: 'disabled-one', enabled: false }),
        DEFAULT_ADMIN_ACCOUNT_ID,
      );

      const enabledResult = await service.listConfigs(DEFAULT_ADMIN_ACCOUNT_ID, { enabled: true });
      expect(enabledResult.configs).toHaveLength(1);
      expect(enabledResult.configs[0]!.name).toBe('enabled-one');

      const disabledResult = await service.listConfigs(DEFAULT_ADMIN_ACCOUNT_ID, { enabled: false });
      expect(disabledResult.configs).toHaveLength(1);
      expect(disabledResult.configs[0]!.name).toBe('disabled-one');
    });

    it('支持分页', async () => {
      await service.createConfig(makeStdioInput({ name: 'a' }), DEFAULT_ADMIN_ACCOUNT_ID);
      await service.createConfig(makeStdioInput({ name: 'b' }), DEFAULT_ADMIN_ACCOUNT_ID);
      await service.createConfig(makeStdioInput({ name: 'c' }), DEFAULT_ADMIN_ACCOUNT_ID);

      const page1 = await service.listConfigs(DEFAULT_ADMIN_ACCOUNT_ID, { limit: 2, offset: 0 });
      expect(page1.configs).toHaveLength(2);
      expect(page1.total).toBe(3);

      const page2 = await service.listConfigs(DEFAULT_ADMIN_ACCOUNT_ID, { limit: 2, offset: 2 });
      expect(page2.configs).toHaveLength(1);
    });
  });

  describe('listEnabledConfigs', () => {
    it('只返回当前账号启用的服务器配置（业务对象）', async () => {
      await service.createConfig(makeStdioInput({ name: 'on', enabled: true }), DEFAULT_ADMIN_ACCOUNT_ID);
      await service.createConfig(makeStdioInput({ name: 'off', enabled: false }), DEFAULT_ADMIN_ACCOUNT_ID);

      const configs = await service.listEnabledConfigs(DEFAULT_ADMIN_ACCOUNT_ID);
      expect(configs).toHaveLength(1);
      expect(configs[0]!.name).toBe('on');
      expect(configs[0]!.enabled).toBe(true);
      expect(configs[0]!.connectTimeoutMs).toBe(30000);
    });

    it('不会返回其他账号启用的配置', async () => {
      await createAccount('acc-other', 'Other Account');
      await service.createConfig(makeStdioInput({ name: 'admin-on', enabled: true }), DEFAULT_ADMIN_ACCOUNT_ID);
      await service.createConfig(makeStdioInput({ name: 'other-on', enabled: true }), 'acc-other');

      const adminConfigs = await service.listEnabledConfigs(DEFAULT_ADMIN_ACCOUNT_ID);
      const otherConfigs = await service.listEnabledConfigs('acc-other');

      expect(adminConfigs).toHaveLength(1);
      expect(adminConfigs[0]!.name).toBe('admin-on');
      expect(otherConfigs).toHaveLength(1);
      expect(otherConfigs[0]!.name).toBe('other-on');
    });
  });

  describe('getOwnedConfigIds', () => {
    it('按账号过滤候选配置 ID', async () => {
      await createAccount('acc-other', 'Other Account');
      const admin = await service.createConfig(makeStdioInput({ name: 'admin-id' }), DEFAULT_ADMIN_ACCOUNT_ID);
      const other = await service.createConfig(makeStdioInput({ name: 'other-id' }), 'acc-other');

      const ownedIds = await service.getOwnedConfigIds(DEFAULT_ADMIN_ACCOUNT_ID, [admin.id, other.id, 'missing']);
      expect(ownedIds).toEqual([admin.id]);
    });
  });

  describe('updateConfig', () => {
    it('更新名称和超时', async () => {
      const created = await service.createConfig(makeStdioInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      const updated = await service.updateConfig(
        created.id,
        {
          name: 'renamed',
          connect_timeout_ms: 5000,
        },
        DEFAULT_ADMIN_ACCOUNT_ID,
      );

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('renamed');
      expect(updated!.connect_timeout_ms).toBe(5000);
      expect(updated!.updated_at).toBeGreaterThanOrEqual(created.updated_at);
    });

    it('更新 name 冲突时抛出异常', async () => {
      await service.createConfig(makeStdioInput({ name: 'existing' }), DEFAULT_ADMIN_ACCOUNT_ID);
      const other = await service.createConfig(makeStdioInput({ name: 'other' }), DEFAULT_ADMIN_ACCOUNT_ID);

      await expect(
        service.updateConfig(other.id, { name: 'existing' }, DEFAULT_ADMIN_ACCOUNT_ID)
      ).rejects.toThrow(McpServiceError);
    });

    it('跨账号更新时返回 null', async () => {
      await createAccount('acc-other', 'Other Account');
      const created = await service.createConfig(makeStdioInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      const result = await service.updateConfig(created.id, { name: 'x' }, 'acc-other');
      expect(result).toBeNull();
    });

    it('不存在的 ID 返回 null', async () => {
      const result = await service.updateConfig('nonexistent', { name: 'x' }, DEFAULT_ADMIN_ACCOUNT_ID);
      expect(result).toBeNull();
    });

    it('更新传输配置', async () => {
      const created = await service.createConfig(makeStdioInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      const updated = await service.updateConfig(
        created.id,
        { stdio: { command: 'python', args: ['mcp.py'] } },
        DEFAULT_ADMIN_ACCOUNT_ID,
      );

      expect(updated!.stdio).toEqual({ command: 'python', args: ['mcp.py'] });
    });

    it('切换传输类型时校验配置一致性', async () => {
      const created = await service.createConfig(makeStdioInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      await expect(
        service.updateConfig(created.id, { transport: 'http' }, DEFAULT_ADMIN_ACCOUNT_ID)
      ).rejects.toThrow(McpServiceError);
    });
  });

  describe('deleteConfig', () => {
    it('删除存在的配置', async () => {
      const created = await service.createConfig(makeStdioInput(), DEFAULT_ADMIN_ACCOUNT_ID);
      const deleted = await service.deleteConfig(created.id, DEFAULT_ADMIN_ACCOUNT_ID);

      expect(deleted).toBe(true);

      const fetched = await service.getConfig(created.id, DEFAULT_ADMIN_ACCOUNT_ID);
      expect(fetched).toBeNull();
    });

    it('跨账号删除返回 false', async () => {
      await createAccount('acc-other', 'Other Account');
      const created = await service.createConfig(makeStdioInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      const deleted = await service.deleteConfig(created.id, 'acc-other');
      expect(deleted).toBe(false);
    });

    it('不存在的 ID 返回 false', async () => {
      const deleted = await service.deleteConfig('nonexistent', DEFAULT_ADMIN_ACCOUNT_ID);
      expect(deleted).toBe(false);
    });
  });

  describe('toggleConfig', () => {
    it('禁用后再启用', async () => {
      const created = await service.createConfig(
        makeStdioInput({ enabled: true }),
        DEFAULT_ADMIN_ACCOUNT_ID,
      );

      const disabled = await service.toggleConfig(created.id, false, DEFAULT_ADMIN_ACCOUNT_ID);
      expect(disabled!.enabled).toBe(false);

      const reenabled = await service.toggleConfig(created.id, true, DEFAULT_ADMIN_ACCOUNT_ID);
      expect(reenabled!.enabled).toBe(true);
    });

    it('跨账号切换返回 null', async () => {
      await createAccount('acc-other', 'Other Account');
      const created = await service.createConfig(makeStdioInput(), DEFAULT_ADMIN_ACCOUNT_ID);

      const result = await service.toggleConfig(created.id, false, 'acc-other');
      expect(result).toBeNull();
    });

    it('不存在的 ID 返回 null', async () => {
      const result = await service.toggleConfig('nonexistent', true, DEFAULT_ADMIN_ACCOUNT_ID);
      expect(result).toBeNull();
    });
  });
});
