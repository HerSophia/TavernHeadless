import { describe, expect, it } from "vitest";

import { validateGraphDocument } from "../validate/local-validation";
import {
  importSillyTavernPreset,
  isSillyTavernPreset,
  parseSectionTag,
  parseSlotLabel,
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

    // main / charDescription / jb / disabledOne → 4 个块（禁用位保留）；chatHistory → 历史；missingId 跳过。
    expect(result.summary.blockCount).toBe(4);
    expect(result.summary.disabledCount).toBe(1);
    expect(result.summary.hasHistory).toBe(true);
    expect(result.summary.skippedCount).toBe(1);
    expect(result.warnings.some((w) => w.includes("missingId"))).toBe(true);

    // 节点：4 块 + 历史 + compose + narrator + commit = 8。
    expect(result.document.nodes).toHaveLength(8);
    expect(result.document.nodes.filter((n) => n.type === "compose.template_render")).toHaveLength(4);
    expect(result.document.nodes.some((n) => n.type === "source.chat_history")).toBe(true);
    expect(result.document.nodes.filter((n) => n.type === "narration.narrator")).toHaveLength(1);
    expect(result.document.nodes.some((n) => n.type === "output.commit_gate")).toBe(true);

    // 边：4 块→compose + 历史→compose + compose→narrator + narrator→commit = 7。
    expect(result.document.edges).toHaveLength(7);
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

  it("carries authored content and marker flags onto block config", () => {
    const result = importSillyTavernPreset(samplePreset());
    const blocks = result.document.nodes.filter((n) => n.type === "compose.template_render");

    const main = blocks.find((n) => (n.config as { identifier?: string })?.identifier === "main");
    expect((main?.config as { content?: string })?.content).toBe("你是叙事者。");

    const char = blocks.find((n) => (n.config as { identifier?: string })?.identifier === "charDescription");
    expect((char?.config as { marker?: boolean })?.marker).toBe(true);
    // marker 块无 content 字段（已剪除 undefined）。
    expect((char?.config as { content?: string })?.content).toBeUndefined();
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
    // <user>…</user> 分节 → 名为 user 的组（含两个标签块 + 角色描述）。
    expect(byName("user")?.nodeIds).toHaveLength(3);
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

