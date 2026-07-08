import { describe, expect, it } from "vitest";

import {
  applyPresetRefToConfig,
  applySubgraphRefToConfig,
  readNarratorAgentSource,
  readNarratorPresetRefInputs,
  readNarratorSubgraphRefInputs,
  switchNarratorAgentSource,
} from "./narrator-source-edit";

describe("readNarratorAgentSource", () => {
  it("defaults to preset for missing / non-subgraph source", () => {
    expect(readNarratorAgentSource(undefined)).toBe("preset");
    expect(readNarratorAgentSource({})).toBe("preset");
    expect(readNarratorAgentSource({ source: "preset" })).toBe("preset");
    expect(readNarratorAgentSource({ source: "bogus" })).toBe("preset");
  });

  it("reads subgraph when source is subgraph", () => {
    expect(readNarratorAgentSource({ source: "subgraph" })).toBe("subgraph");
  });
});

describe("readNarratorPresetRefInputs / readNarratorSubgraphRefInputs", () => {
  it("reads presetRef strings, empty fallback", () => {
    expect(
      readNarratorPresetRefInputs({
        presetRef: { presetId: "p1", presetVersionId: "v2" },
      }),
    ).toEqual({
      presetId: "p1",
      presetVersionId: "v2",
    });
    expect(
      readNarratorPresetRefInputs({
        presetRef: { presetId: "p1", presetVersionId: null },
      }),
    ).toEqual({
      presetId: "p1",
      presetVersionId: "",
    });
    expect(readNarratorPresetRefInputs({})).toEqual({
      presetId: "",
      presetVersionId: "",
    });
  });

  it("reads subgraphRef strings, empty fallback", () => {
    expect(
      readNarratorSubgraphRefInputs({
        subgraphRef: { graphId: "g1", versionId: "v3" },
      }),
    ).toEqual({
      graphId: "g1",
      versionId: "v3",
    });
    expect(
      readNarratorSubgraphRefInputs({
        subgraphRef: { graphId: "g1", versionId: null },
      }),
    ).toEqual({
      graphId: "g1",
      versionId: "",
    });
    expect(readNarratorSubgraphRefInputs(undefined)).toEqual({
      graphId: "",
      versionId: "",
    });
  });
});

describe("applyPresetRefToConfig", () => {
  it("writes presetRef with null version when version empty", () => {
    expect(
      applyPresetRefToConfig({}, { presetId: "p1", presetVersionId: "" }),
    ).toEqual({
      presetRef: { presetId: "p1", presetVersionId: null },
    });
  });

  it("writes presetRef with version when provided (and trims)", () => {
    expect(
      applyPresetRefToConfig({}, { presetId: " p1 ", presetVersionId: " v2 " }),
    ).toEqual({
      presetRef: { presetId: "p1", presetVersionId: "v2" },
    });
  });

  it("deletes presetRef and falls back when presetId empty", () => {
    expect(
      applyPresetRefToConfig(
        { presetRef: { presetId: "old", presetVersionId: null } },
        {
          presetId: "",
          presetVersionId: "",
        },
      ),
    ).toEqual({});
  });

  it("does not mutate the input config", () => {
    const input = { presetRef: { presetId: "old", presetVersionId: null } };
    applyPresetRefToConfig(input, { presetId: "new", presetVersionId: "" });
    expect(input.presetRef.presetId).toBe("old");
  });
});

describe("applySubgraphRefToConfig", () => {
  it("writes subgraphRef with null version when version empty", () => {
    expect(
      applySubgraphRefToConfig({}, { graphId: "g1", versionId: "" }),
    ).toEqual({
      subgraphRef: { graphId: "g1", versionId: null },
    });
  });

  it("deletes subgraphRef when graphId empty", () => {
    expect(
      applySubgraphRefToConfig(
        { subgraphRef: { graphId: "old", versionId: null } },
        {
          graphId: "",
          versionId: "",
        },
      ),
    ).toEqual({});
  });
});

describe("switchNarratorAgentSource (mutual exclusion)", () => {
  const inputs = {
    preset: { presetId: "p1", presetVersionId: "" },
    subgraph: { graphId: "g1", versionId: "" },
  };

  it("switching to subgraph sets source, clears presetRef, writes subgraphRef", () => {
    const next = switchNarratorAgentSource(
      {
        source: "preset",
        presetRef: { presetId: "p1", presetVersionId: null },
      },
      "subgraph",
      inputs,
    );
    expect(next).toEqual({
      source: "subgraph",
      subgraphRef: { graphId: "g1", versionId: null },
    });
    expect(next.presetRef).toBeUndefined();
  });

  it("switching to preset sets source, clears subgraphRef, writes presetRef", () => {
    const next = switchNarratorAgentSource(
      { source: "subgraph", subgraphRef: { graphId: "g1", versionId: null } },
      "preset",
      inputs,
    );
    expect(next).toEqual({
      source: "preset",
      presetRef: { presetId: "p1", presetVersionId: null },
    });
    expect(next.subgraphRef).toBeUndefined();
  });

  it("switching to subgraph with empty graphId leaves no subgraphRef but records source", () => {
    const next = switchNarratorAgentSource({}, "subgraph", {
      preset: { presetId: "", presetVersionId: "" },
      subgraph: { graphId: "", versionId: "" },
    });
    expect(next).toEqual({ source: "subgraph" });
  });
});
