// ── Character Snapshot → ST Character Card V2 ─────────

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\r\n?/g, '\n').trim();
  return normalized ? normalized : undefined;
}

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  const normalized = values
    .map((value) => value.replace(/\r\n?/g, '\n').trim())
    .filter((value) => value.length > 0);

  return [...new Set(normalized)];
}

/**
 * CharacterSnapshot 的宽松输入类型。
 * 不从 apps/api 引入，避免跨包循环依赖。
 */
export interface CharacterSnapshotInput {
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
}

/**
 * SillyTavern Character Card V2 完整结构。
 */
export interface STCharacterCardV2 {
  spec: 'chara_card_v2';
  spec_version: '2.0';
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    creator_notes: string;
    system_prompt: string;
    post_history_instructions: string;
    alternate_greetings: string[];
    tags: string[];
    creator: string;
    character_version: string;
    extensions: Record<string, unknown>;
    character_book?: unknown;
  };
}

/**
 * Character Card V3 最小导出结构。
 */
export interface STCharacterCardV3 {
  spec: 'chara_card_v3';
  spec_version: '3.0';
  data: {
    name: string;
    description: string;
    tags: string[];
    creator: string;
    character_version: string;
    mes_example: string;
    extensions: Record<string, unknown>;
    system_prompt: string;
    post_history_instructions: string;
    first_mes: string;
    alternate_greetings: string[];
    personality: string;
    scenario: string;
    creator_notes: string;
    group_only_greetings: string[];
    character_book?: unknown;
    assets?: Array<Record<string, unknown>>;
    nickname?: string;
    source?: string[];
    creation_date?: number;
    modification_date?: number;
  };
}

/**
 * 将 TH CharacterSnapshot 反向转换为 ST Character Card V2 JSON。
 */
export function snapshotToStCharacterCard(
  snapshot: CharacterSnapshotInput,
): STCharacterCardV2 {
  const primaryGreeting = normalizeOptionalText(snapshot.primaryGreeting)
    ?? normalizeOptionalText(snapshot.greeting)
    ?? '';
  const alternateGreetings = normalizeStringArray(snapshot.alternateGreetings);
  const data: STCharacterCardV2['data'] = {
    name: snapshot.name,
    description: snapshot.description ?? '',
    personality: snapshot.personality ?? '',
    scenario: snapshot.scenario ?? '',
    first_mes: primaryGreeting,
    mes_example: snapshot.exampleDialogue ?? '',
    creator_notes: snapshot.creatorNotes ?? '',
    system_prompt: snapshot.systemPrompt ?? '',
    post_history_instructions: snapshot.postHistoryInstructions ?? '',
    alternate_greetings: alternateGreetings,
    tags: normalizeStringArray(snapshot.tags),
    creator: snapshot.creator ?? '',
    character_version: snapshot.characterVersion ?? '',
    extensions: snapshot.extensions ?? {},
  };

  if (snapshot.characterBook !== undefined) {
    data.character_book = snapshot.characterBook;
  }

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data,
  };
}

/**
 * 将 TH CharacterSnapshot 反向转换为 Character Card V3 JSON。
 */
export function snapshotToCharacterCardV3(
  snapshot: CharacterSnapshotInput,
): STCharacterCardV3 {
  const primaryGreeting = normalizeOptionalText(snapshot.primaryGreeting)
    ?? normalizeOptionalText(snapshot.greeting)
    ?? '';

  const data: STCharacterCardV3['data'] = {
    name: snapshot.name,
    description: snapshot.description ?? '',
    tags: normalizeStringArray(snapshot.tags),
    creator: snapshot.creator ?? '',
    character_version: snapshot.characterVersion ?? '',
    mes_example: snapshot.exampleDialogue ?? '',
    extensions: snapshot.extensions ?? {},
    system_prompt: snapshot.systemPrompt ?? '',
    post_history_instructions: snapshot.postHistoryInstructions ?? '',
    first_mes: primaryGreeting,
    alternate_greetings: normalizeStringArray(snapshot.alternateGreetings),
    personality: snapshot.personality ?? '',
    scenario: snapshot.scenario ?? '',
    creator_notes: snapshot.creatorNotes ?? '',
    group_only_greetings: normalizeStringArray(snapshot.groupOnlyGreetings),
  };

  if (snapshot.characterBook !== undefined) data.character_book = snapshot.characterBook;
  if (snapshot.assets && snapshot.assets.length > 0) data.assets = snapshot.assets;
  if (normalizeOptionalText(snapshot.nickname)) data.nickname = normalizeOptionalText(snapshot.nickname);
  if (normalizeStringArray(snapshot.source).length > 0) data.source = normalizeStringArray(snapshot.source);
  if (snapshot.creationDate !== undefined) data.creation_date = snapshot.creationDate;
  if (snapshot.modificationDate !== undefined) data.modification_date = snapshot.modificationDate;

  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data,
  };
}
