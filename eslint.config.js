import js from "@eslint/js";
import globals from "globals";
import ts from "typescript-eslint";

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-control-regex": "off",
      "no-empty": "off",
      "no-useless-escape": "off",
      "no-case-declarations": "off",
      "no-shadow-restricted-names": "off",
      "prefer-const": "off",
      "no-prototype-builtins": "off",
      "@typescript-eslint/triple-slash-reference": "off",
      "no-regex-spaces": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
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
      "Hola/**",
      "Hola_wt_*/**",
      "artifacts/**",
      "sandbox_workspace/**",
      "external/agent_ecosystem/**",
      "**/*.bak.*",
      "client/public/vendor/**",
      "**/*.bak.ts",
      "shared/schema.bak.ts",
    ],
  },
);
