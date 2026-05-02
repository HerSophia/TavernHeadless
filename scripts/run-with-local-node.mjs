#!/usr/bin/env node

import { spawn } from "node:child_process";

import { createLocalNodeEnv, describeLocalNode } from "./local-node-env.mjs";

function printHelp() {
  console.log("Usage: node scripts/run-with-local-node.mjs <command> [args...]");
  console.log("");
  console.log("Examples:");
  console.log("  node scripts/run-with-local-node.mjs pnpm dev");
  console.log("  node scripts/run-with-local-node.mjs pnpm --filter @tavern/api dev");
  console.log("  node scripts/run-with-local-node.mjs pnpm rebuild better-sqlite3");
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  printHelp();
  process.exit(0);
}

const localNode = describeLocalNode();

if (localNode.available) {
  console.log(`[local-node] Using local Node ${localNode.version} from ${localNode.executable}`);
} else {
  console.warn(`[local-node] Local Node ${localNode.version} was not found at ${localNode.executable}. Running with current Node ${process.version}.`);
}

const child = spawn(args[0], args.slice(1), {
  env: createLocalNodeEnv(process.env),
  shell: true,
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(`[local-node] Failed to start command: ${error.message}`);
  process.exit(1);
});
