import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import nextUseClientBoundary from "@sbougerel/eslint-plugin-next-use-client-boundary";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),

  // ── Type-aware linting (required by props-must-be-serializable) ──
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── Serializable props enforcement for "use client" components ──
  nextUseClientBoundary.configs.recommended,

  // ── Magic number detection: business logic only ──
  // NOTE: @typescript-eslint plugin is already loaded by eslint-config-next/typescript,
  // so we don't register it here — just use the rule directly.
  {
    files: ["src/lib/**/*.ts"],
    rules: {
      "@typescript-eslint/no-magic-numbers": [
        "warn",
        {
          ignore: [0, 1, -1, 2],
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreDefaultValues: true,
          ignoreTypeIndexes: true,
        },
      ],
    },
  },
]);

export default eslintConfig;
