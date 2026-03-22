# 快速开始

## 环境要求

- Node.js >= 20
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

# AUTH_MODE=jwt 时启用
# AUTH_JWT_SECRET=replace-with-strong-secret

# 账号模式：single（默认）| multi
# ACCOUNT_MODE=single

# LLM Profile Vault（数据库密钥加密）
# APP_SECRETS_MASTER_KEY=replace-with-strong-secret

# 记忆系统（可选）
# ENABLE_MEMORY=true
# ENABLE_MEMORY_CONSOLIDATION=true
```

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
```
