import { nanoid } from "nanoid";
import {
  TH_CHAT_SPEC,
  thChatFileSchema,
  type ThChatFile,
} from "@tavern/shared";
import {
  groupMessagesIntoFloors,
  parseChatFile,
  type FloorGroup,
} from "@tavern/adapters-sillytavern";

export interface ChatImportCharacterBinding {
  characterId: string | null;
  characterVersionId: string | null;
  characterSnapshotJson: string | null;
}

export interface BuildChatImportManifestOptions {
  accountId: string;
  title?: string;
  characterBinding: ChatImportCharacterBinding;
  importedAt: number;
}

export class ChatImportManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatImportManifestError";
  }
}

export interface StJsonlImportManifest {
  format: "sillytavern_jsonl";
  accountId: string;
  title: string;
  importedAt: number;
  characterBinding: ChatImportCharacterBinding;
  header: { chat_metadata?: Record<string, unknown> };
  floorGroups: FloorGroup[];
  skippedLines: number;
  stats: {
    floorCount: number;
    messageCount: number;
    swipeCount: number;
    skippedLines: number;
    importSource: "sillytavern_jsonl";
    format: "sillytavern_jsonl";
  };
}

export interface ThChatImportManifest {
  format: "thchat";
  accountId: string;
  title: string;
  importedAt: number;
  characterBinding: ChatImportCharacterBinding;
  file: ThChatFile;
  idMap: Record<string, string>;
  stats: {
    floorCount: number;
    pageCount: number;
    messageCount: number;
    variableCount: number;
    memoryItemCount: number;
    memoryEdgeCount: number;
    skippedLines: 0;
    importSource: "thchat";
    format: "thchat";
  };
}

export type ChatImportManifest = StJsonlImportManifest | ThChatImportManifest;

export function buildChatImportManifest(
  rawData: string,
  options: BuildChatImportManifestOptions,
): ChatImportManifest {
  const detectedThChat = detectThChatFile(rawData);
  if (detectedThChat) {
    return buildThChatImportManifest(detectedThChat, options);
  }

  return buildStJsonlImportManifest(rawData, options);
}

export function buildStJsonlImportManifest(
  rawData: string,
  options: BuildChatImportManifestOptions,
): StJsonlImportManifest {
  let chatData: ReturnType<typeof parseChatFile>;
  try {
    chatData = parseChatFile(rawData);
  } catch (error) {
    throw new ChatImportManifestError(
      `Failed to parse chat file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (chatData.messages.length === 0) {
    throw new ChatImportManifestError("Chat file contains no messages");
  }

  const floorGroups = groupMessagesIntoFloors(chatData.messages);
  const title = options.title
    ?? chatData.header.character_name
    ?? chatData.header.name
    ?? "Imported Chat";

  const stats = computeStJsonlStats(floorGroups, chatData.skippedLines);

  return {
    format: "sillytavern_jsonl",
    accountId: options.accountId,
    title,
    importedAt: options.importedAt,
    characterBinding: options.characterBinding,
    header: { chat_metadata: chatData.header.chat_metadata },
    floorGroups,
    skippedLines: chatData.skippedLines,
    stats,
  };
}

export function buildThChatImportManifest(
  file: ThChatFile,
  options: BuildChatImportManifestOptions,
): ThChatImportManifest {
  const title = options.title ?? file.data.title ?? "Imported Chat";
  const idMap = buildThChatImportIdMap(file);
  const validMemoryEdgeCount = (file.data.memories?.edges ?? []).filter((edge) => {
    return edge.from_id_ref in idMap && edge.to_id_ref in idMap;
  }).length;

  return {
    format: "thchat",
    accountId: options.accountId,
    title,
    importedAt: options.importedAt,
    characterBinding: options.characterBinding,
    file,
    idMap,
    stats: {
      floorCount: file.data.floors.length,
      pageCount: file.data.floors.reduce((total, floor) => total + floor.pages.length, 0),
      messageCount: file.data.floors.reduce(
        (total, floor) => total + floor.pages.reduce((pageTotal, page) => pageTotal + page.messages.length, 0),
        0,
      ),
      variableCount: file.data.variables?.length ?? 0,
      memoryItemCount: file.data.memories?.items.length ?? 0,
      memoryEdgeCount: validMemoryEdgeCount,
      skippedLines: 0,
      importSource: "thchat",
      format: "thchat",
    },
  };
}

function detectThChatFile(rawData: string): ThChatFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || (parsed as { spec?: unknown }).spec !== TH_CHAT_SPEC) {
    return null;
  }

  const validation = thChatFileSchema.safeParse(parsed);
  if (!validation.success) {
    throw new ChatImportManifestError(
      `Invalid .thchat file: ${validation.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }

  const majorVersion = Number.parseInt(validation.data.spec_version.split(".")[0] ?? "0", 10);
  if (majorVersion !== 1) {
    throw new ChatImportManifestError(
      `Unsupported spec_version "${validation.data.spec_version}". Only major version 1 is supported.`,
    );
  }

  return validation.data;
}

function computeStJsonlStats(
  floorGroups: FloorGroup[],
  skippedLines: number,
): StJsonlImportManifest["stats"] {
  let messageCount = 0;
  let swipeCount = 0;

  for (const group of floorGroups) {
    for (const message of group.messages) {
      if (message.swipes && message.swipes.length > 1) {
        swipeCount += message.swipes.length;
        messageCount += message.swipes.length;
      } else {
        messageCount += 1;
      }
    }
  }

  return {
    floorCount: floorGroups.length,
    messageCount,
    swipeCount,
    skippedLines,
    importSource: "sillytavern_jsonl",
    format: "sillytavern_jsonl",
  };
}

function buildThChatImportIdMap(file: ThChatFile): Record<string, string> {
  const idMap: Record<string, string> = {};

  for (const floor of file.data.floors) {
    idMap[floor._original_id] = nanoid();
    for (const page of floor.pages) {
      idMap[page._original_id] = nanoid();
      for (const message of page.messages) {
        idMap[message._original_id] = nanoid();
      }
    }
  }

  for (const item of file.data.memories?.items ?? []) {
    idMap[item._original_id] = nanoid();
  }

  return idMap;
}
