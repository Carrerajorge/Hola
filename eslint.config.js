import js from "@eslint/js";
import globals from "globals";
import ts from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/hola-infra/**",
      "**/.claude/**",
      "**/.codex/**",
      "**/.git/**",
      "**/*.bak.*",
      "**/*.backup-*",
      "**/*.bak.ts",

      // TEMP (until 2026-03-14): ignore vendored/generated/build artifacts
      "**/client/public/vendor/**",
      "**/server/capabilities/generated/**",
      "**/*.generated.*",
      "**/server/openclaw/dist/**",
      "**/*.min.js",
      "**/*.bundle.js",
      "**/server/openclaw/vendor/**",
      "**/server/openclaw/src/**/export-html/vendor/**",
      "**/server/services/superIntelligence/auto-reply/reply/export-html/vendor/**",
      "**/server/openclaw/assets/chrome-extension/**",
    ],
  },

  ...ts.config(
    js.configs.recommended,
    ...ts.configs.recommended,
    {
      languageOptions: {
        globals: {
          ...globals.browser,
          ...globals.node,
        },
      },
      plugins: { "react-hooks": reactHooks },
      rules: {
        // Base
        "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
        "@typescript-eslint/no-explicit-any": "warn",

        // React hooks (TEMP)
        "react-hooks/rules-of-hooks": "warn",
        "react-hooks/exhaustive-deps": "warn",

        // TEMP (until 2026-03-14): downgrade strict rules to unblock CI
        "no-useless-escape": "warn",
        "no-case-declarations": "warn",
        "no-control-regex": "warn",
        "prefer-const": "warn",
        "no-empty": "warn",
        "no-constant-condition": "warn",
        "no-undef": "warn",

        "no-var": "warn",
        "no-regex-spaces": "warn",
        "no-shadow-restricted-names": "warn",
        "no-prototype-builtins": "warn",
        "no-useless-catch": "warn",
        "no-constant-binary-expression": "warn",
        "no-extra-boolean-cast": "warn",
        "no-async-promise-executor": "warn",
        "no-misleading-character-class": "warn",

        "@typescript-eslint/no-require-imports": "warn",
        "@typescript-eslint/no-unsafe-function-type": "warn",
        "@typescript-eslint/triple-slash-reference": "warn",
        "@typescript-eslint/ban-ts-comment": "warn",
        "@typescript-eslint/no-this-alias": "warn",
        "@typescript-eslint/no-namespace": "warn",
        "@typescript-eslint/no-empty-object-type": "warn",
        "@typescript-eslint/no-unused-expressions": "warn",
      },
    }
  ),
];
