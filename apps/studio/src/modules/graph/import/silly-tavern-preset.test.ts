import { describe, expect, it } from "vitest";

import { validateGraphDocument } from "../validate/local-validation";
import {
  importSillyTavernPreset,
  isSillyTavernPreset,
  parseSectionTag,
  parseSlotLabel,
  SILLY_TAVERN_OUTPUT_REGEX_RUNTIME_WARNING,
  SILLY_TAVERN_PRESET_REFERENCE_BINDING_WARNING,
  type SillyTavernPreset,
} from "./silly-tavern-preset";

function samplePreset(): SillyTavernPreset {
  return {
    name: "测试预设",
    temperature: 0.8,
    top_p: 0.95,
    frequency_penalty: 0.1,
    openai_max_tokens: 1024,
    openai_max_context: 32000,
    prompts: [
      { identifier: "main", name: "Main Prompt", role: "system", content: "你是叙事者。", marker: false, system_prompt: true },
      { identifier: "charDescription", name: "角色描述", role: "system", marker: true },
      { identifier: "chatHistory", name: "对话历史", role: "system", marker: true },
      { identifier: "jb", name: "越狱", role: "system", content: "保持角色。", marker: false, injection_position: 1, injection_depth: 4 },
      { identifier: "disabledOne", name: "禁用块", role: "user", content: "x", marker: false },
    ],
    prompt_order: [
      {
        character_id: 100000,
        order: [
          { identifier: "main", enabled: true },
          { identifier: "charDescription", enabled: true },
          { identifier: "chatHistory", enabled: true },
          { identifier: "disabledOne", enabled: false },
          { identifier: "jb", enabled: true },
          { identifier: "missingId", enabled: true },
        ],
      },
    ],
    extensions: {
      regex_scripts: [
        { scriptName: "清洗", findRegex: "/x/g", replaceString: "", promptOnly: true, markdownOnly: true },
      ],
    },
  };
}

/** 采用社区命名约定（`图标︱类别-子名`）的预设，全部 authored UUID slot。 */
function lunarPreset(): SillyTavernPreset {
  return {
    name: "月食",
    prompts: [
      { identifier: "main", name: "Main Prompt", role: "user", content: "x", marker: false },
      { identifier: "u1", name: "🖨︱模块-小总结", role: "user", content: "a" },
      { identifier: "u2", name: "📚︱模块-格式姬", role: "user", content: "b" },
      { identifier: "u3", name: "🤿︱设置-用户第一人称", role: "user", content: "c" },
      { identifier: "u4", name: "💬丨设置-字数", role: "user", content: "d" },
      { identifier: "u5", name: "⭐︱独立图标无前缀", role: "user", content: "e" },
    ],
    prompt_order: [
      {
        character_id: 1,
        order: [
          { identifier: "main", enabled: true },
          { identifier: "u1", enabled: false },
          { identifier: "u2", enabled: false },
          { identifier: "u3", enabled: false },
          { identifier: "u4", enabled: true },
          { identifier: "u5", enabled: false },
        ],
      },
    ],
  };
}

/** 含成对 XML 分节标签与前导图标命名的预设，用于验证严格/宽松聚类。 */
function sectionPreset(): SillyTavernPreset {
  return {
    name: "分节预设",
    prompts: [
     { identifier: "u_open", name: "<user>", role: "system", content: "<user>", marker: false },
      { identifier: "charDescription", name: "角色描述", role: "system", marker: true },
      { identifier: "u_close", name: "</user>", role: "system", content: "</user>", marker: false },
      { identifier: "f1", name: "▪文风1-感知特化", role: "system", content: "a", marker: false },
      { identifier: "f2", name: "▪文风2-感情特化", role: "system", content: "b", marker: false },
      { identifier: "f3", name: "▪文风3-语言特化", role: "system", content: "c", marker: false },
      { identifier: "s1", name: "🖋Sigon-定制", role: "system", content: "d", marker: false },
      { identifier: "s2", name: "💭Sigon-建议", role: "system", content: "e", marker: false },
    ],
    prompt_order: [
      {
        character_id: 1,
        order: [
          { identifier: "u_open", enabled: true },
          { identifier: "charDescription", enabled: true },
          { identifier: "u_close", enabled: true },
          { identifier: "f1", enabled: true },
          { identifier: "f2", enabled: true },
          { identifier: "f3", enabled: true },
          { identifier: "s1", enabled: true },
          { identifier: "s2", enabled: true },
        ],
      },
    ],
  };
}

describe("parseSlotLabel", () => {
  it("splits leading icon (vertical-bar family) and category prefix", () => {
    expect(parseSlotLabel("🖨︱模块-小总结")).toEqual({ icon: "🖨", category: "模块", label: "模块-小总结" });
    expect(parseSlotLabel("🎏丨界面-行动选项")).toEqual({ icon: "🎏", category: "界面", label: "界面-行动选项" });
    // 间隔号也算前缀分隔符。
    expect(parseSlotLabel("🔑︱定位·复用组件")).toEqual({ icon: "🔑", category: "定位", label: "定位·复用组件" });
  });

  it("keeps icon-only names (no category) and plain names", () => {
    expect(parseSlotLabel("⭐︱纯文字")).toEqual({ icon: "⭐", label: "纯文字" });
    expect(parseSlotLabel("SPreset配置")).toEqual({ label: "SPreset配置" });
    expect(parseSlotLabel("")).toEqual({ label: "" });
  });

  it("strips a leading icon even without a vertical-bar separator", () => {
    expect(parseSlotLabel("▪文风2-感情特化")).toEqual({ icon: "▪", category: "文风2", label: "文风2-感情特化" });
    expect(parseSlotLabel("🖋Sigon-专属定制文风")).toEqual({ icon: "🖋", category: "Sigon", label: "Sigon-专属定制文风" });
    expect(parseSlotLabel("🕰时间框")).toEqual({ icon: "🕰", label: "时间框" });
  });

  it("does not strip a leading '<' (treats XML tag block name verbatim)", () => {
    expect(parseSlotLabel("<user>")).toEqual({ label: "<user>" });
  });
});

describe("parseSectionTag", () => {
  it("recognizes paired XML tag blocks", () => {
    expect(parseSectionTag({ identifier: "a", name: "<user>" })).toEqual({ kind: "open", tag: "user" });
    expect(parseSectionTag({ identifier: "b", name: "</user>" })).toEqual({ kind: "close", tag: "user" });
    expect(parseSectionTag({ identifier: "c", name: "<Order>" })).toEqual({ kind: "open", tag: "Order" });
  });

  it("returns undefined for non-tag blocks", () => {
    expect(parseSectionTag({ identifier: "d", name: "main prompt" })).toBeUndefined();
    expect(parseSectionTag({ identifier: "e", name: "▪文风2-感情特化" })).toBeUndefined();
  });
});

describe("isSillyTavernPreset", () => {
  it("accepts an object with a prompts array", () => {
    expect(isSillyTavernPreset(samplePreset())).toBe(true);
    expect(isSillyTavernPreset({ prompts: [] })).toBe(true);
  });

  it("rejects non-preset shapes", () => {
    expect(isSillyTavernPreset(null)).toBe(false);
    expect(isSillyTavernPreset({})).toBe(false);
    expect(isSillyTavernPreset({ prompts: "nope" })).toBe(false);
    expect(isSillyTavernPreset([])).toBe(false);
  });
});

describe("importSillyTavernPreset", () => {
  it("throws on non-preset input", () => {
    expect(() => importSillyTavernPreset({ foo: 1 })).toThrow("not_a_sillytavern_preset");
  });

  it("maps prompts + order into an executable Narrator graph", () => {
    const result = importSillyTavernPreset(samplePreset());

    // 干净可执行（与后端同源校验）。
    const validation = validateGraphDocument(result.document);
    expect(validation.counts.error).toBe(0);
    expect(validation.isExecutable).toBe(true);

    // main / jb / disabledOne → 3 个 template_render 块（禁用位保留）；
    // charDescription marker → source.character + text_to_block 语义插槽；chatHistory → 历史；missingId 跳过。
    expect(result.summary.blockCount).toBe(3);
    expect(result.summary.slotNodeCount).toBe(1);
    expect(result.summary.disabledCount).toBe(1);
    expect(result.summary.hasHistory).toBe(true);
    expect(result.summary.skippedCount).toBe(1);
    expect(result.warnings.some((w) => w.includes("missingId"))).toBe(true);

    // 节点：3 块 + (source.character + text_to_block) + 历史 + 用户输入 + compose + narrator + commit = 10。
    expect(result.document.nodes).toHaveLength(10);
    expect(result.document.nodes.filter((n) => n.type === "compose.template_render")).toHaveLength(3);
    expect(result.document.nodes.filter((n) => n.type === "source.character")).toHaveLength(1);
    expect(result.document.nodes.filter((n) => n.type === "compose.text_to_block")).toHaveLength(1);
    expect(result.document.nodes.some((n) => n.type === "source.chat_history")).toBe(true);
    expect(result.document.nodes.filter((n) => n.type === "source.user_input")).toHaveLength(1);
    expect(result.document.nodes.filter((n) => n.type === "narration.narrator")).toHaveLength(1);
    expect(result.document.nodes.some((n) => n.type === "output.commit_gate")).toBe(true);

    // 边：3 块→compose + slot(source→t2b, t2b→compose) + 历史→compose + 用户输入→narrator + compose→narrator + narrator→commit = 9。
    expect(result.document.edges).toHaveLength(9);
  });

  it("wires a source.user_input into the narrator's required user_input port", () => {
    const result = importSillyTavernPreset(samplePreset());

    const userInput = result.document.nodes.find((n) => n.id === "n_user_input");
    expect(userInput?.type).toBe("source.user_input");
    expect(userInput?.phase).toBe("pre_response");

    const edge = result.document.edges.find((e) => e.id === "e_user_input_narrator");
    expect(edge?.from).toEqual({ nodeId: "n_user_input", port: "text" });
    expect(edge?.to).toEqual({ nodeId: "n_narrator", port: "user_input" });

    // 用户输入源不归入 Narrator 主体组（保持 g_narrator 只含 compose + narrator）。
    const narratorGroup = result.document.groups?.find((g) => g.id === "g_narrator");
    expect(narratorGroup?.nodeIds).not.toContain("n_user_input");

    expect(validateGraphDocument(result.document).isExecutable).toBe(true);
  });

  it("clusters slots into subgraph groups by system function, keeping disabled slots", () => {
    const result = importSillyTavernPreset(samplePreset());

    // 聚类：system[main] + character[charDescription] + custom[disabledOne, jb] = 3 个功能组。
    expect(result.summary.groupCount).toBe(3);
    // 功能组 + Narrator 主体组 = 4。
    expect(result.document.groups).toHaveLength(4);
    expect(result.document.groups?.every((g) => g.kind === "subgraph")).toBe(true);
    // 导入的子图组默认折叠 → 外部表现为单节点（Blender 式）。
    expect(result.document.groups?.every((g) => g.collapsed === true)).toBe(true);

    const narratorGroup = result.document.groups?.find((g) => g.id === "g_narrator");
    expect(narratorGroup?.nodeIds).toEqual(["n_compose", "n_narrator"]);

    // 禁用 slot 保留为 enabled:false 块（仍在某个功能组内）。
    const disabled = result.document.nodes.filter((n) => n.enabled === false);
    expect(disabled).toHaveLength(1);
    expect((disabled[0]?.config as { identifier?: string })?.identifier).toBe("disabledOne");
    const grouped = new Set(result.document.groups?.flatMap((g) => g.nodeIds) ?? []);
    expect(grouped.has(disabled[0]!.id)).toBe(true);
  });

  it("captures sampling params and regex onto the narrator config", () => {
    const result = importSillyTavernPreset(samplePreset());
    const narrator = result.document.nodes.find((n) => n.type === "narration.narrator");
    const config = narrator?.config as
      | { presetName?: string; sampling?: Record<string, number>; outputRegex?: unknown[] }
      | undefined;

    expect(config?.presetName).toBe("测试预设");
    expect(config?.sampling?.temperature).toBe(0.8);
    expect(config?.sampling?.topP).toBe(0.95);
    expect(config?.sampling?.maxTokens).toBe(1024);
    expect(config?.sampling?.maxContext).toBe(32000);
    expect(result.summary.samplerKeys).toContain("temperature");
    expect(result.summary.samplerKeys).toContain("maxTokens");

    expect(result.summary.regexCount).toBe(1);
    expect(config?.outputRegex).toHaveLength(1);
  });

  it("carries authored content onto block config; marker slots become semantic source nodes", () => {
    const result = importSillyTavernPreset(samplePreset());
    const blocks = result.document.nodes.filter((n) => n.type === "compose.template_render");

    const main = blocks.find((n) => (n.config as { identifier?: string })?.identifier === "main");
    expect((main?.config as { content?: string })?.content).toBe("你是叙事者。");

    // charDescription 不再是 template_render 块，而是 source.character 语义源节点。
    expect(blocks.some((n) => (n.config as { identifier?: string })?.identifier === "charDescription")).toBe(false);
    const charSource = result.document.nodes.find(
      (n) => n.type === "source.character" && (n.config as { identifier?: string })?.identifier === "charDescription",
    );
    expect(charSource).toBeDefined();
    expect((charSource?.config as { part?: string })?.part).toBe("description");
  });

  it("keeps only prompt-relevant fields and drops redundant promptName", () => {
    const result = importSillyTavernPreset(samplePreset());
    const blocks = result.document.nodes.filter((n) => n.type === "compose.template_render");

    const main = blocks.find((n) => (n.config as { identifier?: string })?.identifier === "main");
    // system_prompt → systemPrompt（提示词语义）。
    expect((main?.config as { systemPrompt?: boolean })?.systemPrompt).toBe(true);
    // promptName 已移除（与 node.name 重复）。
    expect((main?.config as { promptName?: unknown })?.promptName).toBeUndefined();

    const jb = blocks.find((n) => (n.config as { identifier?: string })?.identifier === "jb");
    // injection_position/depth → injection（编排语义，非提示词正文）。
    expect((jb?.config as { injection?: { position: number; depth?: number } })?.injection).toEqual({
      position: 1,
      depth: 4,
    });
  });

  it("assigns prompt_order-aligned positions without overlaps", () => {
    const result = importSillyTavernPreset(samplePreset());
    const blocks = result.document.nodes.filter((n) => n.type === "compose.template_render");

    // 所有提示块同列（x=0）、各有纵坐标，自上而下铺排。
    expect(blocks.every((n) => n.ui?.position?.x === 0)).toBe(true);
    expect(blocks.every((n) => typeof n.ui?.position?.y === "number")).toBe(true);

    // 装配/叙事在右侧列（x>0），体现阶段顺序。
    const compose = result.document.nodes.find((n) => n.id === "n_compose");
    expect(compose?.ui?.position?.x ?? 0).toBeGreaterThan(0);

    // 已落位节点坐标互不重叠（折叠进入后不会叠在一起）。
    const positioned = result.document.nodes.filter((n) => n.ui?.position);
    const keys = new Set(positioned.map((n) => `${n.ui!.position!.x}:${n.ui!.position!.y}`));
    expect(keys.size).toBe(positioned.length);
  });

  it("falls back to prompts order when prompt_order is absent", () => {
    const preset: SillyTavernPreset = {
      prompts: [
        { identifier: "a", name: "A", content: "alpha", marker: false },
        { identifier: "b", name: "B", content: "beta", marker: false },
      ],
    };
    const result = importSillyTavernPreset(preset, { name: "无序预设" });
    expect(result.document.name).toBe("无序预设");
    expect(result.summary.blockCount).toBe(2);
    expect(result.summary.disabledCount).toBe(0);
    expect(result.summary.hasHistory).toBe(false);
    // a/b 均落入 custom 聚类 → 1 个功能组 + Narrator 主体组。
    expect(result.summary.groupCount).toBe(1);
    expect(result.document.groups).toHaveLength(2);
    expect(validateGraphDocument(result.document).isExecutable).toBe(true);
  });

  it("clusters authored slots by community naming convention (prefix, then icon)", () => {
    const result = importSillyTavernPreset(lunarPreset());

    // system[main] + 模块[u1,u2] + 设置[u3,u4] + 图标⭐[u5] = 4 个功能组。
    expect(result.summary.groupCount).toBe(4);
    const byName = (name: string) => result.document.groups?.find((g) => g.name === name);

    const moduleGroup = byName("模块");
    const settingGroup = byName("设置");
    const iconGroup = byName("⭐");
    expect(moduleGroup?.nodeIds).toHaveLength(2);
    expect(settingGroup?.nodeIds).toHaveLength(2);
    expect(iconGroup?.nodeIds).toHaveLength(1);

    // 块携带解析出的图标与类别，供 UI 渲染与归属溯源。
    const u1 = result.document.nodes.find((n) => (n.config as { identifier?: string })?.identifier === "u1");
    expect(u1?.name).toBe("模块-小总结");
    expect((u1?.config as { icon?: string; category?: string })?.icon).toBe("🖨");
    expect((u1?.config as { category?: string })?.category).toBe("模块");

    expect(validateGraphDocument(result.document).isExecutable).toBe(true);
  });

  it("derives the group switch (enabled) from member nodes", () => {
    const result = importSillyTavernPreset(lunarPreset());
    const byName = (name: string) => result.document.groups?.find((g) => g.name === name);

    // 模块[u1,u2] 全禁用 → 组关（enabled:false）。
    expect(byName("模块")?.enabled).toBe(false);
    // 图标⭐[u5] 全禁用 → 组关。
    expect(byName("⭐")?.enabled).toBe(false);
    // 设置[u3 禁用, u4 启用] → 混合 → 不写 enabled（缺省开，UI 呈现 mixed）。
    expect(byName("设置")?.enabled).toBeUndefined();
    // 系统[main] 启用 → 缺省开。
    expect(byName("系统与越狱")?.enabled).toBeUndefined();
    // Narrator 主体组始终开。
    expect(result.document.groups?.find((g) => g.id === "g_narrator")?.enabled).toBeUndefined();
  });

  it("defaults to loose clustering when mode is unspecified", () => {
    const result = importSillyTavernPreset(sectionPreset());
    expect(result.summary.clusterMode).toBe("loose");
  });

  it("loose mode merges numeric-suffixed categories and groups across positions", () => {
    const result = importSillyTavernPreset(sectionPreset(), { clusterMode: "loose" });
    const byName = (name: string) => result.document.groups?.find((g) => g.name === name);

    expect(result.summary.clusterMode).toBe("loose");
    // 文风1/2/3 → 归一化为一个「文风」组。
    expect(byName("文风")?.nodeIds).toHaveLength(3);
    // 不同图标的 Sigon 两块聚到一起。
    expect(byName("Sigon")?.nodeIds).toHaveLength(2);
    // custom(<user>,</user>) + character(角色描述) + 文风 + Sigon = 4 个功能组。
    expect(result.summary.groupCount).toBe(4);
    expect(validateGraphDocument(result.document).isExecutable).toBe(true);
  });

  it("strict mode keeps order, honoring XML sections and grouping only adjacent same-kind blocks", () => {
    const result = importSillyTavernPreset(sectionPreset(), { clusterMode: "strict" });
    const byName = (name: string) => result.document.groups?.find((g) => g.name === name);

    expect(result.summary.clusterMode).toBe("strict");
    // <user>…</user> 分节 → 名为 user 的组（两个标签块 + charDescription 语义插槽的 source + text_to_block）。
    expect(byName("user")?.nodeIds).toHaveLength(4);
    // 文风1/2/3 不归一化、各自成组（保序、相邻但类别不同）。
    expect(byName("文风1")?.nodeIds).toHaveLength(1);
    expect(byName("文风2")?.nodeIds).toHaveLength(1);
    expect(byName("文风3")?.nodeIds).toHaveLength(1);
    // 相邻同类 Sigon 合并为一组。
    expect(byName("Sigon")?.nodeIds).toHaveLength(2);
    // user + 文风1 + 文风2 + 文风3 + Sigon = 5 个功能组。
    expect(result.summary.groupCount).toBe(5);
    expect(validateGraphDocument(result.document).isExecutable).toBe(true);
  });

  it("marks the default import purpose as narrator_graph", () => {
    const result = importSillyTavernPreset(samplePreset());
    expect(result.document.metadata?.importedFrom).toBe("sillytavern_openai_preset");
    expect(result.document.metadata?.importPurpose).toBe("narrator_graph");
  });

  it("marks a compat floor import without pretending to be the built-in compat template", () => {
    const result = importSillyTavernPreset(samplePreset(), { purpose: "compat_floor_graph" });
    expect(result.document.metadata?.importPurpose).toBe("compat_floor_graph");
    expect(result.document.metadata?.template).toBeUndefined();
    expect(result.document.mode).toBe("native_graph");
  });

  it("keeps compat floor imports within FG1 compat binding limits", () => {
    const result = importSillyTavernPreset(samplePreset(), { purpose: "compat_floor_graph" });
    const validation = validateGraphDocument(result.document);
    const permissions = (result.document as { permissions?: { required?: unknown[] } }).permissions;

    expect(result.document.nodes.some((node) => node.type.startsWith("agent."))).toBe(false);
    expect(result.document.nodes.some((node) => node.type.startsWith("verify."))).toBe(false);
    expect(permissions?.required ?? []).toHaveLength(0);
    expect(result.document.nodes.filter((node) => node.type === "narration.narrator")).toHaveLength(1);
    expect(validation.counts.error).toBe(0);
    expect(validation.isExecutable).toBe(true);
  });

  it("warns that imported outputRegex is stored but not executed", () => {
    const result = importSillyTavernPreset(samplePreset());
    expect(result.warnings).toContain(SILLY_TAVERN_OUTPUT_REGEX_RUNTIME_WARNING);

    const withoutRegex = samplePreset();
    delete withoutRegex.extensions;
    delete withoutRegex.regex_scripts;
    const second = importSillyTavernPreset(withoutRegex);
    expect(second.summary.regexCount).toBe(0);
    expect(second.warnings).not.toContain(SILLY_TAVERN_OUTPUT_REGEX_RUNTIME_WARNING);
  });

});

// NG2-10 整体引用（preset_reference）：不打散预设、产瘦承载图、narrator source:'preset'。
describe("importSillyTavernPreset · preset_reference", () => {
  it("produces a thin carrier graph without exploding prompt blocks", () => {
    const result = importSillyTavernPreset(samplePreset(), { purpose: "preset_reference" });

    // 干净可执行（与后端同源校验），零 error。
    const validation = validateGraphDocument(result.document);
    expect(validation.counts.error).toBe(0);
    expect(validation.isExecutable).toBe(true);

    // 不打散：无任何 template_render / 语义源节点 / 历史节点。
    expect(result.document.nodes.some((n) => n.type === "compose.template_render")).toBe(false);
    expect(result.document.nodes.some((n) => n.type === "source.character")).toBe(false);
    expect(result.document.nodes.some((n) => n.type === "source.chat_history")).toBe(false);

    // 瘦承载图骨架：user_input + compose + narrator + commit = 4 节点、3 边。
    expect(result.document.nodes).toHaveLength(4);
    expect(result.document.edges).toHaveLength(3);
    expect(result.document.nodes.filter((n) => n.type === "source.user_input")).toHaveLength(1);
    expect(result.document.nodes.filter((n) => n.type === "compose.final_messages")).toHaveLength(1);
    expect(result.document.nodes.filter((n) => n.type === "narration.narrator")).toHaveLength(1);
    expect(result.document.nodes.filter((n) => n.type === "output.commit_gate")).toHaveLength(1);

    // narrator 固定为预设承载来源。
    const narrator = result.document.nodes.find((n) => n.type === "narration.narrator");
    const config = narrator?.config as { source?: string; presetName?: string } | undefined;
    expect(config?.source).toBe("preset");
    expect(config?.presetName).toBe("测试预设");

    // 元数据标注整体引用；未打散 → 计数为 0。
    expect(result.document.metadata?.importPurpose).toBe("preset_reference");
    expect(result.document.metadata?.importedFrom).toBe("sillytavern_openai_preset");
    expect(result.summary.blockCount).toBe(0);
    expect(result.summary.slotNodeCount).toBe(0);
    expect(result.summary.groupCount).toBe(0);
  });

  it("embeds a provided presetRef (version defaults to null)", () => {
    const result = importSillyTavernPreset(samplePreset(), {
      purpose: "preset_reference",
      presetRef: { presetId: "preset-abc" },
    });
    const narrator = result.document.nodes.find((n) => n.type === "narration.narrator");
    const config = narrator?.config as
      | { source?: string; presetRef?: { presetId?: string; presetVersionId?: string | null } }
      | undefined;

    expect(config?.source).toBe("preset");
    expect(config?.presetRef).toEqual({ presetId: "preset-abc", presetVersionId: null });
    // 已绑定 → 不触发绑定提示 warning。
    expect(result.warnings).not.toContain(SILLY_TAVERN_PRESET_REFERENCE_BINDING_WARNING);
    expect(validateGraphDocument(result.document).counts.error).toBe(0);
  });

  it("embeds an explicit presetVersionId when provided", () => {
    const result = importSillyTavernPreset(samplePreset(), {
      purpose: "preset_reference",
      presetRef: { presetId: "preset-abc", presetVersionId: "v3" },
    });
    const narrator = result.document.nodes.find((n) => n.type === "narration.narrator");
    const config = narrator?.config as { presetRef?: { presetId?: string; presetVersionId?: string | null } } | undefined;
    expect(config?.presetRef).toEqual({ presetId: "preset-abc", presetVersionId: "v3" });
  });

  it("omits presetRef and warns to bind when none is provided", () => {
    const result = importSillyTavernPreset(samplePreset(), { purpose: "preset_reference" });
    const narrator = result.document.nodes.find((n) => n.type === "narration.narrator");
    const config = narrator?.config as { source?: string; presetRef?: unknown } | undefined;

    expect(config?.source).toBe("preset");
    expect(config?.presetRef).toBeUndefined();
    expect(result.warnings).toContain(SILLY_TAVERN_PRESET_REFERENCE_BINDING_WARNING);
    // 无 presetRef 仍合法可执行（回退会话预设）。
    expect(validateGraphDocument(result.document).isExecutable).toBe(true);
  });

  it("ignores clusterMode and reports it verbatim in the summary", () => {
    const result = importSillyTavernPreset(samplePreset(), { purpose: "preset_reference", clusterMode: "strict" });
    // 未打散 → 无功能组，仅 Narrator 主体组。
    expect(result.document.groups).toHaveLength(1);
    expect(result.document.groups?.[0]?.id).toBe("g_narrator");
    expect(result.summary.groupCount).toBe(0);
    expect(result.summary.clusterMode).toBe("strict");
  });

  it("keeps the two existing purposes byte-identical (zero regression)", () => {
    const preset = samplePreset();
    // 默认用途与显式 narrator_graph 不因新增分支而改变产物。
    const defaultResult = importSillyTavernPreset(preset);
    const narratorResult = importSillyTavernPreset(preset, { purpose: "narrator_graph" });
    expect(JSON.stringify(narratorResult.document)).toBe(JSON.stringify(defaultResult.document));
    expect(defaultResult.document.metadata?.importPurpose).toBe("narrator_graph");

    const compatResult = importSillyTavernPreset(preset, { purpose: "compat_floor_graph" });
    expect(compatResult.document.metadata?.importPurpose).toBe("compat_floor_graph");
    // compat 仍打散（与 preset_reference 分支互不影响）。
    expect(compatResult.document.nodes.some((n) => n.type === "compose.template_render")).toBe(true);
  });
});

describe("importSillyTavernPreset: preset hash metadata", () => {
  it("writes the provided presetHash into document.metadata", () => {
    const result = importSillyTavernPreset(samplePreset(), { presetHash: "abc123" });
    expect(result.document.metadata?.presetHash).toBe("abc123");
  });

  it("omits presetHash from metadata when not provided", () => {
    const result = importSillyTavernPreset(samplePreset());
    expect(result.document.metadata?.presetHash).toBeUndefined();
  });
});

describe("importSillyTavernPreset: preset source of truth", () => {
  it("stores the raw preset and applied clusterMode in document.metadata", () => {
    const preset = samplePreset();
    const result = importSillyTavernPreset(preset, { clusterMode: "strict" });
    expect(result.document.metadata?.clusterMode).toBe("strict");
    // 原始预设作为真值来源存入 metadata.presetSource，供重新聚类与核对。
    const source = result.document.metadata?.presetSource as SillyTavernPreset | undefined;
    expect(source).toBeDefined();
    expect(source?.name).toBe(preset.name);
    expect(source?.prompts).toHaveLength(preset.prompts?.length ?? 0);
    expect(source?.prompt_order).toEqual(preset.prompt_order);
  });

  it("deep-clones the preset so later input mutation does not affect the stored source", () => {
    const preset = samplePreset();
    const result = importSillyTavernPreset(preset);
    // 突变调用方输入：存储的源头不应受影响（深拷贝）。
    preset.prompts![0]!.content = "mutated";
    const source = result.document.metadata?.presetSource as SillyTavernPreset;
    expect(source.prompts?.[0]?.content).not.toBe("mutated");
  });

  it("re-clustering from the stored source reproduces a loadable graph", () => {
    const first = importSillyTavernPreset(samplePreset(), { clusterMode: "loose" });
    const source = first.document.metadata?.presetSource as unknown;
    //从存储源头重新以另一种模式聚类，无需重新上传文件。
    const second = importSillyTavernPreset(source, { clusterMode: "strict" });
    expect(second.document.metadata?.clusterMode).toBe("strict");
    expect(validateGraphDocument(second.document).isExecutable).toBe(true);
  });
});

/** 含全部固定 marker slot（世界书 before/after、角色三 slot、人设、示例对话、历史）的预设。 */
function slotPreset(): SillyTavernPreset {
  return {
    name: "插槽预设",
    prompts: [
      { identifier: "main", name: "Main Prompt", role: "system", content: "你是叙事者。", marker: false },
      { identifier: "worldInfoBefore", name: "世界书（前）", role: "system", marker: true },
      { identifier: "charDescription", name: "角色描述", role: "system", marker: true },
      { identifier: "charPersonality", name: "角色性格",role: "system", marker: true },
      { identifier: "scenario", name: "场景", role: "system", marker: true },
      { identifier: "personaDescription", name: "用户人设", role: "system", marker: true },
      { identifier: "dialogueExamples", name: "示例对话", role: "system", marker: true },
   { identifier: "worldInfoAfter", name: "世界书（后）", role: "system", marker: true },
      { identifier: "chatHistory", name: "对话历史", role: "system", marker: true },
    ],
    prompt_order: [
      {
        character_id: 1,
        order: [
          { identifier: "main", enabled: true },
          { identifier: "worldInfoBefore", enabled: true },
          { identifier: "charDescription", enabled: true },
          { identifier: "charPersonality", enabled: true },
          { identifier: "scenario", enabled: true },
          { identifier: "personaDescription", enabled: false },
          { identifier: "dialogueExamples", enabled: true},
          {identifier: "worldInfoAfter", enabled: true },
          { identifier: "chatHistory", enabled: true },
        ],
      },
    ],
  };
}

describe("importSillyTavernPreset: fixed marker slot routing", () => {
  it("routes each fixed marker to its semantic source node plus a text_to_block converter", () => {
    const result = importSillyTavernPreset(slotPreset());
    const byType = (type: string) => result.document.nodes.filter((n) => n.type === type);
    const cfgId = (n: { config?: unknown }) => (n.config as { identifier?: string })?.identifier;

    // 世界书 before/after → 两个 select.worldbook_match（config.position 区分）。
    const worldbook = byType("select.worldbook_match");
    expect(worldbook).toHaveLength(2);
    const before = worldbook.find((n) => cfgId(n) === "worldInfoBefore");
    const after = worldbook.find((n) => cfgId(n) === "worldInfoAfter");
    expect((before?.config as { position?: string })?.position).toBe("before");
    expect((after?.config as { position?: string })?.position).toBe("after");

    // 角色三 slot → 三个 source.character（config.part区分）。
    const character = byType("source.character");
    expect(character).toHaveLength(3);
    const parts = character.map((n) => (n.config as { part?: string })?.part).sort();
    expect(parts).toEqual(["description", "personality", "scenario"]);

    // 人设 → source.persona；示例对话 → source.dialogue_examples。
    expect(byType("source.persona")).toHaveLength(1);
    expect(byType("source.dialogue_examples")).toHaveLength(1);

    // 7 个固定 marker slot → 7 个语义源 + 7 个 text_to_block 转换节点。
    expect(result.summary.slotNodeCount).toBe(7);
    expect(byType("compose.text_to_block")).toHaveLength(7);

    // chatHistory 仍为 source.chat_history；main 仍为 template_render。
    expect(byType("source.chat_history")).toHaveLength(1);
    expect(byType("compose.template_render")).toHaveLength(1);
    expect(result.summary.hasHistory).toBe(true);
    expect(result.summary.blockCount).toBe(1);

    expect(validateGraphDocument(result.document).isExecutable).toBe(true);
  });

  it("wires each semantic source through text_to_block into compose.blocks", () => {
    const result = importSillyTavernPreset(slotPreset());
    const edges = result.document.edges;

    // 世界书（前）：source text → converter text；converter block → composeblocks。
    const srcToConv = edges.find((e) => e.id === "e_n_slot_worldInfoBefore_t2b");
    expect(srcToConv?.from).toEqual({ nodeId: "n_slot_worldInfoBefore", port: "text" });
    expect(srcToConv?.to).toEqual({ nodeId: "n_slot_worldInfoBefore_block", port: "text" });

    const convToCompose = edges.find((e) => e.id === "e_n_slot_worldInfoBefore_block_compose");
    expect(convToCompose?.from).toEqual({ nodeId: "n_slot_worldInfoBefore_block", port: "block" });
    expect(convToCompose?.to).toEqual({ nodeId: "n_compose", port: "blocks" });

    // 每个语义源都有对应的 source→converter 与 converter→compose 两条边。
    const slotIds = [
      "worldInfoBefore",
      "charDescription",
      "charPersonality",
      "scenario",
      "personaDescription",
      "dialogueExamples",
      "worldInfoAfter",
    ];
    for (const id of slotIds) {
      expect(edges.some((e) => e.id === `e_n_slot_${id}_t2b`)).toBe(true);
      expect(edges.some((e) => e.id === `e_n_slot_${id}_block_compose`)).toBe(true);
    }
  });

  it("propagates the disabled marker state to both the source and its converter", () => {
    const result = importSillyTavernPreset(slotPreset());
    // personaDescription 在 prompt_order 中 enabled:false。
    const personaSource = result.document.nodes.find((n) => n.id === "n_slot_personaDescription");
    const personaConverter = result.document.nodes.find((n) => n.id === "n_slot_personaDescription_block");
    expect(personaSource?.enabled).toBe(false);
    expect(personaConverter?.enabled).toBe(false);

    // 启用的 slot（世界书前）不写 enabled 字段（缺省开）。
    const worldbookSource = result.document.nodes.find((n) => n.id === "n_slot_worldInfoBefore");
    expect(worldbookSource?.enabled).toBeUndefined();

    // 禁用 slot 仍连入 compose（开启即生效）。
    expect(
      result.document.edges.some((e) => e.id === "e_n_slot_personaDescription_block_compose"),
    ).toBe(true);

    expect(validateGraphDocument(result.document).isExecutable).toBe(true);
  });

  it("keeps non-marker authored blocks and unknown markers as compose.template_render", () => {
    const preset: SillyTavernPreset = {
      name: "混合预设",
      prompts: [
        { identifier: "main", name: "Main Prompt", role: "system", content: "正文", marker: false },
        { identifier: "charDescription", name: "角色描述", role: "system", marker: true },
        // 未知 marker：不在分流表内，退回 template_render。
        { identifier: "unknownMarker", name: "未知插槽", role: "system", marker: true },
      ],
      prompt_order: [
        {
          character_id: 1,
          order: [
            { identifier: "main", enabled: true },
            { identifier: "charDescription", enabled: true },
            { identifier: "unknownMarker", enabled: true },
          ],
        },
      ],
    };
    const result = importSillyTavernPreset(preset);
    const templates = result.document.nodes.filter((n)=> n.type === "compose.template_render");
    const cfgId = (n: { config?: unknown }) => (n.config as { identifier?: string })?.identifier;

    // main（authored）与 unknownMarker（未知 marker）仍为 template_render。
    expect(templates.map(cfgId).sort()).toEqual(["main", "unknownMarker"]);
    // charDescription 变成语义源。
    expect(result.document.nodes.some((n) => n.type === "source.character")).toBe(true);
    expect(result.summary.slotNodeCount).toBe(1);
    expect(result.summary.blockCount).toBe(2);

    expect(validateGraphDocument(result.document).isExecutable).toBe(true);
  });
});

