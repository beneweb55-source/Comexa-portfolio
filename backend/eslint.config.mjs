// Config ESLint plate du backend (ESLint 10).
//
// Sans ce fichier, ESLint remonte jusqu'a la config Next.js du depot racine,
// et Node resout `eslint` par rapport a l'emplacement du fichier de config
// (la racine, ou node_modules est absent) : `npm run lint` echouait en
// ERR_MODULE_NOT_FOUND. Ce fichier ancre la resolution dans backend/.
//
// Trois pieges de forme, tous mesures et non devines :
//
//  1. Les commentaires d'en-tete sont en `//`, jamais en bloc. Le glob du
//     script `lint` contient la sequence `*/`, qui ferme un commentaire de
//     bloc au milieu. C'est ce bug qui a rendu la premiere version invalide.
//
//  2. `configs['flat/base']` est un OBJET, mais `configs['flat/recommended']`
//     est un TABLEAU de 3 entrees. Ce dernier doit donc etre deploye (`...`).
//     Pose comme element unique, il forme un tableau imbrique et ESLint
//     refuse la config entiere : « TypeError: Unexpected array ».
//
//  3. Le depot nomme `_` tout parametre volontairement inutilise. Ce n'est
//     pas du code mort : signature d'interface (pilotes de stockage) ou
//     validation par le DTO (parametre decore `@Query()`). La regle est donc
//     configuree pour respecter cette convention — voir le bloc `rules`.
//
// Rien n'est affaibli ici : la seule regle ajustee reste en `error` et
// continue de signaler tout local inutilise qui ne porte pas le prefixe.

import tseslint from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier/flat';

const eslintConfig = [
  {
    ignores: [
      'dist/**',
      '.e2e-build/**',
      'node_modules/**',
      'coverage/**',
      'storage/**',
      // Client Prisma genere : artefact derive, regenere par `prisma generate`.
      'src/generated/**',
    ],
  },
  // `flat/recommended` contient deja l'installation de `flat/base` en tete.
  ...tseslint.configs['flat/recommended'],
  prettierConfig,
  {
    plugins: { prettier: prettierPlugin },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          // Idiome d'omission : `const { x: _x, ...rest } = obj`.
          ignoreRestSiblings: true,
        },
      ],
    },
  },
];

export default eslintConfig;
