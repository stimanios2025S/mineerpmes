# Etat de mise en service - 5 octobre 2026

## Travail repris et termine

- Reservation et calcul des besoins : main d'oeuvre identifiee par `isLabor`,
  `isMainOeuvre` ou `MAIN_OEUVRE`, jamais par le prefixe MD.
- MDF11244 reste une matiere premiere et figure dans les besoins.
- `npm run production:audit` : lecture seule. `demo:purge` reste un alias
  en lecture seule ; `--executer` est refuse avant toute connexion a la base.

## Ce qui reste a confirmer

Un build et des tests verts ne suffisent pas a certifier la mise en production.

- Tiers : les codes CL/FR suggerent 0 = client et 1 = fournisseur, mais une
  validation metier doit confirmer ces significations avant activation.
  Ne pas convertir les fournisseurs en employes.
- Personnel : fournir un registre reel (matricule, prenom, nom, usine). Les
  sources disponibles ne permettent pas de fabriquer les identites manquantes.
- Nomenclatures : deux ecarts TB403010 (0,250000 contre 1,600000) a arbitrer.
  Ne pas remplacer une quantite ou additionner les lignes sans decision metier.
- Import : les 188 rejets de la derniere execution restent a examiner.
- Production : configurer HTTPS, secrets definitifs, comptes nominatifs,
  sauvegardes avec essai de restauration et valider les parcours par role.
- Indicateurs d'achat/vente : revoir le sens des colonnes de prix historiques.

## Resultats verifies pendant cette reprise

- TypeScript : aucune erreur.
- Suite complete : 169 tests passes, 11 fichiers.
- ESLint : aucune erreur, 52 avertissements encore presents.
- Build de production : compilation et generation reussies.
- Audit applicatif : 9 comptes actifs, 0 employe actif, 0 ordre,
  0 affectation, 712 articles, 307 tiers, 704 lots,
  7 correspondances non confirmees et 2 ecarts de nomenclature ouverts.
- Aucune suppression ni modification de la base applicative dans cette reprise.

## Verification

Les tests automatises se lancent sur erpmes_test, pas sur la base applicative.

```powershell
npm run production:audit
npm run verify
npm run lint
npm run build
```

Les anciens rapports et chiffres restent historiques. Cet etat ne declare pas
la plateforme prete tant que les points ci-dessus restent ouverts.
