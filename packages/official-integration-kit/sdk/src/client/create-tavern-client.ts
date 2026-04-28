import type { ApiClient } from "@tavern/shared";

import { createAccountsResource, type AccountsResource } from "../resources/accounts.js";
import { createBranchesResource, type BranchesResource } from "../resources/branches.js";
import { createCharactersResource, type CharactersResource } from "../resources/characters.js";
import { createChatTransferJobsResource, type ChatTransferJobsResource } from "../resources/chat-transfer-jobs.js";
import { createClientDataResource, type ClientDataResource } from "../resources/client-data.js";

import { createExportsResource, type ExportsResource } from "../resources/exports.js";
import { createFloorsResource, type FloorsResource } from "../resources/floors.js";
import { createHealthResource, type HealthResource } from "../resources/health.js";
import { createImportsResource, type ImportsResource } from "../resources/imports.js";
import { createLlmInstancesResource, type LlmInstancesResource } from "../resources/llm-instances.js";
import { createLlmProfilesResource, type LlmProfilesResource } from "../resources/llm-profiles.js";
import { createMcpResource, type McpResource } from "../resources/mcp.js";
import { createMemoryJobsResource, type MemoryJobsResource } from "../resources/memory-jobs.js";
import { createMemoryScopesResource, type MemoryScopesResource } from "../resources/memory-scopes.js";
import { createMemoriesResource, type MemoriesResource } from "../resources/memories.js";
import { createMemoryEdgesResource, type MemoryEdgesResource } from "../resources/memory-edges.js";
import { createMessagesResource, type MessagesResource } from "../resources/messages.js";
import { createPagesResource, type PagesResource } from "../resources/pages.js";
import { createPresetEntriesResource, type PresetEntriesResource } from "../resources/preset-entries.js";
import { createPresetsResource, type PresetsResource } from "../resources/presets.js";
import { createPromptRuntimeResource, type PromptRuntimeResource } from "../resources/prompt-runtime.js";
import { createRegexProfilesResource, type RegexProfilesResource } from "../resources/regex-profiles.js";
import { createSessionStateResource, type SessionStateResource } from "../resources/session-state.js";
import { createSessionsResource, type SessionsResource } from "../resources/sessions.js";
import { createToolsResource, type ToolsResource } from "../resources/tools.js";
import { createUsersResource, type UsersResource } from "../resources/users.js";
import { createVariablesResource, type VariablesResource } from "../resources/variables.js";
import { createWorldbookEntriesResource, type WorldbookEntriesResource } from "../resources/worldbook-entries.js";
import { createWorldbooksResource, type WorldbooksResource } from "../resources/worldbooks.js";
import { createTransportClient, type TavernClientOptions } from "./transport.js";

export type TavernClient = ApiClient & {
  accounts: AccountsResource;
  branches: BranchesResource;
  clientData: ClientDataResource;

  characters: CharactersResource;
  chatTransferJobs: ChatTransferJobsResource;
  exports: ExportsResource;
  floors: FloorsResource;
  health: HealthResource;
  imports: ImportsResource;
  llmInstances: LlmInstancesResource;
  llmProfiles: LlmProfilesResource;
  mcp: McpResource;
  memories: MemoriesResource;
  memoryJobs: MemoryJobsResource;
  memoryEdges: MemoryEdgesResource;
  messages: MessagesResource;
  memoryScopes: MemoryScopesResource;
  pages: PagesResource;
  presetEntries: PresetEntriesResource;
  presets: PresetsResource;
  promptRuntime: PromptRuntimeResource;
  regexProfiles: RegexProfilesResource;
  sessionState: SessionStateResource;
  sessions: SessionsResource;
  tools: ToolsResource;
  users: UsersResource;
  variables: VariablesResource;
  worldbookEntries: WorldbookEntriesResource;
  worldbooks: WorldbooksResource;
};

export type { TavernClientOptions } from "./transport.js";

export function createTavernClient(options: TavernClientOptions): TavernClient {
  const transport = createTransportClient(options);

  return {
    ...transport,
    clientData: createClientDataResource(transport),

    accounts: createAccountsResource(transport),
    branches: createBranchesResource(transport),
    characters: createCharactersResource(transport),
    chatTransferJobs: createChatTransferJobsResource(transport),
    exports: createExportsResource(transport),
    floors: createFloorsResource(transport),
    health: createHealthResource(transport),
    imports: createImportsResource(transport),
    llmInstances: createLlmInstancesResource(transport),
    llmProfiles: createLlmProfilesResource(transport),
    mcp: createMcpResource(transport),
    memoryJobs: createMemoryJobsResource(transport),
    memories: createMemoriesResource(transport),
    memoryEdges: createMemoryEdgesResource(transport),
    messages: createMessagesResource(transport),
    memoryScopes: createMemoryScopesResource(transport),
    pages: createPagesResource(transport),
    presetEntries: createPresetEntriesResource(transport),
    presets: createPresetsResource(transport),
    promptRuntime: createPromptRuntimeResource(transport),
    regexProfiles: createRegexProfilesResource(transport),
    sessionState: createSessionStateResource(transport),
    sessions: createSessionsResource(transport),
    tools: createToolsResource(transport),
    users: createUsersResource(transport),
    variables: createVariablesResource(transport),
    worldbookEntries: createWorldbookEntriesResource(transport),
    worldbooks: createWorldbooksResource(transport),
  };
}
