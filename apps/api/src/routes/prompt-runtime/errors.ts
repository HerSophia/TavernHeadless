import type { FastifyReply } from "fastify";

import { sendError } from "../../lib/http.js";
import { ChatServiceError } from "../../services/chat/errors.js";

export function sendPromptRuntimeInspectServiceError(reply: FastifyReply, error: unknown) {
  if (error instanceof ChatServiceError) {
    return sendError(reply, mapChatServiceErrorStatus(error.code), error.code, error.message, error.details);
  }

  return sendError(reply, 500, "internal_error", error instanceof Error ? error.message : "Unknown error");
}

function mapChatServiceErrorStatus(code: string): number {
  switch (code) {
    case "session_not_found":
    case "source_floor_not_found":
      return 404;
    case "session_archived":
    case "invalid_state":
    case "generation_target_stale":
    case "branch_local_snapshot_missing":
      return 409;
    case "feature_unavailable":
      return 503;
    default:
      return 400;
  }
}
