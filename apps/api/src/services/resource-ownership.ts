import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";

import type { AppDb } from "../db/client.js";
import { characters, characterVersions, floors, messagePages, messages, sessions } from "../db/schema.js";

export type OwnedCharacterVersionRecord = {
  id: string;
  characterId: string;
  dataJson: string;
};

export async function getOwnedSessionIds(
  db: AppDb,
  accountId: string,
  candidateSessionIds?: readonly string[]
): Promise<string[]> {
  const sessionIds = normalizeCandidateIds(candidateSessionIds);

  if (sessionIds && sessionIds.length === 0) {
    return [];
  }

  const whereClause = sessionIds
    ? and(eq(sessions.accountId, accountId), inArray(sessions.id, sessionIds))
    : eq(sessions.accountId, accountId);

  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(whereClause);

  return rows.map((row) => row.id);
}

export async function getOwnedFloorIds(
  db: AppDb,
  accountId: string,
  candidateFloorIds?: readonly string[]
): Promise<string[]> {
  const floorIds = normalizeCandidateIds(candidateFloorIds);

  if (floorIds && floorIds.length === 0) {
    return [];
  }

  if (floorIds) {
    const floorRows = await db
      .select({ id: floors.id, sessionId: floors.sessionId })
      .from(floors)
      .where(inArray(floors.id, floorIds));

    if (floorRows.length === 0) {
      return [];
    }

    const ownedSessionIds = new Set(
      await getOwnedSessionIds(
        db,
        accountId,
        floorRows.map((row) => row.sessionId)
      )
    );

    return floorRows.filter((row) => ownedSessionIds.has(row.sessionId)).map((row) => row.id);
  }

  const ownedSessionIds = await getOwnedSessionIds(db, accountId);

  if (ownedSessionIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({ id: floors.id })
    .from(floors)
    .where(inArray(floors.sessionId, ownedSessionIds));

  return rows.map((row) => row.id);
}

export async function getOwnedPageIds(
  db: AppDb,
  accountId: string,
  candidatePageIds?: readonly string[]
): Promise<string[]> {
  const pageIds = normalizeCandidateIds(candidatePageIds);

  if (pageIds && pageIds.length === 0) {
    return [];
  }

  if (pageIds) {
    const pageRows = await db
      .select({ id: messagePages.id, floorId: messagePages.floorId })
      .from(messagePages)
      .where(inArray(messagePages.id, pageIds));

    if (pageRows.length === 0) {
      return [];
    }

    const ownedFloorIds = new Set(
      await getOwnedFloorIds(
        db,
        accountId,
        pageRows.map((row) => row.floorId)
      )
    );

    return pageRows.filter((row) => ownedFloorIds.has(row.floorId)).map((row) => row.id);
  }

  const ownedFloorIds = await getOwnedFloorIds(db, accountId);

  if (ownedFloorIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({ id: messagePages.id })
    .from(messagePages)
    .where(inArray(messagePages.floorId, ownedFloorIds));

  return rows.map((row) => row.id);
}

export async function getOwnedMessageIds(
  db: AppDb,
  accountId: string,
  candidateMessageIds?: readonly string[]
): Promise<string[]> {
  const messageIds = normalizeCandidateIds(candidateMessageIds);

  if (messageIds && messageIds.length === 0) {
    return [];
  }

  if (messageIds) {
    const messageRows = await db
      .select({ id: messages.id, pageId: messages.pageId })
      .from(messages)
      .where(inArray(messages.id, messageIds));

    if (messageRows.length === 0) {
      return [];
    }

    const ownedPageIds = new Set(
      await getOwnedPageIds(
        db,
        accountId,
        messageRows.map((row) => row.pageId)
      )
    );

    return messageRows.filter((row) => ownedPageIds.has(row.pageId)).map((row) => row.id);
  }

  const ownedPageIds = await getOwnedPageIds(db, accountId);

  if (ownedPageIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(inArray(messages.pageId, ownedPageIds));

  return rows.map((row) => row.id);
}

export async function getOwnedFloorById(
  db: AppDb,
  accountId: string,
  floorId: string
): Promise<typeof floors.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(floors)
    .where(eq(floors.id, floorId))
    .limit(1);

  if (!row) {
    return null;
  }

  const ownedSessionIds = await getOwnedSessionIds(db, accountId, [row.sessionId]);

  return ownedSessionIds.length > 0 ? row : null;
}

export async function getOwnedPageById(
  db: AppDb,
  accountId: string,
  pageId: string
): Promise<typeof messagePages.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(messagePages)
    .where(eq(messagePages.id, pageId))
    .limit(1);

  if (!row) {
    return null;
  }

  const floor = await getOwnedFloorById(db, accountId, row.floorId);

  return floor ? row : null;
}

export async function getOwnedMessageById(
  db: AppDb,
  accountId: string,
  messageId: string
): Promise<typeof messages.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);

  if (!row) {
    return null;
  }

  const page = await getOwnedPageById(db, accountId, row.pageId);

  return page ? row : null;
}

export async function getOwnedActiveCharacterVersionById(
  db: AppDb,
  accountId: string,
  characterVersionId: string
): Promise<OwnedCharacterVersionRecord | null> {
  const [versionRow] = await db
    .select({
      id: characterVersions.id,
      characterId: characterVersions.characterId,
      dataJson: characterVersions.dataJson,
    })
    .from(characterVersions)
    .where(eq(characterVersions.id, characterVersionId))
    .limit(1);

  if (!versionRow) {
    return null;
  }

  const [character] = await db
    .select({ id: characters.id })
    .from(characters)
    .where(
      and(
        eq(characters.id, versionRow.characterId),
        eq(characters.accountId, accountId),
        eq(characters.status, "active")
      )
    )
    .limit(1);

  if (!character) {
    return null;
  }

  return versionRow;
}

export async function getLatestOwnedActiveCharacterVersion(
  db: AppDb,
  accountId: string,
  characterId: string
): Promise<OwnedCharacterVersionRecord | null> {
  const [character] = await db
    .select({ id: characters.id })
    .from(characters)
    .where(
      and(
        eq(characters.id, characterId),
        eq(characters.accountId, accountId),
        eq(characters.status, "active")
      )
    )
    .limit(1);

  if (!character) {
    return null;
  }

  const [versionRow] = await db
    .select({
      id: characterVersions.id,
      characterId: characterVersions.characterId,
      dataJson: characterVersions.dataJson,
    })
    .from(characterVersions)
    .where(eq(characterVersions.characterId, characterId))
    .orderBy(desc(characterVersions.versionNo))
    .limit(1);

  return versionRow ?? null;
}

export async function repairCrossAccountSessionCharacterBindings(
  db: AppDb,
  now: () => number = Date.now
): Promise<number> {
  const candidateRows = await db
    .select({
      id: sessions.id,
      accountId: sessions.accountId,
      characterId: sessions.characterId,
      characterVersionId: sessions.characterVersionId,
    })
    .from(sessions)
    .where(or(isNotNull(sessions.characterId), isNotNull(sessions.characterVersionId)));

  let repairedCount = 0;

  for (const row of candidateRows) {
    const hasCrossAccountBinding = await sessionHasCrossAccountCharacterBinding(db, row);
    if (!hasCrossAccountBinding) {
      continue;
    }

    await db
      .update(sessions)
      .set({
        characterId: null,
        characterVersionId: null,
        characterSnapshotJson: null,
        updatedAt: now(),
      })
      .where(eq(sessions.id, row.id));

    repairedCount += 1;
  }

  return repairedCount;
}

async function sessionHasCrossAccountCharacterBinding(
  db: AppDb,
  row: {
    id: string;
    accountId: string;
    characterId: string | null;
    characterVersionId: string | null;
  }
): Promise<boolean> {
  if (row.characterId) {
    const [character] = await db
      .select({ accountId: characters.accountId })
      .from(characters)
      .where(eq(characters.id, row.characterId))
      .limit(1);

    if (character && character.accountId !== row.accountId) {
      return true;
    }
  }

  if (row.characterVersionId) {
    const [version] = await db
      .select({ characterId: characterVersions.characterId })
      .from(characterVersions)
      .where(eq(characterVersions.id, row.characterVersionId))
      .limit(1);

    if (!version) {
      return false;
    }

    const [character] = await db
      .select({ accountId: characters.accountId })
      .from(characters)
      .where(eq(characters.id, version.characterId))
      .limit(1);

    if (character && character.accountId !== row.accountId) {
      return true;
    }
  }

  return false;
}

function normalizeCandidateIds(candidateIds?: readonly string[]): string[] | undefined {
  if (candidateIds === undefined) {
    return undefined;
  }

  return Array.from(new Set(candidateIds));
}
