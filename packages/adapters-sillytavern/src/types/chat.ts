// ── ST Chat 类型定义 ──────────────────────────────────
// SillyTavern .jsonl 聊天文件的原始数据结构。

/**
 * 聊天文件第 0 行（头部）。
 *
 * 酒馆校验只要求 `chat_metadata`、`user_name`、`name` 三者之一存在即可。
 */
export interface STChatHeader {
  /** 聊天级元数据 */
  chat_metadata?: Record<string, unknown>;
  /** 用户名（酒馆自身不使用，通常为 "unused"） */
  user_name?: string;
  /** 角色名（酒馆自身不使用，通常为 "unused"） */
  character_name?: string;
  /** 兼容字段：部分导出源只有 name 没有 user_name */
  name?: string;
}

/**
 * 聊天文件第 1~N 行（消息）。
 *
 * `mes` 和 `swipes` 同时接受字符串和对象（Chub Chat 兼容）。
 * 解析阶段会统一拍平为字符串。
 */
export interface STChatMessage {
  /** 发言者名字 */
  name: string;
  /** 是否为用户消息 */
  is_user: boolean;
  /** 消息正文。Chub Chat 中可能为 `{ message: string }` 对象 */
  mes: string | { message?: string; [key: string]: unknown };
  /** 发送时间，格式不统一 */
  send_date?: string | number;
  /** 扩展字段容器 */
  extra?: Record<string, unknown>;
  /** 候选回复列表（swipe）。元素可能为字符串或对象 */
  swipes?: (string | { message?: string; [key: string]: unknown })[];
  /** 当前选中的 swipe 索引 */
  swipe_id?: number;
  /** 是否为系统/隐藏消息 */
  is_system?: boolean;
}
