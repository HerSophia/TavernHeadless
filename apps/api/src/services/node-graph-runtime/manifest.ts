/**
 * NodeGraph permission manifest runtime enforcement (R6-3, gap 6).
 *
 * `NodeGraphPermissionManifest` previously only had `required` enforced by the
 * validator; `outputTargets` / `toolScopes` were declared but never enforced at
 * runtime. This module turns the declared `outputTargets` allowlist into a real
 * runtime narrowing applied at commit, on top of the global
 * `assertAllowedOutputTargets` guard.
 *
 * Semantics:
 *  - `outputTargets === undefined` (not declared): no manifest-level narrowing.
 *    The global output-target policy still applies via the dispatcher.
 *  - `outputTargets` declared (including an empty array): only the listed
 *    targets may dispatch persistent outputs. An empty array means the graph
 *    declares it produces no persistent outputs, so every persistent output is
 *    rejected.
 *
 * `return_inline` is not a persistent output target and is never gated here.
 */
import type { NodeGraphDocument, NodeGraphPermissionManifest } from "@tavern/core";

export const NODE_GRAPH_OUTPUT_TARGET_NOT_IN_MANIFEST_REASON = "node_graph_output_target_not_in_manifest" as const;

/** Reads the declared output-target allowlist, or null when the manifest does not declare one. */
export function resolveNodeGraphManifestOutputTargets(
  document: Pick<NodeGraphDocument, "permissions">,
): string[] | null {
  const manifest: NodeGraphPermissionManifest | undefined = document.permissions;
  if (!manifest || manifest.outputTargets === undefined) {
    return null;
  }
  return [...manifest.outputTargets];
}

/**
 * Returns whether a persistent output target is allowed by the manifest.
 *
 * A null/undefined allowlist means the manifest declared no restriction, so the
 * target is allowed (the global output policy still applies downstream).
 */
export function isNodeGraphOutputTargetAllowedByManifest(
  manifestOutputTargets: readonly string[] | null | undefined,
  target: string,
): boolean {
  if (manifestOutputTargets === null || manifestOutputTargets === undefined) {
    return true;
  }
  return manifestOutputTargets.includes(target);
}
