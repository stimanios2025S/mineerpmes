import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Configuration ESLint a plat (format moderne).
 *
 * eslint-config-next 16 exporte directement des tableaux de configuration :
 * l'ancien adaptateur FlatCompat n'est plus necessaire.
 *
 * Deux regles sont ajustees a la realite de ce projet :
 *
 *  - `react/no-unescaped-entities` : l'interface est integralement en francais.
 *    Les apostrophes font partie de la langue, pas une faute de frappe. Exiger
 *    `&apos;` partout rendrait le code illisible sans rien proteger.
 *  - `react-hooks/purity` sur `Date.now()` : ces appels servent a comparer une
 *    date d'echeance a l'instant courant dans un composant serveur. La valeur
 *    n'alimente aucun etat client, donc aucun rendu instable n'est possible.
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "react/no-unescaped-entities": "off",
      "react-hooks/purity": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "src/generated/**",
    ],
  },
];

export default eslintConfig;
