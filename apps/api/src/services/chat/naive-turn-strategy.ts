import type { ExecuteTurnAndCommitArgs, ExecuteTurnAndCommitResult, TurnExecutionFacade } from "./turn-execution-facade.js";

export interface ChatTurnExecutionStrategy {
  execute(args: ExecuteTurnAndCommitArgs): Promise<ExecuteTurnAndCommitResult>;
}

export class NaiveTurnStrategy implements ChatTurnExecutionStrategy {
  constructor(private readonly turnExecutionFacade: TurnExecutionFacade) {}

  async execute(args: ExecuteTurnAndCommitArgs): Promise<ExecuteTurnAndCommitResult> {
    return this.turnExecutionFacade.executeTurnAndCommit(args);
  }
}
