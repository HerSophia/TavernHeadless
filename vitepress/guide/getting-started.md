# 快速开始

## 环境要求

- Node.js >= 22.22.2
- pnpm >= 9
- Git >= 2.30

## 安装

```bash
# 克隆
git clone https://github.com/HerSophia/TavernHeadless.git
cd TavernHeadless

# 安装依赖
pnpm install
```

## 配置

```bash
# 复制环境变量模板
cp .env.example .env
```

至少需要设置 `LLM_API_KEY`，其余保持默认即可。

### 环境变量说明

```bash
# 认证模式：off | api_key | jwt
AUTH_MODE=off

# AUTH_MODE=api_key 时启用
# AUTH_API_KEYS=dev-key-1,dev-key-2
# ACCOUNT_MODE=multi + AUTH_MODE=api_key 时必填
# AUTH_API_KEY_ACCOUNTS=dev-key-1:default-admin,dev-key-2:workspace-a

# AUTH_MODE=jwt 时启用
# AUTH_JWT_SECRET=replace-with-strong-secret
# ACCOUNT_MODE=multi + AUTH_MODE=jwt 时可选
# 默认从 account_id claim 读取账号
# AUTH_JWT_ACCOUNT_CLAIM=account_id

# 账号模式：single（默认）| multi
# ACCOUNT_MODE=single
# 注意：ACCOUNT_MODE=multi 不能与 AUTH_MODE=off 一起使用

# 生产环境保护
# NODE_ENV=production 时不能使用 AUTH_MODE=off

# 认证后的角色和状态以数据库 account 行中的 role / status 为准
# JWT 的 role claim 不直接授予管理员权限

# WebSocket 事件转发（默认开启）
# ENABLE_WEBSOCKET=true

# LLM Profile Vault（数据库密钥加密）
# APP_SECRETS_MASTER_KEY=replace-with-strong-secret

# 记忆系统（可选）
# ENABLE_MEMORY=true
# ENABLE_MEMORY_CONSOLIDATION=true
# ENABLE_ASYNC_MEMORY_INGEST=true
# ENABLE_MACRO_COMPACTION=true
# ENABLE_DUAL_SUMMARY_INJECTION=true
# ENABLE_MEMORY_MAINTENANCE=true

# 可选：MemoryWorker 调优
# MEMORY_WORKER_POLL_INTERVAL_MS=2000
# MEMORY_WORKER_LEASE_TTL_MS=120000
# MEMORY_WORKER_MAX_CONCURRENT_JOBS=4
# MEMORY_WORKER_RETRY_BASE_DELAY_MS=1000
# MEMORY_WORKER_MAX_RETRY_DELAY_MS=30000
# MEMORY_WORKER_CANDIDATE_SCAN_LIMIT=32

# 核心资产备份（可选）
# ENABLE_BACKUP_WORKER=true
# BACKUP_WORKER_POLL_INTERVAL_MS=2000
# BACKUP_WORKER_LEASE_TTL_MS=120000
# BACKUP_WORKER_MAX_CONCURRENT_JOBS=1
# BACKUP_WORKER_RETRY_BASE_DELAY_MS=1000
# BACKUP_WORKER_MAX_RETRY_DELAY_MS=30000
# BACKUP_WORKER_CANDIDATE_SCAN_LIMIT=32
# BACKUP_ARTIFACT_DIR=data/backup-artifacts
# BACKUP_IMPORT_MAX_BYTES=50000000
# BACKUP_EXPORT_ARTIFACT_TTL_MS=86400000

# MCP 工具集成（可选）
# ENABLE_MCP=true
```

`AUTH_MODE=off` 只建议用于本地开发。当前服务会在 `NODE_ENV=production && AUTH_MODE=off` 时直接拒绝启动。

`/health`、`/version`、`/openapi.json`、`/docs`、`/docs/*` 这些 public path 始终按匿名请求处理，不会继承管理员上下文。

## 启动

```bash
# 交互选择：后端 / 前端 / 双端
pnpm dev
```

Windows 也可以直接运行：

```bat
dev-select.bat
```

也支持无交互启动：

```bash
pnpm dev:api    # 仅后端
pnpm dev:web    # 仅前端
pnpm dev:both   # 同时启动
```

如果你要执行异步核心资产备份，还需要单独启动 backup worker：

```bash
# 先在 .env 中设置 ENABLE_BACKUP_WORKER=true
pnpm --filter @tavern/api jobs:backup
```

`POST /backup/jobs/export`、`POST /backup/jobs/restore` 和 `GET /backup-jobs/*`
这组接口都依赖后台 worker 持续处理作业。

## 验证

启动后可访问：

| 地址 | 说明 |
| ---- | ---- |
| `http://localhost:3000/health` | 健康检查 |
| `http://localhost:3000/openapi.json` | OpenAPI JSON |
| `http://localhost:3000/docs/` | Swagger UI |

## 常用命令

```bash
# 类型检查
pnpm --filter @tavern/api typecheck

# 运行测试
pnpm --filter @tavern/api test

# 导出 OpenAPI + 生成 SDK
pnpm sdk:generate

# 校验 SDK 产物是否最新
pnpm sdk:check

# Lint
pnpm lint

# 文档站开发
pnpm --filter @tavern/docs dev

# 运行核心资产备份 worker
pnpm --filter @tavern/api jobs:backup
```
