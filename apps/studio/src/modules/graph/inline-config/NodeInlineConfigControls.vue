<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { NodeInlineConfigControl } from "./node-inline-config";

const props = defineProps<{
  controls: NodeInlineConfigControl[];
}>();

const emit = defineEmits<{
  (event: "update", payload: { path: string; value: unknown; emptyValue?: "delete" | "keep" | "null" }): void;
  (event: "open-inspector"): void;
}>();

const { t, te } = useI18n();
const drafts = reactive<Record<string, string>>({});

const visibleControls = computed(() => props.controls.filter((control) => control.type !== "summary" || Boolean(control.summary)));

function textOf(control: NodeInlineConfigControl): string {
  const value = control.value;
  if (control.type === "toggle_number") {
    return toggleNumberValue(control).value === undefined ? "" : String(toggleNumberValue(control).value);
  }
  return value === null || value === undefined ? "" : String(value);
}

function labelOf(control: NodeInlineConfigControl): string {
  return control.labelKey && te(control.labelKey) ? t(control.labelKey) : control.label;
}

function placeholderOf(control: NodeInlineConfigControl): string | undefined {
  return control.placeholderKey && te(control.placeholderKey) ? t(control.placeholderKey) : control.placeholder;
}

function hintOf(control: NodeInlineConfigControl): string | undefined {
  return control.hintKey && te(control.hintKey) ? t(control.hintKey) : control.hint;
}

function optionLabel(option: { label: string; labelKey?: string }): string {
  return option.labelKey && te(option.labelKey) ? t(option.labelKey) : option.label;
}

function refreshDrafts(): void {
  const known = new Set<string>();
  for (const control of props.controls) {
    if (control.type === "text" || control.type === "textarea" || control.type === "number" || control.type === "toggle_number") {
      known.add(control.key);
      drafts[control.key] = textOf(control);
    }
  }
  for (const key of Object.keys(drafts)) {
    if (!known.has(key)) {
      delete drafts[key];
    }
  }
}

watch(() => props.controls, refreshDrafts, { immediate: true, deep: true });

function stop(event: Event): void {
  event.stopPropagation();
}

function commit(control: NodeInlineConfigControl): void {
  const raw = drafts[control.key] ?? "";
  if (control.type === "toggle_number") {
    const current = toggleNumberValue(control);
    const numeric = Number(raw);
    emit("update", {
      path: control.path,
      value: { ...current, value: Number.isFinite(numeric) ? numeric : undefined },
      emptyValue: control.emptyValue,
    });
    return;
  }
  const value = control.type === "number" ? Number(raw) : raw;
  emit("update", { path: control.path, value, emptyValue: control.emptyValue });
}

function onInput(control: NodeInlineConfigControl, event: Event): void {
  drafts[control.key] = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
}

function onKeydown(control: NodeInlineConfigControl, event: KeyboardEvent): void {
  event.stopPropagation();
  if (event.key === "Escape") {
    drafts[control.key] = textOf(control);
    (event.target as HTMLInputElement | HTMLTextAreaElement).blur();
    return;
  }
  if (event.key === "Enter" && control.type !== "textarea") {
    event.preventDefault();
    commit(control);
    (event.target as HTMLInputElement | HTMLTextAreaElement).blur();
  }
}

function onSelect(control: NodeInlineConfigControl, event: Event): void {
  emit("update", { path: control.path, value: (event.target as HTMLSelectElement).value, emptyValue: control.emptyValue });
}

function onModelSource(control: NodeInlineConfigControl, event: Event): void {
  const profileId = (event.target as HTMLSelectElement).value;
  // 空值 = 继承：删除 execution.modelSource；选中某 profile = 写回 llm_profile 模式。
  emit("update", {
    path: control.path,
    value: profileId.length > 0 ? { mode: "llm_profile", profileId } : undefined,
    emptyValue: "delete",
  });
}

function onBoolean(control: NodeInlineConfigControl, event: Event): void {
  emit("update", { path: control.path, value: (event.target as HTMLInputElement).checked, emptyValue: control.emptyValue });
}

function toggleNumberValue(control: NodeInlineConfigControl): { enabled: boolean; value?: number } {
  const value = control.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { enabled: false };
  }
  return {
    enabled: value.enabled === true,
    ...(typeof value.value === "number" ? { value: value.value } : {}),
  };
}

function onToggleNumberEnabled(control: NodeInlineConfigControl, event: Event): void {
  const enabled = (event.target as HTMLInputElement).checked;
  const current = toggleNumberValue(control);
  emit("update", {
    path: control.path,
    value: {
      enabled,
      value: current.value ?? control.defaultNumberValue,
    },
    emptyValue: control.emptyValue,
  });
}
</script>

<template>
  <div
    v-if="visibleControls.length > 0"
    class="nic"
    @pointerdown="stop"
    @mousedown="stop"
    @click="stop"
    @keydown="stop"
  >
    <div
      v-for="control in visibleControls"
      :key="control.key"
      class="nic__row"
      :class="[`nic__row--${control.type}`, control.tone ? `nic__row--${control.tone}` : '']"
    >
      <template v-if="control.type === 'summary'">
        <button
          type="button"
          class="nic__summary"
          :title="hintOf(control)"
          @click="emit('open-inspector')"
        >
          <span class="nic__label">{{ labelOf(control) }}</span>
          <span class="nic__summary-text">{{ control.summary }}</span>
        </button>
      </template>

      <label v-else-if="control.type === 'model_source'" class="nic__field">
        <span class="nic__label" :title="hintOf(control)">{{ labelOf(control) }}</span>
        <select
          class="nic__select"
        :value="textOf(control)"
          @change="(event) => onModelSource(control, event)"
        >
          <option
            v-for="option in control.options ?? []"
            :key="option.value"
            :value="option.value"
          >
            {{ optionLabel(option) }}
          </option>
        </select>
      </label>

      <label v-else-if="control.type === 'toggle_number'" class="nic__field nic__field--toggle-number">
        <span class="nic__label" :title="hintOf(control)">{{ labelOf(control) }}</span>
        <span class="nic__toggle-number">
          <input
            type="checkbox"
            class="nic__checkbox"
            :checked="toggleNumberValue(control).enabled"
            @change="(event) => onToggleNumberEnabled(control, event)"
          />
          <input
            class="nic__input nic__input--toggle-number"
            type="number"
            :value="drafts[control.key] ?? ''"
            :min="control.min"
            :max="control.max"
            :step="control.step"
            :disabled="!toggleNumberValue(control).enabled"
            @input="(event) => onInput(control, event)"
            @blur="commit(control)"
            @keydown="(event) => onKeydown(control, event)"
          />
        </span>
      </label>

      <label v-else class="nic__field">
        <span class="nic__label" :title="hintOf(control)">{{ labelOf(control) }}</span>

        <textarea
          v-if="control.type === 'textarea'"
          class="nic__textarea"
          :value="drafts[control.key] ?? ''"
          :rows="control.rows ?? 2"
          :placeholder="placeholderOf(control)"
          spellcheck="false"
          @input="(event) => onInput(control, event)"
          @blur="commit(control)"
          @keydown="(event) => onKeydown(control, event)"
        />

        <select
          v-else-if="control.type === 'select'"
          class="nic__select"
          :value="textOf(control)"
          @change="(event) => onSelect(control, event)"
        >
          <option
            v-for="option in control.options ?? []"
            :key="option.value"
            :value="option.value"
          >
            {{ optionLabel(option) }}
          </option>
        </select>

        <input
          v-else-if="control.type === 'boolean'"
          type="checkbox"
          class="nic__checkbox"
          :checked="control.value === true"
          @change="(event) => onBoolean(control, event)"
        />

        <input
          v-else
          class="nic__input"
          :type="control.type === 'number' ? 'number' : 'text'"
          :value="drafts[control.key] ?? ''"
          :placeholder="placeholderOf(control)"
          @input="(event) => onInput(control, event)"
          @blur="commit(control)"
          @keydown="(event) => onKeydown(control, event)"
        />
      </label>
      <p v-if="control.type !== 'summary' && hintOf(control)" class="nic__hint">{{ hintOf(control) }}</p>
    </div>
  </div>
</template>

<style scoped>
/*
  节点卡片内联配置（nic）：不再用「边框盒子」包裹（避免卡片套卡片），
  改为一条顶部 hairline 与端口区分隔，控件用 float 底色的「凹陷填充条」，
  常态无边框、hover 微显边、聚焦才 accent 微环，贴合节点、克制干净。
*/
.nic {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 10px 8px 13px;
  padding-top: 7px;
  border-top: 1px solid var(--color-line-subtle);
}

.nic__row {
  min-width: 0;
}

.nic__field {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
}

.nic__field--toggle-number {
  grid-template-columns: 78px minmax(0, 1fr);
}

.nic__label{
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.02em;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nic__input,
.nic__select,
.nic__textarea {
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid transparent;
 border-radius: 5px;
  background: var(--color-float);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: 10px;
  line-height: 1.25;
  transition: border-color 150ms cubic-bezier(0.2, 0, 0, 1), background 150ms cubic-bezier(0.2, 0, 0, 1);
}

.nic__input,
.nic__select {
  height: 22px;
  padding: 2px 6px;
}

.nic__toggle-number {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.nic__input--toggle-number:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.nic__select {
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  padding-right: 18px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 5px center;
}

.nic__textarea {
  max-height: 54px;
  resize: none;
  padding: 5px 6px;
  white-space: pre-wrap;
}

.nic__input:hover,
.nic__select:hover,
.nic__textarea:hover {
  border-color: var(--color-line-subtle);
  background: color-mix(in srgb, var(--color-float) 80%, var(--color-panel) 20%);
}

.nic__checkbox {
  width: 14px;
  height: 14px;
  accent-color: var(--color-signal-accent);
  cursor: pointer;
}

.nic__summary {
  display: grid;
  width: 100%;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 6px;
  align-items: center;
  border: 0;
padding: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.nic__summary-text {
  min-width: 0;
  overflow: hidden;
padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: var(--color-float);
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: border-color 150ms cubic-bezier(0.2, 0, 0, 1), color 150ms cubic-bezier(0.2, 0, 0, 1);
}

.nic__summary:hover .nic__summary-text {
  border-color: var(--color-line-subtle);
  color: var(--color-text-primary);
}

.nic__hint {
  margin-top: 3px;
  padding-left: 58px;
  color: var(--color-text-muted);
  font-size: 9px;
  line-height: 1.3;
}

.nic__row--warning .nic__label,
.nic__row--warning .nic__hint,
.nic__row--warning .nic__summary-text {
  color: var(--color-signal-warn);
}

.nic__row--info .nic__summary-text {
  color: var(--color-signal-info);
}

.nic__input:focus,
.nic__select:focus,
.nic__textarea:focus,
.nic__summary:focus-visible .nic__summary-text {
  outline: none;
  border-color: var(--color-signal-accent);
  box-shadow: 0 0 0 1px var(--color-signal-accent);
}

.nic__summary:focus-visible {
  outline: none;
}
</style>
