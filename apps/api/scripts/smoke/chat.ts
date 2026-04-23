import type { SmokeContext } from "./harness.js";
import { assert, must } from "./harness.js";

export async function smokeChat(ctx: SmokeContext): Promise<void> {
  const { api, runId, runStep, track, addCleanup } = ctx;
  const sessionId = must(ctx.shared.sessionId, "smokeChat requires sessionId");
  const floorId = must(ctx.shared.floorId, "smokeChat requires floorId");
  const committedBranchFloorId = must(ctx.shared.committedBranchFloorId, "smokeChat requires committedBranchFloorId");
  const contentFloorCommittedId = must(
    ctx.shared.contentFloorCommittedId,
    "smokeChat requires contentFloorCommittedId"
  );
  let previewEnabled = false;

  await runStep("GET /prompt-runtime/capabilities", async () => {
    const response = await api.request<{ data?: Record<string, unknown> }>("GET", "/prompt-runtime/capabilities", undefined, [200]);
    const data = response.body?.data;
    const macro = data?.macro as Record<string, unknown> | undefined;
    const budget = data?.budget as Record<string, unknown> | undefined;
    const sourceSelection = data?.source_selection as Record<string, unknown> | undefined;
    const governance = data?.governance as Record<string, unknown> | undefined;
    const compare = data?.compare as Record<string, unknown> | undefined;
    const observability = data?.observability as Record<string, unknown> | undefined;
    const preview = observability?.preview as Record<string, unknown> | undefined;
    const explain = observability?.explain as Record<string, unknown> | undefined;
    const unsupportedValue = data?.unsupported;

    assert(Boolean(data), "Prompt Runtime capabilities response is missing data");
    assert(macro?.built_in_read_only_values_persistable === false, "Prompt Runtime capabilities must keep built-in read-only macro values non-persistable");
    assert(macro?.st_compatibility_snapshots_persistable === false, "Prompt Runtime capabilities must keep ST compatibility snapshots non-persistable");
    assert(macro?.run_kind_persistable === false, "Prompt Runtime capabilities must keep run_kind non-persistable");
    if (!Array.isArray(unsupportedValue)) {
      throw new Error("Prompt Runtime capabilities must expose unsupported routes");
    }
    assert(typeof preview === "object" && preview !== null, "Prompt Runtime capabilities must expose preview observability settings");
    assert(preview?.returns_runtime_trace === true, "Prompt Runtime preview capabilities must return runtime_trace");
    assert(preview?.supports_visibility === true, "Prompt Runtime preview capabilities must support visibility");
    assert(preview?.single_text_only === true, "Prompt Runtime preview capabilities must stay single-text-only");
    assert(preview?.llm_call === false, "Prompt Runtime preview capabilities must not perform LLM calls");
    assert(preview?.creates_floor === false, "Prompt Runtime preview capabilities must not create floors");
    assert(preview?.writes_prompt_snapshot === false, "Prompt Runtime preview capabilities must not write prompt snapshots");
    assert(preview?.commits_side_effects === false, "Prompt Runtime preview capabilities must not commit side effects");
    assert(budget?.persistent_patch_supported === true, "Prompt Runtime capabilities must allow persistent budget patching");
    assert(sourceSelection?.persistent_patch_supported === true, "Prompt Runtime capabilities must allow persistent source selection patching");
    assert(typeof governance?.session === "object" && governance.session !== null, "Prompt Runtime capabilities must expose session governance");
    assert(typeof governance?.branch === "object" && governance.branch !== null, "Prompt Runtime capabilities must expose branch governance");
    assert(governance?.session?.envelope_metadata === true, "Prompt Runtime capabilities must expose session policy envelope metadata support");
    assert(governance?.branch?.materialized_branches_only === true, "Prompt Runtime capabilities must keep branch governance limited to materialized branches");
    assert(compare?.enabled === true, "Prompt Runtime capabilities must expose compare support");
    assert(compare?.committed_floors_only === true, "Prompt Runtime compare must stay committed-floor-only");
    assert(explain?.snapshot_supported === true, "Prompt Runtime explain capabilities must expose snapshot support");
    assert(explain?.legacy_floor_fallback === true, "Prompt Runtime explain capabilities must expose legacy fallback behavior");
    assert(explain?.snapshot_availability_field === "snapshot_available", "Prompt Runtime explain capabilities must expose snapshot_available field name");

    assert(unsupportedValue.includes("/sessions/:id/prompt-runtime/macros"), "Prompt Runtime capabilities must declare the macros route as unsupported");
    assert(!unsupportedValue.includes("/sessions/:id/prompt-runtime/preview"), "Prompt Runtime capabilities must not report preview route as unsupported");
    previewEnabled = preview?.enabled === true;
  });

  await runStep("GET /sessions/:id/prompt-runtime", async () => {
    const response = await api.request<{ data?: Record<string, unknown> }>("GET", `/sessions/${sessionId}/prompt-runtime`, undefined, [200]);
    const data = response.body?.data;

    assert(Boolean(data), "Prompt Runtime session state response is missing data");
    assert(typeof data?.policy === "object" && data.policy !== null, "Prompt Runtime session state must expose policy");
    assert(typeof data?.assets === "object" && data.assets !== null, "Prompt Runtime session state must expose assets");
  });

  await runStep("PATCH /sessions/:id/prompt-runtime/policy", async () => {
    const response = await api.request<{ data?: Record<string, unknown> }>(
      "PATCH",
      `/sessions/${sessionId}/prompt-runtime/policy`,
      {
        structure: {
          mode: "no_assistant",
          assistant_rewrite_strategy: "to_user_transcript",
        },
        budget: {
          max_input_tokens: 4096,
          reserved_completion_tokens: 1024,
        },
        source_selection: {
          history: { mode: "windowed", max_messages: 24 },
          memory: { enabled: true },
          worldbook: { enabled: true },
          examples: { enabled: false },
        },
      },
      [200]
    );
    const data = response.body?.data;
    const persistentPolicy = data?.persistent_policy as Record<string, unknown> | undefined;
    const persistentPolicyEnvelope = data?.persistent_policy_envelope as Record<string, unknown> | undefined;
    const resolvedPolicy = data?.resolved_policy as Record<string, unknown> | undefined;
    const persistentStructure = persistentPolicy?.structure as Record<string, unknown> | undefined;
    const persistentBudget = persistentPolicy?.budget as Record<string, unknown> | undefined;
    const persistentSourceSelection = persistentPolicy?.source_selection as Record<string, unknown> | undefined;
    const resolvedStructure = resolvedPolicy?.structure as Record<string, unknown> | undefined;

    assert(persistentStructure?.mode === "no_assistant", "Prompt Runtime policy patch must persist structure.mode=no_assistant");
    assert(persistentStructure?.assistant_rewrite_strategy === "to_user_transcript", "Prompt Runtime policy patch must persist assistant_rewrite_strategy");
    assert(persistentBudget?.max_input_tokens === 4096, "Prompt Runtime policy patch must persist budget.max_input_tokens");
    assert((persistentSourceSelection?.history as Record<string, unknown> | undefined)?.mode === "windowed", "Prompt Runtime policy patch must persist source_selection.history.mode");
    assert(persistentPolicyEnvelope?.version === 1, "Prompt Runtime policy patch must expose the persisted policy envelope version");
    assert(resolvedStructure?.mode === "no_assistant", "Prompt Runtime policy patch must update resolved structure.mode");
    assert(resolvedStructure?.assistant_rewrite_strategy === "to_user_transcript", "Prompt Runtime policy patch must update resolved assistant_rewrite_strategy");
  });

  await runStep("GET /sessions/:id/prompt-runtime (after patch)", async () => {
    const response = await api.request<{ data?: Record<string, unknown> }>("GET", `/sessions/${sessionId}/prompt-runtime`, undefined, [200]);
    const persistentPolicy = response.body?.data?.persistent_policy as Record<string, unknown> | undefined;
    const persistentStructure = persistentPolicy?.structure as Record<string, unknown> | undefined;
    const sourceMap = response.body?.data?.source_map as Record<string, unknown> | undefined;
    const structureSourceMap = sourceMap?.structure as Record<string, unknown> | undefined;

    assert(persistentStructure?.mode === "no_assistant", "Prompt Runtime session state must reflect the patched structure mode");
    assert(structureSourceMap?.mode === "session_policy", "Prompt Runtime source_map must reflect session-sourced structure.mode");
  });

  // 复用 core smoke 里创建的 committedBranchFloorId：它是裸 CRUD 创建、直接落在
  // committed 状态的楼层，没有 prompt/runtime truth snapshot，是该分支上唯一可用
  // 的 committed 裸 CRUD 样本。之前这里用的是 core smoke 里的 `floorId`，依赖
  // "先建 draft、再 PATCH 成 committed" 的旧路径；chat-main-flow-repair 之后
  // PATCH /floors/:id 不再允许修改 `state`，因此改为复用 committedBranchFloorId。
  await runStep("GET /floors/:id/prompt-runtime/explain (raw CRUD floor => 404)", async () => {
    const response = await api.request<{ error?: { code?: string; message?: string } }>(
      "GET",
      `/floors/${committedBranchFloorId}/prompt-runtime/explain`,
      undefined,
      [404]
    );

    assert(
      response.body?.error?.code === "prompt_runtime_explain_not_found",
      "Prompt Runtime explain must reject committed raw CRUD floors that do not carry prompt/runtime truth snapshots"
    );
  });

  await runStep("POST /sessions/:id/prompt-runtime/compare (legacy fallback)", async () => {
    const response = await api.request<{ data?: Record<string, unknown> }>(
      "POST",
      `/sessions/${sessionId}/prompt-runtime/compare`,
      {
        left: { floor_id: contentFloorCommittedId },
        right: { floor_id: committedBranchFloorId },
      },
      [200]
    );
    const data = response.body?.data;
    const left = data?.left as Record<string, unknown> | undefined;
    const right = data?.right as Record<string, unknown> | undefined;

    assert(left?.floor_id === contentFloorCommittedId, "Prompt Runtime compare must echo the left floor id");
    assert(right?.floor_id === committedBranchFloorId, "Prompt Runtime compare must echo the right floor id");
    assert(Array.isArray(data?.limitations), "Prompt Runtime compare must expose limitations for legacy floors");
  });

  if (!previewEnabled) {
    console.log("  ⏭  preview route not available, skipping prompt-runtime preview macro smoke.");
  } else {
    await runStep("PUT /variables (prompt runtime preview setup)", async () => {
      await api.request("PUT", "/variables", {
        scope: "branch",
        session_id: sessionId,
        branch_id: "main",
        key: "资产",
        value: { 金币: 3 },
      }, [200, 201]);
      await api.request("PUT", "/variables", {
        scope: "global",
        scope_id: "global",
        key: "账户",
        value: { 余额: 8 },
      }, [200, 201]);
      await api.request("PUT", "/variables", {
        scope: "branch",
        session_id: sessionId,
        branch_id: "main",
        key: "装备",
        value: { "剑.名": "霜刃" },
      }, [200, 201]);
      await api.request("PUT", "/variables", {
        scope: "branch",
        session_id: sessionId,
        branch_id: "main",
        key: "分支资产",
        value: { 徽章: "main" },
      }, [200, 201]);
    });

    await runStep("POST /sessions/:id/prompt-runtime/preview (structured path + shorthand + alias + preview suppression)", async () => {
      const response = await api.request<{ data?: Record<string, unknown> }>(
        "POST",
        `/sessions/${sessionId}/prompt-runtime/preview`,
        {
          text: "{{.资产.银币=5}}{{getvar::资产}}/{{getvar::资产.金币}}/{{getvar::资产.银币}}/{{$账户.余额}}/{{varexists::资产.金币}}/{{if {{getvar::资产.金币}} >= 3}}RICH{{else}}POOR{{/if}}",
          branch_id: "main",
        },
        [200]
      );
      const data = response.body?.data;
      const runtimeTrace = data?.runtime_trace as Record<string, unknown> | undefined;
      const macro = runtimeTrace?.macro as Record<string, unknown> | undefined;
      const warnings = Array.isArray(macro?.warnings) ? macro.warnings as Array<Record<string, unknown>> : [];
      const traces = Array.isArray(macro?.traces) ? macro.traces as Array<Record<string, unknown>> : [];
      const mutationPreview = Array.isArray(macro?.mutation_preview) ? macro.mutation_preview as Array<Record<string, unknown>> : [];
      const stagedMutations = Array.isArray(macro?.staged_mutations) ? macro.staged_mutations as Array<Record<string, unknown>> : [];
      const previewText = typeof data?.text === "string" ? data.text : "";
      const previewParts = previewText.split("/");

      assert(previewParts.length === 6, `Prompt Runtime preview structured path smoke returned unexpected text: ${previewText}`);
      assert(JSON.stringify(JSON.parse(previewParts[0] ?? "{}")) === JSON.stringify({ 金币: 3, 银币: "5" }), "Prompt Runtime preview must stringify outward object reads as JSON");
      assert(previewParts[1] === "3", "Prompt Runtime preview must read structured local path values");
      assert(previewParts[2] === "5", "Prompt Runtime preview must expose same-evaluation write visibility");
      assert(previewParts[3] === "8", "Prompt Runtime preview must read structured global path values");
      assert(previewParts[4] === "true", "Prompt Runtime preview must normalize variable macro aliases to canonical behavior");
      assert(previewParts[5] === "RICH", "Prompt Runtime preview must evaluate richer if with structured path reads");
      assert(warnings.some((warning) => warning.code === "macro_preview_side_effect_suppressed"), "Prompt Runtime preview must surface preview side-effect suppression warnings");
      assert(stagedMutations.length === 0, "Prompt Runtime preview must keep staged_mutations empty");
      assert(mutationPreview.some((entry) => entry.kind === "set" && entry.scope === "branch" && entry.key === "资产"), "Prompt Runtime preview must surface root mutation_preview for nested writes");
      assert(traces.some((trace) => trace.macro_name === "setvar" && trace.raw_text === "{{.资产.银币=5}}"), "Prompt Runtime preview must keep shorthand raw_text while tracing canonical macro_name");
      assert(traces.some((trace) => trace.macro_name === "hasvar" && trace.raw_text === "{{varexists::资产.金币}}"), "Prompt Runtime preview must keep alias raw_text while tracing canonical macro_name");
    });

    await runStep("POST /sessions/:id/prompt-runtime/preview (readonly macro expansion + global shorthand write)", async () => {
      const response = await api.request<{ data?: Record<string, unknown> }>(
        "POST",
        `/sessions/${sessionId}/prompt-runtime/preview`,
        {
          text: "{{userName}}/{{assistantName}}/{{runKind}}/{{promptMode}}/{{isodate}}/{{isotime}}/{{isotime}}/{{$账户.透支=1}}{{getglobalvar::账户.透支}}",
          branch_id: "main",
        },
        [200]
      );
      const data = response.body?.data;
      const macro = (data?.runtime_trace as Record<string, unknown> | undefined)?.macro as Record<string, unknown> | undefined;
      const mutationPreview = Array.isArray(macro?.mutation_preview) ? macro.mutation_preview as Array<Record<string, unknown>> : [];
      const previewText = typeof data?.text === "string" ? data.text : "";
      const previewParts = previewText.split("/");

      assert(previewParts.length === 8, `Prompt Runtime preview readonly macro smoke returned unexpected text: ${previewText}`);
      assert(previewParts[0] === "", "Prompt Runtime preview should leave userName empty when no user snapshot is bound");
      assert(previewParts[1] === "Knight", `Prompt Runtime preview must expose assistantName from the session character snapshot, got: ${previewParts[1]}`);
      assert(previewParts[2] === "dry_run", "Prompt Runtime preview must expose runKind as dry_run");
      assert(previewParts[3] === "compat_strict", "Prompt Runtime preview must expose promptMode from the session context");
      assert(/^\d{4}-\d{2}-\d{2}$/.test(previewParts[4] ?? ""), `Prompt Runtime preview must expose isodate in YYYY-MM-DD format, got: ${previewParts[4]}`);
      assert(/^\d{2}:\d{2}$/.test(previewParts[5] ?? ""), `Prompt Runtime preview must expose isotime in HH:mm format, got: ${previewParts[5]}`);
      assert(previewParts[5] === previewParts[6], "Prompt Runtime preview must freeze isotime within one evaluation");
      assert(previewParts[7] === "1", "Prompt Runtime preview must expose global shorthand writes to later reads in the same evaluation");
      assert(mutationPreview.some((entry) => entry.kind === "set" && entry.scope === "global" && entry.key === "账户"), "Prompt Runtime preview must surface root mutation_preview for global shorthand path writes");
    });

    await runStep("PUT /variables (prompt runtime exact dotted key setup)", () =>
      api.request("PUT", "/variables", {
        scope: "branch",
        session_id: sessionId,
        branch_id: "main",
        key: "资产.金币",
        value: "flat",
      }, [200, 201])
    );

    await runStep("POST /sessions/:id/prompt-runtime/preview (exact dotted key + quoted key)", async () => {
      const response = await api.request<{ data?: Record<string, unknown> }>(
        "POST",
        `/sessions/${sessionId}/prompt-runtime/preview`,
        { text: '{{getvar::资产.金币}}/{{getvar::装备["剑.名"]}}', branch_id: "main" },
        [200]
      );
      const text = response.body?.data?.text;
      assert(text === "flat/霜刃", `Prompt Runtime preview must preserve exact-key-first and quoted-key semantics, got: ${String(text)}`);
    });

    await runStep("POST /sessions/:id/prompt-runtime/preview (raw CRUD floor without snapshot => 409)", async () => {
      const response = await api.request<{ error?: { code?: string; message?: string } }>(
        "POST",
        `/sessions/${sessionId}/prompt-runtime/preview`,
        {
          text: "{{getvar::分支资产.徽章}}",
          branch_id: `${runId}-preview-branch`,
          source_floor_id: committedBranchFloorId,
        },
        [409]
      );
      assert(response.body?.error?.code === "branch_local_snapshot_missing", "Prompt Runtime preview must reject raw CRUD floors that do not carry branch-local snapshots");
      assert(
        (response.body?.error?.message ?? "").includes("does not have a branch local snapshot"),
        "Prompt Runtime preview raw CRUD floor smoke must preserve the strict snapshot failure message"
      );
    });

    await runStep("POST /sessions/:id/prompt-runtime/preview (imported floor without snapshot => 409)", async () => {
      const importedAt = Date.now();
      const importResponse = await api.request<{ data?: { session_id?: string } }>(
        "POST",
        "/import/chat",
        {
          data: JSON.stringify({
            spec: "tavern_headless_chat",
            spec_version: "1.0.0",
            exported_at: importedAt,
            export_source: "smoke",
            data: {
              title: `${runId}-imported-legacy`,
              status: "active",
              created_at: importedAt,
              updated_at: importedAt,
              character_snapshot: null,
              user_snapshot: null,
              character_sync_policy: "pin",
              floors: [
                {
                  floor_no: 0,
                  branch_id: "main",
                  parent_floor_id_ref: null,
                  state: "committed",
                  token_in: 0,
                  token_out: 1,
                  metadata: null,
                  created_at: importedAt,
                  updated_at: importedAt,
                  _original_id: "legacy-floor-001",
                  pages: [
                    {
                      page_no: 0,
                      page_kind: "output",
                      is_active: true,
                      version: 1,
                      checksum: null,
                      created_at: importedAt,
                      updated_at: importedAt,
                      _original_id: "legacy-page-001",
                      messages: [
                        {
                          seq: 0,
                          role: "assistant",
                          content: "legacy reply",
                          content_format: "text",
                          token_count: 1,
                          is_hidden: false,
                          source: "smoke-import",
                          created_at: importedAt,
                          _original_id: "legacy-msg-001",
                        },
                      ],
                    },
                  ],
                },
              ],
              variables: [
                {
                  scope: "branch",
                  scope_id_ref: "main",
                  key: "legacy",
                  value: "imported",
                  updated_at: importedAt,
                },
              ],
            },
          }),
        },
        [201]
      );
      const importedSessionId = must(importResponse.body?.data?.session_id, "Prompt Runtime import smoke must return a session_id");
      track("sessions", importedSessionId);
      addCleanup(async () => {
        await api.request("DELETE", `/sessions/${importedSessionId}`, undefined, [200, 404]);
      });

      const timelineResponse = await api.request<{ data?: { floors?: Array<{ id?: string }> } }>(
        "GET",
        `/sessions/${importedSessionId}/timeline`,
        undefined,
        [200]
      );
      const importedFloorId = must(timelineResponse.body?.data?.floors?.[0]?.id, "Prompt Runtime import smoke must return the imported floor id");

      const previewResponse = await api.request<{ error?: { code?: string; message?: string } }>(
        "POST",
        `/sessions/${importedSessionId}/prompt-runtime/preview`,
        {
          text: "{{getvar::legacy}}",
          branch_id: `${runId}-imported-preview-branch`,
          source_floor_id: importedFloorId,
        },
        [409]
      );

      assert(previewResponse.body?.error?.code === "branch_local_snapshot_missing", "Prompt Runtime imported floor smoke must fail with branch_local_snapshot_missing");
      assert(
        (previewResponse.body?.error?.message ?? "").includes("does not have a branch local snapshot"),
        "Prompt Runtime imported floor smoke must preserve the strict snapshot failure message"
      );
    });
  }

  // dry-run 的 `structure.mode = "no_assistant"` 行为验证在一个独立的新会话里进行。
  // chat-main-flow-repair 之后 history 只取 committed 楼层，而共享 sessionId 的
  // 主链路上存在 draft 楼层、额外 committed 裸 CRUD 楼层以及多次 ancestry 操作，
  // 会让 history 实际落在初始 user 消息上、不包含 greeting。为了只验证 policy 对
  // history 的改写语义，这里新起一个只带 greeting 的会话。
  const dryRunSessionId = await (async () => {
    const created = await api.request<{ data: { id: string } }>(
      "POST",
      "/sessions",
      {
        title: `${runId}-dryrun-policy`,
        character_snapshot: { name: "Knight", primaryGreeting: "Hello there." },
      },
      [201]
    );
    const id = must(created.body?.data?.id, "dry-run policy smoke must return a session_id");
    track("sessions", id);
    addCleanup(async () => {
      await api.request("DELETE", `/sessions/${id}`, undefined, [200, 404]);
    });
    await api.request(
      "PATCH",
      `/sessions/${id}/prompt-runtime/policy`,
      {
        structure: { mode: "no_assistant", assistant_rewrite_strategy: "to_user_transcript" },
        budget: { max_input_tokens: 4096, reserved_completion_tokens: 1024 },
        source_selection: {
          history: { mode: "windowed", max_messages: 24 },
          memory: { enabled: true },
          worldbook: { enabled: true },
          examples: { enabled: false },
        },
      },
      [200]
    );
    return id;
  })();

  const dryRunResponse = await api.request<{ data?: Record<string, unknown> }>(
    "POST",
    `/sessions/${dryRunSessionId}/respond/dry-run`,
    { message: "Prompt Runtime smoke dry-run" },
    [200, 404]
  );

  if (dryRunResponse.status === 404) {
    console.log("  ⏭  dry-run route not available (ENABLE_PROMPT_DRY_RUN != true), skipping prompt-runtime execution verification.");
  } else {
    await runStep("POST /sessions/:id/respond/dry-run (prompt runtime policy effect)", async () => {
      const messagesValue = dryRunResponse.body?.data?.messages;
      assert(Array.isArray(messagesValue), "Prompt Runtime dry-run verification must return messages");

      const messages = messagesValue as Array<Record<string, unknown>>;
      assert(!messages.some((message) => message.role === "assistant"), "Prompt Runtime dry-run verification must rewrite assistant history under no_assistant mode");
      // 新会话只带一条 committed 的 greeting assistant 消息（"Hello there."），
      // 在 `structure.mode = "no_assistant"` 下应被改写为 user transcript。
      const rewritten = messages.some(
        (message) => message.role === "user" && message.content === "Assistant: Hello there.",
      );
      assert(
        rewritten,
        `Prompt Runtime dry-run verification must materialize rewritten assistant history as user transcript. Got messages: ${JSON.stringify(messages)}`,
      );
    });
  }

  // Probe dry-run route. It may return various status codes depending on
  // server configuration (LLM keys, preset binding, etc.). Any response
  // other than 404 proves the route is registered and reachable.
  const probe = await api.request(
    "POST",
    `/sessions/${sessionId}/respond/dry-run`,
    {},
    [200, 400, 404, 422, 500, 503]
  );

  if (probe.status === 404) {
    console.log("  \u23ed  dry-run route not available (ENABLE_PROMPT_DRY_RUN != true), skipping.");
  } else {
    await runStep("POST /sessions/:id/respond/dry-run (probe)", async () => {
      // Route is reachable — status already validated above.
    });
  }
}
