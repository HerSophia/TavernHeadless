export function buildSessionWorldbookAssetScopeId(args: { id: string; version: number | string | null }): string {
  return `worldbook:${args.id}:${args.version ?? "unversioned"}`;
}

export function buildCharacterBookAssetScopeId(
  characterId?: string | null,
  characterVersionId?: string | null,
): string {
  if (characterId && characterVersionId) {
    return `worldbook:character:${characterId}:${characterVersionId}:book`;
  }
  if (characterId) {
    return `worldbook:character:${characterId}:unknown:book`;
  }
  return "worldbook:character:unbound:book";
}

export function buildWorldbookActivationKey(assetScopeId: string, uid: number): string {
  return `${assetScopeId}:entry:${uid}`;
}
