import { describe, expect, it } from "vitest";

import {
  collectContextBlocks,
  type GraphContextSnapshot,
} from "./collect-context-blocks";
import {
  defaultContextConfig,
  normalizeContextConfig,
  type GraphAssistantContextConfig,
} from "./context-config";
import { renderDynamicPrompt } from "./render-dynamic-prompt";

function baseSnapshot(): GraphContextSnapshot {
  return {
    graphName: "示例图",
    nodeCount: 3,
    edgeCount: 2,
    groupCount:1,
    nodes: [
      { id: "intro",type: "phase.intro" },
      { id: "main", type: "phase.main", phase: "main" },
      { id: "outro", type: "phase.outro" },
    ],
    selection: {
      node: { id: "main", type: "phase.main", phase: "main" },
      nodeEntryLabel: "主线节点",
    },
    version: {
      baseVersionId: "v1",
      serverCurrentVersionId: "v2",
      dirty: true,
      versions: [
        { id: "v1", label: "初版" },
        { id: "v2", label: "二版" },
      ],
    },
    diagnostics: {
      items: [
        { severity: "error", message: "缺少入口", nodeId: "intro" },
        { severity: "warning", message: "未连接", nodeId: "outro" },
      ],
      errorCount: 1,
      warningCount: 1,
      valid: false,
    },
    project: { projectId: "proj_1", projectName: "我的项目" },
  };
}

describe("normalizeContextConfig", () => {
  it("缺配置时返回内置默认", () => {
    expect(normalizeContextConfig(null)).toEqual(defaultContextConfig());
    expect(normalizeContextConfig(undefined)).toEqual(defaultContextConfig());
  });

  it("脏值回退默认，合法值保留", () => {
    const config = normalizeContextConfig({
      graphSummary: { enabled: false, includeNodeList: true, maxNodes: -5 },
      diagnostics: { enabled: true, types: ["error", "bogus"], maxPerType: 3 },
      extraneous: { enabled: true },
    });
    expect(config.graphSummary.enabled).toBe(false);
    expect(config.graphSummary.includeNodeList).toBe(true);
    // maxNodes = -5 非法（< -1），回退默认 50。
    expect(config.graphSummary.maxNodes).toBe(50);
    // 过滤掉非法类型 bogus。
    expect(config.diagnostics.types).toEqual(["error"]);
    expect(config.diagnostics.maxPerType).toBe(3);
  });

it("maxNodes = -1 表示无限制，保留", () => {
    const config = normalizeContextConfig({ graphSummary: { maxNodes: -1 } });
    expect(config.graphSummary.maxNodes).toBe(-1);
  });
});

describe("collectContextBlocks", () => {
  it("默认配置下产出概要 / 选中 / 诊断，不产出版本 / 项目元信息", () => {
    const blocks= collectContextBlocks(baseSnapshot(), defaultContextConfig());
    expect(blocks.graphSummary).toBeTruthy();
    expect(blocks.selection).toBeTruthy();
    expect(blocks.diagnostics).toBeTruthy();
    expect(blocks.graphVersion).toBeUndefined();
expect(blocks.projectMeta).toBeUndefined();
  });

  it("含节点清单时按 maxNodes 裁剪并提示省略数", () => {
    const config = normalizeContextConfig({
      graphSummary: { enabled: true, includeNodeList: true, maxNodes: 2 },
    });
    const blocks = collectContextBlocks(baseSnapshot(), config);
    expect(blocks.graphSummary).toContain("节点清单：");
    expect(blocks.graphSummary).toContain("另有 1 个节点未列出");
  });

  it("未选中任何对象时不产出选中块", () => {
    const snapshot = baseSnapshot();
    snapshot.selection = {};
    const blocks = collectContextBlocks(snapshot, defaultContextConfig());
    expect(blocks.selection).toBeUndefined();
  });

  it("诊断块按勾选类型过滤条目", () => {
    const config = normalizeContextConfig({
      diagnostics: { enabled: true, types: ["error"], maxPerType: 10 },
    });
    const blocks = collectContextBlocks(baseSnapshot(), config);
    expect(blocks.diagnostics).toContain("错误：");
    expect(blocks.diagnostics).not.toContain("警告：");
  });

  it("开启版本块时产出版本信息", () => {
    const config: GraphAssistantContextConfig = {
      ...defaultContextConfig(),
      graphVersion: { enabled: true, maxVersions: 5 },
    };
    const blocks = collectContextBlocks(baseSnapshot(), config);
    expect(blocks.graphVersion).toContain("当前基线版本：v1");
    expect(blocks.graphVersion).toContain("历史版本：");
  });
});

describe("renderDynamicPrompt", () => {
  it("无模板时走默认模板，按固定顺序拼接非空块并带小标题", () => {
    const blocks = collectContextBlocks(baseSnapshot(), defaultContextConfig());
    const text = renderDynamicPrompt(blocks, "");
    expect(text).toContain("【图结构概要】");
    expect(text).toContain("【当前选中】");
    expect(text).toContain("【诊断信息】");
    // 顺序：概要在选中之前。
    expect(text.indexOf("【图结构概要】")).toBeLessThan(text.indexOf("【当前选中】"));
  });

  it("用户模板替换占位符", () => {
    const blocks = collectContextBlocks(baseSnapshot(), defaultContextConfig());
    const text = renderDynamicPrompt(blocks, "概要如下：\n{{graph_summary}}");
    expect(text).toContain("概要如下：");
    expect(text).toContain("示例图");
    expect(text).not.toContain("{{graph_summary}}");
  });

  it("空值降级：含无对应数据占位符的整行省略", () => {
    const snapshot =baseSnapshot();
    snapshot.selection = {};
    const blocks = collectContextBlocks(snapshot, defaultContextConfig());
   const text = renderDynamicPrompt(blocks, "选中：{{selection}}\n概要：{{graph_summary}}");
    // selection 缺席 → 该行整行省略，不出现原始占位符。
    expect(text).not.toContain("{{selection}}");
    expect(text).not.toContain("选中：");
    // graph_summary 有值 → 该行保留并替换。
    expect(text).toContain("概要：");
    expect(text).toContain("示例图");
  });

  it("无任何数据块时默认模板返回空串", () => {
    const text = renderDynamicPrompt({}, "");
    expect(text).toBe("");
  });
});
