export function parseRegexCharacterName(characterSnapshotJson: string | null): string | null {
  if (!characterSnapshotJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(characterSnapshotJson) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    return name || null;
  } catch {
    return null;
  }
}

export function parseRegexUserName(
  userSnapshotJson: string | null,
  metadataJson: string | null,
): string | null {
  if (userSnapshotJson) {
    try {
      const parsed = JSON.parse(userSnapshotJson) as Record<string, unknown>;
      const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
      if (name) {
        return name;
      }
    } catch {
      // ignore and fall through to metadata persona
    }
  }

  if (!metadataJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    const persona = parsed.persona;
    if (!persona || typeof persona !== "object") {
      return null;
    }

    const personaRecord = persona as Record<string, unknown>;
    const name = typeof personaRecord.name === "string"
      ? personaRecord.name.trim()
      : "";
    return name || null;
  } catch {
    return null;
  }
}
