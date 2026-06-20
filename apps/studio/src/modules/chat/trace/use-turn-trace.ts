/**
 * 回合 trace 拉取 composable（B10 阶段 8）。
 *
 * 按 floorId 聚合多源原始数据（floor run 快照 + promptRuntime 历史 explain），结合会话
 * promptMode（按会话缓存，供承载路径推断），适配为纯输入交 `mapTurnTrace` 归一。
 * 富数据（explain）不可得 / 受限时优雅降级（标 restricted），带 token 防竞态。
 */
import { ref, type Ref } from "vue";

import { chatApi } from "../../../lib/chat";
import { mapTurnTrace, type TurnTraceView } from "./map-trace";

function describeError(cause: unknown): string {
  if (cause && typeof cause === "object" && "message" in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return cause instanceof Error ? cause.message : String(cause);
}

export interface LoadTurnTraceParams {
  floorId: string;
  floorNo?: number | null;
  sessionId: string;
}

export function useTurnTrace(): {
  loading: Ref<boolean>;
  error: Ref<string | null>;
  trace: Ref<TurnTraceView | null>;
  load: (params: LoadTurnTraceParams) => Promise<void>;
} {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const trace = ref<TurnTraceView | null>(null);
  let token = 0;
  let promptModeCache: { sessionId: string; promptMode: string | null } | null = null;

  async function resolvePromptMode(sessionId: string): Promise<string | null> {
    if (promptModeCache?.sessionId === sessionId) {
      return promptModeCache.promptMode;
    }
    try {
      const detail = await chatApi.getSessionDetail(sessionId);
      promptModeCache = { sessionId, promptMode: detail.promptMode ?? null };
    } catch {
      promptModeCache = { sessionId, promptMode: null };
    }
    return promptModeCache.promptMode;
  }

  async function load(params: LoadTurnTraceParams): Promise<void> {
    const current = ++token;
    loading.value = true;
    error.value = null;
    try {
      const [promptMode, run, explain] = await Promise.all([
        resolvePromptMode(params.sessionId),
        chatApi.getFloorRun(params.floorId).catch(() => null),
        chatApi.getFloorExplain(params.floorId).catch(() => null),
      ]);
      if (current !== token) {
        return;
      }
      const verifier = run?.run?.verifier ?? explain?.result?.verifier ?? null;
      const usage = explain?.result?.usage ?? null;
      trace.value = mapTurnTrace({
        floorId: params.floorId,
        floorNo: params.floorNo ?? null,
        state: run?.state ?? null,
        promptMode,
        publicPhase: run?.run?.publicPhase ?? null,
        runStatus: run?.run?.status ?? null,
        runType: run?.run?.runType ?? null,
        error: run?.run?.error ?? null,
        verifier: verifier
          ? { status: verifier.status, issues: verifier.issues ?? null, suggestion: verifier.suggestion ?? null }
          : null,
        governance:
          explain?.governance?.entries?.map((entry) => ({
            sourceKind: entry.sourceKind,
            sections: entry.sectionNames,
            tokenCount: entry.tokenCount,
            retainedTokenCount: entry.retainedTokenCount,
            prunedTokenCount: entry.prunedTokenCount,
            pinned: entry.pinned,
          })) ?? null,
        summaries: explain?.result?.summaries ?? null,
        limitations: explain?.governance?.limitations ?? explain?.limitations ?? null,
        tokenUsage: usage
          ? { input: usage.promptTokens, output: usage.completionTokens, total: usage.totalTokens }
          : null,
        restricted: explain === null,
      });
    } catch (cause) {
      if (current === token) {
        error.value = describeError(cause);
        trace.value = null;
      }
    } finally {
      if (current === token) {
        loading.value = false;
      }
    }
  }

  return { loading, error, trace, load };
}
