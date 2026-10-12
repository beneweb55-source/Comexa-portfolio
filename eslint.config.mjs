import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Le backend a son propre ESLint (`npm run lint` dans backend/) :
    // front et back n'ont ni le même parser ni les mêmes règles.
    "backend/**",
  ]),
]);

export default eslintConfig;
