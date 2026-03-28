import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import vue from "eslint-plugin-vue";

const sharedGlobals = {
  Buffer: "readonly",
  URL: "readonly",
  console: "readonly",
  document: "readonly",
  fetch: "readonly",
  localStorage: "readonly",
  module: "readonly",
  navigator: "readonly",
  process: "readonly",
  require: "readonly",
  setTimeout: "readonly",
  window: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.vitepress/cache/**",
      "**/.vitepress/dist/**",
      "**/*.d.ts",
      "apps/api/data/**",
      "packages/shared/src/generated/openapi-types.ts",
      "packages/shared/src/generated/.openapi-types.check.ts",
    ],
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      globals: sharedGlobals,
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx,cts,mts,vue}"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-control-regex": "off",
      "no-undef": "off",
      "prefer-const": "off",
      "vue/no-mutating-props": "off",
    },
  },
  prettierConfig,
);
