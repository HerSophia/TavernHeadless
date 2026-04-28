import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatServiceError, type ChatService } from "../../services/chat-service.js";
import { SessionStateServiceError } from "../../session-state/session-state-service.js";
import { registerChatRoutes } from "../chat.js";

type MockedChatService = {
  service: ChatService;
  dryRun: ReturnType<typeof vi.fn>;
  respond: ReturnType<typeof vi.fn>;
  regenerate: ReturnType<typeof vi.fn>;
  retryFloor: ReturnType<typeof vi.fn>;
  editAndRegenerate: ReturnType<typeof vi.fn>;
};

const apps: FastifyInstance[] = [];

describe("chat routes", () => {
  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) {
        await app.close();
      }
    }
  });

  it("returns 503 feature_unavailable for session_state_writes when client-data is disabled", async () => {
    const mocked = await buildChatApp({ enableClientData: false });
    const payload = {
      session_state_writes: [
        {
          namespace: "quest_flags",
          slot: "companion",
          value: { mood: "ally" },
        },
      ],
    };

    const cases = [
      {
        expectedMock: mocked.respond,
        method: "POST",
        payload: { message: "Continue the quest.", ...payload },
        url: "/sessions/session-1/respond",
      },
      {
        expectedMock: mocked.respond,
        method: "POST",
        payload: { message: "Continue the quest.", ...payload },
        url: "/sessions/session-1/respond/stream",
      },
      {
        expectedMock: mocked.regenerate,
        method: "POST",
        payload,
        url: "/sessions/session-1/regenerate",
      },
      {
        expectedMock: mocked.retryFloor,
        method: "POST",
        payload,
        url: "/floors/floor-1/retry",
      },
      {
        expectedMock: mocked.editAndRegenerate,
        method: "POST",
        payload: { content: "Revise the turn.", ...payload },
        url: "/messages/message-1/edit-and-regenerate",
      },
    ] as const;

    for (const testCase of cases) {
      const response = await mocked.serviceApp.inject({
        method: testCase.method,
        payload: testCase.payload,
        url: testCase.url,
      });
      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body).error.code).toBe("feature_unavailable");
      expect(testCase.expectedMock).not.toHaveBeenCalled();
    }
  });

  it("parses the same session_state_writes body for respond and respond/stream", async () => {
    const mocked = await buildChatApp();
    const payload = {
      message: "Continue the quest.",
      session_state_writes: [
        {
          namespace: "quest_flags",
          slot: "companion",
          value: { mood: "ally" },
        },
        {
          namespace: "quest_flags",
          slot: "expired_hint",
          delete: true,
        },
      ],
    };

    const respondResponse = await mocked.serviceApp.inject({
      method: "POST",
      payload,
      url: "/sessions/session-1/respond",
    });
    const streamResponse = await mocked.serviceApp.inject({
      method: "POST",
      payload,
      url: "/sessions/session-1/respond/stream",
    });

    expect(respondResponse.statusCode).toBe(200);
    expect(streamResponse.statusCode).toBe(200);
    expect(streamResponse.body).toContain("event: done");

    expect(mocked.respond).toHaveBeenCalledTimes(2);
    const firstRequest = mocked.respond.mock.calls[0]?.[1];
    const secondRequest = mocked.respond.mock.calls[1]?.[1];
    expect(firstRequest?.sessionStateWrites).toEqual([
      {
        namespace: "quest_flags",
        slot: "companion",
        value: { mood: "ally" },
      },
      {
        namespace: "quest_flags",
        slot: "expired_hint",
        delete: true,
      },
    ]);
    expect(secondRequest?.sessionStateWrites).toEqual(firstRequest?.sessionStateWrites);
  });

  it("parses session_state_writes for regenerate, retry, and edit-and-regenerate", async () => {
    const mocked = await buildChatApp();
    const writes = [
      {
        namespace: "quest_flags",
        slot: "companion",
        value: { mood: "ally" },
      },
      {
        namespace: "quest_flags",
        slot: "expired_hint",
        delete: true,
      },
    ];

    const regenerateResponse = await mocked.serviceApp.inject({
      method: "POST",
      payload: { session_state_writes: writes },
      url: "/sessions/session-1/regenerate",
    });
    const retryResponse = await mocked.serviceApp.inject({
      method: "POST",
      payload: { session_state_writes: writes },
      url: "/floors/floor-1/retry",
    });
    const editResponse = await mocked.serviceApp.inject({
      method: "POST",
      payload: { content: "Revise the turn.", session_state_writes: writes },
      url: "/messages/message-1/edit-and-regenerate",
    });

    expect(regenerateResponse.statusCode).toBe(200);
    expect(retryResponse.statusCode).toBe(200);
    expect(editResponse.statusCode).toBe(200);

    expect(mocked.regenerate.mock.calls[0]?.[1]?.sessionStateWrites).toEqual(writes);
    expect(mocked.retryFloor.mock.calls[0]?.[1]?.sessionStateWrites).toEqual(writes);
    expect(mocked.editAndRegenerate.mock.calls[0]?.[1]?.sessionStateWrites).toEqual(writes);
  });

  it("returns validation_error when a session_state_write mixes value and delete", async () => {
    const mocked = await buildChatApp();

    const response = await mocked.serviceApp.inject({
      method: "POST",
      payload: {
        message: "Continue the quest.",
        session_state_writes: [
          {
            namespace: "quest_flags",
            slot: "companion",
            value: { mood: "ally" },
            delete: true,
          },
        ],
      },
      url: "/sessions/session-1/respond",
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("validation_error");
    expect(mocked.respond).not.toHaveBeenCalled();
  });

  it("maps session-state errors without collapsing them to generic 500", async () => {
    const mocked = await buildChatApp({
      respondImpl: async () => {
        throw new ChatServiceError(
          "session_state_namespace_not_registered",
          "Session state namespace 'quest_flags' is not registered for session 'session-1'",
          new SessionStateServiceError(
            404,
            "session_state_namespace_not_registered",
            "Session state namespace 'quest_flags' is not registered for session 'session-1'",
          ),
        );
      },
    });

    const response = await mocked.serviceApp.inject({
      method: "POST",
      payload: {
        message: "Continue the quest.",
        session_state_writes: [
          {
            namespace: "quest_flags",
            slot: "companion",
            value: { mood: "ally" },
          },
        ],
      },
      url: "/sessions/session-1/respond",
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe("session_state_namespace_not_registered");
  });
});

async function buildChatApp(input: {
  enableClientData?: boolean;
  respondImpl?: (...args: unknown[]) => unknown | Promise<unknown>;
} = {}): Promise<MockedChatService & { serviceApp: FastifyInstance }> {
  const app = Fastify();
  app.addHook("onRequest", async (request) => {
    request.authContext = {
      kind: "authenticated",
      accountId: "default-admin",
      role: "admin",
      status: "active",
    };
  });

  const dryRun = vi.fn();
  const respond = vi.fn(async () => createRespondResult());
  const regenerate = vi.fn(async () => createRegenerateResult());
  const retryFloor = vi.fn(async () => createRespondResult());
  const editAndRegenerate = vi.fn(async () => createEditAndRegenerateResult());

  if (input.respondImpl) {
    respond.mockImplementation(input.respondImpl as never);
  }

  await registerChatRoutes(app, {
    dryRun,
    respond,
    regenerate,
    retryFloor,
    editAndRegenerate,
  } as unknown as ChatService, {
    enableSseChat: true,
    enablePromptDryRun: true,
    enableClientData: input.enableClientData ?? true,
  });
  await app.ready();
  apps.push(app);

  return {
    service: {
      dryRun,
      respond,
      regenerate,
      retryFloor,
      editAndRegenerate,
    } as unknown as ChatService,
    serviceApp: app,
    dryRun,
    respond,
    regenerate,
    retryFloor,
    editAndRegenerate,
  };
}

function createRespondResult() {
  return {
    floorId: "floor-1",
    floorNo: 1,
    branchId: "main",
    generatedText: "Hello",
    summaries: ["summary-1"],
    totalUsage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    },
    finalState: "committed" as const,
    memory: undefined,
  };
}

function createRegenerateResult() {
  return {
    ...createRespondResult(),
    previousFloorId: "floor-0",
  };
}

function createEditAndRegenerateResult() {
  return {
    ...createRespondResult(),
    sourceFloorId: "floor-0",
    sourceMessageId: "message-0",
  };
}
