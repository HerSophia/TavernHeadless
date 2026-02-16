import type { TimelineMessage } from "../../../stores/workspace";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

type UseWorkspaceCanvasMessagesOptions = {
  onUpdateMessageInput: (value: string) => void;
  resolveRuntimeCharacterName: () => string;
  t: Translator;
};

export const EMPTY_TIMELINE_SAMPLE = {
  assistant: [
    "她眯起眼，向陈列柜靠近了一步。环境光在黑曜石短刃周围出现了轻微弯折。",
    "“它在震动，”她压低声音说道，“这个共振特征不属于这个时代。”"
  ],
  user: "仔细看看这个房间。架子上的那些器物，有什么不寻常的吗？"
} as const;

export function useWorkspaceCanvasMessages(options: UseWorkspaceCanvasMessagesOptions) {
  function handleInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) {
      return;
    }

    options.onUpdateMessageInput(target.value);
  }

  function isAssistantSide(role: TimelineMessage["role"]): boolean {
    return role === "assistant" || role === "narrator" || role === "system";
  }

  function messageBadge(role: TimelineMessage["role"]): string {
    if (role === "assistant") {
      return "AI";
    }

    if (role === "narrator") {
      return "NAR";
    }

    if (role === "system") {
      return "SYS";
    }

    return "USR";
  }

  function messageLabel(role: TimelineMessage["role"]): string {
    if (role === "assistant") {
      return options.resolveRuntimeCharacterName();
    }

    if (role === "narrator") {
      return options.t("chat.narrator");
    }

    if (role === "system") {
      return options.t("chat.system");
    }

    return options.t("chat.user");
  }

  function canEditAndRegenerate(message: TimelineMessage): boolean {
    return !message.streaming && message.role === "user";
  }

  function canRetryFloor(message: TimelineMessage): boolean {
    return !message.streaming && message.role === "assistant" && Boolean(message.floorId);
  }

  return {
    canEditAndRegenerate,
    canRetryFloor,
    handleInput,
    isAssistantSide,
    messageBadge,
    messageLabel
  };
}
