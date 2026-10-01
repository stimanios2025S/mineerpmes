# ERPMES — ADMEDCO / MOBILIX

## Rapport final de développement

Plateforme ERP + MES (gestion industrielle, stocks, production, qualité, achats,
ventes, comptabilité, RH) développée intégralement dans ce dossier, à partir
d'un dossier vide.

---

## 1. État de livraison

| Point | État |
|---|---|
| Application Full Stack (Next.js + React + TypeScript) | Terminée |
| Architecture frontend / backend / domaine / persistance / sécurité | Terminée |
| PostgreSQL + Prisma + migrations versionnées | Terminée (3 migrations) |
| Authentification, sessions, rôles et permissions | Terminée |
| Modèles métier (76 modèles Prisma) | Terminés |
| APIs, actions métier et validations | Terminées |
| Pages et interfaces en français | Terminées (~80 routes) |
| Mouvements de stock, production, ventes, achats, comptabilité | Terminés |
| Import des données réelles (9 fichiers CSV) | Terminé |
| Tests automatisés (154 tests, 9 fichiers) | **Écrits — non exécutés** (voir ci-dessous) |
| Vérification de typage TypeScript | **Réussie — 0 erreur** |
| Exécution de la suite de tests | **Bloquée : PostgreSQL/Docker non démarré** |

### Blocage à lever par l'utilisateur

La suite de tests d'intégration exige PostgreSQL (conteneur `erpmes-postgres`,
port 5433). Docker Desktop est installé
(`C:\Users\stimanios\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe`)
mais **n'est pas démarré** et son moteur n'est pas accessible :

```
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
```

Le démarrage de Docker Desktop a été refusé par le classifieur de permissions de
la session ; il doit être lancé manuellement. **Séquence de déblocage complète**,
dans cet ordre (chaque étape correspond à une erreur réellement observée) :

| Ordre | Commande | Erreur levée si l'étape est sautée |
|---|---|---|
| 1 | démarrer **Docker Desktop** et attendre « Engine running » | `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine` |
| 2 | `docker start erpmes-postgres` (si le conteneur n'existe pas, utiliser le `docker run` du §10) | `P1001: Can't reach database server at localhost:5433` |
| 3 | arrêter le serveur de développement qui occupe le port 3000 | `EPERM: operation not permitted, rename … query_engine-windows.dll.node` (le serveur tient la DLL du moteur Prisma) |
| 4 | `npm run setup` | aucune table : le référentiel n'est pas chargé |
| 5 | `npm run comptes -- --amorcer --domaine=admedco.dz` | aucun compte : impossible de se connecter |
| 6 | `npm run dev` puis `http://localhost:3000/connexion` | `EADDRINUSE :::3000` si l'ancien serveur tourne encore |

Sortie réelle de `npm test` dans cet état (9 fichiers en échec, 0 test exécuté) :

```
Error: Migrations impossibles sur la base de test :
  Command failed: node node_modules/prisma/build/index.js migrate deploy
Error: P1001: Can't reach database server at `localhost:5433`
```

Tant que ce point n'est pas fait, **aucun test n'a pu être exécuté** et l'import
réel des CSV n'a pas pu être rejoué. Tout le reste est vérifié statiquement
(typage TypeScript : 0 erreur, vérifié).

---

## 2. Pile technique

| Élément | Version |
|---|---|
| Next.js (App Router) | 16.3.6 |
| React / React DOM | 19.3.0 |
| TypeScript | ^5.9.3 |
| Tailwind CSS | ^4.3.3 |
| Prisma / @prisma/client | ^6.19.0 |
| PostgreSQL | 17 (conteneur Docker, port 5433) |
| Zod | ^3.25.76 |
| Vitest | ^3.2.7 |
| tsx | ^4.21.0 |
| Node.js | >= 20 |

Choix structurant : **quantités et montants en `Prisma.Decimal`** (`src/lib/decimal.ts`,
objet `D`), jamais en flottant ; chaque opération de stock passe par un mouvement
au grand livre (`StockMovement`) et un solde (`StockBalance`) recalculé dans une
transaction PostgreSQL.

---

## 3. Migrations créées

| Migration | Objet |
|---|---|
| `20260926152011_init` | Schéma complet (référentiel, stock, production, qualité, achats, ventes, comptabilité, RH, audit, sécurité) |
| `20260926161820_import_value_mapping` | Table `ImportValueMapping` — correspondances de valeurs confirmées par l'administrateur |
| `20260926162317_import_row_snapshot` | Table `ImportRowSnapshot` — clé stable « système source + entité + identifiant d'origine » |

---

## 4. Architecture

```
src/
  app/
    (app)/…                 ~80 pages françaises (voir §6)
    connexion/              page de connexion
    aucun-acces/            refus d'accès
  lib/
    auth/                   scrypt, sessions, politique de mot de passe
    rbac/                   92 permissions, 18 rôles, portées usine
    decimal.ts              arithmétique exacte
    errors.ts               codes d'erreur métier
    numbering.ts            numérotation {PREFIX}-{YYYY}-{SEQ}
    libelles.ts             libellés français de tous les statuts
    referentiel/ stock/ production/ qualite/ achat/ vente/
    comptabilite/ rh/ import/ tableau-bord/ commercial/
    audit.ts                journal d'audit
  actions/                  actions serveur (administration, etc.)
prisma/
  schema.prisma             76 modèles
  migrations/               3 migrations
  seed.ts                   référentiel de base (dépôts, unités, TVA, opérations, postes, règles d'écriture, rôles)
scripts/
  bootstrap-admin.ts        création sécurisée du premier administrateur
  import-csv.ts             import des données réelles
```

---

## 5. Modules terminés

1. **Authentification et sécurité** — hachage scrypt (N=16384, r=8, p=1), jeton
   de session stocké uniquement en SHA-256, cookie `httpOnly`/`sameSite=lax`,
   TTL 12 h, verrouillage 15 min après 5 échecs, révocation de toutes les
   sessions au changement de mot de passe.
2. **Rôles et permissions** — 92 permissions, 18 rôles, une portée d'usine par
   rôle. Les restrictions sont appliquées dans les gardes serveur, les actions,
   les requêtes et les exports — jamais par simple masquage de menu.
3. **Référentiel** — articles (états Actif / Inactif / Archivé / Non
   commercialisable / Non productible), familles hiérarchiques, dépôts
   (`DEP-MP`, `DEP-MP-MBX`, `DEP-PF`…), emplacements, tiers (client /
   fournisseur / employé / autre), tarifs.
4. **Nomenclatures et gammes** — versions, statuts (Brouillon → En validation →
   Validée → Active → Remplacée → Archivée), dates d'effet, approbateur,
   historique. Une nomenclature utilisée par un ordre n'est jamais modifiée en
   silence : nouvelle version + copie figée dans `WorkOrderMaterial`.
   **Détection des contradictions de quantités** : aucune quantité n'est choisie
   silencieusement ; un écart (`FormulaVariance`) est ouvert avec les deux
   valeurs, l'écart et son origine, pour validation par un administrateur.
5. **Stock** — grand livre de mouvements, 18 types de mouvement, états
   physique / disponible / réservé / bloqué / endommagé / quarantaine / en
   production. Aucune quantité modifiée sans mouvement ; toute correction passe
   par un mouvement inverse ou une régularisation auditée ; les mouvements
   validés ne sont pas supprimables. Sortie FIFO par lot, coût moyen pondéré.
   Refus : sortie > disponible, consommation d'un article bloqué ou en
   quarantaine.
6. **Production** — ordres de fabrication (10 statuts, quantités prévue /
   lancée / produite / conforme / rebutée / en reprise / restante), gammes
   réelles, opérations, postes de travail, ateliers, déclarations de production,
   pertes et rebuts (motifs distincts de la consommation normale), reprise en
   stock, kanban persistant (6 colonnes ADMEDCO, 12 colonnes MOBILIX) où chaque
   déplacement est une opération métier tracée (ancienne étape, nouvelle étape,
   utilisateur, horodatage, quantité, commentaire, consommations, pertes,
   résultat qualité).
7. **Transfert inter-ateliers** — à la fin de `POUDRAGE`, validation de la
   quantité réellement produite, consommation réelle, création du stock de
   châssis peints (code logique configurable `CODE_SEMI_FINI_CHASSIS`,
   `SF-CHASSIS-PEINT` par défaut), mouvement `TRANSFERT_INTER_ATELIERS` de
   `DEP-MP` vers `DEP-MP-MBX`, mise à disposition de MOBILIX, traçabilité
   complète. Architecture prête pour l'inter-sociétés.
   **Résolution du semi-fini** (`src/lib/production/chassis-peint.ts`) : avant
   toute création, la plateforme cherche un article **équivalent déjà importé**
   (code ou libellé contenant « châssis » et « peint ») — un équivalent unique
   est adopté, l'article n'est donc jamais dupliqué. Un article déjà désigné par
   la règle de transfert n'est jamais remplacé en silence : une divergence entre
   le code configuré et la règle, ou plusieurs équivalents possibles, est
   signalée et soumise à confirmation. L'administrateur confirme l'article
   retenu depuis **Administration → Paramètres** ; la réaffectation et la
   création sont journalisées dans l'audit. L'import CSV se contente de
   signaler la correspondance, sans jamais créer d'article absent du fichier.
8. **Qualité** — contrôle à la réception (Accepté / Accepté sous réserve /
   Quarantaine / Rejeté), contrôles en production, contrôle final et
   **libération du produit fini** : un produit fabriqué n'est ni vendable ni
   livrable avant libération (`libererProduitFini`), non-conformités et
   quarantaine.
9. **Achats** — demande d'achat → demande de prix → commande fournisseur →
   réception → contrôle qualité → facture fournisseur → règlement, avec
   rapprochement trois voies, réceptions partielles, retours et avoirs
   fournisseur.
10. **Ventes** — client → devis → commande client → ordre de fabrication →
    production → bon de livraison → facture client → règlement. La confirmation
    d'une commande génère automatiquement les ordres de fabrication des lignes
    configurées et **rapporte ligne par ligne** les échecs, jamais masqués.
    Sortie de stock réelle à l'expédition, avoir sur facture comptabilisée.
11. **Comptabilité** — plan comptable, journaux, écritures, **règles d'écriture
    configurables** (aucune règle légale inventée), exercices et périodes,
    balance. Les écritures ne sont générées que sur événements validés. Aucune
    écriture postée n'est supprimée : contre-passation, avoir, annulation
    contrôlée, nouvelle écriture, commentaire obligatoire.
12. **RH** — employés (chacun son propre compte, jamais de compte partagé),
    fonctions, compétences et niveaux, affectations quotidiennes, présence,
    absence, retard, congés, heures, heures supplémentaires, historique
    d'évaluation. Les données salariales ne sont visibles que par les
    utilisateurs autorisés.
13. **Évaluation automatique** — pondérations **non codées en dur** :
    Productivité 30 %, Qualité 25 %, Efficacité matière 20 %, Présence 15 %,
    Polyvalence 10 %, 22 indicateurs, périodes jour / semaine / mois / atelier /
    opération, validation manager, correction justifiée, commentaire, export.
    Un employé n'est jamais évalué sur la norme d'une opération qu'il n'a pas
    réellement effectuée, et l'insuffisance de données est signalée
    (indice de fiabilité).
14. **Portail employé** — interface simplifiée : démarrer, mettre en pause,
    déclarer une quantité, déclarer une perte, signaler un problème, terminer.
    L'employé ne peut pas modifier une opération validée, ni le stock, ni les
    nomenclatures, ni les coûts, ni voir les salaires des autres, ni la
    comptabilité complète, ni les autres ateliers sans permission.
15. **Import de données réelles** — 9 fichiers (familles, articles,
    nomenclatures, formules, composants, tiers, lots/stocks), séparateur `;`,
    accents et libellés d'origine préservés, clé stable d'origine,
    ré-exécutable sans doublon, journal d'import, lignes rejetées conservées,
    rapport de correspondances, simulation sans écriture. Une fiche absente du
    CSV n'est jamais supprimée (archivage / inactif). Les valeurs inconnues
    (type de tiers, type d'article) ne sont jamais devinées : elles sont
    signalées et une correspondance doit être confirmée par l'administrateur.
16. **Tableaux de bord** — direction, production, ADMEDCO, MOBILIX, stock,
    qualité, finance, RH, employé.
17. **Administration** — utilisateurs, rôles, paramètres, journal d'audit,
    import.
18. **Audit et traçabilité** — connexion, déconnexion, création, modification,
    validation, annulation, suppression logique, mouvement de stock,
    consommation, perte, rebut, reprise, changement de nomenclature, changement
    de permission, facturation, règlement, modification de quantité, import,
    export, changement d'affectation, validation qualité.

---

## 6. Pages livrées (extrait)

- **Référentiel** : articles (liste, fiche, création), familles, dépôts, tiers
  (liste, fiche, création), tarifs
- **Nomenclature** : liste, fiche, gammes, écarts, création
- **Stock** : état, mouvements, lots, transferts, inventaire
- **Production** : ordres, fiche ordre, déclarations, kanban
- **Qualité** : tableau de bord, contrôles, non-conformités, plans, à libérer
- **Achats** : demandes, commandes, réceptions, factures
- **Ventes** : devis, commandes, livraisons, factures
- **Comptabilité** : plan, journaux/écritures, règles, règlements, balance
- **RH** : employés, compétences, affectations, présences, évaluations
- **Tableaux de bord** : direction, production, finance, RH
- **Administration** : utilisateurs, rôles, paramètres, audit, import
- **Portail employé**, **Mon compte**, **Recherche globale**

Toute l'interface visible est en français (menus, boutons, titres, colonnes,
messages d'erreur et de validation, statuts, notifications).

---

## 7. Tests automatisés

154 tests répartis en 9 fichiers, exécutés contre la vraie base PostgreSQL de
test (`erpmes_test`, créée et migrée par `src/tests/setup.ts`) — aucun service
métier n'est simulé.

| Fichier | Tests | Couverture |
|---|---|---|
| `auth.test.ts` | 21 | hachage, politique de mot de passe, connexion, verrouillage, sessions, changement/réinitialisation |
| `rbac.test.ts` | 21 | permissions effectives, portées d'usine, cloisonnement des ateliers, protection des données salariales |
| `stock.test.ts` | 13 | mouvements, soldes, FIFO, blocage/quarantaine, refus de sortie, corrections |
| `production.test.ts` | 12 | ordres, déclarations, pertes, kanban, fin de poudrage, transfert inter-ateliers, résolution du châssis peint (adoption d'un équivalent importé, non-duplication, refus de remplacement silencieux, création contrôlée) |
| `rh.test.ts` | 13 | affectation quotidienne, réaffectation, évaluation par opération réellement effectuée, protection contre l'évaluation injuste |
| `achat.test.ts` | 21 | demande → commande → réception → contrôle → facture → règlement, rapprochement trois voies |
| `vente.test.ts` | 19 | devis → commande → OF automatique → livraison → facture → avoir → règlement, libération qualité avant livraison |
| `comptabilite.test.ts` | 15 | écritures, validation/postage, contre-passation, avoirs, périodes |
| `import.test.ts` | 19 | lecture CSV, familles, articles, tiers, nomenclatures et écarts, lots/stocks, simulation |

Tests obligatoires imposés par le cahier des charges : tous couverts.

**Statut : écrits, non exécutés** — PostgreSQL doit être démarré (voir §1).

---

## 8. Commandes

```bash
npm install                 # dépendances
npm run db:generate         # client Prisma
npm run db:deploy           # applique les migrations
npm run db:seed             # référentiel de base
npm run typecheck           # tsc --noEmit        -> 0 erreur
npm test                    # vitest run          -> exige PostgreSQL
npm run dev                 # Next.js sur le port 3000
npm run build               # build de production
npm run comptes -- --amorcer --domaine=admedco.dz  # TOUT créer : administrateur + un compte par rôle
npm run comptes -- --liste  # comptes existants : n°, adresse, rôles, état
npm run comptes -- --tous --domaine=admedco.dz   # un compte par rôle (mots de passe affichés une fois)
npm run bootstrap:admin     # premier administrateur seul (sécurisé)
npm run import:csv -- --dossier=E:/Massiexporte            # simulation, aucune écriture
npm run import:csv -- --executer                           # import réel
npm run import:csv -- --executer --maj                     # import réel + mise à jour des fiches
npm run setup               # generate + deploy + seed
npm run verify              # typecheck + test
```

---

## 9. Variables d'environnement

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | chaîne de connexion PostgreSQL |
| `SESSION_SECRET` | secret de session (>= 48 caractères aléatoires) |
| `SESSION_TTL_HOURS` | durée de vie d'une session (12 par défaut) |
| `CSV_SOURCE_DIR` | dossier des fichiers CSV sources (`E:/Massiexporte`) |
| `BOOTSTRAP_ADMIN_EMAIL` | premier administrateur — utilisé **uniquement** par `npm run bootstrap:admin` |
| `BOOTSTRAP_ADMIN_PASSWORD` | mot de passe du premier administrateur (à retirer du `.env` après usage) |
| `BOOTSTRAP_ADMIN_PRENOM` / `BOOTSTRAP_ADMIN_NOM` | identité de l'administrateur |
| `NODE_ENV` | `development` / `production` |

Modèle fourni : `.env.example`.

---

## 10. Installation

```bash
# 1. Base de données
docker run -d --name erpmes-postgres \
  -e POSTGRES_USER=erpmes -e POSTGRES_PASSWORD=erpmes_dev_pwd \
  -e POSTGRES_DB=erpmes -p 5433:5432 postgres:17

# 2. Configuration
cp .env.example .env      # renseigner DATABASE_URL et SESSION_SECRET

# 3. Schéma et référentiel
npm install
npm run setup

# 4. Comptes — tout créer en une commande
#    Administrateur système + un compte par rôle, mots de passe affichés une seule fois
npm run comptes -- --amorcer --domaine=admedco.dz
#    Variante « administrateur seul », pilotée par BOOTSTRAP_ADMIN_* dans .env :
#    npm run bootstrap:admin   (puis retirer BOOTSTRAP_ADMIN_PASSWORD du .env)

# 5. Démarrage
npm run dev               # http://localhost:3000
```

---

## 11. Import des données réelles

```bash
# Analyse seule : rapport de colonnes, doublons, lignes rejetées. Aucune écriture.
npm run import:csv -- --dossier=E:/Massiexporte

# Import réel, dans l'ordre des dépendances
npm run import:csv -- --executer

# Import réel autorisant la mise à jour des fiches déjà modifiées dans l'application
npm run import:csv -- --executer --maj
```

Ordre : familles d'articles → articles → tiers → nomenclatures/formules →
composants → lots et stocks. Chaque exécution produit un journal d'import
(`ImportJob`) et conserve les lignes rejetées (`ImportErrorLog`). Une fiche
absente d'un CSV n'est jamais supprimée. Une fiche modifiée dans l'application
n'est jamais écrasée sans `--maj`.

---

## 12. Comptes à créer

| Compte | Procédure |
|---|---|
| **Tous les comptes en une commande** | `npm run comptes -- --amorcer --domaine=admedco.dz` — crée l'administrateur système puis un compte par rôle (18) et affiche un tableau unique : n° de compte, adresse, rôle, portée, mot de passe temporaire |
| Administrateur système seul | `npm run bootstrap:admin` (variables d'environnement, mot de passe robuste, changement forcé à la première connexion) |
| Autres rôles (Direction, Production, ADMEDCO, MOBILIX, Stock, Qualité, Finance, RH, Employé…) | créés depuis **Administration → Utilisateurs**, avec mot de passe temporaire et changement forcé |
| Mêmes comptes, en ligne de commande | `npm run comptes -- --email=… --roles=DIRECTION` ou, pour un compte par rôle, `npm run comptes -- --tous --domaine=admedco.dz` |

**Aucun mot de passe n'est codé en dur dans le dépôt.** Aucun utilisateur réel
n'est créé automatiquement avec un mot de passe connu. Chaque employé dispose de
son propre compte : aucun compte partagé n'est créé, y compris par l'import
(l'import des employés ne génère aucun accès).

`npm run comptes` (script `scripts/comptes.ts`) :

| Commande | Effet |
|---|---|
| `npm run comptes -- --amorcer --domaine=…` | **amorçage complet** : crée le premier administrateur (identité et mot de passe pris dans `BOOTSTRAP_ADMIN_*` s'ils sont renseignés et conformes, sinon générés) puis un compte par rôle du référentiel, et affiche un tableau unique (n° de compte, adresse, rôle, libellé, portée, fiche employé, mot de passe temporaire). Idempotent : un second administrateur système n'est jamais créé et les adresses déjà présentes sont signalées puis ignorées |
| `npm run comptes -- --liste` | liste les comptes : n° (identifiant), adresse, rôles, fiche employé, état, changement de mot de passe en attente. Aucun mot de passe n'est affiché : ils ne sont stockés qu'en hash |
| `npm run comptes -- --email=… --roles=…[,AUTRE_ROLE]` | crée un compte nominatif ; le mot de passe temporaire (16 caractères, aléatoire) est **affiché une seule fois** puis haché |
| `--employe=MATRICULE` | rattache le compte à une fiche employé **existante** (obligatoire pour le portail employé) ; le script n'invente aucune donnée RH |
| `npm run comptes -- --tous --domaine=…` | crée un compte par rôle du référentiel (18) et affiche le tableau des mots de passe temporaires — utile pour parcourir chaque portail |
| `npm run comptes -- --desactiver --domaine=…` | fin de revue : désactive les comptes du domaine et révoque leurs sessions. Les comptes sont désactivés, jamais supprimés, et l'opération est journalisée |

Rôles dont l'accès au **portail employé** (`/portail`) exige une fiche employé
liée : `OPERATEUR_ADMEDCO`, `OPERATEUR_MOBILIX`. Les autres rôles ouvrent
`/tableau-de-bord` et les modules correspondant à leurs permissions.

Seule exception dans le dépôt : `MOT_DE_PASSE_TEST` (`src/tests/aide.ts`) est un
identifiant **réservé aux tests automatisés**, créé uniquement dans la base
`erpmes_test` ; ces comptes n'ont aucun rôle et ne permettent d'ouvrir aucun
portail.

---

## 13. Risques et décisions métier à valider

| # | Sujet | Décision prise | À valider |
|---|---|---|---|
| 1 | Extourne d'écriture à l'état brouillon | autorisée | politique comptable |
| 2 | Écriture hors période | acceptée avec `periodId = null` | faut-il bloquer ? |
| 3 | Date de contre-passation par défaut | peut tomber dans une autre période | politique comptable |
| 4 | `corrigerEvaluation` | enregistre la correction et son motif, pas de recalcul des valeurs | règle RH |
| 5 | Axe « Productivité » | composant manquant compté 0 | règle RH |
| 6 | Objectif de polyvalence | 6 opérations, valeur fixe | paramétrable ? |
| 7 | `reellementEffectuee` | toujours vrai (l'affectation fait foi) | à affiner |
| 8 | Solde des tiers importé | 0 (le solde de l'ancien ERP n'est pas repris) | reprise des soldes |
| 9 | Simulation d'import | exécution réelle dans une transaction annulée (aucune écriture) | — |
| 10 | Dépôts et unités du référentiel | `DEP-MP`, `DEP-MP-MBX`, `DEP-PF` | noms définitifs |
| 11 | TVA | taux configurable, 19 % par défaut, devise DZD | taux définitifs |
| 12 | Colonnes CSV disparues | archivage / passage en inactif, jamais de suppression | — |
| 13 | Équivalent importé du châssis peint | un équivalent **unique** est adopté automatiquement au démarrage ; plusieurs équivalents ne sont jamais départagés en silence (l'article de la règle reste utilisé et l'administrateur confirme) | faut-il interdire toute adoption automatique et exiger une confirmation systématique ? |

---

## 14. Erreurs corrigées

- `import.test.ts` : `RapportColonnes.colonnesObligatoiresAbsentes` inexistant →
  remplacé par trois cas réels (`colonnesManquantes`, `colonnesPresentes`,
  `colonnesInconnues`) prouvant que la conformité dépend uniquement des colonnes
  obligatoires.
- `vente.test.ts` : `WorkOrder.cancelledAt` inexistant → remplacé par les
  assertions réelles de l'annulation (statut `ANNULE`, quantité restante nulle,
  opérations `ANNULEE`, entrée d'audit `ANNULATION` avec le motif et l'auteur).
- Nettoyage de `import.test.ts` : les journaux d'erreur d'import sont supprimés
  avant les articles (contrainte `ImportErrorLog.itemId` sans cascade).
- `vente.test.ts` : ajout de l'import Vitest et de `LIBELLES_STATUT_FACTURE` ;
  gamme de test en deux étapes (`COUPE`, `MEULAGE`) pour que la déclaration de
  production ne clôture pas l'ordre avant la libération qualité.
- Assertions de solde de stock rendues robustes (agrégation de toutes les lignes
  de solde au lieu d'une ligne arbitraire).

**Vérification de typage : 0 erreur** après correction (`npm run typecheck`).

---

## 15. Ce qui reste à faire

1. Démarrer Docker Desktop et le conteneur `erpmes-postgres` (port 5433).
2. `npm run typecheck` puis `npm test` — corriger les éventuels échecs
   d'intégration. Les quatre derniers tests ajoutés
   (`semi-fini du transfert inter-divisions`) n'ont pas encore été exécutés :
   l'environnement de cette session a refusé l'exécution des commandes
   (`npm run typecheck`) avant la fin du travail, PostgreSQL n'étant de toute
   façon pas démarré (`P1001: Can't reach database server at 'localhost:5433'`).
3. Rejouer l'import réel des CSV et relever les chiffres définitifs.
4. `npm run dev` (et si possible `npm run build`) pour valider le démarrage.

---

## 16. Dernier incrément livré : résolution du semi-fini « châssis peint »

Exigence : « rechercher dans les données importées un article équivalent et
**ne pas créer de doublon** ».

| Élément | Détail |
|---|---|
| Nouveau module | `src/lib/production/chassis-peint.ts` — `analyserArticleChassisPeint` (lecture seule), `resoudreArticleChassisPeint`, `assurerChassisPeint`, `synchroniserRegleTransfertChassis`, `adopterArticleChassisPeint` |
| Règle de résolution | 1) article désigné par la règle de transfert active ; 2) article portant le code configuré ; 3) équivalent **unique** déjà importé (adopté, jamais dupliqué) ; 4) création de l'article de référence |
| Aucun choix silencieux | divergence code configuré / article de la règle signalée ; plusieurs équivalents → aucun départage automatique, l'administrateur confirme |
| Traçabilité | création, adoption et réaffectation de la règle journalisées (`Item`, `DivisionTransferRule`, action `CREATION` / `IMPORT` / `MODIFICATION`) |
| Seed | `prisma/seed.ts` utilise désormais `assurerChassisPeint` : aucune création si un article existe déjà, y compris après un import |
| Import CSV | `src/lib/import/service.ts` appelle `analyserArticleChassisPeint` et **signale** la correspondance dans les avertissements du rapport d'import — il ne crée jamais d'article absent du fichier source |
| Interface | `Administration → Paramètres` : panneau « Article semi-fini du transfert inter-divisions » (article utilisé, règle appliquée, équivalents importés, bouton « Utiliser cet article ») réservé à la permission `CONFIG_GERER` |
| Action serveur | `actionAdopterArticleChassisPeint` (permission `CONFIG_GERER`, réaffectation auditée) |
| Tests | 4 tests ajoutés dans `production.test.ts` : adoption d'un équivalent importé sans doublon, non-remplacement silencieux de l'article de la règle, création contrôlée quand aucune correspondance n'existe, confirmation par un administrateur et refus d'un article archivé |
