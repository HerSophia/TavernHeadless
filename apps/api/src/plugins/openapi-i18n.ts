import type { FastifyRequest } from "fastify";

export type ApiDocLanguage = "en" | "zh";

type OpenApiDocument = {
  info?: {
    title?: string;
    description?: string;
  };
  tags?: Array<{
    name?: string;
    description?: string;
  }>;
  paths?: Record<string, Record<string, unknown>>;
};

type OpenApiOperation = {
  summary?: string;
  description?: string;
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "trace"] as const;

const TAG_DESCRIPTION_ZH: Record<string, string> = {
  system: "系统与健康检查接口",
  sessions: "会话 CRUD 与生命周期",
  floors: "楼层 CRUD",
  pages: "消息页 CRUD",
  messages: "消息 CRUD 与批量维护",
  variables: "变量 CRUD、upsert 与批量 upsert",
  memories: "记忆与记忆边 CRUD 与批量维护",
  imports: "SillyTavern 资源导入接口",
  characters: "角色生命周期与版本管理",
  chat: "对话回复与重生成",
  "llm-profiles": "LLM 配置档案与激活绑定",
  accounts: "账号管理",
  users: "账号用户卡管理",
};

const TEXT_ZH_MAP: Record<string, string> = {
  "Backend API for TavernHeadless core engine": "TavernHeadless 核心引擎后端 API",
  "Health check": "健康检查",
  "Create session": "创建会话",
  "List sessions": "列出会话",
  "Get session": "获取会话",
  "Update session": "更新会话",
  "Sync session character snapshot to latest version": "同步会话角色快照到最新版本",
  "Delete session": "删除会话",
  "List branches in session": "列出会话分支",
  "Compare two branches": "比较两个分支",
  "Get session timeline": "获取会话时间线",
  "Create floor": "创建楼层",
  "List floors": "列出楼层",
  "Get floor": "获取楼层",
  "Update floor": "更新楼层",
  "Delete floor": "删除楼层",
  "Prepare branch from floor": "从楼层创建分支",
  "Delete branch": "删除分支",
  "Create page": "创建页面",
  "List pages": "列出页面",
  "Get page": "获取页面",
  "Update page": "更新页面",
  "Delete page": "删除页面",
  "Activate page within floor": "在楼层内激活页面",
  "Create message": "创建消息",
  "List messages": "列出消息",
  "Get message": "获取消息",
  "Update message": "更新消息",
  "Delete message": "删除消息",
  "Batch update message visibility": "批量更新消息可见性",
  "Batch delete messages": "批量删除消息",
  "Upsert variable": "新增或更新变量",
  "Batch upsert variables": "批量新增或更新变量",
  "List variables": "列出变量",
  "Get variable": "获取变量",
  "Delete variable": "删除变量",
  "Create memory item": "创建记忆条目",
  "List memory items": "列出记忆条目",
  "Memory statistics": "记忆统计",
  "Get memory item": "获取记忆条目",
  "Update memory item": "更新记忆条目",
  "Delete memory item": "删除记忆条目",
  "Batch update memory item status": "批量更新记忆条目状态",
  "Batch delete memory items": "批量删除记忆条目",
  "Create memory edge": "创建记忆边",
  "List memory edges": "列出记忆边",
  "Get memory edge": "获取记忆边",
  "Delete memory edge": "删除记忆边",
  "Import SillyTavern preset": "导入 SillyTavern 预设",
  "Import SillyTavern worldbook": "导入 SillyTavern 世界书",
  "Import SillyTavern regex scripts": "导入 SillyTavern 正则脚本",
  "Import SillyTavern character card": "导入 SillyTavern 角色卡",
  "List imported presets": "列出已导入预设",
  "Get imported preset": "获取已导入预设",
  "Delete imported preset": "删除已导入预设",
  "List imported worldbooks": "列出已导入世界书",
  "Get imported worldbook": "获取已导入世界书",
  "Update imported worldbook by id": "按 ID 更新已导入世界书",
  "Delete imported worldbook": "删除已导入世界书",
  "List imported regex profiles": "列出已导入正则配置",
  "Get imported regex profile": "获取已导入正则配置",
  "Delete imported regex profile": "删除已导入正则配置",
  "Dry-run prompt assembly": "Prompt 组装演练",
  "Assemble prompt and return debug metadata without calling LLM or writing turn data.": "组装 prompt，并在不调用 LLM、不写入轮次数据的情况下返回调试元数据。",
  "Stream chat response via SSE": "通过 SSE 流式返回聊天响应",
  "Start a chat turn and stream generated chunks as Server-Sent Events.": "启动一轮对话，并以 Server-Sent Events 流式返回生成片段。",
  "SSE stream payload (start/chunk/summary/done/error events).": "SSE 流载荷（start/chunk/summary/done/error 事件）。",
  "Respond in a session": "在会话中回复",
  "Append user input and generate assistant response for the session.": "追加用户输入并为会话生成助手回复。",
  "Regenerate the last assistant response": "重新生成上一条助手回复",
  "Regenerate the latest committed floor response and keep the previous floor as superseded branch.": "重新生成最近一次已提交楼层的回复，并将旧楼层保留为 superseded 分支。",
  "Retry a failed floor": "重试失败楼层",
  "Retry generation for an existing failed floor.": "对已有失败楼层重新生成。",
  "Edit a user message and regenerate": "编辑用户消息并重新生成",
  "Create a new branch floor from an edited user message and regenerate assistant response.": "基于编辑后的用户消息创建新分支楼层，并重新生成助手回复。",
  "List characters": "列出角色",
  "Get character": "获取角色",
  "List character versions": "列出角色版本",
  "Create character version": "创建角色版本",
  "Rollback character to target version": "回滚角色到目标版本",
  "Soft-delete character": "软删除角色",
  "Restore deleted character": "恢复已删除角色",
  "List accounts": "列出账号",
  "Create account": "创建账号",
  "Create user": "创建用户",
  "List users": "列出用户",
  "Get user": "获取用户",
  "Update user": "更新用户",
  "Delete user": "删除用户",
  "Create LLM profile": "创建 LLM 配置档案",
  "List LLM profiles": "列出 LLM 配置档案",
  "Discover provider model list": "发现 provider 模型列表",
  "Send a Hello probe to provider model": "向 provider 模型发送 Hello 探测",
  "Get LLM profile by id": "按 ID 获取 LLM 配置档案",
  "Update LLM profile": "更新 LLM 配置档案",
  "Delete LLM profile": "删除 LLM 配置档案",
  "Get runtime LLM info for all instance slots": "获取各实例槽位的运行时 LLM 信息",
  "Activate LLM profile": "激活 LLM 配置档案",
  "Account management": "账号管理",
  "Account user-card management": "账号用户卡管理",
  "LLM profile vault and activation": "LLM 配置档案与激活绑定",
};

export function resolveApiDocLanguage(request: Pick<FastifyRequest, "query" | "headers">): ApiDocLanguage {
  const queryLanguage = normalizeLanguage(extractQueryLang(request.query));
  if (queryLanguage) {
    return queryLanguage;
  }

  const refererLanguage = normalizeLanguage(extractRefererLang(request.headers.referer));
  if (refererLanguage) {
    return refererLanguage;
  }

  const acceptLanguage = request.headers["accept-language"];
  if (typeof acceptLanguage === "string") {
    const primaryLanguage = normalizeLanguage(acceptLanguage.split(",")[0]?.trim());
    if (primaryLanguage) {
      return primaryLanguage;
    }
  }

  return "en";
}

export function cloneOpenApiDocument<T>(document: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(document);
  }

  return JSON.parse(JSON.stringify(document)) as T;
}

export function localizeOpenApiDocument<T>(document: T, language: ApiDocLanguage): T {
  if (language !== "zh") {
    return document;
  }

  const spec = document as OpenApiDocument;

  if (spec.info) {
    spec.info.title = "TavernHeadless API 文档";
    spec.info.description = translateText(spec.info.description);
  }

  if (Array.isArray(spec.tags)) {
    for (const tag of spec.tags) {
      if (!tag) {
        continue;
      }

      if (tag.name && TAG_DESCRIPTION_ZH[tag.name]) {
        tag.description = TAG_DESCRIPTION_ZH[tag.name];
      } else {
        tag.description = translateText(tag.description);
      }
    }
  }

  if (spec.paths && typeof spec.paths === "object") {
    for (const pathItem of Object.values(spec.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = pathItem?.[method] as OpenApiOperation | undefined;
        if (!operation || typeof operation !== "object") {
          continue;
        }

        operation.summary = translateText(operation.summary);
        operation.description = translateText(operation.description);
      }
    }
  }

  return document;
}

function translateText(text: string | undefined): string | undefined {
  if (!text) {
    return text;
  }

  return TEXT_ZH_MAP[text] ?? text;
}

function extractQueryLang(query: unknown): string | undefined {
  if (!query || typeof query !== "object") {
    return undefined;
  }

  const value = (query as Record<string, unknown>).lang;
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
}

function extractRefererLang(referer: string | undefined): string | undefined {
  if (!referer) {
    return undefined;
  }

  try {
    return new URL(referer).searchParams.get("lang") ?? undefined;
  } catch {
    return undefined;
  }
}

function normalizeLanguage(value: string | undefined): ApiDocLanguage | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("zh")) {
    return "zh";
  }

  if (normalized.startsWith("en")) {
    return "en";
  }

  return undefined;
}
