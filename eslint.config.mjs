// ESLint 9 flat config for the Izzi AI workspace.
//
// Provenance: ported from `feature/aibase-my-graph-ui-sync` (CMR-404) onto canonical
// v1.14.0-beta.3 as programme gate PQ-01. Canonical carried NO ESLint config at all, so
// `eslint` exited 2 before reading a file and every loop's "lint passes" acceptance
// criterion was unverifiable. See docs/architecture/source-of-truth-baseline.md BF-03/BF-04.
//
// Scope decision: this runs the *syntactic* typescript-eslint recommended set across the
// workspace source. Type-aware linting (`recommendedTypeChecked`) is deliberately not enabled
// yet — it needs per-project tsconfig wiring for 6 projects and would land hundreds of
// findings in one go. `tsc -p tsconfig.main.json` already provides type enforcement, so this
// config adds the checks tsc does *not* make (unused vars, unsafe patterns, empty blocks)
// without duplicating it.
//
// Rule posture: anything that indicates a real defect is an error; stylistic noise is off.
// Pre-existing debt is a counted warning, never a silenced one.

import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Build output, vendored copies, reference clones and scratch dirs are not our source.
    // Kept verbatim from the reviewed CMR-404 list: an ignore entry for a directory that does
    // not exist yet is inert, and it stops a stray scratch/reference dir from silently
    // inflating the warning ceiling later.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/release-*/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/vendor/**',
      '_izzi_openclaw_ref/**',
      '_izzi_setup/**',
      '_private_clone/**',
      '_to_delete/**',
      '.local-pkgs/**',
      'demos/**',
      'scratch/**',
      '**/.codegraph/**',
      '**/.gitnexus/**',
      '**/.codex*/**',
      '**/.claude/**',
      '**/.kiro/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Electron main process, backend services, packages, scripts: Node globals.
    files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // ── Errors: rules the workspace already satisfies, so they stay a hard gate ──
      // Empty catch blocks are used intentionally for fail-closed fallbacks.
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',

      // ── Warnings: real pre-existing debt, counted rather than hidden ──
      // Measured on THIS canonical checkout (v1.14.0-beta.3, clean tree, 284 files linted):
      //   306 no-explicit-any · 31 no-unused-vars · 7 react-hooks/exhaustive-deps
      //   ·  7 no-require-imports · 5 no-useless-escape · 2 unused eslint-disable directives
      //   = 358 warnings, 0 errors.
      // The number is 358, NOT the 359 recorded on the source branch: that branch measured a
      // different file set (it carried `wikilink.ts` and a 1.12.0 desktop tree). Re-measured
      // rather than copied — a ceiling inherited from another tree is not a gate, it is a guess.
      // The CEILING lives in `lint:ci`; a new warning fails CI. Local `lint` has no ceiling on
      // purpose: a developer tree carries untracked files, so a fixed total is not reproducible
      // locally.
      // Ratchet: fix a surface, lower the ceiling, then promote the rule to 'error' for that
      // surface. Do NOT silence findings by widening `ignores`.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],
      'no-useless-escape': 'warn',
      'prefer-const': ['warn', { destructuring: 'all' }],
      // Electron main legitimately uses dynamic/lazy `require()`: the extension host resolves a
      // module from a computed path, and `require('electron')` is deferred so the module is not
      // pulled in at import time. Flagged, not blocked; new code should prefer static imports.
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },

  {
    // Customer AI Marketing Room (CMR) — this surface is clean, so it keeps the strict gate.
    files: ['apps/desktop/src/main/customer-marketing/**/*.ts'],
    rules: {
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-useless-escape': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      // Scoped exemption, not a global one: these validators deliberately match ASCII control
      // characters (/[\u0000-\u001f\u007f]/) to strip them from untrusted strings before they
      // reach manifests, paths and workflow state. Everywhere else the rule stays on, so a
      // control character appearing in an unrelated regex is still flagged.
      'no-control-regex': 'off',
    },
  },

  {
    // Scoped `no-control-regex` exemptions, listed file by file so the rule keeps working
    // everywhere else: the shared Customer Marketing validators strip
    // /[\u0000-\u001f\u007f]/ from untrusted strings before they reach action gates and
    // capability manifests.
    //
    // NOTE for Loop 04: the CMR-404 original also exempted
    // `apps/desktop/src/shared/wikilink.ts`, which uses \u0000 as a sentinel to fence off code
    // blocks. That file does NOT exist on canonical v1.14.0-beta.3 — it is an unlanded draft
    // (see docs/handoffs/personal-office/quarantine/loop-02-dirty-salvage.json → vaultAndWiki).
    // The entry is deliberately NOT pre-registered here, because config must not assert
    // anything about a file the tree does not contain. When Loop 04 lands wikilink.ts it must
    // request a W0 lease on this file and re-add the exemption. Gate: PQ-01-FOLLOWUP.
    files: [
      'apps/desktop/src/shared/customer-marketing-action-gate-types.ts',
      'apps/desktop/src/shared/customer-marketing-capability-manifest.ts',
    ],
    rules: {
      'no-control-regex': 'off',
    },
  },

  {
    // Build and packaging scripts are CommonJS by design.
    files: ['**/*.cjs', '**/scripts/**/*.{js,mjs,cjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  {
    // Renderer: browser globals plus the React hooks rules (the renderer already carries
    // `eslint-disable react-hooks/*` comments, which need the plugin to be registered).
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    // Extension host bundles and generated extension clients run in their own sandbox.
    files: ['extensions/**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    // Tests: vitest globals are injected by the runner.
    files: ['**/*.{test,spec}.{ts,tsx}', '**/*.smoke.test.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
