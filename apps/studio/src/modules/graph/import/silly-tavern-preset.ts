/**
 * 酒馆（SillyTavern）OpenAI 预设 → `NodeGraphDocument`「Narrator 主体」导入器。
 *
 * 心智模型见 `.limcode/design/agentic-batch10-wb10-agent-nodegraph-relationship-discussion.md`
 * 第九节：**一份酒馆预设 ≈ 一个「叙事 Agent（Narrator）」主体的大部分**。预设三件套映射：
 *
 *   1. **采样参数**（temperature/top_p/penalties/openai_max_tokens…）→ `narration.narrator` 节点
 *      `config.sampling`。
 *   2. **Prompt 装配**（`prompts[]` + `prompt_order`）→ 一串有序的 prompt block：
 *        - `chatHistory` marker → `source.chat_history`（messages → compose）；
 *        - 其余（authored 文本与其他 marker）→ `compose.template_render` block，按 `prompt_order` 顺序
 *          汇入 `compose.final_messages`。
 *   3. **输出后处理**（`extensions.regex_scripts`）→ 暂无对应节点 type，作为 `config.outputRegex`
 *      元数据挂在 narrator 上（未来可由 `compose.regex_postprocess` 之类消费）。
 *
 * 产物是一张**干净可执行**（无 error 级诊断）的最小 Narrator 图：blocks(+history) → compose →
 * narrator → commit_gate；其中 blocks + compose + narrator 收进可视分组。纯函数、可单测。
 *
 * 聚类提供两种模式（导入时可选）：
 *   - **严格（strict）**：严格保持酒馆原有编排顺序（`prompt_order`），只把**连续相邻**的同类块
 *     打成一组；成对 XML 标签（`<user>…</user>` 等）作为分段边界。组绝不跨越、不重排，组成员在
 *     画布上自上而下即原始编排顺序。
 *   - **宽松（loose，默认）**：不严格保序，把分散各处的同类块聚到一起（按已知语义/命名前缀/图标，
 *     并归一化数字后缀如「文风1/2/3」→「文风」），优先可读性与组织性。
 */
import {
  groupSwitchState,
  type NodeGraphDocument,
  type NodeGraphEdge,
  type NodeGraphGroup,
  type NodeGraphNode,
} from "@tavern/core/node-graph";

export interface SillyTavernPromptDef {
  identifier: string;
  name?: string;
  role?: string;
  content?: string;
  marker?: boolean;
  system_prompt?: boolean;
  injection_position?: number;
  injection_depth?: number;
}

export interface SillyTavernPromptOrderEntry {
  identifier: string;
  enabled?: boolean;
}

export interface SillyTavernPromptOrder {
  character_id?: number;
  order?: SillyTavernPromptOrderEntry[];
}

export interface SillyTavernRegexScript {
  scriptName?: string;
  findRegex?: string;
  replaceString?: string;
  disabled?: boolean;
  promptOnly?: boolean;
  markdownOnly?: boolean;
  runOnEdit?: boolean;
  placement?: number[];
}

export interface SillyTavernPreset {
  prompts?: SillyTavernPromptDef[];
  prompt_order?: SillyTavernPromptOrder[];
  extensions?: { regex_scripts?: SillyTavernRegexScript[]; regex?: SillyTavernRegexScript[] };
  regex_scripts?: SillyTavernRegexScript[];
  [key: string]: unknown;
}

/** 聚类模式：strict 严格保序分段；loose 宽松聚合（默认）。 */
export type PresetClusterMode = "strict" | "loose";

export interface PresetImportSummary {
  presetName: string;
  blockCount: number;
  /** 其中处于禁用态（`enabled:false`，保留可开关）的块数。 */
  disabledCount: number;
  hasHistory: boolean;
  /** 聚类出的子图组数（不含 Narrator 主体组）。 */
  groupCount: number;
  /** 本次导入采用的聚类模式。 */
  clusterMode: PresetClusterMode;
  samplerKeys: string[];
  regexCount: number;
  skippedCount: number;
}

export interface PresetImportResult {
  document: NodeGraphDocument;
  warnings: string[];
  summary: PresetImportSummary;
}

export interface PresetImportOptions {
  /** 覆盖图名称（默认取预设名 / 文件名 / 兜底）。 */
  name?: string;
  /** 聚类模式（默认 loose 宽松）。 */
  clusterMode?: PresetClusterMode;
  /** 源预设内容哈希（由调用方对原始文件计算）；写入 metadata 供重复导入检测同名 / 同内容。 */
  presetHash?: string;
}

/**
 * 预处理 · 聚类：把同一「系统功能」的 slot 归到一个子图组（见
 * `.limcode/design/agentic-batch10-nodegroup-subgraph-v1-design.md` §5）。
 *
 * 两级规则：
 * 1. **已知 ST identifier** → 固定语义聚类（worldbook/character/persona/system/examples）。
 * 2. **社区命名约定**（authored / 自定义 UUID slot）→ 解析 slot 名 `图标︱类别-子名`：
 *    - 先按**类别前缀**（竖线/图标分隔后、首个连字符前的词，如 `模块`/`设置`/`文风`/`Sigon`）聚类；
 *    - 否则按**相同图标**（同一位置的 emoji/符号）聚类；
 *    - 仍无法判定 → `custom`。
 * 这些前缀/图标约定已近乎社区共识，故很适合直接打包进节点组。
 */
const CLUSTER_BY_IDENTIFIER: Readonly<Record<string, string>> = {
  worldInfoBefore: "worldbook",
  worldInfoAfter: "worldbook",
  worldInfo: "worldbook",
  charDescription: "character",
  charPersonality: "character",
  scenario: "character",
  personaDescription: "persona",
  main: "system",
  nsfw: "system",
  jailbreak: "system",
  enhanceDefinitions: "system",
  dialogueExamples: "examples",
};

const CLUSTER_NAMES: Readonly<Record<string, string>> = {
  worldbook: "世界书",
  character: "角色设定",
  persona: "用户人设",
  system: "系统与越狱",
  examples: "示例对话",
  custom: "自定义提示",
};

/** 固定语义聚类 key 集合（这些用稳定 ascii id `g_<key>`）。 */
const KNOWN_CLUSTER_KEYS = new Set<string>([...Object.values(CLUSTER_BY_IDENTIFIER), "custom"]);

/** 「图标︱文字」竖线族分隔符（社区约定的图标分隔位）。 */
const ICON_SEPARATOR = /[|｜︱丨│┃￨]/;
/** 「类别-子名」前缀分隔符（连字符族 + 间隔号）。 */
const CATEGORY_DELIMITER = /[-－—–·・]/;
/**
 * 前导图标/符号：无竖线分隔时，剥离开头连续的 emoji/几何符号/标点（如 `▪`、`🖋`、`🕰`、`➡️`），
 * 直到第一个字母/数字/汉字。每个图标单元 = 一个图标字符（emoji 或 U+2190–U+2BFF 箭头/几何符号、
 * U+3000–U+303F CJK 符号）+ 可选的变体选择符/ZWJ；变体选择符与 ZWJ 单独成类，避免字符类内组合误导。
 */
const LEADING_ICON =
  /^(?:[\p{Extended_Pictographic}\u2190-\u2BFF\u3000-\u303F][\uFE0E\uFE0F\u200D]*)+/u;
/** 成对 XML 分节标签：`<user>` / `</user>` / `<Order>` 等。 */
const SECTION_TAG = /^<\s*(\/?)\s*([A-Za-z_][\w-]*)\s*>$/;

/** slot 名解析：拆出前置图标、类别前缀与去图标后的标签。 */
export function parseSlotLabel(rawName: string | undefined): {
  icon?: string;
  category?: string;
  label: string;
} {
  const name = (rawName ?? "").trim();
  if (name.length === 0) {
    return { label: "" };
  }
  let icon: string | undefined;
  let body = name;
  const sepIndex = name.search(ICON_SEPARATOR);
  if (sepIndex >= 0) {
    const head = name.slice(0, sepIndex).trim();
    const tail = name.slice(sepIndex + 1).trim();
    // head 视作图标当且仅当其短小（emoji/符号），避免把普通文字误判为图标。
    if (head.length > 0 && head.length <= 6 && tail.length > 0) {
      icon = head;
      body = tail;
    }
  }
  // 无竖线分隔时，尝试剥离前导图标（社区里大量 slot 直接以 emoji/符号开头，无分隔符）。
  if (icon === undefined) {
    const match = LEADING_ICON.exec(body);
    if (match && match[0].length < body.length) {
      const stripped = body.slice(match[0].length).trim();
      if (stripped.length > 0) {
        icon = match[0].trim();
        body = stripped;
      }
    }
  }
  let category: string | undefined;
  const delimIndex = body.search(CATEGORY_DELIMITER);
  if (delimIndex > 0) {
    const prefix = body.slice(0, delimIndex).trim();
    // 限定前缀长度，避免把一句话的首个连字符误当类别。
    if (prefix.length > 0 && prefix.length <= 12) {
      category = prefix;
    }
  }
  return pruneUndefined({ icon, category, label: body });
}

/** 识别成对 XML 分节标签块（`<user>` / `</user>`）；非标签块返回 undefined。 */
export function parseSectionTag(
  def: SillyTavernPromptDef,
): { kind: "open" | "close"; tag: string } | undefined {
  const raw = (def.name ?? "").trim();
  const match = SECTION_TAG.exec(raw);
  if (!match) {
    return undefined;
  }
  const tag = match[2];
  if (tag === undefined) {
    return undefined;
  }
  return { kind: match[1] === "/" ? "close" : "open", tag };
}

/**
 * 由 prompt 定义判定其所属聚类（key 唯一、name 展示、icon/category 透传给块）。
 * @param opts.normalizeNumericSuffix 归一化类别尾部数字（`文风2`→`文风`），用于宽松聚合。
 */
function clusterOf(
  def: SillyTavernPromptDef,
  opts: { normalizeNumericSuffix?: boolean } = {},
): { key: string; name: string; icon?: string; category?: string } {
  const known = CLUSTER_BY_IDENTIFIER[def.identifier];
  if (known) {
    return { key: known, name: CLUSTER_NAMES[known] ?? "自定义提示" };
  }
  const parsed = parseSlotLabel(def.name);
  if (parsed.category) {
    let cat = parsed.category;
    if (opts.normalizeNumericSuffix) {
      const normalized = cat.replace(/[0-9]+$/, "");
      cat = normalized.length > 0 ? normalized : cat;
    }
    return { key: `prefix:${cat}`, name: cat, icon: parsed.icon, category: parsed.category };
  }
  if (parsed.icon) {
    return { key: `icon:${parsed.icon}`, name: parsed.icon, icon: parsed.icon };
  }
  return { key: "custom", name: "自定义提示" };
}

/** 一个聚类桶：稳定 id、展示名、成员节点 id（保持加入顺序）。 */
interface GroupBucket {
  id: string;
  name: string;
  nodeIds: string[];
}

/** 严格模式分组：保持 prompt_order 线性顺序，只把连续相邻同类块打组；成对 XML 标签为分段边界。 */
function assignGroupsStrict(entries: ReadonlyArray<{ def: SillyTavernPromptDef; blockId: string }>): GroupBucket[] {
  const groups: GroupBucket[] = [];
  let seq = 0;
  let current: GroupBucket | null = null;
  /** 当前连续同类段的 cluster key（仅 section 外有效）。 */
  let runKey: string | null = null;
  /** XML 标签嵌套深度；>0 表示处于某顶层 section 内。 */
  let depth = 0;
  const openGroup = (name: string): GroupBucket => {
    const bucket: GroupBucket = { id: `g_seg_${(seq += 1)}`, name, nodeIds: [] };
    groups.push(bucket);
    return bucket;
  };
  for (const entry of entries) {
    const tag = parseSectionTag(entry.def);
    if (tag?.kind === "open") {
      if (depth === 0) {
        // 顶层开标签：结束上一段，开启以标签名命名的 section。
        current = openGroup(tag.tag);
        runKey = null;
      }
      depth += 1;
      current?.nodeIds.push(entry.blockId);
      continue;
    }
    if (tag?.kind === "close") {
      if (depth > 0) {
        current?.nodeIds.push(entry.blockId);
        depth -= 1;
        if (depth === 0) {
          current = null;
        }
        continue;
      }
      // 孤立闭标签（无配对开标签）：当作普通块按连续同类处理。
      const cluster = clusterOf(entry.def);
      if (current === null || runKey !== cluster.key) {
        current = openGroup(cluster.name);
        runKey = cluster.key;
      }
      current.nodeIds.push(entry.blockId);
      continue;
    }
    if (depth > 0) {
      // section 内：归入当前 section（取最外层顶层 section）。
      current?.nodeIds.push(entry.blockId);
      continue;
    }
    // section 外：连续相同 cluster key 合并，类别变化即切新段。
    const cluster = clusterOf(entry.def);
    if (current === null || runKey !== cluster.key) {
      current = openGroup(cluster.name);
      runKey = cluster.key;
    }
    current.nodeIds.push(entry.blockId);
  }
  return groups;
}

/** 宽松模式分组：全局按 cluster key 聚合（位置无关），归一化数字后缀，优先组织性。 */
function assignGroupsLoose(entries: ReadonlyArray<{ def: SillyTavernPromptDef; blockId: string }>): GroupBucket[] {
  const byKey = new Map<string, GroupBucket>();
  const order: GroupBucket[] = [];
  let seq = 0;
  for (const entry of entries) {
    const cluster = clusterOf(entry.def, { normalizeNumericSuffix: true });
    let bucket = byKey.get(cluster.key);
    if (!bucket) {
      const id = KNOWN_CLUSTER_KEYS.has(cluster.key) ? `g_${cluster.key}` : `g_grp_${(seq += 1)}`;
      bucket = { id, name: cluster.name, nodeIds: [] };
      byKey.set(cluster.key, bucket);
      order.push(bucket);
    }
    bucket.nodeIds.push(entry.blockId);
  }
  return order;
}

/** 采样参数：预设字段 → narrator.config.sampling 字段。 */
const SAMPLER_FIELD_MAP: ReadonlyArray<readonly [string, string]> = [
  ["temperature", "temperature"],
  ["top_p", "topP"],
  ["top_k", "topK"],
  ["top_a", "topA"],
  ["min_p", "minP"],
  ["frequency_penalty", "frequencyPenalty"],
  ["presence_penalty", "presencePenalty"],
  ["repetition_penalty", "repetitionPenalty"],
  ["openai_max_tokens", "maxTokens"],
  ["openai_max_context", "maxContext"],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 判定一个 JSON 是否像酒馆 OpenAI 预设（含 `prompts` 数组）。 */
export function isSillyTavernPreset(value: unknown): value is SillyTavernPreset {
  return isRecord(value) && Array.isArray((value as { prompts?: unknown }).prompts);
}

/** 选定要使用的 `prompt_order`：取「启用且能解析到 prompt 定义」条目数最多者（稳定，首个并列优先）。 */
function pickPromptOrder(
  preset: SillyTavernPreset,
  promptsById: Map<string, SillyTavernPromptDef>,
): SillyTavernPromptOrderEntry[] {
  const orders = Array.isArray(preset.prompt_order) ? preset.prompt_order : [];
  if (orders.length === 0) {
    // 无 prompt_order：退化为按 prompts 数组顺序全部启用。
    return (preset.prompts ?? []).map((prompt) => ({ identifier: prompt.identifier, enabled: true }));
  }
  let best: SillyTavernPromptOrderEntry[] = [];
  let bestScore = -1;
  for (const order of orders) {
    const entries = Array.isArray(order.order) ? order.order : [];
    const score = entries.filter(
      (entry) => entry.enabled !== false && promptsById.has(entry.identifier),
    ).length;
    if (score > bestScore) {
      bestScore = score;
      best = entries;
    }
  }
  return best;
}

function extractSampling(preset: SillyTavernPreset): { sampling: Record<string, number>; keys: string[] } {
  const sampling: Record<string, number> = {};
  const keys: string[] = [];
  for (const [presetKey, outKey] of SAMPLER_FIELD_MAP) {
    const value = (preset as Record<string, unknown>)[presetKey];
    if (typeof value === "number" && Number.isFinite(value)) {
      sampling[outKey] = value;
      keys.push(outKey);
    }
  }
  return { sampling, keys };
}

function extractRegexScripts(preset: SillyTavernPreset): SillyTavernRegexScript[] {
  const candidates: unknown[] = [
    preset.extensions?.regex_scripts,
    preset.regex_scripts,
    preset.extensions?.regex,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .filter((item): item is SillyTavernRegexScript => isRecord(item))
        .map((item) => ({
          scriptName: typeof item.scriptName === "string" ? item.scriptName : undefined,
          findRegex: typeof item.findRegex === "string" ? item.findRegex : undefined,
          replaceString: typeof item.replaceString === "string" ? item.replaceString : undefined,
          disabled: item.disabled === true,
          promptOnly: item.promptOnly === true,
          markdownOnly: item.markdownOnly === true,
          runOnEdit: item.runOnEdit === true,
          placement: Array.isArray(item.placement)
            ? item.placement.filter((value): value is number => typeof value === "number")
            : undefined,
        }));
    }
  }
  return [];
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value;
}

/** 注入位置/深度（仅当预设提供 injection_position 时携带），属于编排语义而非提示词正文。 */
function buildInjection(
  def: SillyTavernPromptDef,
): { position: number; depth?: number } | undefined {
  if (typeof def.injection_position !== "number") {
    return undefined;
  }
  return pruneUndefined({
    position: def.injection_position,
    depth: typeof def.injection_depth === "number" ? def.injection_depth : undefined,
  }) as { position: number; depth?: number };
}

/**
 * 把酒馆 OpenAI 预设导入为一张 Narrator 图。
 * @throws 当 value 不是合法预设（缺少 `prompts` 数组）时抛错。
 */
export function importSillyTavernPreset(
  value: unknown,
  options: PresetImportOptions = {},
): PresetImportResult {
  if (!isSillyTavernPreset(value)) {
    throw new Error("not_a_sillytavern_preset");
  }
  const preset = value;
  const warnings: string[] = [];
  const clusterMode: PresetClusterMode = options.clusterMode === "strict" ? "strict" : "loose";

  const prompts = preset.prompts ?? [];
  const promptsById = new Map<string, SillyTavernPromptDef>();
  for (const prompt of prompts) {
    if (prompt && typeof prompt.identifier === "string") {
      promptsById.set(prompt.identifier, prompt);
    }
  }

  const presetName =
    (typeof (preset as { name?: unknown }).name === "string" && (preset as { name: string }).name) ||
    options.name ||
    "酒馆预设";
  const graphName = options.name || (typeof (preset as { name?: unknown }).name === "string" ? (preset as { name: string }).name : "") || "导入的 Narrator";

  const order = pickPromptOrder(preset, promptsById);

  const nodes: NodeGraphNode[] = [];
  const edges: NodeGraphEdge[] = [];
  /** 提示块条目（保持 prompt_order 顺序），供分组阶段使用。 */
  const blockEntries: Array<{ def: SillyTavernPromptDef; blockId: string }> = [];

  let hasHistory = false;
  let blockCount = 0;
  let disabledCount = 0;
  let skippedCount = 0;
  let blockIndex = 0;

  // —— 阶段一：按 prompt_order 稳定遍历，建 block 节点（禁用位保留 enabled:false，不丢弃）；
  //    chatHistory marker 单独抽成历史源节点 ——
  for (const entry of order) {
    const def = promptsById.get(entry.identifier);
    if (!def) {
      skippedCount += 1;
      warnings.push(`未找到提示定义，已跳过：${entry.identifier}`);
      continue;
    }
    const enabled = entry.enabled !== false;
    if (!enabled) {
      disabledCount += 1;
    }
    // chatHistory marker → 对话历史源（messages 接入 compose.messages）。
    if (def.marker && def.identifier === "chatHistory") {
      if (!hasHistory) {
        hasHistory = true;
        const historyNode: NodeGraphNode = {
          id: "n_history",
          type: "source.chat_history",
          typeVersion: "1",
          name: def.name || "对话历史",
          phase: "pre_response",
          scope: "floor_stable",
        };
        if (!enabled) {
          historyNode.enabled = false;
        }
        nodes.push(historyNode);
        edges.push({
          id: "e_history_compose",
          from: { nodeId: "n_history", port: "messages" },
          to: { nodeId: "n_compose", port: "messages" },
        });
      }
      continue;
    }
    // 其余（authored 文本 / 其他 marker / XML 标签块）→ 一个有序的提示块。
    blockIndex += 1;
    const blockId = `n_block_${blockIndex}`;
    blockCount += 1;
    const parsed = parseSlotLabel(def.name);
    const blockNode: NodeGraphNode = {
      id: blockId,
      type: "compose.template_render",
      typeVersion: "1",
      // 去图标后的清爽标签作节点标题（贴合酒馆 UI 把图标拆为图标位的展示）；回退原名/identifier。
      name: parsed.label || def.name || def.identifier,
      phase: "pre_response",
      config: pruneUndefined({
        // 唯一会成为提示词正文的字段（运行时 compose.template_render 渲染它）。
        content: typeof def.content === "string" && def.content.length > 0 ? def.content : undefined,
        // 提示词语义：角色、是否系统提示、注入位置/深度。
        role: def.role,
        systemPrompt: def.system_prompt === true ? true : undefined,
        injection: buildInjection(def),
        // 以下为非提示词元数据：标记位与导入溯源（identifier/图标/类别），仅供 UI 与节点组归属。
        marker: def.marker === true ? true : undefined,
        identifier: def.identifier,
        icon: parsed.icon,
        category: parsed.category,
      }),
    };
    if (!enabled) {
      blockNode.enabled = false;
    }
    nodes.push(blockNode);
    blockEntries.push({ def, blockId });
    // 禁用块仍连入 compose：开启即生效（运行时按 enabled 跳过）。
    edges.push({
      id: `e_${blockId}_compose`,
      from: { nodeId: blockId, port: "block" },
      to: { nodeId: "n_compose", port: "blocks" },
    });
  }

  // —— 阶段二：分组（严格保序分段 / 宽松全局聚合）——
  const groupedBlocks =
    clusterMode === "strict" ? assignGroupsStrict(blockEntries) : assignGroupsLoose(blockEntries);

  // 最终装配 → Narrator → CommitGate（Narrator 主体的输出边界）。
  nodes.push({
    id: "n_compose",
    type: "compose.final_messages",
    typeVersion: "1",
    name: "最终消息装配",
    phase: "response",
  });

  const { sampling, keys: samplerKeys } = extractSampling(preset);
  const regexScripts = extractRegexScripts(preset);

  nodes.push({
    id: "n_narrator",
    type: "narration.narrator",
    typeVersion: "1",
    name: `主叙事 Narrator（${presetName}）`,
    phase: "response",
    scope: "page_volatile",
    config: pruneUndefined({
      presetName,
      sampling: samplerKeys.length > 0 ? sampling : undefined,
      outputRegex: regexScripts.length > 0 ? regexScripts : undefined,
    }),
  });

  nodes.push({
    id: "n_commit",
    type: "output.commit_gate",
    typeVersion: "1",
    name: "CommitGate（唯一正史边界）",
    phase: "commit",
  });

  edges.push({
    id: "e_compose_narrator",
    from: { nodeId: "n_compose", port: "messages" },
    to: { nodeId: "n_narrator", port: "messages" },
  });
  edges.push({
    id: "e_narrator_commit",
    from: { nodeId: "n_narrator", port: "text" },
    to: { nodeId: "n_commit", port: "text" },
  });

  if (blockCount === 0 && !hasHistory) {
    warnings.push("预设未解析出任何启用的提示块（prompt_order 为空或全部禁用）。");
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));

  // —— 初始布局：按分组顺序自上而下铺排。组内成员相邻成段、段间留白，
  //    历史/装配/叙事/提交按阶段顺序右移分列；让导入后画布即贴合编排顺序，
  //    并保证折叠组成员坐标互不重叠（避免钻入后叠在一起）。——
  const COLUMN_GAP = 360;
  const ROW_GAP = 140;
  const BAND_GAP = 48;
  const setPosition = (id: string, x: number, y: number): void => {
    const target = nodesById.get(id);
    if (target) {
      target.ui = { ...(target.ui ?? {}), position: { x, y } };
    }
  };
  let preColumnY = 0;
  for (const bucket of groupedBlocks) {
    for (const nodeId of bucket.nodeIds) {
      setPosition(nodeId, 0, preColumnY);
      preColumnY += ROW_GAP;
    }
    preColumnY += BAND_GAP;
  }
  if (hasHistory) {
    setPosition("n_history", 0, preColumnY);
  }
  setPosition("n_compose", COLUMN_GAP, 0);
  setPosition("n_narrator", COLUMN_GAP, ROW_GAP * 2);
  setPosition("n_commit", COLUMN_GAP * 2, ROW_GAP);

  // —— 子图组：每个非空分组一个 + Narrator 主体组（compose + narrator）——
  // 组开关（`enabled`）由成员派生：全员禁用 → 组关（enabled:false），呈现「整组关闭」；
  // 否则缺省（开）。开关与成员 `node.enabled` 同步，无需钻入组内部即可整体启停绑定节点。
  const groups: NodeGraphGroup[] = [
    ...groupedBlocks.map((bucket) => {
      const members = bucket.nodeIds
        .map((nodeId) => nodesById.get(nodeId))
        .filter((node): node is NodeGraphNode => Boolean(node));
      const group: NodeGraphGroup = {
        id: bucket.id,
        name: bucket.name,
        kind: "subgraph",
        nodeIds: bucket.nodeIds,
        // 默认折叠：导入后每个功能组对外表现为单个节点（Blender 式），双击进入其内部。
        collapsed: true,
      };
      if (groupSwitchState(members) === "off") {
        group.enabled = false;
      }
      return group;
    }),
    {
      id: "g_narrator",
      name: "Narrator 主体（唯一持笔人）",
      kind: "subgraph",
      nodeIds: ["n_compose", "n_narrator"],
      collapsed: true,
    },
  ];

  const document: NodeGraphDocument = {
    schemaVersion: 2,
    graphId: "imported-narrator",
    name: graphName,
    description: `从酒馆 OpenAI 预设导入：${presetName}`,
    mode: "native_graph",
    nodes,
    edges,
    groups,
    policies: {},
    metadata: pruneUndefined({
      systemGraph: false,
      importedFrom: "sillytavern_openai_preset",
      presetName,
      presetHash: options.presetHash,
      // 本次采用的聚类方式：供后续 Agent 知道当前组织是严格保序还是宽松聚合。
      clusterMode,
      // 原始预设源数据（深拷贝，保证 JSON 可序列化且不持有调用方引用）。
      // 作为「真值来源」存储：节点配置是可编辑工作副本，源头用于核对与重新聚类
      // （针对预设图的临时对话系统中，用户对自动聚类不满意时由 Agent 据此重新组织）。
      presetSource: JSON.parse(JSON.stringify(preset)) as unknown,
    }),
  };

  return {
    document,
    warnings,
    summary: {
      presetName,
      blockCount,
      disabledCount,
      hasHistory,
      groupCount: groupedBlocks.length,
      clusterMode,
      samplerKeys,
      regexCount: regexScripts.length,
      skippedCount,
    },
  };
}
