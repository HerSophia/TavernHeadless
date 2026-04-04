import type { ChatMessage, ChatRole, PromptIR, TokenCounter } from '../prompt/types.js';

export type PromptRunIntent = 'normal' | 'continue' | 'impersonate' | 'swipe' | 'regenerate' | 'quiet';
export type PromptTrigger = PromptRunIntent;

export type PromptPlacement =
  | { kind: 'relative'; order: number }
  | { kind: 'in_chat'; depth: number; order: number }
  | { kind: 'anchor'; anchorId: string; order: number };

export interface PromptNodeBase {
  id: string;
  name: string;
  nodeType: string;
  enabled: boolean;
  role: ChatRole;
  triggers?: PromptTrigger[];
  placement: PromptPlacement;
  metadata?: Record<string, unknown>;
}

export interface StaticTextNode extends PromptNodeBase {
  nodeType: 'static_text';
  template: string;
}

export interface VariableTemplateNode extends PromptNodeBase {
  nodeType: 'variable_template';
  template: string;
}

export interface MarkerNode extends PromptNodeBase {
  nodeType: 'marker';
  markerId: string;
}

export interface ChatHistoryNode extends PromptNodeBase {
  nodeType: 'chat_history';
}

export interface CharacterNode extends PromptNodeBase {
  nodeType: 'character';
  part: 'description' | 'personality' | 'scenario' | 'system_prompt' | 'post_history';
}

export interface PersonaNode extends PromptNodeBase {
  nodeType: 'persona';
}

export interface WorldbookNode extends PromptNodeBase {
  nodeType: 'worldbook';
  position: 'before' | 'after' | 'depth';
  depth?: number;
}

export interface ExampleDialogueNode extends PromptNodeBase {
  nodeType: 'example_dialogue';
}

export interface MemoryNode extends PromptNodeBase {
  nodeType: 'memory';
}

export interface ToolResultNode extends PromptNodeBase {
  nodeType: 'tool_result';
  toolName: string;
}

export type PromptNode =
  | StaticTextNode
  | VariableTemplateNode
  | MarkerNode
  | ChatHistoryNode
  | CharacterNode
  | PersonaNode
  | WorldbookNode
  | ExampleDialogueNode
  | MemoryNode
  | ToolResultNode;

export interface PromptEdge {
  id: string;
  from: string;
  to: string;
  kind: 'order' | 'anchor';
}

export interface PromptNodeGroup {
  id: string;
  name: string;
  nodes: PromptNode[];
  edges: PromptEdge[];
  metadata?: Record<string, unknown>;
}

export interface PromptExecutionPolicy {
  continueNudgePrompt?: string;
  assistantPrefill?: string;
  continuePrefillAsAssistant?: boolean;
  continuePostfix?: string;
  namesBehavior?: 'off' | 'auto' | 'always';
}

export interface PromptGraphImportBinding {
  source: 'sillytavern';
  artifactId: string;
  groupId: string;
}

export interface PromptGraphDocument {
  version: 1;
  rootGroupId: string;
  groups: PromptNodeGroup[];
  policies: PromptExecutionPolicy;
  imports?: PromptGraphImportBinding[];
}

export interface PromptGraphCharacterInput {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
}

export interface PromptGraphPersonaInput {
  name?: string;
  description?: string;
}

export interface PromptGraphWorldbookEntry {
  id: string;
  content: string;
  position?: 'before' | 'after' | 'depth';
  role?: ChatRole;
  depth?: number;
}

export interface PromptGraphCompilerInput {
  intent?: PromptRunIntent;
  variables?: Record<string, unknown>;
  character?: PromptGraphCharacterInput;
  persona?: PromptGraphPersonaInput;
  chatHistory?: ChatMessage[];
  worldbookEntries?: PromptGraphWorldbookEntry[];
  exampleDialogue?: string;
  memorySummary?: string;
  toolResults?: Record<string, string>;
  maxTokens: number;
  reservedForReply: number;
  tokenCounter?: TokenCounter;
}

export interface PromptGraphCompiler {
  compile(document: PromptGraphDocument, input: PromptGraphCompilerInput): PromptIR;
}
