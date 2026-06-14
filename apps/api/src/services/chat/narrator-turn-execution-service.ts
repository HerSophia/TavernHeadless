import type { ExecuteNarratorTurnResult, ExecuteTurnAndCommitArgs } from "./turn-execution-facade.js";

export class NarratorTurnExecutionService {
  constructor(
    private readonly executeNarratorTurnImpl: (args: ExecuteTurnAndCommitArgs) => Promise<ExecuteNarratorTurnResult>,
  ) {}

  async execute(args: ExecuteTurnAndCommitArgs): Promise<ExecuteNarratorTurnResult> {
    return this.executeNarratorTurnImpl(args);
  }
}
