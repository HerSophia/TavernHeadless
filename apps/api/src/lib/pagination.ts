import { asc, desc, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";

export const sortOrderSchema = z.enum(["asc", "desc"]);

export const listQuerySchemaBase = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort_order: sortOrderSchema.default("desc")
});

export type SortOrder = z.infer<typeof sortOrderSchema>;

export function toOrderBy(column: SQLWrapper, sortOrder: SortOrder) {
  return sortOrder === "asc" ? asc(column) : desc(column);
}

export function buildListMeta(input: {
  total: number;
  limit: number;
  offset: number;
  sortBy: string;
  sortOrder: SortOrder;
}) {
  return {
    total: input.total,
    limit: input.limit,
    offset: input.offset,
    has_more: input.offset + input.limit < input.total,
    sort_by: input.sortBy,
    sort_order: input.sortOrder
  };
}
