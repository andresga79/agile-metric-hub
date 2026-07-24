import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Baseline lint config (flat). Intentionally lenient: this is the first lint
// setup for a codebase that predates it, so noisy-but-not-dangerous rules are
// downgraded to "warn" (they don't fail `pnpm lint` / CI) rather than forcing a
// big cleanup up front. Tighten over time. Uses the non-type-checked preset for
// speed and to avoid wiring per-package tsconfig project references.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      // Generated API clients — owned by orval, not hand-edited.
      "lib/api-client-react/src/generated/**",
      "lib/api-zod/src/generated/**",
      // Dead/vestigial sandbox app (not in the workspace; see MEJORAS-PROPUESTAS DEU-4).
      "artifacts/mockup-sandbox/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Monorepo spans Node (api-server, scripts) and browser (dashboard) code;
    // declare both global sets so no-undef doesn't fire on process/console/window/etc.
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Surfaced but non-blocking — the codebase has ~45 `any` and unused-var
      // noise today; keep them visible without failing the build.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Minor style issues in pre-existing code — visible as warnings, not blockers.
      "prefer-const": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // `for (;;)` polling loops are used deliberately (e.g. Jira pagination).
      "no-constant-condition": ["error", { checkLoops: false }],
      // Non-breaking spaces are legitimate inside UI text / templates (Spanish copy).
      "no-irregular-whitespace": [
        "error",
        { skipStrings: true, skipTemplates: true, skipJSXText: true, skipComments: true },
      ],
    },
  }
);
