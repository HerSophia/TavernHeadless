import { describe, expect, it } from "vitest";
import { TH_BACKUP_KIND, TH_BACKUP_SPEC, TH_BACKUP_SPEC_VERSION } from "@tavern/shared";

import { CoreAssetBackupError, parseCoreAssetBackupFile } from "../core-asset-backup-parser.js";

function makeBackupFile(specVersion: string, overrides: Record<string, unknown> = {}) {
  return {
    spec: TH_BACKUP_SPEC,
    spec_version: specVersion,
    backup_kind: TH_BACKUP_KIND,
    created_at: 1_760_000_000_000,
    source: {
      account_id: "acc-demo",
    },
    included_domains: ["characters", "presets", "worldbooks", "regex_profiles", "sessions"],
    options: {
      include_secrets: false,
    },
    resources: {
      characters: [],
      presets: [],
      worldbooks: [],
      regex_profiles: [],
    },
    sessions: [],
    extensions: {
      secrets: {
        mode: "excluded",
      },
    },
    ...overrides,
  };
}

describe("parseCoreAssetBackupFile", () => {
  it("accepts 1.0.0 backup files and defaults missing vc data", () => {
    const parsed = parseCoreAssetBackupFile(makeBackupFile("1.0.0"));

    expect(parsed.spec_version).toBe("1.0.0");
    expect(parsed.vc.tags).toEqual([]);
    expect(parsed.vc.operation_logs).toEqual([]);
  });

  it("accepts current 1.1.0 backup files", () => {
    const parsed = parseCoreAssetBackupFile(makeBackupFile(TH_BACKUP_SPEC_VERSION, {
      vc: {
        tags: [],
        operation_logs: [],
      },
    }));

    expect(parsed.spec_version).toBe("1.1.0");
    expect(parsed.vc.tags).toEqual([]);
  });

  it("rejects unsupported backup spec versions", () => {
    expect(() => parseCoreAssetBackupFile(makeBackupFile("2.0.0"))).toThrow(CoreAssetBackupError);

    try {
      parseCoreAssetBackupFile(makeBackupFile("2.0.0"));
    } catch (error) {
      expect(error).toBeInstanceOf(CoreAssetBackupError);
      expect((error as CoreAssetBackupError).code).toBe("backup_unsupported_version");
    }
  });
});
