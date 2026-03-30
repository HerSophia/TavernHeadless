import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";

import { TavernApiError } from "@tavern/sdk";

import type { WorkspacePresetEditorDocument } from "../../../lib/workspace-api";
import type { WorkspaceAsset } from "../types";

const workspaceApiMocks = vi.hoisted(() => ({
  createCharacterAssetVersion: vi.fn(),
  deleteCharacterAsset: vi.fn(),
  deletePresetAsset: vi.fn(),
  deleteWorldbookAsset: vi.fn(),
  fetchCharacterAssetDetail: vi.fn(),
  fetchPresetAssetEditorDetail: vi.fn(),
  fetchWorldbookAssetDetail: vi.fn(),
  importLibraryAsset: vi.fn(),
  restoreCharacterAsset: vi.fn(),
  updatePresetAsset: vi.fn(),
  updateWorldbookAsset: vi.fn()
}));

vi.mock("../../../lib/workspace-api", () => workspaceApiMocks);

import { createAssetsActions } from "./assets";

function createPresetEditorDocument(): WorkspacePresetEditorDocument {
  return {
    defaultCharacterId: 0,
    entries: [
      {
        content: "Preset content",
        enabled: true,
        extra: {},
        identifier: "entry_1",
        injectionPosition: 0,
        marker: false,
        name: "Entry 1",
        role: "system",
        systemPrompt: false
      }
    ],
    format: "st-raw",
    orderContexts: [
      {
        characterId: 0,
        extra: {},
        order: [{ enabled: true, identifier: "entry_1" }]
      }
    ],
    topLevel: {}
  };
}

function createWorkspaceAsset(asset: Pick<WorkspaceAsset, "id" | "kind" | "name">): WorkspaceAsset {
  return {
    account: "account-1",
    favorite: false,
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    summary: "",
    tags: [],
    updatedAt: 1,
    uses: 0
  };
}

function createActions(asset: WorkspaceAsset) {
  return createAssetsActions({
    activeSession: computed(() => null),
    currentAccount: computed(() => "account-1"),
    findLibraryAsset: (assetId) => (assetId === asset.id ? asset : null),
    hydrateLibraryAssets: async () => ({
      apiSyncFailed: false,
      count: 1
    }),
    libraryAssets: computed(() => [asset]),
    sessions: ref([]),
    syncSessionWorldbookCount: vi.fn(),
    touchLibraryAsset: vi.fn()
  });
}

describe("createAssetsActions", () => {
  it("maps preset_conflict for preset saves and forwards expectedVersion", async () => {
    workspaceApiMocks.updatePresetAsset.mockRejectedValueOnce(new TavernApiError({
      code: "preset_conflict",
      message: "Preset version mismatch",
      status: 409
    }));

    const actions = createActions(createWorkspaceAsset({ id: "preset-1", kind: "preset", name: "Preset 1" }));

    const result = await actions.savePresetAsset("preset-1", "Preset 1", createPresetEditorDocument(), 4, "update");

    expect(workspaceApiMocks.updatePresetAsset).toHaveBeenCalledWith(
      "preset-1",
      "Preset 1",
      expect.objectContaining({
        default_character_id: 0,
        top_level: {}
      }),
      4,
      "account-1"
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        reason: "preset_conflict"
      })
    );
  });

  it("maps resource_busy for preset deletes and forwards expectedVersion", async () => {
    workspaceApiMocks.deletePresetAsset.mockRejectedValueOnce(new TavernApiError({
      code: "resource_busy",
      message: "Resource is temporarily busy, please retry",
      status: 503
    }));

    const actions = createActions(createWorkspaceAsset({ id: "preset-1", kind: "preset", name: "Preset 1" }));

    const result = await actions.deletePresetLibraryAsset("preset-1", 7);

    expect(workspaceApiMocks.deletePresetAsset).toHaveBeenCalledWith("preset-1", 7, "account-1");
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        reason: "resource_busy"
      })
    );
  });

  it("maps worldbook_conflict for worldbook deletes and forwards expectedVersion", async () => {
    workspaceApiMocks.deleteWorldbookAsset.mockRejectedValueOnce(new TavernApiError({
      code: "worldbook_conflict",
      message: "Worldbook version mismatch",
      status: 409
    }));

    const actions = createActions(createWorkspaceAsset({ id: "worldbook-1", kind: "worldbook", name: "Worldbook 1" }));

    const result = await actions.deleteWorldbookLibraryAsset("worldbook-1", 9);

    expect(workspaceApiMocks.deleteWorldbookAsset).toHaveBeenCalledWith("worldbook-1", 9, "account-1");
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        reason: "worldbook_conflict"
      })
    );
  });
});
