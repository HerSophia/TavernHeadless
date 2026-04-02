import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildApp } from "../src/app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const DEFAULT_OUTPUT = "apps/api/openapi/openapi.json";

async function main(): Promise<void> {
  const outputPath = resolveOutputPath(process.argv.slice(2));
  const { app } = await buildApp({ databasePath: ":memory:", logger: false, enableMcp: true });

  try {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    if (response.statusCode !== 200) {
      throw new Error(`Failed to export OpenAPI document (status=${response.statusCode})`);
    }

    const spec = response.json<unknown>();
    const stableSpec = sortValue(spec);
    const content = `${JSON.stringify(stableSpec, null, 2)}\n`;

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, "utf8");
    console.log(`[openapi:export] wrote ${toRootRelativePath(outputPath)}`);
  } finally {
    await app.close();
  }
}

function resolveOutputPath(args: string[]): string {
  const raw = args.find((value) => value.trim() !== "--");
  const normalized = raw?.trim();
  if (!normalized) {
    return resolve(repoRoot, DEFAULT_OUTPUT);
  }

  if (/^[A-Za-z]:[\\/]/.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith("/")) {
    return normalized;
  }

  return resolve(repoRoot, normalized);
}

function toRootRelativePath(absolutePath: string): string {
  const relativePath = relative(repoRoot, absolutePath);
  if (!relativePath || relativePath.startsWith("..")) {
    return absolutePath;
  }

  return relativePath.replace(/\\/g, "/");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  const sorted: Record<string, unknown> = {};

  for (const [key, childValue] of entries) {
    sorted[key] = sortValue(childValue);
  }

  return sorted;
}

main().catch((error) => {
  console.error("[openapi:export] failed", error);
  process.exit(1);
});
