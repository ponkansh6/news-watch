import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),

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
