import { describe, expect, it } from "vitest";

import type { AssetKind, AssetSelection } from "../assets/types";
import { buildCreateSessionOptions, type CreateSessionInput } from "./create-session";

/** 构造一条资产选择（默认跟随最新：version=null 且无 versionId）。 */
function sel(kind: AssetKind, over: Partial<AssetSelection> = {}): AssetSelection {
  return { kind, id: `${kind}-id`, name: `${kind} name`, version: null, ...over };
}

describe("buildCreateSessionOptions", () => {
  it("returns only projectId for empty input (backward compatible)", () => {
    expect(buildCreateSessionOptions("p1")).toEqual({ projectId: "p1" });
    expect(buildCreateSessionOptions("p1", {})).toEqual({ projectId: "p1" });
  });

  it("includes a trimmed non-empty title and omits a blank one", () => {
    expect(buildCreateSessionOptions("p1", { title: "  Hello  " })).toEqual({
      projectId: "p1",
      title: "Hello",
    });
    expect(buildCreateSessionOptions("p1", { title: "   " })).toEqual({ projectId: "p1" });
  });

  it("maps a character to characterId and locks the version when versionId is present", () => {
    const input: CreateSessionInput = {
      character: sel("character", { id: "c1", version: 3, versionId: "cv3" }),
    };
    expect(buildCreateSessionOptions("p1", input)).toEqual({
      projectId: "p1",
      characterId: "c1",
      characterVersionId: "cv3",
    });
  });

  it("omits characterVersionId when the character follows latest (version null / no versionId)", () => {
    const input: CreateSessionInput = { character: sel("character", { id: "c1" }) };
    const options = buildCreateSessionOptions("p1", input);
    expect(options).toEqual({ projectId: "p1", characterId: "c1" });
    expect(options.characterVersionId).toBeUndefined();
  });

  it("includes characterSyncPolicy only alongside a selected character", () => {
    const withChar = buildCreateSessionOptions("p1", {
      character: sel("character", { id: "c1" }),
      characterSyncPolicy: "pin",
    });
    expect(withChar).toEqual({ projectId: "p1", characterId: "c1", characterSyncPolicy: "pin" });

    // 无角色卡时，syncPolicy 不落入 options（无意义）。
    const withoutChar = buildCreateSessionOptions("p1", { characterSyncPolicy: "force" });
    expect(withoutChar).toEqual({ projectId: "p1" });
  });

  it("maps preset / worldbook / regex ids and their versionIds", () => {
    const input: CreateSessionInput = {
      preset: sel("preset", { id: "pr1", version: 2, versionId: "prv2" }),
      worldbook: sel("worldbook", { id: "wb1", version: 5, versionId: "wbv5" }),
      regex: sel("regex", { id: "rx1", version: 1, versionId: "rxv1" }),
    };
    expect(buildCreateSessionOptions("p1", input)).toEqual({
      projectId: "p1",
      presetId: "pr1",
      presetVersionId: "prv2",
      worldbookProfileId: "wb1",
      worldbookVersionId: "wbv5",
      regexProfileId: "rx1",
      regexProfileVersionId: "rxv1",
    });
  });

  it("omits versionIds for preset / worldbook / regex when following latest", () => {
    const input: CreateSessionInput = {
      preset: sel("preset", { id: "pr1" }),
      worldbook: sel("worldbook", { id: "wb1" }),
      regex: sel("regex", { id: "rx1" }),
    };
    expect(buildCreateSessionOptions("p1", input)).toEqual({
      projectId: "p1",
      presetId: "pr1",
      worldbookProfileId: "wb1",
      regexProfileId: "rx1",
    });
  });

  it("ignores null asset selections (unselected)", () => {
    const input: CreateSessionInput = {
      character: null,
      preset: null,
      worldbook: null,
      regex: null,
    };
    expect(buildCreateSessionOptions("p1", input)).toEqual({ projectId: "p1" });
  });

  it("includes promptMode when provided", () => {
    expect(buildCreateSessionOptions("p1", { promptMode: "native" })).toEqual({
      projectId: "p1",
      promptMode: "native",
    });
  });

  it("includes toolPresetKey when a non-empty key is provided", () => {
    expect(buildCreateSessionOptions("p1", { toolPresetKey: "asset-management" })).toEqual({
      projectId: "p1",
      toolPresetKey: "asset-management",
    });
  });

  it("omits toolPresetKey when empty / null (follows original policy)", () => {
    expect(buildCreateSessionOptions("p1", { toolPresetKey: "" })).toEqual({ projectId: "p1" });
    expect(buildCreateSessionOptions("p1", { toolPresetKey: null })).toEqual({ projectId: "p1" });
  });

  it("maps a full selection across all fields", () => {
    const input: CreateSessionInput = {
      title: "Full",
      character: sel("character", { id: "c1", version: 1, versionId: "cv1" }),
      characterSyncPolicy: "manual",
      preset: sel("preset", { id: "pr1", version: 1, versionId: "prv1" }),
      worldbook: sel("worldbook", { id: "wb1" }),
      regex: sel("regex", { id: "rx1", version: 2, versionId: "rxv2" }),
      promptMode: "compat_plus",
      toolPresetKey: "asset-management",
    };
    expect(buildCreateSessionOptions("p1", input)).toEqual({
      projectId: "p1",
      title: "Full",
      characterId: "c1",
      characterVersionId: "cv1",
      characterSyncPolicy: "manual",
      presetId: "pr1",
      presetVersionId: "prv1",
      worldbookProfileId: "wb1",
      regexProfileId: "rx1",
      regexProfileVersionId: "rxv2",
      promptMode: "compat_plus",
      toolPresetKey: "asset-management",
    });
  });
});
