/**
 * 调试日志环境变量注入（Debug Sink 的 apps/api 启动入口）。
 *
 * 在进程启动时调用一次 `configureDebugFromEnv()`：读取 `TAVERN_DEBUG` 环境变量，
 * 解析出启用的域名列表，创建 `FileDebugSink` 并注册到 core 进程级注册器。
 * 环境变量为空时不做任何事，调试系统完全不输出。详见设计
 * `.limcode/design/debug-system.md`。
 */
import { resolve } from "node:path";

import { configureDebugSink } from "@tavern/core";

import { FileDebugSink } from "./file-debug-sink.js";

/** 环境变量名。 */
export const TAVERN_DEBUG_ENV = "TAVERN_DEBUG";

/** 调试日志默认输出目录（相对当前工作目录）。 */
export const DEFAULT_DEBUG_LOG_DIR = "logs";

/**
 * 解析 `TAVERN_DEBUG` 环境变量原始值为域名数组。
 *
 * 规则：逗号分隔、去首尾空白、丢弃空串。空串 / 仅空白返回空数组。
 * 保留 `*`（由 sink 自行判定为通配）。
 */
export function parseDebugDomains(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * 从环境变量读取域名，创建并注册 FileDebugSink。
 *
 * `TAVERN_DEBUG` 为空时不注册任何 sink（调试关闭）。日志目录默认 `logs`（相对 cwd），
 * 可通过 `options.logDir` 覆盖（测试用）。
 */
export function configureDebugFromEnv(options?: { logDir?: string }): void {
  const domains = parseDebugDomains(process.env[TAVERN_DEBUG_ENV]);
  if (domains.length === 0) {
    return;
  }
  const logDir = resolve(process.cwd(), options?.logDir ?? DEFAULT_DEBUG_LOG_DIR);
  configureDebugSink(new FileDebugSink(domains, logDir));
}
