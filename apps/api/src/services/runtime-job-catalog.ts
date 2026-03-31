import { nanoid } from "nanoid";

import { RuntimeJobFatalError } from "./runtime-job-errors.js";
import type { RuntimeJobDefinition } from "./runtime-job-types.js";

function formatIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => `${issue.path.map((segment) => String(segment)).join(".") || "payload"}: ${issue.message}`)
    .join("; ");
}

export class RuntimeJobCatalog {
  private readonly definitions = new Map<string, RuntimeJobDefinition<any>>();

  register<TPayload>(definition: RuntimeJobDefinition<TPayload>): void {
    if (this.definitions.has(definition.jobType)) {
      throw new Error(`Runtime job definition already registered: ${definition.jobType}`);
    }

    this.definitions.set(definition.jobType, definition as RuntimeJobDefinition<any>);
  }

  find<TPayload>(jobType: string): RuntimeJobDefinition<TPayload> | undefined {
    return this.definitions.get(jobType) as RuntimeJobDefinition<TPayload> | undefined;
  }

  get<TPayload>(jobType: string): RuntimeJobDefinition<TPayload> {
    const definition = this.definitions.get(jobType);
    if (!definition) {
      throw new Error(`Runtime job definition not registered: ${jobType}`);
    }

    return definition as RuntimeJobDefinition<TPayload>;
  }

  list(): RuntimeJobDefinition<any>[] {
    return [...this.definitions.values()];
  }

  createJobId<TPayload>(
    jobType: string,
    payload: TPayload,
    requestedId?: string,
    dedupeKey?: string | null,
  ): string {
    const definition = this.get<TPayload>(jobType);
    if (requestedId && requestedId.trim().length > 0) {
      return requestedId;
    }

    if (definition.createJobId) {
      return definition.createJobId({
        jobType,
        payload,
        requestedId,
        dedupeKey: dedupeKey ?? null,
      });
    }

    return `runtime-job:${jobType}:${nanoid(12)}`;
  }

  parsePayload<TPayload>(jobType: string, payloadJson: string): TPayload {
    const definition = this.get<TPayload>(jobType);

    let payload: unknown;
    try {
      payload = JSON.parse(payloadJson);
    } catch (error) {
      throw new RuntimeJobFatalError(
        `Invalid payload for runtime job '${jobType}': ${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }

    const parsed = definition.payloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new RuntimeJobFatalError(
        `Invalid payload for runtime job '${jobType}': ${formatIssues(parsed.error.issues)}`,
      );
    }

    return parsed.data as TPayload;
  }
}
