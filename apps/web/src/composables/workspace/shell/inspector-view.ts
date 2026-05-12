export const workspaceInspectorTabs = ["bindings", "tools", "memory", "vc", "impact"] as const;

export type WorkspaceInspectorTab = (typeof workspaceInspectorTabs)[number];

export const workspaceInspectorTabLabelKeyMap: Record<WorkspaceInspectorTab, string> = {
  bindings: "inspector.tabs.bindings",
  impact: "inspector.tabs.impact",
  memory: "inspector.tabs.memory",
  tools: "inspector.tabs.tools",
  vc: "inspector.tabs.vc"
};

export function formatWorkspaceEventTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}
