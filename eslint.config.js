import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Pragmatic baseline:
// - Keep it lightweight (no type-aware rules; tsc already runs in CI).
// - Enforce React hooks rules (high signal).
// - Avoid noisy rules that would require large refactors right now.
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.cjs",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/e2e-reports/**",
      "**/tests/**",
      "**/server/tests/**",
      "**/test_results/**",
      "**/test-results/**",
      "**/artifacts/**",
      "**/uploads/**",
      "**/Downloads/**",
      "**/attached_assets/**",
      "**/.local/**",
      "**/sandbox_workspace/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...react.configs.recommended.rules,
      // Keep the classic Hooks rules (high signal). Newer react-hooks plugin versions
      // ship extra rules that are too noisy for this codebase right now.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // TS/React projects don't need prop-types.
      "react/prop-types": "off",
      // React 17+ JSX transform.
      "react/react-in-jsx-scope": "off",
      // Too noisy, low impact for this project.
      "react/display-name": "off",
      // Style-only for UI text; not worth gating CI on.
      "react/no-unescaped-entities": "off",
      "react/no-unknown-property": "off",
      "react/jsx-no-comment-textnodes": "off",

      // This repo has a lot of legacy patterns; keep lint pragmatic.
      "no-undef": "off", // TS already covers this.
      "no-case-declarations": "off",
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "no-misleading-character-class": "off",
      "no-regex-spaces": "off",
      "prefer-const": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-async-promise-executor": "off",
      "no-shadow-restricted-names": "off",

      // Reduce noise for a first pass.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/triple-slash-reference": "off",
    },
  }
  ,
  // Some server-side libraries use a `useX()` naming convention (e.g. Baileys)
  // that is unrelated to React hooks. Avoid false positives.
  {
    files: ["server/**/*.{js,ts}"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  }
);
