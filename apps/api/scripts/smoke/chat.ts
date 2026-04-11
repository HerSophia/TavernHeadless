import type { SmokeContext } from "./harness.js";
import { assert, must } from "./harness.js";

export async function smokeChat(ctx: SmokeContext): Promise<void> {
  const { api, runId, runStep } = ctx;
  const sessionId = must(ctx.shared.sessionId, "smokeChat requires sessionId");
  const committedBranchFloorId = must(ctx.shared.committedBranchFloorId, "smokeChat requires committedBranchFloorId");
  let previewEnabled = false;

  await runStep("GET /prompt-runtime/capabilities", async () => {
    const response = await api.request<{ data?: Record<string, unknown> }>("GET", "/prompt-runtime/capabilities", undefined, [200]);
    const data = response.body?.data;
    const macro = data?.macro as Record<string, unknown> | undefined;
    const observability = data?.observability as Record<string, unknown> | undefined;
    const preview = observability?.preview as Record<string, unknown> | undefined;
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
      },
      [200]
    );
    const data = response.body?.data;
    const persistentPolicy = data?.persistent_policy as Record<string, unknown> | undefined;
    const resolvedPolicy = data?.resolved_policy as Record<string, unknown> | undefined;
    const persistentStructure = persistentPolicy?.structure as Record<string, unknown> | undefined;
    const resolvedStructure = resolvedPolicy?.structure as Record<string, unknown> | undefined;

    assert(persistentStructure?.mode === "no_assistant", "Prompt Runtime policy patch must persist structure.mode=no_assistant");
    assert(persistentStructure?.assistant_rewrite_strategy === "to_user_transcript", "Prompt Runtime policy patch must persist assistant_rewrite_strategy");
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

    await runStep("POST /sessions/:id/prompt-runtime/preview (structured path + preview suppression)", async () => {
      const response = await api.request<{ data?: Record<string, unknown> }>(
        "POST",
        `/sessions/${sessionId}/prompt-runtime/preview`,
        {
          text: "{{setvar::资产.银币::5}}{{getvar::资产}}/{{getvar::资产.金币}}/{{getvar::资产.银币}}/{{$账户.余额}}/{{if {{getvar::资产.金币}} >= 3}}RICH{{else}}POOR{{/if}}",
          branch_id: "main",
        },
        [200]
      );
      const data = response.body?.data;
      const runtimeTrace = data?.runtime_trace as Record<string, unknown> | undefined;
      const macro = runtimeTrace?.macro as Record<string, unknown> | undefined;
      const warnings = Array.isArray(macro?.warnings) ? macro.warnings as Array<Record<string, unknown>> : [];
      const mutationPreview = Array.isArray(macro?.mutation_preview) ? macro.mutation_preview as Array<Record<string, unknown>> : [];
      const stagedMutations = Array.isArray(macro?.staged_mutations) ? macro.staged_mutations as Array<Record<string, unknown>> : [];
      const previewText = typeof data?.text === "string" ? data.text : "";
      const previewParts = previewText.split("/");

      assert(previewParts.length === 5, `Prompt Runtime preview structured path smoke returned unexpected text: ${previewText}`);
      assert(JSON.stringify(JSON.parse(previewParts[0] ?? "{}")) === JSON.stringify({ 金币: 3, 银币: "5" }), "Prompt Runtime preview must stringify outward object reads as JSON");
      assert(previewParts[1] === "3", "Prompt Runtime preview must read structured local path values");
      assert(previewParts[2] === "5", "Prompt Runtime preview must expose same-evaluation write visibility");
      assert(previewParts[3] === "8", "Prompt Runtime preview must read structured global path values");
      assert(previewParts[4] === "RICH", "Prompt Runtime preview must evaluate richer if with structured path reads");
      assert(warnings.some((warning) => warning.code === "macro_preview_side_effect_suppressed"), "Prompt Runtime preview must surface preview side-effect suppression warnings");
      assert(stagedMutations.length === 0, "Prompt Runtime preview must keep staged_mutations empty");
      assert(mutationPreview.some((entry) => entry.kind === "set" && entry.scope === "branch" && entry.key === "资产"), "Prompt Runtime preview must surface root mutation_preview for nested writes");
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

    await runStep("POST /sessions/:id/prompt-runtime/preview (branch inheritance)", async () => {
      const response = await api.request<{ data?: Record<string, unknown> }>(
        "POST",
        `/sessions/${sessionId}/prompt-runtime/preview`,
        {
          text: "{{getvar::分支资产.徽章}}",
          branch_id: `${runId}-preview-branch`,
          source_floor_id: committedBranchFloorId,
        },
        [200]
      );
      const data = response.body?.data;
      const macro = (data?.runtime_trace as Record<string, unknown> | undefined)?.macro as Record<string, unknown> | undefined;
      const stagedMutations = Array.isArray(macro?.staged_mutations) ? macro.staged_mutations as Array<Record<string, unknown>> : [];

      assert(data?.text === "main", `Prompt Runtime preview must inherit source floor local values into a new branch context, got: ${String(data?.text)}`);
      assert(stagedMutations.length === 0, "Prompt Runtime preview branch inheritance smoke must keep staged_mutations empty");
    });
  }

  const dryRunResponse = await api.request<{ data?: Record<string, unknown> }>(
    "POST",
    `/sessions/${sessionId}/respond/dry-run`,
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
      assert(messages.some((message) => message.role === "user" && message.content === `Assistant: ${runId}-v2-edited`), "Prompt Runtime dry-run verification must materialize rewritten assistant history as user transcript");
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
