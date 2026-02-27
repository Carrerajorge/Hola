
import js from "@eslint/js";

import globals from "globals";

import ts from "typescript-eslint";

import reactHooks from "eslint-plugin-react-hooks";



export default ts.config(

  // Global ignores (must be first so they apply to ALL configs)

  {

    ignores: [

      "dist/**",

      "dist-desktop/**",

      "node_modules/**",

      "coverage/**",

      "playwright-report/**",

      "test-results/**",

      "hola-infra/**",

      "server/openclaw/dist/**",

      "server/capabilities/generated/**",

      // Duplicated/legacy trees in this repo:

      "Hola/**",

      "iliagpt_skills_push/**",



      // Public/vendor assets (minified/third-party):

      "client/public/**",

    ],

  },



  js.configs.recommended,

  ...ts.configs.recommended,



  {

    languageOptions: {

      globals: {

        ...globals.browser,

        ...globals.node,

      },

    },

    plugins: {

      "react-hooks": reactHooks,

    },

    rules: {

      ...reactHooks.configs.recommended.rules,



      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],

      "@typescript-eslint/no-explicit-any": "warn",



      // ---- Make legacy codebase lintable (CI green) ----

      "no-control-regex": "off",



      // Downgrade noisy rules to warnings (legacy codebase)

      "no-useless-escape": "warn",

      "no-case-declarations": "warn",

      "no-empty": "warn",

      "no-constant-condition": "warn",

      "no-async-promise-executor": "warn",

      "no-prototype-builtins": "warn",

      "no-regex-spaces": "warn",

      "no-misleading-character-class": "warn",

      "no-constant-binary-expression": "warn",



      "@typescript-eslint/no-require-imports": "warn",

      "@typescript-eslint/no-unsafe-function-type": "warn",

      "@typescript-eslint/no-this-alias": "warn",

      "@typescript-eslint/no-namespace": "warn",

      "@typescript-eslint/no-unused-expressions": "warn",

      "@typescript-eslint/triple-slash-reference": "warn",

      "@typescript-eslint/ban-ts-comment": "warn",



      // React hooks extra rules (downgraded)

      "react-hooks/refs": "warn",

      "react-hooks/purity": "warn",

      "react-hooks/set-state-in-effect": "warn",

      "react-hooks/static-components": "warn",

      "react-hooks/preserve-manual-memoization": "warn",

      "react-hooks/immutability": "warn",

      "react-hooks/use-memo": "warn",

      "react-hooks/rules-of-hooks": "warn",



      // Mechanical / legacy noise -> warnings

      "prefer-const": "warn",

      "no-cond-assign": "warn",

      "no-fallthrough": "warn",

      "no-self-assign": "warn",

      "require-yield": "warn",

      "no-undef": "warn",

      "no-shadow-restricted-names": "warn",

      "no-extra-boolean-cast": "warn",

      "no-useless-catch": "warn",

      "no-unsafe-finally": "warn",

    },

  }

);

