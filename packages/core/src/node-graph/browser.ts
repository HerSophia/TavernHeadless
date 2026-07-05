/**
 * NodeGraph 浏览器安全子路径（B10 / `@tavern/core/node-graph`）。
 *
 * 只聚合**纯逻辑**：types / diagnostics / registry / compiler / condition / control /
 * checkpoint / migration / validator。前端（apps/studio）由此复用与后端完全相同的
 * validator / registry / condition / migration，杜绝前后端校验漂移。
 *
 * 刻意**不**导出 `./package/index.js`：其 `export.ts` 依赖 `node:crypto`（`createHash`），
 * 不可进入浏览器包。package 的导出 / contentHash 仅在后端计算。
 *
 * 守卫：`__tests__/browser-subpath.test.ts` 断言本入口不暴露 package-export 符号。
 */
export type {
  CompiledNodeGraph,
  NodeGraphBudgetOverrides,
  NodeGraphRuntimeBudget,
  NodeGraphCheckpointPolicy,
  NodeGraphCompilerOptions,
  NodeGraphDiagnostic,
  NodeGraphDocument,
  NodeGraphEdge,
  NodeGraphEdgeEndpoint,
  NodeGraphEdgeKind,
  NodeGraphExposedGroupConfig,
  NodeGraphFailurePolicy,
  NodeGraphGroup,
  NodeGraphNode,
  NodeGraphNodeCategory,
  NodeGraphNodeConfigFieldKnowledge,
  NodeGraphNodeConfigFieldType,
  NodeGraphNodeConfigKnowledge,
  NodeGraphNodeExample,
  NodeGraphNodeRunOutput,
  NodeGraphNodeRunRecord,
  NodeGraphNodeRunStatus,
  NodeGraphNodeScope,
  NodeGraphNodeTypeKnowledge,
  NodeGraphNodeTypeKnowledgeDetail,
  NodeGraphNodeTypeKnowledgeListItem,
  NodeGraphNodeTypePortSummary,
  NodeGraphPermissionManifest,
  NodeGraphPhase,
  NodeGraphPolicies,
  NodeGraphPortDefinition,
  NodeGraphPortType,
  NodeGraphPreview,
  NodeGraphPreviewPolicy,
  NodeGraphRetryPolicy,
  NodeGraphRunIntent,
  NodeGraphRunRecord,
  NodeGraphRunStatus,
  NodeGraphSchemaVersion,
  NodeTypeRegistryEntry,
} from './types.js';
export {
  NODE_GRAPH_CHECKPOINT_POLICIES,
  NODE_GRAPH_NODE_CATEGORIES,
  NODE_GRAPH_NODE_SCOPES,
  NODE_GRAPH_PHASES,
  NODE_GRAPH_PORT_TYPES,
  NODE_GRAPH_SCHEMA_VERSION,
  NODE_GRAPH_SCHEMA_VERSION_V2,
  NODE_GRAPH_SUPPORTED_SCHEMA_VERSIONS,
} from './types.js';
export {
  DEFAULT_NODE_GRAPH_RUNTIME_BUDGET,
  DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET,
  countNodeGraphNestedAgentJobs,
  countNodeGraphTemporaryConversations,
  countRuntimeNodes,
  resolveNodeGraphBudget,
  summarizeNodeGraphBudgetUsage,
  type NodeGraphBudgetUsageSummary,
} from './budget.js';
export {
  createNodeGraphDiagnostic,
  formatNodeGraphDiagnostics,
  hasNodeGraphErrors,
} from './diagnostics.js';
export {
  NODE_GRAPH_BUILTIN_NODE_TYPES,
  NodeTypeRegistry,
  createDefaultNodeTypeRegistry,
} from './registry.js';
export {
  NODE_GRAPH_NODE_CATEGORY_LABELS,
  describeNodeTypeKnowledge,
  describeNodeTypeKnowledgeFromEntry,
  getNodeTypeCategoryLabel,
  listNodeTypeKnowledge,
} from './node-type-knowledge.js';
export {
  NODE_GRAPH_ANNOTATION_COMMENT_TYPE,
  NODE_GRAPH_ANNOTATION_NODE_TYPES,
  isNodeGraphAnnotationNodeType,
  type NodeGraphAnnotationNodeType,
} from './annotation.js';
export {
  NodeGraphCompileError,
  compileNodeGraph,
  type CompileNodeGraphOptions,
} from './compiler.js';
export {
  collectNodeGraphConditionValueRefs,
  evaluateNodeGraphCondition,
  evaluateNodeGraphConditionWithTrace,
  validateNodeGraphConditionExpr,
  NODE_GRAPH_VALUE_SOURCES,
  type NodeGraphConditionExpr,
  type NodeGraphConditionTraceEntry,
  type NodeGraphConditionValidationIssue,
  type NodeGraphConditionValidationOptions,
  type NodeGraphValueLiteral,
  type NodeGraphValueRef,
  type NodeGraphValueSource,
} from './condition.js';
export {
  computeNodeGraphControlSignal,
  isNodeGraphControlEdge,
  isNodeGraphControlNodeType,
  nodeGraphControlOutputPorts,
  nodeGraphEdgeKind,
  resolveNodeGraphControlActivation,
  DEFAULT_NODE_GRAPH_ON_SKIP,
  NODE_GRAPH_CONTROL_NODE_TYPES,
  NODE_GRAPH_CONTROL_OUTPUT_PORTS,
  NODE_GRAPH_ON_SKIP_BEHAVIORS,
  type NodeGraphControlActivation,
  type NodeGraphControlActivationInput,
  type NodeGraphControlNodeType,
  type NodeGraphControlSignal,
  type NodeGraphOnSkipBehavior,
} from './control.js';
export {
  classifyNodeGraphCheckpointReuse,
  isNodeFloorCheckpointEligible,
  isNodeGraphPreResponsePhase,
  type NodeGraphCheckpointEligibilityInput,
  type NodeGraphCheckpointReuseDecision,
  type NodeGraphCheckpointReuseInput,
  type NodeGraphCheckpointReuseReason,
  type NodeGraphCheckpointReuseResult,
} from './checkpoint.js';
export {
  detectNodeGraphSchemaMigration,
  migrateNodeGraphDocumentToV2,
  nodeGraphDocumentSchemaVersion,
  type NodeGraphMigrationResult,
  type NodeGraphSchemaMigrationDiagnostic,
} from './migration.js';
export {
  arePortTypesCompatible,
  validateNodeGraph,
  type NodeGraphValidationOptions,
  type NodeGraphValidationResult,
} from './validator.js';
export {
  NODE_GRAPH_AGENT_SOURCES,
  readNodeGraphPresetRef,
  readNodeGraphSubgraphRef,
  resolveNodeGraphAgentSource,
  type NodeGraphAgentSource,
  type NodeGraphPresetRef,
  type NodeGraphSubgraphRef,
} from './agent-source.js';
export {
  deriveSubgraphInterface,
  groupSwitchState,
  isNodeGraphGroupNodeType,
  readGroupNodeInterface,
  readGroupNodeRef,
  resolveNodeGraphNodePorts,
  NODE_GRAPH_GROUP_INPUT_TYPE,
  NODE_GRAPH_GROUP_NODE_TYPE,
  NODE_GRAPH_GROUP_OUTPUT_TYPE,
  type NodeGraphGroupNodeRef,
  type NodeGraphGroupSwitchState,
  type NodeGraphSubgraphInterface,
} from './subgraph.js';
export {
  buildNativePromptFloorStructure,
  buildNativePromptFloorTemplate,
  NATIVE_PROMPT_FLOOR_TEMPLATE_ID,
  NATIVE_PROMPT_FLOOR_TEMPLATE_VERSION,
  type NativePromptFloorStructure,
} from './templates/native-prompt-floor.js';
export {
  buildCompatPromptFloorStructure,
  buildCompatPromptFloorTemplate,
  COMPAT_PROMPT_FLOOR_TEMPLATE_ID,
  COMPAT_PROMPT_FLOOR_TEMPLATE_VERSION,
  type CompatPromptFloorStructure,
} from './templates/compat-prompt-floor.js';
export {
  BUILTIN_ADVISOR_SUBGRAPH_VERSION,
  DIRECTOR_ADVISOR_SUBGRAPH_ID,
  CONTINUITY_VERIFIER_SUBGRAPH_ID,
  PLAYER_AGENCY_VERIFIER_SUBGRAPH_ID,
  MEMORY_RETRIEVE_SUBGRAPH_ID,
  buildDirectorAdvisorSubgraph,
  buildContinuityVerifierSubgraph,
  buildPlayerAgencyVerifierSubgraph,
  buildMemoryRetrieveSubgraph,
  listBuiltinAdvisorSubgraphs,
  BUILTIN_ADVISOR_SUBGRAPH_IDS,
  isBuiltinAdvisorSubgraphId,
  getBuiltinAdvisorSubgraphById,
  NATIVE_PROMPT_FLOOR_SUBGRAPH_REF_TEMPLATE_ID,
  buildNativePromptFloorTemplateWithAdvisorRefs,
} from './templates/builtin-advisor-subgraphs.js';
