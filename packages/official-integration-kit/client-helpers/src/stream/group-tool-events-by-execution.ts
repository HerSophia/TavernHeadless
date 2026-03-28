import type { TavernRespondToolPayload } from "@tavern/sdk";

export type GroupedToolExecutionEvents = {
  durationMs?: number;
  events: TavernRespondToolPayload[];
  executionId: string;
  isTerminal: boolean;
  latest: TavernRespondToolPayload;
  message?: string;
  phases: TavernRespondToolPayload["phase"][];
  providerId: string;
  providerType?: TavernRespondToolPayload["providerType"];
  replaySafety: TavernRespondToolPayload["replaySafety"];
  sideEffectLevel?: TavernRespondToolPayload["sideEffectLevel"];
  toolName: string;
};

export function isTerminalToolPhase(phase: TavernRespondToolPayload["phase"]): boolean {
  return phase !== "start";
}

export function groupToolEventsByExecution(
  events: TavernRespondToolPayload[],
): GroupedToolExecutionEvents[] {
  const groups = new Map<string, GroupedToolExecutionEvents>();

  for (const event of events) {
    const existing = groups.get(event.executionId);
    if (!existing) {
      groups.set(event.executionId, {
        durationMs: event.durationMs,
        events: [event],
        executionId: event.executionId,
        isTerminal: isTerminalToolPhase(event.phase),
        latest: event,
        message: event.message,
        phases: [event.phase],
        providerId: event.providerId,
        providerType: event.providerType,
        replaySafety: event.replaySafety,
        sideEffectLevel: event.sideEffectLevel,
        toolName: event.toolName,
      });
      continue;
    }

    existing.events.push(event);
    existing.latest = event;
    existing.phases.push(event.phase);
    existing.isTerminal = isTerminalToolPhase(event.phase);
    existing.replaySafety = event.replaySafety;
    existing.providerType = event.providerType ?? existing.providerType;
    existing.sideEffectLevel = event.sideEffectLevel ?? existing.sideEffectLevel;
    existing.message = event.message ?? existing.message;
    existing.durationMs = event.durationMs ?? existing.durationMs;
  }

  return Array.from(groups.values());
}
