import process from "node:process";
import { parseArgs, createSmokeContext } from "./smoke/harness.js";
import { smokeCore } from "./smoke/core.js";
import { smokeVariables } from "./smoke/variables.js";
import { smokeMemories } from "./smoke/memories.js";
import { smokeImports } from "./smoke/imports.js";
import { smokeMcp } from "./smoke/mcp.js";
import { smokeLlmProfiles } from "./smoke/llm-profiles.js";
import { smokeLlmInstances } from "./smoke/llm-instances.js";
import { smokeTools } from "./smoke/tools.js";
import { smokeUsers } from "./smoke/users.js";
import { smokeCharacters } from "./smoke/characters.js";
import { smokeWorldbookEntries } from "./smoke/worldbook-entries.js";
import { smokePresetEntries } from "./smoke/preset-entries.js";
import { smokeChat } from "./smoke/chat.js";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const ctx = createSmokeContext(options);

  try {
    // ── Phase 1: Core CRUD ─────────────────────────────
    await smokeCore(ctx);
    await smokeVariables(ctx);
    await smokeMemories(ctx);

    // ── Phase 2: Imports ───────────────────────────────
    if (!options.skipImports) {
      await smokeImports(ctx);
    }

    // ── Phase 3: MCP + LLM ─────────────────────────────
    await smokeMcp(ctx);
    await smokeLlmProfiles(ctx);
    await smokeLlmInstances(ctx);

    // ── Phase 4: Tools + Users ──────────────────────────
    await smokeTools(ctx);
    await smokeUsers(ctx);

    // ── Phase 5: Import-dependent modules ──────────────
    if (!options.skipImports) {
      await smokeCharacters(ctx);
      await smokeWorldbookEntries(ctx);
      await smokePresetEntries(ctx);
    }

    // ── Phase 6: Chat ─────────────────────────────────
    await smokeChat(ctx);

    // ── Final validation ───────────────────────────────
    await ctx.runStep("GET /messages?limit=0 (validation => 400)", () =>
      ctx.api.request("GET", "/messages?limit=0", undefined, [400])
    );

    console.log("\nSmoke test completed successfully.");
    console.log(`Run ID: ${ctx.runId}`);
    console.log(`Base URL: ${options.baseUrl}`);

    if (options.keepData) {
      console.log("Created resources were kept (--keep-data):");
      for (const [resource, ids] of Object.entries(ctx.keptResourceIds)) {
        if (ids.length > 0) {
          console.log(`  ${resource}: ${ids.join(", ")}`);
        }
      }
    }
  } finally {
    if (!options.keepData) {
      for (const task of ctx.cleanupTasks) {
        try {
          await task();
        } catch {
          // best-effort cleanup
        }
      }
    }
  }
}

main().catch((error) => {
  console.error("\nSmoke test failed.");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
