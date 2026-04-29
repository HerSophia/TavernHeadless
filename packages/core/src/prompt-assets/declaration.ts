import type { PromptAssetDeclaration, PromptAssetDeclarationPart, PromptAssetRef } from "./types.js";

/**
 * 构造 Prompt Asset 声明。
 */
export function createPromptAssetDeclaration(args: {
  id: string;
  ref: PromptAssetRef;
  part: PromptAssetDeclarationPart;
  runtimeActive: boolean;
  binding?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): PromptAssetDeclaration {
  return {
    id: args.id,
    ref: args.ref,
    part: args.part,
    runtimeActive: args.runtimeActive,
    ...(args.binding ? { binding: args.binding } : {}),
    ...(args.metadata ? { metadata: args.metadata } : {}),
  };
}
