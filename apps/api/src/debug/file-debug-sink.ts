/**
 * 文件调试日志接收器（Debug Sink 的 apps/api 适配器）。
 *
 * 把按域开关的调试记录同时输出到 stdout（便于实时观察）与文件
 * `logDir/debug-<domain>.log`（追加，便于事后排查）。写文件失败静默，不阻断业务。
 *
 * 受 `TAVERN_DEBUG` 环境变量驱动（由 `configure-debug.ts` 解析后构造本类）。详见设计
 * `.limcode/design/debug-system.md`。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { DebugRecord, DebugSink } from "@tavern/core";

/**
 * 安全序列化 payload：JSON.stringify 失败时降级，避免循环引用 / BigInt 等导致抛错。
 */
export function safeStringify(payload: unknown): string {
  try {
    return JSON.stringify(payload);
  } catch {
    // 降级：用带循环引用保护的 replacer 再试一次；仍失败则给占位串。
    try {
      const seen = new WeakSet();
      return JSON.stringify(payload, (_key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) {
            return "[Circular]";
          }
          seen.add(value);
        }
        if (typeof value === "bigint") {
          return value.toString();
        }
        return value;
      });
    } catch {
      return String(payload);
    }
  }
}

/**
 * 按域写文件的调试日志接收器。
 *
 * 构造时传入启用的域名集合与日志目录。`isEnabled` 支持 `*` 通配（全开）与精确匹配。
 * 文件路径为 `logDir/debug-<domain>.log`，追加写入；目录在首次写入时按需创建。
 */
export class FileDebugSink implements DebugSink {
  private readonly enabled: Set<string>;
  private readonly logDir: string;
  private dirReady = false;

  constructor(domains: string[], logDir: string) {
    this.enabled = new Set(domains);
    this.logDir = logDir;
  }

  isEnabled(domain: string): boolean {
    return this.enabled.has("*") || this.enabled.has(domain);
  }

  write(record: DebugRecord): void {
    // 防御：即使调用方未先经 isEnabled 过滤，未启用的域也不产生任何输出，与契约语义保持一致。
    if (!this.isEnabled(record.domain)) {
      return;
    }
    const line = this.format(record);
    // eslint-disable-next-line no-console
    console.log(line);
    this.appendLine(record.domain, line);
  }

  private format(record: DebugRecord): string {
    const ts = new Date(record.timestamp).toISOString();
    const payloadPart =
      record.payload === undefined ? "" : ` ${safeStringify(record.payload)}`;
    return `${ts} [${record.domain}] ${record.level.toUpperCase()} ${record.message}${payloadPart}`;
  }

  private appendLine(domain: string, line: string): void {
    if (!this.dirReady) {
      try {
        mkdirSync(this.logDir, { recursive: true });
        this.dirReady = true;
      } catch {
        // 目录创建失败：仍尝试写一次，appendFileSync 可能因父目录缺失而失败并静默。
      }
    }
    const filePath = join(this.logDir, `debug-${domain}.log`);
    try {
      appendFileSync(filePath, line + "\n", { encoding: "utf8" });
    } catch {
      // 写入失败（权限 / 磁盘）不致命：调试日志不应阻断业务。
    }
  }
}
