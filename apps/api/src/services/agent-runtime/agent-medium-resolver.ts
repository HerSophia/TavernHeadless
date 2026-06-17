import type { InlineAgentSpec } from "./inline-agent-types.js";
import type { AgentMediumSelection } from "./agent-medium-types.js";

export interface AgentMediumResolveInput {
  spec: InlineAgentSpec;
  preferredMedium?: AgentMediumSelection;
}

export class AgentMediumResolver {
  resolve(input: AgentMediumResolveInput): AgentMediumSelection {
    if (input.preferredMedium) {
      return input.preferredMedium;
    }

    return {
      kind: "single_call",
      deliveryTarget: "return_inline",
    };
  }
}
