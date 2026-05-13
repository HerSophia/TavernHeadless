import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { presets, regexProfiles, worldbooks } from "../../db/schema.js";
import { createTestWorkspace } from "../../__tests__/helpers/workspace-project.js";
import { AssetVersionService } from "../asset-version-service.js";
import {
  SessionAssetBindingService,
  type SessionAssetBindingError,
  type SessionAssetBindingState,
} from "../session-asset-binding-service.js";

const SAMPLE_PRESET_DATA = {
  prompts: [],
  prompt_order: [],
};

const SAMPLE_WORLDBOOK_DATA = {
  name: "Worldbook",
  entries: [],
};

const SAMPLE_REGEX_DATA = [
  {
    id: "regex-1",
    scriptName: "Input Rule",
    findRegex: "/hello/g",
    replaceString: "HELLO",
    trimStrings: [],
    placement: [1],
    disabled: false,
    substituteRegex: 0,
    minDepth: 0,
    maxDepth: 0,
  },
];

function isBindingError(
  result: SessionAssetBindingState | SessionAssetBindingError,
): result is SessionAssetBindingError {
  return "statusCode" in result;
}

const TEST_WORKSPACE_ID = "ws_test";

describe("SessionAssetBindingService", () => {
  let database: DatabaseConnection;
  let service: SessionAssetBindingService;
  let versionService: AssetVersionService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    createTestWorkspace(database.db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: TEST_WORKSPACE_ID,
      isDefault: false,
    });
    service = new SessionAssetBindingService(database.db);
    versionService = new AssetVersionService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  function insertPreset(id = nanoid(), version = 1, workspaceId = TEST_WORKSPACE_ID): string {
    const now = Date.now();
    database.db
      .insert(presets)
      .values({
        id,
        name: `Preset ${id}`,
        source: "sillytavern",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId,
        dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
        version,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return id;
  }

  function insertWorldbook(id = nanoid(), version = 1, workspaceId = TEST_WORKSPACE_ID): string {
    const now = Date.now();
    database.db
      .insert(worldbooks)
      .values({
        id,
        name: `Worldbook ${id}`,
        source: "sillytavern",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId,
        dataJson: JSON.stringify({}),
        version,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return id;
  }

  function insertRegexProfile(id = nanoid(), version = 1, workspaceId = TEST_WORKSPACE_ID): string {
    const now = Date.now();
    database.db
      .insert(regexProfiles)
      .values({
        id,
        name: `Regex ${id}`,
        source: "sillytavern",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId,
        dataJson: JSON.stringify(SAMPLE_REGEX_DATA),
        version,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return id;
  }

  it("treats explicit version null as version unbind while keeping the asset binding", () => {
    const presetId = insertPreset();
    const presetVersion = versionService.createPresetVersion(presetId, {
      versionNo: 1,
      data: SAMPLE_PRESET_DATA,
    });

    const result = service.resolveUpdate(
      DEFAULT_ADMIN_ACCOUNT_ID,
      TEST_WORKSPACE_ID,
      {
        presetId,
        presetVersionId: presetVersion.id,
        regexProfileId: null,
        regexProfileVersionId: null,
        worldbookProfileId: null,
        worldbookVersionId: null,
        deepBinding: true,
      },
      { preset_version_id: null },
    );

    expect(isBindingError(result)).toBe(false);
    if (isBindingError(result)) return;
    expect(result.presetId).toBe(presetId);
    expect(result.presetVersionId).toBeNull();
    expect(result.deepBinding).toBe(true);
  });

  it("preserves the current version id when the version field is missing and the asset is unchanged", () => {
    const presetId = insertPreset();
    const presetVersion = versionService.createPresetVersion(presetId, {
      versionNo: 1,
      data: SAMPLE_PRESET_DATA,
    });

    const result = service.resolveUpdate(
      DEFAULT_ADMIN_ACCOUNT_ID,
      TEST_WORKSPACE_ID,
      {
        presetId,
        presetVersionId: presetVersion.id,
        regexProfileId: null,
        regexProfileVersionId: null,
        worldbookProfileId: null,
        worldbookVersionId: null,
        deepBinding: true,
      },
      {},
    );

    expect(isBindingError(result)).toBe(false);
    if (isBindingError(result)) return;
    expect(result.presetVersionId).toBe(presetVersion.id);
  });

  it("binds the current version when switching to a new asset without an explicit version id", () => {
    const oldPresetId = insertPreset();
    const oldVersion = versionService.createPresetVersion(oldPresetId, {
      versionNo: 1,
      data: SAMPLE_PRESET_DATA,
    });
    const newPresetId = insertPreset(nanoid(), 2);
    const newVersion = versionService.createPresetVersion(newPresetId, {
      versionNo: 2,
      data: { ...SAMPLE_PRESET_DATA, marker: "new" },
    });

    const result = service.resolveUpdate(
      DEFAULT_ADMIN_ACCOUNT_ID,
      TEST_WORKSPACE_ID,
      {
        presetId: oldPresetId,
        presetVersionId: oldVersion.id,
        regexProfileId: null,
        regexProfileVersionId: null,
        worldbookProfileId: null,
        worldbookVersionId: null,
        deepBinding: true,
      },
      { preset_id: newPresetId },
    );

    expect(isBindingError(result)).toBe(false);
    if (isBindingError(result)) return;
    expect(result.presetId).toBe(newPresetId);
    expect(result.presetVersionId).toBe(newVersion.id);
  });

  it("rejects a version id that belongs to another asset", () => {
    const presetId = insertPreset();
    const otherPresetId = insertPreset();
    const otherVersion = versionService.createPresetVersion(otherPresetId, {
      versionNo: 1,
      data: SAMPLE_PRESET_DATA,
    });

    const result = service.resolveUpdate(
      DEFAULT_ADMIN_ACCOUNT_ID,
      TEST_WORKSPACE_ID,
      {
        presetId,
        presetVersionId: null,
        regexProfileId: null,
        regexProfileVersionId: null,
        worldbookProfileId: null,
        worldbookVersionId: null,
        deepBinding: true,
      },
      { preset_version_id: otherVersion.id },
    );

    expect(isBindingError(result)).toBe(true);
    if (!isBindingError(result)) return;
    expect(result.code).toBe("asset_version_not_found");
  });

  it("rejects prompt assets from another Workspace", () => {
    const otherWorkspaceId = "ws_other_binding";
    createTestWorkspace(database.db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: otherWorkspaceId,
      isDefault: false,
    });

    const presetId = insertPreset(nanoid(), 1, otherWorkspaceId);
    const worldbookId = insertWorldbook(nanoid(), 1, otherWorkspaceId);
    const regexProfileId = insertRegexProfile(nanoid(), 1, otherWorkspaceId);

    const presetResult = service.resolveCreate(DEFAULT_ADMIN_ACCOUNT_ID, TEST_WORKSPACE_ID, { preset_id: presetId });
    const worldbookResult = service.resolveCreate(DEFAULT_ADMIN_ACCOUNT_ID, TEST_WORKSPACE_ID, { worldbook_profile_id: worldbookId });
    const regexResult = service.resolveCreate(DEFAULT_ADMIN_ACCOUNT_ID, TEST_WORKSPACE_ID, { regex_profile_id: regexProfileId });

    expect(presetResult).toMatchObject({ code: "preset_not_found" });
    expect(worldbookResult).toMatchObject({ code: "worldbook_not_found" });
    expect(regexResult).toMatchObject({ code: "regex_profile_not_found" });
  });

  it("rejects prompt asset versions from another Workspace", () => {
    const otherWorkspaceId = "ws_other_version_binding";
    createTestWorkspace(database.db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: otherWorkspaceId,
      isDefault: false,
    });

    const presetId = insertPreset(nanoid(), 1, otherWorkspaceId);
    const presetVersion = versionService.createPresetVersion(presetId, {
      versionNo: 1,
      data: SAMPLE_PRESET_DATA,
    });

    const result = service.resolveCreate(DEFAULT_ADMIN_ACCOUNT_ID, TEST_WORKSPACE_ID, {
      preset_version_id: presetVersion.id,
    });

    expect(result).toMatchObject({ code: "asset_version_not_found" });
  });

  it("treats explicit null as version unbind for all prompt asset kinds", () => {
    const presetId = insertPreset();
    const worldbookId = insertWorldbook();
    const regexProfileId = insertRegexProfile();
    const presetVersion = versionService.createPresetVersion(presetId, {
      versionNo: 1,
      data: SAMPLE_PRESET_DATA,
    });
    const worldbookVersion = versionService.createWorldbookVersion(
      worldbookId,
      {
        versionNo: 1,
        data: SAMPLE_WORLDBOOK_DATA,
      },
    );
    const regexProfileVersion = versionService.createRegexProfileVersion(
      regexProfileId,
      {
        versionNo: 1,
        data: SAMPLE_REGEX_DATA,
      },
    );

    const result = service.resolveUpdate(
      DEFAULT_ADMIN_ACCOUNT_ID,
      TEST_WORKSPACE_ID,
      {
        presetId,
        presetVersionId: presetVersion.id,
        worldbookProfileId: worldbookId,
        worldbookVersionId: worldbookVersion.id,
        regexProfileId,
        regexProfileVersionId: regexProfileVersion.id,
        deepBinding: true,
      },
      {
        preset_version_id: null,
        worldbook_version_id: null,
        regex_profile_version_id: null,
      },
    );

    expect(isBindingError(result)).toBe(false);
    if (isBindingError(result)) return;
    expect(result.presetVersionId).toBeNull();
    expect(result.worldbookVersionId).toBeNull();
    expect(result.regexProfileVersionId).toBeNull();
  });
});
