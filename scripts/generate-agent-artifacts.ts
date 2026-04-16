import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = resolve(".");

const DEFAULT_PROJECT = "TavernHeadless";
const DEFAULT_REPOSITORY = "HerSophia/TavernHeadless";
const DEFAULT_BASE_PATH = "/TavernHeadless/";
const DEFAULT_RETENTION = 50;
const AGENT_ROOT = resolve("vitepress/public/agent");
const MANIFESTS_ROOT = resolve(AGENT_ROOT, "manifests");
const OPENAPI_GENERATED_PATH = "packages/shared/src/generated/openapi.json";
const SDK_ENTRY_PATH = "packages/official-integration-kit/sdk/src/index.ts";
const CLIENT_HELPERS_ENTRY_PATH = "packages/official-integration-kit/client-helpers/src/index.ts";
const SDK_PACKAGE_ROOT = "packages/official-integration-kit/sdk/";
const CLIENT_HELPERS_PACKAGE_ROOT = "packages/official-integration-kit/client-helpers/";
const OPENAPI_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "trace"] as const;
const MAX_SURFACE_ITEMS = 10;
const MAX_EXPORT_ITEMS = 20;
const MAX_FIELD_CHANGE_ITEMS = 20;

type SurfaceStatus = "changed" | "unchanged" | "unavailable";

type DomainName =
  | "docs"
  | "api"
  | "web"
  | "sdk"
  | "client-helpers"
  | "openapi"
  | "core"
  | "adapters"
  | "shared"
  | "ci"
  | "other";

interface AgentContext {
  project: string;
  repository: string;
  branch: string;
  commit: string;
  workflow: string;
  workflowRunId: number;
  conclusion: string;
  publishedAt: string;
  basePath: string;
  siteUrl: string;
  retention: number;
  commitMessage: string;
}

interface HistoryItem {
  commit: string;
  publishedAt: string;
  breaking: boolean;
  manifest: string;
}

interface HistoryDocument {
  retention: number;
  items: HistoryItem[];
}

interface PublishedHistorySnapshot {
  compareBaseCommit: string | null;
  items: HistoryItem[];
  manifestContents: Map<string, string>;
}

interface DomainRule {
  domain: DomainName;
  target: string;
  prefixes: string[];
  exact?: string[];
  migrationHint?: string;
}

interface ManifestChange {
  domain: DomainName;
  kind: "breaking" | "non_breaking";
  target: string;
  changeType: string;
  description: string;
  migrationHint?: string;
}

interface OpenApiOperationPreview {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
}

interface OpenApiSchemaFieldChangePreview {
  operation: OpenApiOperationPreview;
  location: string;
  changeType: "field_added" | "field_removed" | "field_changed";
  fieldPath: string;
  detail: string;
  previousType?: string;
  currentType?: string;
  previousRequired?: boolean;
  currentRequired?: boolean;
}

interface OpenApiSchemaFieldDescriptor {
  path: string;
  typeLabel: string;
  required: boolean;
  signature: string;
}

interface OpenApiSchemaFieldComparison {
  addedCount: number;
  removedCount: number;
  changedCount: number;
  changes: OpenApiSchemaFieldChangePreview[];
}

interface OpenApiSurfaceSummary {
  status: SurfaceStatus;
  summary: string;
  compareBaseCommit: string | null;
  currentVersion: string | null;
  previousVersion: string | null;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  addedOperations: OpenApiOperationPreview[];
  removedOperations: OpenApiOperationPreview[];
  changedOperations: OpenApiOperationPreview[];
  schemaFieldAddedCount: number;
  schemaFieldRemovedCount: number;
  schemaFieldChangedCount: number;
  schemaFieldChanges: OpenApiSchemaFieldChangePreview[];
  migrationHint: string;
}

interface PackageSurfaceSummary {
  packageName: string;
  status: SurfaceStatus;
  summary: string;
  entryFile: string;
  compareBaseCommit: string | null;
  changedFileCount: number;
  changedFiles: string[];
  affectedModules: string[];
  currentExportCount: number;
  previousExportCount: number;
  addedExportCount: number;
  removedExportCount: number;
  addedExports: string[];
  removedExports: string[];
  publicExportsChanged: boolean;
  impactedExportCount: number;
  impactedExports: PackageExportImpactPreview[];
  impactedModuleCount: number;
  impactedModules: PackageModuleImpactPreview[];
  consumerFileCount: number;
  impactedConsumerCount: number;
  impactedConsumers: PackageConsumerImpactPreview[];
  migrationHint: string;
}

interface PackageExportSymbolDescriptor {
  exportName: string;
  sourceModule: string;
  viaModules: string[];
  isTypeOnly: boolean;
}

interface PackageExportImpactPreview {
  exportName: string;
  impactType: "export_added" | "export_removed" | "symbol_impacted";
  sourceModule: string;
  viaModules: string[];
  isTypeOnly: boolean;
}

interface PackageModuleImpactPreview {
  module: string;
  changeType: "changed" | "added" | "removed";
  exportCount: number;
  exports: string[];
}

interface PackageConsumerImpactPreview {
  file: string;
  line: number;
  importMode: "named" | "namespace" | "default" | "mixed";
  importedSymbols: string[];
  matchedExports: string[];
  note: string;
}

interface ManifestDocument {
  eventId: string;
  source: {
    repo: string;
    branch: string;
    commit: string;
    workflow: string;
    workflowRunId: number;
    conclusion: string;
  };
  compareBase?: {
    commit: string;
  };
  summary: {
    breaking: boolean;
    domains: DomainName[];
  };
  changes: ManifestChange[];
  surfaceSummaries: {
    openapi: OpenApiSurfaceSummary | null;
    sdk: PackageSurfaceSummary | null;
    clientHelpers: PackageSurfaceSummary | null;
  };
  recommendedActions: string[];
  artifacts: {
    integrationGuide: string;
    apiReference: string;
    sdkDocs: string;
    clientHelpersDocs: string;
  };
  links: {
    humanEntry: string;
    docs: string;
  };
}

interface OpenApiOperationRecord {
  preview: OpenApiOperationPreview;
  hash: string;
  operation: Record<string, unknown>;
}

interface PackageSurfaceOptions {
  packageName: string;
  packageRoot: string;
  entryFile: string;
  compareBaseCommit: string | null;
  changedFiles: string[];
}

interface ReExportSpecifier {
  importedName: string;
  exportedName: string;
  isTypeOnly: boolean;
}

const DOMAIN_RULES: DomainRule[] = [
  {
    domain: "docs",
    target: "documentation",
    prefixes: ["vitepress/", "docs/"],
    exact: ["README.md", "PROGRESS.md", "apps/api/PROGRESS.md", "apps/web/PROGRESS.md"],
    migrationHint: "同步检查文档入口、公开说明和接入指引。",
  },
  {
    domain: "api",
    target: "apps/api",
    prefixes: ["apps/api/"],
    migrationHint: "检查受影响接口的请求体、响应体和错误语义。",
  },
  {
    domain: "web",
    target: "apps/web",
    prefixes: ["apps/web/"],
    migrationHint: "检查管理前端对公开接口和官方包的依赖点。",
  },
  {
    domain: "sdk",
    target: "@tavern/sdk",
    prefixes: [SDK_PACKAGE_ROOT],
    migrationHint: "更新依赖后重新运行 typecheck，并检查受影响资源方法。",
  },
  {
    domain: "client-helpers",
    target: "@tavern/client-helpers",
    prefixes: [CLIENT_HELPERS_PACKAGE_ROOT],
    migrationHint: "检查语义辅助层的导出变化，并重新验证调用方。",
  },
  {
    domain: "openapi",
    target: "openapi",
    prefixes: ["packages/shared/src/generated/openapi", "packages/shared/src/generated/openapi-types", "apps/api/openapi/"],
    migrationHint: "如果工作区保存本地生成物，请重新生成并校验类型。",
  },
  {
    domain: "core",
    target: "packages/core",
    prefixes: ["packages/core/"],
    migrationHint: "检查核心运行语义变化是否会影响外部接入层。",
  },
  {
    domain: "adapters",
    target: "packages/adapters-sillytavern",
    prefixes: ["packages/adapters-sillytavern/"],
    migrationHint: "检查兼容层行为变化是否影响导入导出和兼容路径。",
  },
  {
    domain: "shared",
    target: "packages/shared",
    prefixes: ["packages/shared/"],
    migrationHint: "检查共享类型、生成物和内部契约变化。",
  },
  {
    domain: "ci",
    target: "github-actions",
    prefixes: [".github/workflows/", ".github/filters/"],
    migrationHint: "检查 CI 行为变化是否影响发布和验证流程。",
  },
];

async function main(): Promise<void> {
  const context = await resolveContext();
  const publishedHistory = await loadPublishedHistory(context.siteUrl, context.retention);
  const compareBaseCommit = publishedHistory.compareBaseCommit ?? (await resolveParentCommit(context.commit));
  const changedFiles = await resolveChangedFiles(compareBaseCommit, context.commit);
  const breaking = isBreakingChange(context.commitMessage);
  const openapiSummary = await buildOpenApiSurfaceSummary(compareBaseCommit);
  const sdkSummary = await buildPackageSurfaceSummary({
    packageName: "@tavern/sdk",
    packageRoot: SDK_PACKAGE_ROOT,
    entryFile: SDK_ENTRY_PATH,
    compareBaseCommit,
    changedFiles,
  });
  const clientHelpersSummary = await buildPackageSurfaceSummary({
    packageName: "@tavern/client-helpers",
    packageRoot: CLIENT_HELPERS_PACKAGE_ROOT,
    entryFile: CLIENT_HELPERS_ENTRY_PATH,
    compareBaseCommit,
    changedFiles,
  });
  const { domains, changes } = summarizeChanges({
    changedFiles,
    breaking,
    openapiSummary,
    sdkSummary,
    clientHelpersSummary,
  });
  const recommendedActions = buildRecommendedActions({
    domains,
    openapiSummary,
    sdkSummary,
    clientHelpersSummary,
  });
  const currentManifestPath = sitePath(context.basePath, `agent/manifests/${context.commit}.json`);

  const manifest: ManifestDocument = {
    eventId: `tavernheadless-${sanitizeEventToken(context.branch)}-${context.commit}`,
    source: {
      repo: context.repository,
      branch: context.branch,
      commit: context.commit,
      workflow: context.workflow,
      workflowRunId: context.workflowRunId,
      conclusion: context.conclusion,
    },
    summary: {
      breaking,
      domains,
    },
    changes,
    surfaceSummaries: {
      openapi: openapiSummary,
      sdk: sdkSummary,
      clientHelpers: clientHelpersSummary,
    },
    recommendedActions,
    artifacts: {
      integrationGuide: sitePath(context.basePath, "guide/integration-kit"),
      apiReference: sitePath(context.basePath, "reference/api"),
      sdkDocs: sitePath(context.basePath, "sdk/"),
      clientHelpersDocs: sitePath(context.basePath, "sdk/client-helpers"),
    },
    links: {
      humanEntry: sitePath(context.basePath, "agent/"),
      docs: sitePath(context.basePath, "guide/integration-kit"),
    },
  };

  if (compareBaseCommit) {
    manifest.compareBase = { commit: compareBaseCommit };
  }

  const currentHistoryItem: HistoryItem = {
    commit: context.commit,
    publishedAt: context.publishedAt,
    breaking,
    manifest: currentManifestPath,
  };

  const mergedHistory = mergeHistory(currentHistoryItem, publishedHistory.items, context.retention);

  await rm(AGENT_ROOT, { recursive: true, force: true });
  await mkdir(MANIFESTS_ROOT, { recursive: true });

  for (const item of mergedHistory.items) {
    if (item.commit === context.commit) {
      continue;
    }

    const previousManifest = publishedHistory.manifestContents.get(item.commit);
    if (!previousManifest) {
      continue;
    }

    await writeTextFile(resolve(MANIFESTS_ROOT, `${item.commit}.json`), previousManifest);
  }

  await writeJsonFile(resolve(MANIFESTS_ROOT, `${context.commit}.json`), manifest);
  await writeJsonFile(resolve(AGENT_ROOT, "index.json"), {
    contractVersion: 1,
    project: context.project,
    basePath: context.basePath,
    generatedAt: context.publishedAt,
    latest: sitePath(context.basePath, "agent/latest.json"),
    history: sitePath(context.basePath, "agent/history.json"),
    channels: sitePath(context.basePath, "agent/channels.json"),
    manifestsBase: sitePath(context.basePath, "agent/manifests/"),
    humanEntry: sitePath(context.basePath, "agent/"),
  });
  await writeJsonFile(resolve(AGENT_ROOT, "latest.json"), {
    repo: context.repository,
    branch: context.branch,
    commit: context.commit,
    workflow: context.workflow,
    workflowRunId: context.workflowRunId,
    publishedAt: context.publishedAt,
    summary: `${context.branch} branch ${context.workflow.toLowerCase()} snapshot published`,
    breaking,
    latestManifest: currentManifestPath,
  });
  await writeJsonFile(resolve(AGENT_ROOT, "history.json"), mergedHistory);
  await writeJsonFile(resolve(AGENT_ROOT, "channels.json"), {
    webhook: null,
    sse: null,
    socketio: null,
  });

  console.log(`[agent-artifacts] generated snapshot for ${context.commit}`);
}

async function resolveContext(): Promise<AgentContext> {
  const repository =
    process.env.AGENT_REPOSITORY ?? process.env.GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY;
  const basePath = normalizeBasePath(process.env.AGENT_BASE_PATH ?? DEFAULT_BASE_PATH);
  const commit =
    process.env.AGENT_HEAD_SHA ?? process.env.GITHUB_SHA ?? (await runGit(["rev-parse", "HEAD"]));
  const branch =
    process.env.AGENT_HEAD_BRANCH ??
    process.env.GITHUB_REF_NAME ??
    (await runGit(["rev-parse", "--abbrev-ref", "HEAD"]));
  const workflow = process.env.AGENT_WORKFLOW_NAME ?? process.env.GITHUB_WORKFLOW ?? "local";
  const workflowRunId = Number(
    process.env.AGENT_WORKFLOW_RUN_ID ?? process.env.GITHUB_RUN_ID ?? "0",
  );
  const publishedAt = process.env.AGENT_PUBLISHED_AT ?? new Date().toISOString();
  const conclusion = process.env.AGENT_CONCLUSION ?? "success";
  const project = process.env.AGENT_PROJECT ?? DEFAULT_PROJECT;
  const siteUrl = ensureTrailingSlash(
    process.env.AGENT_PUBLIC_SITE_URL ?? defaultSiteUrl(repository, basePath),
  );
  const retention = Number.parseInt(process.env.AGENT_HISTORY_RETENTION ?? `${DEFAULT_RETENTION}`, 10);
  const commitMessage = await runGit(["log", "-1", "--pretty=%B", commit]);

  return {
    project,
    repository,
    branch,
    commit,
    workflow,
    workflowRunId: Number.isFinite(workflowRunId) ? workflowRunId : 0,
    conclusion,
    publishedAt,
    basePath,
    siteUrl,
    retention: Number.isFinite(retention) && retention > 0 ? retention : DEFAULT_RETENTION,
    commitMessage,
  };
}

function defaultSiteUrl(repository: string, basePath: string): string {
  const owner = repository.split("/")[0] ?? "github";
  return `https://${owner.toLowerCase()}.github.io${basePath}`;
}

async function loadPublishedHistory(
  siteUrl: string,
  retention: number,
): Promise<PublishedHistorySnapshot> {
  const historyUrl = new URL("agent/history.json", siteUrl).toString();
  const emptySnapshot: PublishedHistorySnapshot = {
    compareBaseCommit: null,
    items: [],
    manifestContents: new Map<string, string>(),
  };

  try {
    const historyResponse = await fetch(historyUrl);
    if (!historyResponse.ok) {
      throw new Error(`request failed with status ${historyResponse.status}`);
    }

    const history = (await historyResponse.json()) as HistoryDocument;
    const historyItems = Array.isArray(history.items) ? history.items : [];
    const retainedItems = historyItems.slice(0, Math.max(retention - 1, 0));
    const manifestContents = new Map<string, string>();
    const usableItems: HistoryItem[] = [];

    for (const item of retainedItems) {
      if (!item?.commit || !item?.manifest) {
        continue;
      }

      try {
        const manifestUrl = new URL(item.manifest, siteUrl).toString();
        const manifestResponse = await fetch(manifestUrl);
        if (!manifestResponse.ok) {
          throw new Error(`request failed with status ${manifestResponse.status}`);
        }

        const manifestText = await manifestResponse.text();
        manifestContents.set(item.commit, manifestText);
        usableItems.push({
          commit: item.commit,
          publishedAt: item.publishedAt,
          breaking: Boolean(item.breaking),
          manifest: item.manifest,
        });
      } catch (error) {
        console.warn(
          `[agent-artifacts] failed to preserve published manifest for ${item.commit}: ${formatError(error)}`,
        );
      }
    }

    return {
      compareBaseCommit: historyItems[0]?.commit ?? null,
      items: usableItems,
      manifestContents,
    };
  } catch (error) {
    console.warn(`[agent-artifacts] failed to load published history: ${formatError(error)}`);
    return emptySnapshot;
  }
}

async function buildOpenApiSurfaceSummary(
  compareBaseCommit: string | null,
): Promise<OpenApiSurfaceSummary | null> {
  const currentSource = await readLocalFileMaybe(OPENAPI_GENERATED_PATH);
  if (!currentSource) {
    return null;
  }

  const currentDocument = parseJson<Record<string, unknown>>(currentSource);
  if (!currentDocument) {
    return {
      status: "unavailable",
      summary: "Current OpenAPI snapshot could not be parsed.",
      compareBaseCommit,
      currentVersion: null,
      previousVersion: null,
      addedCount: 0,
      removedCount: 0,
      changedCount: 0,
      addedOperations: [],
      removedOperations: [],
      changedOperations: [],
      schemaFieldAddedCount: 0,
      schemaFieldRemovedCount: 0,
      schemaFieldChangedCount: 0,
      schemaFieldChanges: [],
      migrationHint: "重新生成 OpenAPI 产物，并检查生成结果是否为合法 JSON。",
    };
  }

  const currentVersion = readOpenApiVersion(currentDocument);

  if (!compareBaseCommit) {
    return {
      status: "unavailable",
      summary: "OpenAPI baseline is unavailable, so operation and schema diff were skipped.",
      compareBaseCommit,
      currentVersion,
      previousVersion: null,
      addedCount: 0,
      removedCount: 0,
      changedCount: 0,
      addedOperations: [],
      removedOperations: [],
      changedOperations: [],
      schemaFieldAddedCount: 0,
      schemaFieldRemovedCount: 0,
      schemaFieldChangedCount: 0,
      schemaFieldChanges: [],
      migrationHint: "缺少基线时，请在工作区重新生成 OpenAPI 客户端并手动检查受影响路由。",
    };
  }

  const previousSource = await readGitFile(compareBaseCommit, OPENAPI_GENERATED_PATH);
  if (!previousSource) {
    return {
      status: "unavailable",
      summary: `OpenAPI baseline ${compareBaseCommit} is unavailable, so operation and schema diff were skipped.`,
      compareBaseCommit,
      currentVersion,
      previousVersion: null,
      addedCount: 0,
      removedCount: 0,
      changedCount: 0,
      addedOperations: [],
      removedOperations: [],
      changedOperations: [],
      schemaFieldAddedCount: 0,
      schemaFieldRemovedCount: 0,
      schemaFieldChangedCount: 0,
      schemaFieldChanges: [],
      migrationHint: "缺少基线时，请在工作区重新生成 OpenAPI 客户端并手动检查受影响路由。",
    };
  }

  const previousDocument = parseJson<Record<string, unknown>>(previousSource);
  if (!previousDocument) {
    return {
      status: "unavailable",
      summary: `OpenAPI baseline ${compareBaseCommit} could not be parsed.`,
      compareBaseCommit,
      currentVersion,
      previousVersion: null,
      addedCount: 0,
      removedCount: 0,
      changedCount: 0,
      addedOperations: [],
      removedOperations: [],
      changedOperations: [],
      schemaFieldAddedCount: 0,
      schemaFieldRemovedCount: 0,
      schemaFieldChangedCount: 0,
      schemaFieldChanges: [],
      migrationHint: "基线 OpenAPI 无法解析，请重新导出基线产物后再检查差异。",
    };
  }

  const previousVersion = readOpenApiVersion(previousDocument);
  const comparison = compareOpenApiOperations(previousDocument, currentDocument);
  const schemaFieldComparison = compareOpenApiSchemaFields(previousDocument, currentDocument);
  const status: SurfaceStatus =
    comparison.added.length === 0 &&
    comparison.removed.length === 0 &&
    comparison.changed.length === 0 &&
    schemaFieldComparison.addedCount === 0 &&
    schemaFieldComparison.removedCount === 0 &&
    schemaFieldComparison.changedCount === 0
      ? "unchanged"
      : "changed";

  return {
    status,
    summary: buildOpenApiSummaryText(
      status,
      comparison.added.length,
      comparison.removed.length,
      comparison.changed.length,
      schemaFieldComparison.addedCount,
      schemaFieldComparison.removedCount,
      schemaFieldComparison.changedCount,
    ),
    compareBaseCommit,
    currentVersion,
    previousVersion,
    addedCount: comparison.added.length,
    removedCount: comparison.removed.length,
    changedCount: comparison.changed.length,
    addedOperations: comparison.added.slice(0, MAX_SURFACE_ITEMS),
    removedOperations: comparison.removed.slice(0, MAX_SURFACE_ITEMS),
    changedOperations: comparison.changed.slice(0, MAX_SURFACE_ITEMS),
    schemaFieldAddedCount: schemaFieldComparison.addedCount,
    schemaFieldRemovedCount: schemaFieldComparison.removedCount,
    schemaFieldChangedCount: schemaFieldComparison.changedCount,
    schemaFieldChanges: schemaFieldComparison.changes.slice(0, MAX_FIELD_CHANGE_ITEMS),
    migrationHint: buildOpenApiMigrationHint(
      status,
      comparison.added.length,
      comparison.removed.length,
      comparison.changed.length,
      schemaFieldComparison.addedCount,
      schemaFieldComparison.removedCount,
      schemaFieldComparison.changedCount,
    ),
  };
}

async function buildPackageSurfaceSummary(
  options: PackageSurfaceOptions,
): Promise<PackageSurfaceSummary | null> {
  const currentSource = await readLocalFileMaybe(options.entryFile);
  if (!currentSource) {
    return null;
  }

  const changedFiles = options.changedFiles
    .filter((filePath) => filePath.startsWith(options.packageRoot))
    .map((filePath) => trimPrefix(filePath, options.packageRoot));
  const affectedModules = collectAffectedModules(changedFiles);
  const currentGraph = await buildPackageExportGraph({
    entryFile: options.entryFile,
    packageRoot: options.packageRoot,
    readSource: (filePath) => readLocalFileMaybe(filePath),
  });
  const currentExports = Array.from(currentGraph.keys()).sort((left, right) => left.localeCompare(right));

  if (!options.compareBaseCommit) {
    return {
      packageName: options.packageName,
      status: "unavailable",
      summary: `${options.packageName} baseline is unavailable, so export diff was skipped.`,
      entryFile: options.entryFile,
      compareBaseCommit: null,
      changedFileCount: changedFiles.length,
      changedFiles: changedFiles.slice(0, MAX_SURFACE_ITEMS),
      affectedModules,
      currentExportCount: currentExports.length,
      previousExportCount: 0,
      addedExportCount: 0,
      removedExportCount: 0,
      addedExports: [],
      removedExports: [],
      publicExportsChanged: false,
      impactedExportCount: 0,
      impactedExports: [],
      impactedModuleCount: 0,
      impactedModules: [],
      consumerFileCount: 0,
      impactedConsumerCount: 0,
      impactedConsumers: [],
      migrationHint: `缺少 ${options.packageName} 的基线时，请手动检查入口导出和受影响模块。`,
    };
  }

  const previousSource = await readGitFile(options.compareBaseCommit, options.entryFile);
  if (!previousSource) {
    return {
      packageName: options.packageName,
      status: "unavailable",
      summary: `${options.packageName} baseline ${options.compareBaseCommit} is unavailable, so export diff was skipped.`,
      entryFile: options.entryFile,
      compareBaseCommit: options.compareBaseCommit,
      changedFileCount: changedFiles.length,
      changedFiles: changedFiles.slice(0, MAX_SURFACE_ITEMS),
      affectedModules,
      currentExportCount: currentExports.length,
      previousExportCount: 0,
      addedExportCount: 0,
      removedExportCount: 0,
      addedExports: [],
      removedExports: [],
      publicExportsChanged: false,
      impactedExportCount: 0,
      impactedExports: [],
      impactedModuleCount: 0,
      impactedModules: [],
      consumerFileCount: 0,
      impactedConsumerCount: 0,
      impactedConsumers: [],
      migrationHint: `缺少 ${options.packageName} 的基线时，请手动检查入口导出和受影响模块。`,
    };
  }

  const previousGraph = await buildPackageExportGraph({
    entryFile: options.entryFile,
    packageRoot: options.packageRoot,
    readSource: (filePath) => readGitFile(options.compareBaseCommit as string, filePath),
  });
  const previousExports = Array.from(previousGraph.keys()).sort((left, right) => left.localeCompare(right));
  const addedExports = difference(currentExports, previousExports);
  const removedExports = difference(previousExports, currentExports);
  const publicExportsChanged = addedExports.length > 0 || removedExports.length > 0;
  const impactGraph = buildPackageImpactGraph({
    packageRoot: options.packageRoot,
    changedFiles,
    currentGraph,
    previousGraph,
  });
  const consumerImpact = await buildPackageConsumerImpactSummary({
    packageName: options.packageName,
    packageRoot: options.packageRoot,
    impactedExports: impactGraph.impactedExports,
    packageChanged: publicExportsChanged || impactGraph.impactedExportCount > 0 || changedFiles.length > 0,
  });
  const status: SurfaceStatus = publicExportsChanged || changedFiles.length > 0 ? "changed" : "unchanged";

  return {
    packageName: options.packageName,
    status,
    summary: buildPackageSummaryText(
      options.packageName,
      status,
      publicExportsChanged,
      changedFiles.length,
      addedExports.length,
      removedExports.length,
      impactGraph.impactedExportCount,
      consumerImpact.impactedConsumerCount,
    ),
    entryFile: options.entryFile,
    compareBaseCommit: options.compareBaseCommit,
    changedFileCount: changedFiles.length,
    changedFiles: changedFiles.slice(0, MAX_SURFACE_ITEMS),
    affectedModules,
    currentExportCount: currentExports.length,
    previousExportCount: previousExports.length,
    addedExportCount: addedExports.length,
    removedExportCount: removedExports.length,
    addedExports: addedExports.slice(0, MAX_EXPORT_ITEMS),
    removedExports: removedExports.slice(0, MAX_EXPORT_ITEMS),
    publicExportsChanged,
    impactedExportCount: impactGraph.impactedExportCount,
    impactedExports: impactGraph.impactedExports.slice(0, MAX_EXPORT_ITEMS),
    impactedModuleCount: impactGraph.impactedModuleCount,
    impactedModules: impactGraph.impactedModules.slice(0, MAX_SURFACE_ITEMS),
    consumerFileCount: consumerImpact.consumerFileCount,
    impactedConsumerCount: consumerImpact.impactedConsumerCount,
    impactedConsumers: consumerImpact.impactedConsumers.slice(0, MAX_SURFACE_ITEMS),
    migrationHint: buildPackageMigrationHint(
      options.packageName,
      status,
      publicExportsChanged,
      addedExports.length,
      removedExports.length,
      changedFiles.length,
      impactGraph.impactedExportCount,
      consumerImpact.impactedConsumerCount,
    ),
  };
}

function summarizeChanges(input: {
  changedFiles: string[];
  breaking: boolean;
  openapiSummary: OpenApiSurfaceSummary | null;
  sdkSummary: PackageSurfaceSummary | null;
  clientHelpersSummary: PackageSurfaceSummary | null;
}): { domains: DomainName[]; changes: ManifestChange[] } {
  const groups = new Map<DomainName, { target: string; count: number; migrationHint?: string }>();

  for (const filePath of input.changedFiles) {
    const rule = matchDomainRule(filePath);
    const current = groups.get(rule.domain);
    if (current) {
      current.count += 1;
      continue;
    }

    groups.set(rule.domain, {
      target: rule.target,
      count: 1,
      migrationHint: rule.migrationHint,
    });
  }

  if (groups.size === 0) {
    groups.set("other", {
      target: "repository",
      count: 0,
      migrationHint: "按需检查这次提交的影响范围。",
    });
  }

  const domains = Array.from(groups.keys());
  const changes = domains.map((domain) => {
    if (domain === "openapi") {
      return buildOpenApiChange(input.openapiSummary, groups.get(domain), input.breaking);
    }

    if (domain === "sdk") {
      return buildPackageChange(domain, input.sdkSummary, groups.get(domain), input.breaking);
    }

    if (domain === "client-helpers") {
      return buildPackageChange(domain, input.clientHelpersSummary, groups.get(domain), input.breaking);
    }

    return buildGenericChange(domain, groups.get(domain), input.breaking);
  });

  return { domains, changes };
}

function buildOpenApiChange(
  summary: OpenApiSurfaceSummary | null,
  group: { target: string; count: number; migrationHint?: string } | undefined,
  fallbackBreaking: boolean,
): ManifestChange {
  if (!summary) {
    return buildGenericChange("openapi", group, fallbackBreaking);
  }

  return {
    domain: "openapi",
    kind:
      fallbackBreaking ||
      summary.removedCount > 0 ||
      summary.schemaFieldRemovedCount > 0 ||
      summary.schemaFieldChangedCount > 0
        ? "breaking"
        : "non_breaking",
    target: group?.target ?? "openapi",
    changeType:
      summary.status === "unavailable"
        ? "openapi_diff_unavailable"
        : summary.schemaFieldAddedCount > 0 || summary.schemaFieldRemovedCount > 0 || summary.schemaFieldChangedCount > 0
          ? "openapi_schema_fields_changed"
          : summary.status === "changed"
            ? "openapi_operations_changed"
          : "openapi_unchanged",
    description: summary.summary,
    migrationHint: summary.migrationHint,
  };
}

function buildPackageChange(
  domain: "sdk" | "client-helpers",
  summary: PackageSurfaceSummary | null,
  group: { target: string; count: number; migrationHint?: string } | undefined,
  fallbackBreaking: boolean,
): ManifestChange {
  if (!summary) {
    return buildGenericChange(domain, group, fallbackBreaking);
  }

  return {
    domain,
    kind: fallbackBreaking || summary.removedExportCount > 0 ? "breaking" : "non_breaking",
    target: group?.target ?? summary.packageName,
    changeType:
      summary.status === "unavailable"
        ? "public_surface_unavailable"
        : summary.publicExportsChanged
          ? "public_exports_changed"
          : summary.changedFileCount > 0
            ? "implementation_changed"
            : "public_surface_unchanged",
    description: summary.summary,
    migrationHint: summary.migrationHint,
  };
}

function buildGenericChange(
  domain: DomainName,
  group: { target: string; count: number; migrationHint?: string } | undefined,
  fallbackBreaking: boolean,
): ManifestChange {
  const fileCount = group?.count ?? 0;

  return {
    domain,
    kind: fallbackBreaking ? "breaking" : "non_breaking",
    target: group?.target ?? "repository",
    changeType: fileCount > 0 ? "paths_changed" : "snapshot_generated",
    description:
      fileCount > 0
        ? `Detected ${fileCount} changed file(s) in the ${domain} domain.`
        : `Generated agent snapshot without a file-level diff baseline for the ${domain} domain.`,
    migrationHint: group?.migrationHint,
  };
}

function buildRecommendedActions(input: {
  domains: DomainName[];
  openapiSummary: OpenApiSurfaceSummary | null;
  sdkSummary: PackageSurfaceSummary | null;
  clientHelpersSummary: PackageSurfaceSummary | null;
}): string[] {
  const actions = new Set<string>([
    "pull latest manifest",
    "check affected surfaces before updating dependent workspaces",
    "run local typecheck and tests after applying required changes",
  ]);

  if (input.openapiSummary?.status === "changed") {
    actions.add("regenerate local OpenAPI consumers if your workspace keeps generated artifacts");

    if (
      input.openapiSummary.removedCount > 0 ||
      input.openapiSummary.changedCount > 0 ||
      input.openapiSummary.schemaFieldRemovedCount > 0 ||
      input.openapiSummary.schemaFieldChangedCount > 0
    ) {
      actions.add("review API request, response and error handling changes for affected routes");
      actions.add("review request and response schema field changes for affected operations");
    }
  }

  if (input.sdkSummary?.status === "changed") {
    actions.add("review @tavern/sdk changes and rerun typecheck in dependent workspaces");

    if (input.sdkSummary.publicExportsChanged) {
      actions.add("check added and removed @tavern/sdk exports before updating wrapper code");
    }
  }

  if (input.clientHelpersSummary?.status === "changed") {
    actions.add("review @tavern/client-helpers changes and rerun dependent helper-level tests");

    if (input.clientHelpersSummary.publicExportsChanged) {
      actions.add("check added and removed @tavern/client-helpers exports before updating helper bindings");
    }
  }

  if (input.domains.includes("api")) {
    actions.add("recheck API request, response and error handling compatibility for affected integrations");
  }

  if (input.domains.includes("docs")) {
    actions.add("refresh internal integration notes if your workspace mirrors project documentation");
  }

  return Array.from(actions);
}

async function resolveParentCommit(commit: string): Promise<string | null> {
  try {
    return await runGit(["rev-parse", `${commit}^`]);
  } catch {
    return null;
  }
}

async function resolveChangedFiles(compareBaseCommit: string | null, commit: string): Promise<string[]> {
  try {
    if (compareBaseCommit && compareBaseCommit !== commit) {
      const diff = await runGit(["diff", "--name-only", compareBaseCommit, commit]);
      return splitGitOutput(diff);
    }

    const show = await runGit(["show", "--pretty=", "--name-only", commit]);
    return splitGitOutput(show);
  } catch (error) {
    console.warn(`[agent-artifacts] failed to collect changed files: ${formatError(error)}`);
    return [];
  }
}

function matchDomainRule(filePath: string): DomainRule {
  for (const rule of DOMAIN_RULES) {
    if (rule.exact?.includes(filePath)) {
      return rule;
    }

    if (rule.prefixes.some((prefix) => filePath.startsWith(prefix))) {
      return rule;
    }
  }

  return {
    domain: "other",
    target: "repository",
    prefixes: [],
    migrationHint: "按需检查本次仓库更新的影响范围。",
  };
}

function compareOpenApiOperations(
  previousDocument: Record<string, unknown>,
  currentDocument: Record<string, unknown>,
): {
  added: OpenApiOperationPreview[];
  removed: OpenApiOperationPreview[];
  changed: OpenApiOperationPreview[];
} {
  const previousOperations = collectOpenApiOperations(previousDocument);
  const currentOperations = collectOpenApiOperations(currentDocument);
  const added: OpenApiOperationPreview[] = [];
  const removed: OpenApiOperationPreview[] = [];
  const changed: OpenApiOperationPreview[] = [];

  for (const [key, currentOperation] of currentOperations.entries()) {
    const previousOperation = previousOperations.get(key);
    if (!previousOperation) {
      added.push(currentOperation.preview);
      continue;
    }

    if (previousOperation.hash !== currentOperation.hash) {
      changed.push(currentOperation.preview);
    }
  }

  for (const [key, previousOperation] of previousOperations.entries()) {
    if (!currentOperations.has(key)) {
      removed.push(previousOperation.preview);
    }
  }

  const byMethodAndPath = (left: OpenApiOperationPreview, right: OpenApiOperationPreview): number => {
    const leftKey = `${left.method} ${left.path}`;
    const rightKey = `${right.method} ${right.path}`;
    return leftKey.localeCompare(rightKey);
  };

  added.sort(byMethodAndPath);
  removed.sort(byMethodAndPath);
  changed.sort(byMethodAndPath);

  return { added, removed, changed };
}

function collectOpenApiOperations(document: Record<string, unknown>): Map<string, OpenApiOperationRecord> {
  const operations = new Map<string, OpenApiOperationRecord>();
  const paths = document.paths;
  if (!isRecord(paths)) {
    return operations;
  }

  for (const [pathName, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }

    for (const method of OPENAPI_METHODS) {
      const operation = pathItem[method];
      if (!isRecord(operation)) {
        continue;
      }

      const preview: OpenApiOperationPreview = {
        method: method.toUpperCase(),
        path: pathName,
      };
      const operationId = asString(operation.operationId);
      const summary = asString(operation.summary);

      if (operationId) {
        preview.operationId = operationId;
      }

      if (summary) {
        preview.summary = summary;
      }

      operations.set(`${preview.method} ${preview.path}`, {
        preview,
        hash: stableStringify(operation),
        operation,
      });
    }
  }

  return operations;
}

function compareOpenApiSchemaFields(
  previousDocument: Record<string, unknown>,
  currentDocument: Record<string, unknown>,
): OpenApiSchemaFieldComparison {
  const previousOperations = collectOpenApiOperations(previousDocument);
  const currentOperations = collectOpenApiOperations(currentDocument);
  const changes: OpenApiSchemaFieldChangePreview[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let changedCount = 0;

  for (const [key, currentOperation] of currentOperations.entries()) {
    const previousOperation = previousOperations.get(key);
    if (!previousOperation || previousOperation.hash === currentOperation.hash) {
      continue;
    }

    const operationChanges = compareOperationSchemaFields({
      preview: currentOperation.preview,
      previousOperation: previousOperation.operation,
      currentOperation: currentOperation.operation,
      previousDocument,
      currentDocument,
    });

    for (const change of operationChanges) {
      changes.push(change);
      if (change.changeType === "field_added") {
        addedCount += 1;
      } else if (change.changeType === "field_removed") {
        removedCount += 1;
      } else {
        changedCount += 1;
      }
    }
  }

  changes.sort((left, right) => {
    const leftKey = `${left.operation.method} ${left.operation.path} ${left.location} ${left.fieldPath}`;
    const rightKey = `${right.operation.method} ${right.operation.path} ${right.location} ${right.fieldPath}`;
    return leftKey.localeCompare(rightKey);
  });

  return {
    addedCount,
    removedCount,
    changedCount,
    changes,
  };
}

function compareOperationSchemaFields(input: {
  preview: OpenApiOperationPreview;
  previousOperation: Record<string, unknown>;
  currentOperation: Record<string, unknown>;
  previousDocument: Record<string, unknown>;
  currentDocument: Record<string, unknown>;
}): OpenApiSchemaFieldChangePreview[] {
  const previousFields = collectOperationSchemaFieldMaps(input.previousOperation, input.previousDocument);
  const currentFields = collectOperationSchemaFieldMaps(input.currentOperation, input.currentDocument);
  const locations = new Set<string>([...previousFields.keys(), ...currentFields.keys()]);
  const changes: OpenApiSchemaFieldChangePreview[] = [];

  for (const location of Array.from(locations).sort((left, right) => left.localeCompare(right))) {
    const previousMap = previousFields.get(location) ?? new Map<string, OpenApiSchemaFieldDescriptor>();
    const currentMap = currentFields.get(location) ?? new Map<string, OpenApiSchemaFieldDescriptor>();

    changes.push(...compareSchemaFieldMaps(input.preview, location, previousMap, currentMap));
  }

  return changes;
}

function collectOperationSchemaFieldMaps(
  operation: Record<string, unknown>,
  document: Record<string, unknown>,
): Map<string, Map<string, OpenApiSchemaFieldDescriptor>> {
  const result = new Map<string, Map<string, OpenApiSchemaFieldDescriptor>>();

  const requestSchema = extractRequestBodyJsonSchema(operation.requestBody);
  if (requestSchema) {
    result.set("requestBody", extractSchemaFieldDescriptors(requestSchema, document));
  }

  const responses = isRecord(operation.responses) ? operation.responses : null;
  if (!responses) {
    return result;
  }

  const responseStatuses = Object.keys(responses)
    .filter((status) => /^2\d\d$/u.test(status))
    .sort((left, right) => left.localeCompare(right));

  for (const status of responseStatuses) {
    const responseSchema = extractResponseJsonSchema(responses[status]);
    if (!responseSchema) {
      continue;
    }

    result.set(`response:${status}`, extractSchemaFieldDescriptors(responseSchema, document));
  }

  return result;
}

function compareSchemaFieldMaps(
  operation: OpenApiOperationPreview,
  location: string,
  previousFields: Map<string, OpenApiSchemaFieldDescriptor>,
  currentFields: Map<string, OpenApiSchemaFieldDescriptor>,
): OpenApiSchemaFieldChangePreview[] {
  const changes: OpenApiSchemaFieldChangePreview[] = [];
  const allPaths = new Set<string>([...previousFields.keys(), ...currentFields.keys()]);

  for (const fieldPath of Array.from(allPaths).sort((left, right) => left.localeCompare(right))) {
    const previousField = previousFields.get(fieldPath);
    const currentField = currentFields.get(fieldPath);

    if (!previousField && currentField) {
      changes.push({
        operation,
        location,
        changeType: "field_added",
        fieldPath,
        detail: `Added field ${fieldPath} in ${location}.`,
        currentType: currentField.typeLabel,
        currentRequired: currentField.required,
      });
      continue;
    }

    if (previousField && !currentField) {
      changes.push({
        operation,
        location,
        changeType: "field_removed",
        fieldPath,
        detail: `Removed field ${fieldPath} from ${location}.`,
        previousType: previousField.typeLabel,
        previousRequired: previousField.required,
      });
      continue;
    }

    if (!previousField || !currentField) {
      continue;
    }

    if (
      previousField.required !== currentField.required ||
      previousField.typeLabel !== currentField.typeLabel ||
      previousField.signature !== currentField.signature
    ) {
      changes.push({
        operation,
        location,
        changeType: "field_changed",
        fieldPath,
        detail: buildFieldChangeDetail(fieldPath, location, previousField, currentField),
        previousType: previousField.typeLabel,
        currentType: currentField.typeLabel,
        previousRequired: previousField.required,
        currentRequired: currentField.required,
      });
    }
  }

  return changes;
}

function extractSchemaFieldDescriptors(
  schemaNode: unknown,
  document: Record<string, unknown>,
): Map<string, OpenApiSchemaFieldDescriptor> {
  const fields = new Map<string, OpenApiSchemaFieldDescriptor>();
  walkSchemaFields({
    schemaNode,
    document,
    currentPath: "",
    required: false,
    fields,
    seenRefs: new Set<string>(),
  });

  if (fields.size === 0) {
    const resolved = resolveSchemaNode(schemaNode, document, new Set<string>());
    if (resolved) {
      fields.set("<root>", {
        path: "<root>",
        typeLabel: buildSchemaTypeLabel(resolved),
        required: true,
        signature: buildSchemaSignature(resolved),
      });
    }
  }

  return fields;
}

function walkSchemaFields(input: {
  schemaNode: unknown;
  document: Record<string, unknown>;
  currentPath: string;
  required: boolean;
  fields: Map<string, OpenApiSchemaFieldDescriptor>;
  seenRefs: Set<string>;
}): void {
  const schema = resolveSchemaNode(input.schemaNode, input.document, input.seenRefs);
  if (!schema) {
    return;
  }

  if (input.currentPath) {
    input.fields.set(input.currentPath, {
      path: input.currentPath,
      typeLabel: buildSchemaTypeLabel(schema),
      required: input.required,
      signature: buildSchemaSignature(schema),
    });
  }

  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    return;
  }

  const properties = isRecord(schema.properties) ? schema.properties : null;
  if (properties) {
    const requiredSet = new Set(toStringArray(schema.required));

    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      walkSchemaFields({
        schemaNode: propertySchema,
        document: input.document,
        currentPath: input.currentPath ? `${input.currentPath}.${propertyName}` : propertyName,
        required: requiredSet.has(propertyName),
        fields: input.fields,
        seenRefs: new Set(input.seenRefs),
      });
    }
  }

  if (schema.items !== undefined) {
    walkSchemaFields({
      schemaNode: schema.items,
      document: input.document,
      currentPath: input.currentPath ? `${input.currentPath}[]` : "[]",
      required: true,
      fields: input.fields,
      seenRefs: new Set(input.seenRefs),
    });
  }
}

function resolveSchemaNode(
  schemaNode: unknown,
  document: Record<string, unknown>,
  seenRefs: Set<string>,
): Record<string, unknown> | null {
  if (!isRecord(schemaNode)) {
    return null;
  }

  let schema = { ...schemaNode };

  if (Array.isArray(schema.allOf)) {
    let merged: Record<string, unknown> = {};
    for (const part of schema.allOf) {
      const resolvedPart = resolveSchemaNode(part, document, new Set(seenRefs));
      if (resolvedPart) {
        merged = mergeSchemaRecords(merged, resolvedPart);
      }
    }

    const local = { ...schema };
    delete local.allOf;
    schema = mergeSchemaRecords(merged, local);
  }

  const ref = asString(schema.$ref);
  if (ref) {
    if (seenRefs.has(ref)) {
      const local = { ...schema };
      delete local.$ref;
      return local;
    }

    const target = resolveLocalJsonPointer(document, ref);
    if (isRecord(target)) {
      const local = { ...schema };
      delete local.$ref;
      const resolvedTarget = resolveSchemaNode(target, document, new Set([...seenRefs, ref]));
      return mergeSchemaRecords(resolvedTarget ?? {}, local);
    }
  }

  return schema;
}

function mergeSchemaRecords(
  base: Record<string, unknown>,
  extension: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base, ...extension };

  if (isRecord(base.properties) || isRecord(extension.properties)) {
    merged.properties = {
      ...(isRecord(base.properties) ? base.properties : {}),
      ...(isRecord(extension.properties) ? extension.properties : {}),
    };
  }

  const requiredValues = [...toStringArray(base.required), ...toStringArray(extension.required)];
  if (requiredValues.length > 0) {
    merged.required = Array.from(new Set(requiredValues));
  }

  if (base.items !== undefined && extension.items === undefined) {
    merged.items = base.items;
  }

  return merged;
}

function resolveLocalJsonPointer(document: Record<string, unknown>, pointer: string): unknown {
  if (!pointer.startsWith("#/")) {
    return null;
  }

  const segments = pointer
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/gu, "/").replace(/~0/gu, "~"));

  let current: unknown = document;
  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) {
      return null;
    }

    current = current[segment];
  }

  return current;
}

function extractRequestBodyJsonSchema(requestBody: unknown): unknown | null {
  if (!isRecord(requestBody)) {
    return null;
  }

  return extractJsonSchemaFromContent(requestBody.content);
}

function extractResponseJsonSchema(response: unknown): unknown | null {
  if (!isRecord(response)) {
    return null;
  }

  return extractJsonSchemaFromContent(response.content);
}

function extractJsonSchemaFromContent(content: unknown): unknown | null {
  if (!isRecord(content)) {
    return null;
  }

  const contentEntries = Object.entries(content);
  const exactMatch = contentEntries.find(([mediaType]) => mediaType === "application/json");
  const fallbackMatch = contentEntries.find(([mediaType]) => mediaType.toLowerCase().includes("json"));
  const selected = exactMatch ?? fallbackMatch;
  if (!selected || !isRecord(selected[1])) {
    return null;
  }

  return selected[1].schema ?? null;
}

function buildFieldChangeDetail(
  fieldPath: string,
  location: string,
  previousField: OpenApiSchemaFieldDescriptor,
  currentField: OpenApiSchemaFieldDescriptor,
): string {
  const fragments: string[] = [];

  if (previousField.typeLabel !== currentField.typeLabel) {
    fragments.push(`type ${previousField.typeLabel} -> ${currentField.typeLabel}`);
  }

  if (previousField.required !== currentField.required) {
    fragments.push(`required ${previousField.required} -> ${currentField.required}`);
  }

  if (fragments.length === 0 && previousField.signature !== currentField.signature) {
    fragments.push("schema constraints updated");
  }

  return `Changed field ${fieldPath} in ${location}: ${fragments.join(", ")}.`;
}

function buildSchemaTypeLabel(schema: Record<string, unknown>): string {
  const explicitType = asString(schema.type);
  const format = asString(schema.format);
  const nullable = schema.nullable === true;
  let baseType = explicitType;

  if (!baseType) {
    if (Array.isArray(schema.oneOf)) {
      baseType = `oneOf(${schema.oneOf.length})`;
    } else if (Array.isArray(schema.anyOf)) {
      baseType = `anyOf(${schema.anyOf.length})`;
    } else if (Array.isArray(schema.enum)) {
      baseType = "enum";
    } else if (schema.items !== undefined) {
      baseType = "array";
    } else if (isRecord(schema.properties)) {
      baseType = "object";
    } else {
      baseType = "unknown";
    }
  }

  let typeLabel = baseType;
  if (format) {
    typeLabel = `${typeLabel}:${format}`;
  }

  if (nullable) {
    typeLabel = `${typeLabel}|null`;
  }

  return typeLabel;
}

function buildSchemaSignature(schema: Record<string, unknown>): string {
  const signature = {
    type: buildSchemaTypeLabel(schema),
    enum: Array.isArray(schema.enum) ? schema.enum : undefined,
    pattern: asString(schema.pattern) ?? undefined,
    format: asString(schema.format) ?? undefined,
    nullable: schema.nullable === true ? true : undefined,
    minimum: typeof schema.minimum === "number" ? schema.minimum : undefined,
    maximum: typeof schema.maximum === "number" ? schema.maximum : undefined,
    minLength: typeof schema.minLength === "number" ? schema.minLength : undefined,
    maxLength: typeof schema.maxLength === "number" ? schema.maxLength : undefined,
    minItems: typeof schema.minItems === "number" ? schema.minItems : undefined,
    maxItems: typeof schema.maxItems === "number" ? schema.maxItems : undefined,
    additionalProperties:
      typeof schema.additionalProperties === "boolean"
        ? schema.additionalProperties
        : isRecord(schema.additionalProperties)
          ? buildSchemaTypeLabel(schema.additionalProperties)
          : undefined,
  };

  return stableStringify(signature);
}

function readOpenApiVersion(document: Record<string, unknown>): string | null {
  const info = document.info;
  if (!isRecord(info)) {
    return null;
  }

  return asString(info.version);
}

function buildOpenApiSummaryText(
  status: SurfaceStatus,
  addedCount: number,
  removedCount: number,
  changedCount: number,
  schemaFieldAddedCount: number,
  schemaFieldRemovedCount: number,
  schemaFieldChangedCount: number,
): string {
  if (status === "unavailable") {
    return "OpenAPI baseline is unavailable, so operation and schema diff were skipped.";
  }

  if (status === "unchanged") {
    return "OpenAPI diff detected no route or schema field changes.";
  }

  return `OpenAPI diff detected ${addedCount} added, ${removedCount} removed and ${changedCount} changed operation(s); schema diff found ${schemaFieldAddedCount} added, ${schemaFieldRemovedCount} removed and ${schemaFieldChangedCount} changed field(s).`;
}

function buildOpenApiMigrationHint(
  status: SurfaceStatus,
  addedCount: number,
  removedCount: number,
  changedCount: number,
  schemaFieldAddedCount: number,
  schemaFieldRemovedCount: number,
  schemaFieldChangedCount: number,
): string {
  if (status === "unavailable") {
    return "缺少可比较基线时，请重新生成 OpenAPI 客户端并手动检查受影响路由。";
  }

  if (removedCount > 0) {
    return "存在移除的 OpenAPI 操作，请优先检查依赖这些接口的调用方，并重新生成客户端。";
  }

  if (schemaFieldRemovedCount > 0) {
    return "存在被移除的请求或响应字段，请重新生成客户端，并优先检查调用方字段映射。";
  }

  if (schemaFieldChangedCount > 0) {
    return "存在变更的请求或响应字段，请重新生成客户端，并回归字段映射、校验和错误处理逻辑。";
  }

  if (schemaFieldAddedCount > 0) {
    return "存在新增的请求或响应字段，如需使用新增能力，请同步升级本地接口封装和类型定义。";
  }

  if (changedCount > 0) {
    return "存在变更的 OpenAPI 操作，请重新生成客户端，并回归请求体、响应体和错误处理逻辑。";
  }

  if (addedCount > 0) {
    return "存在新增的 OpenAPI 操作，如需使用新增能力，请同步升级本地接口封装。";
  }

  return "本次未检测到 OpenAPI 路由级变化。";
}

function buildPackageSummaryText(
  packageName: string,
  status: SurfaceStatus,
  publicExportsChanged: boolean,
  changedFileCount: number,
  addedExportCount: number,
  removedExportCount: number,
  impactedExportCount: number,
): string {
  if (status === "unavailable") {
    return `${packageName} baseline is unavailable, so export diff was skipped.`;
  }

  if (status === "unchanged") {
    return `No changed files were detected under ${packageName}.`;
  }

  if (publicExportsChanged) {
    return `${packageName} export diff detected ${addedExportCount} added and ${removedExportCount} removed public export(s); ${impactedExportCount} exported symbol(s) are in the current impact set.`;
  }

  return `${packageName} changed ${changedFileCount} file(s); entry exports remained unchanged, but ${impactedExportCount} exported symbol(s) are attached to changed modules.`;
}

function buildPackageMigrationHint(
  packageName: string,
  status: SurfaceStatus,
  publicExportsChanged: boolean,
  addedExportCount: number,
  removedExportCount: number,
  changedFileCount: number,
  impactedExportCount: number,
): string {
  if (status === "unavailable") {
    return `缺少 ${packageName} 的可比较基线时，请手动检查入口导出和受影响模块。`;
  }

  if (removedExportCount > 0) {
    return `检测到 ${packageName} 入口导出被移除，请优先更新调用方导入与封装。`;
  }

  if (addedExportCount > 0) {
    return `检测到 ${packageName} 新增入口导出，如需使用新增能力，请同步升级类型与调用封装。`;
  }

  if (publicExportsChanged) {
    return `检测到 ${packageName} 入口导出变化，请检查工作区中的导入路径和类型引用。`;
  }

  if (impactedExportCount > 0) {
    return `${packageName} 入口导出未变化，但已有导出符号关联的模块发生改动，请回归受影响 symbol 的调用方。`;
  }

  if (changedFileCount > 0) {
    return `${packageName} 入口导出未变化，但内部实现已更新，请回归相关能力。`;
  }

  return `本次未检测到 ${packageName} 的公开导出变化。`;
}

async function buildPackageExportGraph(input: {
  entryFile: string;
  packageRoot: string;
  readSource: (filePath: string) => Promise<string | null>;
}): Promise<Map<string, PackageExportSymbolDescriptor>> {
  const cache = new Map<string, Promise<Map<string, PackageExportSymbolDescriptor>>>();

  const resolveModuleExports = async (
    moduleFile: string,
  ): Promise<Map<string, PackageExportSymbolDescriptor>> => {
    const normalizedModuleFile = normalizeWorkspaceFilePath(moduleFile);
    const cached = cache.get(normalizedModuleFile);
    if (cached) {
      return cached;
    }

    const pending = (async () => {
      const source = await input.readSource(normalizedModuleFile);
      if (!source) {
        return new Map<string, PackageExportSymbolDescriptor>();
      }

      const modulePath = normalizePackageModulePath(normalizedModuleFile, input.packageRoot);
      const graph = new Map<string, PackageExportSymbolDescriptor>();

      for (const directExport of extractDirectExportSymbols(source)) {
        graph.set(directExport.exportName, {
          exportName: directExport.exportName,
          sourceModule: modulePath,
          viaModules: [],
          isTypeOnly: directExport.isTypeOnly,
        });
      }

      for (const statement of parseNamedReExportStatements(source)) {
        const childFile = resolveLocalSourceModulePath(normalizedModuleFile, statement.sourceSpecifier);
        if (!childFile) {
          continue;
        }

        const childGraph = await resolveModuleExports(childFile);
        const childModulePath = normalizePackageModulePath(childFile, input.packageRoot);

        for (const specifier of statement.specifiers) {
          const childSymbol = childGraph.get(specifier.importedName);
          if (childSymbol) {
            graph.set(specifier.exportedName, {
              exportName: specifier.exportedName,
              sourceModule: childSymbol.sourceModule,
              viaModules: uniqueStrings(
                [childModulePath, ...childSymbol.viaModules].filter(
                  (item) => item !== childSymbol.sourceModule,
                ),
              ),
              isTypeOnly: specifier.isTypeOnly || childSymbol.isTypeOnly,
            });
            continue;
          }

          graph.set(specifier.exportedName, {
            exportName: specifier.exportedName,
            sourceModule: childModulePath,
            viaModules: [],
            isTypeOnly: specifier.isTypeOnly,
          });
        }
      }

      return graph;
    })();

    cache.set(normalizedModuleFile, pending);
    return pending;
  };

  return resolveModuleExports(input.entryFile);
}

function buildPackageImpactGraph(input: {
  packageRoot: string;
  changedFiles: string[];
  currentGraph: Map<string, PackageExportSymbolDescriptor>;
  previousGraph: Map<string, PackageExportSymbolDescriptor>;
}): {
  impactedExportCount: number;
  impactedExports: PackageExportImpactPreview[];
  impactedModuleCount: number;
  impactedModules: PackageModuleImpactPreview[];
} {
  const changedModules = collectChangedSourceModules(input.changedFiles);
  const impactedExportsMap = new Map<string, PackageExportImpactPreview>();
  const impactedModules: PackageModuleImpactPreview[] = [];

  for (const modulePath of changedModules) {
    const currentSymbols = collectSymbolsForModule(input.currentGraph, modulePath);
    const previousSymbols = collectSymbolsForModule(input.previousGraph, modulePath);
    const exportNames = uniqueStrings([
      ...Array.from(currentSymbols.keys()),
      ...Array.from(previousSymbols.keys()),
    ]).sort((left, right) => left.localeCompare(right));

    if (exportNames.length === 0) {
      continue;
    }

    impactedModules.push({
      module: modulePath,
      changeType:
        currentSymbols.size === 0 ? "removed" : previousSymbols.size === 0 ? "added" : "changed",
      exportCount: exportNames.length,
      exports: exportNames.slice(0, MAX_EXPORT_ITEMS),
    });

    for (const exportName of exportNames) {
      if (!impactedExportsMap.has(exportName)) {
        impactedExportsMap.set(
          exportName,
          buildPackageExportImpactPreview(exportName, input.currentGraph, input.previousGraph),
        );
      }
    }
  }

  const impactedExports = Array.from(impactedExportsMap.values()).sort((left, right) =>
    left.exportName.localeCompare(right.exportName),
  );

  return {
    impactedExportCount: impactedExports.length,
    impactedExports,
    impactedModuleCount: impactedModules.length,
    impactedModules: impactedModules.sort((left, right) => left.module.localeCompare(right.module)),
  };
}

let trackedWorkspaceSourceFilesCache: string[] | null = null;

async function buildPackageConsumerImpactSummary(input: {
  packageName: string;
  packageRoot: string;
  impactedExports: PackageExportImpactPreview[];
  packageChanged: boolean;
}): Promise<{
  consumerFileCount: number;
  impactedConsumerCount: number;
  impactedConsumers: PackageConsumerImpactPreview[];
}> {
  const impactedExportNames = new Set(input.impactedExports.map((item) => item.exportName));
  const files = await listTrackedWorkspaceSourceFiles();
  const impactedConsumers: PackageConsumerImpactPreview[] = [];
  let consumerFileCount = 0;

  for (const filePath of files) {
    if (filePath.startsWith(input.packageRoot)) {
      continue;
    }

    const source = await readLocalFileMaybe(filePath);
    if (!source) {
      continue;
    }

    const imports = parsePackageImportStatements(source, input.packageName);
    if (imports.length === 0) {
      continue;
    }

    consumerFileCount += 1;
    const importMode = mergeImportModes(imports.map((item) => item.importMode));
    const importedSymbols = uniqueStrings(imports.flatMap((item) => item.importedSymbols)).sort((left, right) =>
      left.localeCompare(right),
    );
    const matchedExports = importedSymbols.filter((symbol) => impactedExportNames.has(symbol));
    const broadImport = imports.some(
      (item) => item.importMode === "namespace" || item.importMode === "default" || item.importMode === "mixed",
    );

    if (matchedExports.length === 0 && !(broadImport && input.packageChanged)) {
      continue;
    }

    impactedConsumers.push({
      file: filePath,
      line: Math.min(...imports.map((item) => item.line)),
      importMode,
      importedSymbols,
      matchedExports,
      note:
        matchedExports.length > 0
          ? `Directly imports ${matchedExports.length} impacted export(s).`
          : "Uses broad package import mode; manual review is required when package internals changed.",
    });
  }

  impactedConsumers.sort((left, right) => {
    const leftKey = `${left.file}:${left.line}`;
    const rightKey = `${right.file}:${right.line}`;
    return leftKey.localeCompare(rightKey);
  });

  return {
    consumerFileCount,
    impactedConsumerCount: impactedConsumers.length,
    impactedConsumers,
  };
}

async function listTrackedWorkspaceSourceFiles(): Promise<string[]> {
  if (trackedWorkspaceSourceFilesCache) {
    return trackedWorkspaceSourceFilesCache;
  }

  const trackedFiles = splitGitOutput(await runGit(["ls-files"]));
  trackedWorkspaceSourceFilesCache = trackedFiles.filter((filePath) => isWorkspaceSourceFile(filePath));
  return trackedWorkspaceSourceFilesCache;
}

function isWorkspaceSourceFile(filePath: string): boolean {
  const normalized = normalizeWorkspaceFilePath(filePath);
  if (
    normalized.startsWith(".limcode/") ||
    normalized.startsWith("vitepress/public/") ||
    normalized.startsWith("vitepress/.vitepress/")
  ) {
    return false;
  }

  return /\.(?:[cm]?[jt]sx?|vue)$/u.test(normalized);
}

function parsePackageImportStatements(
  source: string,
  packageName: string,
): Array<{
  line: number;
  importMode: "named" | "namespace" | "default" | "mixed";
  importedSymbols: string[];
}> {
  const statements: Array<{
    line: number;
    importMode: "named" | "namespace" | "default" | "mixed";
    importedSymbols: string[];
  }> = [];
  const pattern = new RegExp(
    String.raw`(^|\n)\s*import\s+([\s\S]*?)\s+from\s+["']${escapeRegExp(packageName)}["'];?`,
    "gmu",
  );

  for (const match of source.matchAll(pattern)) {
    const clause = (match[2] ?? "").trim();
    if (!clause) {
      continue;
    }

    const parsed = parseImportClause(clause);
    statements.push({
      line: countSourceLines(source, (match.index ?? 0) + ((match[1] ?? "").length || 0)),
      importMode: parsed.importMode,
      importedSymbols: parsed.importedSymbols,
    });
  }

  return statements;
}

function parseImportClause(clause: string): {
  importMode: "named" | "namespace" | "default" | "mixed";
  importedSymbols: string[];
} {
  const normalizedClause = clause.replace(/\s+/gu, " ").trim();
  let hasDefault = false;
  let hasNamespace = false;
  const importedSymbols: string[] = [];

  const parts = splitImportClauseParts(normalizedClause);
  for (const part of parts) {
    if (!part) {
      continue;
    }

    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("{") || trimmed.startsWith("type {")) {
      importedSymbols.push(...parseNamedImportSymbols(trimmed));
      continue;
    }

    if (trimmed.startsWith("* as ") || trimmed.startsWith("type * as ")) {
      hasNamespace = true;
      continue;
    }

    hasDefault = true;
  }

  const importMode = hasDefault && (hasNamespace || importedSymbols.length > 0)
    ? "mixed"
    : hasNamespace
      ? "namespace"
      : hasDefault
        ? "default"
        : "named";

  return {
    importMode,
    importedSymbols: uniqueStrings(importedSymbols).sort((left, right) => left.localeCompare(right)),
  };
}

function splitImportClauseParts(clause: string): string[] {
  const parts: string[] = [];
  let current = "";
  let braceDepth = 0;

  for (const character of clause) {
    if (character === "{") {
      braceDepth += 1;
    } else if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    }

    if (character === "," && braceDepth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function parseNamedImportSymbols(clause: string): string[] {
  const braceStart = clause.indexOf("{");
  const braceEnd = clause.lastIndexOf("}");
  if (braceStart === -1 || braceEnd === -1 || braceEnd <= braceStart) {
    return [];
  }

  return clause
    .slice(braceStart + 1, braceEnd)
    .split(",")
    .map((token) => token.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .map((token) => token.replace(/^type\s+/u, ""))
    .map((token) => token.split(/\s+as\s+/u)[0] ?? "")
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildPackageExportImpactPreview(
  exportName: string,
  currentGraph: Map<string, PackageExportSymbolDescriptor>,
  previousGraph: Map<string, PackageExportSymbolDescriptor>,
): PackageExportImpactPreview {
  const currentSymbol = currentGraph.get(exportName);
  const previousSymbol = previousGraph.get(exportName);
  const symbol = currentSymbol ?? previousSymbol;

  return {
    exportName,
    impactType: !previousSymbol
      ? "export_added"
      : !currentSymbol
        ? "export_removed"
        : "symbol_impacted",
    sourceModule: symbol?.sourceModule ?? "<unknown>",
    viaModules: symbol?.viaModules ?? [],
    isTypeOnly: currentSymbol?.isTypeOnly ?? previousSymbol?.isTypeOnly ?? false,
  };
}

function collectSymbolsForModule(
  graph: Map<string, PackageExportSymbolDescriptor>,
  modulePath: string,
): Map<string, PackageExportSymbolDescriptor> {
  const result = new Map<string, PackageExportSymbolDescriptor>();

  for (const [exportName, descriptor] of graph.entries()) {
    if (descriptor.sourceModule === modulePath || descriptor.viaModules.includes(modulePath)) {
      result.set(exportName, descriptor);
    }
  }

  return result;
}

function collectChangedSourceModules(changedFiles: string[]): string[] {
  return uniqueStrings(
    changedFiles
      .filter((filePath) => filePath.startsWith("src/") && /\.[cm]?[jt]sx?$/u.test(filePath))
      .map((filePath) => filePath.replace(/\\/gu, "/").replace(/\.[^.]+$/u, "")),
  );
}

function extractDirectExportSymbols(
  source: string,
): Array<{ exportName: string; isTypeOnly: boolean }> {
  const results = new Map<string, boolean>();
  const directPatterns = [
    { regex: /export\s+(?:declare\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gmu, isTypeOnly: false },
    { regex: /export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gmu, isTypeOnly: false },
    { regex: /export\s+enum\s+([A-Za-z_$][\w$]*)/gmu, isTypeOnly: false },
    { regex: /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gmu, isTypeOnly: false },
    { regex: /export\s+interface\s+([A-Za-z_$][\w$]*)/gmu, isTypeOnly: true },
    { regex: /export\s+type\s+(?!\{)([A-Za-z_$][\w$]*)/gmu, isTypeOnly: true },
  ] as const;

  for (const pattern of directPatterns) {
    for (const match of source.matchAll(pattern.regex)) {
      const exportName = (match[1] ?? "").trim();
      if (!exportName) {
        continue;
      }

      results.set(exportName, pattern.isTypeOnly);
    }
  }

  return Array.from(results.entries())
    .map(([exportName, isTypeOnly]) => ({ exportName, isTypeOnly }))
    .sort((left, right) => left.exportName.localeCompare(right.exportName));
}

function parseNamedReExportStatements(
  source: string,
): Array<{ sourceSpecifier: string; specifiers: ReExportSpecifier[] }> {
  const statements: Array<{ sourceSpecifier: string; specifiers: ReExportSpecifier[] }> = [];
  const pattern = /export\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+["']([^"']+)["'];?/gmu;

  for (const match of source.matchAll(pattern)) {
    const statementTypeOnly = Boolean(match[1]);
    const sourceSpecifier = (match[3] ?? "").trim();
    if (!sourceSpecifier) {
      continue;
    }

    const specifiers = (match[2] ?? "")
      .split(",")
      .map((token) => token.replace(/\s+/gu, " ").trim())
      .filter(Boolean)
      .map((token) => {
        let cleaned = token;
        let isTypeOnly = statementTypeOnly;
        if (cleaned.startsWith("type ")) {
          isTypeOnly = true;
          cleaned = cleaned.slice(5).trim();
        }

        const aliasParts = cleaned.split(/\s+as\s+/u);
        const importedName = (aliasParts[0] ?? "").trim();
        const exportedName = (aliasParts[1] ?? aliasParts[0] ?? "").trim();

        return {
          importedName,
          exportedName,
          isTypeOnly,
        } satisfies ReExportSpecifier;
      })
      .filter((specifier) => specifier.importedName && specifier.exportedName);

    if (specifiers.length > 0) {
      statements.push({ sourceSpecifier, specifiers });
    }
  }

  return statements;
}

function extractExportSymbols(source: string): string[] {
  const symbols = new Set<string>();
  const exportListPattern = /export\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+["'][^"']+["'];?/gmu;

  for (const match of source.matchAll(exportListPattern)) {
    const exportList = match[1] ?? "";
    for (const token of exportList.split(",")) {
      const cleaned = token.replace(/\s+/gu, " ").trim();
      if (!cleaned) {
        continue;
      }

      const withoutTypePrefix = cleaned.replace(/^type\s+/u, "");
      const aliasParts = withoutTypePrefix.split(/\s+as\s+/u);
      const exportedName = (aliasParts[1] ?? aliasParts[0] ?? "").trim();
      if (exportedName) {
        symbols.add(exportedName);
      }
    }
  }

  return Array.from(symbols).sort((left, right) => left.localeCompare(right));
}

function resolveLocalSourceModulePath(importerFile: string, sourceSpecifier: string): string | null {
  if (!sourceSpecifier.startsWith(".")) {
    return null;
  }

  const normalizedSpecifier = sourceSpecifier.endsWith(".js")
    ? sourceSpecifier.replace(/\.js$/u, ".ts")
    : sourceSpecifier.endsWith(".mjs")
      ? sourceSpecifier.replace(/\.mjs$/u, ".ts")
      : /\.[cm]?[jt]sx?$/u.test(sourceSpecifier)
        ? sourceSpecifier
        : `${sourceSpecifier}.ts`;
  const absolutePath = resolve(dirname(resolve(importerFile)), normalizedSpecifier);
  return normalizeWorkspaceFilePath(relative(WORKSPACE_ROOT, absolutePath));
}

function normalizePackageModulePath(filePath: string, packageRoot: string): string {
  return trimPrefix(normalizeWorkspaceFilePath(filePath), packageRoot).replace(/\.[^.]+$/u, "");
}

function normalizeWorkspaceFilePath(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function mergeImportModes(
  modes: Array<"named" | "namespace" | "default" | "mixed">,
): "named" | "namespace" | "default" | "mixed" {
  if (modes.includes("mixed")) {
    return "mixed";
  }

  const uniqueModes = uniqueStrings(modes);
  if (uniqueModes.length <= 1) {
    return (uniqueModes[0] as "named" | "namespace" | "default" | "mixed" | undefined) ?? "named";
  }

  return "mixed";
}

function countSourceLines(source: string, endIndex: number): number {
  return source.slice(0, endIndex).split(/\r?\n/u).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function collectAffectedModules(changedFiles: string[]): string[] {
  const modules = new Set<string>();

  for (const filePath of changedFiles) {
    const normalized = filePath.replace(/\\/gu, "/");
    const withoutExtension = normalized.replace(/\.[^.]+$/u, "");
    const moduleName = withoutExtension.startsWith("src/")
      ? withoutExtension.slice(4)
      : withoutExtension;

    modules.add(moduleName);
  }

  return Array.from(modules)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_SURFACE_ITEMS);
}

function difference(source: string[], target: string[]): string[] {
  const targetSet = new Set(target);
  return source.filter((item) => !targetSet.has(item));
}

function mergeHistory(currentItem: HistoryItem, existingItems: HistoryItem[], retention: number): HistoryDocument {
  const items = [currentItem, ...existingItems.filter((item) => item.commit !== currentItem.commit)].slice(
    0,
    retention,
  );

  return {
    retention,
    items,
  };
}

function isBreakingChange(commitMessage: string): boolean {
  const normalized = commitMessage.trim();
  if (!normalized) {
    return false;
  }

  const firstLine = normalized.split(/\r?\n/u)[0] ?? "";
  return /!:/u.test(firstLine) || /BREAKING CHANGE/u.test(normalized) || /\bbreaking\b/iu.test(firstLine);
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

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function readLocalFileMaybe(filePath: string): Promise<string | null> {
  try {
    return await readFile(resolve(filePath), "utf8");
  } catch {
    return null;
  }
}

async function readGitFile(commit: string, filePath: string): Promise<string | null> {
  try {
    const gitPath = filePath.replace(/\\/gu, "/");
    return await runGit(["show", `${commit}:${gitPath}`]);
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextFile(filePath: string, value: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

async function runGit(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

function splitGitOutput(output: string): string[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseJson<T>(source: string): T | null {
  try {
    return JSON.parse(source) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);

  return `{${entries.join(",")}}`;
}

function trimPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function sanitizeEventToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(`[agent-artifacts] ${formatError(error)}`);
  process.exit(1);
});
