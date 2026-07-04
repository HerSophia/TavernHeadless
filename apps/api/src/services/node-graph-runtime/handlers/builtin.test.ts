import { describe, expect, it } from "vitest";

import type { NodeGraphNode } from "@tavern/core";

import { NodeGraphNodeHandlerRegistry, type NodeGraphRuntimeContext } from "../node-handler-registry.js";
import { registerBuiltinNodeGraphHandlers } from "./builtin.js";

function runtimeContext(overrides: Partial<NodeGraphRuntimeContext> = {}): NodeGraphRuntimeContext {
  return {
    accountId: "default-admin",
    intent: "dry_run",
    dryRun: true,
    ...overrides,
  };
}

function node(type: string): NodeGraphNode {
  return {
    id: type.replaceAll(".", "_"),
    type,
    typeVersion: "1",
    phase: "pre_response",
  };
}

describe("built-in NodeGraph handlers", () => {
  function registry(): NodeGraphNodeHandlerRegistry {
    const handlers = new NodeGraphNodeHandlerRegistry();
    registerBuiltinNodeGraphHandlers(handlers);
    return handlers;
  }

  it("reads global input from the current runtime input", async () => {
    const handler = registry().get("source.global_input");

    const output = await handler.execute({
      node: node("source.global_input"),
      inputs: {},
      context: runtimeContext({ userInput: "Open the iron door." }),
    });

    expect(output.value).toBe("Open the iron door.");
    expect(output.outputs).toMatchObject({
      text: "Open the iron door.",
      value: "Open the iron door.",
    });
    expect(output.preview).toMatchObject({
      kind: "text",
      title: "Global Input",
      value: "Open the iron door.",
    });
  });

  it("reads dialogue examples from the character context", async () => {
    const handler = registry().get("source.dialogue_examples");

    const output = await handler.execute({
      node: node("source.dialogue_examples"),
      inputs: {},
      context: runtimeContext({
        character: { exampleDialogue: "<START>\nAri: The stars are loud tonight." },
      }),
    });

    expect(output.value).toBe("<START>\nAri: The stars are loud tonight.");
    expect(output.outputs).toMatchObject({
      text: "<START>\nAri: The stars are loud tonight.",
      json: "<START>\nAri: The stars are loud tonight.",
    });
    expect(output.preview).toMatchObject({
      kind: "json",
      title: "Dialogue Examples",
      source: "live",
    });
  });

  it("converts text inputs into prompt blocks", async () => {
    const handler = registry().get("compose.text_to_block");

    const output = await handler.execute({
      node: node("compose.text_to_block"),
      inputs: { text: "Character context block" },
      context: runtimeContext(),
    });

    expect(output.value).toBe("Character context block");
    expect(output.outputs).toMatchObject({
      text: "Character context block",
      block: "Character context block",
    });
    expect(output.preview).toMatchObject({
      kind: "text",
      title: "Text to Block",
      value: "Character context block",
    });
  });
});
