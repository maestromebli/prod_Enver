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
    files: [
      "server/**/*.js",
      "server/**/*.mjs",
      "scripts/**/*.mjs",
      "shared/**/*.js",
      "e2e/**/*.js"
    ],
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
    files: ["e2e/helpers/visual-audit.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    }
  },
  {
    files: ["desktop/**/*.js", "desktop/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    files: ["scripts/enver-b3d-assembly-export.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "script",
      globals: {
        ...globals.node,
        Model: "readonly",
        system: "readonly",
        AxisX: "readonly",
        AxisY: "readonly",
        AxisZ: "readonly",
        alert: "readonly",
        ENVER_AUTO_B3D_PATH: "writable",
        ENVER_AUTO_SILENT: "writable"
      }
    },
    rules: {
      "no-unused-vars": "off"
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
