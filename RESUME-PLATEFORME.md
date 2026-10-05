# RESUME DE LA PLATEFORME — ERP + MES ADMEDCO / MOBILIX

> Etat courant : voir `ETAT-MISE-EN-SERVICE.md`. Ce document conserve des chiffres et conclusions historiques ; il ne certifie pas une mise en production.

Document de reference. Etat au 28 septembre 2026.
Tous les chiffres proviennent du code et des comptes rendus d'execution du depot.

---

## 1. Ce qu'est la plateforme

Un **ERP + MES** pour un industriel algerien a deux divisions :

| Division | Matieres et metiers | Depot principal |
|---|---|---|
| **ADMEDCO** | metal : coupe, usinage, soudage, meulage, vissage, poudrage | `DEP-MP` |
| **MOBILIX** | bois, couture, garnissage | `DEP-MP-MBX` |

Les deux divisions partagent un flux industriel : des chassis peints par ADMEDCO
entrent chez MOBILIX pour le garnissage. Ce flux est encode en base sous forme de
regle de transfert inter-ateliers.

**Pile technique** : Next.js 16.3.6 (App Router, Turbopack), React 19.3.0,
TypeScript 5.9.3, Prisma 6.19.0, PostgreSQL 17 (conteneur Docker `erpmes-postgres`,
port 5433), Tailwind CSS 4, Vitest, Zod.

**Interface** : entierement en francais. Le code, les commentaires et les messages
de console sont en francais **sans accents** (contrainte des consoles Windows).

---

## 2. Les chiffres

| Element | Quantite |
|---|---|
| Pages (`page.tsx`) | **85** |
| Modules de premier niveau | **13** |
| Sections de menu | **12** |
| Entrees de menu | **56** |
| Permissions fines | **92** |
| Portees d'usine | **3** |
| Roles | **18** |
| Depots | **9** |
| Modeles Prisma | ~76 |
| Migrations | 4 |
| Fichiers d'actions serveur | 11 |
| Comptes utilisateurs | 11 |
| Fiches employes | 2 (techniques) |

---

## 3. Combien de portails ?

Deux reponses, selon ce qu'on appelle « portail ».

### Au sens strict : UN seul portail

Le **portail employe**, sur `/portail`. C'est l'ecran simplifie de l'operateur
d'atelier, concu pour etre utilise au poste : ecran tactile, personne debout, avec
des gants. Il est ouvert par exactement **deux roles** :

| Code du role | Libelle | Portee |
|---|---|---|
| `OPERATEUR_ADMEDCO` | Operateur ADMEDCO | ADMEDCO |
| `OPERATEUR_MOBILIX` | Operateur MOBILIX | MOBILIX |

Ils detiennent la permission `PORTAIL_EMPLOYE` — et c'est la seule permission du
module « Portail employe » : une seule sur les 92.

### Au sens de « point d'entree » : DIX-HUIT

Chaque role possede sa propre page d'accueil, declaree dans `ACCUEIL_PAR_ROLE`
(`src/components/navigation.ts`). Il n'existe pas d'ecran commun.

La raison est ecrite dans le code, mot pour mot : *« un tableau de bord partage donne
a tout le monde l'illusion de voir la meme chose, et noie chaque metier sous les
chiffres des autres »*.

La table complete des 18 accueils est en section 6.

---

## 4. Les 13 modules et ce qu'ils font

| Module | Route | Contenu | Role principal |
|---|---|---|---|
| **Pilotage** | `/tableau-de-bord` | Tableau de bord a blocs conditionnels + 3 tableaux specialises (production, finance, RH) | Direction, Administrateur |
| **Mon espace** | `/portail` | Le portail employe de l'atelier | Operateurs |
| **Referentiel** | `/referentiel/…` | Articles, familles, tiers (clients, fournisseurs, personnes), depots, tarifs | Tous les roles lecteurs |
| **Nomenclature et gammes** | `/nomenclature/…` | Nomenclatures (BOM), detection d'ecarts et de contradictions, gammes de fabrication | Production, Responsables |
| **Stocks** | `/stock/…` | Etat des stocks, mouvements, transferts inter-ateliers, inventaire physique, lots | Stock, Magasinier |
| **Production** | `/production/…` | Ordres de fabrication, kanban atelier, declarations a valider | Production, Operateurs |
| **Qualite** | `/qualite/…` | Controles qualite, non-conformites, lots a liberer (quarantaine) | Qualite, Operateurs |
| **Achats** | `/achats/…` | Demandes d'achat, commandes fournisseur, receptions, factures fournisseur | Acheteur |
| **Ventes** | `/ventes/…` | Devis, commandes client, bons de livraison, factures client | Commercial |
| **Finance et comptabilite** | `/comptabilite/…` | Ecritures, balance, reglements, regles d'ecriture configurables, plan comptable | Comptable, Resp. financier |
| **Ressources humaines** | `/rh/…` | Employes, affectations quotidiennes, presences et pointage, evaluations, competences | RH, Operateurs (affectations) |
| **Administration** | `/administration/…` | Utilisateurs, roles, parametres, import CSV, journal d'audit | Administrateur systeme |
| **Recherche et compte** | `/recherche`, `/mon-compte` | Recherche globale, compte personnel | Tous |

---

## 5. Les 12 sections de menu et leurs entrees

| Section | Entrees | Contenu |
|---|---|---|
| Pilotage | 4 | Tableau de bord, Pilotage production, Tableau de bord finance, Tableau de bord RH |
| Mon espace | 1 | Portail employe |
| Referentiel | 5 | Articles, Familles, Tiers, Depots, Tarifs |
| Nomenclature et gammes | 3 | Nomenclatures, Ecarts de nomenclature, Gammes |
| Stocks | 5 | Etat des stocks, Mouvements de stock, Transferts inter-ateliers, Inventaire physique, Lots |
| Production | 3 | Ordres de fabrication, Kanban atelier, Declarations a valider |
| Qualite | 3 | Controles qualite, Non-conformites, Articles a liberer |
| Achats | 4 | Demandes d'achat, Commandes fournisseur, Receptions, Factures fournisseur |
| Ventes | 4 | Devis, Commandes client, Bons de livraison, Factures client |
| Finance et comptabilite | 5 | Ecritures, Balance, Reglements, Regles d'ecriture, Plan comptable |
| Ressources humaines | 5 | Employes, Affectations quotidiennes, Presences, Evaluations, Competences |
| Administration | 5 | Utilisateurs, Roles, Parametres, Import, Journal d'audit |
| **Total** | **56** | Chaque entree est conditionnee par une permission |

Regle de filtrage : une entree sans permission declaree n'est **jamais** affichee. Une
section dont toutes les entrees sont refusees disparait entierement du menu.

---

## 6. Les 25 roles et leur page d'accueil

| Role | Code | Portee d'usine | Arrive sur |
|---|---|---|---|
| Administrateur systeme | `ADMIN_SYSTEME` | COMMUN | `/tableau-de-bord` |
| Proprietaire / Direction | `DIRECTION` | COMMUN | `/tableau-de-bord` |
| Responsable d'usine | `RESPONSABLE_USINE` | COMMUN | `/tableau-de-bord/production` |
| Responsable ADMEDCO | `RESPONSABLE_ADMEDCO` | ADMEDCO | `/tableau-de-bord/production` |
| Responsable MOBILIX | `RESPONSABLE_MOBILIX` | MOBILIX | `/tableau-de-bord/production` |
| Responsable production | `RESPONSABLE_PRODUCTION` | COMMUN | `/production` |
| Operateur ADMEDCO | `OPERATEUR_ADMEDCO` | ADMEDCO | `/portail` |
| Operateur MOBILIX | `OPERATEUR_MOBILIX` | MOBILIX | `/portail` |
| Responsable stock | `RESPONSABLE_STOCK` | COMMUN | `/stock` |
| Magasinier | `MAGASINIER` | COMMUN | `/stock` |
| Responsable qualite | `RESPONSABLE_QUALITE` | COMMUN | `/qualite` |
| Acheteur | `ACHETEUR` | COMMUN | `/achats/demandes` |
| Commercial | `COMMERCIAL` | COMMUN | `/ventes/devis` |
| Comptable | `COMPTABLE` | COMMUN | `/comptabilite/ecritures` |
| Responsable financier | `RESPONSABLE_FINANCIER` | COMMUN | `/comptabilite/ecritures` |
| Responsable RH | `RESPONSABLE_RH` | COMMUN | `/rh/employes` |
| Auditeur | `AUDITEUR` | COMMUN | `/tableau-de-bord` |
| Utilisateur lecture seule | `LECTURE_SEULE` | COMMUN | `/referentiel/articles` |

Si un role perd la permission d'ouvrir sa page d'accueil, la plateforme retombe
automatiquement sur sa premiere page reellement accessible — jamais sur un refus
d'acces des la connexion.

---

## 7. La logique, de bout en bout

### 7.1 Le cloisonnement de l'acces

Il s'exerce a **quatre niveaux**, et il est verifie **cote serveur** :

1. **Par permission** — 99 permissions fines, regroupees en 12 modules.
2. **Par usine** — un role `ADMEDCO` ne voit jamais une donnee `MOBILIX`, meme en
   tapant l'URL a la main. Trois portees : `PORTEE_TOUTES_USINES`,
   `PORTEE_ADMEDCO`, `PORTEE_MOBILIX`.
3. **Par atelier** — l'operateur est borne a son atelier.
4. **Par personne** — le portail est borne a `employeeId` : on ne voit que sa propre
   fiche.

La permission est revérifiée a quatre endroits : dans la **page**, dans l'**action
serveur**, dans l'**API** et dans la **requete**. Regle du depot : *« masquer un menu
ne protege rien »*. Corollaire souvent oublie : un bloc masque en CSS laisse la
donnee dans le HTML — on **rend conditionnellement**, on ne cache pas.

Les permissions sont relues en base a chaque requete : **aucune reconnexion n'est
necessaire** apres un changement de droits.

### 7.2 Les 9 depots

| Code | Libelle | Type | Usine |
|---|---|---|---|
| `DEP-MP` | Matieres premieres ADMEDCO | MATIERES_PREMIERES | ADMEDCO |
| `DEP-MP-MBX` | Matieres premieres MOBILIX | MATIERES_PREMIERES | MOBILIX |
| `DEP-ENC` | En-cours de production ADMEDCO | EN_COURS | ADMEDCO |
| `DEP-ENC-MBX` | En-cours de production MOBILIX | EN_COURS | MOBILIX |
| `DEP-PF` | Produits finis ADMEDCO | PRODUITS_FINIS | ADMEDCO |
| `DEP-PF-MBX` | Produits finis MOBILIX | PRODUITS_FINIS | MOBILIX |
| `DEP-QUAR` | Quarantaine | QUARANTAINE | COMMUN |
| `DEP-REBUT` | Rebuts et non-conformes | REBUT | COMMUN |
| `DEP-CONS` | Consommables et emballages | CONSOMMABLES | COMMUN |

Le stock est tenu **par depot et par lot**. Un lot peut etre en quarantaine : la
marchandise n'est pas disponible tant que la qualite n'a pas statue.

### 7.3 Le flux de production

Un ordre de fabrication (`WorkOrder`) se deroule ainsi :

1. **Lancement** — la nomenclature est **figee en copie** a cet instant
   (`WorkOrderMaterial`). Un changement ulterieur de la nomenclature ne modifie jamais
   un ordre deja lance.
2. **Decomposition en operations** — une ligne `WorkOrderOperation` par etape
   (`stepNo`), avec quantite prevue, statut, poste de charge et operateur.
3. **Affectation** — un `Assignment` : un employe, une operation, une journee. C'est
   ce que voit l'operateur dans « Mes affectations du jour ».
4. **Execution au poste** — demarrer, mettre en pause, reprendre, terminer. Le temps
   est comptabilise (`totalPausedMs`, `actualStart`, `actualEnd`).
5. **Declaration** — quantite produite, conforme, rebut, retouche, consommee. Les
   declarations passent par un etat « a valider » pour le responsable.
6. **Controle qualite** — decision : conforme, non conforme, ou a retoucher.
7. **Entree en stock** — la quantite conforme entre dans le depot de produits finis ou
   de semi-finis.
8. **Transfert inter-ateliers**, le cas echeant (voir ci-dessous).

### 7.4 La regle de transfert ADMEDCO vers MOBILIX

Elle est semee en base (`DivisionTransferRule`) et active :

| Parametre | Valeur |
|---|---|
| Code | Regle de transfert du chassis peint |
| Declencheur | Operation `POUDRAGE` |
| Article produit | Le chassis peint |
| Depot source | `DEP-MP` (ADMEDCO) |
| Depot cible | `DEP-MP-MBX` (MOBILIX) |
| Sens | ADMEDCO vers MOBILIX |

**Commentaire en base, mot pour mot** : *« A la fin du poudrage, la quantite produite
reelle est validee, les consommations reelles sont enregistrees, le chassis peint
entre en stock DEP-MP puis est transfere vers DEP-MP-MBX pour etre disponible a
MOBILIX. »*

C'est la charniere entre les deux divisions : ce qui fait qu'un chassis fini chez
ADMEDCO devient une matiere disponible chez MOBILIX.

### 7.5 Le portail employe : trois garanties

Elles sont ecrites dans l'en-tete de `src/app/(app)/portail/page.tsx` :

| Garantie | Ce que cela impose |
|---|---|
| **Cloisonnement** | Toutes les requetes sont bornees sur `utilisateur.employeeId`. Aucun identifiant d'employe n'est lu dans un formulaire, et les actions serveur refusent toute operation non reellement affectee a l'employe connecte. |
| **Aucune donnee salariale** | Les colonnes de remuneration ne sont meme pas selectionnees, quelle que soit la permission du compte. |
| **Aucune modification libre du stock** | Declarer une perte est enregistre **sans mouvement de stock**. C'est un signalement, pas une sortie. |

Les actions offertes : demarrer, mettre en pause, reprendre, declarer une quantite,
declarer une perte, signaler un probleme, terminer, cloturer l'ordre.

### 7.6 La chaine pour qu'un operateur travaille

Stricte et ordonnee. Chaque maillon manquant laisse le portail **vide sans produire
d'erreur**, ce qui rend le diagnostic contre-intuitif.

| # | Maillon | Modele |
|---|---|---|
| 1 | Fiche employe, avec matricule unique et bonne usine | `Employee` |
| 2 | Compte rattache a la fiche | `User.employeeId` |
| 3 | Affectation du jour | `Assignment` |
| 4 | Ordre de fabrication, donc article fabriquable | `WorkOrder`, `Article.isProducible` |

**La fiche d'abord, le compte ensuite** : un compte ne peut pas etre rattache a une
fiche qui possede deja un compte. La plateforme interdit ainsi deux personnes sur un
meme identifiant.

### 7.7 Comment on accede a la plateforme

- Connexion par email et mot de passe.
- En developpement seulement, un panneau d'**acces rapide** affiche les comptes sur la
  page de connexion. Il est desactive **inconditionnellement** en production : la
  fonction renvoie `false` des que `NODE_ENV === "production"`. C'est une garantie,
  pas un reglage. Les mots de passe ne transitent jamais par le navigateur : seul
  l'email est envoye, le serveur resout le mot de passe.
- Aucun mot de passe n'est code en dur dans le depot : tout est dans `.env`, non
  versionne.

### 7.8 Les roles sont definis dans le code

`src/lib/rbac/roles.ts` est la source de verite. La base ne fait que refleter :
`npm run db:seed` **ajoute** les liaisons manquantes **et retire** les obsoletes.

**Modifier `roles.ts` sans relancer le seed ne change rien.** C'est le piege numero un
de ce depot.

---

## 8. Etat reel de la base aujourd'hui

### Comptes : 9, tous de bureau

Les **9 comptes de bureau** sont les comptes de travail reels : administrateur
systeme, direction, responsable production, responsable stock, responsable qualite,
acheteur, commercial, comptable, responsable RH. Aucun n'a de fiche employe — normal,
ces roles n'en ont pas besoin.

Les comptes et fiches d'atelier de test (operateurs, chefs, magasiniers) ont ete
retires : `npm run demo:purge` nettoie ces donnees de demonstration et de test.

### Fiches employes : aucune

**Aucune fiche employe n'existe en base.** C'est voulu : les fiches se creent soit
par la 6e etape d'import (`npm run import:csv`, tiers de nature « employe »), soit a
la main dans Ressources humaines vers Employes. Un compte operateur exige au
prealable une fiche employe reelle, avec son matricule et son usine.

### Referentiel importe

Depuis un ancien systeme (dossier `E:/Massiexporte`).

| Donnee | Creations | Etat |
|---|---|---|
| Tiers | 307 | **Tous de type `AUTRE`**, `isClient = false`, `isSupplier = false` |
| Articles | 706 | **Tous de type `COMPOSANT`** |
| Nomenclatures | 2 383 | 176 lignes rejetees |
| Lots et stocks | 704 | 2 lignes rejetees |
| Rejets au total | 188 | Chacun avec son motif exact dans Administration vers Import |

### Pourquoi tous les tiers sont en « Autre tiers »

Le fichier source porte un champ `Type` a deux valeurs (`0` et `1`) dont la
signification n'est pas documentee. L'import a refuse de la deviner, a applique le
repli `AUTRE` et a leve un avertissement « Correspondance a confirmer ». La
correspondance se regle dans **Administration vers Import** (modele
`ImportValueMapping`, champ `isConfirmed`). Les articles suivent exactement le meme
mecanisme, avec le repli `COMPOSANT`.

### Indicateurs commerciaux et industriels : deduits de la source

L'import renseigne desormais `isPurchasable`, `isSellable` et `isProducible` a
partir des colonnes explicites du fichier source, sans rien deviner :

| Indicateur | Regle appliquee par l'import |
|---|---|
| `isPurchasable` (achetable) | `IsRawMaterial` ou `IsComposableOnly` vrai |
| `isProducible` (fabriquable) | `IsBOM` vrai (article assemble par une nomenclature) |
| `isSellable` (vendable) | un prix de vente (`LPP`, `MinSP` ou `MaxSP`) renseigne, hors article hors service |

Sur le referentiel importe, cela ouvre environ 350 articles achetables, 280
fabricables et 420 vendables. Les devis, commandes et ordres de fabrication sont
donc creables sur ces articles ; l'administrateur ajuste article par article si
besoin.

### Objets metier : aucun

Zero ordre de fabrication, zero affectation, zero devis, zero commande, zero facture.
Seuls le referentiel et les stocks existent.

---

## 9. Ce que la plateforme ne fait pas

Verifie dans le schema et le code. Ces points n'existent pas.

| Sujet | Etat |
|---|---|
| **Sous-stock par etape d'operation** | **Absent.** Aucune quantite intermediaire n'est tenue entre deux etapes, et aucune valeur ne declenche quoi que ce soit. Ce qui existe : les drapeaux `Operation.consumesSemiFinished` / `producesSemiFinished` et `Article.isSemiFinished` — le concept est prevu dans le modele, mais sans quantite ni seuil. |
| **Declenchement automatique sur seuil** | **Absent.** Les seuls seuils sont `Operation.standardLossRate` (taux de perte theorique, pour le cout) et `Article.reorderPoint` (point de commande par article). Aucun des deux ne provoque d'action : ils servent a l'affichage. |
| **Import de fiches employes** | **Present (6e etape).** L'import compte desormais 6 etapes : familles, articles, tiers, **fiches de personnel**, nomenclatures, lots. L'etape « fiches de personnel » cree une fiche `Employee` pour chaque tiers dont la nature vaut EXPLICITEMENT `EMPLOYE` (correspondance confirmee par l'administrateur) ; elle ne cree **aucun compte d'acces** et ne devine aucune personne. A noter : `COM_FormulaEmpoyees.csv` reste reserve au **cout de main-d'oeuvre des nomenclatures**, pas au registre du personnel. |
| **Routes API** | **Aucune route `/api`.** Les operations serveur passent par 11 fichiers d'actions serveur. |
| **Comptes partages** | **Interdits par construction.** Une fiche qui possede deja un `userId` est refusee par le script de creation de compte. |

---

## 10. Les pieges du depot

| Piege | Symptome | Cause |
|---|---|---|
| Modifier `roles.ts` sans seed | Rien ne change | La base ne lit pas le fichier ; il faut `npm run db:seed` |
| Lancer `db:generate` avec le serveur ouvert | `EPERM … query_engine-windows.dll.node` | Le serveur tient la DLL du moteur Prisma |
| Commentaire `# Ctrl+C` dans PowerShell | Le Ctrl+C ne se produit pas | `#` est un commentaire en PowerShell |
| `$VAR` dans `.env` | Valeur developpee de travers | Next.js etend les `$VAR` dans `.env` |
| `#` dans un mot de passe | Fausse alerte | Inoffensif : dotenv garde `#` litteral dans une valeur entre guillemets, et l'application ne traite comme commentaire qu'une ligne **commencant** par `#` |
| Port 3000 occupe | `EADDRINUSE :::3000` | Un serveur tourne deja |

---

## 11. Commandes de reference

```bash
# Demarrage
npm run dev                    # serveur sur http://localhost:3000
npm run build                  # build de production

# Base de donnees
npm run db:generate            # client Prisma — arreter le serveur avant
npm run db:deploy              # applique les migrations
npm run db:seed                # referentiel + roles et permissions (idempotent)
npm run setup                  # generate + deploy + seed

# Comptes
npm run acces -- --liste
npm run acces -- --email=<adresse> --generer --roles=<ROLE> [--matricule=<matricule>]
npm run bootstrap:admin        # premier administrateur

# Import
npm run import:csv -- --dossier=E:/Massiexporte   # simulation, aucune ecriture
npm run import:csv -- --executer                  # import reel
npm run import:csv -- --executer --maj            # import reel + mise a jour

# Verification
npm run typecheck
npm test
```

---

## 12. Les fichiers structurants

| Chemin | Contenu |
|---|---|
| `GUIDE-PLATEFORME.md` | Guide utilisateur complet, 12 sections |
| `BRIEF-OPERATEURS.md` | Brief de transmission centre sur les operateurs |
| `RESUME-PLATEFORME.md` | Ce document : inventaire et logique |
| `src/lib/rbac/roles.ts` | Les 25 roles et leurs permissions |
| `src/lib/rbac/permissions.ts` | Les 99 permissions et les 12 modules |
| `src/lib/rbac/guard.ts` | Garde serveur |
| `src/lib/auth/session.ts` | Contenu de la session (`SessionUser`) |
| `src/components/navigation.ts` | Menu, filtrage, accueil par role |
| `src/app/(app)/portail/page.tsx` | Le portail employe |
| `src/app/(app)/tableau-de-bord/page.tsx` | Tableau de bord a blocs conditionnels |
| `src/lib/import/service.ts` | Les 6 importateurs (familles, articles, tiers, personnel, nomenclatures, lots) |
| `src/lib/production/service.ts` | Logique des ordres de fabrication |
| `src/lib/stock/service.ts` | Logique du stock |
| `prisma/schema.prisma` | 83 modeles |
| `prisma/seed.ts` | Referentiel, 9 depots, regle de transfert, roles |
| `creer-comptes-bureau.cmd` | Les 9 comptes de bureau, un clic |
| `npm run demo:purge` | Retire les donnees de demonstration / de test (audit en lecture seule ; suppression desactivee) |

---

## 13. Les decisions en attente

1. **Confirmer la correspondance du champ `Type` des tiers** — codes `0` et `1` :
   la nature « employe » doit etre confirmee pour que la 6e etape d'import cree les
   fiches de personnel. Une fois confirmee, relancer l'import avec `--maj`.
2. **Preciser l'usine des fiches de personnel importees** — elles arrivent en portee
   `COMMUN` ; indiquez `ADMEDCO` ou `MOBILIX` avant de les affecter en atelier.
3. **Ajuster, si besoin, les indicateurs commerciaux et industriels** — ils sont
   deduits de la source (voir section 8) et restent modifiables article par article.
4. **Trancher la contradiction de quantite sur `TB403010`** (0,250000 contre 1,600000),
   au statut « Ouvert » dans Nomenclature vers Ecarts.
5. **Creer les fiches employes reelles** — par l'import (6e etape) ou la saisie RH — puis rattacher chaque operateur a son compte.
6. **Corriger, le cas echeant, les 188 lignes rejetees** — visibles une par une, avec
   leur motif.

---

## 14. Resume en douze lignes

1. ERP + MES pour deux divisions, ADMEDCO (metal) et MOBILIX (bois et couture),
   reliees par un flux de chassis peints.
2. 108 pages, 13 modules, 12 sections de menu et 66 entrees.
3. 99 permissions, 12 modules de permissions, 3 portees d'usine, 25 roles.
4. **Un seul portail employe** (`/portail`, deux roles operateur) mais **18 accueils**,
   un par metier : il n'existe pas d'ecran commun.
5. Le cloisonnement est verifie cote serveur a quatre niveaux, et la permission est
   revérifiée dans la page, l'action serveur, l'API et la requete.
6. Masquer ne protege rien ; un bloc masque en CSS laisse la donnee dans le HTML, donc
   on rend conditionnellement.
7. Les roles sont definis dans le code et materialises uniquement par
   `npm run db:seed`, qui ajoute **et retire**.
8. 9 depots ; le stock est tenu par depot et par lot, un lot pouvant etre en
   quarantaine.
9. Le flux de production va du lancement d'ordre (nomenclature figee en copie) a
   l'affectation, l'execution, la declaration, le controle qualite, puis l'entree en
   stock.
10. La regle de transfert `POUDRAGE` fait passer le chassis peint de `DEP-MP` a
    `DEP-MP-MBX`, d'ADMEDCO vers MOBILIX : c'est la charniere entre les divisions.
11. Le portail employe tient trois garanties : borne a `employeeId`, aucune donnee
    salariale selectionnee, et declarer une perte ne bouge pas le stock.
12. Etat des donnees : referentiel importe (307 tiers, 706 articles, 2 383
    nomenclatures, 704 lots) mais **aucune fiche employe reelle** et **aucun document
    metier creatable** tant que les correspondances et les indicateurs ne sont pas
    actives.

> Mise a jour de securite : `demo:purge` est en lecture seule. `--executer` est refuse. Voir `ETAT-MISE-EN-SERVICE.md`.
