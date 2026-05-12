import { describe, expect, it } from "vitest";

import { VcDiffService } from "../vc-diff-service.js";

describe("VcDiffService", () => {
  it("returns summary changes with hashes and previews", () => {
    const diff = new VcDiffService().diff(
      { title: "old", enabled: true },
      { title: "new", enabled: true, count: 1 },
    );

    expect(diff.mode).toBe("summary");
    expect(diff.truncated).toBe(false);
    expect(diff.changes).toHaveLength(2);
    expect(diff.changes.find((change) => change.path === "title")).toMatchObject({
      change_type: "changed",
      before_preview: "old",
      after_preview: "new",
      redacted: false,
    });
    expect(diff.changes.find((change) => change.path === "count")).toMatchObject({
      change_type: "added",
      after_preview: 1,
    });
  });

  it("redacts sensitive paths by default", () => {
    const diff = new VcDiffService().diff(
      { message: { content: "secret old text" }, api_key: "old-key" },
      { message: { content: "secret new text" }, api_key: "new-key" },
    );

    expect(JSON.stringify(diff)).not.toContain("secret old text");
    expect(JSON.stringify(diff)).not.toContain("secret new text");
    expect(JSON.stringify(diff)).not.toContain("old-key");
    expect(JSON.stringify(diff)).not.toContain("new-key");
    expect(diff.changes.every((change) => change.redacted === true)).toBe(true);
    expect(diff.changes.every((change) => typeof change.before_hash === "string" || typeof change.after_hash === "string")).toBe(true);
  });

  it("supports full mode for non-sensitive paths", () => {
    const diff = new VcDiffService().diff(
      { config: { temperature: 0.7 } },
      { config: { temperature: 0.9 } },
      { mode: "full" },
    );

    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toMatchObject({
      path: "config.temperature",
      change_type: "changed",
      before_value: 0.7,
      after_value: 0.9,
      redacted: false,
    });
  });

  it("strips value fields when maxBytes is exceeded", () => {
    const diff = new VcDiffService().diff(
      { title: "a".repeat(200) },
      { title: "b".repeat(200) },
      { maxBytes: 220 },
    );

    expect(diff.truncated).toBe(true);
    expect(JSON.stringify(diff).length).toBeLessThanOrEqual(220);
    expect(diff.changes[0]?.before_preview).toBeUndefined();
    expect(diff.changes[0]?.after_preview).toBeUndefined();
  });
});
