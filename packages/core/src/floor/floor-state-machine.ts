import type { FloorState } from '@tavern/shared';
import type { CoreEventBus } from '../events/index.js';
import { FloorNotFoundError, FloorStateConflictError, InvalidStateTransitionError } from '../errors.js';
import type { FloorEntity } from '../types.js';
import type { FloorRepository } from '../ports/index.js';

/**
 * 合法状态转移表
 *
 * ```text
 * draft ──→ generating ──→ committed
 *   │           │
 *   │           └──→ failed
 *   └──────────────→ failed
 * ```
 */
const VALID_TRANSITIONS: Record<FloorState, readonly FloorState[]> = {
  draft: ['generating', 'failed'],
  generating: ['committed', 'failed'],
  committed: [],
  failed: [],
};

/**
 * 楼层状态机
 *
 * 管理楼层的生命周期状态转移，确保只允许合法的状态变更路径。
 * 每次状态变更都会持久化并通过事件总线广播。
 */
export class FloorStateMachine {
  constructor(
    private readonly floorRepo: FloorRepository,
    private readonly eventBus: CoreEventBus
  ) {}

  /**
   * 验证状态转移是否合法（纯函数，无副作用）
   */
  canTransition(from: FloorState, to: FloorState): boolean {
    return VALID_TRANSITIONS[from].includes(to);
  }

  /**
   * 执行状态转移：读取 → 校验 → 持久化 → 发事件
   *
   * @throws {FloorNotFoundError} 楼层不存在
   * @throws {InvalidStateTransitionError} 非法状态转移
   */
  async transition(floorId: string, targetState: FloorState): Promise<FloorEntity> {
    const floor = await this.floorRepo.findById(floorId);

    if (!floor) {
      throw new FloorNotFoundError(floorId);
    }

    const previousState = floor.state;

    if (!this.canTransition(previousState, targetState)) {
      throw new InvalidStateTransitionError(previousState, targetState);
    }

    const updated = await this.floorRepo.updateStateCas(
      floorId,
      previousState,
      targetState,
      Date.now(),
    );

    if (!updated) {
      const current = await this.floorRepo.findById(floorId);
      throw current ? new FloorStateConflictError(floorId, previousState, current.state) : new FloorNotFoundError(floorId);
    }

    // 广播通用状态变更事件
    await this.eventBus.emit('floor.stateChanged', {
      floor: updated,
      previousState,
      newState: targetState,
    });

    // 终态额外发出专用事件
    if (targetState === 'committed') {
      await this.eventBus.emit('floor.committed', {
        floor: updated,
        promotedVariables: [],  // 由 FloorLifecycle 填充
      });
    }

    return updated;
  }

  /** 便捷方法：draft → generating */
  async startGenerating(floorId: string): Promise<FloorEntity> {
    return this.transition(floorId, 'generating');
  }

  /** 便捷方法：generating → committed */
  async commit(floorId: string): Promise<FloorEntity> {
    return this.transition(floorId, 'committed');
  }

  /**
   * 便捷方法：* → failed
   * 同时发出 floor.failed 事件附带错误信息
   */
  async fail(floorId: string, error: Error): Promise<FloorEntity> {
    const floor = await this.floorRepo.findById(floorId);

    if (!floor) {
      throw new FloorNotFoundError(floorId);
    }

    const previousState = floor.state;

    if (!this.canTransition(previousState, 'failed')) {
      throw new InvalidStateTransitionError(previousState, 'failed');
    }

    const updated = await this.floorRepo.updateStateCas(
      floorId,
      previousState,
      'failed',
      Date.now(),
    );

    if (!updated) {
      const current = await this.floorRepo.findById(floorId);
      throw current ? new FloorStateConflictError(floorId, previousState, current.state) : new FloorNotFoundError(floorId);
    }

    await this.eventBus.emit('floor.stateChanged', {
      floor: updated,
      previousState,
      newState: 'failed',
    });

    await this.eventBus.emit('floor.failed', {
      floor: updated,
      error,
    });

    return updated;
  }
}
