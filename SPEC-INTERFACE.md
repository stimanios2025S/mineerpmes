# Specification d'interface — ERP MES ADMEDCO / MOBILIX

Document de travail interne decrivant les conventions **obligatoires** de
l'interface. Toute page, action serveur ou API doit s'y conformer.

## 1. Regles absolues

1. **Aucune donnee simulee.** Toute valeur affichee provient de la base
   PostgreSQL via Prisma. Aucun tableau rempli en dur, aucun bouton factice,
   aucun stock calcule dans le navigateur.
2. **Tout est en francais (fr-FR)** : menus, titres, colonnes, boutons, aides,
   messages d'erreur, notifications. Les identifiants techniques (noms de
   fichiers, fonctions, variables) restent en anglais ou en francais sans
   accents, jamais affiches a l'utilisateur.
3. **Aucune valeur de reference brute affichee.** Un statut, un type, un motif
   s'affiche via `libelle(LIBELLES_*, code)` de `@/lib/libelles`.
4. **Les quantites et montants sont des `Prisma.Decimal`** (`@/lib/decimal`,
   alias `D`). Jamais de calcul flottant sur un montant.
5. **Les listes sont bornees** : pagination serveur systematique (25 lignes par
   defaut), filtres et tri cote base.
6. **Le controle d'acces est serveur.** Chaque page commence par
   `exigerPermission(...)` / `exigerAccesUsine(...)` / `exigerAuMoinsUnePermission(...)`
   de `@/lib/rbac/guard`. Chaque action serveur revalide les droits.
7. **Toute modification de stock passe par le grand livre** :
   `enregistrerMouvement`, `transfererStock`, `changerStatutStock`,
   `reserverStock`, `annulerMouvement`, `enregistrerInventaire` de
   `@/lib/stock/service`. Il est interdit d'ecrire `StockBalance` directement.
8. **Aucune suppression de donnee validee.** Une annulation produit un mouvement
   ou une ecriture inverse, jamais un `delete`.
9. **Ne jamais choisir silencieusement une quantite en cas de contradiction.**
   Une divergence est affichee, qualifiee et laissee a l'arbitrage.
10. **Ne pas fabriquer de regle metier ou fiscale non confirmee.** Si une donnee
    manque (taux, compte, cout), l'interface l'indique explicitement.

## 2. Composants partages — ne pas les dupliquer

- Affichage serveur : `@/components/ui` — `Etiquette`, `EtiquetteStatut`,
  `Carte`, `EnTetePage`, `Statistique`, `Alerte`, `Vide`, `Tableau`,
  `Pagination`, `ListeDefinitions`, `Section`.
- Interaction client : `@/components/interactif` — `FormulaireAction`,
  `BoutonAction`, `FormulaireMotif`, `Champ`, `BoutonSoumettre`.
- Contrat d'action : `@/lib/actions/resultat` — `ResultatAction`, `succes`,
  `echec`, `executer`, `texteOuNull`, `texteObligatoire`, `entierOu`,
  `decimalOuNull`, `decimalObligatoire`, `dateOuNull`, `booleen`.
- Listes : `@/lib/liste` — `lireParametresListe`, `pagination`,
  `construireLien`, `fabricantLien`, `premiereValeur`, `identifiantOuNull`,
  `modeInsensible`.
- Mise en forme : `@/lib/format` — `formatDate`, `formatDateTime`,
  `formatHeure`, `toInputDate`, `formatQuantite`, `formatEntier`,
  `formatMontant`, `formatPourcentage`, `formatDuree`, `DEVISE_PAR_DEFAUT`.
- Libelles : `@/lib/libelles`.
- Erreurs metier : `@/lib/errors` — `validation`, `nonTrouve`, `conflit`,
  `etatInvalide`, `accesRefuse`, `stockInsuffisant`.
- Navigation : `@/components/navigation` (deja complete, **ne pas modifier** :
  les chemins de vos pages y sont deja declares).

**Ne jamais modifier** : `src/components/ui.tsx`,
`src/components/interactif.tsx`, `src/components/navigation.ts`,
`src/lib/libelles.ts`, `src/lib/format.ts`, `src/lib/liste.ts`,
`src/lib/actions/resultat.ts`, `src/lib/rbac/*`, `src/lib/auth/*`,
`src/app/globals.css`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`,
`prisma/schema.prisma`, ni les fichiers d'un autre module.

## 3. Structure d'une page de liste

```tsx
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { lireParametresListe, pagination, fabricantLien } from "@/lib/liste";
import { EnTetePage, Carte, Tableau, Pagination, EtiquetteStatut } from "@/components/ui";

export const metadata = { title: "..." };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.XXX_LIRE);
  const parametres = await searchParams;
  const liste = lireParametresListe(parametres, ["statut"]);
  // ... requetes Prisma bornees par la portee : filtreUsine(utilisateur)
  return (
    <>
      <EnTetePage titre="..." description="..." actions={...} />
      <Carte titre="..." sansPadding>
        <Tableau colonnes={...} lignes={...} />
        <Pagination page={...} pages={...} total={...} construireLien={fabricantLien("/chemin", {...})} />
      </Carte>
    </>
  );
}
```

Les filtres sont de simples `<form method="get">` comportant des `<select name="statut">`
et un bouton « Filtrer » : aucun JavaScript n'est necessaire.

## 4. Structure d'une action serveur

Un fichier par module : `src/actions/<module>.ts`, en tete `"use server";`.

```ts
export async function actionCreerX(formData: FormData): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.X_CREER);
  return executer("Message de succes en francais.", async () => {
    const resultat = await creerX({
      // ... champs lus avec les aides de @/lib/actions/resultat
      acteur: { id: acteur.id, email: acteur.email },
    });
    revalidatePath("/chemin");
    return { id: resultat.id };
  });
}
```

- Le message d'erreur vient du `DomainError` francais : ne jamais le reformuler.
- Ne jamais attraper une erreur pour la masquer.
- Toute action sensible (correction, annulation, contrepassation, liberation,
  arbitrage) exige un motif ecrit et le verifie cote serveur.

## 5. Contraintes de qualite

- `npx tsc --noEmit` doit passer **sans aucune erreur** avant de rendre le travail.
- Ne pas lancer `npm run dev`, ne pas lancer de migration, ne pas modifier la base.
- Commentaires de code en francais, expliquant le *pourquoi* metier.
- Aucun `any`, aucun `@ts-ignore`.
- Les pages de detail utilisent `params: Promise<{ id: string }>` et
  `identifiantOuNull` de `@/lib/liste`.
