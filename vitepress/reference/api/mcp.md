---
outline: [2, 3]
---

# MCP Servers（MCP 服务器）

MCP（Model Context Protocol）集成允许 TavernHeadless 连接外部 MCP 工具服务器，将其工具注册到现有的 Tool Calling 系统中。MCP 工具对上层完全透明，行为与内置工具一致。

通过 `ENABLE_MCP=true` 环境变量启用。

::: tip 账号作用域
在 `ACCOUNT_MODE=multi` 下，MCP 配置和运行时状态都是**账号私有资源**：

- `/mcp` 的 CRUD、connect、disconnect、test、tools、status、statuses 只返回当前认证账号自己的数据
- 访问其他账号的 MCP 配置会返回 `404`
- 历史全局 MCP 配置在迁移后会归属默认管理员账号（`default-admin`）
:::

## 传输方式

| 传输 | 说明 |
| ---- | ---- |
| `stdio` | 启动本地子进程通信。服务器启动时自动连接。 |
| `http` | 通过 Streamable HTTP 连接远程服务器。按需连接（首次访问时建立）。 |

## 配置 CRUD

### 列出服务器配置

```http
GET /mcp/servers
```

#### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `enabled` | boolean | 按启用状态过滤 |
| `sort_by` | string | 排序字段（`created_at` \| `name`，默认 `created_at`） |
| `limit` | integer | 每页条数 |
| `offset` | integer | 偏移量 |

#### 响应 `200`

```json
{
  "data": [
    {
      "id": "mcp_abc123",
      "name": "filesystem-server",
      "transport": "stdio",
      "stdio": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        "env_masked": {
          "API_TOKEN": "toke****5678"
        }
      },
      "tool_prefix": "fs",
      "enabled": true,
      "connect_timeout_ms": 30000,
      "call_timeout_ms": 60000,
      "tool_refresh_interval_ms": 300000,
      "default_side_effect_level": "irreversible",
      "created_at": 1719400000000,
      "updated_at": 1719400000000
    }
  ],
  "meta": { "total": 1, "limit": 20, "offset": 0, "has_more": false, "sort_by": "created_at", "sort_order": "desc" }
}
```

### 获取服务器配置

```http
GET /mcp/servers/:id
```

### 创建服务器配置

```http
POST /mcp/servers
```

#### 请求体（stdio 示例）

```json
{
  "name": "filesystem-server",
  "transport": "stdio",
  "stdio": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
  },
  "tool_prefix": "fs",
  "default_side_effect_level": "irreversible"
}
```

#### 请求体（http 示例）

```json
{
  "name": "remote-tools",
  "transport": "http",
  "http": {
    "url": "https://mcp.example.com/sse",
    "headers": { "Authorization": "Bearer token" }
  }
}
```

#### 字段说明

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 服务器名称（账号内唯一） |
| `transport` | string | **是** | `stdio` 或 `http` |
| `stdio` | object | transport=stdio 时必填 | `{ command, args?, env?, cwd? }` |
| `http` | object | transport=http 时必填 | `{ url, headers? }` |
| `tool_prefix` | string | 否 | 工具名称前缀，避免不同服务器的工具名冲突 |
| `enabled` | boolean | 否 | 是否启用（默认 `true`） |
| `connect_timeout_ms` | integer | 否 | 连接超时（默认 30000） |
| `call_timeout_ms` | integer | 否 | 工具调用超时（默认 60000） |
| `tool_refresh_interval_ms` | integer | 否 | 工具列表刷新间隔（默认 300000，设 0 不刷新） |
| `default_side_effect_level` | string | 否 | 该服务器工具的默认副作用级别（默认 `irreversible`） |

> 说明：
>
> - 请求体仍可提交 `stdio.env` 和 `http.headers` 明文值。
> - 列表、详情、创建、更新、toggle 响应不再回显真实 secret；`stdio` 改为返回 `env_masked`，`http` 改为返回 `headers_masked`。
> - 如果请求包含 secret，但服务端未配置 `APP_SECRETS_MASTER_KEY`，会返回 `503 secret_unavailable`。

### 更新服务器配置

```http
PATCH /mcp/servers/:id
```

部分更新。

### 删除服务器配置

```http
DELETE /mcp/servers/:id
```

### 启用/禁用服务器

```http
PATCH /mcp/servers/:id/toggle
```

#### 请求体

```json
{
  "enabled": false
}
```

## 运行时操作

### 查看连接状态

```http
GET /mcp/servers/:id/status
```

#### 响应 `200`

```json
{
  "data": {
    "server_id": "mcp_abc123",
    "server_name": "filesystem-server",
    "transport": "stdio",
    "state": "connected",
    "tool_count": 5,
    "connected_at": 1719400000000,
    "tools_refreshed_at": 1719400010000,
    "error": null
  }
}
```

#### 连接状态

| 状态 | 说明 |
| ---- | ---- |
| `disconnected` | 未连接 |
| `connecting` | 正在连接 |
| `connected` | 已连接 |
| `reconnect_required` | 需要先重连再继续使用 |
| `error` | 连接出错 |

### 查看所有连接状态

```http
GET /mcp/statuses
```

返回当前认证账号在连接管理器中的状态数组。
其他账号的状态不会出现在该接口中。

### 连接服务器

```http
POST /mcp/servers/:id/connect
```

连接或重连 MCP 服务器。如果服务器尚未在连接管理器中，会从数据库加载配置后添加。

### 断开服务器

```http
POST /mcp/servers/:id/disconnect
```

### 查看服务器工具

```http
GET /mcp/servers/:id/tools
```

#### 响应 `200`

```json
{
  "data": [
    {
      "name": "fs_read_file",
      "description": "Read the contents of a file",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "File path" }
        },
        "required": ["path"]
      },
      "side_effect_level": "irreversible",
      "source": "mcp"
    }
  ]
}
```

### 测试连接

```http
POST /mcp/servers/:id/test
```

创建临时连接，验证能否连通并列出工具，然后断开。不影响正式连接。

#### 响应 `200`

```json
{
  "data": {
    "success": true,
    "tool_count": 5,
    "duration_ms": 1200,
    "error": null
  }
}
```

## 安全说明

- MCP 工具默认 `sideEffectLevel = 'irreversible'`。在会话的工具权限中，必须显式设置 `allowIrreversible: true` 才能使用 MCP 工具。
- MCP 连接失败不会阻塞服务启动。工具调用失败返回 `{ error }` 而不抛异常。
- stdio 类型的服务器在系统启动时自动连接（如果 `enabled=true`），HTTP 类型按需连接。
- 多账号模式下，MCP 配置不会跨账号共享；两个账号可以创建同名配置，但彼此不可见、不可操作。

## 相关事件

| 事件名 | 触发时机 | 携带数据 |
| ------ | -------- | -------- |
| `mcp.connected` | MCP 服务器连接成功 | serverId, serverName, toolCount |
| `mcp.disconnected` | MCP 服务器断开连接 | serverId, serverName |
| `mcp.error` | MCP 服务器连接出错 | serverId, serverName, error |
