---
outline: [2, 3]
---

# MCP Servers（MCP 服务器）

MCP（Model Context Protocol）接口用来把外部工具服务器接到 TavernHeadless 里。

接入后，这些外部工具会进入现有的工具系统。对上层聊天链路来说，它们和内置工具的用法保持一致。

通过 `ENABLE_MCP=true` 环境变量启用。

::: tip 账号作用域
在 `ACCOUNT_MODE=multi` 下，MCP 配置和运行时状态都是**账号私有资源**：

- `/mcp` 的 CRUD、connect、disconnect、test、tools、status、statuses 只返回当前认证账号自己的数据
- 访问其他账号的 MCP 配置会返回 `404`
- 历史全局 MCP 配置在迁移后会归属默认管理员账号（`default-admin`）
:::

## 什么时候需要看这页

- 你要把一个外部工具服务器接入 TavernHeadless。
- 你要查看某个 MCP 服务器现在是否连上、什么时候刷新过工具列表。
- 你要手动连接、断开或测试一个 MCP 服务器。

## 一个简单例子

假设你要接入一个文件系统工具服务器，可以按下面的顺序做：

1. `POST /mcp/servers`：先创建服务器配置，填写 `stdio` 或 `http` 连接信息。
2. `POST /mcp/servers/:id/connect`：主动连接这个服务器。
3. `GET /mcp/servers/:id/status`：确认它是否真的连上。
4. `GET /mcp/servers/:id/tools`：查看当前拿到了哪些工具。
5. 最后再去 `GET /sessions/:id/tools/runtime`，确认这些工具是否已经出现在某个会话的运行时工具目录里。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| MCP 服务器 | 对外提供工具列表和工具调用能力的外部服务 |
| `stdio` | 通过本地子进程连接服务器 |
| `http` | 通过远程 HTTP 连接服务器 |
| `tool_prefix` | 给工具名加前缀，避免不同服务器的工具重名 |
| `live_status` | 当前服务进程里真实的连接状态，不只是数据库里的配置 |

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
| `sort_by` | string | 接受 `created_at` / `name`，默认 `created_at` |
| `sort_order` | string | 接受 `asc` / `desc`，默认 `desc` |
| `limit` | integer | 每页条数，默认 `50` |
| `offset` | integer | 偏移量，默认 `0` |

当前实现会接收 `sort_by` 和 `sort_order`，并在 `meta` 中回显，但数据库查询顺序目前固定按 `created_at`。客户端不应把这两个字段视为已经严格生效的排序保证。

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
      "updated_at": 1719400000000,
      "live_status": {
        "attached": true,
        "reason": null,
        "state": "connected",
        "tool_count": 5,
        "connected_at": 1719400000000,
        "tools_refreshed_at": 1719400010000,
        "error": null,
        "reconnect_required": false,
        "last_timeout_at": null
      }
    }
  ],
  "meta": { "total": 1, "limit": 50, "offset": 0, "has_more": false, "sort_by": "created_at", "sort_order": "desc" }
}
```

`listServers()`、`getServer()` 以及创建、更新、toggle 的响应现在都会携带 `live_status`。

- `attached=true` 表示数据库配置已经进入当前 live runtime manager。
- `reason="disabled"` 表示配置在数据库中存在，但因为 `enabled=false` 没有进入运行时。
- `reason="manager_unavailable"` 表示当前服务没有启用 `ENABLE_MCP=true`。
- `reason="not_attached"` 表示数据库配置为 enabled，但运行时没有成功装载，调用方不应把它误判为“配置不存在”。

当 `ENABLE_MCP=true` 时，配置 CRUD 会直接同步 live `McpConnectionManager`：

- create / enable 后会把服务器加入 manager
- update 后会刷新或替换 manager 中的 live server
- disable / delete 后会从 manager 中显式移除

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
    "error": null,
    "reconnect_required": false,
    "last_timeout_at": null,
    "attached": true,
    "reason": null
  }
}
```

即使某个配置已经存在但当前没有真正挂载到 runtime manager，这个端点也会返回 `200`，并用 `attached` / `reason` 明确说明状态，而不是把它伪装成 `404`。

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

如果配置当前是 `enabled=false`，会返回 `409 mcp_server_disabled`。

### 断开服务器

```http
POST /mcp/servers/:id/disconnect
```

### 查看服务器工具

```http
GET /mcp/servers/:id/tools
```

这个端点只在服务器已经进入 runtime manager 且当前可连接时返回工具列表。

- `409 mcp_server_disabled`：配置被禁用
- `409 mcp_runtime_not_attached`：数据库里有 enabled 配置，但 runtime 尚未挂载
- `503 mcp_runtime_unavailable`：runtime 已知该服务器，但当前连接不可用

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

- MCP 工具默认 `sideEffectLevel = 'irreversible'`。在 session 基础工具权限中，必须显式设置 `allowIrreversible: true` 才能使用 MCP 工具。
- MCP 连接失败不会阻塞服务启动。工具调用失败返回 `{ error }` 而不抛异常。
- stdio 类型的服务器在系统启动时自动连接（如果 `enabled=true`），HTTP 类型按需连接。
- 多账号模式下，MCP 配置不会跨账号共享；两个账号可以创建同名配置，但彼此不可见、不可操作。

## 运行时目录与执行状态

MCP 工具在 `GET /sessions/:id/tools/runtime` 响应中会附带两类语义：

1. `catalog_source`：工具来源，取值：
   - `live`：本次从 MCP server 成功 live 拉取
   - `cached`：live 失败，回退到本地 snapshot
   - `unavailable`：live 失败且无 snapshot，**不等于**“MCP server 确认零工具”，而是“当前不可确认”
   - 这个运行时目录仍然只是 **session 级** 目录，不直接展开未来 run / node / step overlay
2. metadata basis 字段：`side_effect_level_basis` / `allowed_slots_basis` / `parameter_schema_basis` / `replay_safety_basis`。对 MCP 工具，绝大多数基线为：
   - 也允许出现 `account_override`，表示值来自账号内 MCP 配置上的本地治理覆盖
   - `side_effect_level_basis = server_default`
3. `exposure`：当会话属于 project scope 且 MCP server 受 project binding 控制时，运行时目录还会返回：
   - `scope = legacy | project_binding`
   - `server_state = enabled | disabled`
   - `allowed_tools_mode = all | allow_list`
   - `allowed_tools`

   - `allowed_slots_basis = platform_default`
   - `parameter_schema_basis = shallow_schema_projection`
   - `replay_safety_basis = inferred_from_execution_policy`

   这些 basis **不是** trust score，只用于让上层知道字段是声明值还是推导值。

MCP 工具执行失败时，执行 journal（`GET /tool-executions`）会优先使用结构化 `executionStatus` / `execution_reason_code`，而不是错误字符串推断。当前稳定 reason code 包括：

| Reason code | 对应情况 |
| ---- | ---- |
| `mcp_not_connected` | provider 未连接 |
| `mcp_connection_reconnect_required` | 本地标记需重新连接 |
| `mcp_call_timeout_uncertain` | 本地 call timeout，执行结果不确定 |
| `mcp_remote_error` | MCP 服务器返回 `isError` 响应 |
| `mcp_transport_error` | 传输层异常 |
| `mcp_provider_error` | provider 包装层异常 |
| `mcp_account_required` | deferred 执行缺少 account 上下文 |
| `mcp_invalid_provider_id` | deferred provider id 无效 |
| `mcp_server_unavailable` | deferred 执行时配置被禁用或不存在 |

如果底层未给出 `executionStatus`，`finalizeToolCallResult` 会退回到错误字符串推断，但**新接入方不应依赖这条 fallback**。

## 相关事件

| 事件名 | 触发时机 | 携带数据 |
| ------ | -------- | -------- |
| `mcp.connected` | MCP 服务器连接成功 | serverId, serverName, toolCount |
| `mcp.disconnected` | MCP 服务器断开连接 | serverId, serverName |
| `mcp.error` | MCP 服务器连接出错 | serverId, serverName, error |
