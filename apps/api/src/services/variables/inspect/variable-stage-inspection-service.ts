import type { AppDb, DbExecutor } from "../../../db/client.js";
import { OwnedPageRepository } from "../../owned-resource-repositories.js";
import { VariableServiceError } from "../../variable-service-errors.js";
import type { PageVariableStageSnapshot } from "../contracts.js";
import { PageVariableStageService } from "../stage/page-variable-stage-service.js";

export class VariableStageInspectionService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  getPageSnapshot(accountId: string, pageId: string): PageVariableStageSnapshot {
    const page = new OwnedPageRepository(this.db).getContextById(accountId, pageId);
    if (!page) {
      throw new VariableServiceError("variable_host_not_found", `Page '${pageId}' not found`);
    }

    return {
      pageId: page.id,
      floorId: page.floorId,
      sessionId: page.sessionId,
      branchId: page.branchId,
      items: new PageVariableStageService(this.db).listByPageId(accountId, pageId),
    };
  }
}
