import { describe, expect, it, vi } from "vitest"

import { MutationApplierRegistry } from "../mutation-applier-registry.js"
import { RuntimeMutationApplierNotFoundError } from "../runtime-mutation-errors.js"

describe("MutationApplierRegistry", () => {
  it("registers and resolves mutation appliers by kind", () => {
    const registry = new MutationApplierRegistry()
    const applier = {
      apply: vi.fn(() => ({ result: { ok: true } })),
    }

    registry.register("test.echo", applier)

    expect(registry.find("test.echo")).toBe(applier)
    expect(registry.get("test.echo")).toBe(applier)
    expect(registry.listKinds()).toEqual(["test.echo"])
  })

  it("rejects duplicate registrations and unknown kinds", () => {
    const registry = new MutationApplierRegistry()
    const applier = {
      apply: () => ({ result: undefined }),
    }

    registry.register("test.echo", applier)

    expect(() => registry.register("test.echo", applier)).toThrow(
      "Runtime mutation applier already registered: test.echo",
    )
    expect(() => registry.get("missing.kind")).toThrow(RuntimeMutationApplierNotFoundError)
  })
})
