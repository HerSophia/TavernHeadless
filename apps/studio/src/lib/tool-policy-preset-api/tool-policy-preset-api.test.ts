import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { API_BASE, toolPolicyPresetHandlers } from "../../test/msw/handlers";
import { ToolPolicyPresetApiError, toolPolicyPresetApi } from "./index";

const server = setupServer(...toolPolicyPresetHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers(...toolPolicyPresetHandlers));
afterAll(() => server.close());

describe("toolPolicyPresetApi (msw)", () => {
  it("lists presets and tool catalog for a project", async () => {
    const result = await toolPolicyPresetApi.list("p1");
    expect(result.tool_catalog.length).toBeGreaterThan(0);
    expect(result.presets.map((preset) => preset.preset_key)).toContain("asset-management");
  });

  it("gets preset detail with per-tool effective policy", async () => {
    const detail = await toolPolicyPresetApi.getDetail("p1", "asset-management");
    expect(detail.preset_key).toBe("asset-management");
    const create = detail.tools.find((tool) => tool.tool_name === "create_character");
    expect(create).toMatchObject({ enabled: true, default_decision: "confirm" });
  });

  it("updates a preset config and reflects enabled tools", async () => {
    const detail = await toolPolicyPresetApi.update("p1", "regular-chat", {
      enabled_tools: ["list_characters"],
    });
    const listTool = detail.tools.find((tool) => tool.tool_name === "list_characters");
    expect(listTool?.enabled).toBe(true);
    const createTool = detail.tools.find((tool) => tool.tool_name === "create_character");
    expect(createTool?.enabled).toBe(false);
  });

  it("creates a custom preset", async () => {
    const detail = await toolPolicyPresetApi.create("p1", {
      preset_key: "my-preset",
      display_name: "My Preset",
      config: { enabled_tools: ["list_characters"] },
    });
    expect(detail.preset_key).toBe("my-preset");
    expect(detail.kind).toBe("custom");
  });

  it("removes a custom preset", async () => {
    const result = await toolPolicyPresetApi.remove("p1", "my-preset");
    expect(result).toMatchObject({ ok: true });
  });

  it("throws a typed error on non-2xx", async () => {
    server.use(
      http.get(`${API_BASE}/projects/missing/tool-policy-presets`, () =>
        HttpResponse.json({ message: "denied" }, { status: 403 }),
      ),
    );
    await expect(toolPolicyPresetApi.list("missing")).rejects.toBeInstanceOf(
      ToolPolicyPresetApiError,
    );
    await expect(toolPolicyPresetApi.list("missing")).rejects.toMatchObject({ status: 403 });
  });
});
