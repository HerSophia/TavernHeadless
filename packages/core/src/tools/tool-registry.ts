// ── ToolRegistry ──────────────────────────────────────

import type { InstanceSlot } from '../llm/types.js';
import type {
  ToolDefinition,
  ToolProvider,
  ToolPermissions,
} from './types.js';

/**
 * 工具注册表
 *
 * 管理所有工具来源（ToolProvider），提供统一的查找和按槽位/权限过滤接口。
 */
export class ToolRegistry {
  private providers = new Map<string, ToolProvider>();

  /**
   * 注册一个工具提供者。
   * @throws 如果 provider.id 已注册则抛出错误。
   */
  register(provider: ToolProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`ToolProvider '${provider.id}' is already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  /**
   * 取消注册一个工具提供者。
   * @returns 是否成功移除（false = 不存在）。
   */
  unregister(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  /**
   * 获取已注册的工具提供者。
   */
  getProvider(providerId: string): ToolProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * 获取所有已注册的工具提供者。
   */
  getAllProviders(): ToolProvider[] {
    return [...this.providers.values()];
  }

  /**
   * 列出所有提供者的所有工具定义。
   */
  async listAll(): Promise<ToolDefinition[]> {
    const results: ToolDefinition[] = [];
    for (const provider of this.providers.values()) {
      const tools = await provider.listTools();
      results.push(...tools);
    }
    return results;
  }

  /**
   * 按槽位和权限过滤可用工具。
   *
   * 过滤逻辑（按顺序）：
   * 1. 工具自身的 allowedSlots 检查（空数组 = 全部允许）
   * 2. permissions.slotAllowList 白名单（配置了则仅允许列出的工具名）
   * 3. permissions.slotDenyList 黑名单排除
   * 4. permissions.allowIrreversible 控制是否包含 irreversible 工具
   */
  async listForSlot(
    slot: InstanceSlot,
    permissions: ToolPermissions,
  ): Promise<ToolDefinition[]> {
    if (!permissions.enabled) return [];

    const all = await this.listAll();
    return all.filter((tool) => this.isToolAllowed(tool, slot, permissions));
  }

  /**
   * 按名称查找工具定义。
   * 遍历所有 provider 的 listTools，返回第一个匹配的工具。
   */
  async getTool(name: string): Promise<ToolDefinition | null> {
    for (const provider of this.providers.values()) {
      const tools = await provider.listTools();
      const found = tools.find((t) => t.name === name);
      if (found) return found;
    }
    return null;
  }

  /**
   * 查找持有指定工具名的 provider。
   * 用于 ToolExecutor 定位到应该调用哪个 provider。
   */
  async findProviderForTool(toolName: string): Promise<ToolProvider | null> {
    for (const provider of this.providers.values()) {
      const tools = await provider.listTools();
      if (tools.some((t) => t.name === toolName)) return provider;
    }
    return null;
  }

  // ── 内部方法 ────────────────────────────────────────

  private isToolAllowed(
    tool: ToolDefinition,
    slot: InstanceSlot,
    permissions: ToolPermissions,
  ): boolean {
    // 1. 工具自身的 allowedSlots 检查
    if (tool.allowedSlots.length > 0 && !tool.allowedSlots.includes(slot)) {
      return false;
    }

    // 2. 白名单检查
    const allowList = permissions.slotAllowList?.[slot];
    if (allowList && !allowList.includes(tool.name)) {
      return false;
    }

    // 3. 黑名单检查
    const denyList = permissions.slotDenyList?.[slot];
    if (denyList && denyList.includes(tool.name)) {
      return false;
    }

    // 4. irreversible 检查
    if (tool.sideEffectLevel === 'irreversible' && !permissions.allowIrreversible) {
      return false;
    }

    return true;
  }
}
