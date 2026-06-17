import { describe, expect, it } from "vitest";

import { readAgentOriginFromMetadataJson } from "../temporary-conversation-service.js";

describe("readAgentOriginFromMetadataJson", () => {
  it("把 snake_case 的 agent_origin 反序列化回 camelCase", () => {
    const metadataJson= JSON.stringify({
      tool_permissions: { allow_irreversible: false },
      agent_origin: {
        source_agent_run_id: "run_1",
        parent_run_id: "run_parent",
        root_run_id: "run_root",
        source_node_run_id: "node_1",
        source_page_id: "page_1",
        source_floor_id: "floor_1",
        source_session_id: "sess_1",
        source_attempt_no: 2,
      },
    });

    const origin = readAgentOriginFromMetadataJson(metadataJson);

    expect(origin).toEqual({
      sourceAgentRunId: "run_1",
      parentRunId: "run_parent",
      rootRunId: "run_root",
      sourceNodeRunId: "node_1",
      sourcePageId: "page_1",
      sourceFloorId: "floor_1",
      sourceSessionId: "sess_1",
      sourceAttemptNo: 2,
    });
  });

  it("只解析存在的字段", () => {
    const metadataJson = JSON.stringify({
      agent_origin: { source_agent_run_id: "run_1" },
    });

    expect(readAgentOriginFromMetadataJson(metadataJson)).toEqual({
      sourceAgentRunId: "run_1",
    });
  });

  it("缺少 agent_origin 时返回 null", () => {
    expect(readAgentOriginFromMetadataJson(JSON.stringify({ other: 1 }))).toBeNull();
  });

  it("agent_origin 为空对象时返回 null", () => {
    expect(readAgentOriginFromMetadataJson(JSON.stringify({ agent_origin: {} }))).toBeNull();
  });

  it("metadataJson 为 null 时返回 null", () => {
    expect(readAgentOriginFromMetadataJson(null)).toBeNull();
  });

  it("metadataJson 不是合法 JSON 时返回 null", () => {
    expect(readAgentOriginFromMetadataJson("{not json")).toBeNull();
  });

  it("忽略类型不符的字段", () => {
    const metadataJson = JSON.stringify({
      agent_origin: {
    source_agent_run_id: "run_1",
        source_attempt_no: "not-a-number",
        parent_run_id: "",
      },
    });

    expect(readAgentOriginFromMetadataJson(metadataJson)).toEqual({
      sourceAgentRunId: "run_1",
    });
  });
});
