import {
  DEFAULT_NODE_GRAPH_ON_SKIP,
  NODE_GRAPH_ON_SKIP_BEHAVIORS,
  NODE_GRAPH_VALUE_SOURCES,
  validateNodeGraphConditionExpr,
  type NodeGraphConditionExpr,
  type NodeGraphConditionValidationIssue,
  type NodeGraphOnSkipBehavior,
  type NodeGraphValueLiteral,
  type NodeGraphValueRef,
  type NodeGraphValueSource,
} from "@tavern/core/node-graph";

export const CONTROL_CONDITION_OPS = [
  "exists",
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "and",
  "or",
  "not",
] as const;

export type ControlConditionOp = (typeof CONTROL_CONDITION_OPS)[number];

export const CONTROL_CONDITION_VALUE_OPS = ["exists"] as const;
export const CONTROL_CONDITION_COMPARISON_OPS = ["eq", "neq", "gt", "gte", "lt", "lte"] as const;
export const CONTROL_CONDITION_LOGICAL_OPS = ["and", "or", "not"] as const;

export type ControlConditionOperandKind = "literal" | "ref";
export type ControlConditionLiteralType = "string" | "number" | "boolean" | "null";

export const CONTROL_VALUE_SOURCE_OPTIONS = NODE_GRAPH_VALUE_SOURCES;
export const CONTROL_GATE_ON_SKIP_OPTIONS = NODE_GRAPH_ON_SKIP_BEHAVIORS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isConditionOp(value: unknown): value is ControlConditionOp {
  return typeof value === "string" && (CONTROL_CONDITION_OPS as readonly string[]).includes(value);
}

function isValueSource(value: unknown): value is NodeGraphValueSource {
  return typeof value === "string" && (NODE_GRAPH_VALUE_SOURCES as readonly string[]).includes(value);
}

function isOnSkipBehavior(value: unknown): value is NodeGraphOnSkipBehavior {
  return typeof value === "string" && (NODE_GRAPH_ON_SKIP_BEHAVIORS as readonly string[]).includes(value);
}

function isLiteral(value: unknown): value is NodeGraphValueLiteral {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

export function isNodeGraphValueRef(value: unknown): value is NodeGraphValueRef {
  return isRecord(value) && Array.isArray(value.path);
}

export function textToPath(text: string): string[] {
  return text
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function pathToText(ref: NodeGraphValueRef): string {
  return ref.path.join(".");
}

export function defaultValueRef(source: NodeGraphValueSource = "runtime", path: string[] = ["intent"]): NodeGraphValueRef {
  return { source, path };
}

export function normalizeValueRef(value: unknown, fallback: NodeGraphValueRef = defaultValueRef()): NodeGraphValueRef {
  if (!isRecord(value)) {
    return { ...fallback, path: [...fallback.path] };
  }
  const source = isValueSource(value.source) ? value.source : fallback.source;
  const path = Array.isArray(value.path)
    ? value.path.map((segment) => String(segment).trim()).filter((segment) => segment.length > 0)
    : [];
  return { source, path: path.length > 0 ? path : [...fallback.path] };
}

export function literalTypeOf(value: unknown): ControlConditionLiteralType {
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (value === null) {
    return "null";
  }
  return "string";
}

export function literalToText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

export function parseLiteral(type: ControlConditionLiteralType, text: string): NodeGraphValueLiteral {
  switch (type) {
    case "number": {
      const parsed = Number(text);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    case "boolean":
      return text === "true";
    case "null":
      return null;
    case "string":
    default:
      return text;
  }
}

function defaultRightValue(op: ControlConditionOp): NodeGraphValueLiteral {
  return op === "gt" || op === "gte" || op === "lt" || op === "lte" ? 0 : "";
}

function isNumberComparisonOp(op: ControlConditionOp): op is "gt" | "gte" | "lt" | "lte" {
  return op === "gt" || op === "gte" || op === "lt" || op === "lte";
}

export function defaultConditionExpr(op: ControlConditionOp = "exists"): NodeGraphConditionExpr {
  switch (op) {
    case "exists":
      return { op, value: defaultValueRef() };
    case "eq":
      return { op, left: defaultValueRef(), right: "" };
    case "neq":
      return { op, left: defaultValueRef(), right: "" };
    case "gt":
      return { op, left: defaultValueRef(), right: 0 };
    case "gte":
      return { op, left: defaultValueRef(), right: 0 };
    case "lt":
      return { op, left: defaultValueRef(), right: 0 };
    case "lte":
      return { op, left: defaultValueRef(), right: 0 };
    case "and":
    case "or":
      return { op, items: [defaultConditionExpr("exists")] };
    case "not":
      return { op, item: defaultConditionExpr("exists") };
  }
}

function normalizeRightOperand(op: ControlConditionOp, value: unknown): NodeGraphValueLiteral | NodeGraphValueRef {
  if (isNodeGraphValueRef(value)) {
    return normalizeValueRef(value);
  }
  if (isNumberComparisonOp(op)) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
  return isLiteral(value) ? value : "";
}

function normalizeComparisonExpr(
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
  record: Record<string, unknown>,
): NodeGraphConditionExpr {
  const left = normalizeValueRef(record.left);
  if (op === "eq" || op === "neq") {
    return { op, left, right: normalizeRightOperand(op, record.right) };
  }
  const right = normalizeRightOperand(op, record.right);
  return { op, left, right: isNodeGraphValueRef(right) ? right : typeof right === "number" ? right : 0 };
}

export function normalizeConditionExpr(expr: unknown): NodeGraphConditionExpr {
  const record = asRecord(expr);
  const op = isConditionOp(record.op) ? record.op : "exists";
  switch (op) {
    case "exists":
      return { op, value: normalizeValueRef(record.value) };
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return normalizeComparisonExpr(op, record);
    case "and":
    case "or": {
      const items = Array.isArray(record.items)
        ? record.items.map((item) => normalizeConditionExpr(item))
        : [];
      return { op, items: items.length > 0 ? items : [defaultConditionExpr("exists")] };
    }
    case "not":
      return { op, item: normalizeConditionExpr(record.item) };
  }
}

export function readControlConditionExpr(config: unknown): NodeGraphConditionExpr | null {
  const record = asRecord(config);
  if (record.condition === undefined) {
    return null;
  }
  return normalizeConditionExpr(record.condition);
}

export function writeControlConditionExpr(config: unknown, condition: NodeGraphConditionExpr | null): Record<string, unknown> {
  const next = { ...asRecord(config) };
  if (condition === null) {
    delete next.condition;
  } else {
    next.condition = condition;
  }
  return next;
}

export function readGateOnSkip(config: unknown): NodeGraphOnSkipBehavior {
  const value = asRecord(config).onSkip;
  return isOnSkipBehavior(value) ? value : DEFAULT_NODE_GRAPH_ON_SKIP;
}

export function writeGateOnSkipConfig(config: unknown, onSkip: NodeGraphOnSkipBehavior): Record<string, unknown> {
  return { ...asRecord(config), onSkip };
}

export function validateControlConditionExpr(expr: NodeGraphConditionExpr): NodeGraphConditionValidationIssue[] {
  return validateNodeGraphConditionExpr(expr);
}
