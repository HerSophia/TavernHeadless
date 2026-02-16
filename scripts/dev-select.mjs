#!/usr/bin/env node

import { spawn } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

const MODES = {
  api: {
    label: "Backend only (@tavern/api)",
    command: ["run", "dev:api"],
  },
  web: {
    label: "Frontend only (@tavern/web)",
    command: ["run", "dev:web"],
  },
  both: {
    label: "Backend + Frontend",
    command: ["run", "dev:both"],
  },
};

const ARG_ALIAS = {
  api: "api",
  backend: "api",
  be: "api",
  web: "web",
  frontend: "web",
  fe: "web",
  both: "both",
  all: "both",
  full: "both",
};

async function main() {
  const arg = process.argv[2]?.toLowerCase();
  if (arg === "--help" || arg === "-h") {
    printHelp();
    return;
  }

  const mode = arg ? ARG_ALIAS[arg] : await promptMode();
  if (!mode) {
    console.error("Invalid mode. Use --help to see available options.");
    process.exitCode = 1;
    return;
  }

  const selected = MODES[mode];
  console.log(`Starting: ${selected.label}`);

  const exitCode = await runPnpm(selected.command);
  process.exitCode = exitCode;
}

function printHelp() {
  console.log("Usage: node scripts/dev-select.mjs [mode]");
  console.log("");
  console.log("Modes:");
  console.log("  api   Start backend only");
  console.log("  web   Start frontend only");
  console.log("  both  Start backend + frontend");
  console.log("");
  console.log("No mode = interactive selection menu");
}

async function promptMode() {
  const rl = createInterface({ input, output });

  try {
    console.log("Select dev target:");
    console.log("  1) Backend only (@tavern/api)");
    console.log("  2) Frontend only (@tavern/web)");
    console.log("  3) Backend + Frontend");

    const answer = (await rl.question("Enter 1/2/3 (default 1): ")).trim();

    if (answer === "" || answer === "1") {
      return "api";
    }

    if (answer === "2") {
      return "web";
    }

    if (answer === "3") {
      return "both";
    }

    return undefined;
  } finally {
    rl.close();
  }
}

function runPnpm(args) {
  return new Promise((resolve) => {
    const child = spawn("pnpm", args, {
      stdio: "inherit",
      shell: true,
    });

    child.on("exit", (code) => {
      resolve(code ?? 0);
    });

    child.on("error", () => {
      resolve(1);
    });
  });
}

main();
