import { formatNodeGraphDiagnostics, hasNodeGraphErrors } from './diagnostics.js';
import { createDefaultNodeTypeRegistry, type NodeTypeRegistry } from './registry.js';
import type {
  CompiledNodeGraph,
  NodeGraphCompilerOptions,
  NodeGraphDocument,
} from './types.js';
import { validateNodeGraph } from './validator.js';

export class NodeGraphCompileError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: CompiledNodeGraph['diagnostics'],
  ) {
    super(message);
    this.name = 'NodeGraphCompileError';
  }
}

export interface CompileNodeGraphOptions extends NodeGraphCompilerOptions {
  registry?: NodeTypeRegistry;
  throwOnError?: boolean;
}

export function compileNodeGraph(
  document: NodeGraphDocument,
  options: CompileNodeGraphOptions = {},
): CompiledNodeGraph {
  const registry = options.registry ?? createDefaultNodeTypeRegistry();
  const validation = validateNodeGraph(document, {
    registry,
    availablePermissions: options.availablePermissions,
  });

  const compiled: CompiledNodeGraph = {
    document,
    nodesById: validation.nodesById,
    incomingEdgesByNodeId: validation.incomingEdgesByNodeId,
    outgoingEdgesByNodeId: validation.outgoingEdgesByNodeId,
    topologicalLevels: validation.topologicalLevels,
    diagnostics: validation.diagnostics,
    isExecutable: validation.isValid,
  };

  if (options.throwOnError && hasNodeGraphErrors(compiled.diagnostics)) {
    throw new NodeGraphCompileError(
      `NodeGraph '${document.graphId}' is not executable.\n${formatNodeGraphDiagnostics(compiled.diagnostics)}`,
      compiled.diagnostics,
    );
  }

  return compiled;
}
