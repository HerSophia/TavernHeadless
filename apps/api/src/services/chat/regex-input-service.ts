import {
  applyRegexScripts,
  REGEX_PLACEMENT,
  type RegexExecutionChannel,
} from "@tavern/adapters-sillytavern";
import type { PromptRuntimeTrace, SessionPromptInfo } from "../prompt-assembler.js";
import { PromptResourceLoader } from "../prompt-resource-loader.js";
import { VariableService } from "../variable-service.js";
import { ChatMessagePersistence } from "../chat-message-persistence.js";
import type { AppDb } from "../../db/client.js";
import {
  buildPromptRuntimeRegexTrace,
  buildRegexSubstitutionContext,
  collectRegexRuleNames,
  executePromptRuntimeRegexPhase,
  listRuntimeRegexReservedPlacements,
  PROMPT_RUNTIME_REGEX_SUBSTITUTION_MODE,
} from "../prompt-runtime/regex/index.js";

import { parseRegexCharacterName, parseRegexUserName } from "./shared/regex.js";

export interface PersistedUserInputRegexResult {
  text: string;
  runtimeTrace?: PromptRuntimeTrace["regex"];
}

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
  }): Promise<PersistedUserInputRegexResult> {
    const resourceLoader = new PromptResourceLoader(this.db);
    const regexProfile = await resourceLoader.loadRegexScripts(args.accountId, args.sessionInfo.regexProfileId);

    if (!regexProfile || regexProfile.scripts.length === 0) {
      return {
        text: args.rawUserMessage,
      };
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

    const substitutionContext = buildRegexSubstitutionContext(variables);
    const persistPhase = args.regexChannel === "edit"
      ? undefined
      : executePromptRuntimeRegexPhase({
          phaseId: "persist.user_input",
          text: args.rawUserMessage,
          scripts: regexProfile.scripts,
          depth: 0,
          substitutionContext,
        });
    const persistedText = args.regexChannel === "edit"
      ? applyRegexScripts(
          args.rawUserMessage,
          regexProfile.scripts,
          REGEX_PLACEMENT.USER_INPUT,
          {
            channel: "edit",
            depth: 0,
            ...substitutionContext,
          },
        )
      : persistPhase!.text;
    const runtimeTrace = buildPromptRuntimeRegexTrace({
      userInputRules: collectRegexRuleNames(regexProfile.scripts, REGEX_PLACEMENT.USER_INPUT),
      aiOutputRules: collectRegexRuleNames(regexProfile.scripts, REGEX_PLACEMENT.AI_OUTPUT),
      preprocessedUserMessage: persistedText,
      ...(args.regexChannel === "edit"
        ? {}
        : { phases: [persistPhase!] }),
      reservedPlacements: listRuntimeRegexReservedPlacements(regexProfile.scripts),
      substitutionMode: PROMPT_RUNTIME_REGEX_SUBSTITUTION_MODE,
    });

    if (args.persistedMessageId && persistedText !== args.rawUserMessage) {
      await this.messagePersistence.updateMessageContent(args.persistedMessageId, persistedText);
    }

    return {
      text: persistedText,
      ...(runtimeTrace ? { runtimeTrace } : {}),
    };
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
