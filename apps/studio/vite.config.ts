import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

const fromHere = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5174,
    host: "0.0.0.0"
  },
  preview: {
    port: 4174,
    host: "0.0.0.0"
  },
  test: {
    // 测试态把 workspace 包解析到源码（与根 vitest.config 一致、顺序敏感：子路径在前）。
    // 使 studio 测试无需预先构建依赖 dist 即可运行——CI 的 studio-test job 不跑 build。
    alias: [
      { find: "@tavern/core/node-graph", replacement: fromHere("../../packages/core/src/node-graph/browser.ts") },
      { find: "@tavern/core", replacement: fromHere("../../packages/core/src/index.ts") },
      { find: "@tavern/sdk", replacement: fromHere("../../packages/official-integration-kit/sdk/src/index.ts") },
      { find: "@tavern/client-helpers", replacement: fromHere("../../packages/official-integration-kit/client-helpers/src/index.ts") },
      { find: "@tavern/shared", replacement: fromHere("../../packages/shared/src/index.ts") }
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      // 覆盖率聚焦**单元/集成测试覆盖的纯逻辑与 store / 客户端层**；
      // .vue 组件、shell（router/i18n/layout/ui）、薄 re-export 与 DOM composable
      // 按前端分层（参考 docs/testing-and-ci.md：前端覆盖率按 app 设定）走人工/后续 e2e，不计入门槛。
      include: [
        "src/stores/graph-editor.ts",
        "src/stores/chat.ts",
        "src/lib/nodegraph-api/client.ts",
        "src/lib/chat/stream.ts",
        "src/modules/graph/canvas/map-document.ts",
        "src/modules/graph/layout/elk-adapter.ts",
        "src/modules/graph/validate/local-validation.ts",
        "src/modules/chat/trace/map-trace.ts"
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70
      }
    }
  }
});
