import { effectScope } from "vue";
import { describe, expect, it, vi } from "vitest";

import type { WorkspacePresetEditorDocument } from "../../../lib/workspace-api";
import { useWorkspaceAssetManagerDialogs } from "./asset-manager-dialogs";

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

function createWorkspaceMock() {
  return {
    deleteCharacterLibraryAsset: vi.fn(),
    deletePresetLibraryAsset: vi.fn(),
    deleteWorldbookLibraryAsset: vi.fn(),
    loadCharacterAssetDetail: vi.fn(),
    loadPresetAssetDetail: vi.fn(),
    loadWorldbookAssetDetail: vi.fn(),
    restoreCharacterLibraryAsset: vi.fn(),
    saveCharacterAsset: vi.fn(),
    savePresetAsset: vi.fn(),
    saveWorldbookAsset: vi.fn()
  };
}

describe("useWorkspaceAssetManagerDialogs", () => {
  it("uses detail.version for preset saves and keeps the preset draft on preset_conflict", async () => {
    const addEvent = vi.fn();
    const workspace = createWorkspaceMock();
    workspace.loadPresetAssetDetail.mockResolvedValue({
      detail: {
        createdAt: 1,
        editor: createPresetEditorDocument(),
        id: "preset-1",
        name: "Preset 1",
        source: "import",
        updatedAt: 2,
        version: 4
      },
      ok: true
    });
    workspace.savePresetAsset.mockResolvedValue({
      apiSyncFailed: false,
      asset: null,
      deleteSyncFailed: false,
      ok: false,
      reason: "preset_conflict"
    });

    const scope = effectScope();
    const state = scope.run(() => useWorkspaceAssetManagerDialogs({
      addEvent,
      t: (key) => key,
      workspace
    }));

    expect(state).toBeTruthy();

    await state?.openPresetManagerDialog("update", "preset-1");
    state!.presetManagerDialog.draftName = "Edited preset";
    state!.presetManagerDialog.editorDraft!.entries[0]!.content = "Changed preset content";

    await state?.confirmPresetManagerAction();

    expect(workspace.savePresetAsset).toHaveBeenCalledWith(
      "preset-1",
      "Edited preset",
      expect.objectContaining({
        entries: [expect.objectContaining({ content: "Changed preset content" })]
      }),
      4,
      "update"
    );
    expect(state?.presetManagerDialog.expectedVersion).toBe(4);
    expect(state?.presetManagerDialog.open).toBe(true);
    expect(state?.presetManagerDialog.draftName).toBe("Edited preset");
    expect(state?.presetManagerDialog.editorDraft?.entries[0]?.content).toBe("Changed preset content");
    expect(state?.presetManagerDialog.errorMessage).toBe("dialogs.presetManagerConflict");
    expect(addEvent).toHaveBeenCalledWith("events.assetPresetConflict", "warn");

    scope.stop();
  });

  it("keeps the preset draft on resource_busy", async () => {
    const addEvent = vi.fn();
    const workspace = createWorkspaceMock();
    workspace.loadPresetAssetDetail.mockResolvedValue({
      detail: {
        createdAt: 1,
        editor: createPresetEditorDocument(),
        id: "preset-1",
        name: "Preset 1",
        source: "import",
        updatedAt: 2,
        version: 6
      },
      ok: true
    });
    workspace.savePresetAsset.mockResolvedValue({
      apiSyncFailed: false,
      asset: null,
      deleteSyncFailed: false,
      ok: false,
      reason: "resource_busy"
    });

    const scope = effectScope();
    const state = scope.run(() => useWorkspaceAssetManagerDialogs({
      addEvent,
      t: (key) => key,
      workspace
    }));

    expect(state).toBeTruthy();

    await state?.openPresetManagerDialog("edit", "preset-1");
    state!.presetManagerDialog.draftName = "Busy preset";
    state!.presetManagerDialog.editorDraft!.entries[0]!.content = "Busy content";

    await state?.confirmPresetManagerAction();

    expect(workspace.savePresetAsset).toHaveBeenCalledWith(
      "preset-1",
      "Busy preset",
      expect.objectContaining({
        entries: [expect.objectContaining({ content: "Busy content" })]
      }),
      6,
      "update"
    );
    expect(state?.presetManagerDialog.open).toBe(true);
    expect(state?.presetManagerDialog.draftName).toBe("Busy preset");
    expect(state?.presetManagerDialog.editorDraft?.entries[0]?.content).toBe("Busy content");
    expect(state?.presetManagerDialog.errorMessage).toBe("dialogs.presetManagerBusy");
    expect(addEvent).toHaveBeenCalledWith("events.assetResourceBusy", "warn");

    scope.stop();
  });

  it("uses detail.version for worldbook saves and keeps the worldbook draft on worldbook_conflict", async () => {
    const addEvent = vi.fn();
    const workspace = createWorkspaceMock();
    workspace.loadWorldbookAssetDetail.mockResolvedValue({
      detail: {
        createdAt: 1,
        data: { entries: [] },
        id: "worldbook-1",
        name: "Worldbook 1",
        source: "import",
        updatedAt: 2,
        version: 7
      },
      ok: true
    });
    workspace.saveWorldbookAsset.mockResolvedValue({
      apiSyncFailed: false,
      asset: null,
      ok: false,
      reason: "worldbook_conflict"
    });

    const scope = effectScope();
    const state = scope.run(() => useWorkspaceAssetManagerDialogs({
      addEvent,
      t: (key) => key,
      workspace
    }));

    expect(state).toBeTruthy();

    await state?.openWorldbookManagerDialog("update", "worldbook-1");
    state!.worldbookManagerDialog.draftName = "Edited worldbook";
    state!.worldbookManagerDialog.draftJson = JSON.stringify({ entries: [{ key: "hero" }] }, null, 2);

    await state?.confirmWorldbookManagerAction();

    expect(workspace.saveWorldbookAsset).toHaveBeenCalledWith(
      "worldbook-1",
      "Edited worldbook",
      { entries: [{ key: "hero" }] },
      7,
      "update"
    );
    expect(state?.worldbookManagerDialog.expectedVersion).toBe(7);
    expect(state?.worldbookManagerDialog.open).toBe(true);
    expect(state?.worldbookManagerDialog.draftName).toBe("Edited worldbook");
    expect(state?.worldbookManagerDialog.draftJson).toBe(JSON.stringify({ entries: [{ key: "hero" }] }, null, 2));
    expect(state?.worldbookManagerDialog.errorMessage).toBe("dialogs.worldbookManagerConflict");
    expect(addEvent).toHaveBeenCalledWith("events.assetWorldbookConflict", "warn");

    scope.stop();
  });
});
