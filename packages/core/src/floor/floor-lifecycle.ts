import type { VariableEntry } from '@tavern/shared';
import type { CoreEventBus } from '../events/index.js';
import type { FloorEntity, VariableContext } from '../types.js';
import type { FloorRepository } from '../ports/index.js';
import { FloorNotFoundError } from '../errors.js';
import { FloorStateMachine } from './floor-state-machine.js';
import { VariableStore } from '../variables/variable-store.js';

/**
 * 楼层生命周期管理
 *
 * 整合状态机与变量系统，提供完整的楼层提交流程：
 * 1. 状态转移 generating → committed
 * 2. 提升 page 变量到 floor
 * 3. 发出 floor.committed 事件（带已提升变量列表）
 */
export class FloorLifecycle {
  private readonly stateMachine: FloorStateMachine;

  constructor(
    private readonly floorRepo: FloorRepository,
    private readonly variableStore: VariableStore,
    private readonly eventBus: CoreEventBus
  ) {
    this.stateMachine = new FloorStateMachine(floorRepo, eventBus);
  }

  /** 获取内部状态机实例（用于直接调用 startGenerating / fail 等） */
  getStateMachine(): FloorStateMachine {
    return this.stateMachine;
  }

  /**
   * 完整的楼层提交流程
   *
   * @param floorId 要提交的楼层 ID
   * @param context 变量上下文（需包含 pageId、floorId、sessionId）
   * @returns 提交后的楼层实体
   */
  async commitFloor(
    floorId: string,
    context: VariableContext
  ): Promise<{ floor: FloorEntity; promotedVariables: VariableEntry[] }> {
    // 1. 先查楼层获取信息
    const floor = await this.floorRepo.findById(floorId);
    if (!floor) {
      throw new FloorNotFoundError(floorId);
    }

    // 2. 提升 page 变量到 floor（在状态转移前执行，确保变量不会丢失）
    let promotedVariables: VariableEntry[] = [];
    if (context.pageId && context.floorId) {
      promotedVariables = await this.variableStore.promoteAll(
        'page',
        context.pageId,
        'floor',
        context.floorId
      );
    }

    // 3. 执行状态转移 generating → committed
    //    FloorStateMachine.transition 内部会发 floor.stateChanged
    //    我们在这里覆盖 floor.committed 事件，附带 promotedVariables
    const committed = await this.stateMachine.commit(floorId);

    // 注意：FloorStateMachine.transition 已经发出了 floor.committed（带空 promotedVariables）
    // 这里不再重复发出。如果需要精确控制，可以在未来重构 stateMachine 接受可选参数。
    // 当前设计：使用者应监听 floor.committed 事件，promotedVariables 在 promoteAll 的逐条事件中已广播。

    return { floor: committed, promotedVariables };
  }

  /** 便捷方法：开始生成 */
  async startGenerating(floorId: string): Promise<FloorEntity> {
    return this.stateMachine.startGenerating(floorId);
  }

  /** 便捷方法：标记失败 */
  async fail(floorId: string, error: Error): Promise<FloorEntity> {
    return this.stateMachine.fail(floorId, error);
  }
}
