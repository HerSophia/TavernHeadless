import type { SmokeContext } from "./harness.js";
import { assert, must } from "./harness.js";
import {
  MINIMAL_PRESET,
  MINIMAL_WORLDBOOK,
  MINIMAL_REGEX_SCRIPTS,
  MINIMAL_CHARACTER_CARD,
} from "./fixtures.js";

export async function smokeImports(ctx: SmokeContext): Promise<void> {
  const { api, runId, runStep, track, addCleanup } = ctx;

  // ── Preset import ──────────────────────────────────

  const preset = await runStep("POST /import/preset", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/import/preset",
      {
        name: `${runId}-preset`,
        data: MINIMAL_PRESET,
      },
      [201]
    )
  );
  const presetId = must(preset.body?.data?.id, "Missing preset id");
  track("presets", presetId);
  addCleanup(async () => {
    await api.request("DELETE", `/presets/${presetId}`, undefined, [204, 404]);
  });

  await runStep("GET /presets", () => api.request("GET", "/presets", undefined, [200]));
  await runStep("GET /presets/:id", () => api.request("GET", `/presets/${presetId}`, undefined, [200]));

  // Disposable preset to test DELETE + 404 chain
  const disposablePreset = await runStep("POST /import/preset (disposable)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/import/preset",
      { name: `${runId}-preset-del`, data: MINIMAL_PRESET },
      [201]
    )
  );
  const disposablePresetId = must(disposablePreset.body?.data?.id, "Missing disposable preset id");
  await runStep("DELETE /presets/:id (disposable)", () =>
    api.request("DELETE", `/presets/${disposablePresetId}`, undefined, [204])
  );

  // ── Worldbook import ───────────────────────────────

  const worldbook = await runStep("POST /import/worldbook", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/import/worldbook",
      {
        name: `${runId}-worldbook`,
        data: MINIMAL_WORLDBOOK,
      },
      [201]
    )
  );
  const worldbookId = must(worldbook.body?.data?.id, "Missing worldbook id");
  track("worldbooks", worldbookId);
  addCleanup(async () => {
    await api.request("DELETE", `/worldbooks/${worldbookId}`, undefined, [204, 404]);
  });

  await runStep("GET /worldbooks", () => api.request("GET", "/worldbooks", undefined, [200]));
  await runStep("GET /worldbooks/:id", () => api.request("GET", `/worldbooks/${worldbookId}`, undefined, [200]));

  // Disposable worldbook to test DELETE chain
  const disposableWorldbook = await runStep("POST /import/worldbook (disposable)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/import/worldbook",
      { name: `${runId}-worldbook-del`, data: MINIMAL_WORLDBOOK },
      [201]
    )
  );
  const disposableWorldbookId = must(disposableWorldbook.body?.data?.id, "Missing disposable worldbook id");
  await runStep("DELETE /worldbooks/:id (disposable)", () =>
    api.request("DELETE", `/worldbooks/${disposableWorldbookId}`, undefined, [204])
  );

  // ── Regex import ───────────────────────────────────

  const regex = await runStep("POST /import/regex", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/import/regex",
      {
        name: `${runId}-regex`,
        data: MINIMAL_REGEX_SCRIPTS,
      },
      [201]
    )
  );
  const regexId = must(regex.body?.data?.id, "Missing regex profile id");
  track("regexProfiles", regexId);
  addCleanup(async () => {
    await api.request("DELETE", `/regex-profiles/${regexId}`, undefined, [204, 404]);
  });

  await runStep("GET /regex-profiles", () => api.request("GET", "/regex-profiles", undefined, [200]));
  await runStep("GET /regex-profiles/:id", () =>
    api.request("GET", `/regex-profiles/${regexId}`, undefined, [200])
  );

  // Disposable regex to test DELETE chain
  const disposableRegex = await runStep("POST /import/regex (disposable)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/import/regex",
      { name: `${runId}-regex-del`, data: MINIMAL_REGEX_SCRIPTS },
      [201]
    )
  );
  const disposableRegexId = must(disposableRegex.body?.data?.id, "Missing disposable regex id");
  await runStep("DELETE /regex-profiles/:id (disposable)", () =>
    api.request("DELETE", `/regex-profiles/${disposableRegexId}`, undefined, [204])
  );

  // ── Character import (create_session=false) ────────

  const importedCharacter = await runStep("POST /import/character (create_session=false)", () =>
    api.request<{ data: { character_id: string; character_version_id: string } }>(
      "POST",
      "/import/character",
      {
        payload: MINIMAL_CHARACTER_CARD,
        create_session: false,
      },
      [201]
    )
  );
  const characterId = must(importedCharacter.body?.data?.character_id, "Missing character id");
  const characterVersionId = must(
    importedCharacter.body?.data?.character_version_id,
    "Missing character version id"
  );
  track("characters", characterId);
  track("characterVersions", characterVersionId);
  addCleanup(async () => {
    await api.request("DELETE", `/characters/${characterId}`, undefined, [200, 404]);
  });

  // ── Character-bound session + sync tests ───────────

  const characterBoundSession = await runStep("POST /sessions (character-bound manual)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/sessions",
      {
        title: `${runId}-character-session`,
        character_id: characterId,
        character_version_id: characterVersionId,
        character_sync_policy: "manual",
      },
      [201]
    )
  );
  const characterSessionId = must(characterBoundSession.body?.data?.id, "Missing character session id");
  track("sessions", characterSessionId);
  addCleanup(async () => {
    await api.request("DELETE", `/sessions/${characterSessionId}`, undefined, [200, 404]);
  });

  await runStep("POST /sessions/:id/character/sync (manual)", () =>
    api.request("POST", `/sessions/${characterSessionId}/character/sync`, undefined, [200])
  );
  await runStep("PATCH /sessions/:id (sync_policy=pin)", () =>
    api.request("PATCH", `/sessions/${characterSessionId}`, { character_sync_policy: "pin" }, [200])
  );
  await runStep("POST /sessions/:id/character/sync (pin => 409)", () =>
    api.request("POST", `/sessions/${characterSessionId}/character/sync`, undefined, [409])
  );
  await runStep("POST /sessions/:id/character/sync (force=true)", () =>
    api.request("POST", `/sessions/${characterSessionId}/character/sync`, { force: true }, [200])
  );

  // ── Character import (default create_session) ──────

  const importedCharacterWithSession = await runStep("POST /import/character (default create_session)", () =>
    api.request<{ data: { session: { id: string } } }>(
      "POST",
      "/import/character",
      {
        payload: MINIMAL_CHARACTER_CARD,
      },
      [201]
    )
  );
  const importedSessionId = must(
    importedCharacterWithSession.body?.data?.session?.id,
    "Missing imported session id"
  );
  track("sessions", importedSessionId);
  addCleanup(async () => {
    await api.request("DELETE", `/sessions/${importedSessionId}`, undefined, [200, 404]);
  });

  const importedSessionDetail = await runStep("GET /sessions/:id (imported binding)", () =>
    api.request<{
      data: { character_binding: { character_id: string | null; character_version_id: string | null } | null };
    }>("GET", `/sessions/${importedSessionId}`, undefined, [200])
  );
  const importedCharacterId = importedSessionDetail.body?.data?.character_binding?.character_id;
  const importedCharacterVersionId = importedSessionDetail.body?.data?.character_binding?.character_version_id;
  if (typeof importedCharacterId === "string") {
    track("characters", importedCharacterId);
    addCleanup(async () => {
      await api.request("DELETE", `/characters/${importedCharacterId}`, undefined, [200, 404]);
    });
  }
  if (typeof importedCharacterVersionId === "string") {
    track("characterVersions", importedCharacterVersionId);
  }

  // ── Write shared refs ──────────────────────────────

  ctx.shared.presetId = presetId;
  ctx.shared.worldbookId = worldbookId;
  ctx.shared.characterId = characterId;
  ctx.shared.characterVersionId = characterVersionId;
  ctx.shared.characterSessionId = characterSessionId;
}
