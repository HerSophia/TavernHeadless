import type { CoreEventBus, CoreEventMap, ExecutedToolCallRecord } from "@tavern/core";
import { evaluateToolReplaySafety } from "@tavern/core";

import type { RespondRuntimeOptions, RespondRuntimeToolEvent } from "./contracts.js";

export type ChatRuntimeEventBridgeOptions = Pick<RespondRuntimeOptions, "onTool" | "onRun">;

export class ChatRuntimeEventBridge {
  constructor(private readonly eventBus: CoreEventBus) {}

  subscribeFloorRunEvents(floorId: string, runtimeOptions: ChatRuntimeEventBridgeOptions): () => void {
    if (!runtimeOptions.onRun) {
      return () => {};
    }

    const forward = (event: CoreEventMap["floor.run.updated"] | CoreEventMap["floor.run.completed"] | CoreEventMap["floor.run.failed"]) => {
      if (event.floorId !== floorId) {
        return;
      }
      runtimeOptions.onRun?.(event);
    };

    const handleUpdated = (event: CoreEventMap["floor.run.updated"]) => forward(event);
    const handleCompleted = (event: CoreEventMap["floor.run.completed"]) => forward(event);
    const handleFailed = (event: CoreEventMap["floor.run.failed"]) => forward(event);

    this.eventBus.on("floor.run.updated", handleUpdated);
    this.eventBus.on("floor.run.completed", handleCompleted);
    this.eventBus.on("floor.run.failed", handleFailed);

    return () => {
      this.eventBus.off("floor.run.updated", handleUpdated);
      this.eventBus.off("floor.run.completed", handleCompleted);
      this.eventBus.off("floor.run.failed", handleFailed);
    };
  }

  subscribeRuntimeToolEvents(floorId: string, runtimeOptions: ChatRuntimeEventBridgeOptions): () => void {
    if (!runtimeOptions.onTool) {
      return () => {};
    }

    const handleStarted = (event: CoreEventMap["tool.call_started"]) => {
      if (event.floorId !== floorId) {
        return;
      }

      runtimeOptions.onTool?.(this.toRespondRuntimeToolEvent({
        executionId: event.executionId,
        toolName: event.toolName,
        providerId: event.providerId,
        providerType: event.providerType,
        sideEffectLevel: event.sideEffectLevel,
        status: "running",
        lifecycleState: "opened",
      }));
    };

    const handleCompleted = (event: CoreEventMap["tool.call_completed"]) => {
      if (event.floorId !== floorId) {
        return;
      }

      runtimeOptions.onTool?.(this.toRespondRuntimeToolEvent({
        executionId: event.executionId,
        toolName: event.toolName,
        providerId: event.providerId,
        providerType: event.providerType,
        sideEffectLevel: event.sideEffectLevel,
        status: event.status,
        lifecycleState: "finished",
        durationMs: event.durationMs,
      }));
    };

    const handleFailed = (event: CoreEventMap["tool.call_failed"]) => {
      if (event.floorId !== floorId) {
        return;
      }

      runtimeOptions.onTool?.(this.toRespondRuntimeToolEvent({
        executionId: event.executionId,
        toolName: event.toolName,
        providerId: event.providerId,
        providerType: event.providerType,
        sideEffectLevel: event.sideEffectLevel,
        status: event.status,
        lifecycleState: "finished",
        message: event.error.message,
        durationMs: event.durationMs,
      }));
    };

    const handleDenied = (event: CoreEventMap["tool.call_denied"]) => {
      if (event.floorId !== floorId) {
        return;
      }

      runtimeOptions.onTool?.(this.toRespondRuntimeToolEvent({
        executionId: event.executionId,
        toolName: event.toolName,
        providerId: event.providerId,
        providerType: event.providerType,
        sideEffectLevel: event.sideEffectLevel,
        status: event.status,
        lifecycleState: "finished",
        message: `Tool call denied: ${event.reason}`,
      }));
    };

    const handleAwaitingConfirmation = (event: CoreEventMap["tool.call_awaiting_confirmation"]) => {
      if (event.floorId !== floorId) {
        return;
      }

      // 待确认事件发生在执行之前，没有 executionId / providerId；
      // 以 callId 作为 executionId，providerId 缺失时置空串。
      runtimeOptions.onTool?.(this.toRespondRuntimeToolEvent({
        executionId: event.callId,
        toolName: event.toolName,
        providerId: event.providerId ?? "",
        ...(event.providerType ? { providerType: event.providerType } : {}),
        ...(event.sideEffectLevel ? { sideEffectLevel: event.sideEffectLevel } : {}),
        status: "running",
        lifecycleState: "opened",
        phaseOverride: "awaiting_confirmation",
     args: event.args,
        callId: event.callId,
   }));
    };

    this.eventBus.on("tool.call_started",handleStarted);
    this.eventBus.on("tool.call_completed", handleCompleted);
    this.eventBus.on("tool.call_failed", handleFailed);
    this.eventBus.on("tool.call_denied", handleDenied);
    this.eventBus.on("tool.call_awaiting_confirmation", handleAwaitingConfirmation);

    return () => {
      this.eventBus.off("tool.call_started", handleStarted);
       this.eventBus.off("tool.call_completed",handleCompleted);
      this.eventBus.off("tool.call_failed", handleFailed);
      this.eventBus.off("tool.call_denied", handleDenied);
      this.eventBus.off("tool.call_awaiting_confirmation", handleAwaitingConfirmation);
    };
  }

  private toRespondRuntimeToolEvent(input: {
    executionId: string;
    toolName: string;
    providerId: string;
    providerType?: string;
    sideEffectLevel?: string;
    status: "running" | CoreEventMap["tool.call_completed"]["status"] | CoreEventMap["tool.call_failed"]["status"] | CoreEventMap["tool.call_denied"]["status"];
    lifecycleState: "opened" | "finished";
    message?: string;
    durationMs?: number;
    phaseOverride?: RespondRuntimeToolEvent["phase"];
    args?: Record<string, unknown>;
    callId?: string;
  }): RespondRuntimeToolEvent {
    const evaluation = evaluateToolReplaySafety({
      providerId: input.providerId,
      providerType: input.providerType as ExecutedToolCallRecord["providerType"],
      toolName: input.toolName,
      sideEffectLevel: input.sideEffectLevel as ExecutedToolCallRecord["sideEffectLevel"],
      status: input.status,
      lifecycleState: input.lifecycleState,
    });

    return {
      executionId: input.executionId,
      toolName: input.toolName,
      providerId: input.providerId,
      providerType: input.providerType,
      sideEffectLevel: input.sideEffectLevel,
      phase: input.phaseOverride ?? (input.status === "running" ? "start" : input.status),
      ...(input.message ? { message: input.message } : {}),
      ...(typeof input.durationMs === "number" ? { durationMs: input.durationMs } : {}),
      ...(input.args ? { args: input.args } : {}),
      ...(input.callId ? { callId: input.callId } : {}),
      replaySafety: evaluation.replaySafety,
    };
  }
}
