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

  /**
   * 幂等地把楼层推进到 generating。
   *
   * 若楼层已处于 generating（例如上层为抢占同一个共享 draft 楼层、
   * 防止并发请求互相覆盖而提前把它推进到 generating），直接返回当前实体，
   * 不再重复转换，避免非法的 generating → generating。
   *
   * 楼层处于 draft 时按正常 draft → generating 走 CAS 转换，保持并发安全。
   *
   * 楼层处于 committed 时，意味着上层在已提交楼层上重跑（楼层级 / step 级重试：产出新的
   * output page 版本、保留历史）。committed 是终态、常规转换禁止，这里委托reopenForRetry
   * 走唯一的显式重开入口（committed → generating）。executeTurn 仅在重试时才会遇到 committed
   * 楼层，因此这里不会削弱首次 respond / 普通回合的终态保护。
   *
   * 处于 failed 时仍会抛出 InvalidStateTransitionError。
   *
   * @throws {FloorNotFoundError} 楼层不存在
   * @throws {InvalidStateTransitionError} 楼层处于不可推进到 generating 的状态
   */
  async ensureGenerating(floorId: string): Promise<FloorEntity> {
    const floor = await this.floorRepo.findById(floorId);

    if (!floor) {
      throw new FloorNotFoundError(floorId);
    }

    if (floor.state === 'generating') {
      return floor;
    }

    if (floor.state === 'committed') {
      return this.reopenForRetry(floorId);
    }

    return this.transition(floorId, 'generating');
  }

  /** 便捷方法：generating → committed */
  async commit(floorId: string): Promise<FloorEntity> {
    return this.transition(floorId, 'committed');
  }

  /**
   * 重试专用：把已提交楼层重新打开到 generating。
*
   * committed 是终态，常规 VALID_TRANSITIONS 不允许 committed → generating。但楼层级 / step 级
   * 重试需要在同一楼层上重跑并产出新的 output page 版本（保留历史），因此这里提供唯一的显式重开
   * 入口，直接走 CAS committed → generating。已处于 generating（上层已重开或并发抢占）时幂等返回，
   * 避免非法的 generating → generating。
   *
   * @throws {FloorNotFoundError}楼层不存在
   * @throws {InvalidStateTransitionError} 楼层既非 committed 也非 generating
   * @throws {FloorStateConflictError} CAS 落空（并发状态漂移）
   */
  async reopenForRetry(floorId: string): Promise<FloorEntity> {
    const floor = await this.floorRepo.findById(floorId);

    if (!floor) {
      throw new FloorNotFoundError(floorId);
    }

    if (floor.state === 'generating') {
      return floor;
    }

    if (floor.state !== 'committed') {
      throw new InvalidStateTransitionError(floor.state, 'generating');
    }

    const updated = await this.floorRepo.updateStateCas(floorId, 'committed', 'generating', Date.now());

    if (!updated) {
      const current = await this.floorRepo.findById(floorId);
      throw current ? new FloorStateConflictError(floorId, 'committed', current.state) : new FloorNotFoundError(floorId);
    }

    await this.emitTransitionEvents(
      this.completeTransition({ floorId, previousState: 'committed', newState: 'generating' }, updated),
    );

    return updated;
  }

  /**
   * 重试失败 / 取消的回滚：把重开后仍处于 generating 的楼层还原回 committed。
   *
   * 重试是「非破坏性」的：失败时不应把楼层标为 failed（那会丢掉原本已提交的输出页历史），而应还原到
   * committed，让旧的 active output page 继续生效。仅当前确为 generating 时才动作；且不发 floor.committed
   * 事件（本次并无新内容提交，避免触发变量提升等提交副作用）。best-effort，不覆盖原始错误。
   */
  async restoreCommittedForRetry(floorId: string): Promise<void> {
    try {
      const floor = await this.floorRepo.findById(floorId);
      if (!floor || floor.state !== 'generating') {
        return;
      }
      await this.floorRepo.updateStateCas(floorId, 'generating', 'committed', Date.now());
    } catch {
      // best-effort 回滚，避免覆盖原始错误。
    }
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
