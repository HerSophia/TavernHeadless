import {
  buildNodeGraphPackageSecuritySummary,
  createDefaultNodeTypeRegistry,
  exportNodeGraphPackage,
  NODE_GRAPH_PACKAGE_GRAPH_API_VERSION,
  NODE_GRAPH_PLATFORM_CAPABILITIES,
  NodeGraphPackageParseError,
  parseNodeGraphPackage,
  preflightNodeGraphPackage,
  type NodeGraphDocument,
  type NodeGraphPackage,
  type NodeGraphPackageEnvironment,
  type NodeGraphPackagePreflightResult,
  type NodeGraphPackageSecuritySummary,
} from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { GOVERNANCE_OPERATION_ACTIONS } from "./governance/operation-log-names.js";
import {
  NodeGraphDefinitionService,
  type NodeGraphDefinitionRecord,
  type NodeGraphValidationSummary,
  type NodeGraphVersionRecord,
} from "./node-graph-definition-service.js";
import { OperationLogService } from "./operation-log-service.js";
import {
  ProjectAccessService,
  ProjectAccessServiceError,
  type ProjectAccess,
  type ProjectAction,
  type ProjectActorInput,
} from "./project-access-service.js";

export type NodeGraphPackageServiceErrorCode =
  | "node_graph_package_invalid"
  | "node_graph_package_not_installable";

export class NodeGraphPackageServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 422,
    public readonly code: NodeGraphPackageServiceErrorCode,
    message: string,
    public readonly diagnostics?: NodeGraphPackagePreflightResult["diagnostics"],
  ) {
    super(message);
    this.name = "NodeGraphPackageServiceError";
  }
}

/**
 * Package permission strings that map to a real Project action.
 *
 * Used to probe whether the importing actor already holds a requested permission.
 * Permissions outside this map surface as PERMISSION_REQUIRED warnings (informational,
 * non-blocking for install) because there is no full capability registry yet.
 */
const PACKAGE_PERMISSION_PROJECT_ACTIONS: Readonly<Record<string, ProjectAction>> = {
  "project.agent.run": "project.agent.run",
  "project.agent.manage": "project.agent.manage",
  "session_state.write": "session_state.write",
  "session.state.write": "session_state.write",
  "memory.write": "memory.write",
  "variable.write": "variable.write",
  "project.config.read": "project.config.read",
  "project.config.write": "project.config.write",
  "project.nodegraph.read": "project.nodegraph.read",
  "project.nodegraph.write": "project.nodegraph.write",
  "project.nodegraph.run": "project.nodegraph.run",
  "project.nodegraph.manage": "project.nodegraph.manage",
};

export type ExportNodeGraphPackageServiceInput = {
  actor: ProjectActorInput;
  projectId: string;
  graphId: string;
  versionId?: string | null;
  /** Override package metadata version (defaults to `v<versionNo>`). */
  packageVersion?: string | null;
  requestId?: string | null;
  now?: number;
};

export type ExportNodeGraphPackageServiceResult = {
  package: NodeGraphPackage;
  securitySummary: NodeGraphPackageSecuritySummary;
  graphId: string;
  versionId: string;
  versionNo: number;
};

export type PreflightNodeGraphPackageInput = {
  actor: ProjectActorInput;
  projectId: string;
  package: unknown;
};

export type PreflightNodeGraphPackageResult = NodeGraphPackagePreflightResult & {
  securitySummary: NodeGraphPackageSecuritySummary;
  packageId: string;
  contentHash: string | null;
};

export type ImportNodeGraphPackageInput = {
  actor: ProjectActorInput;
  projectId: string;
  package: unknown;
  /** Must be true to actually install; otherwise returns the preflight for user confirmation. */
  confirm?: boolean;
  name?: string | null;
  requestId?: string | null;
  now?: number;
};

export type ImportNodeGraphPackageResult =
  | {
      confirmed: false;
      requiresConfirmation: true;
      preflight: PreflightNodeGraphPackageResult;
    }
  | {
      confirmed: true;
      requiresConfirmation: false;
      preflight: PreflightNodeGraphPackageResult;
      definition: NodeGraphDefinitionRecord;
      version: NodeGraphVersionRecord;
      validation: NodeGraphValidationSummary;
    };

type ServiceDb = AppDb | DbExecutor;

/**
 * NG2-PKG（阶段 9-11）：NodeGraphPackage import / export 与缺失依赖预检服务。
 *
 * - 导出：把某个 graph version 打包为带 manifest / 依赖 / 权限 / 安全摘要 / 完整性的 package。
 * - 预检：在执行前对照 Workspace（registry / capability）+ Project（权限）边界产出
 *   `GraphImportDiagnostic` 与安全摘要，区分可降级与不可降级。
 * - 导入：预检通过且用户确认后，按 v2 安装为新的 graph 定义（commit-only 边界仍由
 *   NodeGraphDefinitionService 校验执行性）。
 *
 * 全程复用批次 8 治理：审计只写摘要与 hash，不写完整图正文。
 */
export class NodeGraphPackageService {
  private readonly accessService: ProjectAccessService;
  private readonly definitionService: NodeGraphDefinitionService;

  constructor(private readonly db: ServiceDb) {
    this.accessService = new ProjectAccessService(db);
    this.definitionService = new NodeGraphDefinitionService(db);
  }

  exportPackage(input: ExportNodeGraphPackageServiceInput): ExportNodeGraphPackageServiceResult {
    const access = this.accessService.requireProjectActionForActor(
      input.actor,
      input.projectId,
      "project.nodegraph.read",
    );
    const definition = this.definitionService.get({
      actor: input.actor,
      projectId: input.projectId,
      graphId: input.graphId,
    });
    const version = input.versionId
      ? this.definitionService.getVersion({
          actor: input.actor,
          projectId: input.projectId,
          graphId: input.graphId,
          versionId: input.versionId,
        })
      : this.definitionService.getCurrentVersion({
          actor: input.actor,
          projectId: input.projectId,
          graphId: input.graphId,
        });

    const pkg = exportNodeGraphPackage({
      document: version.document,
      metadata: {
        id: definition.id,
        name: definition.name,
        version: input.packageVersion?.trim() || `v${version.versionNo}`,
      },
    });
    const securitySummary = buildNodeGraphPackageSecuritySummary(pkg);

    new OperationLogService(this.db).append({
      accountId: access.project.accountId,
      actorType: input.actor.actorType,
      actorId: input.actor.actorAccountId,
      actorAccountId: input.actor.actorAccountId,
      actorClientId: input.actor.actorClientId ?? null,
      requestId: input.requestId,
      sourceType: "api",
      action: GOVERNANCE_OPERATION_ACTIONS.nodeGraph.export,
      status: "succeeded",
      workspaceId: access.project.workspaceId,
      projectId: access.project.id,
      targetType: "node_graph",
      targetId: definition.id,
      afterRef: { graphId: definition.id, contentHash: pkg.integrity?.contentHash ?? null },
      metadata: {
        version_id: version.id,
        version_no: version.versionNo,
        package_id: pkg.metadata.id,
        package_version: pkg.metadata.version,
        ...this.summarizePackageForLog(pkg, securitySummary),
      },
      createdAt: input.now,
    });

    return {
      package: pkg,
      securitySummary,
      graphId: definition.id,
      versionId: version.id,
      versionNo: version.versionNo,
    };
  }

  preflightImport(input: PreflightNodeGraphPackageInput): PreflightNodeGraphPackageResult {
    const access = this.accessService.requireProjectActionForActor(
      input.actor,
      input.projectId,
      "project.nodegraph.write",
    );
    const pkg = this.parsePackage(input.package);
    return this.runPreflight(pkg, access, input.actor, input.projectId);
  }

  importPackage(input: ImportNodeGraphPackageInput): ImportNodeGraphPackageResult {
    const access = this.accessService.requireProjectActionForActor(
      input.actor,
      input.projectId,
      "project.nodegraph.write",
    );
    const pkg = this.parsePackage(input.package);
    const preflight = this.runPreflight(pkg, access, input.actor, input.projectId);

    if (!preflight.installable) {
      throw new NodeGraphPackageServiceError(
        422,
        "node_graph_package_not_installable",
        "NodeGraphPackage has blocking import diagnostics; resolve errors before installing.",
        preflight.diagnostics,
      );
    }

    if (input.confirm !== true) {
      return { confirmed: false, requiresConfirmation: true, preflight };
    }

    // 安装为新图：清空 graphId 让定义服务生成新 id，避免与现有图冲突。
    const document: NodeGraphDocument = { ...pkg.graph, graphId: "" };
    const created = this.definitionService.create({
      actor: input.actor,
      projectId: input.projectId,
      name: input.name?.trim() || pkg.metadata.name,
      document,
      requestId: input.requestId,
      now: input.now,
    });

    new OperationLogService(this.db).append({
      accountId: access.project.accountId,
      actorType: input.actor.actorType,
      actorId: input.actor.actorAccountId,
      actorAccountId: input.actor.actorAccountId,
      actorClientId: input.actor.actorClientId ?? null,
      requestId: input.requestId,
      sourceType: "api",
      action: GOVERNANCE_OPERATION_ACTIONS.nodeGraph.import,
      status: "succeeded",
      workspaceId: access.project.workspaceId,
      projectId: access.project.id,
      targetType: "node_graph",
      targetId: created.definition.id,
      afterRef: { graphId: created.definition.id, sourceContentHash: pkg.integrity?.contentHash ?? null },
      metadata: {
        package_id: pkg.metadata.id,
        package_version: pkg.metadata.version,
        diagnostic_counts: preflight.counts,
        migration_available: preflight.migrationAvailable,
        degraded_node_types: preflight.degradableNodeTypes,
        ...this.summarizePackageForLog(pkg, preflight.securitySummary),
      },
      createdAt: input.now,
    });

    return {
      confirmed: true,
      requiresConfirmation: false,
      preflight,
      definition: created.definition,
      version: created.version,
      validation: created.validation,
    };
  }

  private parsePackage(raw: unknown): NodeGraphPackage {
    try {
      return parseNodeGraphPackage(raw);
    } catch (error) {
      if (error instanceof NodeGraphPackageParseError) {
        throw new NodeGraphPackageServiceError(400, "node_graph_package_invalid", error.message);
      }
      throw error;
    }
  }

  private runPreflight(
    pkg: NodeGraphPackage,
    access: ProjectAccess,
    actor: ProjectActorInput,
    projectId: string,
  ): PreflightNodeGraphPackageResult {
    const environment = this.buildEnvironment(pkg, actor, projectId);
    const result = preflightNodeGraphPackage(pkg, environment);
    const securitySummary = buildNodeGraphPackageSecuritySummary(pkg);
    void access;
    return {
      ...result,
      securitySummary,
      packageId: pkg.metadata.id,
      contentHash: pkg.integrity?.contentHash ?? null,
    };
  }

  private buildEnvironment(
    pkg: NodeGraphPackage,
    actor: ProjectActorInput,
    projectId: string,
  ): NodeGraphPackageEnvironment {
    const registry = createDefaultNodeTypeRegistry();
    const availableNodeTypes = new Set(registry.list().map((entry) => `${entry.type}@${entry.typeVersion}`));
    const grantedPermissions = new Set<string>();
    for (const requirement of pkg.permissions) {
      const action = PACKAGE_PERMISSION_PROJECT_ACTIONS[requirement.permission];
      if (action && this.hasProjectAction(actor, projectId, action)) {
        grantedPermissions.add(requirement.permission);
      }
    }
    return {
      availableNodeTypes,
      availableCapabilities: new Set(NODE_GRAPH_PLATFORM_CAPABILITIES),
      grantedPermissions,
      graphApiVersion: NODE_GRAPH_PACKAGE_GRAPH_API_VERSION,
    };
  }

  private hasProjectAction(actor: ProjectActorInput, projectId: string, action: ProjectAction): boolean {
    try {
      this.accessService.requireProjectActionForActor(actor, projectId, action);
      return true;
    } catch (error) {
      if (error instanceof ProjectAccessServiceError) {
        return false;
      }
      throw error;
    }
  }

  private summarizePackageForLog(
    pkg: NodeGraphPackage,
    securitySummary: NodeGraphPackageSecuritySummary,
  ): Record<string, unknown> {
    return {
      content_hash: pkg.integrity?.contentHash ?? null,
      node_count: pkg.graph.nodes.length,
      node_type_count: pkg.dependencies.nodeTypes.length,
      capability_count: pkg.dependencies.capabilities?.length ?? 0,
      mcp_server_count: pkg.dependencies.mcpServers?.length ?? 0,
      permission_count: pkg.permissions.length,
      persistent_output_targets: securitySummary.persistentOutputTargets,
      proposes_committed_writes: securitySummary.proposesCommittedWrites,
      requests_network_access: securitySummary.requestsNetworkAccess,
      requests_file_write: securitySummary.requestsFileWrite,
    };
  }
}
