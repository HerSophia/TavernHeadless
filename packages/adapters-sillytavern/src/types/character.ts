export type CharacterCardFormat = 'legacy' | 'v2' | 'v3';

export interface STCharacterCard {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
}

export interface CharacterCoreFields {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  exampleDialogue?: string;
}

export interface CharacterGreetingSet {
  primaryGreeting?: string;
  alternateGreetings?: string[];
  groupOnlyGreetings?: string[];
}

export interface CharacterPromptFields {
  systemPrompt?: string;
  postHistoryInstructions?: string;
  creatorNotes?: string;
}

export interface CharacterMetadataFields {
  tags?: string[];
  creator?: string;
  characterVersion?: string;
  nickname?: string;
  source?: string[];
  creationDate?: number;
  modificationDate?: number;
}

export interface ImportedCharacterCard {
  format: CharacterCardFormat;
  spec?: string;
  specVersion?: string;
  raw: unknown;
  core: CharacterCoreFields;
  greetings: CharacterGreetingSet;
  prompts: CharacterPromptFields;
  metadata: CharacterMetadataFields;
  characterBook?: unknown;
  extensions?: Record<string, unknown>;
  assets?: Array<Record<string, unknown>>;
  unknownFields?: Record<string, unknown>;
}

export interface CharacterProfile {
  core: CharacterCoreFields;
  greetings: CharacterGreetingSet;
  prompts: CharacterPromptFields;
  metadata: CharacterMetadataFields;
  characterBook?: unknown;
  extensions?: Record<string, unknown>;
  assets?: Array<Record<string, unknown>>;
  importedFormat: CharacterCardFormat;
}
