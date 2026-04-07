import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { SimpleTokenCounter } from "@tavern/core";
import { buildBranchVariableScopeId } from "@tavern/shared";

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
import { VariableService } from "./variable-service.js";
import { MEMORY_RUNTIME_SCOPE_TYPE, buildMemoryRuntimeScopeKey } from "./memory-runtime-job-definitions.js";
import type {
  ChatImportManifest,
  StJsonlImportManifest,
  ThChatImportManifest,
} from "./chat-import-manifest.js";

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
    const variableService = new VariableService(tx);
    variableService.restoreMany({
      accountId: manifest.accountId,
      items: data.variables.map((variable) => ({
        scope: variable.scope,
        scopeId: resolveThChatImportScopeId({
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

  if (data.memories) {
    for (const item of data.memories.items) {
      const itemId = manifest.idMap[item._original_id]!;
      const scopeId = resolveThChatImportScopeId({
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

function resolveThChatImportScopeId(input: {
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

function buildImportedMemoryScopeStateRows(input: {
  accountId: string;
  data: ThChatImportManifest["file"]["data"];
  idMap: Record<string, string>;
  now: number;
  sessionId: string;
}): Array<typeof runtimeScopeStates.$inferInsert> {
  const scopeMeta = new Map<string, { revision: number; hasMacroSummary: boolean }>();
  const scopeRows = new Map<string, typeof runtimeScopeStates.$inferInsert>();
  const makeScopeKey = (scope: "global" | "chat" | "floor", scopeId: string) => JSON.stringify([scope, scopeId]);

  const chatLastProcessedFloorNo = input.data.floors.reduce<number | null>(
    (maxFloorNo, floor) => (maxFloorNo === null ? floor.floor_no : Math.max(maxFloorNo, floor.floor_no)),
    null,
  );

  for (const item of input.data.memories?.items ?? []) {
    const scopeId = resolveThChatImportScopeId({
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

  for (const [key, meta] of scopeMeta.entries()) {
    if (scopeRows.has(key)) {
      continue;
    }

    const [scope, scopeId] = JSON.parse(key) as ["global" | "chat" | "floor", string];
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
        lastProcessedFloorNo: scope === "chat" ? chatLastProcessedFloorNo : null,
        lastCompactionAt: meta.hasMacroSummary ? input.now : null,
      }),
      updatedAt: input.now,
    });
  }

  return [...scopeRows.values()];
}
