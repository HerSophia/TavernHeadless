import { createHash } from "node:crypto";

import {
  compileNodeGraph,
  type NodeGraphDiagnostic,
  type NodeGraphDocument,
} from "@tavern/core";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { nodeGraphDefinitions, nodeGraphVersions } from "../db/schema.js";
import { GOVERNANCE_OPERATION_ACTIONS } from "./governance/operation-log-names.js";
import { OperationLogService } from "./operation-log-service.js";
import {
  ProjectAccessService,
  type ProjectActorInput,
} from "./project-access-service.js";

export type NodeGraphDefinitionStatus = "active" | "archived";

export type NodeGraphDefinitionRecord = {
  id: string;
  accountId: string;
  workspaceId: string;
  projectId: string;
  name: string;
  status: NodeGraphDefinitionStatus;
  currentVersionId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type NodeGraphVersionRecord = {
  id: string;
  graphId: string;
  versionNo: number;
  document: NodeGraphDocument;
  documentHash: string;
  parentVersionId: string | null;
  operationLogId: string | null;
  createdAt: number;
};

export type NodeGraphValidationSummary = {
  isExecutable: boolean;
  diagnostics: NodeGraphDiagnostic[];
  topologicalLevels: string[][];
};

export type NodeGraphDefinitionServiceErrorCode =
  | "node_graph_not_found"
  | "node_graph_version_not_found"
  | "node_graph_archived"
  | "node_graph_document_invalid"
  | "node_graph_project_mismatch";

export class NodeGraphDefinitionServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    public readonly code: NodeGraphDefinitionServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NodeGraphDefinitionServiceError";
  }
}

export type CreateNodeGraphDefinitionInput = {
  actor: ProjectActorInput;
  projectId: string;
  name?: string | null;
  document: NodeGraphDocument;
  requestId?: string | null;
  now?: number;
};

export type CreateNodeGraphVersionInput = {
  actor: ProjectActorInput;
  projectId: string;
  graphId: string;
  document: NodeGraphDocument;
  parentVersionId?: string | null;
  requestId?: string | null;
  now?: number;
};

export type ListNodeGraphDefinitionsInput = {
  actor: ProjectActorInput;
  projectId: string;
  status?: NodeGraphDefinitionStatus | null;
};

export type GetNodeGraphDefinitionInput = {
  actor: ProjectActorInput;
  projectId: string;
  graphId: string;
};

export type ValidateNodeGraphDocumentInput = {
  actor: ProjectActorInput;
  projectId: string;
  document: NodeGraphDocument;
};

export type ManageNodeGraphInput = {
  actor: ProjectActorInput;
  projectId: string;
  graphId: string;
  requestId?: string | null;
  now?: number;
};

type ServiceDb = AppDb | DbExecutor;

function assertNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return trimmed;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => item === undefined ? "null" : stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function hashDocument(document: NodeGraphDocument): string {
  return `sha256:${createHash("sha256").update(stableStringify(document)).digest("hex")}`;
}

function parseDocument(json: string): NodeGraphDocument {
  return JSON.parse(json) as NodeGraphDocument;
}

function mapDefinition(row: typeof nodeGraphDefinitions.$inferSelect): NodeGraphDefinitionRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    name: row.name,
    status: row.status,
    currentVersionId: row.currentVersionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapVersion(row: typeof nodeGraphVersions.$inferSelect): NodeGraphVersionRecord {
  return {
    id: row.id,
    graphId: row.graphId,
    versionNo: row.versionNo,
    document: parseDocument(row.documentJson),
    documentHash: row.documentHash,
    parentVersionId: row.parentVersionId,
    operationLogId: row.operationLogId,
    createdAt: row.createdAt,
  };
}

function normalizeDocument(document: NodeGraphDocument, graphId: string): NodeGraphDocument {
  return {
    ...document,
    graphId,
    name: document.name.trim(),
    nodes: document.nodes.map((node) => ({ enabled: true, ...node })),
    edges: [...document.edges],
    groups: document.groups ? [...document.groups] : undefined,
    policies: document.policies ?? {},
  };
}

function validateDocument(document: NodeGraphDocument): NodeGraphValidationSummary {
  const compiled = compileNodeGraph(document);
  return {
    isExecutable: compiled.isExecutable,
    diagnostics: compiled.diagnostics,
    topologicalLevels: compiled.topologicalLevels.map((level) => level.map((node) => node.id)),
  };
}

function assertExecutable(document: NodeGraphDocument): NodeGraphValidationSummary {
  const validation = validateDocument(document);
  if (!validation.isExecutable) {
    throw new NodeGraphDefinitionServiceError(
      400,
      "node_graph_document_invalid",
      "NodeGraph document contains validation errors.",
    );
  }
  return validation;
}

export class NodeGraphDefinitionService {
  private readonly accessService: ProjectAccessService;

  constructor(private readonly db: ServiceDb) {
    this.accessService = new ProjectAccessService(db);
  }

  validate(input: ValidateNodeGraphDocumentInput): NodeGraphValidationSummary {
    this.accessService.requireProjectActionForActor(input.actor, input.projectId, "project.nodegraph.read");
    return validateDocument(input.document);
  }

  list(input: ListNodeGraphDefinitionsInput): NodeGraphDefinitionRecord[] {
    const access = this.accessService.requireProjectActionForActor(input.actor, input.projectId, "project.nodegraph.read");
    return this.db
      .select()
      .from(nodeGraphDefinitions)
      .where(and(
        eq(nodeGraphDefinitions.accountId, access.project.accountId),
        eq(nodeGraphDefinitions.projectId, access.project.id),
        input.status ? eq(nodeGraphDefinitions.status, input.status) : undefined,
      ))
      .orderBy(desc(nodeGraphDefinitions.updatedAt))
      .all()
      .map(mapDefinition);
  }

  get(input: GetNodeGraphDefinitionInput): NodeGraphDefinitionRecord {
    const access = this.accessService.requireProjectActionForActor(input.actor, input.projectId, "project.nodegraph.read");
    const row = this.db
      .select()
      .from(nodeGraphDefinitions)
      .where(and(
        eq(nodeGraphDefinitions.accountId, access.project.accountId),
        eq(nodeGraphDefinitions.projectId, access.project.id),
        eq(nodeGraphDefinitions.id, input.graphId),
      ))
      .limit(1)
      .get();
    if (!row) {
      throw new NodeGraphDefinitionServiceError(404, "node_graph_not_found", `NodeGraph not found: ${input.graphId}`);
    }
    return mapDefinition(row);
  }

  create(input: CreateNodeGraphDefinitionInput): {
    definition: NodeGraphDefinitionRecord;
    version: NodeGraphVersionRecord;
    validation: NodeGraphValidationSummary;
  } {
    const access = this.accessService.requireProjectActionForActor(input.actor, input.projectId, "project.nodegraph.write");
    const now = input.now ?? Date.now();
    const graphId = input.document.graphId?.trim() || `ngraph_${nanoid(12)}`;
    const document = normalizeDocument(input.document, graphId);
    const validation = assertExecutable(document);
    const documentJson = stableStringify(document);
    const documentHash = hashDocument(document);

    const result = this.db.transaction((tx) => {
      const definitionRow = tx
        .insert(nodeGraphDefinitions)
        .values({
          id: graphId,
          accountId: access.project.accountId,
          workspaceId: access.project.workspaceId,
          projectId: access.project.id,
          name: input.name?.trim() || document.name,
          status: "active",
          currentVersionId: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

      const operationLog = new OperationLogService(tx).append({
        accountId: access.project.accountId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorAccountId,
        actorAccountId: input.actor.actorAccountId,
        actorClientId: input.actor.actorClientId ?? null,
        requestId: input.requestId,
        sourceType: "api",
        action: "node_graph.create",
        status: "succeeded",
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        targetType: "node_graph",
        targetId: graphId,
        afterRef: { graphId, documentHash },
        metadata: { version_no: 1 },
        createdAt: now,
      });

      const versionRow = tx
        .insert(nodeGraphVersions)
        .values({
          id: `ngver_${nanoid(12)}`,
          graphId,
          versionNo: 1,
          documentJson,
          documentHash,
          parentVersionId: null,
          operationLogId: operationLog.id,
          createdAt: now,
        })
        .returning()
        .get();

      const updatedDefinition = tx
        .update(nodeGraphDefinitions)
        .set({
          currentVersionId: versionRow.id,
          updatedAt: now,
        })
        .where(eq(nodeGraphDefinitions.id, graphId))
        .returning()
        .get();

      return {
        definition: mapDefinition(updatedDefinition ?? definitionRow),
        version: mapVersion(versionRow),
      };
    });

    return { ...result, validation };
  }

  createVersion(input: CreateNodeGraphVersionInput): {
    definition: NodeGraphDefinitionRecord;
    version: NodeGraphVersionRecord;
    validation: NodeGraphValidationSummary;
  } {
    const access = this.accessService.requireProjectActionForActor(input.actor, input.projectId, "project.nodegraph.write");
    const definition = this.get({ actor: input.actor, projectId: input.projectId, graphId: input.graphId });
    if (definition.status === "archived") {
      throw new NodeGraphDefinitionServiceError(409, "node_graph_archived", `NodeGraph is archived: ${input.graphId}`);
    }
    const now = input.now ?? Date.now();
    const document = normalizeDocument(input.document, definition.id);
    const validation = assertExecutable(document);
    const documentJson = stableStringify(document);
    const documentHash = hashDocument(document);

    const result = this.db.transaction((tx) => {
      const currentVersion = definition.currentVersionId
        ? tx.select().from(nodeGraphVersions).where(eq(nodeGraphVersions.id, definition.currentVersionId)).limit(1).get()
        : null;
      const parentVersionId = input.parentVersionId ?? currentVersion?.id ?? null;
      const versionNo = (currentVersion?.versionNo ?? 0) + 1;

      const operationLog = new OperationLogService(tx).append({
        accountId: access.project.accountId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorAccountId,
        actorAccountId: input.actor.actorAccountId,
        actorClientId: input.actor.actorClientId ?? null,
        requestId: input.requestId,
        sourceType: "api",
        action: "node_graph.version.create",
        status: "succeeded",
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        targetType: "node_graph",
        targetId: definition.id,
        beforeRef: currentVersion ? { versionId: currentVersion.id, documentHash: currentVersion.documentHash } : null,
        afterRef: { documentHash },
        diff: { from_hash: currentVersion?.documentHash ?? null, to_hash: documentHash },
        metadata: { version_no: versionNo },
        createdAt: now,
      });

      const versionRow = tx
        .insert(nodeGraphVersions)
        .values({
          id: `ngver_${nanoid(12)}`,
          graphId: definition.id,
          versionNo,
          documentJson,
          documentHash,
          parentVersionId,
          operationLogId: operationLog.id,
          createdAt: now,
        })
        .returning()
        .get();

      const updatedDefinition = tx
        .update(nodeGraphDefinitions)
        .set({
          name: document.name,
          currentVersionId: versionRow.id,
          updatedAt: now,
        })
        .where(eq(nodeGraphDefinitions.id, definition.id))
        .returning()
        .get();

      return {
        definition: mapDefinition(updatedDefinition),
        version: mapVersion(versionRow),
      };
    });

    return { ...result, validation };
  }

  getCurrentVersion(input: GetNodeGraphDefinitionInput): NodeGraphVersionRecord {
    const definition = this.get(input);
    if (!definition.currentVersionId) {
      throw new NodeGraphDefinitionServiceError(
        404,
        "node_graph_version_not_found",
        `NodeGraph has no current version: ${definition.id}`,
      );
    }
    return this.getVersion({
      actor: input.actor,
      projectId: input.projectId,
      graphId: input.graphId,
      versionId: definition.currentVersionId,
    });
  }

  getVersion(input: GetNodeGraphDefinitionInput & { versionId: string }): NodeGraphVersionRecord {
    const definition = this.get(input);
    const row = this.db
      .select()
      .from(nodeGraphVersions)
      .where(and(
        eq(nodeGraphVersions.graphId, definition.id),
        eq(nodeGraphVersions.id, assertNonEmpty(input.versionId, "versionId")),
      ))
      .limit(1)
      .get();
    if (!row) {
      throw new NodeGraphDefinitionServiceError(
        404,
        "node_graph_version_not_found",
        `NodeGraph version not found: ${input.versionId}`,
      );
    }
    return mapVersion(row);
  }

  listVersions(input: GetNodeGraphDefinitionInput): NodeGraphVersionRecord[] {
    const definition = this.get(input);
    return this.db
      .select()
      .from(nodeGraphVersions)
      .where(eq(nodeGraphVersions.graphId, definition.id))
      .orderBy(desc(nodeGraphVersions.versionNo))
      .all()
      .map(mapVersion);
  }

  /**
   * R6-3（缺口 6）：图归档。需要 `project.nodegraph.manage`。
   *
   * 归档后图不再接受新版本（`createVersion` 抛 `node_graph_archived`），但保留所有版本与运行历史，
   * 可经 `unarchive` 恢复。写 `node_graph.archive` 审计。
   */
  archive(input: ManageNodeGraphInput): NodeGraphDefinitionRecord {
    return this.setStatus(input, "archived", GOVERNANCE_OPERATION_ACTIONS.nodeGraph.archive);
  }

  /** R6-3（缺口 6）：取消归档。需要 `project.nodegraph.manage`。写 `node_graph.unarchive` 审计。 */
  unarchive(input: ManageNodeGraphInput): NodeGraphDefinitionRecord {
    return this.setStatus(input, "active", GOVERNANCE_OPERATION_ACTIONS.nodeGraph.unarchive);
  }

  /**
   * R6-3（缺口 6）：显式设当前版本（含回滚到旧版本）。需要 `project.nodegraph.manage`。
   *
   * 目标版本必须属于该图。归档图禁止切换当前版本。写 `node_graph.version.set_current` 审计，
   * 记录 before / after 版本，便于回放与回滚追踪。
   */
  setCurrentVersion(input: ManageNodeGraphInput & { versionId: string }): {
    definition: NodeGraphDefinitionRecord;
    version: NodeGraphVersionRecord;
  } {
    const access = this.accessService.requireProjectActionForActor(input.actor, input.projectId, "project.nodegraph.manage");
    const now = input.now ?? Date.now();
    const row = this.requireDefinitionRow(access.project.accountId, access.project.id, input.graphId);
    if (row.status === "archived") {
      throw new NodeGraphDefinitionServiceError(409, "node_graph_archived", `NodeGraph is archived: ${input.graphId}`);
    }
    const targetVersion = this.db
      .select()
      .from(nodeGraphVersions)
      .where(and(
        eq(nodeGraphVersions.graphId, row.id),
        eq(nodeGraphVersions.id, assertNonEmpty(input.versionId, "versionId")),
      ))
      .limit(1)
      .get();
    if (!targetVersion) {
      throw new NodeGraphDefinitionServiceError(
        404,
        "node_graph_version_not_found",
        `NodeGraph version not found: ${input.versionId}`,
      );
    }

    return this.db.transaction((tx) => {
      new OperationLogService(tx).append({
        accountId: access.project.accountId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorAccountId,
        actorAccountId: input.actor.actorAccountId,
        actorClientId: input.actor.actorClientId ?? null,
        requestId: input.requestId,
        sourceType: "api",
        action: GOVERNANCE_OPERATION_ACTIONS.nodeGraph.versionSetCurrent,
        status: "succeeded",
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        targetType: "node_graph",
        targetId: row.id,
        beforeRef: { currentVersionId: row.currentVersionId },
        afterRef: { currentVersionId: targetVersion.id },
        metadata: { version_no: targetVersion.versionNo, rollback: targetVersion.id !== row.currentVersionId },
        createdAt: now,
      });
      const updated = tx
        .update(nodeGraphDefinitions)
        .set({ currentVersionId: targetVersion.id, updatedAt: now })
        .where(eq(nodeGraphDefinitions.id, row.id))
        .returning()
        .get();
      return { definition: mapDefinition(updated), version: mapVersion(targetVersion) };
    });
  }

  private setStatus(
    input: ManageNodeGraphInput,
    status: NodeGraphDefinitionStatus,
    action: string,
  ): NodeGraphDefinitionRecord {
    const access = this.accessService.requireProjectActionForActor(input.actor, input.projectId, "project.nodegraph.manage");
    const now = input.now ?? Date.now();
    const row = this.requireDefinitionRow(access.project.accountId, access.project.id, input.graphId);

    return this.db.transaction((tx) => {
      new OperationLogService(tx).append({
        accountId: access.project.accountId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorAccountId,
        actorAccountId: input.actor.actorAccountId,
        actorClientId: input.actor.actorClientId ?? null,
        requestId: input.requestId,
        sourceType: "api",
        action,
        status: "succeeded",
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        targetType: "node_graph",
        targetId: row.id,
        beforeRef: { status: row.status },
        afterRef: { status },
        metadata: { status },
        createdAt: now,
      });
      const updated = tx
        .update(nodeGraphDefinitions)
        .set({ status, updatedAt: now })
        .where(eq(nodeGraphDefinitions.id, row.id))
        .returning()
        .get();
      return mapDefinition(updated);
    });
  }

  private requireDefinitionRow(
    accountId: string,
    projectId: string,
    graphId: string,
  ): typeof nodeGraphDefinitions.$inferSelect {
    const row = this.db
      .select()
      .from(nodeGraphDefinitions)
      .where(and(
        eq(nodeGraphDefinitions.accountId, accountId),
        eq(nodeGraphDefinitions.projectId, projectId),
        eq(nodeGraphDefinitions.id, graphId),
      ))
      .limit(1)
      .get();
    if (!row) {
      throw new NodeGraphDefinitionServiceError(404, "node_graph_not_found", `NodeGraph not found: ${graphId}`);
    }
    return row;
  }
}
