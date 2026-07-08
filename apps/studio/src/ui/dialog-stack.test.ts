import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetForTest, acquireScrollLock, releaseScrollLock } from "./dialog-stack";

/** 最小 document 桩：只提供 `body.style.overflow`，够覆盖滚动锁逻辑。 */
function makeDocStub(initialOverflow = ""): { body: { style: { overflow: string } } } {
  return { body: { style: { overflow: initialOverflow } } };
}

afterEach(() => {
  __resetForTest();
  vi.unstubAllGlobals();
});

describe("dialog-stack 滚动锁", () => {
  it("无 document 时安全短路，不抛错", () => {
    expect(typeof document).toBe("undefined");
    expect(() => acquireScrollLock()).not.toThrow();
    expect(() => releaseScrollLock()).not.toThrow();
  });

  it("首个 acquire 记录原值并锁定，末个 release 还原", () => {
    const doc = makeDocStub("scroll");
    vi.stubGlobal("document", doc);

    acquireScrollLock();
    expect(doc.body.style.overflow).toBe("hidden");

    releaseScrollLock();
    expect(doc.body.style.overflow).toBe("scroll");
  });

  it("多次 acquire 只记录一次原值，平衡 release 后才还原", () => {
    const doc = makeDocStub("visible");
    vi.stubGlobal("document", doc);

    acquireScrollLock(); // 记录 "visible"，置 hidden
    acquireScrollLock(); // 计数=2，不覆盖原值
    expect(doc.body.style.overflow).toBe("hidden");

    releaseScrollLock(); // 计数=1，仍锁定
    expect(doc.body.style.overflow).toBe("hidden");

    releaseScrollLock(); // 计数=0，还原 "visible"
    expect(doc.body.style.overflow).toBe("visible");
  });

  it("release 多于 acquire 时计数不越界，也不误改原值", () => {
    const doc = makeDocStub("auto");
    vi.stubGlobal("document", doc);

    releaseScrollLock(); // 计数已为 0，空操作
    expect(doc.body.style.overflow).toBe("auto");

    acquireScrollLock();
    expect(doc.body.style.overflow).toBe("hidden");

    releaseScrollLock();
    releaseScrollLock(); // 多余释放，不抛错、不越界
    expect(doc.body.style.overflow).toBe("auto");
  });
});
