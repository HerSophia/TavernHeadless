// ── Types ─────────────────────────────────────────────
export type {
  STPreset,
  STPresetImportReport,
  STPromptEntry,
  STPromptEntryBehavior,
  STPromptOrderItem,
  STPromptOrderTrack,
  STPromptPlacement,
} from './types/preset.js';
export type { STChatHeader, STChatMessage } from './types/chat.js';
export type { STWorldBook, STWorldBookEntry } from './types/worldbook.js';
export { WI_POSITION, WI_LOGIC, WI_ROLE } from './types/worldbook.js';
export type { WIPosition, WILogic, WIRole } from './types/worldbook.js';
export type { STRegexScript } from './types/regex.js';
export { REGEX_PLACEMENT, SUBSTITUTE_REGEX } from './types/regex.js';
export type { RegexPlacement, SubstituteRegex } from './types/regex.js';
export type {
  CharacterCardFormat,
  CharacterCoreFields,
  CharacterGreetingSet,
  CharacterMetadataFields,
  CharacterProfile,
  CharacterPromptFields,
  ImportedCharacterCard,
  STCharacterCard,
} from './types/character.js';

// ── Parsers ───────────────────────────────────────────
export { parsePreset } from './parsers/preset-parser.js';
export { parseWorldBook } from './parsers/worldbook-parser.js';
export { parseRegexScripts } from './parsers/regex-parser.js';
export {
  parseCharacterCard,
  parseCharacterCardLegacy,
  parseCharacterCardV2,
  parseCharacterCardV3,
} from './parsers/character-parser.js';
export { normalizeImportedCharacterCard } from './parsers/character-normalizer.js';
export { parseChatFile, parseSendDate, groupMessagesIntoFloors } from './parsers/chat-parser.js';
export type { ParsedChat, FloorGroup, GroupedMessage } from './parsers/chat-parser.js';

// ── Serializers ───────────────────────────────────────
export { snapshotToStCharacterCard, snapshotToCharacterCardV3 } from './serializers/character-serializer.js';
export type { CharacterSnapshotInput, STCharacterCardV2, STCharacterCardV3 } from './serializers/character-serializer.js';
export { scriptsToStRegexArray } from './serializers/regex-serializer.js';
export type { STRawRegexScript } from './serializers/regex-serializer.js';

// ── Engines ───────────────────────────────────────────
export { triggerWorldBook } from './worldbook/trigger-engine.js';
export type {
  TriggerContext,
  TriggerResult,
  DepthEntry,
  TriggerMatchSourceKind,
  TriggerFirstMatch,
  MatchTrace,
  ActivationTrace,
} from './worldbook/trigger-engine.js';
export { applyRegexScripts } from './regex/regex-engine.js';
export type { RegexContext, RegexExecutionChannel } from './regex/regex-engine.js';

// ── Assemblers ────────────────────────────────────────
export { assembleCompat } from './compat-assembler.js';
export type { CompatAssemblerInput } from './compat-assembler.js';
export { assembleCompatPlus } from './compat-plus-assembler.js';
export type { CompatPlusAssemblerInput } from './compat-plus-assembler.js';

// ── Native Imported Group ─────────────────────────────
export { buildImportedPresetPromptGraph } from './preset-to-native-group.js';
export type { BuildImportedPresetPromptGraphOptions } from './preset-to-native-group.js';
