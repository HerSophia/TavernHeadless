/**
 * Shared JSON Schema constants used across multiple route files.
 */

export const idParamsJsonSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const errorResponseJsonSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: {},
      },
      additionalProperties: true,
    },
  },
  additionalProperties: false,
} as const;

// ── Batch Operation Schemas ────────────────────────────

import { z } from "zod";

/**
 * Reusable Zod schema for batch id arrays.
 * - 1..100 items
 * - Each id must be a non-empty string
 * - Duplicate id detection via superRefine
 */
export const batchIdArraySchema = z
  .array(z.string().min(1))
  .min(1)
  .max(100)
  .superRefine((ids, ctx) => {
    const seen = new Map<string, number>();
    ids.forEach((id, index) => {
      const first = seen.get(id);
      if (first !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `Duplicate id also appears at ids.${first}`,
        });
        return;
      }
      seen.set(id, index);
    });
  });

/** JSON Schema for batch delete request body: { ids: string[] } */
export const batchDeleteBodyJsonSchema = {
  type: "object",
  required: ["ids"],
  properties: {
    ids: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "string", minLength: 1 },
    },
  },
  additionalProperties: false,
} as const;

/** Factory for batch status update request body JSON Schema */
export function batchStatusBodyJsonSchema(statusEnum: string[]) {
  return {
    type: "object" as const,
    required: ["ids", "status"],
    properties: {
      ids: {
        type: "array" as const,
        minItems: 1,
        maxItems: 100,
        items: { type: "string" as const, minLength: 1 },
      },
      status: { type: "string" as const, enum: statusEnum },
    },
    additionalProperties: false,
  };
}

/** JSON Schema for batch operation response */
export const batchResultResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["results", "meta"],
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "integer" },
              id: { type: "string" },
              action: { type: "string" },
            },
          },
        },
        meta: { type: "object", additionalProperties: true },
      },
    },
  },
  additionalProperties: false,
} as const;
