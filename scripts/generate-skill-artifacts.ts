import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_BASE_PATH = "/TavernHeadless/";
const SKILLS_ROOT = resolve("vitepress/public/agent/skills");

type SkillStatus = "draft" | "active" | "deprecated";

interface SkillCatalogItem {
  skillId: string;
  title: string;
  summary: string;
  status: SkillStatus;
  humanPage: string;
  json: string;
}

interface SkillDocument {
  contractVersion: number;
  skillId: string;
  title: string;
  summary: string;
  status: SkillStatus;
  audience: string[];
  recommendedWhen: string[];
  avoidWhen: string[];
  decisionRules: Array<{
    title: string;
    rule: string;
  }>;
  workflow: Array<{
    step: number;
    title: string;
    action: string;
    relatedAgentFields?: string[];
  }>;
  checks: Array<{
    command: string;
    purpose: string;
  }>;
  relatedAgentFields: string[];
  relatedDocs: Array<{
    title: string;
    path: string;
  }>;
  humanPage: string;
  json: string;
  lastReviewedAt: string;
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  const basePath = normalizeBasePath(process.env.AGENT_BASE_PATH ?? DEFAULT_BASE_PATH);

  const skills = [
    buildClientIntegrationSkill(basePath, generatedAt),
    buildProjectContributingSkill(basePath, generatedAt),
  ];
  const catalogItems = skills.map(toCatalogItem);

  await rm(SKILLS_ROOT, { recursive: true, force: true });
  await mkdir(SKILLS_ROOT, { recursive: true });

  await writeJsonFile(resolve(SKILLS_ROOT, "catalog.json"), {
    contractVersion: 1,
    generatedAt,
    humanEntry: sitePath(basePath, "agent/skills/"),
    skills: catalogItems,
  });

  for (const skill of skills) {
    await writeJsonFile(resolve(SKILLS_ROOT, `${skill.skillId}.json`), skill);
  }

  console.log(`[skill-artifacts] generated ${skills.length} skills`);
}

function toCatalogItem(skill: SkillDocument): SkillCatalogItem {
  return {
    skillId: skill.skillId,
    title: skill.title,
    summary: skill.summary,
    status: skill.status,
    humanPage: skill.humanPage,
    json: skill.json,
  };
}

function buildClientIntegrationSkill(basePath: string, generatedAt: string): SkillDocument {
  const humanPage = sitePath(basePath, "agent/skills/tavern-client-integration/");
  const json = sitePath(basePath, "agent/skills/tavern-client-integration.json");

  return {
    contractVersion: 1,
    skillId: "tavern-client-integration",
    title: "客户端接入与升级",
    summary:
      "指导客户端开发者按推荐路径接入 TavernHeadless，并结合 /agent manifest 评估升级影响。",
    status: "active",
    audience: [
      "web-client-developers",
      "desktop-client-developers",
      "script-integrators",
      "agent-consumers",
    ],
    recommendedWhen: [
      "需要新接入 TavernHeadless 客户端时。",
      "需要升级已有客户端接入代码时。",
      "需要根据 /agent manifest 判断本地影响面时。",
    ],
    avoidWhen: [
      "只处理后端内部实现细节时。",
      "只处理页面交互、组件布局和框架绑定时。",
      "只需要逐字段查看协议和错误码时。",
    ],
    decisionRules: [
      {
        title: "公开资源请求优先使用 @tavern/sdk",
        rule: "只要任务主要是调用公开资源、处理 HTTP、SSE 和统一错误，就应优先从 @tavern/sdk 开始。",
      },
      {
        title: "语义整理优先使用 @tavern/client-helpers",
        rule: "当任务主要是整理 timeline、usage、流式中间态或界面错误映射时，应优先使用 @tavern/client-helpers。",
      },
      {
        title: "不要把 @tavern/shared 当成公开接入面",
        rule: "客户端代码不应直接建立在 @tavern/shared 之上，以免绑定到内部实现边界。",
      },
      {
        title: "原始 HTTP 和 SSE 只作为补位方案",
        rule: "只有在官方包当前没有覆盖目标能力时，才应在本地单独封装原始 HTTP 或 SSE。",
      },
    ],
    workflow: [
      {
        step: 1,
        title: "读取 Agent 入口",
        action: "先读取 /agent/index.json 和 /agent/latest.json，确认最新 commit 和 manifest 地址。",
      },
      {
        step: 2,
        title: "读取单次 manifest",
        action: "读取最新 commit 对应的 manifest，先判断是否涉及 OpenAPI、SDK 或 client-helpers 变化。",
        relatedAgentFields: [
          "summary.breaking",
          "surfaceSummaries.openapi",
          "surfaceSummaries.sdk",
          "surfaceSummaries.clientHelpers",
        ],
      },
      {
        step: 3,
        title: "定位优先检查点",
        action: "重点查看 impactedExports、impactedModules 和 impactedConsumers，优先回归直接 import 这些 symbol 的本地文件。",
        relatedAgentFields: [
          "surfaceSummaries.sdk.impactedExports",
          "surfaceSummaries.sdk.impactedModules",
          "surfaceSummaries.sdk.impactedConsumers",
          "surfaceSummaries.clientHelpers.impactedConsumers",
        ],
      },
      {
        step: 4,
        title: "按边界选择公开包",
        action: "资源请求优先使用 @tavern/sdk，语义整理优先使用 @tavern/client-helpers，组件和 store 逻辑留在应用层。",
      },
      {
        step: 5,
        title: "执行本地验证",
        action: "完成调整后执行类型检查和测试，必要时补充 docs build 或受影响模块测试。",
      },
    ],
    checks: [
      {
        command: "pnpm typecheck",
        purpose: "验证导入、类型和调用签名是否仍然一致。",
      },
      {
        command: "pnpm test",
        purpose: "验证受影响能力的本地回归。",
      },
      {
        command: "pnpm docs:build",
        purpose: "当接入文档、示例或公开入口也受到影响时，补充检查文档站构建。",
      },
    ],
    relatedAgentFields: [
      "summary.breaking",
      "surfaceSummaries.openapi",
      "surfaceSummaries.openapi.schemaFieldChanges",
      "surfaceSummaries.sdk",
      "surfaceSummaries.sdk.impactedExports",
      "surfaceSummaries.sdk.impactedModules",
      "surfaceSummaries.sdk.impactedConsumers",
      "surfaceSummaries.clientHelpers",
      "surfaceSummaries.clientHelpers.impactedConsumers",
    ],
    relatedDocs: [
      { title: "Agent 与 Skill 总入口", path: sitePath(basePath, "agent/") },
      { title: "Skill 索引", path: sitePath(basePath, "agent/skills/") },
      { title: "官方集成层", path: sitePath(basePath, "guide/integration-kit") },
      { title: "SDK 总览", path: sitePath(basePath, "sdk/") },
      { title: "API 参考", path: sitePath(basePath, "reference/api") },
    ],
    humanPage,
    json,
    lastReviewedAt: generatedAt,
  };
}

function buildProjectContributingSkill(basePath: string, generatedAt: string): SkillDocument {
  const humanPage = sitePath(basePath, "agent/skills/tavern-project-contributing/");
  const json = sitePath(basePath, "agent/skills/tavern-project-contributing.json");

  return {
    contractVersion: 1,
    skillId: "tavern-project-contributing",
    title: "参与开发与协作",
    summary:
      "指导贡献者按当前仓库的分层边界、验证要求和 PR 规范参与 TavernHeadless 开发。",
    status: "active",
    audience: [
      "contributors",
      "api-developers",
      "web-developers",
      "sdk-maintainers",
      "docs-contributors",
    ],
    recommendedWhen: [
      "准备第一次参与 TavernHeadless 开发时。",
      "需要判断改动应该落在哪一层时。",
      "需要同步处理官方包、文档和验证要求时。",
    ],
    avoidWhen: [
      "只想接入 TavernHeadless，而不是参与仓库开发时。",
      "只需要查看具体协议字段和错误码时。",
      "只处理局部页面视觉和单页交互细节时。",
    ],
    decisionRules: [
      {
        title: "先判断改动属于哪一层",
        rule: "开始实现前，先确认改动属于 core、api、web、shared，还是官方集成层，避免边界混乱。",
      },
      {
        title: "公开接入面只通过两个官方包暴露",
        rule: "新增公开接入能力时，不应落到 @tavern/shared，而应评估是否进入 @tavern/sdk 或 @tavern/client-helpers。",
      },
      {
        title: "外部可见语义变化要联动官方包和文档",
        rule: "只要后端语义、OpenAPI、SSE 或公开行为变化，就应在同一个 PR 中检查官方包和文档同步。",
      },
      {
        title: "按改动范围选择最小但完整的验证",
        rule: "代码 PR 至少执行 lint、typecheck 和相应测试；涉及 OpenAPI 或官方包生成面时，要补充 sdk:generate 和 sdk:check。",
      },
    ],
    workflow: [
      {
        step: 1,
        title: "阅读当前协作规则",
        action: "先阅读 README、协作指南、测试与 CI，以及必要时的文档规范，确认当前仓库规则。",
      },
      {
        step: 2,
        title: "判断改动边界",
        action: "开始写代码前，先确认改动属于哪一层，并判断是否会影响 @tavern/sdk、@tavern/client-helpers 或公开文档。",
      },
      {
        step: 3,
        title: "必要时读取 Agent 更新面",
        action: "如果是在跟进最近一次主干外部变更，先读取 /agent/latest.json 和 manifest，确认当前公开变化已经覆盖到哪些表面。",
        relatedAgentFields: [
          "summary.domains",
          "summary.breaking",
          "changes",
          "surfaceSummaries.openapi",
          "surfaceSummaries.sdk",
          "surfaceSummaries.clientHelpers",
        ],
      },
      {
        step: 4,
        title: "同步更新文档和接入层",
        action: "如果改动已经影响公开行为，应在同一个 PR 中同步更新官方包、文档和必要的示例。",
      },
      {
        step: 5,
        title: "完成本地验证和 PR 说明",
        action: "按范围执行最小但完整的验证，并在 PR 中说明影响范围、验证方式，以及是否影响官方包和 OpenAPI。",
      },
    ],
    checks: [
      {
        command: "pnpm lint",
        purpose: "通用代码 PR 的基础检查。",
      },
      {
        command: "pnpm typecheck",
        purpose: "验证整个仓库的类型一致性。",
      },
      {
        command: "pnpm test:ci",
        purpose: "在合并前复现 CI 常规测试路径。",
      },
      {
        command: "pnpm sdk:generate && pnpm sdk:check",
        purpose: "当改动影响 OpenAPI 或官方包生成面时，检查生成物是否仍然一致。",
      },
      {
        command: "pnpm docs:build",
        purpose: "当只改文档或公开入口说明时，确认文档站仍可构建。",
      },
    ],
    relatedAgentFields: [
      "summary.domains",
      "summary.breaking",
      "changes",
      "surfaceSummaries.openapi",
      "surfaceSummaries.sdk",
      "surfaceSummaries.clientHelpers",
    ],
    relatedDocs: [
      { title: "Agent 与 Skill 总入口", path: sitePath(basePath, "agent/") },
      { title: "Skill 索引", path: sitePath(basePath, "agent/skills/") },
      { title: "协作指南", path: sitePath(basePath, "development/contributing") },
      { title: "测试与 CI", path: sitePath(basePath, "development/testing") },
      { title: "文档规范", path: sitePath(basePath, "development/doc-standards") },
      { title: "官方集成层", path: sitePath(basePath, "guide/integration-kit") },
    ],
    humanPage,
    json,
    lastReviewedAt: generatedAt,
  };
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function sitePath(basePath: string, relativePath: string): string {
  const normalizedBasePath = normalizeBasePath(basePath);
  const normalizedRelativePath = relativePath.replace(/^\/+/, "");

  if (normalizedBasePath === "/") {
    return `/${normalizedRelativePath}`;
  }

  return `${normalizedBasePath}${normalizedRelativePath}`;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[skill-artifacts] ${message}`);
  process.exit(1);
});
