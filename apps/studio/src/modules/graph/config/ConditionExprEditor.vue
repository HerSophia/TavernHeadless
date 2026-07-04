<script setup lang="ts">
import type {
  NodeGraphConditionExpr,
  NodeGraphValueLiteral,
  NodeGraphValueRef,
  NodeGraphValueSource,
} from "@tavern/core/node-graph";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import {
  CONTROL_CONDITION_COMPARISON_OPS,
  CONTROL_CONDITION_OPS,
  CONTROL_VALUE_SOURCE_OPTIONS,
  defaultConditionExpr,
  defaultValueRef,
  isNodeGraphValueRef,
  literalToText,
  literalTypeOf,
  normalizeConditionExpr,
  normalizeValueRef,
  parseLiteral,
  pathToText,
  textToPath,
  type ControlConditionLiteralType,
  type ControlConditionOp,
} from "./control-node-config";

defineOptions({ name: "ConditionExprEditor" });

const props = withDefaults(
  defineProps<{
    expr: NodeGraphConditionExpr;
    depth?: number;
    maxDepth?: number;
  }>(),
  { depth: 0, maxDepth: 3 },
);

const emit = defineEmits<{
  (event: "update:expr", expr: NodeGraphConditionExpr): void;
}>();

const { t } = useI18n();

const expression = computed(() => normalizeConditionExpr(props.expr));
const canNest = computed(() => props.depth < props.maxDepth);
const comparisonOps = CONTROL_CONDITION_COMPARISON_OPS as readonly string[];

function emitExpr(expr: NodeGraphConditionExpr): void {
  emit("update:expr", expr);
}

function selectValue(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

function onOpChange(event: Event): void {
  emitExpr(defaultConditionExpr(selectValue(event) as ControlConditionOp));
}

function isComparisonExpr(expr: NodeGraphConditionExpr): expr is Extract<NodeGraphConditionExpr, { op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" }> {
  return comparisonOps.includes(expr.op);
}

function valueRef(role: "value" | "left" | "right"): NodeGraphValueRef {
  const expr = expression.value;
  if (role === "value" && expr.op === "exists") {
    return normalizeValueRef(expr.value);
  }
  if (role === "left" && isComparisonExpr(expr)) {
    return normalizeValueRef(expr.left);
  }
  if (role === "right" && isComparisonExpr(expr) && isNodeGraphValueRef(expr.right)) {
    return normalizeValueRef(expr.right);
  }
  return defaultValueRef();
}

function updateValueRef(role: "value" | "left" | "right", patch: Partial<NodeGraphValueRef>): void {
  const expr = expression.value;
  const current = valueRef(role);
  const next = {
    ...current,
    ...patch,
    path: patch.path ? [...patch.path] : [...current.path],
  };
  if (role === "value" && expr.op === "exists") {
    emitExpr({ ...expr, value: next });
    return;
  }
  if (role === "left" && isComparisonExpr(expr)) {
    emitExpr({ ...expr, left: next });
    return;
  }
  if (role === "right" && isComparisonExpr(expr)) {
    emitExpr({ ...expr, right: next });
  }
}

function updateRefSource(role: "value" | "left" | "right", event: Event): void {
  updateValueRef(role, { source: selectValue(event) as NodeGraphValueSource });
}

function updateRefPath(role: "value" | "left" | "right", event: Event): void {
  updateValueRef(role, { path: textToPath(inputValue(event)) });
}

function rightValue(): NodeGraphValueLiteral | NodeGraphValueRef {
  const expr = expression.value;
  if (isComparisonExpr(expr)) {
    return expr.right;
  }
  return "";
}

function rightKind(): "literal" | "ref" {
  return isNodeGraphValueRef(rightValue()) ? "ref" : "literal";
}

function rightLiteralType(): ControlConditionLiteralType {
  return literalTypeOf(rightValue());
}

function rightLiteralText(): string {
  return literalToText(rightValue());
}

function setRightValue(value: NodeGraphValueLiteral | NodeGraphValueRef): void {
  const expr = expression.value;
  if (!isComparisonExpr(expr)) {
    return;
  }
  emitExpr({ ...expr, right: value } as NodeGraphConditionExpr);
}

function updateRightKind(event: Event): void {
  if (selectValue(event) === "ref") {
    setRightValue(defaultValueRef());
    return;
  }
  const expr = expression.value;
  setRightValue(expr.op === "gt" || expr.op === "gte" || expr.op === "lt" || expr.op === "lte" ? 0 : "");
}

function updateRightLiteralType(event: Event): void {
  const type = selectValue(event) as ControlConditionLiteralType;
  setRightValue(parseLiteral(type, rightLiteralText()));
}

function updateRightLiteralValue(event: Event): void {
  setRightValue(parseLiteral(rightLiteralType(), inputValue(event)));
}

function updateBooleanLiteral(event: Event): void {
  setRightValue(parseLiteral("boolean", selectValue(event)));
}

function logicalItems(): NodeGraphConditionExpr[] {
  const expr = expression.value;
  return expr.op === "and" || expr.op === "or" ? expr.items : [];
}

function updateItem(index: number, next: NodeGraphConditionExpr): void {
  const expr = expression.value;
  if (expr.op !== "and" && expr.op !== "or") {
    return;
  }
  const items = [...expr.items];
  items[index] = next;
  emitExpr({ ...expr, items });
}

function addItem(): void {
  const expr = expression.value;
  if (expr.op !== "and" && expr.op !== "or") {
    return;
  }
  emitExpr({ ...expr, items: [...expr.items, defaultConditionExpr("exists")] });
}

function removeItem(index: number): void {
  const expr = expression.value;
  if (expr.op !== "and" && expr.op !== "or") {
    return;
  }
  const items = expr.items.filter((_, itemIndex) => itemIndex !== index);
  emitExpr({ ...expr, items: items.length > 0 ? items : [defaultConditionExpr("exists")] });
}

function notItem(): NodeGraphConditionExpr {
  const expr = expression.value;
  return expr.op === "not" ? expr.item : defaultConditionExpr("exists");
}

function updateNotItem(next: NodeGraphConditionExpr): void {
  const expr = expression.value;
  if (expr.op === "not") {
    emitExpr({ ...expr, item: next });
  }
}
</script>

<template>
  <div class="space-y-2 rounded-md border border-line-subtle bg-panel/60 p-2">
    <label class="block">
      <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.controlConfig.operator") }}</span>
      <select
        class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
        :value="expression.op"
        @change="onOpChange"
      >
        <option v-for="op in CONTROL_CONDITION_OPS" :key="op" :value="op">
          {{ t(`graph.controlConfig.op.${op}`) }}
        </option>
      </select>
    </label>

    <div v-if="expression.op === 'exists'" class="grid grid-cols-[7rem_1fr] gap-2">
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.controlConfig.source") }}</span>
        <select
          class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="valueRef('value').source"
          @change="(event) => updateRefSource('value', event)"
        >
          <option v-for="source in CONTROL_VALUE_SOURCE_OPTIONS" :key="source" :value="source">{{ source }}</option>
        </select>
      </label>
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.controlConfig.path") }}</span>
        <input
          class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="pathToText(valueRef('value'))"
          :placeholder="'intent'"
          @change="(event) => updateRefPath('value', event)"
        />
      </label>
    </div>

    <div v-else-if="isComparisonExpr(expression)" class="space-y-2">
      <div class="grid grid-cols-[7rem_1fr] gap-2">
        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.controlConfig.leftSource") }}</span>
          <select
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="valueRef('left').source"
            @change="(event) => updateRefSource('left', event)"
          >
            <option v-for="source in CONTROL_VALUE_SOURCE_OPTIONS" :key="source" :value="source">{{ source }}</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.controlConfig.leftPath") }}</span>
          <input
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="pathToText(valueRef('left'))"
            :placeholder="'intent'"
            @change="(event) => updateRefPath('left', event)"
          />
        </label>
      </div>

      <div class="grid grid-cols-[7rem_1fr] gap-2">
        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.controlConfig.rightKind") }}</span>
          <select
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="rightKind()"
            @change="updateRightKind"
          >
            <option value="literal">{{ t("graph.controlConfig.literal") }}</option>
            <option value="ref">{{ t("graph.controlConfig.ref") }}</option>
          </select>
        </label>

        <div v-if="rightKind() === 'ref'" class="grid grid-cols-[7rem_1fr] gap-2">
          <select
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="valueRef('right').source"
            @change="(event) => updateRefSource('right', event)"
          >
            <option v-for="source in CONTROL_VALUE_SOURCE_OPTIONS" :key="source" :value="source">{{ source }}</option>
          </select>
          <input
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="pathToText(valueRef('right'))"
            :placeholder="'intent'"
            @change="(event) => updateRefPath('right', event)"
          />
        </div>

        <div v-else class="grid grid-cols-[7rem_1fr] gap-2">
          <select
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="rightLiteralType()"
            @change="updateRightLiteralType"
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="null">null</option>
          </select>
          <select
            v-if="rightLiteralType() === 'boolean'"
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="rightLiteralText() || 'false'"
            @change="updateBooleanLiteral"
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
          <input
            v-else-if="rightLiteralType() !== 'null'"
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="rightLiteralText()"
            @change="updateRightLiteralValue"
          />
          <span v-else class="rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-xs text-text-muted">null</span>
        </div>
      </div>
    </div>

    <div v-else-if="expression.op === 'and' || expression.op === 'or'" class="space-y-2">
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-text-muted">{{ t("graph.controlConfig.items") }}</span>
        <button
          v-if="canNest"
          type="button"
          class="ml-auto rounded border border-line-subtle px-1.5 py-0.5 text-[10px] text-text-muted transition-colors duration-150 hover:border-line-active hover:text-text-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          @click="addItem"
        >
          {{ t("graph.controlConfig.addItem") }}
        </button>
      </div>
      <p v-if="!canNest" class="text-[10px] leading-relaxed text-signal-warn">{{ t("graph.controlConfig.maxDepthHint") }}</p>
      <div v-for="(item, index) in logicalItems()" :key="index" class="space-y-1">
        <div class="flex items-center gap-2 text-[10px] text-text-muted">
          <span>{{ t("graph.controlConfig.item") }} {{ index + 1 }}</span>
          <button
            type="button"
            class="ml-auto rounded px-1 text-text-muted transition-colors duration-150 hover:bg-float hover:text-signal-error focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            @click="removeItem(index)"
          >
            {{ t("graph.controlConfig.removeItem") }}
          </button>
        </div>
        <ConditionExprEditor
          :expr="item"
          :depth="depth + 1"
          :max-depth="maxDepth"
    @update:expr="(next) => updateItem(index, next)"
        />
      </div>
    </div>

    <div v-else-if="expression.op === 'not'" class="space-y-2">
      <span class="block text-[11px] text-text-muted">{{ t("graph.controlConfig.notItem") }}</span>
      <ConditionExprEditor
        :expr="notItem()"
        :depth="depth + 1"
        :max-depth="maxDepth"
        @update:expr="updateNotItem"
      />
    </div>
  </div>
</template>
