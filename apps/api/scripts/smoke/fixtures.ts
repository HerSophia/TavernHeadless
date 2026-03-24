export const MINIMAL_PRESET = {
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "You are a helpful assistant.",
    },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [{ identifier: "main", enabled: true }],
    },
  ],
  temperature: 0.8,
  openai_max_context: 8000,
  openai_max_tokens: 500,
};

export const MINIMAL_WORLDBOOK = {
  name: "Smoke World",
  entries: {
    "0": {
      uid: 0,
      key: ["dragon"],
      content: "Dragons are powerful creatures.",
      position: 0,
      constant: false,
      selective: false,
    },
  },
};

export const MINIMAL_REGEX_SCRIPTS = [
  {
    id: "regex-1",
    scriptName: "Smoke Regex",
    findRegex: "hello",
    replaceString: "world",
    placement: [1, 2],
    disabled: false,
  },
];

export const MINIMAL_CHARACTER_CARD = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Smoke Character",
    description: "A minimal character card for smoke testing.",
    personality: "Reliable and concise.",
    scenario: "A test scene with deterministic behavior.",
    first_mes: "Hello from smoke character.",
    mes_example: "<START>\nSmoke Character: Testing in progress.",
  },
};
