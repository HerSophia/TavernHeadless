import type { ExecuteTurnAndCommitArgs, ExecuteTurnAndCommitResult } from "./turn-execution-facade.js";
import type { ChatTurnExecutionStrategy } from "./naive-turn-strategy.js";

export class ChatTurnWorkflowRunner {
  constructor(
    private readonly resolveStrategy: (args: ExecuteTurnAndCommitArgs) => ChatTurnExecutionStrategy,
  ) {}

  async runPreparedTurnWorkflow(args: ExecuteTurnAndCommitArgs): Promise<ExecuteTurnAndCommitResult> {
    return this.resolveStrategy(args).execute(args);
  }
}
