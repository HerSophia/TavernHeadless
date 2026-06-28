import { describe, expect, it } from "vitest";

import {
  addPort,
  emptyInterface,
  readInterface,
  removePort,
  renamePort,
  retypePort,
  writeInterface,
} from "./interface-edit";

describe("interface-edit", () => {
  it("reads a group.node interface defensively", () => {
    expect(readInterface(undefined)).toEqual(emptyInterface());
    expect(readInterface({ interface: { inputs: "nope", outputs: [{ name: "r", type: "text" }] } })).toEqual({
      inputs: [],
      outputs: [{ name: "r", type: "text" }],
    });
    // 非法类型回退 json；未命名端口被丢弃。
    expect(readInterface({ interface: { inputs: [{ name: "a", type: "weird" }, { type: "text" }], outputs: [] } })).toEqual({
      inputs: [{ name: "a", type: "json" }],
      outputs: [],
    });
  });

  it("adds ports with unique auto names", () => {
    let iface = emptyInterface();
    iface = addPort(iface, "inputs", "text");
    iface = addPort(iface, "inputs", "json");
    iface = addPort(iface, "outputs");
    expect(iface.inputs.map((p) => p.name)).toEqual(["in_1", "in_2"]);
    expect(iface.inputs.map((p) => p.type)).toEqual(["text", "json"]);
    expect(iface.outputs).toEqual([{ name: "out_1", type: "json" }]);
  });

  it("renames, retypes and removes ports immutably", () => {
    const base = { inputs: [{ name: "in_1", type: "text" as const }, { name: "in_2", type: "json" as const }], outputs: [] };
    const renamed = renamePort(base, "inputs", 0, "  Color  ");
    expect(renamed.inputs[0]?.name).toBe("Color");
    expect(base.inputs[0]?.name).toBe("in_1"); // 原对象不变

    expect(renamePort(base, "inputs", 0, "   ")).toBe(base); // 空名忽略（返回原引用）

    const retyped = retypePort(base, "inputs", 1, "messages");
    expect(retyped.inputs[1]?.type).toBe("messages");

    const removed = removePort(base, "inputs", 0);
    expect(removed.inputs.map((p) => p.name)).toEqual(["in_2"]);
  });

  it("writes the interface back into config, preserving ref", () => {
    const config = { ref: { graphId: "sub-1", versionId: "v1" }, interface: { inputs: [], outputs: [] } };
    const next = addPort(readInterface(config), "outputs", "text");
    const merged = writeInterface(config, next);
    expect(merged.ref).toEqual({ graphId: "sub-1", versionId: "v1" });
    expect((merged.interface as { outputs: unknown[] }).outputs).toEqual([{ name: "out_1", type: "text" }]);
  });
});
