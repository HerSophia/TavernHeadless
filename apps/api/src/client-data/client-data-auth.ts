import type { FastifyReply, FastifyRequest } from "fastify";

import { sendError } from "../lib/http.js";

export interface ClientDataCallerOwner {
  ownerType: "application" | "plugin";
  ownerId: string;
}

const OWNER_TYPE_HEADER = "x-client-owner-type";
const OWNER_ID_HEADER = "x-client-owner-id";

export function parseClientDataCallerOwner(request: FastifyRequest): ClientDataCallerOwner | null {
  const ownerType = readSingleHeader(request.headers[OWNER_TYPE_HEADER]);
  const ownerId = readSingleHeader(request.headers[OWNER_ID_HEADER]);

  if (!ownerType && !ownerId) {
    return null;
  }

  if (!ownerType || !ownerId) {
    throw new Error("client_data_caller_owner_invalid");
  }

  if (ownerType !== "application" && ownerType !== "plugin") {
    throw new Error("client_data_caller_owner_invalid");
  }

  return {
    ownerType,
    ownerId,
  };
}

export function sendClientDataCallerOwnerError(reply: FastifyReply) {
  return sendError(reply, 400, "client_data_caller_owner_invalid", "Client data caller owner headers are invalid");
}

function readSingleHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const item = value.find((entry) => typeof entry === "string" && entry.trim().length > 0);
    return item?.trim();
  }

  return undefined;
}
