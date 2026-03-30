import type {
  WorkspaceCharacterAssetDetail,
  WorkspaceLibraryAsset,
  WorkspacePresetEditorDetail,
  WorkspaceSession,
  WorkspaceTimelineMessage,
  WorkspaceWorldbookAssetDetail
} from "../../lib/workspace-api";
import { clonePresetEditorDocument } from "./preset-editor";
import type {
  CharacterAssetDetail,
  LocalizedTitle,
  PresetAssetDetail,
  SessionState,
  TimelineMessage,
  WorldbookAssetDetail,
  WorkspaceAsset
} from "./types";

export function toTimelineMessage(message: WorkspaceTimelineMessage): TimelineMessage {
  return {
    at: message.at,
    contentFormat: message.contentFormat,
    content: message.content,
    floorId: message.floorId,
    floorNo: message.floorNo,
    floorState: message.floorState,
    id: message.id,
    pageId: message.pageId,
    persisted: true,
    role: message.role,
    seq: message.seq,
    source: "remote",
    tokens: message.role === "assistant" ? message.tokenOut : undefined
  };
}

export function buildLibrarySummary(asset: WorkspaceLibraryAsset): string {
  if (asset.kind === "character") {
    return `Character source: ${asset.source}`;
  }

  if (asset.kind === "worldbook") {
    return `Worldbook source: ${asset.source}`;
  }

  if (asset.kind === "user") {
    const status = asset.status ?? "active";
    return `User snapshot status: ${status}`;
  }

  return `Preset profile source: ${asset.source}`;
}

export function buildLibraryTags(asset: WorkspaceLibraryAsset): string[] {
  const tags = [asset.kind, asset.source];
  if (asset.status) {
    tags.push(asset.status);
  }
  return tags;
}

export function toPresetAssetDetail(detail: WorkspacePresetEditorDetail): PresetAssetDetail {
  return {
    createdAt: detail.createdAt,
    editor: clonePresetEditorDocument(detail.editor),
    id: detail.id,
    name: detail.name,
    source: detail.source,
    updatedAt: detail.updatedAt,
    version: detail.version
  };
}

export function toWorldbookAssetDetail(detail: WorkspaceWorldbookAssetDetail): WorldbookAssetDetail {
  return {
    createdAt: detail.createdAt,
    data: { ...detail.data },
    id: detail.id,
    name: detail.name,
    source: detail.source,
    updatedAt: detail.updatedAt,
    version: detail.version
  };
}

export function toCharacterAssetDetail(detail: WorkspaceCharacterAssetDetail): CharacterAssetDetail {
  return {
    createdAt: detail.createdAt,
    deletedAt: detail.deletedAt,
    id: detail.id,
    latestVersionNo: detail.latestVersionNo,
    name: detail.name,
    snapshot: {
      ...(detail.snapshot ?? {}),
      name: detail.snapshot?.name ?? detail.name
    },
    source: detail.source,
    status: detail.status,
    updatedAt: detail.updatedAt
  };
}

export function toLocalizedTitle(title: string): LocalizedTitle {
  return {
    en: title,
    zh: title
  };
}

export function toLocalSession(session: WorkspaceSession): SessionState {
  return {
    account: session.account,
    archived: session.archived,
    characterName: session.characterName,
    id: session.id,
    title: toLocalizedTitle(session.title),
    userName: session.userName,
    worldbookProfileId: session.worldbookProfileId,
    worldbookCount: session.worldbookProfileId ? 1 : 0
  };
}

export function mergeLibraryAsset(
  accountId: string,
  asset: WorkspaceLibraryAsset,
  previous?: WorkspaceAsset
): WorkspaceAsset {
  return {
    account: accountId,
    favorite: previous?.favorite ?? false,
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    summary: buildLibrarySummary(asset),
    tags: buildLibraryTags(asset),
    updatedAt: asset.updatedAt,
    uses: previous?.uses ?? 0
  };
}
