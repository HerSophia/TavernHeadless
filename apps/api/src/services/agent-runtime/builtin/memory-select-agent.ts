/**
 * MemorySelectAgent（pre_response）。
 *
 * 职责：在现有memory injection / memory trace 基础上，为本回合生成轻量的
 * “必须带入 / 可省略” 选择结果。不直接写 memory truth。
 *
 * R1 采用确定性规则：把 trace 中已选中的记忆项视为 required，便于稳定与测试。
 */
import type {
  AgentProcessor,
  AgentRunContext,
  AgentRunOutput,
  InlineAgentSpec,
  MemorySelectionOverride,
} from "../inline-agent-types.js";

export class MemorySelectAgent implements AgentProcessor {
  constructor(public readonly spec: InlineAgentSpec) {}

  prepare(): void {
    return undefined;
  }

  execute(_prepared: unknown, context: AgentRunContext): AgentRunOutput {
    const selectedItems = context.memoryTrace?.selectedItems ?? [];
    const summary = context.memorySummary?.trim();

    if (selectedItems.length === 0 && !summary) {
      return { summary: "no memory selection available" };
    }

    const required = selectedItems
      .map((item) => item.memoryId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const selection: MemorySelectionOverride = {
      required,
      optional: [],
    };

    const content = summary
      ? summary
      : JSON.stringify(
          {
            selected_items: selectedItems.map((item) => ({
              memory_id: item.memoryId,
              scope: item.scope,
              kind: item.kind,
            })),
          },
          null,
          2,
        );

    return {
      contributor: {
        id:"agent:memory_selection",
        kind: "memory_selection",
        sourceKind: "memory",
        modeScope: context.promptMode === "native" ? "native" : "compat_plus",
        payload: {
          summary: summary ?? null,
          requiredCount: required.length,
        },
        promptRenderable: {
          title: "Memory selection",
          content,
        },
        trace: {
          deterministic: true,
          cacheScope: "floor",
        },
      },
      memorySelectionOverride: selection,
      summary: `memory selection prepared (required=${required.length})`,
    };
  }
}
