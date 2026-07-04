/**
 * 图助手上下文数据块收集器（图助手 · 提示词阶段二）。
 *
 * 纯函数：输入一份「画布快照」与上下文配置，输出一组已开启且非空的数据块文本。
 * 不直接依赖 store，便于单测；store 侧负责把 graph-editor / context store 状态装配成快照。
 *
 * 每个数据块只在「开关开启」且「采集到有效内容」时出现。空内容不产出（例如未选中节点时
 * selection 块缺席），交由渲染层做空值降级。
 */
import {
  CONTEXT_BLOCK_KEYS,
  type ContextBlockKey,
  type GraphAssistantContextConfig,
} from "./context-config";

/** 画布快照：收集器的唯一输入来源，由 store 从 graph-editor / context 装配。 */
export interface GraphContextSnapshot {
  graphName?: string | null;
  nodeCount: number;
  edgeCount: number;
  groupCount: number;
  /** 节点清单（用于「含节点清单」时裁剪输出）。 */
  nodes: Array<{ id: string; type?: string | null; phase?: string | null }>;
 selection: {
    node?: { id: string; type?: string | null; phase?: string | null } | null;
    /** 选中节点的展示标签（如 registry中的人类可读名）。 */
    nodeEntryLabel?: string | null;
    edge?: { id: string; from: string; to: string } | null;
    group?: { id: string; name?: string | null } | null;
  };
  version: {
    baseVersionId?: string | null;
    serverCurrentVersionId?: string | null;
    dirty: boolean;
    versions: Array<{ id: string; label?: string | null; createdAt?: number | null }>;
  };
  diagnostics: {
    items: Array<{ severity: string; message: string; nodeId?: string | null }>;
    errorCount: number;
    warningCount: number;
    valid?: boolean | null;
  };
  project?: {
    projectId?: string | null;
    projectName?: string | null;
  };
}

/** 收集结果：键为数据块键，值为该块的文本；仅含已开启且非空的块。 */
export type ContextBlocks = Partial<Record<ContextBlockKey, string>>;

/** 按预算截断列表：limit < 0 表示无限制；否则取前limit 条。 */
function takeWithBudget<T>(items: T[], limit: number): T[] {
  if (limit < 0) {
    return items;
  }
  return items.slice(0, Math.max(0, limit));
}

function buildGraphSummary(
  snapshot: GraphContextSnapshot,
  config: GraphAssistantContextConfig["graphSummary"],
): string {
  const lines: string[] = [];
  const name = snapshot.graphName?.trim();
  lines.push(`图名称：${name && name.length > 0 ? name : "（未命名）"}`);
  lines.push(`规模：${snapshot.nodeCount} 个节点，${snapshot.edgeCount} 条连线，${snapshot.groupCount} 个组`);
  if (config.includeNodeList && snapshot.nodes.length > 0) {
  const picked = takeWithBudget(snapshot.nodes, config.maxNodes);
    if (picked.length > 0) {
      lines.push("节点清单：");
      for (const node of picked) {
        const parts = [node.id];
        if (node.type) {
          parts.push(node.type);
        }
        if (node.phase) {
          parts.push(`phase=${node.phase}`);
        }
        lines.push(`- ${parts.join(" · ")}`);
      }
      const omitted = snapshot.nodes.length - picked.length;
      if (omitted > 0) {
        lines.push(`- …另有 ${omitted} 个节点未列出`);
      }
    }
  }
  return lines.join("\n");
}

function buildSelection(snapshot: GraphContextSnapshot): string {
  const sel = snapshot.selection;
  const lines: string[] = [];
  if (sel.node) {
    const label = sel.nodeEntryLabel?.trim();
    const typeText = sel.node.type ? `（${sel.node.type}）` : "";
    lines.push(`选中节点：${label && label.length > 0 ? label : sel.node.id}${typeText}`);
    if (sel.node.phase) {
      lines.push(`所在 phase：${sel.node.phase}`);
    }
  }
  if (sel.edge) {
    lines.push(`选中连线：${sel.edge.from} → ${sel.edge.to}`);
  }
  if (sel.group) {
    const name = sel.group.name?.trim();
    lines.push(`选中组：${name && name.length > 0 ? name : sel.group.id}`);
  }
  return lines.join("\n");
}

function buildGraphVersion(
  snapshot: GraphContextSnapshot,
  config: GraphAssistantContextConfig["graphVersion"],
): string {
  const ver = snapshot.version;
  const lines: string[] = [];
  lines.push(`当前基线版本：${ver.baseVersionId ?? "（无）"}`);
  lines.push(`服务端最新版本：${ver.serverCurrentVersionId ?? "（无）"}`);
  lines.push(`本地草稿：${ver.dirty ? "有未保存改动" : "无未保存改动"}`);
  if (ver.versions.length > 0) {
    const picked = takeWithBudget(ver.versions,config.maxVersions);
  if (picked.length > 0) {
      lines.push("历史版本：");
      for (const item of picked) {
        const label = item.label?.trim();
lines.push(`- ${item.id}${label && label.length > 0 ? ` · ${label}` : ""}`);
      }
      const omitted = ver.versions.length - picked.length;
      if (omitted > 0) {
        lines.push(`- …另有 ${omitted} 个版本未列出`);
      }
    }
  }
  return lines.join("\n");
}

function buildDiagnostics(
  snapshot: GraphContextSnapshot,
  config: GraphAssistantContextConfig["diagnostics"],
): string {
  const diag = snapshot.diagnostics;
  const lines: string[] = [];
  lines.push(`校验状态：${diag.valid === false ? "未通过" : "通过"}`);
  lines.push(`错误 ${diag.errorCount} 个，警告 ${diag.warningCount} 个`);
  const wantError = config.types.includes("error");
  const wantWarning = config.types.includes("warning");
  for (const kind of ["error", "warning"] as const) {
    if (kind === "error" && !wantError) {
      continue;
    }
    if (kind === "warning" && !wantWarning) {
      continue;
    }
    const matched = diag.items.filter((item) => item.severity === kind);
    if (matched.length === 0) {
      continue;
    }
    const picked = takeWithBudget(matched, config.maxPerType);
    lines.push(kind === "error" ? "错误：" : "警告：");
    for (const item of picked) {
      const where = item.nodeId ? `[${item.nodeId}] ` : "";
      lines.push(`- ${where}${item.message}`);
    }
    const omitted = matched.length - picked.length;
    if (omitted > 0) {
      lines.push(`- …另有 ${omitted} 条未列出`);
    }
  }
  return lines.join("\n");
}

function buildProjectMeta(snapshot: GraphContextSnapshot): string {
  const project = snapshot.project;
  if (!project) {
    return "";
  }
  const lines: string[] = [];
  if (project.projectName?.trim()) {
    lines.push(`项目名称：${project.projectName.trim()}`);
  }
  if (project.projectId?.trim()) {
    lines.push(`项目 ID：${project.projectId.trim()}`);
  }
  return lines.join("\n");
}

/**
 * 按上下文配置从快照采集数据块。
 *
 * 只产出「开关开启」且「内容非空」的块。诊断块在未勾选任何问题类型时，
 * 仍会给出错误 / 警告计数概要（计数本身有信息量），但不列具体条目。
 */
export function collectContextBlocks(
  snapshot: GraphContextSnapshot,
  config: GraphAssistantContextConfig,
): ContextBlocks {
  const blocks: ContextBlocks = {};
  for (const key of CONTEXT_BLOCK_KEYS) {
    let text = "";
    switch (key) {
      case "graphSummary":
        if (config.graphSummary.enabled) {
          text = buildGraphSummary(snapshot, config.graphSummary);
        }
        break;
case "selection":
        if(config.selection.enabled) {
          text = buildSelection(snapshot);
        }
        break;
 case "graphVersion":
        if (config.graphVersion.enabled) {
          text = buildGraphVersion(snapshot, config.graphVersion);
        }
        break;
      case"diagnostics":
if (config.diagnostics.enabled) {
          text =buildDiagnostics(snapshot, config.diagnostics);
        }
break;
      case "projectMeta":
        if (config.projectMeta.enabled) {
          text = buildProjectMeta(snapshot);
        }
        break;
    }
    const trimmed = text.trim();
    if(trimmed.length > 0) {
      blocks[key] = trimmed;
    }
  }
  return blocks;
}
