# Brief plateforme — état des lieux et portail atelier

> Etat courant : voir `ETAT-MISE-EN-SERVICE.md`. Ce document conserve des chiffres et conclusions historiques ; il ne certifie pas une mise en production.

**Destinataire** : un tiers (développeur, architecte ou assistant) qui n'a jamais
vu ce projet et doit proposer des modifications.

**Nature du document** : état des lieux factuel. Il ne prescrit rien. Les
changements à apporter sont décidés par le propriétaire de la plateforme.

**Date** : 28 septembre 2026.

**Niveau de confiance** : tout ce qui concerne le code, les modèles, les rôles et
les permissions a été vérifié par lecture directe des sources. Les chiffres de
contenu en base proviennent des comptes rendus d'exécution des scripts d'import
et de seed. Aucune requête SQL n'a pu être exécutée lors de la rédaction.

---

## 1. Le projet

Plateforme **ERP + MES** pour un industriel algérien à deux divisions :

- **ADMEDCO** — métallique : coupe, usinage, soudage, meulage, vissage, poudrage.
  Dépôt `DEP-MP`.
- **MOBILIX** — bois, couture, garnissage. Dépôt `DEP-MP-MBX`.

Les deux divisions partagent un flux : des châssis peints par ADMEDCO entrent
chez MOBILIX pour le garnissage. Une règle de transfert inter-ateliers encodée
en base porte ce flux.

**Pile technique**

| Élément | Version |
|---|---|
| Next.js (App Router, Turbopack) | 16.3.6 |
| React | 19.3.0 |
| TypeScript | 5.9.3 |
| Prisma | 6.19.0 |
| PostgreSQL 17 | conteneur Docker `erpmes-postgres`, port **5433** |
| Tailwind CSS | 4 |
| Tests / exécution de scripts | Vitest, tsx |

**Ampleur** : 83 modèles Prisma, 108 pages, 99 permissions, 25 rôles,
12 modules, 4 migrations.

Interface entièrement en français. Le code, les commentaires et les messages de
console sont en français sans accents (contrainte des consoles Windows).

---

## 2. Les invariants à ne jamais enfreindre

Ces règles ne sont pas des préférences de style. Une modification qui les
enfreint sera refusée, même si elle « fonctionne ».

**1. Le cloisonnement est vérifié côté serveur, à quatre endroits.** Le menu est
filtré par permission — mais ce filtrage n'est qu'un confort. La même permission
est revérifiée dans la page, dans l'action serveur, dans l'API et dans la
requête. Formule du dépôt : *« masquer un menu ne protège rien »*. Corollaire
souvent oublié : **un bloc masqué en CSS laisse la donnée dans le HTML** ; on
rend conditionnellement, on ne cache pas.

**2. Aucun mot de passe en dur dans le dépôt.** Tout est dans `.env`, non
versionné. Le panneau d'accès rapide de la page de connexion est désactivé en
production **inconditionnellement**, par une fonction qui renvoie `false` si
`NODE_ENV === "production"` — c'est une garantie, pas un réglage. Les mots de
passe ne transitent jamais par le navigateur : seul l'email est envoyé, le
serveur résout le mot de passe.

**3. Un compte par personne, jamais de compte partagé.** Aucun script n'invente
de donnée RH : une fiche employé doit exister avant qu'un compte puisse y être
rattaché.

**4. Rien n'est deviné à la place de l'administrateur.** Quand une donnée source
n'est pas interprétable sans ambiguïté, l'import applique un repli documenté,
**le signale en avertissement** (« Correspondance a confirmer ») et laisse
l'administrateur trancher. Il ne choisit jamais silencieusement.

**5. Les migrations de données existantes sont additives.** Les colonnes
ajoutées sont nullables ; aucune donnée existante n'est transformée.

**6. Les rôles sont définis dans le code.** `src/lib/rbac/roles.ts` est la
source de vérité. La base ne fait que refléter : `npm run db:seed` **ajoute** les
liaisons manquantes **et retire** les obsolètes. Modifier `roles.ts` sans
relancer le seed ne change rien — c'est le piège numéro un de ce dépôt.

---

## 3. Le modèle d'accès

- **99 permissions** fines, réparties en 12 modules : Système (10), Référentiel
  (11), Nomenclature (5), Stocks (9), Production (9), Qualité (6), Achats (7),
  Ventes (7), Finance (10), Ressources humaines (11), Portail (1), Rapports et
  pilotage (6).
- **3 permissions de portée** : `PORTEE_TOUTES_USINES`, `PORTEE_ADMEDCO`,
  `PORTEE_MOBILIX`.
- **25 rôles**, chacun avec une portée d'usine par défaut (`ADMEDCO`, `MOBILIX`
  ou `COMMUN`).

Le cloisonnement s'exerce à quatre niveaux : par permission, par usine (un rôle
`ADMEDCO` ne voit jamais une donnée `MOBILIX`, même en tapant l'URL), par
atelier, et par personne.

**Chaque rôle a sa propre page d'accueil** — il n'existe pas d'écran commun.
La correspondance est déclarée dans `ACCUEIL_PAR_ROLE`
(`src/components/navigation.ts`). Le tableau de bord lui-même rend ses blocs
conditionnellement : ses 7 sections et ses 5 cartes d'alerte n'existent dans le
HTML que pour qui détient la lecture correspondante.

**Fichiers clés**

| Rôle | Fichier |
|---|---|
| Définition des rôles et de leurs permissions | `src/lib/rbac/roles.ts` |
| Catalogue des permissions | `src/lib/rbac/permissions.ts` |
| Garde serveur (`exigerPermission`, `filtreUsine`, …) | `src/lib/rbac/guard.ts` |
| Navigation et filtrage | `src/components/navigation.ts` |
| Session (rôles, permissions, portée, `employeeId`) | `src/lib/auth/session.ts` |
| Matérialisation des rôles en base | `prisma/seed.ts` → `semerRoles()` |

---

## 4. Les deux rôles d'atelier

Deux rôles seulement ouvrent le portail employé :

| Code | Libellé | Portée | Page d'accueil |
|---|---|---|---|
| `OPERATEUR_ADMEDCO` | Opérateur ADMEDCO | ADMEDCO | `/portail` |
| `OPERATEUR_MOBILIX` | Opérateur MOBILIX | MOBILIX | `/portail` |

**Permissions, identiques pour les deux** (12 + 1 portée) :

```
PORTAIL_EMPLOYE            accès au portail
PRODUCTION_LIRE            voir les ordres de fabrication
PRODUCTION_DECLARER        déclarer une quantité produite
PRODUCTION_KANBAN_DEPLACER déplacer une carte dans le kanban
STOCK_LIRE                 voir l'état des stocks
STOCK_MOUVEMENT_CREER      créer un mouvement de stock
QUALITE_LIRE               voir les contrôles
QUALITE_CONTROLER          enregistrer un contrôle
ARTICLE_LIRE               consulter les articles
DEPOT_LIRE                 consulter les dépôts
NOMENCLATURE_LIRE          consulter les nomenclatures
RH_AFFECTATION_LIRE        voir ses affectations
PORTEE_ADMEDCO / PORTEE_MOBILIX
```

**Sections de menu ouvertes à un opérateur**

| Section | Sous-écrans |
|---|---|
| Mon espace | Portail employé |
| Référentiel | Articles, Dépôts |
| Nomenclature et gammes | Nomenclatures |
| Stocks | État des stocks, Mouvements de stock |
| Production | Ordres de fabrication, Kanban atelier |
| Qualité | Contrôles qualité, Non-conformités |
| Ressources humaines | Affectations quotidiennes |

**Ce qu'un opérateur ne voit pas du tout** : tableau de bord et pilotage, gammes
de fabrication, tarifs et prix, transferts inter-ateliers, inventaire physique,
lots, déclarations à valider, articles à libérer, achats, ventes, finance et
comptabilité, employés, présences, évaluations, compétences, administration.

---

## 5. Le portail employé (`/portail`)

Écran simplifié, conçu pour être utilisé **au poste, dans l'atelier** — donc sur
un écran tactile, par une personne debout, avec des gants.

### Les actions

1. **Démarrer** — commence une opération affectée.
2. **Mettre en pause**
3. **Reprendre**
4. **Déclarer une quantité** — production réalisée.
5. **Déclarer une perte** — rebut, casse, chute.
6. **Signaler un problème**
7. **Terminer** — clôt l'opération.
8. **Clôturer l'ordre** — quand toutes ses opérations sont terminées.

### Ce que le portail affiche

Mes affectations du jour · mes opérations · mes déclarations · mon temps du mois
· mes évaluations · mon pointage du jour.

### Les trois garanties que la page tient

Elles sont écrites dans l'en-tête du fichier (`src/app/(app)/portail/page.tsx`)
et méritent d'être citées telles quelles :

1. **Cloisonnement** : toutes les requêtes sont bornées sur
   `utilisateur.employeeId`. Aucun identifiant d'employé n'est lu dans un
   formulaire, et les actions serveur refusent toute opération qui n'est pas
   réellement affectée à l'employé connecté.
2. **Aucune donnée salariale** : les colonnes de rémunération ne sont même pas
   sélectionnées, quelle que soit la permission du compte.
3. **Aucune modification libre du stock** : la déclaration de perte est
   enregistrée **sans sortie de stock**. C'est un signalement, pas un mouvement.
   La régularisation est un acte distinct, réservé au magasin.

### Point de conception à ne pas contourner

**Déclarer une perte ne bouge pas le stock.** C'est délibéré. Un opérateur
signale ; il ne corrige pas l'inventaire. Toute proposition qui ferait écrire un
mouvement de stock depuis le portail va à l'encontre de cette règle.

### Ce qu'un opérateur ne peut pas faire depuis le portail

Modifier une opération validée, toucher au stock, aux nomenclatures, aux coûts,
voir les salaires, ni consulter un autre atelier.

---

## 6. Ce qu'il faut pour qu'un opérateur travaille réellement

La chaîne est stricte. Chaque maillon manquant laisse le portail vide ou
inutilisable — sans jamais produire d'erreur, ce qui rend le diagnostic
contre-intuitif.

| # | Maillon | Modèle / écran | Sans lui |
|---|---|---|---|
| 1 | Fiche employé avec matricule et bonne usine | `Employee` — RH → Employés | Le portail répond *« Compte non rattaché à une fiche employé »* |
| 2 | Compte utilisateur rattaché à la fiche | `User.employeeId` | Idem |
| 3 | Affectation du jour sur une opération | `Assignment` — RH → Affectations quotidiennes | Le portail s'ouvre mais « Mes affectations du jour » est vide, et les 7 boutons n'ont rien sur quoi agir |
| 4 | Un ordre de fabrication, donc un article **fabriquable** | `Article.isProducible = true` | « Déclarer une production » est impossible |

**L'ordre compte pour les vraies fiches** : un compte ne peut pas être rattaché à
une fiche qui possède déjà un compte. Le script refuse explicitement. Donc :
**la fiche d'abord, le compte ensuite.**

---

## 7. État réel de la base aujourd'hui

**Comptes utilisateurs : 9, tous de bureau.**

Les 9 comptes de bureau sont les comptes de travail réels, tous sans fiche
employé (normal : les rôles de bureau n'en ont pas besoin) : administrateur
système, direction, responsable production, responsable stock, responsable
qualité, acheteur, commercial, comptable, responsable RH.

Les comptes et fiches d'atelier de test ont été retirés avec
`npm run demo:purge`.

**Fiches employés : aucune.** C'est le point le plus important de ce document.

Aucune fiche employé n'existe en base : les fiches repères de développement ont
été retirées. Les vraies fiches se créent soit par la 6e étape d'import (`npm run
import:csv`, tiers de nature « employé »), soit à la main dans Ressources humaines
→ Employés. Chaque fiche doit porter un matricule réel et la bonne usine
(ADMEDCO ou MOBILIX) avant d'être affectée en atelier.

**Référentiel importé** (depuis un ancien système, dossier `E:/Massiexporte`) :

| Donnée | Résultat |
|---|---|
| Tiers (clients, fournisseurs, personnes) | 307 créés, **tous de type `AUTRE`**, `isClient = false`, `isSupplier = false` |
| Articles | 706, **tous de type `COMPOSANT`** |
| Nomenclatures | 2 383 créées, 176 lignes rejetées |
| Lots et stocks | 704 créés, 2 lignes rejetées |
| Lignes rejetées au total | 188, chacune avec son motif exact dans Administration → Import |

**Pourquoi tous les tiers sont en `AUTRE`** : le fichier source porte un champ
`Type` à deux valeurs (`0` et `1`) dont la signification n'est pas documentée.
L'import a refusé de la deviner, a appliqué le repli `AUTRE` et a levé un
avertissement « Correspondance a confirmer ». La correspondance se règle dans
**Administration → Import** (`ImportValueMapping`, champ `isConfirmed`).

**Pourquoi tous les articles sont en `COMPOSANT`** : même mécanisme, même repli
documenté.

**Indicateurs commerciaux et industriels : déduits de la source.** Les champs
`isPurchasable`, `isSellable`, `isProducible` sont désormais renseignés par
l'import à partir des colonnes explicites du fichier : `IsRawMaterial` ou
`IsComposableOnly` rend l'article achetable, `IsBOM` le rend fabricable, et un
prix de vente (`LPP`, `MinSP`, `MaxSP`) le rend vendable. Aucune valeur n'est
devinnée : l'administrateur ajuste article par article si besoin. Sur le
référentiel importé, cela ouvre environ 350 articles achetables, 280 fabricables
et 420 vendables.

**Objets métier : aucun.** Zéro ordre de fabrication, zéro affectation, zéro
devis, zéro commande, zéro facture. Seuls le référentiel et les stocks existent.

**Un point d'arbitrage ouvert** : une contradiction de quantité sur le composant
`TB403010` (0,250000 contre 1,600000), au statut « Ouvert » dans
Nomenclature → Écarts. La plateforme ne corrige jamais ces contradictions
automatiquement ; elle demande un arbitrage humain.

**Dernier seed exécuté** (28/09/2026) :
`18 verifie(s), 2 liaison(s) ajoutee(s), 42 obsolete(s) retiree(s)`.
Les 42 liaisons retirées sont les lectures trop larges qu'un ancien socle commun
accordait à tous les rôles — c'est ce qui rendait tous les rôles identiques.

---

## 8. Ce qui vient d'être changé

Pour situer la base de départ de toute nouvelle proposition. Quatre fichiers
modifiés, plus une migration :

1. **`src/lib/rbac/roles.ts`** — réécrit. Un socle commun accordait à tout rôle
   lecteur les lectures stocks, production, qualité, rapports et configuration.
   Le socle est réduit au référentiel seul ; chaque métier demande désormais
   explicitement ses lectures.
2. **`prisma/seed.ts`** — `semerRoles()` ne faisait qu'ajouter des liaisons.
   Il retire maintenant les obsolètes, sinon resserrer un rôle n'aurait aucun
   effet en base.
3. **`src/components/navigation.ts`** — ajout de `ACCUEIL_PAR_ROLE` : chaque
   rôle ouvre sa propre page. Si la page cible n'est pas accessible, repli sur
   la première page réellement ouverte, pour qu'un changement de droits ne casse
   jamais la connexion.
4. **`src/app/(app)/tableau-de-bord/page.tsx`** — les 7 sections et les
   5 cartes d'alerte sont rendues conditionnellement.
5. **Migration `20260928103000_third_party_person_fields`** — ajoute `birthDate`
   et `gender` à `ThirdParty`, colonnes nullables. Le fichier source mélange
   personnes physiques et sociétés dans une seule table ; le modèle omettait ces
   deux colonnes, ce qui faisait échouer **toutes** les lignes de tiers
   (`Unknown argument birthDate`).

Typecheck (`npx tsc --noEmit`) : propre.

---

## 9. Les décisions en attente

Ces points sont ouverts. Ils appartiennent au propriétaire de la plateforme.

**a. Comment faire entrer les vrais employés ?**
Trois voies possibles, non exclusives :
1. Saisie à la main dans **RH → Employés** — aucun code, aucune donnée inventée.
   Convient à un effectif de quelques dizaines de personnes.
2. Écrire une **sixième étape d'import** lisant un fichier du personnel.
   L'import actuel compte cinq étapes : familles, articles, tiers,
   nomenclatures, lots. **Aucune ne crée de fiche employé** — c'est structurel,
   pas un oubli. À noter : le dossier source contient
   `COM_FormulaEmpoyees.csv`, mais ce fichier sert au **coût de main-d'œuvre des
   nomenclatures**, pas de registre du personnel. À confirmer avant d'en faire
   une source RH.
3. Corriger les deux fiches de test pour en faire les premières fiches réelles,
   puis continuer.

**b. Confirmer la correspondance du champ `Type` des tiers** (codes `0` et `1`)
dans Administration → Import, puis relancer l'import avec `--maj`. Sans cela,
aucun document commercial n'est créable.

**c. Ajuster, si besoin, les indicateurs `isPurchasable`, `isSellable`,
`isProducible`** — ils sont déjà déduits de la source à l'import ; corrigez-les
article par article si une règle ne convient pas.

**d. Trancher la contradiction de quantité `TB403010`.**

**e. Créer les fiches employés réelles** (import 6e étape ou saisie RH), puis rattacher chaque opérateur à son compte nominatif.

**f. Corriger, le cas échéant, les 188 lignes rejetées** — visible une par une,
avec son motif, dans Administration → Import.

---

## 10. Vocabulaire

À respecter pour que les demandes soient comprises sans ambiguïté.

| Terme | Sens dans cette plateforme |
|---|---|
| **Portail** | L'écran de l'opérateur, `/portail`, utilisé au poste |
| **Fiche employé** | Enregistrement `Employee`, identifié par un `matricule` unique |
| **Affectation** | `Assignment` — un employé, une opération, une journée |
| **Opération** | Étape d'une gamme (coupe, soudage, poudrage…) |
| **Gamme** | La suite d'opérations d'un article |
| **Nomenclature** | `BOM` — la liste des composants d'un article et leurs quantités |
| **Ordre de fabrication (OF)** | `WorkOrder` — un article à produire, en quantité, avec échéance |
| **Déclaration** | Ce que l'opérateur rapporte : quantité produite, ou perte |
| **Perte** | Rebut, casse, chute. **Ne bouge pas le stock** |
| **Lot** | `StockLot` — traçabilité. Un lot peut être en quarantaine |
| **Quarantaine** | Marchandise non disponible tant que la qualité n'a pas statué |
| **Dépôt** | Emplacement de stockage. `DEP-MP` (ADMEDCO), `DEP-MP-MBX` (MOBILIX) |
| **Article fabriquable** | Article dont `isProducible` est vrai — condition d'un OF |
| **Correspondance** | Règle de traduction d'un code source vers une valeur du modèle |

---

## 11. Commandes et fichiers de référence

```bash
# --- Démarrage ---
npm run dev                    # serveur sur http://localhost:3000
npm run build                  # build de production

# --- Base de données ---
npm run db:generate            # client Prisma (arrêter le serveur avant)
npm run db:deploy              # applique les migrations
npm run db:seed                # référentiel + rôles et permissions (idempotent)
npm run setup                  # generate + deploy + seed

# --- Comptes ---
npm run acces -- --liste
npm run acces -- --email=<adresse> --generer --roles=<ROLE> [--matricule=<matricule>]
npm run bootstrap:admin        # premier administrateur

# --- Import ---
npm run import:csv -- --dossier=E:/Massiexporte   # simulation, aucune écriture
npm run import:csv -- --executer                  # import réel
npm run import:csv -- --executer --maj            # import réel + mise à jour

# --- Vérification ---
npm run typecheck
npm test
```

**Prérequis de santé** : PostgreSQL démarré (`docker start erpmes-postgres`),
port 3000 libre, et **le serveur de développement arrêté avant `db:generate`**
— il verrouille la DLL du moteur Prisma sur Windows (`EPERM`).

**Fichiers structurants**

| Chemin | Contenu |
|---|---|
| `GUIDE-PLATEFORME.md` | Guide utilisateur complet, 12 sections |
| `src/lib/rbac/roles.ts` | Les 25 rôles et leurs permissions |
| `src/lib/rbac/permissions.ts` | Les 99 permissions et les 3 portées |
| `src/lib/rbac/guard.ts` | Garde serveur |
| `src/lib/auth/session.ts` | Contenu de la session (`SessionUser`) |
| `src/components/navigation.ts` | Menu, filtrage, page d'accueil par rôle |
| `src/app/(app)/portail/page.tsx` | Le portail employé |
| `src/app/(app)/tableau-de-bord/page.tsx` | Tableau de bord à blocs conditionnels |
| `src/lib/import/service.ts` | Les six importateurs (familles, articles, tiers, personnel, nomenclatures, lots) |
| `prisma/schema.prisma` | 83 modèles |
| `prisma/seed.ts` | Matérialisation des rôles et du référentiel |
| `scripts/acces-direct.ts` | Création de comptes en ligne de commande |
| `creer-comptes-bureau.cmd` | Les 9 comptes de bureau, un clic |
| `npm run demo:purge` | Retire les données de démonstration / de test |

---

## 12. Règles de rédaction d'une demande de changement

Utile si une demande doit être reformulée avant d'être exécutée.

**Une demande exploitable nomme au moins deux des quatre éléments suivants :**
le rôle ou la permission concernée, l'écran ou le fichier touché, le comportement
attendu, et ce qui doit rester inchangé.

**Toute demande touchant les droits doit préciser si `npm run db:seed` doit être
relancé.** Une modification de `roles.ts` sans seed n'a aucun effet visible, et
c'est la source d'erreur la plus fréquente sur ce dépôt.

**Toute demande touchant une donnée existante doit indiquer si les données déjà
en base doivent être reprises.** Les migrations sont additives par principe.

**Toute demande d'affichage conditionnel doit dire explicitement « ne pas
afficher » plutôt que « masquer ».** La nuance est structurante : masquer laisse
la donnée dans le HTML.

**Les chiffres de ce document ne sont pas des objectifs.** Par exemple,
« tous les tiers sont en `AUTRE` » est un constat, pas un bug à corriger
unilatéralement : c'est à l'administrateur de confirmer la correspondance.

---

## Annexe — Résumé en dix lignes

1. ERP + MES pour deux divisions, ADMEDCO (métal) et MOBILIX (bois et couture),
   reliées par un flux de châssis.
2. Le cloisonnement est vérifié côté serveur, à quatre niveaux. Masquer ne
   protège rien ; rendre conditionnellement, oui.
3. 99 permissions, 25 rôles, 3 portées d'usine. Les rôles sont définis dans le
   code et matérialisés par `npm run db:seed`, qui ajoute **et retire**.
4. Chaque rôle a sa propre page d'accueil. Il n'y a pas d'écran commun.
5. Deux rôles d'atelier seulement : `OPERATEUR_ADMEDCO` et `OPERATEUR_MOBILIX`,
   tous deux sur `/portail`, cloisonnés à leur usine et à leur propre fiche.
6. Le portail offre 7 actions plus la clôture d'ordre, sur un écran tactile.
   Il ne montre que les données de la personne connectée, jamais les salaires.
7. Déclarer une perte ne bouge pas le stock : c'est un signalement, pas un
   mouvement. Règle de conception, pas un manque.
8. Pour qu'un opérateur travaille : fiche employé → compte rattaché →
   affectation du jour → ordre de fabrication (donc article fabriquable).
9. **Aucune fiche employé n'existe** : le nettoyage des données de test les a
   retirées, et la 6e étape d'import les crée à partir des tiers de nature
   « employé ».
10. Bloquants restants : confirmer la correspondance du `Type` des tiers, et
    créer les vraies fiches employés. Les indicateurs commerciaux et industriels
    sont désormais déduits de la source à l'import.

> Mise a jour de securite : `demo:purge` est en lecture seule. `--executer` est refuse. Voir `ETAT-MISE-EN-SERVICE.md`.
