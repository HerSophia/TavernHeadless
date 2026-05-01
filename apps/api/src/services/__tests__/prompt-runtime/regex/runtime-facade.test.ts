import { describe, expect, it } from "vitest";
import { REGEX_PLACEMENT, SUBSTITUTE_REGEX, type STRegexScript } from "@tavern/adapters-sillytavern";

import {
  buildPromptRuntimeRegexTrace,
  buildRegexCompatReport,
  buildReservedWorldInfoRegexPhase,
  createRegexMacroSubstituter,
  executePromptRuntimeRegexPhase,
  mergePromptRuntimeRegexTrace,
  PROMPT_RUNTIME_REGEX_SUBSTITUTION_MODE,
} from "../../../prompt-runtime/regex/index.js";

function makeScript(overrides: Partial<STRegexScript> & { id: string; scriptName: string; findRegex: string }): STRegexScript {
  return {
    id: overrides.id,
    scriptName: overrides.scriptName,
    findRegex: overrides.findRegex,
    replaceString: overrides.replaceString ?? "",
    trimStrings: overrides.trimStrings ?? [],
    placement: overrides.placement ?? [REGEX_PLACEMENT.AI_OUTPUT],
    disabled: overrides.disabled ?? false,
    markdownOnly: overrides.markdownOnly ?? false,
    promptOnly: overrides.promptOnly ?? false,
    runOnEdit: overrides.runOnEdit ?? false,
    substituteRegex: overrides.substituteRegex ?? SUBSTITUTE_REGEX.NONE,
    minDepth: overrides.minDepth ?? 0,
    maxDepth: overrides.maxDepth ?? 0,
  };
}

describe("prompt-runtime regex facade", () => {
  it("treats WORLD_INFO as retained but non-executable in compat report", () => {
    const report = buildRegexCompatReport([
      makeScript({ id: "ai", scriptName: "AI", findRegex: "/hello/g", replaceString: "world", placement: [REGEX_PLACEMENT.AI_OUTPUT] }),
      makeScript({ id: "world", scriptName: "World", findRegex: "/lore/g", replaceString: "story", placement: [REGEX_PLACEMENT.WORLD_INFO] }),
      makeScript({ id: "reason", scriptName: "Reason", findRegex: "/think/g", replaceString: "plan", placement: [REGEX_PLACEMENT.REASONING] }),
      makeScript({ id: "display", scriptName: "Display", findRegex: "/md/g", replaceString: "display", placement: [REGEX_PLACEMENT.MD_DISPLAY], markdownOnly: true }),
    ]);

    expect(report).toEqual({
      stored_count: 4,
      prompt_executable_count: 1,
      persist_executable_count: 1,
      display_only_count: 1,
      retained_non_executable_count: 2,
      reserved_world_info_count: 1,
      unsupported_runtime_count: 1,
      contains_prompt_only: 0,
      contains_run_on_edit: 0,
      contains_reasoning: 1,
      contains_slash_command: 0,
    });
  });

  it("executes prompt.user_input with prompt channel and skips durable rules", () => {
    const durableRule = makeScript({
      id: "durable",
      scriptName: "Durable Input",
      findRegex: "/hello/g",
      replaceString: "world",
      placement: [REGEX_PLACEMENT.USER_INPUT],
    });
    const promptOnlyRule = makeScript({
      id: "prompt-only",
      scriptName: "Prompt Only Input",
      findRegex: "/world/g",
      replaceString: "prompt",
      placement: [REGEX_PLACEMENT.USER_INPUT],
      promptOnly: true,
    });

    const result = executePromptRuntimeRegexPhase({
      phaseId: "prompt.user_input",
      text: "hello world",
      depth: 0,
      scripts: [durableRule, promptOnlyRule],
    });

    expect(result.text).toBe("hello prompt");
    expect(result.status).toBe("executed");
    expect(result.changed).toBe(true);
    expect(result.candidateRuleNames).toEqual(["Durable Input", "Prompt Only Input"]);
    expect(result.matchedRuleNames).toEqual(["Prompt Only Input"]);
    expect(result.skippedRules).toEqual([
      { ruleName: "Durable Input", reason: "channel_filtered" },
    ]);
  });

  it("documents regex substitute as bare_variable_only", () => {
    const substituter = createRegexMacroSubstituter({
      user: "Traveler",
      name: "Alice",
    });

    expect(substituter("Hello {{name}}.")).toBe("Hello Alice.");
    expect(substituter("Hello {{ user }}.")).toBe("Hello Traveler.");
    expect(substituter("{{getvar::name}}")).toBe("{{getvar::name}}");
    expect(substituter("{{.profile.name}}")).toBe("{{.profile.name}}");
  });

  it("merges persist and prompt regex traces by phase id and preserves reserved placement summary", () => {
    const persistPhase = executePromptRuntimeRegexPhase({
      phaseId: "persist.user_input",
      text: "hello",
      depth: 0,
      scripts: [
        makeScript({
          id: "persist-input",
          scriptName: "Persist Input",
          findRegex: "/hello/g",
          replaceString: "world",
          placement: [REGEX_PLACEMENT.USER_INPUT],
        }),
      ],
    });
    const reservedPhase = buildReservedWorldInfoRegexPhase([
      makeScript({
        id: "world-rule",
        scriptName: "World Rule",
        findRegex: "/lore/g",
        replaceString: "story",
        placement: [REGEX_PLACEMENT.WORLD_INFO],
      }),
    ]);
    const promptPhase = executePromptRuntimeRegexPhase({
      phaseId: "prompt.user_input",
      text: "world",
      depth: 4,
      scripts: [
        makeScript({
          id: "prompt-only",
          scriptName: "Prompt Only",
          findRegex: "/world/g",
          replaceString: "prompt",
          placement: [REGEX_PLACEMENT.USER_INPUT],
          maxDepth: 10,
          promptOnly: true,
        }),
      ],
    });

    const merged = mergePromptRuntimeRegexTrace(
      buildPromptRuntimeRegexTrace({
        userInputRules: ["Persist Input"],
        aiOutputRules: ["AI Output"],
        preprocessedUserMessage: persistPhase.text,
        phases: [persistPhase],
        substitutionMode: PROMPT_RUNTIME_REGEX_SUBSTITUTION_MODE,
      }),
      buildPromptRuntimeRegexTrace({
        userInputRules: ["Persist Input", "Prompt Only"],
        aiOutputRules: ["AI Output"],
        preprocessedUserMessage: promptPhase.text,
        phases: reservedPhase ? [promptPhase, reservedPhase] : [promptPhase],
        reservedPlacements: [REGEX_PLACEMENT.WORLD_INFO],
        substitutionMode: PROMPT_RUNTIME_REGEX_SUBSTITUTION_MODE,
      }),
    );

    expect(merged).toEqual({
      userInputRules: ["Persist Input", "Prompt Only"],
      aiOutputRules: ["AI Output"],
      preprocessedUserMessage: "prompt",
      phases: reservedPhase ? [persistPhase, promptPhase, reservedPhase] : [persistPhase, promptPhase],
      reservedPlacements: [REGEX_PLACEMENT.WORLD_INFO],
      substitutionMode: "bare_variable_only",
    });
  });
});
