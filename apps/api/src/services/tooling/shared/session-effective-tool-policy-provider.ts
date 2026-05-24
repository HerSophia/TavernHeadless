import { and, eq } from "drizzle-orm";

import type { AppDb } from "../../../db/client.js";
import { sessions } from "../../../db/schema.js";
import { parseJsonField } from "../../../lib/http.js";
import { ProjectAgentBindingService } from "../../project-agent-binding-service.js";
import { ProjectToolPolicyOverrideService } from "../../project-tool-policy-override-service.js";
import { normalizeSessionBaseToolPermissionsRecord } from "./permission-overlay.js";
import {
  resolveEffectiveToolPolicy,
  resolveToolPolicySelectorFromAgentBinding,
  type EffectiveToolPolicyResolution,
} from "./tool-policy-resolution.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readSelectedAgentBindingId(metadata: Record<string, unknown>): string | null {
  const direct = normalizeNonEmptyString(metadata.agent_binding_id);
  if (direct) {
    return direct;
  }

  const selector = metadata.tool_policy_selector;
  if (!isRecord(selector)) {
    return null;
  }

  return normalizeNonEmptyString(selector.agent_binding_id);
}

export class SessionEffectiveToolPolicyProvider {
  private readonly bindingService: ProjectAgentBindingService;
  private readonly overrideService: ProjectToolPolicyOverrideService;

  constructor(private readonly db: AppDb) {
    this.bindingService = new ProjectAgentBindingService(db);
    this.overrideService = new ProjectToolPolicyOverrideService(db);
  }

  async resolve(input: {
    sessionId: string;
    accountId: string;
  }): Promise<EffectiveToolPolicyResolution | null> {
    const [session] = await this.db
      .select({
        projectId: sessions.projectId,
        metadataJson: sessions.metadataJson,
      })
      .from(sessions)
      .where(and(
        eq(sessions.id, input.sessionId),
        eq(sessions.accountId, input.accountId),
      ))
      .limit(1);

    if (!session) {
      return null;
    }

    const metadata = isRecord(parseJsonField(session.metadataJson))
      ? parseJsonField(session.metadataJson) as Record<string, unknown>
      : {};
    const sessionBase = normalizeSessionBaseToolPermissionsRecord(metadata.tool_permissions);

    if (!session.projectId) {
      return resolveEffectiveToolPolicy({ sessionBase });
    }

    let selector = null;
    const selectedAgentBindingId = readSelectedAgentBindingId(metadata);
    if (selectedAgentBindingId) {
      try {
        const binding = this.bindingService.resolveEffective({
          id: selectedAgentBindingId,
          accountId: input.accountId,
        });

        if (
          binding.binding.projectId === session.projectId
          && binding.binding.status === "enabled"
        ) {
          selector = resolveToolPolicySelectorFromAgentBinding({
            toolPolicyId: binding.effective.toolPolicyId,
          });
        }
      } catch {
        selector = null;
      }
    }

    return resolveEffectiveToolPolicy({
      sessionBase,
      selector,
      projectOverrides: this.overrideService.listByProject({
        projectId: session.projectId,
        accountId: input.accountId,
      }),
    });
  }
}
