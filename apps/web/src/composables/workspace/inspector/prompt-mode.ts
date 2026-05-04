import type { PromptRuntimeModeView, PromptRuntimeResource } from "@tavern/sdk";
import { computed, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from "vue";

import { apiClient } from "../../../lib/api";

type PromptRuntimeModeResourceLike = Pick<PromptRuntimeResource, "getMode" | "updateMode">;

type UseWorkspaceInspectorPromptModeOptions = {
  accountId: MaybeRefOrGetter<string>;
  resource?: PromptRuntimeModeResourceLike;
  sessionId: MaybeRefOrGetter<string | null | undefined>;
};

type PromptModeTarget = {
  accountId: string;
  sessionId: string;
};

type UseWorkspaceInspectorPromptModeResult = {
  error: Ref<string | null>;
  loading: Ref<boolean>;
  mode: Ref<PromptRuntimeModeView | null>;
  refresh: () => Promise<void>;
  saving: Ref<boolean>;
  updateMode: (promptMode: PromptRuntimeModeView["sessionPromptMode"]) => Promise<PromptRuntimeModeView | null>;
};

export function useWorkspaceInspectorPromptMode(
  options: UseWorkspaceInspectorPromptModeOptions,
): UseWorkspaceInspectorPromptModeResult {
  const resource = options.resource ?? apiClient.promptRuntime;
  const error = ref<string | null>(null);
  const loading = ref(false);
  const mode = ref<PromptRuntimeModeView | null>(null);
  const saving = ref(false);
  let requestVersion = 0;

  const target = computed<PromptModeTarget | null>(() => {
    const accountId = toValue(options.accountId)?.trim();
    const sessionId = toValue(options.sessionId)?.trim();

    if (!accountId || !sessionId) {
      return null;
    }

    return {
      accountId,
      sessionId,
    };
  });

  watch(
    target,
    () => {
      void refresh();
    },
    { immediate: true },
  );

  async function refresh(): Promise<void> {
    const currentTarget = target.value;
    const currentRequestVersion = ++requestVersion;

    if (!currentTarget) {
      mode.value = null;
      error.value = null;
      loading.value = false;
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      const result = await resource.getMode(currentTarget.sessionId, {
        accountId: currentTarget.accountId,
      });

      if (currentRequestVersion !== requestVersion) {
        return;
      }

      mode.value = result;
    } catch (cause) {
      if (currentRequestVersion !== requestVersion) {
        return;
      }

      error.value = cause instanceof Error ? cause.message : "Unknown error";
    } finally {
      if (currentRequestVersion === requestVersion) {
        loading.value = false;
      }
    }
  }

  async function updateMode(
    promptMode: PromptRuntimeModeView["sessionPromptMode"],
  ): Promise<PromptRuntimeModeView | null> {
    const currentTarget = target.value;
    if (!currentTarget) {
      return null;
    }

    saving.value = true;
    error.value = null;

    try {
      const result = await resource.updateMode(
        currentTarget.sessionId,
        { promptMode },
        { accountId: currentTarget.accountId },
      );
      mode.value = result;
      return result;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Unknown error";
      return null;
    } finally {
      saving.value = false;
    }
  }

  return {
    error,
    loading,
    mode,
    refresh,
    saving,
    updateMode,
  };
}
