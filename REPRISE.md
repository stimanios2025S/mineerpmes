# ERPMES — ADMEDCO / MOBILIX · Document de reprise

**Derniere mise a jour :** 17 octobre 2026
**Depot :** `c:\Users\stimanios\Documents\ERPMES`
**Branche de travail :** `codex/recette-production`
**Dernier commit :** `a6efd4a` — refactor(ui) : extraire le bloc repliable partage
**En production :** `ef72f5d` — les cinq chantiers de densite d'interface
**`main` :** `fec0ad5`, en avance de 2 commits (`ci(deploy)` uniquement, aucun conflit applicatif)

> Ce document est ecrit pour etre lu par une session qui reprend le projet sans
> historique. Tout ce qui y figure a ete verifie dans le depot, pas recopie d'un
> rapport precedent.

---

## 1. Le produit

Plateforme **ERP + MES** pour deux divisions industrielles complementaires :

| Division | Metier | Ateliers |
|---|---|---|
| **ADMEDCO** | Metallurgie : coupe, usinage, soudage, meulage, vissage, poudrage | A01, A02 (paralleles) → A03 |
| **MOBILIX** | Bois, couture, garnissage, tapissage | MBX-A01, MBX-A02 |

Le flux inter-divisions (chassis peints en fin de `POUDRAGE` → garnissage
MOBILIX) est **une regle encodee en base**, pas dans le code.

Couverture fonctionnelle : referentiel articles et tiers, stocks et lots,
production (OF, nomenclature, gammes, Kanban, sous-stocks), qualite, achats,
ventes, comptabilite, RH, tableaux de bord, portails par role, import CSV des
donnees reelles.

**Pile :** Next.js 16.3.6 (App Router, Turbopack) · React 19.3 · TypeScript 5.9 ·
Prisma 6.19 · PostgreSQL 17 · Tailwind 4 · Vitest 3.2

**Volumetrie :** 109 pages · 2 routes API · 84 modeles Prisma · 11 migrations ·
22 roles · 17 fichiers de tests / **218 tests**

---

## 2. Etat verifie

| Controle | Resultat |
|---|---|
| `npx tsc --noEmit` | 0 erreur |
| `npm run test` | **218 tests verts / 17 fichiers** |
| `npx eslint` (fichiers touches) | 0 erreur |
| `npx next build` | OK |
| Arbre de travail | propre |

⚠️ `ETAT-MISE-EN-SERVICE.md` est **perime sur les chiffres** (il annonce 169
tests / 11 fichiers). Ses points metier ouverts, eux, restent valables (§ 4.2).

---

## 3. Ce qui a ete livre

### 3.1 Densite d'interface — les cinq chantiers

Le fil conducteur : les ecrans les plus denses de la plateforme ouvraient sur la
totalite de leurs champs. Le principe applique est uniforme — **ce qui se
remplit a chaque visite reste visible, ce qui se remplit une fois passe derriere
un repli nomme.** Aucun champ, aucun bouton, aucune permission n'a ete supprime.

| # | Ecran | Fichier | Avant | Apres |
|---|---|---|---|---|
| 1 | Creation de tiers | `referentiel/tiers/nouveau/page.tsx` | 43 champs a plat | **7 visibles** + 36 sous « Informations complementaires (facultatif) » |
| 2 | Creation d'article | `referentiel/articles/nouveau/page.tsx` | 29 champs a plat | **12 visibles** + 17 sous « Reglages industriels, seuils et dimensions (facultatif) » |
| 3 | `/production` | `production/page.tsx` | formulaire de creation (21 champs) disputait la place a la liste | la page s'ouvre sur les ordres ; creation sous « Creer un ordre de fabrication » |
| 4 | `/production/[id]` | `production/[id]/page.tsx` | 9 blocs au meme niveau | 3 blocs de pilotage (identification, actions, operations) + 1 repli « Tracabilite — matieres, declarations, Kanban, qualite, transferts » |
| 5 | `/referentiel/articles/[id]` | `referentiel/articles/[id]/page.tsx` | 13 blocs au meme niveau | la fiche reste en haut ; modification, archivage et suivi sous « Administration de la fiche » |

**Note d'exactitude :** le rapport de la session precedente annoncait « 29 → 8
champs » pour la creation d'article. La mesure reelle du fichier donne
**29 → 12**. A reverifier a l'ecran avant de le repeter a un utilisateur.

### 3.2 Composant partage `SectionRepliable` — commit `a6efd4a`

Les six replis avaient ete ecrits en `<details>` bruts, avec six paddings
differents. Ils passent tous par un composant unique.

```tsx
import { SectionRepliable } from "@/components/ui";

<SectionRepliable
  titre="Administration de la fiche — modification, archivage, suivi"
  description="..."          // optionnel
  ouvertParDefaut={false}    // optionnel
  className="mt-5"           // optionnel : l'espacement reste au contexte d'appel
  id="administration"        // optionnel : ancre HTML
>
  ...contenu inchange...
</SectionRepliable>
```

- Socle visuel de `Carte` (`.carte repli` dans `globals.css`) : meme bordure,
  meme ombre, meme rayon.
- `<details>` / `<summary>` natif : accessible au clavier, fonctionnel sans
  JavaScript, chevron dessine en CSS.
- Le titre reste lisible quand le bloc est ferme.
- La regle d'usage est ecrite dans le commentaire du composant : **on replie ce
  qui se consulte rarement, jamais une information necessaire a l'action en
  cours.**

---

## 4. Ce qui reste

### 4.1 Composant repliable — suite

Le composant existe, les six appelants sont migres. Restent environ quinze
`<details>` dans l'application, a arbitrer un par un :

| Emplacement | Ce que c'est | Verdict probable |
|---|---|---|
| `layout.tsx` | sections du menu lateral (`.section-nav`) | **garder tel quel** : style dedie, deja documente |
| `portail/page.tsx` (5 blocs) | divulgation locale dans la vue operateur | **garder** : ce n'est pas du contenu de page rare, c'est le fil de l'etape en cours |
| `production/kanban`, `production/programme`, `production/declarations` | detail d'une ligne | **garder** : divulgation de ligne |
| `stock/lots`, `stock/mouvements`, `qualite/a-liberer` | detail d'une ligne | **garder** : idem |
| `nomenclature/[id]`, `nomenclature/gammes/[id]`, `nomenclature/ecarts` | blocs de page | **candidats** a `SectionRepliable` |
| `administration/roles`, `administration/roles/[code]`, `administration/audit` | blocs de page | **candidats** |
| `rh/affectations`, `rh/evaluations`, `qualite/plans`, `production/feuille-de-route/[id]` | blocs de page | **a evaluer** |

La distinction a tenir : **un repli de page** remet en bas une section entiere
(`SectionRepliable`) ; **un repli de ligne** ouvre le detail d'un element dans
une liste (reste en `<details>` local).

### 4.2 Pages encore denses, non traitees

Fichiers les plus gros de l'application, a evaluer un par un — meme methode :
identifier ce qui se pilote et ce qui se consulte.

| Fichier | Lignes |
|---|---|
| `production/[id]/page.tsx` | 1184 |
| `referentiel/articles/[id]/page.tsx` | 1129 |
| `portail/page.tsx` | 1123 |
| `nomenclature/[id]/page.tsx` | 899 |
| `rh/employes/[id]/page.tsx` | 796 |
| `production/programme/page.tsx` | 776 |
| `recherche/page.tsx` | 768 |
| `rh/evaluations/page.tsx` | 741 |

### 4.3 Points metier bloquants pour la mise en service

Repris de `ETAT-MISE-EN-SERVICE.md`, toujours ouverts. Aucun n'est un probleme de
code : ce sont des arbitrages metier, et **la consigne est de ne pas les trancher
seul**.

- **Tiers :** les codes `CL` / `FR` suggerent 0 = client, 1 = fournisseur — a
  confirmer avant activation. Ne pas convertir les fournisseurs en employes.
- **Personnel :** registre reel manquant (matricule, prenom, nom, usine). Ne pas
  fabriquer d'identites.
- **Nomenclatures :** deux ecarts `TB403010` (0,250000 contre 1,600000) a
  arbitrer.
- **Import :** 188 rejets de la derniere execution a examiner.
- **Production :** HTTPS, secrets definitifs, comptes nominatifs, sauvegardes
  **avec essai de restauration**, validation des parcours par role.
- **Indicateurs achats/ventes :** sens des colonnes de prix historiques a revoir.

### 4.4 Hygiene de depot

- `codex/recette-production` est a **22 commits devant `main`**, et `main` a 2
  commits d'avance (`ci(deploy)` sur `.github/workflows/deploy.yml` seulement).
  Un rebase puis un merge dans `main` est trivial et devrait etre fait avant que
  l'ecart ne grossisse.
- Branches a recycler : `codex/menu-sections-repliables`,
  `codex/employee-onboarding-release`, `codex/reservation-par-lot`.

---

## 5. Commandes de travail

```powershell
npm run typecheck        # tsc --noEmit
npm run test             # vitest run  -> attendu : 218 / 17 fichiers
npm run lint             # eslint
npm run build            # next build
npm run verify           # typecheck + test

npm run production:audit # lecture seule, ne modifie rien
```

**Deploiement** (recette utilisee lors de la derniere mise en ligne — a confirmer
avant reutilisation) :

```bash
ssh greendutyconfig "cd /opt/erpmes/releases/owner-isolation-20261007 \
  && git fetch origin --prune \
  && git reset --hard <sha> \
  && npm run build \
  && pm2 reload erpmes"
```

Controle apres deploiement : `GET /api/health` → 200, et `/connexion` servie.

---

## 6. Regles du depot — non negociables

1. **Lire la doc Next.js embarquee avant d'ecrire du code.**
   `node_modules/next/dist/docs/`. Cette version (16.3.6) differe des conventions
   connues. Ne pas toucher au bloc d'en-tete de `AGENTS.md` : `next dev` le
   reecrit.
2. **Interface entierement en francais (fr-FR).** Les commentaires, messages
   techniques et identifiants restent **sans accents** (contrainte des consoles
   Windows). Ce melange est volontaire — ne pas « corriger » les accents dans le
   code.
3. **Aucune donnee simulee.** Toute valeur affichee vient de PostgreSQL via
   Prisma.
4. **Aucune valeur de reference brute affichee** : passer par
   `libelle(LIBELLES_*, code)` de `@/lib/libelles`.
5. **Quantites et montants en `Prisma.Decimal`** (`D` de `@/lib/decimal`). Jamais
   de flottant sur un montant.
6. **Controle d'acces cote serveur.** Chaque page commence par
   `exigerPermission(...)` / `exigerAccesUsine(...)` de `@/lib/rbac/guard` ;
   chaque action serveur revalide les droits.
7. **Tout mouvement de stock passe par le grand livre** (`@/lib/stock/service`).
   Interdit d'ecrire `StockBalance` directement.
8. **Aucune suppression de donnee validee** : une annulation produit un mouvement
   ou une ecriture inverse.
9. **Ne jamais choisir silencieusement une quantite en cas de contradiction** —
   afficher, qualifier, laisser a l'arbitrage.
10. **Ne pas fabriquer de regle metier ou fiscale non confirmee.** Si une donnee
    manque, l'interface le dit.
11. **Composants partages a reutiliser, pas a dupliquer** : `@/components/ui`,
    `@/components/interactif`, `@/lib/actions/resultat`, `@/lib/liste`,
    `@/lib/format`. Contrat complet dans `SPEC-INTERFACE.md`.

---

## 7. Premier message a envoyer dans la nouvelle session

> Reprise du projet **ERPMES ADMEDCO / MOBILIX**
> (`c:\Users\stimanios\Documents\ERPMES`).
>
> Lis d'abord `CLAUDE.md`, `AGENTS.md`, `SPEC-INTERFACE.md` et `REPRISE.md`.
> Verifie l'etat : `git status`, `git log --oneline -5`, puis `npm run typecheck`
> et `npm run test` (attendu : 218 tests verts).
>
> Contexte : la branche `codex/recette-production` est au commit `a6efd4a`. Les
> cinq chantiers de densite d'interface sont termines, et le composant
> `SectionRepliable` est extrait ; les six replis passent par lui.
>
> La suite est au § 4.1 de `REPRISE.md` : migrer les blocs de page restants vers
> `SectionRepliable`, en laissant en `<details>` local ce qui n'est que le detail
> d'une ligne. Commence par me proposer un plan court, avant d'ecrire du code.
