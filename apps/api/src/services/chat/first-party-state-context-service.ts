import type { TurnExecutionResult, FloorRunType } from "@tavern/core";

import {
  FirstPartyGameStateServiceError,
  type FirstPartyGameStateService,
} from "../../session-state/first-party-game-state-service.js";
import type { FirstPartyStateResolutionMode } from "../../session-state/session-state-types.js";
import type {
  PromptRuntimeDiagnostic,
  PromptRuntimeDiagnosticPhase,
} from "../prompt-runtime-control-service.js";
import type { PromptRuntimeExecutionResult } from "../prompt-runtime-execution.js";

import type { FirstPartyStateContext, ChatServiceErrorFactory } from "./types.js";

export class FirstPartyStateContextService {
  constructor(
    private readonly firstPartyGameStateService: FirstPartyGameStateService | undefined,
    private readonly createError: ChatServiceErrorFactory,
  ) {}

  loadFirstPartyStateContext(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    sourceFloorId?: string | null;
    expectedSourceBranchId?: string | null;
    resolutionMode?: FirstPartyStateResolutionMode;
  }): FirstPartyStateContext {
    return {
      scene: this.loadFirstPartySceneContext(input),
      world: this.loadFirstPartyWorldContext(input),
    };
  }

  buildFirstPartyStateDiagnostics(
    firstPartyStateContext: FirstPartyStateContext | undefined,
    phase: PromptRuntimeDiagnosticPhase,
  ): PromptRuntimeDiagnostic[] {
    const diagnostics: PromptRuntimeDiagnostic[] = [];
    const scene = firstPartyStateContext?.scene;
    if (scene) {
      const floorMessage = scene.floorId ? ` at floor '${scene.floorId}'` : "";
      const message = scene.present
        ? `Managed scene context resolved from '${scene.source}'${floorMessage}.`
        : scene.source === "none"
          ? "Managed scene context is currently empty."
          : `Managed scene context baseline from '${scene.source}' is empty${floorMessage}.`;

      diagnostics.push({
        code: scene.present ? "managed_scene_context_loaded" : "managed_scene_context_empty",
        message,
        severity: "info",
        phase,
      });
    }

    const world = firstPartyStateContext?.world;
    if (world) {
      const floorMessage = world.floorId ? ` at floor '${world.floorId}'` : "";
      const message = world.present
        ? `Managed world context resolved from '${world.source}'${floorMessage}.`
        : world.source === "none"
          ? "Managed world context is currently empty."
          : `Managed world context baseline from '${world.source}' is empty${floorMessage}.`;

      diagnostics.push({
        code: world.present ? "managed_world_context_loaded" : "managed_world_context_empty",
        message,
        severity: "info",
        phase,
      });
    }

    return diagnostics;
  }

  stageExecutionState(args: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    runType: FloorRunType;
    execution: TurnExecutionResult;
    promptSnapshot?: NonNullable<PromptRuntimeExecutionResult["promptSnapshotRecord"]>;
  }): void {
    if (!this.firstPartyGameStateService) {
      return;
    }

    this.firstPartyGameStateService.stageSceneState({
      accountId: args.accountId,
      sessionId: args.sessionId,
      branchId: args.branchId,
      floorId: args.floorId,
      runType: args.runType,
      execution: args.execution,
    });
    this.firstPartyGameStateService.stageWorldState({
      accountId: args.accountId,
      sessionId: args.sessionId,
      branchId: args.branchId,
      floorId: args.floorId,
      runType: args.runType,
      execution: args.execution,
      promptSnapshot: args.promptSnapshot ? {
        worldbookId: args.promptSnapshot.worldbookId,
        worldbookVersion: args.promptSnapshot.worldbookVersion,
        worldbookActivatedEntryUids: [...args.promptSnapshot.worldbookActivatedEntryUids],
      } : undefined,
    });
  }

  private loadFirstPartySceneContext(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    sourceFloorId?: string | null;
    expectedSourceBranchId?: string | null;
    resolutionMode?: FirstPartyStateResolutionMode;
  }) {
    if (!this.firstPartyGameStateService) {
      return null;
    }

    try {
      return this.firstPartyGameStateService.loadSceneContext(input);
    } catch (error) {
      if (!(error instanceof FirstPartyGameStateServiceError)) {
        throw error;
      }

      switch (error.code) {
        case "first_party_scene_source_floor_not_found":
          throw this.createError("source_floor_not_found", error.message, error);
        case "first_party_scene_source_floor_not_committed":
        case "first_party_scene_source_floor_branch_mismatch":
          throw this.createError("invalid_state", error.message, error);
        case "first_party_scene_payload_invalid":
          throw this.createError(
            "invalid_state",
            `Managed scene state is invalid: ${error.message}`,
            error,
          );
        default:
          throw this.createError("invalid_state", error.message, error);
      }
    }
  }

  private loadFirstPartyWorldContext(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    sourceFloorId?: string | null;
    expectedSourceBranchId?: string | null;
    resolutionMode?: FirstPartyStateResolutionMode;
  }) {
    if (!this.firstPartyGameStateService) {
      return null;
    }

    try {
      return this.firstPartyGameStateService.loadWorldContext(input);
    } catch (error) {
      if (!(error instanceof FirstPartyGameStateServiceError)) {
        throw error;
      }

      switch (error.code) {
        case "first_party_world_source_floor_not_found":
          throw this.createError("source_floor_not_found", error.message, error);
        case "first_party_world_source_floor_not_committed":
        case "first_party_world_source_floor_branch_mismatch":
          throw this.createError("invalid_state", error.message, error);
        case "first_party_world_payload_invalid":
          throw this.createError(
            "invalid_state",
            `Managed world state is invalid: ${error.message}`,
            error,
          );
        default:
          throw this.createError("invalid_state", error.message, error);
      }
    }
  }
}
