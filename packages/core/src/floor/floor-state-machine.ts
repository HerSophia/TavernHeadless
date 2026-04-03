import type { FloorState } from '@tavern/shared';
import type { VariableEntry } from '@tavern/shared';
import type { CoreEventBus } from '../events/index.js';
import { FloorNotFoundError, FloorStateConflictError, InvalidStateTransitionError } from '../errors.js';
import type { FloorEntity } from '../types.js';
import type { FloorRepository } from '../ports/index.js';

export interface PreparedFloorTransition {
  floorId: string;
  previousState: FloorState;
  newState: FloorState;
}

export interface FloorTransitionResult extends PreparedFloorTransition {
  floor: FloorEntity;
}

interface EmitFloorTransitionOptions {
  promotedVariables?: VariableEntry[];
}

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

    const prepared = this.prepareTransition(floor, targetState);

    const updated = await this.floorRepo.updateStateCas(
      floorId,
      prepared.previousState,
      prepared.newState,
      Date.now(),
    );

    if (!updated) {
      const current = await this.floorRepo.findById(floorId);
      throw current ? new FloorStateConflictError(floorId, prepared.previousState, current.state) : new FloorNotFoundError(floorId);
    }

    const transition = this.completeTransition(prepared, updated);
    await this.emitTransitionEvents(transition);

    return updated;
  }

  prepareTransition(
    floor: Pick<FloorEntity, 'id' | 'state'>,
    targetState: FloorState,
  ): PreparedFloorTransition {
    if (!this.canTransition(floor.state, targetState)) {
      throw new InvalidStateTransitionError(floor.state, targetState);
    }

    return {
      floorId: floor.id,
      previousState: floor.state,
      newState: targetState,
    };
  }

  completeTransition(
    prepared: PreparedFloorTransition,
    floor: FloorEntity,
  ): FloorTransitionResult {
    return {
      ...prepared,
      floor,
    };
  }

  async emitTransitionEvents(
    transition: FloorTransitionResult,
    options: EmitFloorTransitionOptions = {},
  ): Promise<void> {
    await this.eventBus.emit('floor.stateChanged', {
      floor: transition.floor,
      previousState: transition.previousState,
      newState: transition.newState,
    });

    if (transition.newState === 'committed') {
      await this.eventBus.emit('floor.committed', {
        floor: transition.floor,
        promotedVariables: options.promotedVariables ?? [],
      });
    }
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

    const prepared = this.prepareTransition(floor, 'failed');

    const updated = await this.floorRepo.updateStateCas(
      floorId,
      prepared.previousState,
      prepared.newState,
      Date.now(),
    );

    if (!updated) {
      const current = await this.floorRepo.findById(floorId);
      throw current ? new FloorStateConflictError(floorId, prepared.previousState, current.state) : new FloorNotFoundError(floorId);
    }

    await this.emitTransitionEvents(this.completeTransition(prepared, updated));

    await this.eventBus.emit('floor.failed', {
      floor: updated,
      error,
    });

    return updated;
  }
}
