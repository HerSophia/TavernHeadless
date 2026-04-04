import { z } from "zod";

export interface SessionCharacterSnapshot {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  exampleDialogue?: string;
  greeting?: string;
  primaryGreeting?: string;
  alternateGreetings?: string[];
  groupOnlyGreetings?: string[];
  systemPrompt?: string;
  postHistoryInstructions?: string;
  creatorNotes?: string;
  characterBook?: unknown;
  extensions?: Record<string, unknown>;
  tags?: string[];
  creator?: string;
  characterVersion?: string;
  nickname?: string;
  source?: string[];
  creationDate?: number;
  modificationDate?: number;
  assets?: Array<Record<string, unknown>>;
  importedFormat?: "legacy" | "v2" | "v3";
  [key: string]: unknown;
}

export const sessionCharacterSnapshotSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  personality: z.string().optional(),
  scenario: z.string().optional(),
  exampleDialogue: z.string().optional(),
  greeting: z.string().optional(),
  primaryGreeting: z.string().optional(),
  alternateGreetings: z.array(z.string()).optional(),
  groupOnlyGreetings: z.array(z.string()).optional(),
  systemPrompt: z.string().optional(),
  postHistoryInstructions: z.string().optional(),
  creatorNotes: z.string().optional(),
  characterBook: z.unknown().optional(),
  extensions: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  creator: z.string().optional(),
  characterVersion: z.string().optional(),
  nickname: z.string().optional(),
  source: z.array(z.string()).optional(),
  creationDate: z.number().int().nonnegative().optional(),
  modificationDate: z.number().int().nonnegative().optional(),
  assets: z.array(z.record(z.unknown())).optional(),
  importedFormat: z.enum(["legacy", "v2", "v3"]).optional(),
}).passthrough();

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\r\n?/g, "\n").trim();
  return normalized ? normalized : undefined;
}

function normalizeStringArray(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  const normalized = values
    .map((value) => value.replace(/\r\n?/g, "\n").trim())
    .filter((value) => value.length > 0);

  if (normalized.length === 0) {
    return undefined;
  }

  return [...new Set(normalized)];
}

export function getPrimaryGreeting(
  snapshot: Pick<SessionCharacterSnapshot, "primaryGreeting" | "greeting"> | Record<string, unknown> | null | undefined,
): string | undefined {
  if (!snapshot) {
    return undefined;
  }

  const primaryGreeting = typeof snapshot.primaryGreeting === "string"
    ? normalizeOptionalText(snapshot.primaryGreeting)
    : undefined;
  if (primaryGreeting) {
    return primaryGreeting;
  }

  return typeof snapshot.greeting === "string"
    ? normalizeOptionalText(snapshot.greeting)
    : undefined;
}

export function getGreetingCandidates(
  snapshot: SessionCharacterSnapshot | Record<string, unknown> | null | undefined,
): string[] {
  if (!snapshot) {
    return [];
  }

  const candidates: string[] = [];
  const primaryGreeting = getPrimaryGreeting(snapshot);
  if (primaryGreeting) {
    candidates.push(primaryGreeting);
  }

  const alternateGreetings = normalizeStringArray(Array.isArray(snapshot.alternateGreetings) ? snapshot.alternateGreetings as string[] : undefined) ?? [];
  return [...new Set([...candidates, ...alternateGreetings])];
}

export function hasAnyGreeting(
  snapshot: SessionCharacterSnapshot | Record<string, unknown> | null | undefined,
): boolean {
  if (!snapshot) {
    return false;
  }

  if (getPrimaryGreeting(snapshot)) {
    return true;
  }

  return getGreetingCandidates(snapshot).length > 0;
}

export function normalizeSessionCharacterSnapshot(snapshot: unknown): SessionCharacterSnapshot | undefined {
  const parsed = sessionCharacterSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    return undefined;
  }

  const normalized: SessionCharacterSnapshot = {
    ...parsed.data,
    name: parsed.data.name.trim(),
  };

  normalized.description = normalizeOptionalText(parsed.data.description);
  normalized.personality = normalizeOptionalText(parsed.data.personality);
  normalized.scenario = normalizeOptionalText(parsed.data.scenario);
  normalized.exampleDialogue = normalizeOptionalText(parsed.data.exampleDialogue);
  normalized.primaryGreeting = getPrimaryGreeting(parsed.data);
  normalized.alternateGreetings = normalizeStringArray(parsed.data.alternateGreetings);
  normalized.groupOnlyGreetings = normalizeStringArray(parsed.data.groupOnlyGreetings);
  normalized.systemPrompt = normalizeOptionalText(parsed.data.systemPrompt);
  normalized.postHistoryInstructions = normalizeOptionalText(parsed.data.postHistoryInstructions);
  normalized.creatorNotes = normalizeOptionalText(parsed.data.creatorNotes);
  normalized.tags = normalizeStringArray(parsed.data.tags);
  normalized.creator = normalizeOptionalText(parsed.data.creator);
  normalized.characterVersion = normalizeOptionalText(parsed.data.characterVersion);
  normalized.nickname = normalizeOptionalText(parsed.data.nickname);
  normalized.source = normalizeStringArray(parsed.data.source);
  normalized.creationDate = parsed.data.creationDate;
  normalized.modificationDate = parsed.data.modificationDate;
  normalized.extensions = parsed.data.extensions && Object.keys(parsed.data.extensions).length > 0
    ? parsed.data.extensions
    : undefined;
  normalized.assets = parsed.data.assets && parsed.data.assets.length > 0
    ? parsed.data.assets
    : undefined;
  normalized.importedFormat = parsed.data.importedFormat;

  delete normalized.greeting;

  if (!normalized.description) delete normalized.description;
  if (!normalized.personality) delete normalized.personality;
  if (!normalized.scenario) delete normalized.scenario;
  if (!normalized.exampleDialogue) delete normalized.exampleDialogue;
  if (!normalized.primaryGreeting) delete normalized.primaryGreeting;
  if (!normalized.alternateGreetings || normalized.alternateGreetings.length === 0) delete normalized.alternateGreetings;
  if (!normalized.groupOnlyGreetings || normalized.groupOnlyGreetings.length === 0) delete normalized.groupOnlyGreetings;
  if (!normalized.systemPrompt) delete normalized.systemPrompt;
  if (!normalized.postHistoryInstructions) delete normalized.postHistoryInstructions;
  if (!normalized.creatorNotes) delete normalized.creatorNotes;
  if (!normalized.tags || normalized.tags.length === 0) delete normalized.tags;
  if (!normalized.creator) delete normalized.creator;
  if (!normalized.characterVersion) delete normalized.characterVersion;
  if (!normalized.nickname) delete normalized.nickname;
  if (!normalized.source || normalized.source.length === 0) delete normalized.source;
  if (normalized.creationDate === undefined) delete normalized.creationDate;
  if (normalized.modificationDate === undefined) delete normalized.modificationDate;
  if (!normalized.extensions || Object.keys(normalized.extensions).length === 0) delete normalized.extensions;
  if (!normalized.assets || normalized.assets.length === 0) delete normalized.assets;
  if (!normalized.importedFormat) delete normalized.importedFormat;

  return normalized;
}

export function parseSessionCharacterSnapshot(snapshotJson: string | null): SessionCharacterSnapshot | undefined {
  if (!snapshotJson) {
    return undefined;
  }

  try {
    return normalizeSessionCharacterSnapshot(JSON.parse(snapshotJson));
  } catch {
    return undefined;
  }
}
