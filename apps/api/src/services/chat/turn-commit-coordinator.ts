import type { CommitNarratorTurnArgs, CommitNarratorTurnResult } from "./turn-execution-facade.js";

export class TurnCommitCoordinator {
  constructor(
    private readonly commitNarratorTurnImpl: (args: CommitNarratorTurnArgs) => Promise<CommitNarratorTurnResult>,
  ) {}

  async commit(args: CommitNarratorTurnArgs): Promise<CommitNarratorTurnResult> {
    return this.commitNarratorTurnImpl(args);
  }
}
