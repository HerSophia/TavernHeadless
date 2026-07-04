/**
 * 调试日志接收器 port（Debug Sink）。
 *
 * core 包平时不碰文件系统、不打日志。本模块只定义 port 与类型，不做任何 IO，
 * 具体适配器（写文件 / 控制台）由 apps/api 在启动时注入。详见设计
 * `.limcode/design/debug-system.md`。
 */

/** 调试域：开放字符串，由调用方按模块自行命名（如 `native-tool`、`prompt`、`memory`）。 */
export type DebugDomain = string;

/** 调试级别：与常见日志级别对齐。 */
export type DebugLevel = 'debug' | 'info' | 'warn';

/** 一条调试记录。调用方经 `emitDebug` 构造，由 sink 落盘。 */
export interface DebugRecord {
  /** 调试域。 */
  domain: DebugDomain;
  /** 调试级别。 */
  level: DebugLevel;
  /** 可读的消息标记（如 `loop-enter`、`llm-raw`）。 */
  message: string;
  /** 任意可序列化的附载数据（可选）。 */
  payload?: unknown;
  /** 毫秒时间戳。 */
  timestamp: number;
}

/**
 * 调试日志接收器。
 *
 * 实现方负责决定哪些域输出、输出到哪里。`isEnabled` 是零成本的第一道闸门：
 * 返回 false 时调用方不构造 payload，`write` 永远不会被调用。
 */
export interface DebugSink {
  /** 判断该域是否启用。调用方据此决定是否构造 payload。 */
  isEnabled(domain: DebugDomain): boolean;
  /** 写出一条记录。仅在 `isEnabled` 返回 true 时才会被调用。 */
  write(record: DebugRecord): void;
}
