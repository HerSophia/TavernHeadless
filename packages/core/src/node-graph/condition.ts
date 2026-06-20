export type NodeGraphValueLiteral = string | number | boolean | null;

/**
 * NG2-CORE：受控值来源（纲领第 9.1 节）。
 *
 * - `variable`：分支/会话变量。
 * - `session_state`：会话状态投影。
 * - `node_output`：上游节点输出（path 第一段为 nodeId）。
 * - `runtime`：运行时上下文（intent / dryRun / phase 等）。
 */
export type NodeGraphValueSource =
  | 'variable'
  | 'session_state'
  | 'node_output'
  | 'runtime';

export const NODE_GRAPH_VALUE_SOURCES = [
  'variable',
  'session_state',
  'node_output',
  'runtime',
] as const;

export type NodeGraphValueRef = {
  /**
   * 受控来源。缺省时从上下文根读取（保持与 v1 求值器及既有调用兼容）。
   */
  source?: NodeGraphValueSource;
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

function isValueRef(value: unknown): value is NodeGraphValueRef {
  return isRecord(value) && Array.isArray((value as { path?: unknown }).path);
}

function readValueRef(context: Record<string, unknown>, ref: NodeGraphValueRef): unknown {
  let current: unknown = ref.source ? context[ref.source] : context;
  for (const segment of ref.path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function resolveOperand(context: Record<string, unknown>, operand: NodeGraphValueLiteral | NodeGraphValueRef): unknown {
  if (isValueRef(operand)) {
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

/** 收集条件表达式中出现的全部 ValueRef，用于校验来源引用。 */
export function collectNodeGraphConditionValueRefs(expr: NodeGraphConditionExpr): NodeGraphValueRef[] {
  const refs: NodeGraphValueRef[] = [];
  const visit = (node: NodeGraphConditionExpr): void => {
    switch (node.op) {
      case 'eq':
      case 'neq':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        refs.push(node.left);
        if (isValueRef(node.right)) {
          refs.push(node.right);
        }
        break;
      case 'exists':
      case 'empty':
        refs.push(node.value);
        break;
      case 'contains':
        refs.push(node.value);
        if (isValueRef(node.item)) {
          refs.push(node.item);
        }
        break;
      case 'and':
      case 'or':
        node.items.forEach(visit);
        break;
      case 'not':
        visit(node.item);
        break;
    }
  };
  visit(expr);
  return refs;
}

export interface NodeGraphConditionValidationOptions {
  /** 最大嵌套深度（默认 5）。 */
  maxDepth?: number;
  /** 单个 and/or 子项数上限（默认 16）。 */
  maxItems?: number;
}

export interface NodeGraphConditionValidationIssue {
  code:
    | 'condition_invalid_shape'
    | 'condition_too_deep'
    | 'condition_too_many_items'
    | 'condition_empty_items'
    | 'condition_unknown_value_source';
  message: string;
}

const DEFAULT_CONDITION_MAX_DEPTH = 5;
const DEFAULT_CONDITION_MAX_ITEMS = 16;

/**
 * NG2-CORE：结构化条件表达式静态校验（复杂度上限 + 形态 + 来源枚举）。
 *
 * 不做求值，只检查结构合法性，供 validator 在编译期拒绝危险/畸形条件。
 */
export function validateNodeGraphConditionExpr(
  expr: unknown,
  options: NodeGraphConditionValidationOptions = {},
): NodeGraphConditionValidationIssue[] {
  const maxDepth = options.maxDepth ?? DEFAULT_CONDITION_MAX_DEPTH;
  const maxItems = options.maxItems ?? DEFAULT_CONDITION_MAX_ITEMS;
  const issues: NodeGraphConditionValidationIssue[] = [];

  const visit = (node: unknown, depth: number): void => {
    if (depth > maxDepth) {
      issues.push({
        code: 'condition_too_deep',
        message: `Condition nesting depth exceeds limit ${maxDepth}.`,
      });
      return;
    }
    if (!isRecord(node) || typeof node.op !== 'string') {
      issues.push({ code: 'condition_invalid_shape', message: 'Condition node is malformed.' });
      return;
    }
    switch (node.op) {
      case 'eq':
      case 'neq':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        checkRef(node.left);
        if (isValueRef(node.right)) {
          checkRef(node.right);
        }
        break;
      case 'exists':
      case 'empty':
        checkRef(node.value);
        break;
      case 'contains':
        checkRef(node.value);
        if (isValueRef(node.item)) {
          checkRef(node.item);
        }
        break;
      case 'and':
      case 'or': {
        if (!Array.isArray(node.items)) {
          issues.push({ code: 'condition_invalid_shape', message: `'${node.op}' requires an items array.` });
          break;
        }
        if (node.items.length === 0) {
          issues.push({ code: 'condition_empty_items', message: `'${node.op}' must have at least one item.` });
        }
        if (node.items.length > maxItems) {
          issues.push({
            code: 'condition_too_many_items',
            message: `'${node.op}' has ${node.items.length} items, exceeding limit ${maxItems}.`,
          });
        }
        for (const item of node.items) {
          visit(item, depth + 1);
        }
        break;
      }
      case 'not':
        visit(node.item, depth + 1);
        break;
      default:
        issues.push({ code: 'condition_invalid_shape', message: `Unknown condition op '${String(node.op)}'.` });
    }
  };

  const checkRef = (ref: unknown): void => {
    if (!isValueRef(ref)) {
      issues.push({ code: 'condition_invalid_shape', message: 'Value reference must have a path array.' });
      return;
    }
    const source = (ref as NodeGraphValueRef).source;
    if (source !== undefined && !NODE_GRAPH_VALUE_SOURCES.includes(source)) {
      issues.push({
        code: 'condition_unknown_value_source',
        message: `Unknown value ref source '${String(source)}'.`,
      });
    }
  };

  visit(expr, 1);
  return issues;
}

export interface NodeGraphConditionTraceEntry {
  op: string;
  result: boolean;
}

/**
 * NG2-CORE：带轨迹的条件求值，供 dry-run 暴露条件如何判定（纲领第 9.3 节）。
 *
 * `trace` 列出顶层及每个子表达式的判定结果，不泄露大体量正文。
 */
export function evaluateNodeGraphConditionWithTrace(
  expr: NodeGraphConditionExpr,
  context: Record<string, unknown>,
): { result: boolean; trace: NodeGraphConditionTraceEntry[] } {
  const trace: NodeGraphConditionTraceEntry[] = [];
  const evalNode = (node: NodeGraphConditionExpr): boolean => {
    let result: boolean;
    switch (node.op) {
      case 'and':
        result = node.items.every((item) => evalNode(item));
        break;
      case 'or':
        result = node.items.some((item) => evalNode(item));
        break;
      case 'not':
        result = !evalNode(node.item);
        break;
      default:
        result = evaluateNodeGraphCondition(node, context);
    }
    trace.push({ op: node.op, result });
    return result;
  };
  const result = evalNode(expr);
  return { result, trace };
}
