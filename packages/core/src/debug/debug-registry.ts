/**
 * 调试日志进程级注册器与发射函数。
 *
 * 进程级单例，不随 deps 传递。理由：调试点是引擎各处都可能加的（不只是
 * turn-orchestrator），逐 deps 传递改动面大、易遗漏。启动时配置一次，运行期只读，
 * 与 Node 内置 `util.debuglog` 模式一致。详见设计 `.limcode/design/debug-system.md`。
 */
import type { DebugDomain, DebugLevel, DebugRecord, DebugSink } from './debug-sink.js';

let activeSink: DebugSink | undefined;

/**
 * 注册或清除当前进程的调试日志接收器。
 *
 * 传入 `undefined` 可清除（用于测试或关闭调试输出）。重复调用会替换前一个 sink。
 */
export function configureDebugSink(sink: DebugSink | undefined): void {
  activeSink = sink;
}

/** 取得当前已注册的 sink（可能为 undefined）。 */
export function getDebugSink(): DebugSink | undefined {
  return activeSink;
}

/**
 * 判断指定域是否启用。
 *
 * 调用方应据此守卫，避免在域未开时无谓构造 payload 对象：
 *
 * ```ts
 * if (isDebugEnabled('native-tool')) {
 *   emitDebug('native-tool', 'info', 'llm-raw', { ... });
 * }
 * ```
 *
 * 未注册 sink 时恒返回 false。
 */
export function isDebugEnabled(domain: DebugDomain): boolean {
  return activeSink?.isEnabled(domain) ?? false;
}

/**
 * 发射一条调试记录。
 *
 * 未注册 sink、或该域未开时短路返回，零副作用。
 *
 * 提供 `level` 省略重载：`emitDebug(domain, message, payload)` 默认 level 为 `'info'`。
 */
export function emitDebug(
  domain: DebugDomain,
  level: DebugLevel,
  message: string,
  payload?: unknown,
): void;
export function emitDebug(domain: DebugDomain, message: string, payload?: unknown): void;
export function emitDebug(
  domain: DebugDomain,
  levelOrMessage: DebugLevel | string,
  messageOrPayload?: unknown,
  payload?: unknown,
): void {
  const sink = activeSink;
  if (!sink) {
    return;
  }
  // 区分两套重载签名：第一个参数是 DebugLevel 字面量时走三参版本，否则走两参版本。
  let level: DebugLevel;
  let message: string;
  let actualPayload: unknown;
  if (
    levelOrMessage === 'debug' ||
    levelOrMessage === 'info' ||
    levelOrMessage === 'warn'
  ) {
    level = levelOrMessage;
    message = typeof messageOrPayload === 'string' ? messageOrPayload : '';
    actualPayload = payload;
  } else {
    level = 'info';
    message = levelOrMessage;
    actualPayload = messageOrPayload;
  }
  if (!sink.isEnabled(domain)) {
    return;
  }
  sink.write({ domain, level, message, payload: actualPayload, timestamp: Date.now() });
}
