import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { configDefaults, defineConfig } from "vitest/config";

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
    // apps/studio 是现代化先锋（vitest 4），用它自己的测试任务运行；
    // 根工作区 vitest（2.x）不发现 studio 测试，避免版本冲突。
    exclude: [...configDefaults.exclude, "apps/studio/**"],
    coverage: {
      provider: "v8",
      exclude: [
        "**/generated/**",
        "**/scripts/**",
        "**/drizzle/**",
        "apps/web/**",
        "apps/studio/**",
        "**/*.d.ts",
        "**/node_modules/**",
        "vitepress/**",
        "coverage/**",
        "**/db/migrate.ts"
      ]
    }
  }
});
