---
outline: [2, 3]
---

# MCP Servers（MCP 服务器）

MCP（Model Context Protocol）集成允许 TavernHeadless 连接外部 MCP 工具服务器，将其工具注册到现有的 Tool Calling 系统中。MCP 工具对上层完全透明，行为与内置工具一致。

通过 `ENABLE_MCP=true` 环境变量启用。

## 传输方式

| 传输 | 说明 |
| ---- | ---- |
| `stdio` | 启动本地子进程通信。服务器启动时自动连接。 |
| `http` | 通过 Streamable HTTP 连接远程服务器。按需连接（首次访问时建立）。 |

## 配置 CRUD

### GET /mcp/servers

列出所有 MCP 服务器配置。

**查询参数**

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `enabled` | boolean | 按启用状态过滤 |
| `sort_by` | string | 排序字段（`created_at` \| `name`，默认 `created_at`） |
| `limit` | integer | 每页条数 |
| `offset` | integer | 偏移量 |

**响应**

```json
{
  "data": [
    {
      "id": "mcp_abc123",
      "name": "filesystem-server",
      "transport": "stdio",
      "stdio": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      },
      "http": null,
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
  "meta": { "total": 1, "limit": 20, "offset": 0, "has_more": false }
}
```

### GET /mcp/servers/:id

获取单个 MCP 服务器配置。

### POST /mcp/servers

创建 MCP 服务器配置。

**请求体（stdio 示例）**

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

**请求体（http 示例）**

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

**字段说明**

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | 是 | 服务器名称（唯一） |
| `transport` | string | 是 | `stdio` 或 `http` |
| `stdio` | object | transport=stdio 时必填 | `{ command, args?, env?, cwd? }` |
| `http` | object | transport=http 时必填 | `{ url, headers? }` |
| `tool_prefix` | string | 否 | 工具名称前缀，避免不同服务器的工具名冲突 |
| `enabled` | boolean | 否 | 是否启用（默认 `true`） |
| `connect_timeout_ms` | integer | 否 | 连接超时（默认 30000） |
| `call_timeout_ms` | integer | 否 | 工具调用超时（默认 60000） |
| `tool_refresh_interval_ms` | integer | 否 | 工具列表刷新间隔（默认 300000，设 0 不刷新） |
| `default_side_effect_level` | string | 否 | 该服务器工具的默认副作用级别（默认 `irreversible`） |

### PATCH /mcp/servers/:id

更新 MCP 服务器配置（部分更新）。

### DELETE /mcp/servers/:id

删除 MCP 服务器配置。

### PATCH /mcp/servers/:id/toggle

启用或禁用 MCP 服务器。

**请求体**

```json
{
  "enabled": false
}
```

## 运行时操作

### GET /mcp/servers/:id/status

查看单个服务器的连接状态。

**响应**

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

**连接状态**

| 状态 | 说明 |
| ---- | ---- |
| `disconnected` | 未连接 |
| `connecting` | 正在连接 |
| `connected` | 已连接 |
| `error` | 连接出错 |

### GET /mcp/statuses

查看所有 MCP 服务器的连接状态。返回状态数组。

### POST /mcp/servers/:id/connect

连接或重连 MCP 服务器。如果服务器尚未在连接管理器中，会从数据库加载配置后添加。

### POST /mcp/servers/:id/disconnect

断开 MCP 服务器连接。

### GET /mcp/servers/:id/tools

查看 MCP 服务器上注册的工具列表。

**响应**

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

### POST /mcp/servers/:id/test

测试 MCP 服务器连接。创建临时连接，验证能否连通并列出工具，然后断开。不影响正式连接。

**响应**

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

## 相关事件

| 事件名 | 触发时机 | 携带数据 |
| ------ | -------- | -------- |
| `mcp.connected` | MCP 服务器连接成功 | serverId, serverName, toolCount |
| `mcp.disconnected` | MCP 服务器断开连接 | serverId, serverName |
| `mcp.error` | MCP 服务器连接出错 | serverId, serverName, error |
