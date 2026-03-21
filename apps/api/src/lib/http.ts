import type { FastifyReply } from "fastify";
import { ZodError, type ZodTypeAny, z } from "zod";

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
) {
  const errorBody: {
    error: {
      code: string;
      message: string;
      details?: unknown;
    };
  } = {
    error: {
      code,
      message
    }
  };

  if (details !== undefined) {
    errorBody.error.details = details;
  }

  return reply.code(statusCode).send(errorBody);
}

export function zodIssues(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code
  }));
}

export function parseWithSchema<TSchema extends ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  reply: FastifyReply
): { ok: true; data: z.infer<TSchema> } | { ok: false } {
  const result = schema.safeParse(input);

  if (!result.success) {
    sendError(reply, 400, "validation_error", "Request validation failed", zodIssues(result.error));
    return { ok: false };
  }

  return {
    ok: true,
    data: result.data
  };
}

export function parseJsonField(value: string | null): unknown {
  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function stringifyJsonField(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

export function requireRow<T>(row: T | undefined, message: string): T {
  if (row === undefined) {
    throw new Error(message);
  }

  return row;
}

export function ensureOptionalObjectBody(request: { body?: unknown }): void {
  if (request.body === undefined || request.body === null) {
    (request as { body: Record<string, never> }).body = {};
  }
}

