import { NodeGraphExecutor } from "./executor.js";
import { NodeGraphNodeHandlerRegistry } from "./node-handler-registry.js";
import { registerBuiltinNodeGraphHandlers } from "./handlers/builtin.js";

export {
  NodeGraphExecutor,
  NodeGraphNodeExecutionError,
  type NodeGraphExecutedNodeRun,
  type NodeGraphExecutionResult,
  type NodeGraphNestedJobTraceRef,
  type NodeGraphOutputDispatchTraceRef,
  type NodeGraphPendingOutputDispatchRequest,
} from "./executor.js";
export {
  NodeGraphNodeHandlerRegistry,
  type NodeGraphNodeHandler,
  type NodeGraphNodeInputs,
  type NodeGraphRuntimeContext,
  type NodeGraphSubgraphRunInput,
  type NodeGraphSubgraphRunResult,
  type NodeGraphSubgraphRunner,
} from "./node-handler-registry.js";
export { previewNodeGraph, type NodeGraphPreviewInput } from "./preview.js";
export { registerBuiltinNodeGraphHandlers } from "./handlers/builtin.js";
export {
  NODE_GRAPH_OUTPUT_TARGET_NOT_IN_MANIFEST_REASON,
  isNodeGraphOutputTargetAllowedByManifest,
  resolveNodeGraphManifestOutputTargets,
} from "./manifest.js";
export {
  NATIVE_PROMPT_SYSTEM_GRAPH_ID,
  NATIVE_PROMPT_SYSTEM_GRAPH_VERSION,
  buildNativePromptSystemGraph,
  getNativePromptSystemGraph,
  validateNativePromptSystemGraph,
  assertNativePromptSystemGraphExecutable,
} from "./system-graph/native-prompt-system-graph.js";
export {
  COMPAT_PROMPT_SYSTEM_GRAPH_ID,
  COMPAT_PROMPT_SYSTEM_GRAPH_VERSION,
  buildCompatPromptSystemGraph,
  getCompatPromptSystemGraph,
  validateCompatPromptSystemGraph,
  assertCompatPromptSystemGraphExecutable,
} from "./system-graph/compat-prompt-system-graph.js";

export function createDefaultNodeGraphExecutor(): NodeGraphExecutor {
  const registry = new NodeGraphNodeHandlerRegistry();
  registerBuiltinNodeGraphHandlers(registry);
  return new NodeGraphExecutor(registry);
}
