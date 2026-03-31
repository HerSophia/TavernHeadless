import { describe, expect, it } from "vitest";

import { RuntimeRevisionConflictError, RuntimeRevisionGuard } from "../runtime-revision-guard.js";

describe("RuntimeRevisionGuard", () => {
  it("throws when the runtime scope revision no longer matches the snapshot", () => {
    const guard = new RuntimeRevisionGuard();
    const snapshot = guard.snapshot({
      accountId: "default-admin",
      scopeType: "memory",
      scopeKey: "chat:session-1",
    }, 1);

    expect(() => guard.assertExpected(snapshot, 2)).toThrow(RuntimeRevisionConflictError);
  });
});
