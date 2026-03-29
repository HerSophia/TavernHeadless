import type { LanguageModel } from 'ai';
import type { ProviderConfig, ProviderFactory } from './types.js';
import { createRequire } from 'module';

// ESM 环境下使用 createRequire 来动态加载可选依赖
const require = createRequire(import.meta.url);

// ── 错误类 ────────────────────────────────────────────

export class ProviderNotFoundError extends Error {
  constructor(public readonly providerId: string) {
    super(`Provider '${providerId}' is not registered`);
    this.name = 'ProviderNotFoundError';
  }
}

export class ProviderInitError extends Error {
  constructor(
    public readonly providerId: string,
    cause: unknown,
  ) {
    super(`Failed to initialize provider '${providerId}': ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'ProviderInitError';
    this.cause = cause;
  }
}

// ── 内置 Provider 工厂 ────────────────────────────────

/**
 * 创建 OpenAI 兼容的 provider 工厂。
 * 用于 openai / deepseek / xai / openai-compatible 类型。
 */
function createOpenAIFactory(config: ProviderConfig): (modelId: string) => LanguageModel {
  // 动态导入 @ai-sdk/openai（已在 core 的依赖中通过 ai 包间接提供）
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let createOpenAI: typeof import('@ai-sdk/openai').createOpenAI;
  try {
    // 运行时动态 require，避免未安装时编译报错
    const mod = require('@ai-sdk/openai') as typeof import('@ai-sdk/openai');
    createOpenAI = mod.createOpenAI;
  } catch {
    throw new ProviderInitError(
      config.id,
      new Error('@ai-sdk/openai is not installed. Run: pnpm add @ai-sdk/openai'),
    );
  }

  const provider = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    compatibility: config.type === 'openai-compatible' ? 'compatible' : 'strict',
    ...config.options,
  });

  return (modelId: string) => provider(modelId);
}

/**
 * Provider 工厂映射：type → 工厂函数。
 *
 * openai / deepseek / xai / openai-compatible 都复用 OpenAI 兼容工厂，
 * 因为它们都支持 OpenAI 格式的 API。
 *
 * anthropic 和 google 需要各自的 SDK 包。
 */
const BUILTIN_FACTORIES: Record<string, ProviderFactory> = {
  openai: createOpenAIFactory,
  deepseek: createOpenAIFactory,
  xai: createOpenAIFactory,
  'openai-compatible': createOpenAIFactory,

  anthropic: (config: ProviderConfig) => {
    let createAnthropic: any;
    try {
      const mod = require('@ai-sdk/anthropic');
      createAnthropic = mod.createAnthropic;
    } catch {
      throw new ProviderInitError(
        config.id,
        new Error('@ai-sdk/anthropic is not installed. Run: pnpm add @ai-sdk/anthropic'),
      );
    }
    const provider = createAnthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      ...config.options,
    });
    return (modelId: string) => provider(modelId);
  },

  google: (config: ProviderConfig) => {
    let createGoogleGenerativeAI: any;
    try {
      const mod = require('@ai-sdk/google');
      createGoogleGenerativeAI = mod.createGoogleGenerativeAI;
    } catch {
      throw new ProviderInitError(
        config.id,
        new Error('@ai-sdk/google is not installed. Run: pnpm add @ai-sdk/google'),
      );
    }
    const provider = createGoogleGenerativeAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      ...config.options,
    });
    return (modelId: string) => provider(modelId);
  },
};

// ── Provider Registry ─────────────────────────────────

/**
 * Provider 注册表：管理多个 LLM 提供商。
 *
 * 注册提供商后，可通过 `getModel(providerId, modelId)` 获取
 * Vercel AI SDK 的 LanguageModel 实例。
 *
 * 支持内置工厂（openai/anthropic/google/deepseek/xai/openai-compatible）
 * 和自定义工厂。
 */
export class ProviderRegistry {
  private configs = new Map<string, ProviderConfig>();
  private modelGetters = new Map<string, (modelId: string) => LanguageModel>();
  private customFactories = new Map<string, ProviderFactory>();

  private resolveFactory(config: ProviderConfig): ProviderFactory {
    const factory = this.customFactories.get(config.type) ?? BUILTIN_FACTORIES[config.type];
    if (!factory) {
      throw new ProviderInitError(
        config.id,
        new Error(`Unsupported provider type: '${config.type}'. Register a custom factory first.`),
      );
    }

    return factory;
  }

  createModel(config: ProviderConfig, modelId: string): LanguageModel {
    try {
      return this.resolveFactory(config)(config)(modelId);
    } catch (e) {
      if (e instanceof ProviderInitError) throw e;
      throw new ProviderInitError(config.id, e);
    }
  }

  /**
   * 注册自定义 Provider 工厂。
   * 注册后的工厂可通过 ProviderConfig.type 使用。
   */
  registerFactory(type: string, factory: ProviderFactory): void {
    this.customFactories.set(type, factory);
  }

  /**
   * 注册一个提供商。
   *
   * 根据 `config.type` 查找对应的工厂函数，初始化 provider。
   * 重复注册会覆盖旧的。
   *
   * @throws {ProviderInitError} 工厂初始化失败时
   */
  register(config: ProviderConfig): void {
    try {
      const getter = this.resolveFactory(config)(config);
      this.configs.set(config.id, config);
      this.modelGetters.set(config.id, getter);
    } catch (e) {
      if (e instanceof ProviderInitError) throw e;
      throw new ProviderInitError(config.id, e);
    }
  }

  /**
   * 移除一个提供商。
   */
  unregister(providerId: string): void {
    this.configs.delete(providerId);
    this.modelGetters.delete(providerId);
  }

  /**
   * 获取 LanguageModel 实例。
   *
   * @throws {ProviderNotFoundError} 提供商未注册时
   */
  getModel(providerId: string, modelId: string): LanguageModel {
    const getter = this.modelGetters.get(providerId);
    if (!getter) {
      throw new ProviderNotFoundError(providerId);
    }
    return getter(modelId);
  }

  /**
   * 列出所有已注册的提供商配置。
   */
  listProviders(): ProviderConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * 检查提供商是否已注册。
   */
  has(providerId: string): boolean {
    return this.configs.has(providerId);
  }
}
