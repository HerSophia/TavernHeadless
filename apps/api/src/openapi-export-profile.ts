import type { BuildAppOptions } from "./app.js";

export const OPENAPI_EXPORT_CLIENT_DATA_CONFIG = {
  expirationIntervalMs: 300_000,
  domainPurgeGracePeriodMs: 604_800_000,
  defaultMaxItemSizeBytes: 1_048_576,
  defaultQuotaMaxEntries: 10_000,
  defaultQuotaMaxBytes: 10_485_760,
  maxDomainsPerAccount: 64,
  maxTotalEntriesPerAccount: 100_000,
  maxTotalBytesPerAccount: 104_857_600,
} as const;

const OPENAPI_EXPORT_PROVIDER = {
  id: "openapi-export-provider",
  type: "openai-compatible",
  apiKey: "sk-openapi-export",
} as const;

export const OPENAPI_EXPORT_ORCHESTRATION_CONFIG: NonNullable<BuildAppOptions["orchestration"]> = {
  providers: [OPENAPI_EXPORT_PROVIDER],
  defaultModel: {
    providerId: OPENAPI_EXPORT_PROVIDER.id,
    modelId: "gpt-4o-mini",
  },
};

export function createOpenApiExportBuildAppOptions(
  overrides: Partial<BuildAppOptions> = {},
): BuildAppOptions {
  const clientData = overrides.clientData ?? { ...OPENAPI_EXPORT_CLIENT_DATA_CONFIG };
  const orchestration = overrides.orchestration ?? {
    providers: OPENAPI_EXPORT_ORCHESTRATION_CONFIG.providers.map((provider) => ({ ...provider })),
    defaultModel: { ...OPENAPI_EXPORT_ORCHESTRATION_CONFIG.defaultModel },
  };

  const options: BuildAppOptions = {
    databasePath: ":memory:",
    logger: false,
    enableMcp: true,
    enableWebSocket: false,
    enableClientData: true,
    ...overrides,
  };

  options.clientData = clientData;
  options.orchestration = orchestration;

  return options;
}
