export const SCOPE_PRIORITY = ['page', 'floor', 'chat', 'global'] as const;
export type VariableScope = (typeof SCOPE_PRIORITY)[number];

/** 变量条目（已从 JSON 解析的领域对象） */
export interface VariableEntry {
  id: string;
  scope: VariableScope;
  scopeId: string;
  key: string;
  value: unknown;
  updatedAt: number;
}
