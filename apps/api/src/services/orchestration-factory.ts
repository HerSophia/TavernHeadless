/**
 * Orchestration Factory
 *
 * Composition Root：组装 @tavern/core 的全部组件，
 * 创建可用于请求处理的 OrchestrationContext。
 *
 * 调用方（app.ts / 测试）提供 Provider 配置和 DB Adapter，
 * 工厂负责创建 EventBus、LLMService、Pipeline、Orchestrator 等。
 */

import {
  createEventBus,
  FloorStateMachine,
  GenerationPipeline,
  LLMService,
  MemoryConsolidator,
  MemoryIngestProcessor,
  MemoryCompactionProcessor,
  MemoryStore,
  Director,
  Verifier,
  ProviderRegistry,
  SimpleTokenCounter,
  TurnOrchestrator,
  VariableResolver,
  VariableStore,
  type CoreEventBus,
  type ModelConfig,
  type ProviderConfig,
  type FloorRepository,
  type MemoryRepository,
  type VariableRepository,
  type TokenCounter,
  type ToolExecutionRepository,
} from "@tavern/core";

// ── 配置类型 ──────────────────────────────────────────

/** 编排器工厂配置 */
export interface OrchestrationConfig {
  /** LLM 提供商列表（至少需要一个） */
  providers: ProviderConfig[];
  /** Narrator（主生成）使用的模型 */
  defaultModel: ModelConfig;
  /** Director 使用的模型（不提供则复用 defaultModel） */
  directorModel?: ModelConfig;
  /** Verifier 使用的模型（不提供则复用 defaultModel） */
  verifierModel?: ModelConfig;
  /** Memory Consolidator 使用的模型（不提供则复用 defaultModel） */
  memoryModel?: ModelConfig;
}

/** 编排上下文：包含运行时所需的全部组件实例 */
export interface OrchestrationContext {
  /** 完整回合编排器 */
  orchestrator: TurnOrchestrator;
  /** 事件总线（同时被 WsBridge 使用） */
  eventBus: CoreEventBus;
  /** Provider 注册表 */
  providerRegistry: ProviderRegistry;
  /** Token 计数器 */
  tokenCounter: TokenCounter;
  /** 记忆存储服务 */
  memoryStore: MemoryStore;
  /** 记忆整理器 */
  memoryConsolidator: MemoryConsolidator;
  /** ingest_turn 作业处理器 */
  memoryIngestProcessor: MemoryIngestProcessor;
  /** macro summary 压缩处理器 */
  memoryCompactionProcessor: MemoryCompactionProcessor;
  /** 变量解析器 */
  variableResolver: VariableResolver;
  /** 变量读写服务 */
  variableStore: VariableStore;
}

// ── 工厂函数 ──────────────────────────────────────────

/**
 * 创建编排上下文。
 *
 * 完整的依赖组装流程：
 * 1. EventBus + TokenCounter
 * 2. ProviderRegistry（注册所有 Provider）
 * 3. LLMService 实例（narrator / director / verifier / memory）
 * 4. FloorStateMachine + MemoryStore + VariableResolver + VariableStore + MemoryConsolidator
 * 5. GenerationPipeline + Director + Verifier
 * 6. TurnOrchestrator
 *
 * @param config - Provider 与模型配置
 * @param floorRepo - FloorRepository 实现（由 Drizzle Adapter 提供）
 * @param memoryRepo - MemoryRepository 实现（由 Drizzle Adapter 提供）
 * @param variableRepo - VariableRepository 实现（由 Drizzle Adapter 提供）
 * @returns 完整的编排上下文
 */
export function createOrchestrationContext(
  config: OrchestrationConfig,
  floorRepo: FloorRepository,
  memoryRepo: MemoryRepository,
  variableRepo: VariableRepository,
  toolExecutionRepo?: ToolExecutionRepository,
): OrchestrationContext {
  // ── 1. 基础设施 ──
  const eventBus = createEventBus();
  const tokenCounter = new SimpleTokenCounter();

  // ── 2. Provider Registry ──
  const providerRegistry = new ProviderRegistry();
  for (const provider of config.providers) {
    providerRegistry.register(provider);
  }

  // ── 3. LLM Services ──
  const narratorLLM = new LLMService(providerRegistry, config.defaultModel);
  const directorLLM = config.directorModel
    ? new LLMService(providerRegistry, config.directorModel)
    : narratorLLM;
  const verifierLLM = config.verifierModel
    ? new LLMService(providerRegistry, config.verifierModel)
    : narratorLLM;
  const memoryLLM = config.memoryModel
    ? new LLMService(providerRegistry, config.memoryModel)
    : narratorLLM;

  // ── 4. Core 组件 ──
  const floorStateMachine = new FloorStateMachine(floorRepo, eventBus);
  const memoryStore = new MemoryStore(memoryRepo, eventBus, tokenCounter);
  const variableResolver = new VariableResolver(variableRepo);
  const variableStore = new VariableStore(variableRepo, variableResolver, eventBus);
  const memoryConsolidator = new MemoryConsolidator(memoryLLM, memoryStore);
  const memoryIngestProcessor = new MemoryIngestProcessor(memoryLLM);
  const memoryCompactionProcessor = new MemoryCompactionProcessor(memoryLLM);
  const generationPipeline = new GenerationPipeline(narratorLLM);
  const director = new Director(directorLLM);
  const verifier = new Verifier(verifierLLM);

  // ── 5. Orchestrator ──
  const orchestrator = new TurnOrchestrator({
    floorStateMachine,
    generationPipeline,
    memoryStore,
    memoryConsolidator,
    director,
    verifier,
    eventBus,
    toolExecutionRepository: toolExecutionRepo,
  });

  return {
    orchestrator,
    eventBus,
    providerRegistry,
    tokenCounter,
    memoryStore,
    memoryConsolidator,
    memoryIngestProcessor,
    memoryCompactionProcessor,
    variableResolver,
    variableStore,
  };
}
