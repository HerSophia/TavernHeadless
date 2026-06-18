export type NodeGraphValueLiteral = string | number | boolean | null;

export type NodeGraphValueRef = {
  path: string[];
};

export type NodeGraphConditionExpr =
  | { op: 'eq'; left: NodeGraphValueRef; right: NodeGraphValueLiteral | NodeGraphValueRef }
  | { op: 'neq'; left: NodeGraphValueRef; right: NodeGraphValueLiteral | NodeGraphValueRef }
  | { op: 'gt' | 'gte' | 'lt' | 'lte'; left: NodeGraphValueRef; right: number | NodeGraphValueRef }
  | { op: 'exists' | 'empty'; value: NodeGraphValueRef }
  | { op: 'contains'; value: NodeGraphValueRef; item: NodeGraphValueLiteral | NodeGraphValueRef }
  | { op: 'and' | 'or'; items: NodeGraphConditionExpr[] }
  | { op: 'not'; item: NodeGraphConditionExpr };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readValueRef(context: Record<string, unknown>, ref: NodeGraphValueRef): unknown {
  let current: unknown = context;
  for (const segment of ref.path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function resolveOperand(context: Record<string, unknown>, operand: NodeGraphValueLiteral | NodeGraphValueRef): unknown {
  if (isRecord(operand) && Array.isArray(operand.path)) {
    return readValueRef(context, operand);
  }
  return operand;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length === 0;
  }
  if (isRecord(value)) {
    return Object.keys(value).length === 0;
  }
  return false;
}

function compareNumber(left: unknown, right: unknown, op: 'gt' | 'gte' | 'lt' | 'lte'): boolean {
  if (typeof left !== 'number' || typeof right !== 'number') {
    return false;
  }
  switch (op) {
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
  }
}

export function evaluateNodeGraphCondition(
  expr: NodeGraphConditionExpr,
  context: Record<string, unknown>,
): boolean {
  switch (expr.op) {
    case 'eq':
      return readValueRef(context, expr.left) === resolveOperand(context, expr.right);
    case 'neq':
      return readValueRef(context, expr.left) !== resolveOperand(context, expr.right);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return compareNumber(readValueRef(context, expr.left), resolveOperand(context, expr.right), expr.op);
    case 'exists':
      return readValueRef(context, expr.value) !== undefined;
    case 'empty':
      return isEmpty(readValueRef(context, expr.value));
    case 'contains': {
      const value = readValueRef(context, expr.value);
      const item = resolveOperand(context, expr.item);
      if (typeof value === 'string') {
        return typeof item === 'string' && value.includes(item);
      }
      if (Array.isArray(value)) {
        return value.includes(item);
      }
      return false;
    }
    case 'and':
      return expr.items.every((item) => evaluateNodeGraphCondition(item, context));
    case 'or':
      return expr.items.some((item) => evaluateNodeGraphCondition(item, context));
    case 'not':
      return !evaluateNodeGraphCondition(expr.item, context);
  }
}
