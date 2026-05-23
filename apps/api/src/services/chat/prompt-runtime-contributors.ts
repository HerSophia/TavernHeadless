import { parseJsonField } from "../../lib/http.js";

import {
  resolvePromptModeDetails,
  type PromptMode,
  type SessionMetadata,
} from "../prompt-assembler.js";

import type {
  FirstPartyStateContext,
  PreparedPromptArtifactsMode,
  PromptRuntimeContributorKind,
  PromptRuntimeContributorOutput,
  PromptRuntimeContributorRenderable,
  PromptRuntimeContributorView,
} from "./types.js";

export function resolvePreparedPromptArtifactsPromptMode(args: {
  mode: PreparedPromptArtifactsMode;
  session: { promptMode?: PromptMode | null; metadataJson: string | null };
}): PromptMode {
  const metadata = parseJsonField(args.session.metadataJson);
  const sessionMetadata = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as SessionMetadata)
    : {};

  return resolvePromptModeDetails(
    { promptMode: args.session.promptMode ?? null },
    sessionMetadata,
  ).effectivePromptMode;
}

export function isContributorModeEnabled(promptMode: PromptMode): boolean {
  return promptMode === "compat_plus" || promptMode === "native";
}

export function resolveContributorModeScope(promptMode: PromptMode): "compat_plus" | "native" {
  return promptMode === "native" ? "native" : "compat_plus";
}

export function buildPromptRuntimeContributorView(
  contributor: PromptRuntimeContributorOutput,
): PromptRuntimeContributorView {
  return {
    id: contributor.id,
    kind: contributor.kind,
    sourceKind: contributor.sourceKind,
    modeScope: contributor.modeScope,
    promptRenderable: contributor.promptRenderable,
    deterministic: contributor.trace.deterministic,
    cacheScope: contributor.trace.cacheScope,
  };
}

export function buildPromptRuntimeContributorViews(
  contributors: PromptRuntimeContributorOutput[],
): PromptRuntimeContributorView[] {
  return contributors.map((contributor) => buildPromptRuntimeContributorView(contributor));
}

export function buildFirstPartyStateProjectionRenderable(
  firstPartyStateContext: FirstPartyStateContext | undefined,
): PromptRuntimeContributorRenderable | undefined {
  const sceneLines = buildSceneProjectionLines(firstPartyStateContext?.scene ?? null);
  const worldLines = buildWorldProjectionLines(firstPartyStateContext?.world ?? null);
  const content = [...sceneLines, ...worldLines].join("\n").trim();
  if (!content) {
    return undefined;
  }

  return {
    title: "Managed state projection",
    content,
  };
}

function buildSceneProjectionLines(
  scene: FirstPartyStateContext["scene"],
): string[] {
  if (!scene || !scene.present) {
    return [];
  }

  const lines: string[] = [
    `Scene source: ${scene.source}`,
  ];

  if (scene.floorId) {
    lines.push(`Scene floor_id: ${scene.floorId}`);
  }
  if (scene.updatedAt !== null) {
    lines.push(`Scene updated_at: ${scene.updatedAt}`);
  }
  if (scene.schemaVersion !== null) {
    lines.push(`Scene schema_version: ${scene.schemaVersion}`);
  }
  if (scene.scene?.generatedText?.trim()) {
    lines.push("Scene generated_text:");
    lines.push(scene.scene.generatedText.trim());
  }
  if (scene.scene?.summaries?.length) {
    lines.push("Scene summaries:");
    for (const summary of scene.scene.summaries) {
      if (summary.trim()) {
        lines.push(`- ${summary.trim()}`);
      }
    }
  }

  return lines;
}

function buildWorldProjectionLines(
  world: FirstPartyStateContext["world"],
): string[] {
  if (!world || !world.present) {
    return [];
  }

  const lines: string[] = [
    `World source: ${world.source}`,
  ];

  if (world.floorId) {
    lines.push(`World floor_id: ${world.floorId}`);
  }
  if (world.updatedAt !== null) {
    lines.push(`World updated_at: ${world.updatedAt}`);
  }
  if (world.schemaVersion !== null) {
    lines.push(`World schema_version: ${world.schemaVersion}`);
  }
  if (world.world?.worldbookId) {
    lines.push(`World worldbook_id: ${world.world.worldbookId}`);
  }
  if (world.world?.worldbookVersion !== null && world.world?.worldbookVersion !== undefined) {
    lines.push(`World worldbook_version: ${world.world.worldbookVersion}`);
  }
  if (world.world?.summaryLines?.length) {
    lines.push("World summaries:");
    for (const line of world.world.summaryLines) {
      if (line.trim()) {
        lines.push(`- ${line.trim()}`);
      }
    }
  }

  return lines;
}

export interface PromptRuntimeBuiltinContributorResult {
  kind: PromptRuntimeContributorKind;
  contributor?: PromptRuntimeContributorOutput;
}

export function buildPromptRuntimeContributorRenderablesForAssembly(
  contributors: PromptRuntimeContributorOutput[],
  promptMode: PromptMode,
): Array<{ sourceKind: string; title: string; content: string }> {
  if (promptMode === "compat_strict") {
    return [];
  }

  if (promptMode === "compat_plus") {
    return contributors.flatMap((contributor) => mapCompatPlusContributorRenderable(contributor));
  }

  return contributors.flatMap((contributor) => mapNativeContributorRenderable(contributor));
}

function mapCompatPlusContributorRenderable(
  contributor: PromptRuntimeContributorOutput,
): Array<{ sourceKind: string; title: string; content: string }> {
  if (!contributor.promptRenderable) {
    return [];
  }

  if (contributor.kind === "memory_projection") {
    return [];
  }

  return [{
    sourceKind: contributor.sourceKind,
    title: contributor.promptRenderable.title,
    content: contributor.promptRenderable.content,
  }];
}

function mapNativeContributorRenderable(
  contributor: PromptRuntimeContributorOutput,
): Array<{ sourceKind: string; title: string; content: string }> {
  if (!contributor.promptRenderable) {
    return [];
  }

  if (contributor.kind === "memory_projection") {
    return [];
  }

  return [{
    sourceKind: contributor.sourceKind,
    title: contributor.promptRenderable.title,
    content: contributor.promptRenderable.content,
  }];
}
