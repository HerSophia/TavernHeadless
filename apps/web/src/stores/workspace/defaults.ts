import type {
  SessionState,
  WorkspaceAsset
} from "./types";

export const DEFAULT_SESSIONS: SessionState[] = [
  {
    account: "studio-alpha",
    archived: false,
    characterName: "Seraphina v4",
    id: "8f3a-2b1c",
    title: {
      en: "The Crystal Palace",
      zh: "水晶宫"
    },
    userName: "Detective Rowan",
    deepBinding: false,
    presetId: "preset-cinematic-sse",
    presetVersionId: null,
    regexProfileId: null,
    regexProfileVersionId: null,
    worldbookProfileId: "wb-artifacts-core",
    worldbookVersionId: null,
    worldbookCount: 1
  },
  {
    account: "studio-alpha",
    archived: false,
    characterName: "Seraphina v4",
    id: "9aa1-440d",
    title: {
      en: "Brass Garden",
      zh: "黄铜花园"
    },
    userName: "Detective Rowan",
    deepBinding: false,
    presetId: "preset-tight-investigation",
    presetVersionId: null,
    regexProfileId: null,
    regexProfileVersionId: null,
    worldbookProfileId: "wb-urban-grid",
    worldbookVersionId: null,
    worldbookCount: 1
  },
  {
    account: "studio-alpha",
    archived: true,
    characterName: "Seraphina v4",
    id: "1c77-b03e",
    title: {
      en: "Deep Harbor Arcade",
      zh: "深港回廊"
    },
    userName: "Detective Rowan",
    deepBinding: false,
    presetId: null,
    presetVersionId: null,
    regexProfileId: null,
    regexProfileVersionId: null,
    worldbookProfileId: null,
    worldbookVersionId: null,
    worldbookCount: 0
  }
];

export const DEFAULT_ASSETS: WorkspaceAsset[] = [
  {
    account: "studio-alpha",
    favorite: true,
    id: "char-seraphina-v4",
    kind: "character",
    name: "Seraphina v4",
    summary: "Investigative tone with restrained noir narration and decisive follow-up cues.",
    tags: ["noir", "museum", "investigator"],
    updatedAt: Date.now() - 1000 * 60 * 18,
    uses: 17
  },
  {
    account: "studio-alpha",
    favorite: false,
    id: "wb-artifacts-core",
    kind: "worldbook",
    name: "artifacts-core",
    summary: "Canonical entries for relic behavior, incident logs, and preservation rules.",
    tags: ["lore", "priority-80", "safety"],
    updatedAt: Date.now() - 1000 * 60 * 42,
    uses: 31
  },
  {
    account: "studio-alpha",
    favorite: true,
    id: "user-detective-rowan",
    kind: "user",
    name: "Detective Rowan",
    summary: "Field detective profile with direct speech style and high-risk tolerance.",
    tags: ["snapshot", "field", "default"],
    updatedAt: Date.now() - 1000 * 60 * 8,
    uses: 24
  },
  {
    account: "studio-alpha",
    favorite: false,
    id: "preset-cinematic-sse",
    kind: "preset",
    name: "Cinematic SSE v2",
    summary: "Balanced temperature and anti-repetition penalties for narrative streaming outputs.",
    tags: ["preset", "sse", "balanced"],
    updatedAt: Date.now() - 1000 * 60 * 26,
    uses: 11
  },
  {
    account: "studio-alpha",
    favorite: false,
    id: "preset-tight-investigation",
    kind: "preset",
    name: "Tight Investigation",
    summary: "Low divergence profile for concise clue extraction and procedural continuity.",
    tags: ["preset", "focused", "tokens"],
    updatedAt: Date.now() - 1000 * 60 * 63,
    uses: 6
  },
  {
    account: "studio-beta",
    favorite: true,
    id: "char-midnight-operator",
    kind: "character",
    name: "Midnight Operator",
    summary: "Strategic operator persona tuned for covert mission planning and pacing.",
    tags: ["ops", "stealth", "planner"],
    updatedAt: Date.now() - 1000 * 60 * 33,
    uses: 13
  },
  {
    account: "studio-beta",
    favorite: false,
    id: "wb-urban-grid",
    kind: "worldbook",
    name: "urban-grid",
    summary: "District topology, transport timings, and surveillance blind spot annotations.",
    tags: ["lore", "city", "navigation"],
    updatedAt: Date.now() - 1000 * 60 * 90,
    uses: 19
  }
];
