import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const OPENAPI_TARGET_PATH = resolve("packages/shared/src/generated/openapi.json");
const OPENAPI_CANDIDATE_PATH = resolve("packages/shared/src/generated/.openapi.check.json");
const TYPES_TARGET_PATH = resolve("packages/shared/src/generated/openapi-types.ts");
const TYPES_CANDIDATE_PATH = resolve("packages/shared/src/generated/.openapi-types.check.ts");

async function main(): Promise<void> {
  try {
    await assertSameFile(OPENAPI_TARGET_PATH, OPENAPI_CANDIDATE_PATH, "OpenAPI JSON");
    await assertSameFile(TYPES_TARGET_PATH, TYPES_CANDIDATE_PATH, "OpenAPI TypeScript SDK types");

    console.log("[sdk:check] generated SDK artifacts are up to date");
  } finally {
    await Promise.all([
      rm(OPENAPI_CANDIDATE_PATH, { force: true }),
      rm(TYPES_CANDIDATE_PATH, { force: true }),
    ]);
  }
}

async function assertSameFile(targetPath: string, candidatePath: string, label: string): Promise<void> {
  const [targetContent, candidateContent] = await Promise.all([
    readFile(targetPath, "utf8"),
    readFile(candidatePath, "utf8"),
  ]);

  if (targetContent !== candidateContent) {
    if (normalizeNewlines(targetContent) !== normalizeNewlines(candidateContent)) {
      throw new Error(`[sdk:check] ${label} is out of date. Run \`pnpm sdk:generate\`.`);
    }
  }
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
