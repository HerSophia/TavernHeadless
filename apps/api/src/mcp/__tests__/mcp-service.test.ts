import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../db/client.js';
import { McpService, McpServiceError } from '../../services/mcp-service.js';
import type { CreateMcpServerInput } from '../types.js';

describe('McpService', () => {
  let database: DatabaseConnection;
  let service: McpService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    service = new McpService(database.db);
  });

  // ── 测试辅助 ────────────────────────────────────

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

  // ── createConfig ────────────────────────────────

  describe('createConfig', () => {
    it('创建 stdio 服务器配置', async () => {
      const result = await service.createConfig(makeStdioInput());

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
      const result = await service.createConfig(makeHttpInput({
        tool_prefix: 'web_',
        connect_timeout_ms: 10000,
        default_side_effect_level: 'none',
      }));

      expect(result.transport).toBe('http');
      expect(result.http).toEqual({ url: 'http://localhost:8080/mcp' });
      expect(result.tool_prefix).toBe('web_');
      expect(result.connect_timeout_ms).toBe(10000);
      expect(result.default_side_effect_level).toBe('none');
    });

    it('name 重复时抛出 name_conflict', async () => {
      await service.createConfig(makeStdioInput());

      await expect(
        service.createConfig(makeStdioInput())
      ).rejects.toThrow(McpServiceError);

      try {
        await service.createConfig(makeStdioInput());
      } catch (e) {
        expect((e as McpServiceError).code).toBe('name_conflict');
      }
    });

    it('stdio 传输缺少 stdio 配置时抛出 invalid_config', async () => {
      await expect(
        service.createConfig({
          name: 'bad',
          transport: 'stdio',
          // 没有 stdio 配置
        })
      ).rejects.toThrow(McpServiceError);
    });

    it('http 传输缺少 http 配置时抛出 invalid_config', async () => {
      await expect(
        service.createConfig({
          name: 'bad',
          transport: 'http',
          // 没有 http 配置
        })
      ).rejects.toThrow(McpServiceError);
    });

    it('可以创建为禁用状态', async () => {
      const result = await service.createConfig(makeStdioInput({ enabled: false }));
      expect(result.enabled).toBe(false);
    });
  });

  // ── getConfig ───────────────────────────────────

  describe('getConfig', () => {
    it('获取存在的配置', async () => {
      const created = await service.createConfig(makeStdioInput());
      const fetched = await service.getConfig(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe('test-server');
    });

    it('不存在时返回 null', async () => {
      const result = await service.getConfig('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ── listConfigs ─────────────────────────────────

  describe('listConfigs', () => {
    it('返回所有配置', async () => {
      await service.createConfig(makeStdioInput({ name: 'a' }));
      await service.createConfig(makeHttpInput({ name: 'b' }));

      const { configs, total } = await service.listConfigs();
      expect(configs).toHaveLength(2);
      expect(total).toBe(2);
    });

    it('按 enabled 过滤', async () => {
      await service.createConfig(makeStdioInput({ name: 'enabled-one', enabled: true }));
      await service.createConfig(makeStdioInput({ name: 'disabled-one', enabled: false }));

      const enabledResult = await service.listConfigs({ enabled: true });
      expect(enabledResult.configs).toHaveLength(1);
      expect(enabledResult.configs[0]!.name).toBe('enabled-one');

      const disabledResult = await service.listConfigs({ enabled: false });
      expect(disabledResult.configs).toHaveLength(1);
      expect(disabledResult.configs[0]!.name).toBe('disabled-one');
    });

    it('支持分页', async () => {
      await service.createConfig(makeStdioInput({ name: 'a' }));
      await service.createConfig(makeStdioInput({ name: 'b' }));
      await service.createConfig(makeStdioInput({ name: 'c' }));

      const page1 = await service.listConfigs({ limit: 2, offset: 0 });
      expect(page1.configs).toHaveLength(2);
      expect(page1.total).toBe(3);

      const page2 = await service.listConfigs({ limit: 2, offset: 2 });
      expect(page2.configs).toHaveLength(1);
    });
  });

  // ── listEnabledConfigs ──────────────────────────

  describe('listEnabledConfigs', () => {
    it('只返回启用的服务器配置（业务对象）', async () => {
      await service.createConfig(makeStdioInput({ name: 'on', enabled: true }));
      await service.createConfig(makeStdioInput({ name: 'off', enabled: false }));

      const configs = await service.listEnabledConfigs();
      expect(configs).toHaveLength(1);
      expect(configs[0]!.name).toBe('on');
      // 返回的是 McpServerConfig，不是 Response
      expect(configs[0]!.enabled).toBe(true);
      expect(configs[0]!.connectTimeoutMs).toBe(30000);
    });
  });

  // ── updateConfig ────────────────────────────────

  describe('updateConfig', () => {
    it('更新名称和超时', async () => {
      const created = await service.createConfig(makeStdioInput());

      const updated = await service.updateConfig(created.id, {
        name: 'renamed',
        connect_timeout_ms: 5000,
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('renamed');
      expect(updated!.connect_timeout_ms).toBe(5000);
      expect(updated!.updated_at).toBeGreaterThanOrEqual(created.updated_at);
    });

    it('更新 name 冲突时抛出异常', async () => {
      await service.createConfig(makeStdioInput({ name: 'existing' }));
      const other = await service.createConfig(makeStdioInput({ name: 'other' }));

      await expect(
        service.updateConfig(other.id, { name: 'existing' })
      ).rejects.toThrow(McpServiceError);
    });

    it('不存在的 ID 返回 null', async () => {
      const result = await service.updateConfig('nonexistent', { name: 'x' });
      expect(result).toBeNull();
    });

    it('更新传输配置', async () => {
      const created = await service.createConfig(makeStdioInput());

      const updated = await service.updateConfig(created.id, {
        stdio: { command: 'python', args: ['mcp.py'] },
      });

      expect(updated!.stdio).toEqual({ command: 'python', args: ['mcp.py'] });
    });

    it('切换传输类型时校验配置一致性', async () => {
      const created = await service.createConfig(makeStdioInput());

      // 改为 http 但不提供 http 配置
      await expect(
        service.updateConfig(created.id, { transport: 'http' })
      ).rejects.toThrow(McpServiceError);
    });
  });

  // ── deleteConfig ────────────────────────────────

  describe('deleteConfig', () => {
    it('删除存在的配置', async () => {
      const created = await service.createConfig(makeStdioInput());
      const deleted = await service.deleteConfig(created.id);

      expect(deleted).toBe(true);

      const fetched = await service.getConfig(created.id);
      expect(fetched).toBeNull();
    });

    it('不存在的 ID 返回 false', async () => {
      const deleted = await service.deleteConfig('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  // ── toggleConfig ────────────────────────────────

  describe('toggleConfig', () => {
    it('禁用后再启用', async () => {
      const created = await service.createConfig(makeStdioInput({ enabled: true }));

      const disabled = await service.toggleConfig(created.id, false);
      expect(disabled!.enabled).toBe(false);

      const reenabled = await service.toggleConfig(created.id, true);
      expect(reenabled!.enabled).toBe(true);
    });

    it('不存在的 ID 返回 null', async () => {
      const result = await service.toggleConfig('nonexistent', true);
      expect(result).toBeNull();
    });
  });
});
