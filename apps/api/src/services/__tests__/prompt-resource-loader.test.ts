import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  accounts,
  presets,
  presetVersions,
  regexProfiles,
  worldbookEntries,
  worldbooks,
} from "../../db/schema.js";
import { PromptResourceLoader } from "../prompt-resource-loader.js";
import { AssetVersionService } from "../asset-version-service.js";

const SAMPLE_PRESET_DATA = {
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "Stay in character.",
    },
    { identifier: "chatHistory", name: "Chat History", marker: true },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "chatHistory", enabled: true },
      ],
    },
  ],
  openai_max_context: 2048,
  openai_max_tokens: 300,
  temperature: 0.7,
  top_p: 1,
  top_k: 0,
  min_p: 0,
  frequency_penalty: 0,
  presence_penalty: 0,
  repetition_penalty: 1,
  new_chat_prompt: "",
  new_example_chat_prompt: "",
  continue_nudge_prompt: "",
  assistant_prefill: "",
  wi_format: "{0}",
  names_behavior: 0,
  stream_openai: true,
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

describe("PromptResourceLoader", () => {
  let database: DatabaseConnection;
  let loader: PromptResourceLoader;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    loader = new PromptResourceLoader(database.db);

    const now = Date.now();
    await database.db.insert(accounts).values({
      id: "acc-other",
      name: "Other Account",
      role: "user",
      status: "active",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("loads prompt resources for the matching account with parsed data and updatedAt metadata", async () => {
    const now = Date.now();
    const presetId = nanoid();
    const worldbookId = nanoid();
    const regexProfileId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Preset A",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Worldbook A",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({ scanDepth: 3, recursive: false }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbookEntries).values({
      id: nanoid(),
      worldbookId,
      uid: 7,
      comment: "Sword",
      content: "A blessed sword rests in the shrine.",
      keysJson: JSON.stringify(["sword"]),
      keysSecondaryJson: JSON.stringify([]),
      selective: false,
      selectiveLogic: 0,
      constant: false,
      position: 0,
      order: 100,
      depth: 4,
      role: 0,
      disable: false,
      excludeRecursion: true,
      preventRecursion: false,
      delayUntilRecursion: 2,
      outletName: "LoreOutlet",
      extraJson: JSON.stringify({ extensions: { probability: 75 } }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(regexProfiles).values({
      id: regexProfileId,
      name: "Regex A",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(SAMPLE_REGEX_DATA),
      createdAt: now,
      updatedAt: now,
    });

    const preset = await loader.loadPreset(DEFAULT_ADMIN_ACCOUNT_ID, presetId);
    const worldbook = await loader.loadWorldbookData(DEFAULT_ADMIN_ACCOUNT_ID, worldbookId);
    const regexProfile = await loader.loadRegexScripts(DEFAULT_ADMIN_ACCOUNT_ID, regexProfileId);

    expect(preset).not.toBeNull();
    expect(preset).toMatchObject({ id: presetId, updatedAt: now, version: 1 });
    expect(preset!.preset.promptOrder).toEqual(["main", "chatHistory"]);

    expect(worldbook).not.toBeNull();
    expect(worldbook).toMatchObject({ id: worldbookId, updatedAt: now, version: 1 });
    expect(worldbook!.worldbook.scanDepth).toBe(3);
    expect(worldbook!.worldbook.entries).toHaveLength(1);
    expect(worldbook!.worldbook.entries[0]).toMatchObject({
      uid: 7,
      content: "A blessed sword rests in the shrine.",
      excludeRecursion: true,
      preventRecursion: false,
      delayUntilRecursion: 2,
      outletName: "LoreOutlet",
      extra: { extensions: { probability: 75 } },
    });

    expect(regexProfile).not.toBeNull();
    expect(regexProfile).toMatchObject({ id: regexProfileId, updatedAt: now, version: 1 });
    expect(regexProfile!.scripts).toHaveLength(1);
    expect(regexProfile!.scripts[0]).toMatchObject({ scriptName: "Input Rule", placement: [1] });

    const bundle = await loader.loadPromptResourceBundle(DEFAULT_ADMIN_ACCOUNT_ID, {
      presetId,
      worldbookProfileId: worldbookId,
      regexProfileId,
    });

    expect(bundle.preset).toMatchObject({ id: presetId, version: 1 });
    expect(bundle.worldbook).toMatchObject({
      id: worldbookId,
      version: 1,
      worldbook: { scanDepth: 3 },
    });
    expect(bundle.regexProfile).toMatchObject({ id: regexProfileId, version: 1 });
  });

  it("uses bound asset version content when deep binding is enabled", async () => {
    const now = Date.now();
    const presetId = nanoid();
    const initialPreset = SAMPLE_PRESET_DATA;
    const updatedPreset = {
      ...SAMPLE_PRESET_DATA,
      prompts: SAMPLE_PRESET_DATA.prompts.map((prompt) => prompt.identifier === "main"
        ? { ...prompt, content: "Use the updated style." }
        : prompt),
    };

    await database.db.insert(presets).values({
      id: presetId,
      name: "Versioned Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(initialPreset),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const versionService = new AssetVersionService(database.db);
    const version1 = versionService.createPresetVersion(presetId, {
      versionNo: 1,
      data: initialPreset,
      createdAt: now,
    });

    await database.db.update(presets).set({
      dataJson: JSON.stringify(updatedPreset),
      version: 2,
      updatedAt: now + 1,
    }).where(eq(presets.id, presetId));
    versionService.createPresetVersion(presetId, {
      versionNo: 2,
      data: updatedPreset,
      createdAt: now + 1,
    });

    const shallow = await loader.loadPreset(DEFAULT_ADMIN_ACCOUNT_ID, presetId);
    const deep = await loader.loadPreset(DEFAULT_ADMIN_ACCOUNT_ID, presetId, {
      deepBinding: true,
      presetVersionId: version1.id,
    });

    expect(shallow).toMatchObject({ version: 2 });
    expect(JSON.stringify(shallow?.preset)).toContain("Use the updated style.");
    expect(deep).toMatchObject({ version: 1, versionId: version1.id, contentHash: version1.contentHash });
    expect(JSON.stringify(deep?.preset)).toContain("Stay in character.");
  });

  it("warns and falls back to the live preset when a deep-bound preset version is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const now = Date.now();
      const presetId = nanoid();

      await database.db.insert(presets).values({
        id: presetId,
        name: "Fallback Preset",
        source: "sillytavern",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
        version: 1,
        createdAt: now,
        updatedAt: now,
      });

      const loaded = await loader.loadPreset(DEFAULT_ADMIN_ACCOUNT_ID, presetId, {
        deepBinding: true,
        presetVersionId: "missing-preset-version",
      });

      expect(loaded).toMatchObject({ id: presetId, version: 1 });
      expect(warnSpy).toHaveBeenCalledWith(
        "[PromptResourceLoader] deep binding fallback",
        expect.objectContaining({
          assetType: "preset",
          assetId: presetId,
          requestedVersionId: "missing-preset-version",
          reason: "version_row_missing",
          fallback: "live_asset",
        }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns and falls back to the live preset when a deep-bound preset version cannot be parsed", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const now = Date.now();
      const presetId = nanoid();
      const versionId = nanoid();

      await database.db.insert(presets).values({
        id: presetId,
        name: "Invalid Version Preset",
        source: "sillytavern",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
        version: 2,
        createdAt: now,
        updatedAt: now,
      });
      await database.db.insert(presetVersions).values({
        id: versionId,
        presetId,
        parentVersionId: null,
        versionNo: 1,
        dataJson: "{not-json",
        contentHash: "invalid-json",
        createdByOperationId: null,
        createdAt: now,
      });

      const loaded = await loader.loadPreset(DEFAULT_ADMIN_ACCOUNT_ID, presetId, {
        deepBinding: true,
        presetVersionId: versionId,
      });

      expect(loaded).toMatchObject({ id: presetId, version: 2 });
      expect(warnSpy).toHaveBeenCalledWith(
        "[PromptResourceLoader] deep binding fallback",
        expect.objectContaining({
          assetType: "preset",
          assetId: presetId,
          requestedVersionId: versionId,
          reason: "version_parse_failed",
          fallback: "live_asset",
        }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns and falls back to the live worldbook when a deep-bound worldbook version is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const now = Date.now();
      const worldbookId = nanoid();

      await database.db.insert(worldbooks).values({
        id: worldbookId,
        name: "Fallback Worldbook",
        source: "sillytavern",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        dataJson: JSON.stringify({ scanDepth: 4 }),
        version: 1,
        createdAt: now,
        updatedAt: now,
      });

      const loaded = await loader.loadWorldbookData(DEFAULT_ADMIN_ACCOUNT_ID, worldbookId, {
        deepBinding: true,
        worldbookVersionId: "missing-worldbook-version",
      });

      expect(loaded).toMatchObject({ id: worldbookId, version: 1, worldbook: { scanDepth: 4 } });
      expect(warnSpy).toHaveBeenCalledWith(
        "[PromptResourceLoader] deep binding fallback",
        expect.objectContaining({
          assetType: "worldbook",
          assetId: worldbookId,
          requestedVersionId: "missing-worldbook-version",
          reason: "version_row_missing",
          fallback: "live_asset",
        }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns and falls back to the live regex profile when a deep-bound regex profile version is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const now = Date.now();
      const regexProfileId = nanoid();

      await database.db.insert(regexProfiles).values({
        id: regexProfileId,
        name: "Fallback Regex",
        source: "sillytavern",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        dataJson: JSON.stringify(SAMPLE_REGEX_DATA),
        version: 1,
        createdAt: now,
        updatedAt: now,
      });

      const loaded = await loader.loadRegexScripts(DEFAULT_ADMIN_ACCOUNT_ID, regexProfileId, {
        deepBinding: true,
        regexProfileVersionId: "missing-regex-profile-version",
      });

      expect(loaded).toMatchObject({ id: regexProfileId, version: 1 });
      expect(loaded?.scripts).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledWith(
        "[PromptResourceLoader] deep binding fallback",
        expect.objectContaining({
          assetType: "regex_profile",
          assetId: regexProfileId,
          requestedVersionId: "missing-regex-profile-version",
          reason: "version_row_missing",
          fallback: "live_asset",
        }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns null when prompt resources belong to another account", async () => {
    const now = Date.now();
    const presetId = nanoid();
    const worldbookId = nanoid();
    const regexProfileId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Preset B",
      source: "sillytavern",
      accountId: "acc-other",
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Worldbook B",
      source: "sillytavern",
      accountId: "acc-other",
      dataJson: JSON.stringify({}),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(regexProfiles).values({
      id: regexProfileId,
      name: "Regex B",
      source: "sillytavern",
      accountId: "acc-other",
      dataJson: JSON.stringify(SAMPLE_REGEX_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await expect(loader.loadPreset(DEFAULT_ADMIN_ACCOUNT_ID, presetId)).resolves.toBeNull();
    await expect(loader.loadWorldbookData(DEFAULT_ADMIN_ACCOUNT_ID, worldbookId)).resolves.toBeNull();
    await expect(loader.loadRegexScripts(DEFAULT_ADMIN_ACCOUNT_ID, regexProfileId)).resolves.toBeNull();
  });
});
