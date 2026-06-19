import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module"
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-constant-condition": ["error", { checkLoops: false }],
      eqeqeq: ["error", "smart"]
    }
  },
  {
    files: ["server/**/*.js", "server/**/*.mjs", "scripts/**/*.mjs", "agent/**/*.js"],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    files: ["client/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.serviceworker }
    }
  },
  {
    files: ["desktop/**/*.js", "desktop/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    ignores: [
      "node_modules/**",
      "**/node_modules/**",
      "client/dist/**",
      "server/data/**",
      "releases/**",
      "package-lock.json"
    ]
  }
];
