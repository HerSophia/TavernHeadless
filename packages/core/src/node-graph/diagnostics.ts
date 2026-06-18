import type { NodeGraphDiagnostic } from './types.js';

export function createNodeGraphDiagnostic(input: NodeGraphDiagnostic): NodeGraphDiagnostic {
  return input;
}

export function hasNodeGraphErrors(diagnostics: readonly NodeGraphDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

export function formatNodeGraphDiagnostics(diagnostics: readonly NodeGraphDiagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const target = diagnostic.nodeId
        ? ` node=${diagnostic.nodeId}`
        : diagnostic.edgeId
          ? ` edge=${diagnostic.edgeId}`
          : diagnostic.groupId
            ? ` group=${diagnostic.groupId}`
            : '';
      return `[${diagnostic.severity}:${diagnostic.code}${target}] ${diagnostic.message}`;
    })
    .join('\n');
}
