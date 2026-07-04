<script setup lang="ts">
import type {
  NodeGraphNodeTypeKnowledgeDetail,
  NodeGraphPhase,
  NodeGraphPortDefinition,
} from "@tavern/core/node-graph";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import {
  nodeTypeCategoryLabel,
  nodeTypeConfigFieldDescription,
  nodeTypeConfigFieldLabel,
  nodeTypeDetailText,
  nodeTypeExampleDescription,
  nodeTypeExampleTitle,
  nodeTypePitfallLabel,
  nodeTypePortDescriptionLabel,
} from "./node-type-view";

const props = defineProps<{
  detail?: NodeGraphNodeTypeKnowledgeDetail | null;
  compact?: boolean;
  unknownType?: string | null;
}>();

const { t, te } = useI18n();

const detail = computed(() => props.detail ?? null);
const text = computed(() => nodeTypeDetailText(detail.value ?? undefined, { t, te }));
const categoryLabel = computed(() =>
  detail.value ? nodeTypeCategoryLabel(detail.value.category, { t, te }) : "",
);
const configFields = computed(() => detail.value?.config?.fields ?? []);

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function phaseLabel(phase: NodeGraphPhase | string): string {
  const key = `graphNode.phase.${phase}`;
  return te(key) ? t(key) : phase;
}

function portLabel(name: string): string {
  const key = `graphNode.port.${name}`;
  return te(key) ? t(key) : name;
}

function portTypeLabel(type: string): string {
  const key = `graph.nodeType.portType.${type}`;
  return te(key) ? t(key) : type;
}

function fieldTypeLabel(type: string): string {
  const key = `graph.nodeType.fieldType.${type}`;
  return te(key) ? t(key) : type;
}

function sideEffectLabel(value: string | null | undefined): string {
  const effect = value ?? "none";
  const key = `graph.nodeType.sideEffect.${effect}`;
  return te(key) ? t(key) : effect;
}

function previewPolicyLabel(policy: string): string {
  const key = `graphNode.previewPolicy.${policy}`;
  return te(key) ? t(key) : policy;
}

function portText(port: NodeGraphPortDefinition): string {
  const marks: string[] = [portTypeLabel(port.type)];
  if (port.required) {
    marks.push(t("graph.nodeType.required"));
  }
  if (port.multiple) {
    marks.push(t("graph.nodeType.multiple"));
  }
  return marks.join(" · ");
}

function portDescription(port: NodeGraphPortDefinition, direction: "input" | "output"): string {
  const current = detail.value;
  if (!current) {
    return port.description ?? "";
  }
  return nodeTypePortDescriptionLabel(current.type, direction, port.name, port.description, { t, te });
}

function configFieldLabel(path: string, fallback?: string): string {
  const current = detail.value;
  return current ? nodeTypeConfigFieldLabel(current.type, path, fallback, { t, te }) : fallback ?? path;
}

function configFieldDescription(path: string, fallback: string): string {
  const current = detail.value;
  return current ? nodeTypeConfigFieldDescription(current.type, path, fallback, { t, te }) : fallback;
}

function exampleTitle(index: number, fallback: string): string {
  const current = detail.value;
  return current ? nodeTypeExampleTitle(current.type, index, fallback, { t, te }) : fallback;
}

function exampleDescription(index: number, fallback?: string): string {
  const current = detail.value;
  return current ? nodeTypeExampleDescription(current.type, index, fallback, { t, te }) : fallback ?? "";
}

function pitfallText(index: number, fallback: string): string {
  const current = detail.value;
  return current ? nodeTypePitfallLabel(current.type, index, fallback, { t, te }) : fallback;
}
</script>

<template>
  <div v-if="detail" class="space-y-3 text-xs">
    <header v-if="!compact" class="space-y-1 border-b border-line-subtle pb-3">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-sm font-medium text-text-primary">{{ text.title }}</h2>
        <span class="rounded border border-line-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
          {{ categoryLabel }}
        </span>
      </div>
      <div class="font-mono text-[10px] text-text-muted">
        {{ detail.type }}@{{ detail.typeVersion }}
      </div>
    </header>

    <section class="space-y-1.5">
      <p class="leading-relaxed text-text-secondary">{{ text.summary }}</p>
      <p v-if="text.usage" class="leading-relaxed text-text-muted">{{ text.usage }}</p>
    </section>

    <section class="flex flex-wrap gap-1.5 font-mono text-[10px] text-text-muted">
      <span class="rounded border border-line-subtle px-1.5 py-0.5">
        {{ t("graph.nodeType.sideEffectLabel") }}: {{ sideEffectLabel(detail.sideEffects) }}
      </span>
      <span class="rounded border border-line-subtle px-1.5 py-0.5">
        {{ t("graph.nodeType.preview") }}: {{ previewPolicyLabel(detail.previewPolicy) }}
      </span>
      <span class="rounded border border-line-subtle px-1.5 py-0.5">
        {{ t("graph.nodeType.phases") }}: {{ detail.supportedPhases.map(phaseLabel).join(" / ") }}
      </span>
    </section>

    <section class="grid gap-3" :class="compact ? '' : 'md:grid-cols-2'">
      <div class="space-y-1.5">
        <h3 class="text-[11px] font-medium text-text-secondary">{{ t("graph.nodeType.inputs") }}</h3>
        <p v-if="detail.inputPorts.length === 0" class="text-[10px] text-text-muted">
          {{ t("graph.nodeType.noPorts") }}
        </p>
        <div
          v-for="port in detail.inputPorts"
          :key="`in-${port.name}`"
          class="rounded border border-line-subtle bg-float/60 px-2 py-1.5"
        >
          <div class="flex items-center justify-between gap-2">
               <span class="font-mono text-[11px] text-text-secondary" :title="port.name">{{ portLabel(port.name) }}</span>
            <span class="font-mono text-[10px] text-text-muted">{{ portText(port) }}</span>
          </div>
          <p v-if="portDescription(port, 'input')" class="mt-1 leading-relaxed text-text-muted">
            {{ portDescription(port, "input") }}
          </p>
        </div>
      </div>

      <div class="space-y-1.5">
        <h3 class="text-[11px] font-medium text-text-secondary">{{ t("graph.nodeType.outputs") }}</h3>
        <p v-if="detail.outputPorts.length === 0" class="text-[10px] text-text-muted">
          {{ t("graph.nodeType.noPorts") }}
        </p>
        <div
          v-for="port in detail.outputPorts"
          :key="`out-${port.name}`"
          class="rounded border border-line-subtle bg-float/60 px-2 py-1.5"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-[11px] text-text-secondary" :title="port.name">{{ portLabel(port.name) }}</span>
            <span class="font-mono text-[10px] text-text-muted">{{ portText(port) }}</span>
          </div>
    <p v-if="portDescription(port, 'output')" class="mt-1 leading-relaxed text-text-muted">
            {{ portDescription(port, "output") }}
          </p>
        </div>
      </div>
    </section>

    <section class="space-y-1.5">
      <h3 class="text-[11px] font-medium text-text-secondary">{{ t("graph.nodeType.config") }}</h3>
      <p v-if="!detail.config || detail.config.mode === 'none'" class="text-[10px] text-text-muted">
        {{ t("graph.nodeType.noConfig") }}
      </p>
      <template v-else>
        <div
          v-for="field in configFields"
          :key="field.path"
          class="rounded border border-line-subtle bg-float/60 px-2 py-1.5"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-[11px] text-text-secondary">{{ field.path }}</span>
            <span v-if="configFieldLabel(field.path, field.label) !== field.path" class="text-[11px] text-text-muted">
              {{ configFieldLabel(field.path, field.label) }}
            </span>
            <span class="rounded border border-line-subtle px-1 font-mono text-[10px] text-text-muted">{{ fieldTypeLabel(field.type) }}</span>
            <span v-if="field.required" class="text-[10px] text-signal-warn">{{ t("graph.nodeType.required") }}</span>
          </div>
          <p class="mt-1 leading-relaxed text-text-muted">{{ configFieldDescription(field.path, field.description) }}</p>
          <p v-if="field.enumValues?.length" class="mt-1 font-mono text-[10px] text-text-muted">
            {{ field.enumValues.join(" / ") }}
          </p>
        </div>
      </template>
    </section>

    <section v-if="detail.permissionsRequired?.length" class="space-y-1.5">
      <h3 class="text-[11px] font-medium text-text-secondary">{{ t("graph.nodeType.permissions") }}</h3>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="permission in detail.permissionsRequired"
          :key="permission"
          class="rounded border border-line-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-muted"
        >{{ permission }}</span>
      </div>
    </section>

    <section v-if="!compact && detail.examples?.length" class="space-y-1.5">
      <h3 class="text-[11px] font-medium text-text-secondary">{{ t("graph.nodeType.examples") }}</h3>
      <div v-for="(example, index) in detail.examples" :key="example.title" class="rounded border border-line-subtle bg-float/60 px-2 py-1.5">
        <div class="text-[11px] font-medium text-text-secondary">{{ exampleTitle(index, example.title) }}</div>
        <p v-if="exampleDescription(index, example.description)" class="mt-1 leading-relaxed text-text-muted">
          {{ exampleDescription(index, example.description) }}
        </p>
        <pre
          v-if="example.node"
          class="mt-1 max-h-32 overflow-auto rounded bg-app px-2 py-1 font-mono text-[10px] leading-relaxed text-text-muted"
        >{{ formatJson(example.node) }}</pre>
      </div>
    </section>

    <section v-if="detail.pitfalls?.length" class="space-y-1.5">
      <h3 class="text-[11px] font-medium text-text-secondary">{{ t("graph.nodeType.pitfalls") }}</h3>
      <ul class="list-disc space-y-1 pl-4 text-text-muted">
        <li v-for="(pitfall, index) in detail.pitfalls" :key="pitfall">{{ pitfallText(index, pitfall) }}</li>
      </ul>
    </section>

    <section v-if="!compact && detail.relatedNodeTypes?.length" class="space-y-1.5">
      <h3 class="text-[11px] font-medium text-text-secondary">{{ t("graph.nodeType.related") }}</h3>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="related in detail.relatedNodeTypes"
          :key="related"
          class="rounded border border-line-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-muted"
        >{{ related }}</span>
      </div>
    </section>
  </div>

  <div v-else class="rounded border border-line-subtle bg-float/60 px-3 py-2 text-xs leading-relaxed text-text-muted">
    {{ t("graph.nodeType.unknown", { type: unknownType ?? "" }) }}
  </div>
</template>
