import { afterEach, describe, expect, it } from "vitest";

import { buildApp, type BuildAppResult } from "../../app.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import {
  floors,
  messagePages,
  sessions,
} from "../../db/schema.js";
import { SessionStateCustomNamespaceService } from "../../session-state/session-state-custom-namespace-service.js";
import { SessionStateService } from "../../session-state/session-state-service.js";

const CLIENT_DATA_CONFIG = {
  defaultMaxItemSizeBytes: 1_048_576,
  defaultQuotaMaxEntries: 10_000,
  defaultQuotaMaxBytes: 10_485_760,
  maxDomainsPerAccount: 64,
  maxTotalEntriesPerAccount: 100_000,
  maxTotalBytesPerAccount: 104_857_600,
  expirationIntervalMs: 300_000,
  domainPurgeGracePeriodMs: 604_800_000,
};

async function buildPagesApp(): Promise<BuildAppResult> {
  const built = await buildApp({
    databasePath: ":memory:",
    auth: { mode: "off" },
    accountMode: "single",
    enableClientData: true,
    clientData: CLIENT_DATA_CONFIG,
  });
  await built.app.ready();
  return built;
}

describe("page session-state inspection route", () => {
  const builtApps: BuildAppResult[] = [];

  afterEach(async () => {
    while (builtApps.length > 0) {
      const built = builtApps.pop();
      if (built) {
        await built.app.close();
      }
    }
  });

  it("lists page-scoped session-state mutations in stable order and excludes direct_public writes", async () => {
    const built = await buildPagesApp();
    builtApps.push(built);

    const now = 1_736_620_000_000;
    const sessionId = "session-pages-session-state";
    const floorId = "floor-pages-session-state";
    const pageId = "page-pages-session-state";

    await built.database.insert(sessions).values({
      id: sessionId,
      title: "Page session-state inspection",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await built.database.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });
    await built.database.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 1,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });

    const customNamespaceService = new SessionStateCustomNamespaceService(built.database, {
      clientData: CLIENT_DATA_CONFIG,
    });
    customNamespaceService.registerNamespace({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      namespace: "custom.world",
      logicalOwnerType: "test",
      logicalOwnerId: "page-session-state-route",
    });

    const sessionStateService = new SessionStateService(built.database, {
      clientData: CLIENT_DATA_CONFIG,
      customNamespaceService,
    });

    sessionStateService.stageVariableRerouteValue({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      sourceFloorId: floorId,
      sourcePageId: pageId,
      namespace: "custom.world",
      slot: "scene",
      value: { weather: "rain" },
      sourceKind: "tool",
      decisionReason: "identified_as_session_state_candidate",
      decisionCode: "rerouted_to_session_state",
      linkedVariableStageId: null,
      createdAt: now + 20,
    });
    sessionStateService.stageVariableRerouteValue({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      sourceFloorId: floorId,
      sourcePageId: pageId,
      namespace: "custom.world",
      slot: "inventory",
      value: { coins: 5 },
      sourceKind: "tool",
      decisionReason: "identified_as_session_state_candidate",
      decisionCode: "rerouted_to_session_state",
      linkedVariableStageId: null,
      createdAt: now + 10,
    });
    sessionStateService.writeDirectValue({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      namespace: "custom.world",
      slot: "public_note",
      value: { visible: true },
      sourceFloorId: floorId,
    });

    const response = await built.app.inject({
      method: "GET",
      url: `/pages/${encodeURIComponent(pageId)}/session-state/mutations`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      data: {
        page_id: pageId,
        floor_id: floorId,
        session_id: sessionId,
        branch_id: "main",
        items: [
          expect.objectContaining({
            page_id: pageId,
            floor_id: floorId,
            source_page_id: pageId,
            source_floor_id: floorId,
            state_namespace: "custom.world",
            target_slot: "inventory",
            commit_mode: "variable_reroute",
            decision_status: "rerouted_to_session_state",
            decision_code: "rerouted_to_session_state",
            linked_variable_stage_id: null,
            created_at: now + 10,
          }),
          expect.objectContaining({
            page_id: pageId,
            floor_id: floorId,
            source_page_id: pageId,
            source_floor_id: floorId,
            state_namespace: "custom.world",
            target_slot: "scene",
            commit_mode: "variable_reroute",
            decision_status: "rerouted_to_session_state",
            decision_code: "rerouted_to_session_state",
            linked_variable_stage_id: null,
            created_at: now + 20,
          }),
        ],
      },
    });
  });
});
