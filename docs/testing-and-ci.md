# 测试与 CI 规范

这份文档规定项目的测试策略、覆盖率指标、CI 流水线配置。所有 PR 必须满足这里的要求才能合并。

---

## 目录

1. [测试策略总览](#1-测试策略总览)
2. [测试分层与职责](#2-测试分层与职责)
3. [覆盖率指标](#3-覆盖率指标)
4. [测试工具链](#4-测试工具链)
5. [测试文件组织](#5-测试文件组织)
6. [编写规范](#6-编写规范)
7. [CI 流水线](#7-ci-流水线)
8. [本地开发怎么跑测试](#8-本地开发怎么跑测试)
9. [常见问题](#9-常见问题)

---

## 1. 测试策略总览

一句话：**核心逻辑必须有测试，边缘 UI 可以先欠着，但要记账。**

我们的优先级：

1. `packages/core`：覆盖率要求最高，这是整个系统的心脏。
2. `packages/adapters-sillytavern`：兼容层必须有回归测试，否则一升级就炸。
3. `apps/api`：接口层做集成测试，确保请求进来、响应正确。
4. `packages/shared`：工具函数和类型守卫要有单元测试。
5. `apps/web`：前端暂时不强制，但鼓励对关键交互写测试。

---

## 2. 测试分层与职责

### 单元测试（Unit）

测单个函数、单个类、单个模块。不依赖数据库、不依赖网络、不依赖文件系统。

适用范围：

- 变量系统的读取优先级逻辑
- 提示词模板渲染
- 正则规则匹配和替换
- 摘要标签提取（SummaryExtractor）
- Token 计数和预算分配
- 楼层状态机流转
- 工具函数（`packages/shared`）

要求：

- 每个测试用例只验证一件事。
- 不要在单元测试里 mock 半个世界。如果你发现需要 mock 5 个以上的依赖，说明被测代码耦合太重，先重构。
- 执行时间：单个用例不超过 100ms。整个单元测试套件不超过 30 秒。

### 集成测试（Integration）

测多个模块协作的结果。可以用真实数据库（内存 SQLite），但不调真实 LLM。

适用范围：

- 创建会话 → 创建楼层 → 写入消息 → 提交楼层的完整流程
- 世界书导入 → 触发匹配 → 注入提示词的链路
- 变量从 page 提升到 floor/chat 的流程
- 记忆提取 → 归一化 → 落库的流程
- API 路由的请求/响应（用 Fastify 的 `inject` 方法，不需要真的起 HTTP 服务器）

要求：

- LLM 调用必须用 mock/stub 替代。提供固定的返回内容，不要调真实 API。
- 数据库用内存模式的 SQLite（`:memory:`），每个测试套件独立建库，测完即弃。
- 执行时间：单个用例不超过 2 秒。整个集成测试套件不超过 3 分钟。

### 回归测试（Regression / Golden Test）

专门用来保证酒馆兼容性。准备一组「输入 → 期望输出」的样例，每次跑测试确认结果没变。

适用范围：

- 酒馆预设导入后的 Prompt IR 输出
- 酒馆正则规则的替换结果
- 酒馆世界书的触发和拼接结果
- 摘要标签提取的各种边界情况

要求：

- 样例数据放在 `tests/fixtures/` 目录下，用 JSON 文件存储。
- 每个样例文件需要注明来源（从哪个酒馆版本导出、什么预设）。
- 如果要更新期望输出，必须在 PR 描述里说明为什么变了。

### 端到端测试（E2E）

> 🚧 暂不强制，后续按需引入。

如果要做，方案是：起真实后端 + 前端，用 Playwright 跑浏览器自动化。目前阶段不要求。

---

## 3. 覆盖率指标

### 硬性门槛（CI 不过就不能合并）

| 包                              | 行覆盖率 | 分支覆盖率 | 函数覆盖率 |
| ------------------------------- | -------- | ---------- | ---------- |
| `packages/core`                 | ≥ 80%    | ≥ 70%      | ≥ 85%      |
| `packages/adapters-sillytavern` | ≥ 75%    | ≥ 65%      | ≥ 80%      |
| `packages/shared`               | ≥ 90%    | ≥ 80%      | ≥ 90%      |
| `apps/api`                      | ≥ 60%    | ≥ 50%      | ≥ 65%      |
| `apps/web`                      | 暂不要求 | 暂不要求   | 暂不要求   |

### 增量覆盖率（每个 PR）

- 新增代码的行覆盖率不低于 **80%**。
- 如果 PR 导致整体覆盖率下降超过 **2%**，CI 会报警告（不阻塞，但 Reviewer 应重点关注）。

### 怎么看覆盖率

- PR 默认不跑 coverage，避免常规检查时间过长。
- 需要 coverage 时，CI 会在 push 到 `main` 或手动触发时运行单独的 coverage job。
- 本地跑 `pnpm test:coverage` 可以在 `coverage/` 目录下看 HTML 报告。

---

## 4. 测试工具链

| 用途       | 工具                                | 为什么选它                                           |
| ---------- | ----------------------------------- | ---------------------------------------------------- |
| 测试框架   | Vitest                              | 和 Vite 生态一致，速度快，原生支持 TypeScript 和 ESM |
| 断言库     | Vitest 内置（兼容 Chai）            | 不需要额外装                                         |
| Mock       | Vitest 内置 `vi.fn()` / `vi.mock()` | 够用，不需要 sinon                                   |
| 覆盖率     | `@vitest/coverage-v8`               | V8 原生覆盖率，准确且快                              |
| HTTP 测试  | Fastify `inject()`                  | 不需要起真实服务器，直接注入请求                     |
| 数据库测试 | better-sqlite3 `:memory:`           | 每个测试用独立的内存数据库                           |
| 快照测试   | Vitest 内置 `toMatchSnapshot()`     | 用于回归测试的期望输出对比                           |

---

## 5. 测试文件组织

### 文件位置

测试文件放在被测代码旁边，用 `.test.ts` 或 `.spec.ts` 后缀：

```text
packages/core/
├── src/
│   ├── floor/
│   │   ├── floor-state-machine.ts
│   │   └── floor-state-machine.test.ts    ← 单元测试
│   ├── memory/
│   │   ├── summary-extractor.ts
│   │   └── summary-extractor.test.ts
│   └── variables/
│       ├── variable-resolver.ts
│       └── variable-resolver.test.ts
├── tests/
│   └── integration/                        ← 集成测试
│       ├── session-lifecycle.test.ts
│       └── prompt-assembly.test.ts
```

### 公共测试资源

```text
tests/
├── fixtures/                               ← 测试数据
│   ├── presets/                            ← 酒馆预设样例
│   │   ├── sample-preset-v1.json
│   │   └── sample-preset-v1.expected.json
│   ├── worldbooks/                         ← 酒馆世界书样例
│   └── regex/                              ← 酒馆正则样例
└── helpers/                                ← 测试工具函数
    ├── create-test-db.ts                   ← 创建内存数据库
    ├── mock-llm.ts                         ← LLM mock 工厂
    └── create-test-session.ts              ← 快速创建测试会话
```

---

## 6. 编写规范

### 命名

用中文或英文都行，但要描述清楚「在什么条件下、做什么操作、期望什么结果」：

```typescript
// ✅ 好的
describe('VariableResolver', () => {
  it('读取变量时优先返回 page 级别的值', () => { ... });
  it('page 级别没有时回退到 floor 级别', () => { ... });
  it('所有级别都没有时返回 undefined', () => { ... });
});

// ❌ 不好的
describe('VariableResolver', () => {
  it('test1', () => { ... });
  it('should work', () => { ... });
});
```

### 结构

每个测试用例遵循 AAA 模式：

```typescript
it("楼层状态从 draft 转到 generating 时记录时间戳", () => {
  // Arrange - 准备
  const floor = createFloor({ state: "draft" });

  // Act - 执行
  floor.transition("generating");

  // Assert - 验证
  expect(floor.state).toBe("generating");
  expect(floor.updatedAt).toBeGreaterThan(floor.createdAt);
});
```

### 禁止事项

- **不要写依赖执行顺序的测试**。每个 `it` 块必须能独立运行。用 `beforeEach` 做初始化，不要依赖前一个用例的副作用。
- **不要在测试里用 `setTimeout` 等真实定时器**。用 Vitest 的 `vi.useFakeTimers()`。
- **不要调真实的 LLM API**。用 mock。测试不能因为网络波动或 API 限流而失败。
- **不要忽略失败的测试**。如果确实需要临时跳过，用 `it.skip()` 并附上原因和 Issue 链接。
- **不要在测试里 hardcode 绝对路径**。用 `import.meta.url` 或测试工具函数来定位 fixture 文件。

### LLM Mock 约定

因为我们的系统大量依赖 LLM，mock 策略很重要：

```typescript
// tests/helpers/mock-llm.ts
import { vi } from "vitest";

export function createMockLLM(options?: {
  response?: string;
  streamChunks?: string[];
  shouldFail?: boolean;
}) {
  // 返回一个符合 LLM 实例接口的 mock 对象
  // 默认返回固定文本，可配置流式分块、失败场景
}
```

在测试中使用：

```typescript
const mockNarrator = createMockLLM({
  response: "从前有座山，山上有座庙。<summary>叙述者开始讲故事</summary>",
});

const mockMemory = createMockLLM({
  response: JSON.stringify({
    turn_summary: "叙述者开始讲故事",
    facts_add: [{ key: "故事状态", value: "已开始", scope: "chat" }],
  }),
});
```

---

## 7. CI 流水线

使用 GitHub Actions。为了缩短 PR 等待时间，
常规测试默认不带 coverage。
为了兼容 `main` 上现有的 required checks，
GitHub 上仍保留 3 个 `Test shard` 名称，
但内部实际拆成 6 个 test slice 并行执行，
再聚合回这 3 个 required checks。
在 `pull_request -> main` 场景下，CI 会先执行 `changes`
判断改动范围。
如果判定为 docs-only PR，则：

- `Lint` 只检查本次变更命中的文档文件，命中问题时只告警，不阻断 CI
- `Build` 跑 `pnpm docs:build`
- `Typecheck`、`API Smoke` 与三个 `Test shard`
  走快速成功路径

`api-smoke` 与其他 job 并行运行。
coverage 只在 push 到 `main` 或手动触发时单独运行。

### 流水线步骤

1. `changes`：判断是否 docs-only PR。
2. 每个实际执行的 job 独立安装依赖，并使用 pnpm 缓存。
3. `lint`：docs-only PR 只检查命中的文档文件，并以告警形式展示 markdownlint 结果；其余改动跑完整 lint。
4. `typecheck`：docs-only PR 快速成功，其余改动跑完整类型检查。
5. `build`：docs-only PR 跑 docs build，其余改动跑完整构建。
6. `test-slices-*`：Vitest 单元与集成测试，内部拆成 6 个 slice 并行执行，
   不带 coverage。
7. `test-shard-*`：把 6 个内部 slice 聚合为 3 个 required checks，
   保持 `main` ruleset 兼容。
8. `api-smoke`：docs-only PR 快速成功；其余改动与其他 job 并行运行，启动 `@tavern/api`
   并执行 `pnpm --filter @tavern/api smoke`。
9. `coverage`：仅在 push 到 `main` 或手动触发时运行 `pnpm test:ci:coverage`。

```text
Changes ───┬─→ Lint
           ├─→ Typecheck
           ├─→ Build
           ├─→ Test slice 1/6 ─┐
           ├─→ Test slice 2/6 ─┴─→ Test (shard 1/3)
           ├─→ Test slice 3/6 ─┐
           ├─→ Test slice 4/6 ─┴─→ Test (shard 2/3)
           ├─→ Test slice 5/6 ─┐
           ├─→ Test slice 6/6 ─┴─→ Test (shard 3/3)
           └─→ API Smoke

docs-only PR：docs lint 只告警，不阻断 CI；docs build 仍然阻断
Coverage：仅在 push 到 main / workflow_dispatch 时运行
```

### 触发条件

| 事件                  | 跑什么                                        |
| --------------------- | --------------------------------------------- |
| push 到非 `main` 分支 | 常规检查 + API smoke                          |
| PR 到 `main`          | 常规检查 + API smoke；docs-only PR 走轻量路径 |
| push 到 `main`        | 常规检查 + API smoke + coverage               |
| 手动触发              | 常规检查 + API smoke + coverage               |

### 超时限制

| 阶段                       | 最大时间 |
| -------------------------- | -------- |
| Lint                       | 5 分钟   |
| Typecheck                  | 10 分钟  |
| Build                      | 10 分钟  |
| Test（每个 shard）         | 10 分钟  |
| Coverage（仅 main/manual） | 15 分钟  |
| API Smoke                  | 10 分钟  |

如果某个 job 持续接近超时，应该先查明瓶颈，不应直接放宽限制。

### CI 配置文件

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: ['**']
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      docs_only: ${{ steps.classify.outputs.docs_only }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v4
        id: filter
        with:
          filters: .github/filters/ci-paths.yaml
  lint:
    needs: changes
    runs-on: ubuntu-latest
    steps:
      # checkout + setup pnpm + setup node + install
      - run: pnpm exec markdownlint-cli2 <changed-doc-files>   # docs-only PR
      - run: pnpm lint        # 其他 PR 与 push

  typecheck:
    needs: changes
    runs-on: ubuntu-latest
    steps:
      - run: echo "Docs-only PR: skipped"
      - run: pnpm typecheck

  build:
    needs: changes
    runs-on: ubuntu-latest
    steps:
      - run: pnpm docs:build  # docs-only PR
      - run: pnpm build       # 其他 PR 与 push

  test-slices-1:
    needs: changes
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        slice: [1, 2]
    steps:
      - run: pnpm exec vitest run --reporter=verbose --shard=${{ matrix.slice }}/6

  test-slices-2:
    needs: changes
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        slice: [3, 4]
    steps:
      - run: pnpm exec vitest run --reporter=verbose --shard=${{ matrix.slice }}/6

  test-slices-3:
    needs: changes
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        slice: [5, 6]
    steps:
      - run: pnpm exec vitest run --reporter=verbose --shard=${{ matrix.slice }}/6

  test-shard-1:
    name: Test (shard 1/3)
    needs: [changes, test-slices-1]
    steps:
      - run: echo "aggregate internal slice results here"

  test-shard-2:
    name: Test (shard 2/3)
    needs: [changes, test-slices-2]
    steps:
      - run: echo "aggregate internal slice results here"

  test-shard-3:
    name: Test (shard 3/3)
    needs: [changes, test-slices-3]
    steps:
      - run: echo "aggregate internal slice results here"

  coverage:
    if: >
      github.event_name == 'workflow_dispatch' ||
      (github.event_name == 'push' && github.ref == 'refs/heads/main')
    needs: [lint, typecheck, build, test-shard-1, test-shard-2, test-shard-3]
    runs-on: ubuntu-latest
    steps:
      # checkout + setup pnpm + setup node + install
      - run: pnpm test:ci:coverage

  api-smoke:
    needs: changes
    runs-on: ubuntu-latest
    steps:
      - run: echo "Docs-only PR: skipped"
      # checkout + setup pnpm + setup node + install
      - run: pnpm --filter @tavern/api exec tsx src/index.ts > api.log 2>&1 &
      - run: |
          for i in {1..60}; do
            curl -fsS "http://127.0.0.1:3000/health" > /dev/null && exit 0
            sleep 1
          done
          cat api.log && exit 1
      - run: pnpm --filter @tavern/api smoke
```

### 对应的 package.json 脚本

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:full": "eslint . && prettier --check .",
    "lint:fix": "eslint . --fix && prettier --write .",
    "typecheck": "pnpm -r --if-present typecheck",
    "test": "vitest",
    "test:ci": "vitest run --reporter=verbose",
    "test:ci:coverage": "vitest run --coverage --reporter=verbose",
    "test:coverage": "vitest run --coverage",
    "smoke:api": "pnpm --filter @tavern/api smoke",
    "build": "pnpm -r --if-present build"
  }
}
```

---

## 8. 本地开发怎么跑测试

### 跑所有测试

```bash
pnpm test
```

Vitest 默认进入 watch 模式，改了代码自动重跑相关测试。

### 只跑某个包的测试

```bash
# 只跑 core 的测试
pnpm --filter core test

# 只跑 adapters-sillytavern 的测试
pnpm --filter adapters-sillytavern test
```

### 只跑某个文件

```bash
pnpm test -- floor-state-machine
```

### 看覆盖率报告

```bash
pnpm test:coverage
# 然后用浏览器打开 coverage/index.html
```

### 跑 CI 分片测试

本地如果要复现 GitHub 内部 test slice，可运行：

由于 `pnpm test:ci -- --shard=...` 不会稳定透传 `--shard` 参数，这里直接调用 Vitest：

```bash
pnpm exec vitest run --reporter=verbose --shard=1/6
pnpm exec vitest run --reporter=verbose --shard=2/6
pnpm exec vitest run --reporter=verbose --shard=3/6
pnpm exec vitest run --reporter=verbose --shard=4/6
pnpm exec vitest run --reporter=verbose --shard=5/6
pnpm exec vitest run --reporter=verbose --shard=6/6
```

### 只改文档时的最小验证

```bash
pnpm docs:lint
pnpm docs:build
```

GitHub 上仍会显示 `Typecheck`、`API Smoke` 与三个 `Test shard`，
但 docs-only PR 下这些检查会走轻量路径并快速成功。

如果 docs lint 命中问题，CI 会保留告警信息，但不会因此失败。

### 跑 CI 覆盖率任务

```bash
pnpm test:ci:coverage
```

### 跑 CI 同款检查（合并前建议跑一次）

```bash
pnpm lint && pnpm typecheck && pnpm test:ci && pnpm build
```

### 跑 API 冒烟测试（需要先启动服务）

```bash
pnpm --filter @tavern/api dev
pnpm smoke:api
```

---

## 9. 常见问题

### Q：我加了个工具函数，需要写测试吗？

如果在 `packages/shared` 里，必须写。如果是某个模块的内部私有函数，通过调用它的公共接口来间接测试就行，不需要单独导出来写测试。

### Q：我改了数据库 schema，测试怎么办？

更新 `tests/helpers/create-test-db.ts` 里的建表逻辑，确保内存数据库和真实数据库 schema 一致。集成测试会自动用新 schema。

### Q：测试太慢了怎么办？

先检查是不是有测试在做不必要的 I/O 或者真实网络请求。
如果确实是计算密集型的测试（比如大量 token 计数），
考虑减少测试数据量或者标记为 `describe.concurrent` 并行跑。

### Q：覆盖率差一点点达不到门槛怎么办？

写测试。没有别的办法。
如果确实是不可测的代码（比如平台相关的 fallback 分支），
可以用 `/* v8 ignore next */` 标记排除，但需要在 PR 里说明原因。

### Q：我想加新的测试工具 / 插件？

先在 Issue 里讨论，说明为什么现有工具不够用。不要私自引入测试框架级别的新依赖。

### Q：我只改文档，为什么 PR 里仍然会显示 Typecheck、Test 和 API Smoke？

这是为了兼容 `main` 分支当前的 required checks。
docs-only PR 下，这些检查会保留原名称，
但只执行轻量路径并快速成功。
