/**
 * Prompt Asset 的资源种类。
 *
 * 这层类型只描述进入 Prompt 装配链路的资产身份，不替代各资源自己的数据模型。
 */
export type PromptAssetKind = "preset" | "character" | "worldbook" | "regex_profile";

/** Prompt Asset 的来源。 */
export type PromptAssetOrigin =
  | "session_binding"
  | "character_embedded"
  | "imported_preset"
  | "runtime_profile"
  | "manual";

/**
 * Prompt Asset 在一次装配中的稳定引用。
 */
export interface PromptAssetRef {
  /** 资产种类。 */
  kind: PromptAssetKind;
  /** 资产自身 ID。没有持久化 ID 时使用稳定 fallback。 */
  assetId: string;
  /** 资产版本。没有版本时为 null。 */
  version: number | string | null;
  /** 在一次装配中用于 provenance 的稳定 scope。 */
  assetScopeId: string;
  /** 人类可读名称。 */
  name?: string | null;
  /** 资产来源。 */
  origin: PromptAssetOrigin;
}

/** Prompt Asset 声明中的片段类型。 */
export type PromptAssetDeclarationPart =
  | "preset_graph"
  | "character_profile"
  | "character_system_prompt"
  | "character_post_history_instructions"
  | "character_greetings"
  | "character_metadata"
  | "character_book_ref"
  | "worldbook_entries"
  | "regex_scripts";

/**
 * Prompt Asset 声明。
 *
 * declaration 用于把 preset / character / worldbook / regex 先统一成资产，再交给现有编译和装配链路。
 */
export interface PromptAssetDeclaration {
  /** 声明 ID。应在同一个 manifest 内稳定且唯一。 */
  id: string;
  /** 资产引用。 */
  ref: PromptAssetRef;
  /** 声明片段。 */
  part: PromptAssetDeclarationPart;
  /** 是否会进入运行态。仅存储或导出的片段应为 false。 */
  runtimeActive: boolean;
  /** 关联的上游绑定或本地实现信息。 */
  binding?: Record<string, unknown>;
  /** 额外元数据。 */
  metadata?: Record<string, unknown>;
}

/**
 * 一次 Prompt 装配使用的资产 manifest。
 */
export interface PromptAssetManifest {
  /** manifest schema 版本。 */
  version: 1;
  /** 生成时间。 */
  generatedAt: number;
  /** 资产引用列表。 */
  assets: PromptAssetRef[];
  /** 资产声明列表。 */
  declarations: PromptAssetDeclaration[];
}
