import type { RuntimeJobProcessor } from "./runtime-job-types.js";

export class RuntimeJobProcessorRegistry {
  private readonly processors = new Map<string, RuntimeJobProcessor<any, any, any>>();

  register<TPayload, TPrepared, TResult>(
    jobType: string,
    processor: RuntimeJobProcessor<TPayload, TPrepared, TResult>,
  ): void {
    if (this.processors.has(jobType)) {
      throw new Error(`Runtime job processor already registered: ${jobType}`);
    }

    this.processors.set(jobType, processor as RuntimeJobProcessor<any, any, any>);
  }

  get<TPayload, TPrepared, TResult>(jobType: string): RuntimeJobProcessor<TPayload, TPrepared, TResult> {
    const processor = this.processors.get(jobType);
    if (!processor) {
      throw new Error(`Runtime job processor not registered: ${jobType}`);
    }

    return processor as RuntimeJobProcessor<TPayload, TPrepared, TResult>;
  }
}
