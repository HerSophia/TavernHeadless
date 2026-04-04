import { createHash } from "node:crypto"

import { and, eq, max } from "drizzle-orm"
import { nanoid } from "nanoid"
import { parsePreset } from "@tavern/adapters-sillytavern"

import { characters, characterVersions, presets, regexProfiles, worldbookEntries, worldbooks } from "../db/schema.js"
import { parseJsonField } from "../lib/http.js"
import {
  addPromptToRaw,
  findPromptInRaw,
  getEditorEntryFromRaw,
  normalizeStoredPreset,
  type JsonRecord,
  updatePromptFieldsInRaw,
} from "../lib/preset-utils.js"
import { MutationApplierRegistry } from "./mutation-applier-registry.js"
import { ResourceWriteRouteError, assertRevisionWriteApplied } from "./resource-write.js"
import { RuntimeMutationError } from "./runtime-mutation-errors.js"
import type { RuntimeMutationApplier, RuntimeMutationApplyRequest } from "./runtime-mutation-types.js"

export const RESOURCE_MUTATION_KINDS = {
  characterCreate: "resource.character.create",
  characterUpdate: "resource.character.update",
  worldbookCreate: "resource.worldbook.create",
  worldbookEntryCreate: "resource.worldbook_entry.create",
  worldbookEntryUpdate: "resource.worldbook_entry.update",
  regexProfileCreate: "resource.regex_profile.create",
  regexRuleCreate: "resource.regex_rule.create",
  regexRuleUpdate: "resource.regex_rule.update",
  presetEntryCreate: "resource.preset_entry.create",
  presetEntryUpdate: "resource.preset_entry.update",
} as const

interface CharacterSnapshotPayload {
  name: string
  description?: string
  personality?: string
  scenario?: string
  greeting?: string
  primaryGreeting?: string
  exampleDialogue?: string
}

export interface CreateCharacterMutationPayload {
  snapshot: CharacterSnapshotPayload
}

export interface UpdateCharacterMutationPayload {
  characterId: string
  patch: Partial<CharacterSnapshotPayload>
}

export interface CharacterMutationResult {
  characterId: string
  versionId: string
  versionNo?: number
  name?: string
}

export interface CreateWorldbookMutationPayload {
  name: string
}

export interface CreateWorldbookMutationResult {
  id: string
  name: string
}

export interface CreateWorldbookEntryMutationPayload {
  worldbookId: string
  keys: string[]
  content: string
  comment?: string
  keysSecondary?: string[]
  selective?: boolean
  constant?: boolean
  position?: number
  order?: number
  depth?: number
  disable?: boolean
}

export interface CreateWorldbookEntryMutationResult {
  id: string
  worldbookId: string
  uid: number
  keys: string[]
  comment: string
}

export interface UpdateWorldbookEntryMutationPayload {
  worldbookId: string
  entryId: string
  updates: {
    keys?: string[]
    content?: string
    comment?: string
    keysSecondary?: string[]
    selective?: boolean
    constant?: boolean
    position?: number
    order?: number
    depth?: number
    disable?: boolean
  }
}

export interface UpdateWorldbookEntryMutationResult {
  id: string
  worldbookId: string
  uid: number
  keys: string[]
  content: string
  comment: string
}

interface RegexScript {
  id: string
  scriptName: string
  findRegex: string
  replaceString: string
  trimStrings: string[]
  placement: number[]
  disabled: boolean
  markdownOnly: boolean
  promptOnly: boolean
  runOnEdit: boolean
  substituteRegex: number
  minDepth: number
  maxDepth: number
}

export interface CreateRegexProfileMutationPayload {
  name: string
}

export interface CreateRegexProfileMutationResult {
  id: string
  name: string
  source: "tool"
}

export interface CreateRegexRuleMutationPayload {
  profileId: string
  scriptName?: string
  findRegex: string
  replaceString: string
  trimStrings?: string[]
  placement?: number[]
  disabled?: boolean
}

export interface UpdateRegexRuleMutationPayload {
  profileId: string
  ruleIndex: number
  updates: {
    scriptName?: string
    findRegex?: string
    replaceString?: string
    trimStrings?: string[]
    placement?: number[]
    disabled?: boolean
  }
}

export interface RegexRuleMutationResult {
  ruleIndex: number
  scriptName: string
  findRegex: string
}

export interface CreatePresetEntryMutationPayload {
  presetId: string
  identifier: string
  promptData: {
    name: string
    role: string
    content: string
    system_prompt: boolean
    marker: boolean
    injection_position: number
    enabled: boolean
  }
}

export interface UpdatePresetEntryMutationPayload {
  presetId: string
  identifier: string
  fields: Record<string, unknown>
}

export interface PresetEntryMutationResult {
  identifier: string
  name?: string
  role?: string
  content?: string
  system_prompt?: boolean
  marker?: boolean
  injection_position?: number
  enabled?: boolean
}

function isMutationKind<TPayload>(
  request: RuntimeMutationApplyRequest<unknown>,
  kind: string,
): request is RuntimeMutationApplyRequest<TPayload> {
  return request.envelope.kind === kind
}

function computeContentHash(data: string): string {
  return createHash("sha256").update(data).digest("hex")
}

function loadOwnedCharacter(
  request: RuntimeMutationApplyRequest<unknown>,
  characterId: string,
): typeof characters.$inferSelect | undefined {
  return request.context.tx
    .select()
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.accountId, request.envelope.accountId)))
    .limit(1)
    .all()[0]
}

function loadCharacterVersionByNo(
  request: RuntimeMutationApplyRequest<unknown>,
  characterId: string,
  versionNo: number,
): typeof characterVersions.$inferSelect | undefined {
  return request.context.tx
    .select()
    .from(characterVersions)
    .where(and(eq(characterVersions.characterId, characterId), eq(characterVersions.versionNo, versionNo)))
    .limit(1)
    .all()[0]
}

function createCharacterRevisionConflictError() {
  return new ResourceWriteRouteError(
    409,
    "character_revision_conflict",
    "Character has been modified by another operation",
  )
}

function loadPresetRawForMutation(
  request: RuntimeMutationApplyRequest<unknown>,
  presetId: string,
): { row: typeof presets.$inferSelect; raw: JsonRecord } | null {
  const [row] = request.context.tx
    .select()
    .from(presets)
    .where(and(eq(presets.id, presetId), eq(presets.accountId, request.envelope.accountId)))
    .limit(1)
    .all()

  if (!row) {
    return null
  }

  const normalized = normalizeStoredPreset(parseJsonField(row.dataJson) as JsonRecord)
  return { row, raw: normalized.raw }
}

function savePresetRawForMutation(
  request: RuntimeMutationApplyRequest<unknown>,
  presetId: string,
  raw: JsonRecord,
  now: number,
): void {
  request.context.tx
    .update(presets)
    .set({ dataJson: JSON.stringify(raw), updatedAt: now })
    .where(and(eq(presets.id, presetId), eq(presets.accountId, request.envelope.accountId)))
    .run()
}

function validatePresetRawForMutation(raw: JsonRecord): string | null {
  try {
    parsePreset(raw as Record<string, unknown>)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export class ResourceMutationApplier implements RuntimeMutationApplier<unknown, unknown> {
  apply(request: RuntimeMutationApplyRequest<unknown>) {
    if (isMutationKind<CreateCharacterMutationPayload>(request, RESOURCE_MUTATION_KINDS.characterCreate)) {
      return this.applyCreateCharacter(request)
    }

    if (isMutationKind<UpdateCharacterMutationPayload>(request, RESOURCE_MUTATION_KINDS.characterUpdate)) {
      return this.applyUpdateCharacter(request)
    }

    if (isMutationKind<CreateWorldbookMutationPayload>(request, RESOURCE_MUTATION_KINDS.worldbookCreate)) {
      return this.applyCreateWorldbook(request)
    }

    if (isMutationKind<CreateWorldbookEntryMutationPayload>(request, RESOURCE_MUTATION_KINDS.worldbookEntryCreate)) {
      return this.applyCreateWorldbookEntry(request)
    }

    if (isMutationKind<UpdateWorldbookEntryMutationPayload>(request, RESOURCE_MUTATION_KINDS.worldbookEntryUpdate)) {
      return this.applyUpdateWorldbookEntry(request)
    }

    if (isMutationKind<CreateRegexProfileMutationPayload>(request, RESOURCE_MUTATION_KINDS.regexProfileCreate)) {
      return this.applyCreateRegexProfile(request)
    }

    if (isMutationKind<CreateRegexRuleMutationPayload>(request, RESOURCE_MUTATION_KINDS.regexRuleCreate)) {
      return this.applyCreateRegexRule(request)
    }

    if (isMutationKind<UpdateRegexRuleMutationPayload>(request, RESOURCE_MUTATION_KINDS.regexRuleUpdate)) {
      return this.applyUpdateRegexRule(request)
    }

    if (isMutationKind<CreatePresetEntryMutationPayload>(request, RESOURCE_MUTATION_KINDS.presetEntryCreate)) {
      return this.applyCreatePresetEntry(request)
    }

    if (isMutationKind<UpdatePresetEntryMutationPayload>(request, RESOURCE_MUTATION_KINDS.presetEntryUpdate)) {
      return this.applyUpdatePresetEntry(request)
    }

    throw new RuntimeMutationError(`Unsupported resource mutation kind: ${request.envelope.kind}`)
  }

  private applyCreateCharacter(request: RuntimeMutationApplyRequest<CreateCharacterMutationPayload>) {
    const characterId = nanoid()
    const versionId = nanoid()
    const snapshotJson = JSON.stringify(request.envelope.payload.snapshot)
    const contentHash = computeContentHash(snapshotJson)
    const now = request.context.now()

    request.context.tx.insert(characters)
      .values({
        id: characterId,
        name: request.envelope.payload.snapshot.name,
        source: "tool",
        accountId: request.envelope.accountId,
        status: "active",
        revision: 0,
        latestVersionNo: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    request.context.tx.insert(characterVersions)
      .values({
        id: versionId,
        characterId,
        versionNo: 1,
        dataJson: snapshotJson,
        contentHash,
        createdAt: now,
      })
      .run()

    return {
      result: {
        characterId,
        versionId,
        name: request.envelope.payload.snapshot.name,
      } satisfies CharacterMutationResult,
    }
  }

  private applyUpdateCharacter(request: RuntimeMutationApplyRequest<UpdateCharacterMutationPayload>) {
    const row = loadOwnedCharacter(request, request.envelope.payload.characterId)
    if (!row || row.status !== "active") {
      throw new ResourceWriteRouteError(
        404,
        "not_found",
        `Character not found: ${request.envelope.payload.characterId}`,
      )
    }

    const latestVersion = row.latestVersionNo > 0
      ? loadCharacterVersionByNo(request, row.id, row.latestVersionNo)
      : undefined

    if (!latestVersion) {
      throw new Error(`No version found for character: ${request.envelope.payload.characterId}`)
    }

    const oldSnapshot = JSON.parse(latestVersion.dataJson) as CharacterSnapshotPayload
    const newSnapshot: CharacterSnapshotPayload = { ...oldSnapshot }

    if (typeof request.envelope.payload.patch.name === "string" && request.envelope.payload.patch.name.trim() !== "") {
      newSnapshot.name = request.envelope.payload.patch.name.trim()
    }
    if (typeof request.envelope.payload.patch.description === "string") newSnapshot.description = request.envelope.payload.patch.description
    if (typeof request.envelope.payload.patch.personality === "string") newSnapshot.personality = request.envelope.payload.patch.personality
    if (typeof request.envelope.payload.patch.scenario === "string") newSnapshot.scenario = request.envelope.payload.patch.scenario
    if (typeof request.envelope.payload.patch.primaryGreeting === "string") newSnapshot.primaryGreeting = request.envelope.payload.patch.primaryGreeting
    if (typeof request.envelope.payload.patch.greeting === "string") {
      newSnapshot.greeting = request.envelope.payload.patch.greeting
      newSnapshot.primaryGreeting = request.envelope.payload.patch.greeting
    }
    if (typeof request.envelope.payload.patch.exampleDialogue === "string") newSnapshot.exampleDialogue = request.envelope.payload.patch.exampleDialogue

    const newVersionNo = row.latestVersionNo + 1
    const newVersionId = nanoid()
    const snapshotJson = JSON.stringify(newSnapshot)
    const contentHash = computeContentHash(snapshotJson)
    const now = request.context.now()

    const updates: Partial<typeof characters.$inferInsert> = {
      latestVersionNo: newVersionNo,
      revision: row.revision + 1,
      updatedAt: now,
    }
    if (newSnapshot.name !== oldSnapshot.name) {
      updates.name = newSnapshot.name
    }

    const updateResult = request.context.tx
      .update(characters)
      .set(updates)
      .where(and(
        eq(characters.id, row.id),
        eq(characters.accountId, request.envelope.accountId),
        eq(characters.revision, row.revision),
      ))
      .run()

    assertRevisionWriteApplied(updateResult.changes, createCharacterRevisionConflictError)

    request.context.tx.insert(characterVersions)
      .values({
        id: newVersionId,
        characterId: row.id,
        versionNo: newVersionNo,
        dataJson: snapshotJson,
        contentHash,
        createdAt: now,
      })
      .run()

    return {
      result: {
        characterId: row.id,
        versionId: newVersionId,
        versionNo: newVersionNo,
      } satisfies CharacterMutationResult,
    }
  }

  private applyCreateWorldbook(request: RuntimeMutationApplyRequest<CreateWorldbookMutationPayload>) {
    const id = nanoid()
    const now = request.context.now()

    request.context.tx.insert(worldbooks).values({
      id,
      name: request.envelope.payload.name,
      source: "tool",
      accountId: request.envelope.accountId,
      dataJson: "{}",
      createdAt: now,
      updatedAt: now,
    }).run()

    return {
      result: {
        id,
        name: request.envelope.payload.name,
      } satisfies CreateWorldbookMutationResult,
    }
  }

  private applyCreateWorldbookEntry(
    request: RuntimeMutationApplyRequest<CreateWorldbookEntryMutationPayload>,
  ) {
    const [worldbook] = request.context.tx
      .select()
      .from(worldbooks)
      .where(and(
        eq(worldbooks.id, request.envelope.payload.worldbookId),
        eq(worldbooks.accountId, request.envelope.accountId),
      ))
      .limit(1)
      .all()

    if (!worldbook) {
      throw new ResourceWriteRouteError(
        404,
        "not_found",
        `Worldbook not found: ${request.envelope.payload.worldbookId}`,
      )
    }

    const maxRow = request.context.tx
      .select({ maxUid: max(worldbookEntries.uid) })
      .from(worldbookEntries)
      .where(eq(worldbookEntries.worldbookId, request.envelope.payload.worldbookId))
      .all()[0]

    const entryId = nanoid()
    const uid = (maxRow?.maxUid ?? -1) + 1
    const now = request.context.now()

    request.context.tx.insert(worldbookEntries).values({
      id: entryId,
      worldbookId: request.envelope.payload.worldbookId,
      uid,
      comment: request.envelope.payload.comment ?? "",
      content: request.envelope.payload.content,
      keysJson: JSON.stringify(request.envelope.payload.keys),
      keysSecondaryJson: JSON.stringify(request.envelope.payload.keysSecondary ?? []),
      selective: request.envelope.payload.selective ?? true,
      selectiveLogic: 0,
      constant: request.envelope.payload.constant ?? false,
      position: request.envelope.payload.position ?? 0,
      order: request.envelope.payload.order ?? 100,
      depth: request.envelope.payload.depth ?? 4,
      role: 0,
      disable: request.envelope.payload.disable ?? false,
      createdAt: now,
      updatedAt: now,
    }).run()

    request.context.tx.update(worldbooks)
      .set({ updatedAt: now })
      .where(eq(worldbooks.id, request.envelope.payload.worldbookId))
      .run()

    return {
      result: {
        id: entryId,
        worldbookId: request.envelope.payload.worldbookId,
        uid,
        keys: request.envelope.payload.keys,
        comment: request.envelope.payload.comment ?? "",
      } satisfies CreateWorldbookEntryMutationResult,
    }
  }

  private applyUpdateWorldbookEntry(
    request: RuntimeMutationApplyRequest<UpdateWorldbookEntryMutationPayload>,
  ) {
    const [worldbook] = request.context.tx
      .select()
      .from(worldbooks)
      .where(and(
        eq(worldbooks.id, request.envelope.payload.worldbookId),
        eq(worldbooks.accountId, request.envelope.accountId),
      ))
      .limit(1)
      .all()

    if (!worldbook) {
      throw new ResourceWriteRouteError(
        404,
        "not_found",
        `Worldbook not found: ${request.envelope.payload.worldbookId}`,
      )
    }

    const [entry] = request.context.tx
      .select()
      .from(worldbookEntries)
      .where(and(
        eq(worldbookEntries.id, request.envelope.payload.entryId),
        eq(worldbookEntries.worldbookId, request.envelope.payload.worldbookId),
      ))
      .limit(1)
      .all()

    if (!entry) {
      throw new ResourceWriteRouteError(
        404,
        "not_found",
        `Entry not found: ${request.envelope.payload.entryId}`,
      )
    }

    const now = request.context.now()
    const updates: Record<string, unknown> = { updatedAt: now }

    if (request.envelope.payload.updates.keys !== undefined) updates.keysJson = JSON.stringify(request.envelope.payload.updates.keys)
    if (request.envelope.payload.updates.content !== undefined) updates.content = request.envelope.payload.updates.content
    if (request.envelope.payload.updates.comment !== undefined) updates.comment = request.envelope.payload.updates.comment
    if (request.envelope.payload.updates.keysSecondary !== undefined) updates.keysSecondaryJson = JSON.stringify(request.envelope.payload.updates.keysSecondary)
    if (request.envelope.payload.updates.selective !== undefined) updates.selective = request.envelope.payload.updates.selective
    if (request.envelope.payload.updates.constant !== undefined) updates.constant = request.envelope.payload.updates.constant
    if (request.envelope.payload.updates.position !== undefined) updates.position = request.envelope.payload.updates.position
    if (request.envelope.payload.updates.order !== undefined) updates.order = request.envelope.payload.updates.order
    if (request.envelope.payload.updates.depth !== undefined) updates.depth = request.envelope.payload.updates.depth
    if (request.envelope.payload.updates.disable !== undefined) updates.disable = request.envelope.payload.updates.disable

    request.context.tx.update(worldbookEntries)
      .set(updates)
      .where(eq(worldbookEntries.id, request.envelope.payload.entryId))
      .run()

    request.context.tx.update(worldbooks)
      .set({ updatedAt: now })
      .where(eq(worldbooks.id, request.envelope.payload.worldbookId))
      .run()

    const [updated] = request.context.tx
      .select()
      .from(worldbookEntries)
      .where(eq(worldbookEntries.id, request.envelope.payload.entryId))
      .limit(1)
      .all()

    if (!updated) {
      throw new Error(`Failed to read back updated entry: ${request.envelope.payload.entryId}`)
    }

    return {
      result: {
        id: updated.id,
        worldbookId: updated.worldbookId,
        uid: updated.uid,
        keys: JSON.parse(updated.keysJson),
        content: updated.content,
        comment: updated.comment,
      } satisfies UpdateWorldbookEntryMutationResult,
    }
  }

  private applyCreateRegexProfile(request: RuntimeMutationApplyRequest<CreateRegexProfileMutationPayload>) {
    const id = nanoid()
    const now = request.context.now()

    request.context.tx.insert(regexProfiles).values({
      id,
      name: request.envelope.payload.name,
      source: "tool",
      accountId: request.envelope.accountId,
      dataJson: "[]",
      createdAt: now,
      updatedAt: now,
    }).run()

    return {
      result: {
        id,
        name: request.envelope.payload.name,
        source: "tool",
      } satisfies CreateRegexProfileMutationResult,
    }
  }

  private applyCreateRegexRule(request: RuntimeMutationApplyRequest<CreateRegexRuleMutationPayload>) {
    const [profile] = request.context.tx
      .select()
      .from(regexProfiles)
      .where(and(
        eq(regexProfiles.id, request.envelope.payload.profileId),
        eq(regexProfiles.accountId, request.envelope.accountId),
      ))
      .limit(1)
      .all()

    if (!profile) {
      throw new ResourceWriteRouteError(
        404,
        "not_found",
        `Regex profile not found: ${request.envelope.payload.profileId}`,
      )
    }

    let scripts: RegexScript[]
    try {
      scripts = JSON.parse(profile.dataJson)
      if (!Array.isArray(scripts)) scripts = []
    } catch {
      scripts = []
    }

    const newRule: RegexScript = {
      id: nanoid(),
      scriptName: request.envelope.payload.scriptName ?? "",
      findRegex: request.envelope.payload.findRegex,
      replaceString: request.envelope.payload.replaceString,
      trimStrings: request.envelope.payload.trimStrings ?? [],
      placement: request.envelope.payload.placement ?? [2],
      disabled: request.envelope.payload.disabled ?? false,
      markdownOnly: false,
      promptOnly: false,
      runOnEdit: false,
      substituteRegex: 0,
      minDepth: 0,
      maxDepth: 0,
    }

    scripts.push(newRule)
    const ruleIndex = scripts.length - 1
    const now = request.context.now()
    const nextVersion = profile.version + 1

    request.context.tx.update(regexProfiles)
      .set({
        dataJson: JSON.stringify(scripts),
        updatedAt: now,
        version: nextVersion,
      })
      .where(eq(regexProfiles.id, request.envelope.payload.profileId))
      .run()

    return {
      result: {
        ruleIndex,
        scriptName: newRule.scriptName,
        findRegex: newRule.findRegex,
      } satisfies RegexRuleMutationResult,
    }
  }

  private applyUpdateRegexRule(request: RuntimeMutationApplyRequest<UpdateRegexRuleMutationPayload>) {
    const [profile] = request.context.tx
      .select()
      .from(regexProfiles)
      .where(and(
        eq(regexProfiles.id, request.envelope.payload.profileId),
        eq(regexProfiles.accountId, request.envelope.accountId),
      ))
      .limit(1)
      .all()

    if (!profile) {
      throw new ResourceWriteRouteError(
        404,
        "not_found",
        `Regex profile not found: ${request.envelope.payload.profileId}`,
      )
    }

    let scripts: RegexScript[]
    try {
      scripts = JSON.parse(profile.dataJson)
      if (!Array.isArray(scripts)) scripts = []
    } catch {
      scripts = []
    }

    if (request.envelope.payload.ruleIndex >= scripts.length) {
      throw new Error(
        `rule_index ${request.envelope.payload.ruleIndex} out of range (profile has ${scripts.length} rules)`,
      )
    }

    const rule = scripts[request.envelope.payload.ruleIndex]
    if (!rule) {
      throw new Error(
        `rule_index ${request.envelope.payload.ruleIndex} out of range (profile has ${scripts.length} rules)`,
      )
    }

    if (request.envelope.payload.updates.scriptName !== undefined) rule.scriptName = request.envelope.payload.updates.scriptName
    if (request.envelope.payload.updates.findRegex !== undefined) rule.findRegex = request.envelope.payload.updates.findRegex
    if (request.envelope.payload.updates.replaceString !== undefined) rule.replaceString = request.envelope.payload.updates.replaceString
    if (request.envelope.payload.updates.trimStrings !== undefined) rule.trimStrings = request.envelope.payload.updates.trimStrings
    if (request.envelope.payload.updates.placement !== undefined) rule.placement = request.envelope.payload.updates.placement
    if (request.envelope.payload.updates.disabled !== undefined) rule.disabled = request.envelope.payload.updates.disabled
    const now = request.context.now()
    const nextVersion = profile.version + 1

    request.context.tx.update(regexProfiles)
      .set({
        dataJson: JSON.stringify(scripts),
        updatedAt: now,
        version: nextVersion,
      })
      .where(eq(regexProfiles.id, request.envelope.payload.profileId))
      .run()

    return {
      result: {
        ruleIndex: request.envelope.payload.ruleIndex,
        scriptName: rule.scriptName,
        findRegex: rule.findRegex,
      } satisfies RegexRuleMutationResult,
    }
  }

  private applyCreatePresetEntry(request: RuntimeMutationApplyRequest<CreatePresetEntryMutationPayload>) {
    const loaded = loadPresetRawForMutation(request, request.envelope.payload.presetId)
    if (!loaded) {
      throw new ResourceWriteRouteError(
        404,
        "not_found",
        `Preset not found: ${request.envelope.payload.presetId}`,
      )
    }

    const { raw } = loaded
    if (findPromptInRaw(raw, request.envelope.payload.identifier)) {
      throw new Error(`Entry with identifier '${request.envelope.payload.identifier}' already exists`)
    }

    addPromptToRaw(raw, {
      identifier: request.envelope.payload.identifier,
      ...request.envelope.payload.promptData,
    }, request.envelope.payload.promptData.enabled)

    const validationError = validatePresetRawForMutation(raw)
    if (validationError) {
      throw new Error(`Preset validation failed: ${validationError}`)
    }

    savePresetRawForMutation(request, request.envelope.payload.presetId, raw, request.context.now())

    const entry = getEditorEntryFromRaw(raw, request.envelope.payload.identifier)
    return {
      result: entry
        ? {
          identifier: entry.identifier,
          name: entry.name,
          role: entry.role,
          content: entry.content,
          system_prompt: entry.system_prompt,
          marker: entry.marker,
          injection_position: entry.injection_position,
          enabled: entry.enabled,
        }
        : { identifier: request.envelope.payload.identifier },
    }
  }

  private applyUpdatePresetEntry(request: RuntimeMutationApplyRequest<UpdatePresetEntryMutationPayload>) {
    const loaded = loadPresetRawForMutation(request, request.envelope.payload.presetId)
    if (!loaded) {
      throw new ResourceWriteRouteError(
        404,
        "not_found",
        `Preset not found: ${request.envelope.payload.presetId}`,
      )
    }

    const { raw } = loaded
    if (!findPromptInRaw(raw, request.envelope.payload.identifier)) {
      throw new Error(`Entry not found: ${request.envelope.payload.identifier}`)
    }

    if (Object.keys(request.envelope.payload.fields).length === 0) {
      throw new Error("At least one field to update is required")
    }

    updatePromptFieldsInRaw(raw, request.envelope.payload.identifier, request.envelope.payload.fields as JsonRecord)

    const validationError = validatePresetRawForMutation(raw)
    if (validationError) {
      throw new Error(`Preset validation failed: ${validationError}`)
    }

    savePresetRawForMutation(request, request.envelope.payload.presetId, raw, request.context.now())

    const entry = getEditorEntryFromRaw(raw, request.envelope.payload.identifier)
    return {
      result: entry
        ? {
          identifier: entry.identifier,
          name: entry.name,
          role: entry.role,
          content: entry.content,
          system_prompt: entry.system_prompt,
          marker: entry.marker,
          injection_position: entry.injection_position,
          enabled: entry.enabled,
        }
        : { identifier: request.envelope.payload.identifier },
    }
  }
}

export function registerResourceMutationAppliers(
  registry: MutationApplierRegistry,
  applier: ResourceMutationApplier = new ResourceMutationApplier(),
): ResourceMutationApplier {
  registry.register(RESOURCE_MUTATION_KINDS.characterCreate, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(RESOURCE_MUTATION_KINDS.characterUpdate, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(RESOURCE_MUTATION_KINDS.worldbookCreate, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(RESOURCE_MUTATION_KINDS.worldbookEntryCreate, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(RESOURCE_MUTATION_KINDS.worldbookEntryUpdate, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(RESOURCE_MUTATION_KINDS.regexProfileCreate, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(RESOURCE_MUTATION_KINDS.regexRuleCreate, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(RESOURCE_MUTATION_KINDS.regexRuleUpdate, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(RESOURCE_MUTATION_KINDS.presetEntryCreate, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(RESOURCE_MUTATION_KINDS.presetEntryUpdate, applier as RuntimeMutationApplier<unknown, unknown>)
  return applier
}
