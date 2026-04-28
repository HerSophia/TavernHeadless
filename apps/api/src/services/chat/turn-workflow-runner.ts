import type { ExecuteTurnAndCommitArgs, ExecuteTurnAndCommitResult } from "./turn-execution-facade.js";
import type { ChatTurnExecutionStrategy } from "./naive-turn-strategy.js";

export class ChatTurnWorkflowRunner {
  constructor(private readonly strategy: ChatTurnExecutionStrategy) {}

  async runPreparedTurnWorkflow(args: ExecuteTurnAndCommitArgs): Promise<ExecuteTurnAndCommitResult> {
    return this.strategy.execute(args);
  }
}
