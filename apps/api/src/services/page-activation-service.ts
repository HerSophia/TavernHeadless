import { and, eq } from "drizzle-orm";

import type { AppDb } from "../db/client.js";
import { messagePages } from "../db/schema.js";
import {
  getFloorContentMutationRejection,
  type FloorContentMutationRejection,
} from "./floor-content-mutability-policy.js";
import { OwnedPageRepository, type OwnedPageContext } from "./owned-resource-repositories.js";

export type PageActivationResult =
  | { kind: "not_found" }
  | { kind: "rejected"; rejection: FloorContentMutationRejection }
  | { kind: "activated"; page: typeof messagePages.$inferSelect };

export class PageActivationService {
  constructor(private readonly db: AppDb) {}

  activateVersion(accountId: string, pageId: string): PageActivationResult {
    return this.db.transaction((tx) => {
      const ownedPages = new OwnedPageRepository(tx);
      const targetPage = ownedPages.getContextById(accountId, pageId);

      if (!targetPage) {
        return { kind: "not_found" };
      }

      const rejection = getFloorContentMutationRejection({
        mutationKind: "page.activate",
        floorState: targetPage.floorState,
        pageKind: targetPage.pageKind,
      });

      if (rejection) {
        return { kind: "rejected", rejection };
      }

      if (targetPage.isActive) {
        return { kind: "activated", page: toPageRecord(targetPage) };
      }

      const now = Date.now();

      tx
        .update(messagePages)
        .set({ isActive: false, updatedAt: now })
        .where(
          and(
            eq(messagePages.floorId, targetPage.floorId),
            eq(messagePages.pageNo, targetPage.pageNo),
            eq(messagePages.isActive, true)
          )
        )
        .run();

      const updated = tx
        .update(messagePages)
        .set({ isActive: true, updatedAt: now })
        .where(eq(messagePages.id, pageId))
        .returning()
        .all()[0];

      if (!updated) {
        return { kind: "not_found" };
      }

      return { kind: "activated", page: updated };
    });
  }
}

function toPageRecord(page: OwnedPageContext): typeof messagePages.$inferSelect {
  return {
    id: page.id,
    floorId: page.floorId,
    pageNo: page.pageNo,
    pageKind: page.pageKind,
    isActive: page.isActive,
    version: page.version,
    checksum: page.checksum,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}
