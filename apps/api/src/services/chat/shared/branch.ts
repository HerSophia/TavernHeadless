export function normalizeBranchId(value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized) {
    return "main";
  }

  return normalized;
}
