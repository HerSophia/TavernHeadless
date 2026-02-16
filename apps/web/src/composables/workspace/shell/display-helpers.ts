import type { SessionState } from "../../../stores/workspace";

type Locale = "zh-CN" | "en";

type UseWorkspaceDisplayHelpersOptions = {
  lang: {
    value: Locale;
  };
};

export function useWorkspaceDisplayHelpers(options: UseWorkspaceDisplayHelpersOptions) {
  function getSessionTitle(session: SessionState | null): string {
    if (!session) {
      return "";
    }

    return options.lang.value === "zh-CN" ? session.title.zh : session.title.en;
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function toggleLang(): void {
    options.lang.value = options.lang.value === "zh-CN" ? "en" : "zh-CN";
  }

  return {
    formatTime,
    getSessionTitle,
    toggleLang
  };
}
