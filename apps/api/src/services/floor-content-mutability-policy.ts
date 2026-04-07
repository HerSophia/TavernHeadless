import type { floors, messagePages } from "../db/schema.js";

export type FloorState = typeof floors.$inferSelect["state"];
export type PageKind = typeof messagePages.$inferSelect["pageKind"];

export type FloorContentMutationKind =
  | "page.create"
  | "page.update"
  | "page.delete"
  | "page.activate"
  | "message.create"
  | "message.update"
  | "message.delete"
  | "message.hide"
  | "message.unhide"
  | "variable.write";

export interface FloorContentMutationRejection {
  code: "content_target_locked" | "page_activation_not_allowed";
  message: string;
}

export function getFloorContentMutationRejection(input: {
  mutationKind: FloorContentMutationKind;
  floorState?: FloorState;
  floorSupersededAt?: number | null;
  pageKind?: PageKind;
}): FloorContentMutationRejection | null {
  if (input.floorSupersededAt != null) {
    return {
      code: "content_target_locked",
      message: `Superseded floors are read-only for ${describeMutation(input.mutationKind)}`,
    };
  }

  if (input.mutationKind === "page.activate") {
    if (input.pageKind === "input") {
      return {
        code: "page_activation_not_allowed",
        message: "Input pages cannot be activated",
      };
    }

    return null;
  }

  if (input.mutationKind === "variable.write" && input.floorState === "generating") {
    return {
      code: "content_target_locked",
      message: `Generating floors are read-only for ${describeMutation(input.mutationKind)}`,
    };
  }

  if (input.floorState === "committed") {
    return {
      code: "content_target_locked",
      message: `Committed floors are read-only for ${describeMutation(input.mutationKind)}`,
    };
  }

  return null;
}

function describeMutation(kind: FloorContentMutationKind): string {
  switch (kind) {
    case "page.create":
      return "page creation";
    case "page.update":
      return "page updates";
    case "page.delete":
      return "page deletion";
    case "message.create":
      return "message creation";
    case "message.update":
      return "message updates";
    case "message.delete":
      return "message deletion";
    case "message.hide":
      return "message hiding";
    case "message.unhide":
      return "message unhiding";
    case "variable.write":
      return "variable writes";
    case "page.activate":
      return "page activation";
    default:
      return "content mutation";
  }
}
