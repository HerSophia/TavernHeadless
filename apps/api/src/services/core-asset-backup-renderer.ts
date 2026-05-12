import {
  TH_BACKUP_KIND,
  TH_BACKUP_SPEC,
  TH_BACKUP_SPEC_VERSION,
} from "@tavern/shared";
import type { ThBackupFile } from "@tavern/shared/types/backup-file";

import type { CoreAssetBackupSnapshot } from "./core-asset-backup-snapshot.js";

export interface CoreAssetBackupRendererOptions {
  appVersion?: string;
}

export function renderCoreAssetBackup(
  snapshot: CoreAssetBackupSnapshot,
  options: CoreAssetBackupRendererOptions = {},
): ThBackupFile {
  return {
    spec: TH_BACKUP_SPEC,
    spec_version: TH_BACKUP_SPEC_VERSION,
    backup_kind: TH_BACKUP_KIND,
    created_at: snapshot.createdAt,
    source: {
      account_id: snapshot.source.accountId,
      ...(options.appVersion ? { app_version: options.appVersion } : {}),
    },
    included_domains: snapshot.includedDomains,
    options: {
      include_secrets: false,
    },
    resources: {
      characters: snapshot.resources.characters,
      presets: snapshot.resources.presets,
      worldbooks: snapshot.resources.worldbooks,
      regex_profiles: snapshot.resources.regexProfiles,
    },
    sessions: snapshot.sessions,
    vc: snapshot.vc,
    extensions: {
      secrets: {
        mode: "excluded",
      },
    },
  };
}

export function suggestCoreAssetBackupFileName(input: {
  createdAt: number;
  isFullExport: boolean;
}): string {
  const timestamp = formatBackupTimestamp(input.createdAt);
  return input.isFullExport
    ? `core-assets-${timestamp}.thbackup`
    : `core-assets-selection-${timestamp}.thbackup`;
}

function formatBackupTimestamp(value: number): string {
  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  return `${year}${month}${day}-${hour}${minute}${second}`;
}
