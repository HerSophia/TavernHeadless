---
outline: [2, 3]
---

# 测试与 CI

所有 PR 必须满足这里的要求才能合并。

## 测试策略总览

一句话：**核心逻辑必须有测试，边缘 UI 可以先欠着，但要记账。**

优先级：

1. `packages/core`：覆盖率要求最高。
2. `packages/adapters-sillytavern`：兼容层必须有回归测试。
3. `apps/api`：接口层做集成测试。
4. `packages/shared`：工具函数和类型守卫要有单元测试。
5. `apps/web`：前端暂时不强制。

## 测试分层

### 单元测试

测单个函数、单个类。不依赖数据库、网络、文件系统。

适用：变量读取优先级、模板渲染、正则匹配、摘要提取、Token 计数、状态机流转。

### 集成测试

测多个模块协作。可以用真实数据库（内存 SQLite），但不调真实 LLM。

适用：完整楼层流程、世界书触发链路、变量提升、记忆落库、API 路由。

### 回归测试

保证酒馆兼容性。准备「输入 → 期望输出」样例。

适用：预设导入后的 Prompt IR、正则替换结果、世界书触发拼接。

## 覆盖率指标

| 包                              | 行覆盖率 | 分支覆盖率 | 函数覆盖率 |
| ------------------------------- | -------- | ---------- | ---------- |
| `packages/core`                 | ≥ 80%    | ≥ 70%      | ≥ 85%      |
| `packages/adapters-sillytavern` | ≥ 75%    | ≥ 65%      | ≥ 80%      |
| `packages/shared`               | ≥ 90%    | ≥ 80%      | ≥ 90%      |
| `apps/api`                      | ≥ 60%    | ≥ 50%      | ≥ 65%      |
| `apps/web`                      | 暂不要求 | 暂不要求   | 暂不要求   |

## 测试工具链

| 用途       | 工具                       |
| ---------- | -------------------------- |
| 测试框架   | Vitest                     |
| 覆盖率     | `@vitest/coverage-v8`      |
| HTTP 测试  | Fastify `inject()`         |
| 数据库测试 | better-sqlite3 `:memory:`  |
| 快照测试   | Vitest `toMatchSnapshot()` |

## CI 流水线

使用 GitHub Actions。为了缩短 PR 等待时间，
常规测试默认不带 coverage。
为了兼容 `main` 上现有的 required checks，
GitHub 上仍保留 3 个 `Test shard` 名称，
但内部实际拆成 6 个 test slice 并行执行，
再聚合回这 3 个 required checks。
在 `pull_request -> main` 场景下，CI 会先判断是否属于 docs-only PR。
如果命中 docs-only：

- `Lint` 只检查本次变更命中的文档文件，命中问题时只告警
- `Build` 跑 `pnpm docs:build`
- `Typecheck`、`API Smoke` 与三个 `Test shard`
  走轻量路径并快速成功

```text
Changes → Lint / Typecheck / Build / Test slices 1/6..6/6 → Test (shard 1/3, 2/3, 3/3)
API Smoke 并行执行
push 到 main / workflow_dispatch → 额外运行 Coverage
```

### 超时限制

| 阶段                       | 最大时间 |
| -------------------------- | -------- |
| Lint                       | 5 分钟   |
| Typecheck                  | 10 分钟  |
| Build                      | 10 分钟  |
| Test（每个 shard）         | 10 分钟  |
| Coverage（仅 main/manual） | 15 分钟  |
| API Smoke                  | 10 分钟  |

## 本地开发怎么跑测试

```bash
# 跑所有测试（watch 模式）
pnpm test

# 只跑某个包
pnpm --filter core test

# 只跑某个文件
pnpm test -- floor-state-machine

# 看覆盖率
pnpm test:coverage

# 跑 GitHub 内部 test slice
# 注意：这里直接调用 Vitest，避免 pnpm 脚本转发时丢失 --shard 参数
pnpm exec vitest run --reporter=verbose --shard=1/6
pnpm exec vitest run --reporter=verbose --shard=2/6
pnpm exec vitest run --reporter=verbose --shard=3/6
pnpm exec vitest run --reporter=verbose --shard=4/6
pnpm exec vitest run --reporter=verbose --shard=5/6
pnpm exec vitest run --reporter=verbose --shard=6/6

# 只改文档时的最小验证
pnpm docs:lint
pnpm docs:build

# 跑 CI 覆盖率任务
pnpm test:ci:coverage

# 跑 CI 同款检查
pnpm lint && pnpm typecheck && pnpm test:ci && pnpm build
```
