import { defineConfig } from "vitest/config";

export default defineConfig({
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
        "**/db/migrate.ts",
      ],
    },
  },
});
