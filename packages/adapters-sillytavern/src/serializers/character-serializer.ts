// ── Character Snapshot → ST Character Card V2 ─────────

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
}

/**
 * SillyTavern Character Card V2 完整结构。
 */
export interface STCharacterCardV2 {
  spec: "chara_card_v2";
  spec_version: "2.0";
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
  };
}

/**
 * 将 TH CharacterSnapshot 反向转换为 ST Character Card V2 JSON。
 *
 * 映射规则：
 * - name → name
 * - description → description（undefined → ""）
 * - personality → personality（undefined → ""）
 * - scenario → scenario（undefined → ""）
 * - greeting → first_mes（undefined → ""）
 * - exampleDialogue → mes_example（undefined → ""）
 * - 无对应字段的 V2 字段补空值
 */
export function snapshotToStCharacterCard(
  snapshot: CharacterSnapshotInput,
): STCharacterCardV2 {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: snapshot.name,
      description: snapshot.description ?? "",
      personality: snapshot.personality ?? "",
      scenario: snapshot.scenario ?? "",
      first_mes: snapshot.greeting ?? "",
      mes_example: snapshot.exampleDialogue ?? "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      tags: [],
      creator: "",
      character_version: "",
      extensions: {},
    },
  };
}
