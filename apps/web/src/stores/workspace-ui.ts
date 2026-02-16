import { defineStore } from "pinia";
import { ref } from "vue";

export type EventTone = "info" | "success" | "warn";

export type WorkspaceEvent = {
  at: number;
  key: string;
  tone: EventTone;
  vars?: Record<string, number | string>;
};

export type WorkspaceToast = {
  at: number;
  id: number;
  key: string;
  tone: EventTone;
  vars: Record<string, number | string>;
};

const EVENT_LIMIT = 8;
const TOAST_LIMIT = 4;
const TOAST_LIFETIME_MS = 2600;

export const useWorkspaceUiStore = defineStore("workspace-ui", () => {
  const events = ref<WorkspaceEvent[]>([]);
  const toasts = ref<WorkspaceToast[]>([]);
  const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

  function removeToast(toastId: number): void {
    const timer = toastTimers.get(toastId);
    if (timer !== undefined) {
      clearTimeout(timer);
      toastTimers.delete(toastId);
    }

    toasts.value = toasts.value.filter((toast) => toast.id !== toastId);
  }

  function clearToasts(): void {
    toastTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    toastTimers.clear();
    toasts.value = [];
  }

  function clearEvents(): void {
    events.value = [];
  }

  function resetFeedback(): void {
    clearEvents();
    clearToasts();
  }

  function pushToast(key: string, tone: EventTone, vars: Record<string, number | string>): void {
    const toastId = Date.now() + Math.floor(Math.random() * 1000);

    toasts.value.unshift({
      at: Date.now(),
      id: toastId,
      key,
      tone,
      vars
    });
    toasts.value = toasts.value.slice(0, TOAST_LIMIT);

    const timer = setTimeout(() => {
      removeToast(toastId);
    }, TOAST_LIFETIME_MS);

    toastTimers.set(toastId, timer);
  }

  function addEvent(key: string, tone: EventTone = "info", vars: Record<string, number | string> = {}): void {
    events.value.unshift({
      at: Date.now(),
      key,
      tone,
      vars
    });
    events.value = events.value.slice(0, EVENT_LIMIT);

    pushToast(key, tone, vars);
  }

  return {
    addEvent,
    clearEvents,
    clearToasts,
    events,
    resetFeedback,
    toasts
  };
});
