import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@tavern/adapters-sillytavern": resolve(rootDir, "packages/adapters-sillytavern/src/index.ts"),
      "@tavern/client-helpers": resolve(rootDir, "packages/official-integration-kit/client-helpers/src/index.ts"),
      "@tavern/core": resolve(rootDir, "packages/core/src/index.ts"),
      "@tavern/sdk": resolve(rootDir, "packages/official-integration-kit/sdk/src/index.ts"),
      "@tavern/shared": resolve(rootDir, "packages/shared/src/index.ts")
    }
  },
  test: {
    coverage: {
      provider: "v8",
      exclude: [
        "**/generated/**",
        "**/scripts/**",
        "**/drizzle/**",
        "apps/web/**",
        "**/*.d.ts",
        "**/node_modules/**",
        "vitepress/**",
        "coverage/**",
        "**/db/migrate.ts"
      ]
    }
  }
});
