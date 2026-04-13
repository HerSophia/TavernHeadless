import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { PromptRuntimeControlServiceError } from "../src/services/prompt-runtime-control-service.js";

describe("app error handler", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("maps PromptRuntimeControlServiceError to API error responses", async () => {
    const built = await buildApp({
      auth: { mode: "off" },
      databasePath: ":memory:",
      enableClientData: false,
      enableMcp: false,
      enableWebSocket: false,
      logger: false,
    });
    app = built.app;

    app.get("/__test/prompt-runtime-error", async () => {
      throw new PromptRuntimeControlServiceError(
        404,
        "prompt_runtime_explain_not_found",
        "Prompt Runtime explain not found for floor 'floor-1'",
      );
    });

    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/__test/prompt-runtime-error",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "prompt_runtime_explain_not_found",
        message: "Prompt Runtime explain not found for floor 'floor-1'",
      },
    });
  });
});
