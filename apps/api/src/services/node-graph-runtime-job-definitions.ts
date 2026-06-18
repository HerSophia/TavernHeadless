import { nanoid } from "nanoid";
import { z } from "zod";

import { RuntimeJobCatalog } from "./runtime-job-catalog.js";
import type { RuntimeJobDefinition } from "./runtime-job-types.js";

export const NODE_GRAPH_RUNTIME_SCOPE_TYPE = "node_graph";
export const NODE_GRAPH_RUN_JOB_TYPE = "graph.run" as const;

const recordSchema = z.record(z.string(), z.unknown());

export const nodeGraphRunJobPayloadSchema = z.object({
  accountId: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  graphId: z.string().min(1),
  graphVersionId: z.string().min(1),
  sessionId: z.string().nullable().optional(),
  floorId: z.string().nullable().optional(),
  pageId: z.string().nullable().optional(),
  actorClientId: z.string().nullable().optional(),
  intent: z.enum(["normal", "dry_run", "regenerate", "preview"]).default("normal"),
  dryRun: z.boolean().default(false),
  inputJson: recordSchema.default({}),
});

export type NodeGraphRunJobPayload = z.infer<typeof nodeGraphRunJobPayloadSchema>;

export function buildNodeGraphRuntimeScopeKey(input: { workspaceId: string; projectId: string; graphId: string }): string {
  return `${input.workspaceId}:${input.projectId}:${input.graphId}`;
}

function createDefinition<TPayload>(definition: RuntimeJobDefinition<TPayload>): RuntimeJobDefinition<TPayload> {
  return definition;
}

export function createNodeGraphRuntimeJobCatalog(): RuntimeJobCatalog {
  const catalog = new RuntimeJobCatalog();
  catalog.register(createDefinition<NodeGraphRunJobPayload>({
    jobType: NODE_GRAPH_RUN_JOB_TYPE,
    payloadSchema: nodeGraphRunJobPayloadSchema,
    defaultMaxAttempts: 2,
    initialPhase: "queued",
    createJobId({ payload }) {
      return `graph-job:${payload.graphId}:${nanoid(12)}`;
    },
  }));
  return catalog;
}
