import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { SimpleTokenCounter } from "@tavern/core";
import {
  buildBranchMemoryScopeId,
  buildBranchVariableScopeId,
} from "@tavern/shared";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  chatTransferJobs,
  floors,
  memoryEdges,
  memoryItems,
  messagePages,
  messages,
  runtimeScopeStates,
  sessions,
} from "../db/schema.js";
import { stringifyJsonField } from "../lib/http.js";
import { executeWithSqliteBusyRetry } from "../lib/retry.js";
import { VariableService } from "./variables/variable-service.js";
import { SessionBranchRegistryService } from "./variables/host/session-branch-registry-service.js";
import { MEMORY_RUNTIME_SCOPE_TYPE, buildMemoryRuntimeScopeKey } from "./memory-runtime-job-definitions.js";
import type {
  ChatImportManifest,
  StJsonlImportManifest,
  ThChatImportManifest,
} from "./chat-import-manifest.js";
import {
  BRANCH_LOCAL_SNAPSHOT_SCHEMA_V1,
  BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2,
  BranchLocalVariableSnapshotService,
  type BranchLocalSnapshotSchemaVersion,
  type BranchLocalVariableProvenance,
  type BranchLocalVariableProvenanceMap,
} from "./branch-local-variable-snapshot-service.js";
import type {
  ThChatBranchLocalVariableProvenance,
  ThChatBranchLocalVariableSnapshot,
} from "@tavern/shared";

export interface PublishChatImportManifestOptions {
  manifest: ChatImportManifest;
  completedAt: number;
  jobContext?: {
    jobId: string;
    leaseOwner: string;
    normalizedArtifactPath?: string | null;
  };
}

export interface ChatImportPublishResult {
  sessionId: string;
  title: string;
  floorCount: number;
  messageCount: number;
  swipeCount?: number;
  skippedLines: number;
  importSource: "thchat" | "sillytavern_jsonl";
  format: "thchat" | "sillytavern_jsonl";
  pageCount?: number;
  variableCount?: number;
  memoryItemCount?: number;
  memoryEdgeCount?: number;
}

export async function publishChatImportManifest(
  db: AppDb,
  options: PublishChatImportManifestOptions,
): Promise<ChatImportPublishResult> {
  return await executeWithSqliteBusyRetry(() => db.transaction((tx) => {
    const result = publishChatImportManifestInTransaction(tx, options.manifest);

    if (options.jobContext) {
      const updateResult = tx.update(chatTransferJobs)
        .set({
          status: "succeeded",
          phase: "completed",
          format: options.manifest.format,
          normalizedArtifactPath: options.jobContext.normalizedArtifactPath ?? null,
          resultSessionId: result.sessionId,
          resultJson: JSON.stringify(result),
          progressCurrent: 4,
          progressTotal: 4,
          progressMessage: "completed",
          leaseOwner: null,
          leaseUntil: null,
          lastError: null,
          finishedAt: options.completedAt,
          updatedAt: options.completedAt,
        })
        .where(and(
          eq(chatTransferJobs.id, options.jobContext.jobId),
          eq(chatTransferJobs.status, "running"),
          eq(chatTransferJobs.leaseOwner, options.jobContext.leaseOwner),
        ))
        .run();

      if (updateResult.changes !== 1) {
        throw new Error(`Chat transfer job lease lost: ${options.jobContext.jobId}`);
      }
    }

    return result;
  }));
}

export function publishChatImportManifestInTransaction(
  tx: DbExecutor,
  manifest: ChatImportManifest,
): ChatImportPublishResult {
  return manifest.format === "thchat"
    ? publishThChatManifest(tx, manifest)
    : publishStJsonlManifest(tx, manifest);
}

function publishStJsonlManifest(
  tx: DbExecutor,
  manifest: StJsonlImportManifest,
): ChatImportPublishResult {
  const sessionId = nanoid();
  const tokenCounter = new SimpleTokenCounter();

  tx.insert(sessions).values({
    id: sessionId,
    title: manifest.title,
    status: "active",
    accountId: manifest.accountId,
    characterId: manifest.characterBinding.characterId,
    characterVersionId: manifest.characterBinding.characterVersionId,
    characterSnapshotJson: manifest.characterBinding.characterSnapshotJson,
    characterSyncPolicy: "pin",
    presetId: null,
    regexProfileId: null,
    worldbookProfileId: null,
    modelProvider: null,
    modelName: null,
    modelParamsJson: null,
    metadataJson: stringifyJsonField({
      st_chat_metadata: manifest.header.chat_metadata ?? {},
      import_source: "sillytavern_jsonl",
      imported_at: manifest.importedAt,
    }),
    createdAt: manifest.importedAt,
    updatedAt: manifest.importedAt,
  }).run();

  new SessionBranchRegistryService(tx).ensure({
    accountId: manifest.accountId,
    sessionId,
    branchId: "main",
    createdAt: manifest.importedAt,
    updatedAt: manifest.importedAt,
  });

  for (const group of manifest.floorGroups) {
    const floorId = nanoid();
    let floorTokenIn = 0;
    let floorTokenOut = 0;

    tx.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: group.floorNo,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      metadataJson: null,
      tokenIn: 0,
      tokenOut: 0,
      createdAt: manifest.importedAt,
      updatedAt: manifest.importedAt,
    }).run();

    new SessionBranchRegistryService(tx).ensure({
      accountId: manifest.accountId,
      sessionId,
      branchId: "main",
      createdAt: manifest.importedAt,
      updatedAt: manifest.importedAt,
    });

    for (const message of group.messages) {
      if (message.swipes && message.swipes.length > 1) {
        const activeIndex = message.swipeId ?? 0;
        for (let index = 0; index < message.swipes.length; index += 1) {
          const pageId = nanoid();
          const isActive = index === activeIndex;
          const content = message.swipes[index]!;
          const tokens = tokenCounter.count(content);

          tx.insert(messagePages).values({
            id: pageId,
            floorId,
            pageNo: message.pageNo,
            pageKind: message.pageKind,
            isActive,
            version: index + 1,
            checksum: null,
            createdAt: manifest.importedAt,
            updatedAt: manifest.importedAt,
          }).run();

          tx.insert(messages).values({
            id: nanoid(),
            pageId,
            seq: 0,
            role: message.role,
            content,
            contentFormat: "text",
            tokenCount: tokens,
            isHidden: message.isHidden,
            source: `st_import:${message.name}`,
            createdAt: message.sendDate,
          }).run();

          if (isActive) {
            if (message.role === "user") {
              floorTokenIn += tokens;
            } else {
              floorTokenOut += tokens;
            }
          }
        }
        continue;
      }

      const pageId = nanoid();
      const tokens = tokenCounter.count(message.content);

      tx.insert(messagePages).values({
        id: pageId,
        floorId,
        pageNo: message.pageNo,
        pageKind: message.pageKind,
        isActive: true,
        version: 1,
        checksum: null,
        createdAt: manifest.importedAt,
        updatedAt: manifest.importedAt,
      }).run();

      tx.insert(messages).values({
        id: nanoid(),
        pageId,
        seq: 0,
        role: message.role,
        content: message.content,
        contentFormat: "text",
        tokenCount: tokens,
        isHidden: message.isHidden,
        source: `st_import:${message.name}`,
        createdAt: message.sendDate,
      }).run();

      if (message.role === "user") {
        floorTokenIn += tokens;
      } else {
        floorTokenOut += tokens;
      }
    }

    tx.update(floors).set({
      tokenIn: floorTokenIn,
      tokenOut: floorTokenOut,
    }).where(eq(floors.id, floorId)).run();
  }

  return {
    sessionId,
    title: manifest.title,
    floorCount: manifest.stats.floorCount,
    messageCount: manifest.stats.messageCount,
    swipeCount: manifest.stats.swipeCount,
    skippedLines: manifest.stats.skippedLines,
    importSource: manifest.stats.importSource,
    format: manifest.stats.format,
  };
}

function publishThChatManifest(
  tx: DbExecutor,
  manifest: ThChatImportManifest,
): ChatImportPublishResult {
  const sessionId = nanoid();
  const file = manifest.file;
  const data = file.data;

  const metadata = (data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata))
    ? data.metadata as Record<string, unknown>
    : {};

  tx.insert(sessions).values({
    id: sessionId,
    title: manifest.title,
    status: "active",
    accountId: manifest.accountId,
    characterId: manifest.characterBinding.characterId,
    characterVersionId: manifest.characterBinding.characterVersionId,
    characterSnapshotJson: manifest.characterBinding.characterId
      ? manifest.characterBinding.characterSnapshotJson
      : data.character_snapshot ? stringifyJsonField(data.character_snapshot) : null,
    userSnapshotJson: data.user_snapshot ? stringifyJsonField(data.user_snapshot) : null,
    characterSyncPolicy: manifest.characterBinding.characterId
      ? "pin"
      : data.character_sync_policy,
    presetId: null,
    regexProfileId: null,
    worldbookProfileId: null,
    promptMode: data.prompt_mode ?? null,
    modelProvider: data.model_provider ?? null,
    modelName: data.model_name ?? null,
    modelParamsJson: null,
    metadataJson: stringifyJsonField({
      ...metadata,
      import_source: "thchat",
      imported_at: manifest.importedAt,
    }),
    createdAt: manifest.importedAt,
    updatedAt: manifest.importedAt,
  }).run();

  new SessionBranchRegistryService(tx).ensure({
    accountId: manifest.accountId,
    sessionId,
    branchId: "main",
    createdAt: manifest.importedAt,
    updatedAt: manifest.importedAt,
  });

  for (const floor of data.floors) {
    const floorId = manifest.idMap[floor._original_id]!;
    const parentFloorId = floor.parent_floor_id_ref
      ? manifest.idMap[floor.parent_floor_id_ref] ?? null
      : null;

    tx.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: floor.floor_no,
      branchId: floor.branch_id,
      parentFloorId,
      state: floor.state,
      metadataJson: floor.metadata != null ? stringifyJsonField(floor.metadata) : null,
      tokenIn: floor.token_in,
      tokenOut: floor.token_out,
      createdAt: floor.created_at,
      updatedAt: floor.updated_at,
    }).run();

    new SessionBranchRegistryService(tx).ensure({
      accountId: manifest.accountId,
      sessionId,
      branchId: floor.branch_id,
      createdAt: floor.created_at,
      updatedAt: floor.updated_at,
      sourceFloorId: parentFloorId,
    });

    for (const page of floor.pages) {
      const pageId = manifest.idMap[page._original_id]!;

      tx.insert(messagePages).values({
        id: pageId,
        floorId,
        pageNo: page.page_no,
        pageKind: page.page_kind,
        isActive: page.is_active,
        version: page.version,
        checksum: page.checksum,
        createdAt: page.created_at,
        updatedAt: page.updated_at,
      }).run();

      for (const message of page.messages) {
        const messageId = manifest.idMap[message._original_id]!;

        tx.insert(messages).values({
          id: messageId,
          pageId,
          seq: message.seq,
          role: message.role,
          content: message.content,
          contentFormat: message.content_format,
          tokenCount: message.token_count,
          isHidden: message.is_hidden,
          source: message.source,
          createdAt: message.created_at,
        }).run();
      }
    }
  }

  if (data.variables && data.variables.length > 0) {
    // Phase 3 起，imported chat 格式可以额外携带 per-floor
    // branch_local_variable_snapshot（见下方 `data.branch_local_variable_snapshots`）。
    // 这里仍然只恢复持久化 variable 行；若导出文件包含 snapshot section，
    // 后续会按 floor 精确恢复 runtime local truth。
    // 旧文件（1.0.x）未带 snapshot section 时，行为与此前一致，
    // 即后续分支继承可能触发 branch_local_snapshot_missing。
    const variableService = new VariableService(tx);
    variableService.restoreMany({
      accountId: manifest.accountId,
      items: data.variables.map((variable) => ({
        scope: variable.scope,
        scopeId: resolveThChatImportVariableScopeId({
          scope: variable.scope,
          scopeIdRef: variable.scope_id_ref,
          sessionId,
          idMap: manifest.idMap,
        }),
        key: variable.key,
        value: variable.value,
        updatedAt: variable.updated_at,
      })),
    });
  }

  // Phase 3: 如果导出文件带了 branch_local_variable_snapshots，优先按 floor 精确
  // 恢复 snapshot，保留 provenance；否则保持旧行为（缺省语义 =
  // branch_local_snapshot_missing）。
  if (data.branch_local_variable_snapshots && data.branch_local_variable_snapshots.length > 0) {
    const snapshotService = new BranchLocalVariableSnapshotService(tx);
    for (const snapshotRow of data.branch_local_variable_snapshots) {
      const targetFloorId = manifest.idMap[snapshotRow.floor_id_ref];
      if (!targetFloorId) {
        // 对不上 floor 的 snapshot 直接跳过：依旧走旧缺省语义，避免写脏数据
        continue;
      }

      const schemaVersion: BranchLocalSnapshotSchemaVersion =
        snapshotRow.snapshot_version === BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2
          ? BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2
          : BRANCH_LOCAL_SNAPSHOT_SCHEMA_V1;

      const provenance = schemaVersion === BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2
        ? buildImportedProvenance({
            sessionId,
            branchId: snapshotRow.branch_id,
            provenance: snapshotRow.provenance ?? {},
            idMap: manifest.idMap,
          })
        : undefined;

      snapshotService.restoreSnapshot({
        accountId: manifest.accountId,
        floorId: targetFloorId,
        sessionId,
        branchId: snapshotRow.branch_id,
        createdAt: snapshotRow.created_at,
        values: snapshotRow.values,
        schemaVersion,
        provenance,
      });
    }
  }

  if (data.memories) {
    for (const item of data.memories.items) {
      const itemId = manifest.idMap[item._original_id]!;
      const scopeId = resolveThChatImportMemoryScopeId({
        scope: item.scope,
        scopeIdRef: item.scope_id_ref,
        sessionId,
        idMap: manifest.idMap,
      });

      tx.insert(memoryItems).values({
        id: itemId,
        scope: item.scope,
        scopeId,
        type: item.type,
        summaryTier: item.type === "summary" ? (item.summary_tier ?? null) : null,
        contentJson: JSON.stringify(item.content),
        importance: item.importance,
        confidence: item.confidence,
        sourceFloorId: item.source_floor_id_ref ? manifest.idMap[item.source_floor_id_ref] ?? null : null,
        sourceMessageId: item.source_message_id_ref ? manifest.idMap[item.source_message_id_ref] ?? null : null,
        accountId: manifest.accountId,
        status: item.status,
        lifecycleStatus: item.lifecycle_status ?? (item.status === "deprecated" ? "deprecated" : "active"),
        sourceJobId: item.source_job_id ?? null,
        tokenCountEstimate: item.token_count_estimate ?? null,
        lastUsedAt: item.last_used_at ?? null,
        coverageStartFloorNo: item.type === "summary" ? (item.coverage_start_floor_no ?? null) : null,
        coverageEndFloorNo: item.type === "summary" ? (item.coverage_end_floor_no ?? null) : null,
        derivedFromCount: item.type === "summary" ? (item.derived_from_count ?? null) : null,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }).run();
    }

    for (const edge of data.memories.edges) {
      const fromId = manifest.idMap[edge.from_id_ref];
      const toId = manifest.idMap[edge.to_id_ref];
      if (!fromId || !toId) {
        continue;
      }

      tx.insert(memoryEdges).values({
        id: nanoid(),
        fromId,
        toId,
        relation: edge.relation,
        accountId: manifest.accountId,
        createdAt: edge.created_at,
      }).run();
    }
  }

  const scopeStateRows = buildImportedMemoryScopeStateRows({
    accountId: manifest.accountId,
    data,
    idMap: manifest.idMap,
    now: manifest.importedAt,
    sessionId,
  });
  if (scopeStateRows.length > 0) {
    tx.insert(runtimeScopeStates).values(scopeStateRows).run();
  }

  return {
    sessionId,
    title: manifest.title,
    floorCount: manifest.stats.floorCount,
    pageCount: manifest.stats.pageCount,
    messageCount: manifest.stats.messageCount,
    variableCount: manifest.stats.variableCount,
    memoryItemCount: manifest.stats.memoryItemCount,
    memoryEdgeCount: manifest.stats.memoryEdgeCount,
    skippedLines: manifest.stats.skippedLines,
    importSource: manifest.stats.importSource,
    format: manifest.stats.format,
  };
}

function resolveThChatImportVariableScopeId(input: {
  scope: "chat" | "floor" | "branch" | "page";
  scopeIdRef: string | null;
  sessionId: string;
  idMap: Record<string, string>;
}): string {
  if (input.scope === "chat") {
    return input.sessionId;
  }

  if (input.scope === "branch") {
    return buildBranchVariableScopeId(input.sessionId, input.scopeIdRef ?? "main");
  }

  if (!input.scopeIdRef) {
    return input.sessionId;
  }

  return input.idMap[input.scopeIdRef] ?? input.scopeIdRef;
}

function resolveThChatImportMemoryScopeId(input: {
  scope: "chat" | "floor" | "branch" | "page";
  scopeIdRef: string | null;
  sessionId: string;
  idMap: Record<string, string>;
}): string {
  if (input.scope === "chat") {
    return input.sessionId;
  }

  if (input.scope === "branch") {
    return buildBranchMemoryScopeId(input.sessionId, input.scopeIdRef ?? "main");
  }

  if (!input.scopeIdRef) {
    return input.sessionId;
  }

  return input.idMap[input.scopeIdRef] ?? input.scopeIdRef;
}
function buildImportedProvenance(input: {
  sessionId: string;
  branchId: string;
  provenance: Record<string, ThChatBranchLocalVariableProvenance>;
  idMap: Record<string, string>;
}): BranchLocalVariableProvenanceMap {
  const result: BranchLocalVariableProvenanceMap = {};
  for (const [key, entry] of Object.entries(input.provenance)) {
    result[key] = translateProvenanceEntry(entry, {
      sessionId: input.sessionId,
      branchId: input.branchId,
      idMap: input.idMap,
    });
  }
  return result;
}

function translateProvenanceEntry(
  entry: ThChatBranchLocalVariableProvenance,
  ctx: { sessionId: string; branchId: string; idMap: Record<string, string> },
): BranchLocalVariableProvenance {
  const sourceScope = entry.source_scope;
  const sourceScopeId = decodeProvenanceScopeIdRef({
    sourceScope,
    scopeIdRef: entry.source_scope_id_ref ?? null,
    sessionId: ctx.sessionId,
    branchId: ctx.branchId,
    idMap: ctx.idMap,
  });

  const inheritedFromFloorId = entry.inherited_from_floor_id_ref
    ? ctx.idMap[entry.inherited_from_floor_id_ref] ?? entry.inherited_from_floor_id_ref
    : undefined;

  return {
    sourceScope,
    sourceScopeId,
    ...(entry.source_variable_id ? { sourceVariableId: entry.source_variable_id } : {}),
    ...(typeof entry.source_updated_at === "number" ? { sourceUpdatedAt: entry.source_updated_at } : {}),
    ...(inheritedFromFloorId ? { inheritedFromFloorId } : {}),
    ...(entry.inherited_from_branch_id ? { inheritedFromBranchId: entry.inherited_from_branch_id } : {}),
    originKind: entry.origin_kind,
  };
}

function decodeProvenanceScopeIdRef(input: {
  sourceScope: ThChatBranchLocalVariableProvenance["source_scope"];
  scopeIdRef: string | null;
  sessionId: string;
  branchId: string;
  idMap: Record<string, string>;
}): string {
  if (input.sourceScope === "chat") {
    // chat 层 ref 为 null 意味着对应当前 session
    return input.scopeIdRef ?? input.sessionId;
  }

  if (input.sourceScope === "branch") {
    // branch 层的 ref 为 branch_id（导出时做了规范化），
    // 如果缺省就归到当前 branchId
    return buildBranchVariableScopeId(input.sessionId, input.scopeIdRef ?? input.branchId);
  }

  if (input.sourceScope === "global") {
    return input.scopeIdRef ?? "global";
  }

  // floor / page：用 idMap 翻译回导入后的新 id，翻不到就原值
  if (!input.scopeIdRef) {
    return input.sessionId;
  }
  return input.idMap[input.scopeIdRef] ?? input.scopeIdRef;
}



function buildImportedMemoryScopeStateRows(input: {
  accountId: string;
  data: ThChatImportManifest["file"]["data"];
  idMap: Record<string, string>;
  now: number;
  sessionId: string;
}): Array<typeof runtimeScopeStates.$inferInsert> {
  const scopeMeta = new Map<string, { revision: number; hasMacroSummary: boolean }>();
  const scopeRows = new Map<string, typeof runtimeScopeStates.$inferInsert>();
  const makeScopeKey = (scope: "global" | "chat" | "branch" | "floor", scopeId: string) => JSON.stringify([scope, scopeId]);
  const branchLastProcessedFloorNo = new Map<string, number>();

  const chatLastProcessedFloorNo = input.data.floors.reduce<number | null>(
    (maxFloorNo, floor) => (maxFloorNo === null ? floor.floor_no : Math.max(maxFloorNo, floor.floor_no)),
    null,
  );

  for (const floor of input.data.floors) {
    const scopeId = buildBranchMemoryScopeId(input.sessionId, floor.branch_id);
    const key = makeScopeKey("branch", scopeId);
    const currentFloorNo = branchLastProcessedFloorNo.get(key);
    branchLastProcessedFloorNo.set(key, currentFloorNo === undefined ? floor.floor_no : Math.max(currentFloorNo, floor.floor_no));
  }

  for (const item of input.data.memories?.items ?? []) {
    const scopeId = resolveThChatImportMemoryScopeId({
      scope: item.scope,
      scopeIdRef: item.scope_id_ref,
      sessionId: input.sessionId,
      idMap: input.idMap,
    });
    const key = makeScopeKey(item.scope, scopeId);
    const current = scopeMeta.get(key) ?? { revision: 0, hasMacroSummary: false };
    current.revision = 1;
    if (item.type === "summary" && item.summary_tier === "macro" && item.status === "active") {
      current.hasMacroSummary = true;
    }
    scopeMeta.set(key, current);
  }

  const chatScopeKey = makeScopeKey("chat", input.sessionId);
  if (chatLastProcessedFloorNo !== null || scopeMeta.has(chatScopeKey)) {
    const meta = scopeMeta.get(chatScopeKey);
    scopeRows.set(chatScopeKey, {
      accountId: input.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey("chat", input.sessionId),
      revision: meta?.revision ?? 0,
      leaseOwner: null,
      leaseUntil: null,
      lastProcessedAt: input.now,
      lastSuccessJobId: null,
      metadataJson: JSON.stringify({
        lastProcessedFloorNo: chatLastProcessedFloorNo,
        lastCompactionAt: meta?.hasMacroSummary ? input.now : null,
      }),
      updatedAt: input.now,
    });
  }

  for (const floor of input.data.floors) {
    const scopeId = input.idMap[floor._original_id]!;
    const key = makeScopeKey("floor", scopeId);
    const meta = scopeMeta.get(key);
    scopeRows.set(key, {
      accountId: input.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey("floor", scopeId),
      revision: meta?.revision ?? 0,
      leaseOwner: null,
      leaseUntil: null,
      lastProcessedAt: input.now,
      lastSuccessJobId: null,
      metadataJson: JSON.stringify({
        lastProcessedFloorNo: floor.floor_no,
        lastCompactionAt: meta?.hasMacroSummary ? input.now : null,
      }),
      updatedAt: input.now,
    });
  }

  for (const [key, lastProcessedFloorNo] of branchLastProcessedFloorNo.entries()) {
    const [, scopeId] = JSON.parse(key) as ["branch", string];
    const meta = scopeMeta.get(key);
    scopeRows.set(key, {
      accountId: input.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey("branch", scopeId),
      revision: meta?.revision ?? 0,
      leaseOwner: null,
      leaseUntil: null,
      lastProcessedAt: input.now,
      lastSuccessJobId: null,
      metadataJson: JSON.stringify({
        lastProcessedFloorNo,
        lastCompactionAt: meta?.hasMacroSummary ? input.now : null,
      }),
      updatedAt: input.now,
    });
  }

  for (const [key, meta] of scopeMeta.entries()) {
    if (scopeRows.has(key)) {
      continue;
    }

    const [scope, scopeId] = JSON.parse(key) as ["global" | "chat" | "branch" | "floor", string];
    scopeRows.set(key, {
      accountId: input.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey(scope, scopeId),
      revision: meta.revision,
      leaseOwner: null,
      leaseUntil: null,
      lastProcessedAt: input.now,
      lastSuccessJobId: null,
      metadataJson: JSON.stringify({
        lastProcessedFloorNo: scope === "chat" ? chatLastProcessedFloorNo : branchLastProcessedFloorNo.get(key) ?? null,
        lastCompactionAt: meta.hasMacroSummary ? input.now : null,
      }),
      updatedAt: input.now,
    });
  }

  return [...scopeRows.values()];
}
