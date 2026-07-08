import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  ProjectAccessService,
  ProjectAccessServiceError,
  type ProjectAccess,
  type ProjectActorInput,
} from "../services/project-access-service.js";
import type { ToolCatalogEntry } from "../services/tool-catalog.js";
import {
  ToolPolicyPresetService,
  ToolPolicyPresetServiceError,
  type EffectiveToolPolicy,
  type ToolPolicyPresetConfig,
  type ToolPolicyPresetDetail,
  type ToolPolicyPresetScope,
  type ToolPolicyPresetSummary,
} from "../services/tool-policy-preset-service.js";

const projectIdParamsSchema = z.object({ id: z.string().min(1) });
const presetParamsSchema = z.object({ id: z.string().min(1), key: z.string().min(1) });

/** 预设配置请求体（snake_case，对齐既有第一方路由风格）。 */
const configBodySchema = z
  .object({
    enabled_tools: z.array(z.string().min(1)).optional(),
    decisions: z.record(z.enum(["auto", "confirm"])).optional(),
    max_calls_per_turn: z.number().int().positive().optional(),
    allow_irreversible: z.boolean().optional(),
  })
  .strict();

const createBodySchema = z
  .object({
    preset_key: z.string().min(1),
    display_name: z.string().min(1),
    config: configBodySchema.optional(),
  })
  .strict();

type ConfigBody = z.infer<typeof configBodySchema>;

function actorFromRequest(request: FastifyRequest): ProjectActorInput {
  const auth = getRequestAuthContext(request);
  return {
    actorType: auth.actorType,
    actorAccountId: auth.accountId,
    actorClientId: auth.actorType === "client" ? auth.actorClientId : null,
  };
}

function scopeFromAccess(access: ProjectAccess): ToolPolicyPresetScope {
  return {
    workspaceId: access.project.workspaceId,
    projectId: access.project.id,
    accountId: access.project.accountId,
  };
}

/** 请求体（snake_case）转服务层 config 输入（camelCase）；缺省字段透传缺省，交由服务层严格校验。 */
function toServiceConfigInput(body: ConfigBody | undefined): Record<string, unknown> {
  if (!body) {
    return {};
  }
  return {
    ...(body.enabled_tools !== undefined ? { enabledTools: body.enabled_tools } : {}),
    ...(body.decisions !== undefined ? { decisions: body.decisions } : {}),
    ...(body.max_calls_per_turn !== undefined ? { maxCallsPerTurn: body.max_calls_per_turn } : {}),
    ...(body.allow_irreversible !== undefined ? { allowIrreversible: body.allow_irreversible } : {}),
  };
}

function toolCatalogEntryToResponse(entry: ToolCatalogEntry) {
  return {
    tool_name: entry.toolName,
    category: entry.category,
    side_effect_level: entry.sideEffectLevel,
    description: entry.description,
  };
}

function summaryToResponse(summary: ToolPolicyPresetSummary) {
  return {
    preset_key: summary.presetKey,
    kind: summary.kind,
    display_name: summary.displayName,
    customized: summary.customized,
    enabled_count: summary.enabledCount,
    auto_count: summary.autoCount,
    confirm_count: summary.confirmCount,
  };
}

function effectiveToolToResponse(tool: EffectiveToolPolicy) {
  return {
    tool_name: tool.toolName,
    category: tool.category,
    side_effect_level: tool.sideEffectLevel,
    description: tool.description,
    enabled: tool.enabled,
    default_decision: tool.defaultDecision,
    decision: tool.decision,
    source: tool.source,
  };
}

function configToResponse(config: ToolPolicyPresetConfig) {
  return {
    enabled_tools: config.enabledTools,
    decisions: config.decisions,
    ...(config.maxCallsPerTurn !== undefined ? { max_calls_per_turn: config.maxCallsPerTurn } : {}),
    ...(config.allowIrreversible !== undefined ? { allow_irreversible: config.allowIrreversible } : {}),
  };
}

function detailToResponse(detail: ToolPolicyPresetDetail) {
  return {
    ...summaryToResponse(detail),
    config: configToResponse(detail.config),
    tools: detail.tools.map(effectiveToolToResponse),
  };
}

function handlePresetError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof ProjectAccessServiceError) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }
  if (error instanceof ToolPolicyPresetServiceError) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }
  return false;
}

/**
 * 注册工具策略预设（Tool Policy Preset）的项目级路由（SC2-10 / #b4-5）。
 *
 * 预设 = 一组「哪些工具暴露给 LLM + 每个工具 auto/confirm」的命名集合，作用域为项目级（决策 A）。
 * 内置预设（`regular-chat` / `asset-management`）默认值来自代码，DB 仅存覆盖/自定义。
 *
 * 这些路由属于第一方接入面，不进入 OpenAPI / @tavern/sdk 生成面；studio 经薄客户端直连。
 * 读用 `project.config.read`，写用 `project.config.write`。
 */
export async function registerToolPolicyPresetRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  const db = connection.db;

  // 列出项目下全部预设（内置 + 自定义）+ 统一工具目录。
  app.get("/projects/:id/tool-policy-presets", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(
        actor,
        params.data.id,
        "project.config.read",
      );
      const service = new ToolPolicyPresetService(db);
      return reply.send({
        tool_catalog: service.listToolCatalog().map(toolCatalogEntryToResponse),
        presets: service.listPresets(scopeFromAccess(access)).map(summaryToResponse),
      });
    } catch (error) {
      if (handlePresetError(reply, error)) return;
      throw error;
    }
  });

  // 单个预设明细（逐工具 effective 策略）。
  app.get("/projects/:id/tool-policy-presets/:key", async (request, reply) => {
    const params = parseWithSchema(presetParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(
        actor,
        params.data.id,
        "project.config.read",
      );
      const detail = new ToolPolicyPresetService(db).getEffective(scopeFromAccess(access), params.data.key);
      return reply.send(detailToResponse(detail));
    } catch (error) {
      if (handlePresetError(reply, error)) return;
      throw error;
    }
  });

  // 更新已存在预设（内置 → 写覆盖行；自定义 → 更新行）。
  app.put("/projects/:id/tool-policy-presets/:key", async (request, reply) => {
    const params = parseWithSchema(presetParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(configBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(
        actor,
        params.data.id,
        "project.config.write",
      );
      const detail = new ToolPolicyPresetService(db).upsertPreset(
        scopeFromAccess(access),
        params.data.key,
        toServiceConfigInput(body.data),
      );
      return reply.send(detailToResponse(detail));
    } catch (error) {
      if (handlePresetError(reply, error)) return;
      throw error;
    }
  });

  // 重置预设（内置 → 删除覆盖行回到 baseline；自定义 → 拒绝）。
  app.post("/projects/:id/tool-policy-presets/:key/reset", async (request, reply) => {
    const params = parseWithSchema(presetParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(
        actor,
        params.data.id,
        "project.config.write",
      );
      const detail = new ToolPolicyPresetService(db).resetPreset(scopeFromAccess(access), params.data.key);
      return reply.send(detailToResponse(detail));
    } catch (error) {
      if (handlePresetError(reply, error)) return;
      throw error;
    }
  });

  // 新建自定义预设。
  app.post("/projects/:id/tool-policy-presets", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(createBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(
        actor,
        params.data.id,
        "project.config.write",
      );
      const detail = new ToolPolicyPresetService(db).createCustomPreset(scopeFromAccess(access), {
        presetKey: body.data.preset_key,
        displayName: body.data.display_name,
        config: toServiceConfigInput(body.data.config),
      });
      return reply.code(201).send(detailToResponse(detail));
    } catch (error) {
      if (handlePresetError(reply, error)) return;
      throw error;
    }
  });

  // 删除自定义预设（内置预设拒绝 409 builtin_preset_immutable）。
  app.delete("/projects/:id/tool-policy-presets/:key", async (request, reply) => {
    const params = parseWithSchema(presetParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(
        actor,
        params.data.id,
        "project.config.write",
      );
      new ToolPolicyPresetService(db).deleteCustomPreset(scopeFromAccess(access), params.data.key);
      return reply.send({ ok: true });
    } catch (error) {
      if (handlePresetError(reply, error)) return;
      throw error;
    }
  });
}
