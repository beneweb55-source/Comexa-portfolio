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
    // L'application desktop est un paquet Node autonome (CommonJS, API
    // Electron) : ses globals (`require`, `process`, `__dirname`) n'existent
    // pas dans le profil navigateur du front.
    "desktop/**",
  ]),
]);

export default eslintConfig;
