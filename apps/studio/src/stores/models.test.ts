import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { profilesApi, instancesApi } = vi.hoisted(() => ({
  profilesApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    discoverModels: vi.fn(),
    testModel: vi.fn(),
    activate: vi.fn(),
    runtime: vi.fn(),
    bindSlot: vi.fn(),
    unbindSlot: vi.fn(),
  },
  instancesApi: {
    list: vi.fn(),
    listResolved: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("../lib/models/profiles", () => ({ modelProfilesApi: profilesApi }));
vi.mock("../lib/models/instances", () => ({ llmInstancesApi: instancesApi }));

import { useModelsStore } from "./models";

function makeProfile(id: string) {
  return { id, presetName: id, provider: "openai", modelId: "gpt-4o", apiKeyMasked: "••••", status: "active" };
}

function makeInstance(slot: string, scope: string) {
  return { id: `${scope}-${slot}`, instanceSlot: slot, scope, scopeId: scope, presetId: null, enabled: true };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  profilesApi.list.mockResolvedValue([]);
  profilesApi.runtime.mockResolvedValue([]);
  profilesApi.bindSlot.mockResolvedValue(true);
  profilesApi.unbindSlot.mockResolvedValue(true);
  instancesApi.list.mockResolvedValue([]);
  instancesApi.listResolved.mockResolvedValue([]);
});

describe("models store", () => {
  it("loads profiles", async () => {
    profilesApi.list.mockResolvedValue([makeProfile("p1")]);
    const store = useModelsStore();
    await store.loadProfiles();
    expect(store.profiles).toHaveLength(1);
    expect(store.profiles[0]?.id).toBe("p1");
    expect(store.loadingProfiles).toBe(false);
  });

  it("captures profile load errors", async () => {
    profilesApi.list.mockRejectedValue(new Error("boom"));
    const store = useModelsStore();
    await store.loadProfiles();
    expect(store.error).toBe("boom");
  });

  it("creates a profile and reloads", async () => {
    profilesApi.create.mockResolvedValue(makeProfile("p2"));
    profilesApi.list.mockResolvedValue([makeProfile("p2")]);
    const store = useModelsStore();
    await store.createProfile({ provider: "openai", presetName: "P2", modelId: "gpt-4o", apiKey: "k" });
    expect(profilesApi.create).toHaveBeenCalledOnce();
    expect(store.profiles[0]?.id).toBe("p2");
  });

  it("updates and deletes a profile with reload", async () => {
    profilesApi.update.mockResolvedValue(makeProfile("p1"));
    profilesApi.remove.mockResolvedValue(true);
    const store = useModelsStore();
    await store.updateProfile({ profileId: "p1", presetName: "x" });
    expect(profilesApi.update).toHaveBeenCalledOnce();
    await store.deleteProfile("p1");
    expect(profilesApi.remove).toHaveBeenCalledWith("p1");
    expect(profilesApi.list).toHaveBeenCalledTimes(2);
  });

  it("loads instances for global + session and resolved", async () => {
    instancesApi.list.mockImplementation((scope: string) =>
      Promise.resolve(scope === "global" ? [makeInstance("narrator", "global")] : [makeInstance("narrator", "session")]),
    );
    instancesApi.listResolved.mockResolvedValue([{ slot: "narrator", source: "session_config" }]);
    profilesApi.runtime.mockResolvedValue([{ slot: "narrator", source: "session_profile", profileId: "p1" }]);
    const store = useModelsStore();
    await store.loadInstances("s1");
    expect(instancesApi.list).toHaveBeenCalledWith("global");
    expect(instancesApi.list).toHaveBeenCalledWith("session", "s1");
    expect(instancesApi.listResolved).toHaveBeenCalledWith("s1");
    // LI11：loadInstances 同时拉 profile binding 解析（runtime），供面板正确显示 Profile。
    expect(profilesApi.runtime).toHaveBeenCalledWith("s1");
    expect(store.instances).toHaveLength(2);
    expect(store.resolved).toHaveLength(1);
    expect(store.runtime).toHaveLength(1);
  });

  it("loads only global instances when no session is selected", async () => {
    instancesApi.list.mockResolvedValue([makeInstance("director", "global")]);
    const store = useModelsStore();
    await store.loadInstances();
    expect(instancesApi.list).toHaveBeenCalledTimes(1);
    expect(instancesApi.list).toHaveBeenCalledWith("global");
    expect(instancesApi.listResolved).toHaveBeenCalledWith(undefined);
  });

  it("finds an instance by slot and scope", async () => {
    instancesApi.list.mockImplementation((scope: string) =>
      Promise.resolve(scope === "global" ? [makeInstance("memory", "global")] : []),
    );
    const store = useModelsStore();
    await store.loadInstances();
    expect(store.findInstance("memory", "global")?.scope).toBe("global");
    expect(store.findInstance("memory", "session")).toBeNull();
  });

  it("upserts and removes an instance with reload", async () => {
    instancesApi.upsert.mockResolvedValue(makeInstance("narrator", "global"));
    instancesApi.remove.mockResolvedValue(true);
    const store = useModelsStore();
    await store.upsertInstance({ slot: "narrator", scope: "global", presetId: "p1" });
    expect(instancesApi.upsert).toHaveBeenCalledOnce();
    await store.removeInstance("narrator", "global");
    expect(instancesApi.remove).toHaveBeenCalledWith({ slot: "narrator", scope: "global", sessionId: undefined });
  });

  it("captures instance load errors", async () => {
    instancesApi.list.mockRejectedValue(new Error("netfail"));
    const store = useModelsStore();
    await store.loadInstances();
    expect(store.error).toBe("netfail");
    expect(store.loadingInstances).toBe(false);
  });

  it("binds a profile to a slot via profile binding and refreshes runtime (LI11)", async () => {
    profilesApi.runtime.mockResolvedValue([{ slot: "narrator", source: "session_profile", profileId: "p1" }]);
    const store = useModelsStore();
    await store.bindSlotProfile(
      { profileId: "p1", slot: "narrator", scope: "session", sessionId: "s1" },
      "s1",
    );
    expect(profilesApi.bindSlot).toHaveBeenCalledWith({
      profileId: "p1",
      slot: "narrator",
      scope: "session",
      sessionId: "s1",
    });
    expect(profilesApi.runtime).toHaveBeenCalledWith("s1");
    expect(store.runtime).toHaveLength(1);
  });

  it("unbinds a slot profile and refreshes runtime (LI11)", async () => {
    const store = useModelsStore();
    await store.unbindSlotProfile({ slot: "director", scope: "global" });
    expect(profilesApi.unbindSlot).toHaveBeenCalledWith({ slot: "director", scope: "global" });
    expect(profilesApi.runtime).toHaveBeenCalledWith(undefined);
  });
});
