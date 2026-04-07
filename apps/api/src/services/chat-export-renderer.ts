import {
  TH_CHAT_SPEC,
  TH_CHAT_SPEC_VERSION,
  type ThChatFile,
  type ThChatFloor,
  type ThChatMemoryEdge,
  type ThChatMemoryItem,
  type ThChatMessage,
  type ThChatPage,
  type ThChatVariable,
} from "@tavern/shared";

import type { SessionExportSnapshot } from "./chat-export-snapshot.js";

export interface ChatExportRendererOptions {
  appVersion?: string;
}

export function suggestChatExportBasename(
  snapshot: SessionExportSnapshot,
  format: "thchat" | "st_jsonl",
): string {
  if (format === "st_jsonl") {
    const characterName = snapshot.characterSnapshot?.name;
    if (typeof characterName === "string" && characterName.trim().length > 0) {
      return characterName;
    }
    return snapshot.title ?? "export";
  }

  return snapshot.title ?? "export";
}

export function renderExportSnapshotToThChat(
  snapshot: SessionExportSnapshot,
  options?: ChatExportRendererOptions,
): ThChatFile {
  const exportFloors: ThChatFloor[] = snapshot.floors.map((floor) => ({
    floor_no: floor.floorNo,
    branch_id: floor.branchId,
    parent_floor_id_ref: floor.parentFloorId,
    state: floor.state,
    token_in: floor.tokenIn,
    token_out: floor.tokenOut,
    metadata: floor.metadata,
    superseded_at: floor.supersededAt,
    superseded_by_floor_id_ref: floor.supersededByFloorId,
    created_at: floor.createdAt,
    updated_at: floor.updatedAt,
    _original_id: floor.id,
    pages: floor.pages.map<ThChatPage>((page) => ({
      page_no: page.pageNo,
      page_kind: page.pageKind,
      is_active: page.isActive,
      version: page.version,
      checksum: page.checksum,
      created_at: page.createdAt,
      updated_at: page.updatedAt,
      _original_id: page.id,
      messages: page.messages.map<ThChatMessage>((message) => ({
        seq: message.seq,
        role: message.role,
        content: message.content,
        content_format: message.contentFormat,
        token_count: message.tokenCount,
        is_hidden: message.isHidden,
        source: message.source,
        created_at: message.createdAt,
        _original_id: message.id,
      })),
    })),
  }));

  const exportVariables: ThChatVariable[] | undefined = snapshot.variables?.map((row) => ({
    scope: row.scope,
    scope_id_ref: row.scope === "chat" && row.scopeId === snapshot.sessionId
      ? null
      : row.scope === "branch" ? row.scopeRef?.branchId ?? row.scopeId : row.scopeId,
    key: row.key,
    value: row.value,
    updated_at: row.updatedAt,
  }));

  const exportMemories = snapshot.memories
    ? {
        items: snapshot.memories.items.map<ThChatMemoryItem>((row) => ({
          _original_id: row.id,
          scope: row.scope,
          scope_id_ref: row.scope === "chat" && row.scopeId === snapshot.sessionId ? null : row.scopeId,
          type: row.type,
          summary_tier: row.summaryTier,
          content: row.content,
          importance: row.importance,
          confidence: row.confidence,
          source_floor_id_ref: row.sourceFloorId,
          source_message_id_ref: row.sourceMessageId,
          status: row.status,
          lifecycle_status: row.lifecycleStatus,
          source_job_id: row.sourceJobId,
          token_count_estimate: row.tokenCountEstimate,
          last_used_at: row.lastUsedAt,
          coverage_start_floor_no: row.coverageStartFloorNo,
          coverage_end_floor_no: row.coverageEndFloorNo,
          derived_from_count: row.derivedFromCount,
          created_at: row.createdAt,
          updated_at: row.updatedAt,
        })),
        edges: snapshot.memories.edges.map<ThChatMemoryEdge>((row) => ({
          from_id_ref: row.fromId,
          to_id_ref: row.toId,
          relation: row.relation,
          created_at: row.createdAt,
        })),
      }
    : undefined;

  return {
    spec: TH_CHAT_SPEC,
    spec_version: TH_CHAT_SPEC_VERSION,
    exported_at: Date.now(),
    export_source: "tavern_headless",
    export_app_version: options?.appVersion,
    data: {
      title: snapshot.title,
      status: snapshot.status,
      created_at: snapshot.createdAt,
      updated_at: snapshot.updatedAt,
      character_snapshot: snapshot.characterSnapshot,
      user_snapshot: snapshot.userSnapshot,
      character_sync_policy: snapshot.characterSyncPolicy,
      preset_name: snapshot.presetName,
      prompt_mode: snapshot.promptMode,
      model_provider: snapshot.modelProvider,
      model_name: snapshot.modelName,
      metadata: snapshot.metadata,
      floors: exportFloors,
      ...(exportVariables ? { variables: exportVariables } : {}),
      ...(exportMemories ? { memories: exportMemories } : {}),
    },
  };
}

export function renderExportSnapshotToStJsonl(snapshot: SessionExportSnapshot): string {
  return Array.from(iterExportSnapshotToStJsonlLines(snapshot)).join("\n");
}

export function *iterExportSnapshotToStJsonlLines(snapshot: SessionExportSnapshot): Iterable<string> {
  const userName = typeof snapshot.userSnapshot?.name === "string" && snapshot.userSnapshot.name.trim().length > 0
    ? snapshot.userSnapshot.name
    : "User";
  const characterName = typeof snapshot.characterSnapshot?.name === "string" && snapshot.characterSnapshot.name.trim().length > 0
    ? snapshot.characterSnapshot.name
    : snapshot.title ?? "Assistant";

  yield JSON.stringify({
    user_name: userName,
    character_name: characterName,
    chat_metadata: {
      th_export: true,
      th_session_title: snapshot.title,
    },
  });

  const exportFloors = snapshot.floors
    .filter((floor) => floor.branchId === "main" && floor.state === "committed" && floor.supersededAt == null)
    .sort((left, right) => left.floorNo - right.floorNo);

  for (const floor of exportFloors) {
    const pagesByNo = new Map<number, typeof floor.pages>();
    for (const page of floor.pages) {
      const list = pagesByNo.get(page.pageNo);
      if (list) {
        list.push(page);
      } else {
        pagesByNo.set(page.pageNo, [page]);
      }
    }

    const sortedPageNos = [...pagesByNo.keys()].sort((left, right) => left - right);
    for (const pageNo of sortedPageNos) {
      const pagesForNo = pagesByNo.get(pageNo) ?? [];
      const activePage = pagesForNo.find((page) => page.isActive) ?? pagesForNo[0];
      if (!activePage || activePage.messages.length === 0) {
        continue;
      }

      const mainMessage = activePage.messages[0]!;
      let swipes: string[] | undefined;
      let swipeId: number | undefined;

      if (pagesForNo.length > 1) {
        swipes = pagesForNo.map((page) => page.messages[0]?.content ?? "");
        swipeId = pagesForNo.findIndex((page) => page.id === activePage.id);
      }

      const messageLine: Record<string, unknown> = {
        name: inferStName(mainMessage.role, mainMessage.source, userName, characterName),
        is_user: mainMessage.role === "user",
        is_system: mainMessage.role === "system" || mainMessage.isHidden,
        mes: mainMessage.content,
        send_date: mainMessage.createdAt,
      };

      if (swipes && swipes.length > 1) {
        messageLine.swipes = swipes;
        messageLine.swipe_id = swipeId && swipeId >= 0 ? swipeId : 0;
      }

      yield JSON.stringify(messageLine);

      for (let index = 1; index < activePage.messages.length; index += 1) {
        const extraMessage = activePage.messages[index]!;
        yield JSON.stringify({
          name: inferStName(extraMessage.role, extraMessage.source, userName, characterName),
          is_user: extraMessage.role === "user",
          is_system: extraMessage.role === "system" || extraMessage.isHidden,
          mes: extraMessage.content,
          send_date: extraMessage.createdAt,
        });
      }
    }
  }
}

function inferStName(
  role: string,
  source: string | null,
  userName: string,
  characterName: string,
): string {
  if (source && !source.startsWith("st_import:")) {
    if (source === "user") {
      return userName;
    }
    return source;
  }

  if (source && source.startsWith("st_import:")) {
    return source.slice("st_import:".length);
  }

  return role === "user" ? userName : characterName;
}
