import { applyRegexScripts, REGEX_PLACEMENT, type RegexExecutionChannel } from "@tavern/adapters-sillytavern";
import { createRegexMacroSubstituter, type SessionPromptInfo } from "../prompt-assembler.js";
import { PromptResourceLoader } from "../prompt-resource-loader.js";
import { VariableService } from "../variable-service.js";
import { ChatMessagePersistence } from "../chat-message-persistence.js";
import type { AppDb } from "../../db/client.js";

import { parseRegexCharacterName, parseRegexUserName } from "./shared/regex.js";

export class RegexInputService {
  constructor(
    private readonly db: AppDb,
    private readonly messagePersistence: ChatMessagePersistence,
  ) {}

  async applyPersistedUserInputRegex(args: {
    accountId: string;
    sessionId: string;
    branchId?: string;
    floorId?: string;
    pageId?: string;
    session: {
      characterSnapshotJson: string | null;
      userSnapshotJson: string | null;
      metadataJson: string | null;
    };
    sessionInfo: SessionPromptInfo;
    rawUserMessage: string;
    regexChannel: RegexExecutionChannel;
    persistedMessageId?: string;
  }): Promise<string> {
    const resourceLoader = new PromptResourceLoader(this.db);
    const regexProfile = await resourceLoader.loadRegexScripts(args.accountId, args.sessionInfo.regexProfileId);

    if (!regexProfile || regexProfile.scripts.length === 0) {
      return args.rawUserMessage;
    }

    const variables = await this.resolveRegexVariables({
      accountId: args.accountId,
      sessionId: args.sessionId,
      branchId: args.branchId,
      floorId: args.floorId,
      pageId: args.pageId,
      characterSnapshotJson: args.session.characterSnapshotJson,
      userSnapshotJson: args.session.userSnapshotJson,
      metadataJson: args.session.metadataJson,
    });

    const substituteRegexParams = createRegexMacroSubstituter(variables);
    const persistedUserMessage = applyRegexScripts(
      args.rawUserMessage,
      regexProfile.scripts,
      REGEX_PLACEMENT.USER_INPUT,
      {
        channel: args.regexChannel,
        depth: 0,
        substituteFindParams: substituteRegexParams,
        substituteReplaceParams: substituteRegexParams,
      },
    );

    if (args.persistedMessageId && persistedUserMessage !== args.rawUserMessage) {
      await this.messagePersistence.updateMessageContent(args.persistedMessageId, persistedUserMessage);
    }

    return persistedUserMessage;
  }

  private async resolveRegexVariables(args: {
    accountId: string;
    sessionId: string;
    branchId?: string;
    floorId?: string;
    pageId?: string;
    characterSnapshotJson: string | null;
    userSnapshotJson: string | null;
    metadataJson: string | null;
  }): Promise<Record<string, unknown>> {
    const variables = Object.create(null) as Record<string, unknown>;
    const variableService = new VariableService(this.db);
    const snapshot = await variableService.resolveSnapshot({
      accountId: args.accountId,
      sessionId: args.sessionId,
      branchId: args.branchId,
      floorId: args.floorId,
      pageId: args.pageId,
    });

    for (const entry of snapshot.resolved) {
      variables[entry.key] = entry.value;
    }

    variables.char = parseRegexCharacterName(args.characterSnapshotJson) ?? "Assistant";
    variables.user = parseRegexUserName(args.userSnapshotJson, args.metadataJson) ?? "User";
    return variables;
  }
}
