import { describe, expect, it, vi } from "vitest";

import { writeSse } from "../../chat/sse-writer.js";

describe("writeSse", () => {
  it("writes event and data lines followed by a blank line", () => {
    const write = vi.fn();
    const rawReply = {
      destroyed: false,
      writableEnded: false,
      write,
    } as const;

    writeSse(rawReply as never, "done", { ok: true });

    expect(write).toHaveBeenNthCalledWith(1, "event: done\n");
    expect(write).toHaveBeenNthCalledWith(2, 'data: {"ok":true}\n\n');
  });
});
