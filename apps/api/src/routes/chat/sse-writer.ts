import type { ServerResponse } from "node:http";

export function writeSse(rawReply: ServerResponse, event: string, data: unknown): void {
  if (rawReply.writableEnded || rawReply.destroyed) {
    return;
  }

  const payload = JSON.stringify(data);
  try {
    rawReply.write(`event: ${event}\n`);
    rawReply.write(`data: ${payload}\n\n`);
  } catch {
    // 客户端可能已断连，静默忽略。
  }
}
