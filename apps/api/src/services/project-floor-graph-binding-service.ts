import { compileNodeGraph, type NodeGraphDocument } from "@tavern/core";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  nodeGraphDefinitions,
  nodeGraphVersions,
  projectFloorGraphBindings,
  projects,
  sessions,
} from "../db/schema.js";
import { GOVERNANCE_OPERATION_ACTIONS } from "./governance/operation-log-names.js";
import { OperationLogService } from "./operation-log-service.js";
import type { PromptMode } from "./prompt-assembler.js";
import { ProjectAccessService, type ProjectActorInput } from "./project-access-service.js";

export const FLOOR_GRAPH_BINDING_KIND_VALUES = ["native", "compat"] as const;
export type FloorGraphBindingKind = (typeof FLOOR_GRAPH_BINDING_KIND_VALUES)[number];

export type ProjectFloorGraphBindingStatus = "active" | "archived";

export interface ProjectFloorGraphBindingRecord {
  id: string;
  accountId: string;
  workspaceId: string;
  projectId: string;
  kind: FloorGraphBindingKind;
  graphId: string;
  graphVersionId: string;
  graphName: string;
  graphVersionNo: number;
  status: ProjectFloorGraphBindingStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedFloorGraphBinding {
  source: "project";
  kind: FloorGraphBindingKind;
  graphId: string;
  graphVersionId: string;
  document: NodeGraphDocument;
}

export type ProjectFloorGraphBindingServiceErrorCode =
  | "floor_graph_binding_not_found"
  | "floor_graph_binding_graph_not_found"
  | "floor_graph_binding_version_not_found"
  | "floor_graph_binding_invalid_kind"
  | "floor_graph_binding_invalid_document"
  | "floor_graph_binding_graph_archived";

export class ProjectFloorGraphBindingServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    public readonly code: ProjectFloorGraphBindingServiceErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ProjectFloorGraphBindingServiceError";
  }
}

type ServiceDb = AppDb | DbExecutor;

type BindingJoinedRow = {
  binding: typeof projectFloorGraphBindings.$inferSelect;
  definition: typeof nodeGraphDefinitions.$inferSelect;
  version: typeof nodeGraphVersions.$inferSelect;
};

type BindingGraphVersion = {
  definition: typeof nodeGraphDefinitions.$inferSelect;
  version: typeof nodeGraphVersions.$inferSelect;
  document: NodeGraphDocument;
};

export class ProjectFloorGraphBindingService {
  private readonly accessService: ProjectAccessService;

  constructor(private readonly db: ServiceDb) {
    this.accessService = new ProjectAccessService(db);
  }

  listActive(input: { actor: ProjectActorInput; projectId: string }): ProjectFloorGraphBindingRecord[] {
    const access = this.accessService.requireProjectActionForActor(input.actor, input.projectId, "project.config.read");
    return this.loadActiveRows(access.project.accountId, access.project.id).map(bindingJoinedRowToRecord);
  }

  getActive(input: {
    actor: ProjectActorInput;
    projectId: string;
    kind: FloorGraphBindingKind | string;
  }): ProjectFloorGraphBindingRecord | null {
    const access = this.accessService.requireProjectActionForActor(input.actor, input.projectId, "project.config.read");
    const kind = assertFloorGraphBindingKind(input.kind);
    const row = this.loadActiveRow(access.project.accountId, access.project.id, kind);
    return row ? bindingJoinedRowToRecord(row) : null;
  }

  setActive(input: {
    actor: ProjectActorInput;
    projectId: string;
    kind: FloorGraphBindingKind | string;
    graphId: string;
    graphVersionId: string;
    requestId?: string | null;
    now?: number;
  }): ProjectFloorGraphBindingRecord {
    const access = this.accessService.requireProjectActionForActor(input.actor, input.projectId, "project.config.write");
    const kind = assertFloorGraphBindingKind(input.kind);
    const now = input.now ?? Date.now();
    const graph = this.loadGraphVersion({
      accountId: access.project.accountId,
      workspaceId: access.project.workspaceId,
      projectId: access.project.id,
      graphId: input.graphId,
      graphVersionId: input.graphVersionId,
    });
    assertBindableFloorGraphDocument(graph.document, kind);

    const result = this.db.transaction((tx) => {
      const existing = loadActiveRow(tx, access.project.accountId, access.project.id, kind);
      if (existing) {
        tx
          .update(projectFloorGraphBindings)
          .set({ status: "archived", updatedAt: now })
          .where(eq(projectFloorGraphBindings.id, existing.binding.id))
          .run();
      }

      const bindingId = `pfgb_${nanoid(16)}`;
      const inserted = tx
        .insert(projectFloorGraphBindings)
        .values({
          id: bindingId,
          accountId: access.project.accountId,
          workspaceId: access.project.workspaceId,
          projectId: access.project.id,
          kind,
          graphId: graph.definition.id,
          graphVersionId: graph.version.id,
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

      new OperationLogService(tx).append({
        accountId: access.project.accountId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorAccountId,
        actorAccountId: input.actor.actorAccountId,
        actorClientId: input.actor.actorClientId ?? null,
        requestId: input.requestId,
        sourceType: "api",
        action: GOVERNANCE_OPERATION_ACTIONS.floorGraphBinding.setActive,
        status: "succeeded",
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        targetType: "floor_graph_binding",
        targetId: inserted.id,
        beforeRef: existing
          ? {
              bindingId: existing.binding.id,
              kind: existing.binding.kind,
              graphId: existing.binding.graphId,
              graphVersionId: existing.binding.graphVersionId,
            }
          : null,
        afterRef: {
          bindingId: inserted.id,
          kind,
          graphId: graph.definition.id,
          graphVersionId: graph.version.id,
        },
        metadata: {
          kind,
          graph_name: graph.definition.name,
          graph_version_no: graph.version.versionNo,
        },
        createdAt: now,
      });

      return { binding: inserted, definition: graph.definition, version: graph.version } satisfies BindingJoinedRow;
    });

    return bindingJoinedRowToRecord(result);
  }

  clearActive(input: {
    actor: ProjectActorInput;
    projectId: string;
    kind: FloorGraphBindingKind | string;
    requestId?: string | null;
    now?: number;
  }): { cleared: boolean; previous: ProjectFloorGraphBindingRecord | null } {
    const access = this.accessService.requireProjectActionForActor(input.actor, input.projectId, "project.config.write");
    const kind = assertFloorGraphBindingKind(input.kind);
    const now = input.now ?? Date.now();

    const result = this.db.transaction((tx) => {
      const existing = loadActiveRow(tx, access.project.accountId, access.project.id, kind);
      if (!existing) {
        return { cleared: false, previous: null };
      }

      tx
        .update(projectFloorGraphBindings)
        .set({ status: "archived", updatedAt: now })
        .where(eq(projectFloorGraphBindings.id, existing.binding.id))
        .run();

      new OperationLogService(tx).append({
        accountId: access.project.accountId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorAccountId,
        actorAccountId: input.actor.actorAccountId,
        actorClientId: input.actor.actorClientId ?? null,
        requestId: input.requestId,
        sourceType: "api",
        action: GOVERNANCE_OPERATION_ACTIONS.floorGraphBinding.clearActive,
        status: "succeeded",
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        targetType: "floor_graph_binding",
        targetId: existing.binding.id,
        beforeRef: {
          bindingId: existing.binding.id,
          kind: existing.binding.kind,
          graphId: existing.binding.graphId,
          graphVersionId: existing.binding.graphVersionId,
        },
        afterRef: { cleared: true },
        metadata: {
          kind,
          graph_name: existing.definition.name,
          graph_version_no: existing.version.versionNo,
        },
        createdAt: now,
      });

      return { cleared: true, previous: bindingJoinedRowToRecord(existing) };
    });

    return result;
  }

  resolveForSession(input: {
    sessionId: string;
    accountId: string;
    promptMode?: PromptMode | null;
  }): ResolvedFloorGraphBinding | null {
    const session = this.db
      .select({
        id: sessions.id,
        accountId: sessions.accountId,
        projectId: sessions.projectId,
        promptMode: sessions.promptMode,
      })
      .from(sessions)
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.accountId, input.accountId)))
      .limit(1)
      .get();

    if (!session?.projectId) {
      return null;
    }

    const project = this.db
      .select({ id: projects.id, accountId: projects.accountId, workspaceId: projects.workspaceId })
      .from(projects)
      .where(and(eq(projects.id, session.projectId), eq(projects.accountId, input.accountId)))
      .limit(1)
      .get();
    if (!project) {
      return null;
    }

    const kind = floorGraphBindingKindForPromptMode(input.promptMode ?? session.promptMode ?? null);
    const active = this.loadActiveRow(project.accountId, project.id, kind);
    if (!active) {
      return null;
    }

    const document = parseNodeGraphDocument(active.version.documentJson);
    assertBindableFloorGraphDocument(document, kind);

    return {
      source: "project",
      kind,
      graphId: active.binding.graphId,
      graphVersionId: active.binding.graphVersionId,
      document,
    };
  }

  private loadActiveRows(accountId: string, projectId: string): BindingJoinedRow[] {
    return this.db
      .select({
        binding: projectFloorGraphBindings,
        definition: nodeGraphDefinitions,
        version: nodeGraphVersions,
      })
      .from(projectFloorGraphBindings)
      .innerJoin(nodeGraphDefinitions, eq(projectFloorGraphBindings.graphId, nodeGraphDefinitions.id))
      .innerJoin(nodeGraphVersions, eq(projectFloorGraphBindings.graphVersionId, nodeGraphVersions.id))
      .where(and(
        eq(projectFloorGraphBindings.accountId, accountId),
        eq(projectFloorGraphBindings.projectId, projectId),
        eq(projectFloorGraphBindings.status, "active"),
      ))
      .orderBy(desc(projectFloorGraphBindings.updatedAt))
      .all();
  }

  private loadActiveRow(accountId: string, projectId: string, kind: FloorGraphBindingKind): BindingJoinedRow | null {
    return loadActiveRow(this.db, accountId, projectId, kind);
  }

  private loadGraphVersion(input: {
    accountId: string;
    workspaceId: string;
    projectId: string;
    graphId: string;
    graphVersionId: string;
  }): BindingGraphVersion {
    const definition = this.db
      .select()
      .from(nodeGraphDefinitions)
      .where(and(
        eq(nodeGraphDefinitions.id, input.graphId),
        eq(nodeGraphDefinitions.accountId, input.accountId),
      ))
      .limit(1)
      .get();

    if (!definition) {
      throw new ProjectFloorGraphBindingServiceError(
        404,
        "floor_graph_binding_graph_not_found",
        `Floor graph binding target graph not found: ${input.graphId}`,
      );
    }
    if (definition.workspaceId !== input.workspaceId || definition.projectId !== input.projectId) {
      throw new ProjectFloorGraphBindingServiceError(
        409,
        "floor_graph_binding_graph_not_found",
        `Floor graph binding target graph belongs to another project: ${input.graphId}`,
      );
    }
    if (definition.status === "archived") {
      throw new ProjectFloorGraphBindingServiceError(
        409,
        "floor_graph_binding_graph_archived",
        `Floor graph binding target graph is archived: ${input.graphId}`,
      );
    }

    const version = this.db
      .select()
      .from(nodeGraphVersions)
      .where(and(
        eq(nodeGraphVersions.id, input.graphVersionId),
        eq(nodeGraphVersions.graphId, definition.id),
      ))
      .limit(1)
      .get();
    if (!version) {
      throw new ProjectFloorGraphBindingServiceError(
        404,
        "floor_graph_binding_version_not_found",
        `Floor graph binding target graph version not found: ${input.graphVersionId}`,
      );
    }

    return { definition, version, document: parseNodeGraphDocument(version.documentJson) };
  }
}

export function assertFloorGraphBindingKind(value: string): FloorGraphBindingKind {
  const trimmed = value.trim();
  if (trimmed === "native" || trimmed === "compat") {
    return trimmed;
  }
  throw new ProjectFloorGraphBindingServiceError(
    400,
    "floor_graph_binding_invalid_kind",
    `Invalid floor graph binding kind: ${value}`,
  );
}

export function floorGraphBindingKindForPromptMode(promptMode: PromptMode | null | undefined): FloorGraphBindingKind {
  return promptMode === "native" ? "native" : "compat";
}

export function assertBindableFloorGraphDocument(
  document: NodeGraphDocument,
  kind: FloorGraphBindingKind,
): void {
  const compiled = compileNodeGraph(document);
  if (!compiled.isExecutable) {
    throw new ProjectFloorGraphBindingServiceError(
      400,
      "floor_graph_binding_invalid_document",
      "Floor graph binding target document is not executable.",
      { diagnostics: compiled.diagnostics },
    );
  }

  const narratorCount = document.nodes.filter((node) => node.type === "narration.narrator").length;
  if (narratorCount !== 1) {
    throw new ProjectFloorGraphBindingServiceError(
      400,
      "floor_graph_binding_invalid_document",
      "Floor graph binding target document must contain exactly one narration.narrator node.",
      { narratorCount },
    );
  }

  if (kind === "compat") {
    const forbiddenNode = document.nodes.find((node) => node.type.startsWith("agent.") || node.type.startsWith("verify."));
    if (forbiddenNode) {
      throw new ProjectFloorGraphBindingServiceError(
        400,
        "floor_graph_binding_invalid_document",
        "Compat floor graph binding cannot include agent or verify nodes.",
        { nodeId: forbiddenNode.id, nodeType: forbiddenNode.type },
      );
    }
    const requiredPermissions = document.permissions?.required ?? [];
    if (requiredPermissions.length > 0) {
      throw new ProjectFloorGraphBindingServiceError(
        400,
        "floor_graph_binding_invalid_document",
        "Compat floor graph binding cannot require permissions.",
        { requiredPermissions },
      );
    }
  }
}

function loadActiveRow(
  db: ServiceDb,
  accountId: string,
  projectId: string,
  kind: FloorGraphBindingKind,
): BindingJoinedRow | null {
  const row = db
    .select({
      binding: projectFloorGraphBindings,
      definition: nodeGraphDefinitions,
      version: nodeGraphVersions,
    })
    .from(projectFloorGraphBindings)
    .innerJoin(nodeGraphDefinitions, eq(projectFloorGraphBindings.graphId, nodeGraphDefinitions.id))
    .innerJoin(nodeGraphVersions, eq(projectFloorGraphBindings.graphVersionId, nodeGraphVersions.id))
    .where(and(
      eq(projectFloorGraphBindings.accountId, accountId),
      eq(projectFloorGraphBindings.projectId, projectId),
      eq(projectFloorGraphBindings.kind, kind),
      eq(projectFloorGraphBindings.status, "active"),
    ))
    .limit(1)
    .get();
  return row ?? null;
}

function bindingJoinedRowToRecord(row: BindingJoinedRow): ProjectFloorGraphBindingRecord {
  return {
    id: row.binding.id,
    accountId: row.binding.accountId,
    workspaceId: row.binding.workspaceId,
    projectId: row.binding.projectId,
    kind: row.binding.kind,
    graphId: row.binding.graphId,
    graphVersionId: row.binding.graphVersionId,
    graphName: row.definition.name,
    graphVersionNo: row.version.versionNo,
    status: row.binding.status,
    createdAt: row.binding.createdAt,
    updatedAt: row.binding.updatedAt,
  };
}

function parseNodeGraphDocument(raw: string): NodeGraphDocument {
  return JSON.parse(raw) as NodeGraphDocument;
}
