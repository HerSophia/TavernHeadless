import { describe, expect, it } from "vitest";

import { getFloorContentMutationRejection } from "../floor-content-mutability-policy.js";

describe("getFloorContentMutationRejection", () => {
  it("rejects all content mutations on superseded floors", () => {
    expect(getFloorContentMutationRejection({
      mutationKind: "page.activate",
      floorState: "committed",
      floorSupersededAt: Date.now(),
      pageKind: "output",
    })).toEqual({
      code: "content_target_locked",
      message: "Superseded floors are read-only for page activation",
    });

    expect(getFloorContentMutationRejection({
      mutationKind: "variable.write",
      floorState: "draft",
      floorSupersededAt: Date.now(),
    })).toEqual({
      code: "content_target_locked",
      message: "Superseded floors are read-only for variable writes",
    });
  });

  it("still rejects input page activation on non-superseded floors", () => {
    expect(getFloorContentMutationRejection({
      mutationKind: "page.activate",
      floorState: "committed",
      pageKind: "input",
    })).toEqual({
      code: "page_activation_not_allowed",
      message: "Input pages cannot be activated",
    });
  });

  it("keeps committed floors read-only for non-activation mutations", () => {
    expect(getFloorContentMutationRejection({
      mutationKind: "message.update",
      floorState: "committed",
      pageKind: "output",
    })).toEqual({
      code: "content_target_locked",
      message: "Committed floors are read-only for message updates",
    });
  });

  it("still allows output page activation on committed live floors", () => {
    expect(getFloorContentMutationRejection({
      mutationKind: "page.activate",
      floorState: "committed",
      pageKind: "output",
    })).toBeNull();
  });
});
