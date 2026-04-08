import type { ClientDataItemRecord, TavernClient } from "@tavern/sdk";

export type ClientDataOwner = {
  ownerType: "application" | "plugin";
  ownerId: string;
};

export type ClientDataCollectionItemsMap = Record<string, ClientDataItemRecord[]>;
export type ClientDataValueMap = Record<string, Record<string, unknown>>;

export function buildPluginOwner(pluginId: string): ClientDataOwner {
  return {
    ownerType: "plugin",
    ownerId: pluginId,
  };
}

export function buildApplicationOwner(appId: string): ClientDataOwner {
  return {
    ownerType: "application",
    ownerId: appId,
  };
}

export function groupItemsByCollection(items: ClientDataItemRecord[]): ClientDataCollectionItemsMap {
  const grouped: ClientDataCollectionItemsMap = {};

  for (const item of items) {
    const collectionItems = grouped[item.collectionId] ?? [];
    collectionItems.push(item);
    grouped[item.collectionId] = collectionItems;
  }

  return grouped;
}

export function organizeCollectionItems(items: ClientDataItemRecord[]): Array<{
  collectionId: string;
  items: ClientDataItemRecord[];
}> {
  return Object.entries(groupItemsByCollection(items)).map(([collectionId, collectionItems]) => ({
    collectionId,
    items: collectionItems,
  }));
}

export function toClientDataMap(items: ClientDataItemRecord[], collections?: Array<{ id: string; collectionName: string }>): ClientDataValueMap {
  const collectionNameById = new Map<string, string>();

  for (const collection of collections ?? []) {
    collectionNameById.set(collection.id, collection.collectionName);
  }

  const result: ClientDataValueMap = {};

  for (const item of items) {
    const collectionName = collectionNameById.get(item.collectionId) ?? item.collectionId;
    const collectionMap = result[collectionName] ?? {};
    collectionMap[item.itemKey] = item.valueJson;
    result[collectionName] = collectionMap;
  }

  return result;
}

export async function resolveItemByPath(
  client: Pick<TavernClient, "clientData">,
  domainId: string,
  collectionName: string,
  itemKey: string,
  options?: { accountId?: string },
): Promise<ClientDataItemRecord> {
  return client.clientData.items.getByKey({
    accountId: options?.accountId,
    domainId,
    collectionName,
    itemKey,
  });
}
