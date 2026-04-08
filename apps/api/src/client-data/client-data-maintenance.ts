import type { AppDb, DbExecutor } from "../db/client.js";
import { ClientDataRepository } from "./client-data-repository.js";
import { ClientDataService, type ClientDataConfig } from "./client-data-service.js";

export async function cleanExpiredClientDataItems(
  db: AppDb | DbExecutor,
  config: ClientDataConfig,
  options: { batchSize: number; now?: number },
): Promise<{ deleted: number; scanned: number; skipped: number }> {
  const repository = new ClientDataRepository(db);
  const service = new ClientDataService(db, config, () => options.now ?? Date.now());
  const now = options.now ?? Date.now();
  const expiredItems = repository.listExpiredItems(now, options.batchSize);
  let deleted = 0;
  let skipped = 0;

  for (const item of expiredItems) {
    const domain = repository.getDomainById(item.domainId);
    if (!domain) {
      skipped += 1;
      continue;
    }
    service.deleteItem(domain.accountId, item.domainId, item.id);
    deleted += 1;
  }

  return {
    deleted,
    scanned: expiredItems.length,
    skipped,
  };
}

export async function purgeDeletedClientDataDomains(
  db: AppDb | DbExecutor,
  options: { gracePeriodMs: number; now?: number },
): Promise<{ deleted: number; scanned: number; skipped: number }> {
  const repository = new ClientDataRepository(db);
  const now = options.now ?? Date.now();
  const domains = repository.listPurgeableDomains(now - options.gracePeriodMs);
  let deleted = 0;
  let skipped = 0;

  for (const domain of domains) {
    const removed = repository.hardDeleteDomain(domain.id);
    if (removed) {
      deleted += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    deleted,
    scanned: domains.length,
    skipped,
  };
}
