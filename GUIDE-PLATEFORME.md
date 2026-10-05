# Guide de la plateforme ERP MES — ADMEDCO / MOBILIX

> **À qui s'adresse ce document** : aux utilisateurs et aux administrateurs de la
> plateforme. Il explique ce que fait chaque module, comment circulent les
> données, qui a le droit de faire quoi, et comment se dépanner.
>
> Les deux autres documents du dossier sont destinés aux développeurs :
> `RAPPORT-FINAL.md` (rapport de développement) et `SPEC-INTERFACE.md`
> (conventions de code). Vous n'en avez pas besoin pour utiliser la plateforme.

---

## Table des matières

1. [Ce qu'est la plateforme](#1-ce-quest-la-plateforme)
2. [Démarrer et se connecter](#2-démarrer-et-se-connecter)
3. [Comment fonctionne l'accès](#3-comment-fonctionne-laccès)
4. [Les 25 rôles](#4-les-25-rôles)
5. [Les sections, une par une](#5-les-sections-une-par-une)
6. [Les trois circuits principaux](#6-les-trois-circuits-principaux)
7. [Les règles qui gouvernent tout](#7-les-règles-qui-gouvernent-tout)
8. [Recettes du quotidien](#8-recettes-du-quotidien)
9. [Comptes et boutons d'accès rapide](#9-comptes-et-boutons-daccès-rapide)
10. [Importer vos données réelles](#10-importer-vos-données-réelles)
11. [Dépannage](#11-dépannage)
12. [Commandes de référence](#12-commandes-de-référence)

---

## 1. Ce qu'est la plateforme

Un **ERP + MES** : la gestion administrative et commerciale (ERP) **plus** le
suivi réel de l'atelier (MES, *Manufacturing Execution System*). Les deux
divisions vivent dans la même base :

| Division | Métier | Périmètre |
|---|---|---|
| **ADMEDCO** | Fabrication métallique | Ateliers, postes, opérations |
| **MOBILIX** | Bois, couture et garnissage | Ateliers, postes, opérations |
| **COMMUN** | Transverse | Direction, stock, achats, ventes, finance, RH |

**Chiffres clés** : 108 pages, 83 modèles de données, **99 permissions**,
**25 rôles**, 3 dépôts (`DEP-MP`, `DEP-MP-MBX`, `DEP-PF`).

**Principe fondateur — aucune donnée simulée.** Chaque valeur affichée vient de
la base PostgreSQL. Aucun tableau de démonstration, aucun stock calculé dans le
navigateur, aucun bouton factice. Si une liste est vide, c'est que la donnée
n'existe pas encore — jamais parce que l'écran « fait semblant ».

---

## 2. Démarrer et se connecter

### Démarrage complet

```bash
# 1. Base de données (Docker Desktop doit être démarré)
docker start erpmes-postgres

# 2. Serveur de développement
npm run dev
```

Puis **http://localhost:3000** → redirection vers `/connexion`.

### Première installation (une seule fois)

```bash
docker run -d --name erpmes-postgres \
  -e POSTGRES_USER=erpmes -e POSTGRES_PASSWORD=erpmes_dev_pwd \
  -e POSTGRES_DB=erpmes -p 5433:5432 postgres:17

npm install
npm run setup                    # migrations + référentiel de base
npm run comptes -- --amorcer --domaine=admedco.dz   # comptes + mots de passe
npm run dev
```

### Ce que contient la base au départ

⚠️ **Important à comprendre avant de vous inquiéter de listes vides.**

`npm run setup` installe le **cadre**, pas des données d'exemple :

| Déjà installé par `npm run setup` | À importer ou à saisir par vous |
|---|---|
| Les 25 rôles et 99 permissions | **Les employés** |
| Unités, taux de TVA, paramètres | **Les articles** (hors catalogue de base) |
| Les 3 dépôts et leurs emplacements | Les clients et fournisseurs |
| Ateliers, opérations, postes de travail | Les nomenclatures et gammes |
| Le plan comptable, journaux, règles d'écriture | Les lots et les stocks |
| L'exercice fiscal et ses périodes | Les commandes, factures, écritures |
| La règle de transfert du châssis peint | |
| Les familles et le catalogue produit de base | |

Le script d'initialisation ne crée **aucune** fausse facture, aucun faux
employé, aucun stock fictif. C'est volontaire : une plateforme industrielle ne
doit jamais mélanger des données inventées avec les vôtres.

---

## 3. Comment fonctionne l'accès

### Le principe : tout est vérifié côté serveur

Le menu que vous voyez est filtré selon vos droits — mais **ce n'est qu'un
confort**. Chaque page, chaque bouton et chaque action **revérifie vos
permissions sur le serveur**. Masquer une entrée de menu ne protège rien : c'est
la vérification serveur qui protège.

Conséquence pratique : **taper une URL directement ne donne aucun accès
supplémentaire.** Si un collègue vous envoie le lien d'une page que vous n'avez
pas le droit d'ouvrir, vous arrivez sur `/aucun-acces`. Ce n'est pas une panne,
c'est le cloisonnement qui fonctionne.

### Les trois niveaux de cloisonnement

1. **Par permission** — 99 permissions fines (`STOCK_LIRE`,
   `PRODUCTION_VALIDER_DECLARATION`, `COMPTABILITE_LIRE`…). Un rôle possède une
   liste de permissions.
2. **Par usine** — un rôle `ADMEDCO` ne voit jamais une donnée `MOBILIX`, même
   par URL. Trois portées : `ADMEDCO`, `MOBILIX`, `COMMUN`.
3. **Par atelier** — un opérateur ne voit que son atelier.
4. **Par personne** — sur `/portail`, toutes les requêtes sont bornées sur
   *votre* fiche employé. Le portail n'affiche jamais les données d'un autre.

### Le tableau de bord s'adapte au rôle

Le tableau de bord n'est pas un écran unique que tout le monde regarde. Chaque
bloc n'est **rendu** que pour qui détient la lecture correspondante : un
comptable ne reçoit ni les chiffres de production ni l'état des stocks, un
responsable d'atelier ne reçoit pas la trésorerie.

Sept blocs sont concernés — activité commerciale, encours et trésorerie,
production, qualité, stocks et achats, ressources humaines — ainsi que les cinq
cartes d'alerte. Pour ceux qui n'y ont pas droit, ces blocs sont **absents du
HTML**, pas simplement grisés ni repliés : un bloc masqué en CSS laisserait les
chiffres lisibles dans le code de la page.

**En résumé : aucune reconnexion n'est nécessaire après un changement de droits.
Les permissions sont relues en base à chaque requête.**

### Les données protégées en plus

- **Les salaires** ne sont visibles que par les rôles RH autorisés. Sur le
  portail employé, les colonnes de rémunération ne sont même pas lues en base.
- **Le journal d'audit** conserve qui a fait quoi, quand, et pourquoi.

---

## 4. Les 25 rôles

| Code | Libellé | Portée | Ouvre |
|---|---|---|---|
| `ADMIN_SYSTEME` | Administrateur système | Commun | Tout |
| `DIRECTION` | Propriétaire / Direction | Commun | Tableaux de bord, lecture globale |
| `RESPONSABLE_USINE` | Responsable d'usine | Commun | Production, stock, qualité |
| `RESPONSABLE_ADMEDCO` | Responsable ADMEDCO | ADMEDCO | Périmètre ADMEDCO |
| `RESPONSABLE_MOBILIX` | Responsable MOBILIX | MOBILIX | Périmètre MOBILIX |
| `RESPONSABLE_PRODUCTION` | Responsable production | Commun | OF, kanban, déclarations |
| `OPERATEUR_ADMEDCO` | Opérateur ADMEDCO | ADMEDCO | **`/portail`** |
| `OPERATEUR_MOBILIX` | Opérateur MOBILIX | MOBILIX | **`/portail`** |
| `RESPONSABLE_STOCK` | Responsable stock | Commun | Stock, transferts, inventaire |
| `MAGASINIER` | Magasinier | Commun | Réceptions, mouvements, inventaire |
| `RESPONSABLE_QUALITE` | Responsable qualité | Commun | Contrôles, non-conformités, libération |
| `ACHETEUR` | Acheteur | Commun | Demandes, commandes, réceptions, factures |
| `COMMERCIAL` | Commercial | Commun | Devis, commandes, livraisons, factures |
| `COMPTABLE` | Comptable | Commun | Écritures, balance, règlements |
| `RESPONSABLE_FINANCIER` | Responsable financier | Commun | Finance, règlements, validation |
| `RESPONSABLE_RH` | Responsable RH | Commun | Employés, affectations, présences, évaluations |
| `AUDITEUR` | Auditeur | Commun | Lecture seule + journal d'audit |
| `LECTURE_SEULE` | Utilisateur lecture seule | Commun | Consultation |

### Où chaque rôle arrive après connexion

Il n'y a pas d'écran d'accueil commun : chaque rôle ouvre directement son propre
métier. La correspondance est déclarée dans `ACCUEIL_PAR_ROLE`
(`src/components/navigation.ts`).

| Rôle | Page d'accueil |
|---|---|
| `ADMIN_SYSTEME`, `DIRECTION`, `AUDITEUR` | `/tableau-de-bord` |
| `RESPONSABLE_USINE`, `RESPONSABLE_ADMEDCO`, `RESPONSABLE_MOBILIX` | `/tableau-de-bord/production` |
| `RESPONSABLE_PRODUCTION` | `/production` |
| `OPERATEUR_ADMEDCO`, `OPERATEUR_MOBILIX` | `/portail` |
| `RESPONSABLE_STOCK`, `MAGASINIER` | `/stock` |
| `RESPONSABLE_QUALITE` | `/qualite` |
| `ACHETEUR` | `/achats/demandes` |
| `COMMERCIAL` | `/ventes/devis` |
| `COMPTABLE`, `RESPONSABLE_FINANCIER` | `/comptabilite/ecritures` |
| `RESPONSABLE_RH` | `/rh/employes` |
| `LECTURE_SEULE` | `/referentiel/articles` |

Si la permission d'une page d'accueil est retirée à un rôle, la connexion ne
casse pas : l'utilisateur retombe sur sa première page réellement accessible.

### Quelles sections chaque rôle voit

| Rôle | Sections ouvertes |
|---|---|
| `ADMIN_SYSTEME` | **Les 12 sections** |
| `DIRECTION` | Pilotage (les 4), Référentiel (les 5), Nomenclature (les 3), Stocks (état, mouvements), Production (OF, kanban), Qualité (les 3), Achats, Ventes, Finance (écritures, balance, règlements), RH (employés, affectations, présences, évaluations), Administration (import, audit) |
| `RESPONSABLE_USINE` | Pilotage (tableau de bord, pilotage production), Référentiel (articles, familles, tiers, dépôts), Nomenclature (les 3), Stocks (les 5), Production (les 3), Qualité (les 3), Achats, RH (les 5) |
| `RESPONSABLE_ADMEDCO` | Comme `RESPONSABLE_USINE`, sans Compétences RH — et borné à ADMEDCO |
| `RESPONSABLE_MOBILIX` | Comme `RESPONSABLE_USINE`, sans Compétences RH — et borné à MOBILIX |
| `RESPONSABLE_PRODUCTION` | Pilotage (tableau de bord, pilotage production), Référentiel (articles, familles, tiers, dépôts), Nomenclature (les 3), Stocks (état, mouvements, transferts), Production (les 3), Qualité (contrôles, non-conformités), RH (employés, affectations, présences, évaluations) |
| `OPERATEUR_ADMEDCO`, `OPERATEUR_MOBILIX` | Mon espace, Référentiel (articles, dépôts), Nomenclature (nomenclatures), Stocks (état, mouvements), Production (OF, kanban), Qualité (contrôles, non-conformités), RH (affectations) |
| `RESPONSABLE_STOCK` | Pilotage (tableau de bord, pilotage production), Référentiel (les 5), Nomenclature (les 3), Stocks (les 5), Production (OF, kanban), Qualité (contrôles, non-conformités), Achats |
| `MAGASINIER` | Référentiel (articles, familles, dépôts), Nomenclature (nomenclatures), Stocks (les 5), Production (OF, kanban), Qualité (contrôles, non-conformités), Achats |
| `RESPONSABLE_QUALITE` | Pilotage (tableau de bord), Référentiel (articles, familles, tiers, dépôts), Nomenclature (les 3), Stocks (état, mouvements, lots), Production (OF, kanban), Qualité (les 3) |
| `ACHETEUR` | Pilotage (tableau de bord), Référentiel (les 5), Nomenclature (les 3), Achats — **pas de Ventes** |
| `COMMERCIAL` | Pilotage (tableau de bord), Référentiel (les 5), Nomenclature (les 3), Ventes — **pas d'Achats** |
| `COMPTABLE` | Pilotage (tableau de bord, pilotage finance), Référentiel (articles, familles, tiers, dépôts), Nomenclature (les 3), Achats, Ventes, Finance (écritures, balance, règlements, plan comptable) |
| `RESPONSABLE_FINANCIER` | Comme `COMPTABLE`, plus Finance (règles d'écriture) et Administration (journal d'audit) |
| `RESPONSABLE_RH` | Pilotage (tableau de bord, pilotage RH) et RH (les 5) — **rien d'autre** |
| `AUDITEUR` | Tout en lecture sauf Paramètres : Pilotage (tableau de bord), Référentiel (les 5), Nomenclature (les 3), Stocks (état, mouvements), Production (OF, kanban), Qualité (contrôles, non-conformités), Achats, Ventes, Finance (écritures, balance, règlements), RH (les 5), Administration (utilisateurs, rôles, import, audit) |
| `LECTURE_SEULE` | Pilotage (tableau de bord), Référentiel (articles, familles, dépôts), Nomenclature (les 3), Stocks (état, mouvements), Production (OF, kanban) |

« Les 3 » désigne une section entièrement ouverte ; « les 5 » vaut pour le
Référentiel (articles, familles, tiers, dépôts, tarifs) comme pour les Stocks
(état, mouvements, transferts, inventaire, lots) et les RH (employés,
affectations, présences, évaluations, compétences).

Les ensembles de permissions sont définis dans **`src/lib/rbac/roles.ts`**. Ils
sont **matérialisés en base par le seed** : après avoir modifié ce fichier, il
faut lancer `npm run db:seed` — voir
[« J'ai modifié un rôle, rien ne change »](#jai-modifié-un-rôle-rien-ne-change).

⚠️ **Deux rôles seulement ouvrent le portail atelier** : `OPERATEUR_ADMEDCO` et
`OPERATEUR_MOBILIX`.

**Le portail employé exige une fiche employé.** Un compte opérateur sans fiche
employé liée affiche : *« Votre compte utilisateur n'est rattaché à aucune fiche
employé. »* Il faut alors rattacher le compte à un matricule.

---

## 5. Les sections, une par une

### 📊 Pilotage

Quatre tableaux de bord, chacun derrière sa permission :

| Page | Contenu |
|---|---|
| **Tableau de bord** | Indicateurs consolidés des deux divisions |
| **Pilotage production** | Avancement des OF, charge des ateliers, rebuts |
| **Pilotage finance** | Chiffre d'affaires, encours, règlements |
| **Pilotage RH** | Présences, heures, évaluations |

### 👷 Mon espace — le portail employé

Écran simplifié, utilisé **au poste, dans l'atelier**. Sept actions :

**Démarrer** · **Mettre en pause** · **Reprendre** · **Déclarer une quantité** ·
**Déclarer une perte** · **Signaler un problème** · **Terminer**

Et pour clôturer un ordre : **Clôturer l'ordre**.

Ce qu'un opérateur **ne peut pas** faire depuis le portail : modifier une
opération validée, toucher au stock, aux nomenclatures, aux coûts, voir les
salaires, ni consulter un autre atelier.

> **Déclarer une perte** enregistre la perte **sans sortie de stock** : c'est un
> signalement, pas un mouvement. La régularisation de stock est un acte
> distinct, réservé au magasin.

### 📋 Référentiel

Les données de base, réutilisées partout ailleurs.

- **Articles** — états : Actif, Inactif, Archivé, Non commercialisable, Non
  productible. Indicateurs : productible, vendable, semi-fini, kit.
- **Familles d'articles** — hiérarchiques.
- **Clients et fournisseurs** — un tiers peut être client, fournisseur, employé
  ou autre.
- **Dépôts et emplacements** — `DEP-MP` (matières), `DEP-MP-MBX` (transfert vers
  MOBILIX), `DEP-PF` (produits finis).
- **Tarifs et prix**.

### 🔧 Nomenclature et gammes

- **Nomenclatures** (BOM) — **versionnées**. Cycle : Brouillon → En validation →
  Validée → Active → Remplacée → Archivée. Une nomenclature utilisée par un
  ordre de fabrication **n'est jamais modifiée en silence** : on crée une
  nouvelle version, et l'ordre garde une copie figée de ce qu'il a consommé.
- **Écarts de quantité** — quand deux sources se contredisent, la plateforme
  **n'arbitre pas toute seule**. Elle ouvre un écart avec les deux valeurs, la
  différence et son origine, et attend une décision humaine.
- **Gammes de fabrication** — la suite d'opérations, avec leurs postes.

### 📦 Stocks

Le stock n'est **jamais** modifié en écrivant une quantité. Tout passe par un
**grand livre de mouvements**.

| Page | Rôle |
|---|---|
| **État des stocks** | Soldes par article et par dépôt |
| **Mouvements de stock** | Le grand livre : qui, quoi, quand, pourquoi |
| **Transferts inter-ateliers** | D'un dépôt à l'autre |
| **Inventaire physique** | Comptage et régularisation |
| **Lots et traçabilité** | Traçabilité amont/aval par lot |

**Sept états de stock** : physique · disponible · réservé · bloqué · endommagé ·
quarantaine · en production. **18 types de mouvement.** Sortie **FIFO** par lot,
coût moyen pondéré.

**Refus automatiques** : une sortie supérieure au disponible, ou la consommation
d'un article **bloqué** ou **en quarantaine**, sont rejetées.

### 🏭 Production

- **Ordres de fabrication** — 10 statuts. Quantités suivies : prévue, lancée,
  produite, conforme, rebutée, en reprise, restante.
- **Kanban atelier** — **6 colonnes pour ADMEDCO, 12 pour MOBILIX**. Déplacer
  une carte n'est pas un simple glisser-déposer : c'est une **opération métier
  tracée** (ancienne étape, nouvelle étape, utilisateur, horodatage, quantité,
  commentaire, consommations, pertes, résultat qualité). Le kanban est
  persistant : il survit au rechargement.
- **Déclarations à valider** — le responsable contrôle ce que l'atelier a
  déclaré avant que cela compte.

**Fin de `POUDRAGE`** : la plateforme valide la quantité réellement produite,
consomme le réel, crée le stock de châssis peints (`SF-CHASSIS-PEINT`), effectue
le mouvement `TRANSFERT_INTER_ATELIERS` de `DEP-MP` vers `DEP-MP-MBX`, et met la
quantité à disposition de MOBILIX.

> **Résolution du semi-fini** : avant de créer l'article « châssis peint », la
> plateforme cherche un **équivalent déjà importé**. Un équivalent **unique** est
> adopté ; plusieurs équivalents ne sont **jamais** départagés en silence.
> L'administrateur confirme l'article retenu dans **Administration →
> Paramètres**. L'import CSV signale la correspondance sans jamais créer
> d'article absent du fichier.

### ✅ Qualité

- **Contrôles qualité** — à la réception et en production.
- **Non-conformités** — déclaration, traitement, suivi.
- **Articles à libérer** — la **libération du produit fini**.

⚠️ **Règle dure : un produit fabriqué n'est ni vendable ni livrable avant sa
libération qualité.** C'est un verrou, pas une recommandation. La sortie de
stock à l'expédition est refusée sans libération.

À la réception fournisseur, quatre issues : **Accepté**, **Accepté sous réserve**,
**Quarantaine**, **Rejeté**.

### 🛒 Achats

**Demande d'achat** → demande de prix → **commande fournisseur** → **réception**
(partielle possible) → **contrôle qualité** → **facture fournisseur** →
**règlement**.

Avec **rapprochement trois voies** (commande / réception / facture), retours et
avoirs fournisseur.

### 💼 Ventes

**Client** → **devis** → **commande client** → **ordre de fabrication généré
automatiquement** → production → **bon de livraison** → **facture client** →
**règlement**.

> À la confirmation d'une commande client, la plateforme génère les ordres de
> fabrication des lignes configurées et **rapporte les échecs ligne par ligne**.
> Elle ne saute jamais une ligne en silence.

Avoir possible sur facture déjà comptabilisée.

### 💰 Finance et comptabilité

- **Écritures comptables** — générées **uniquement** sur des événements validés.
- **Balance et grand livre**.
- **Règlements**.
- **Règles d'écriture** — configurables. Aucune règle légale n'est inventée par
  la plateforme : c'est vous qui les définissez.
- **Plan comptable et journaux**.

⚠️ **Aucune écriture postée n'est supprimée.** On corrige par
**contre-passation**, **avoir**, **annulation contrôlée**, ou **nouvelle
écriture** — toujours avec un commentaire obligatoire.

### 👥 Ressources humaines

**Employés** (chacun son propre compte, jamais de compte partagé) ·
**fonctions** · **compétences et niveaux** · **affectations quotidiennes** ·
**présences** (présence, absence, retard, congés, heures, heures
supplémentaires) · **évaluations**.

**Évaluation automatique** — les pondérations sont **paramétrables, pas codées
en dur** : Productivité 30 %, Qualité 25 %, Efficacité matière 20 %, Présence
15 %, Polyvalence 10 %. 22 indicateurs, périodes jour/semaine/mois/atelier/
opération, validation par le manager, correction justifiée, export.

> Un employé n'est **jamais** évalué sur la norme d'une opération qu'il n'a pas
> réellement effectuée. Quand les données sont insuffisantes, la plateforme le
> signale (indice de fiabilité) au lieu de produire une note trompeuse.

### ⚙️ Administration

| Page | Usage |
|---|---|
| **Utilisateurs** | Créer les comptes, attribuer les rôles, réinitialiser un mot de passe |
| **Rôles et permissions** | Contrôler ce que chaque rôle peut faire |
| **Paramètres** | Devise, TVA, pondérations d'évaluation, article du châssis peint… |
| **Import de données** | Charger les CSV réels, consulter le journal d'import |
| **Journal d'audit** | Qui a fait quoi, quand, et pourquoi |

### 🔎 Autres

- **Mon compte** — votre profil, et **Mot de passe** pour le changer.
- **Recherche globale** — recherche transverse.

---

## 6. Les trois circuits principaux

### ① Vendre → Fabriquer → Livrer → Facturer

```
1. Référentiel → Clients et fournisseurs    créer ou importer le client
2. Ventes → Devis                            établir l'offre
3. Ventes → Commandes client                 confirmer
   └─► les ordres de fabrication sont créés automatiquement
4. Production → Ordres de fabrication         suivre l'avancement
   Production → Kanban atelier               l'atelier fait avancer les cartes
   └─► l'opérateur déclare depuis /portail
5. Production → Déclarations à valider        le responsable valide
6. Qualité → Contrôles, puis Articles à libérer
   └─► VERROU : rien n'est livrable avant libération
7. Ventes → Bons de livraison                 expédier (sortie de stock réelle)
8. Ventes → Factures client                   facturer
9. Comptabilité → Règlements                  encaisser
```

### ② Acheter → Réceptionner → Contrôler → Payer

```
1. Achats → Demandes d'achat                  le besoin
2. Achats → Bons de commande fournisseur      la commande
3. Achats → Réceptions fournisseur            la livraison (partielle acceptée)
4. Qualité → contrôle à la réception
   └─► Accepté / Accepté sous réserve / Quarantaine / Rejeté
5. Achats → Factures fournisseur              la facture
6. Comptabilité → Règlements                  rapprochement trois voies puis paiement
```

### ③ L'atelier, au quotidien

```
1. RH → Affectations quotidiennes             affecter l'employé aux opérations du jour
2. L'opérateur ouvre /portail
     Démarrer → (Pause / Reprendre) → Déclarer une quantité
     → Déclarer une perte si besoin → Terminer
3. Production → Déclarations à valider        le responsable contrôle
4. Qualité → Articles à libérer               le produit devient vendable
5. Fin de POUDRAGE : transfert automatique du châssis peint
   DEP-MP → DEP-MP-MBX, mis à disposition de MOBILIX
```

---

## 7. Les règles qui gouvernent tout

Ces six règles expliquent la plupart des comportements qui surprennent au début.

1. **Rien n'est jamais supprimé.** Une erreur est annulée par une écriture ou un
   mouvement **inverse**. L'original reste lisible pour toujours.
2. **On ne tape jamais une quantité de stock.** Toute variation est un mouvement
   au grand livre, horodaté et signé.
3. **Les actes sensibles exigent un motif écrit** — correction, annulation,
   contre-passation, libération qualité. Le motif est vérifié côté serveur, pas
   seulement dans le formulaire.
4. **Aucune contradiction n'est résolue automatiquement.** Un désaccord de
   quantité ouvre un **écart** avec les deux valeurs et attend un arbitrage
   humain.
5. **Les nomenclatures sont versionnées**, jamais modifiées en place. Un ordre de
   fabrication garde la copie figée de ce qu'il a réellement consommé.
6. **Cinq échecs de connexion verrouillent le compte 15 minutes.**

---

## 8. Recettes du quotidien

| Je veux… | Où aller |
|---|---|
| Voir l'activité globale | Pilotage → Tableau de bord |
| Savoir combien il me reste d'un article | Stocks → État des stocks |
| Comprendre **pourquoi** un stock a bougé | Stocks → Mouvements de stock |
| Corriger une quantité de stock | Stocks → Inventaire physique (jamais une saisie directe) |
| Envoyer de la matière à MOBILIX | Stocks → Transferts inter-ateliers |
| Voir où en est une commande client | Ventes → Commandes client → la commande |
| Facturer ce qui est parti | Ventes → Factures client |
| Savoir ce que l'atelier a déclaré aujourd'hui | Production → Déclarations à valider |
| Libérer un produit fini | Qualité → Articles à libérer |
| Voir ce qu'un opérateur a fait ce matin | RH → Présences, ou le journal d'audit |
| Créer un compte pour un nouvel arrivant | Administration → Utilisateurs |
| Vérifier qui a modifié une donnée | Administration → Journal d'audit |
| Changer mon mot de passe | Mon compte → Mot de passe |
| Chercher quelque chose sans savoir où | Recherche globale |

---

## 9. Comptes et boutons d'accès rapide

### Le principe

Chaque personne a **son propre compte**. Aucun compte partagé n'est créé — ni
par les scripts, ni par l'import. Toute action est rattachée à l'identité réelle
de la personne connectée.

### Les boutons de la page de connexion

Pendant le développement, la page `/connexion` affiche un bloc **« Accès rapide
— développement uniquement »** : un bouton par compte, pour ne plus ressaisir ses
identifiants.

**Comment ça marche** : vous cliquez, la plateforme se connecte. Le mot de passe
ne quitte **jamais** le serveur — le navigateur n'envoie que l'adresse du compte.

**Où sont les mots de passe** : dans `.env`, jamais dans le code. Le bouton
disparaît **toujours** en production (`NODE_ENV=production`), même si la variable
est restée à `true`.

```ini
AUTH_ACCES_RAPIDE="true"
AUTH_ACCES_RAPIDE_COMPTES="Libellé|adresse@admedco.dz|MotDePasse;Autre|...|..."
```

Pour désactiver le bloc sans effacer la liste : `AUTH_ACCES_RAPIDE="false"`.

### Créer un compte

```bash
# Compte de bureau, mot de passe choisi par la plateforme (recommandé)
npm run acces -- --email=production@admedco.dz --generer --roles=RESPONSABLE_PRODUCTION

# Compte rattaché à un employé existant (obligatoire pour le portail atelier)
npm run acces -- --email=operateur1@admedco.dz --generer --roles=OPERATEUR_ADMEDCO --matricule=EMP-0007

# Voir tous les comptes
npm run acces -- --liste
```

La commande **inscrit le compte dans `.env`** en conservant les autres entrées :
aucune recopie manuelle. **Redémarrez `npm run dev`** ensuite pour que le bouton
apparaisse.

### Les autres commandes de comptes

```bash
npm run comptes -- --liste                        # comptes existants
npm run comptes -- --amorcer --domaine=admedco.dz # tout créer d'un coup
npm run comptes -- --desactiver --domaine=...     # fin de revue d'accès
```

### ⚠️ La politique de mot de passe

Un mot de passe doit contenir **au moins 12 caractères**, une minuscule, une
majuscule, un chiffre et un caractère spécial, **et ne doit contenir aucun de ces
mots** :

> `password` · `motdepasse` · `azerty` · `qwerty` · `123456` · `admin` ·
> `erpmes` · `admedco` · `mobilix`

**C'est le piège le plus courant.** Un mot de passe comme `<mot-de-passe-refuse>`
est **refusé** : il contient `admin` *et* `admedco`. Le script de comptes ne
proteste pas, il **génère un autre mot de passe à la place** et l'affiche une
seule fois.

**Bon réflexe** : utilisez `--generer` et laissez la plateforme choisir.

---

## 10. Importer vos données réelles

Les fichiers CSV sont lus depuis le dossier défini par `CSV_SOURCE_DIR`
(`E:/Massiexporte` par défaut), séparateur `;`.

```bash
# 1. SIMULATION — analyse, rapport de colonnes, doublons, lignes rejetées.
#    N'ÉCRIT RIEN EN BASE. Toujours commencer par là.
npm run import:csv -- --dossier=E:/Massiexporte

# 2. Import réel
npm run import:csv -- --executer

# 3. Import réel en autorisant la mise à jour des fiches déjà modifiées
npm run import:csv -- --executer --maj

# Tout d'un coup
npm run import:all
```

L'import crée aussi les **fiches de personnel** à partir des tiers de nature
« employé » (aucun compte d'accès n'est créé).

**Ordre des dépendances** (respecté automatiquement) : familles d'articles →
articles → tiers → fiches de personnel → nomenclatures/formules → composants →
lots et stocks.

**Garanties de l'import** :

- **Ré-exécutable sans doublon** — clé stable « système source + entité +
  identifiant d'origine ».
- **Une fiche absente du CSV n'est jamais supprimée** — elle est archivée ou
  passée en inactif.
- **Une fiche modifiée dans l'application n'est jamais écrasée** sans `--maj`.
- **Les valeurs inconnues ne sont jamais devinées** (type de tiers, type
  d'article) : elles sont signalées et une correspondance doit être **confirmée
  par l'administrateur**.
- **Les accents et libellés d'origine sont préservés.**
- Chaque exécution produit un **journal d'import** et **conserve les lignes
  rejetées**.

⚠️ **L'import ne crée aucun accès.** Importer les employés ne crée pas leurs
comptes : c'est une décision distincte, prise depuis **Administration →
Utilisateurs**.

### Ce que l'import refuse de décider

Après un import réussi, la plateforme vous attend sur deux points. Ce n'est pas
un défaut d'import : c'est la règle « aucune valeur n'est devinée » appliquée
jusqu'au bout.

**1. Les correspondances de valeurs.** Quand la source code une information
(« Type = 1 »), la plateforme applique une **valeur de repli documentée** et
écrit un avertissement `Correspondance a confirmer`. Tant que l'administrateur
n'a pas tranché dans **Administration → Import**, la valeur de repli reste en
place.

| Entité | Champ source | Repli appliqué | Conséquence tant que ce n'est pas confirmé |
|---|---|---|---|
| Tiers | `Type` | `AUTRE` | Le tiers n'est **ni client ni fournisseur** : impossible de l'utiliser sur un devis, une commande, une livraison ou une facture |
| Article | `Type` | `COMPOSANT` | Aucun article n'est `PRODUIT_FINI` ni `SEMI_FINI` |
| Article | `UnitOfMeasure` | `PCS` | Unité de gestion approxative |
| Tiers | `MethodOfPayment` | *(vide)* | Mode de règlement absent |

**2. L'activation commerciale et industrielle.** La plateforme n'active **jamais**
ces trois indicateurs à votre place, même quand la source les fournit :

`isPurchasable` (achetable) · `isSellable` (vendable) · `isProducible` (fabriquable)

Ils restent à **non** sur tous les articles importés. C'est délibéré : décider
qu'un article se vend, s'achète ou se fabrique est une décision de gestion, pas
une donnée technique. Ils s'activent **article par article**, sur la fiche de
l'article (**Référentiel → Articles → l'article**).

⚠️ **Conséquence à connaître** : juste après un import, et tant que ces deux
points ne sont pas traités, vous ne pouvez créer **aucun** devis, commande
d'achat, commande client ni ordre de fabrication — les listes de sélection sont
vides. Ce n'est pas une panne : c'est la plateforme qui refuse de vendre un
article qu'on ne lui a pas déclaré vendable.

**Ordre de travail conseillé après un premier import** :

1. **Administration → Import** → confirmer les correspondances signalées.
2. Relancer `npm run import:csv -- --executer --maj` pour que les valeurs
   confirmées s'appliquent aux fiches déjà importées.
3. **Référentiel → Articles** → activer *vendable* / *achetable* / *fabriquable*
   sur les articles réellement concernés — inutile de traiter les 706, seuls
   ceux que vous utilisez comptent.
4. Alors seulement : premiers devis, commandes et ordres de fabrication.

### Les lignes rejetées

Un import se termine toujours par un compteur `rejetees`. Ces lignes ne sont ni
perdues ni corrigées en silence :

```
Lignes lues .................... 7079
Enregistrements crees .......... 307
Enregistrements mis a jour ..... 3836
Fiches protegees ............... 0
Lignes vides ignorees .......... 2742
Lignes rejetees ................ 188
```

- **Lignes rejetées** — la donnée était inexploitable (quantité absente, article
  parent introuvable, référence cassée). Le **motif exact de chaque rejet** est
  dans **Administration → Import**, avec la ligne source d'origine.
- **Lignes vides ignorées** — le fichier contenait des lignes sans aucune
  donnée. Rien à importer, ce n'est pas une erreur.
- **Fiches protégées** — la fiche a été modifiée dans la plateforme après le
  dernier import. Elle n'est **pas** écrasée, sauf si vous lancez avec `--maj`.

Les rejets ne bloquent pas l'import : les autres lignes passent. Corrigez la
source, ou saisissez les lignes concernées à la main.

---

## 11. Dépannage

### « La base de données n'est pas joignable »

**Cause** : PostgreSQL n'est pas démarré. C'est de très loin l'erreur la plus
fréquente.

```bash
# 1. Démarrez Docker Desktop, attendez « Engine running »
# 2. Puis :
docker start erpmes-postgres
```

Si le conteneur n'existe pas, recréez-le avec la commande `docker run` du
[§2](#2-démarrer-et-se-connecter).

### « Une erreur inattendue est survenue »

Message générique. Regardez le terminal où tourne `npm run dev` : c'est là que
l'erreur réelle s'affiche. Le plus souvent, la base est injoignable (voir
ci-dessus).

### « Adresse électronique ou mot de passe incorrect »

Le message est **volontairement identique** dans tous les cas d'échec — la
plateforme ne dit jamais si un compte existe ou non. Trois causes possibles :

1. **Le mot de passe est faux.** S'il a été généré par un script, il n'a été
   affiché **qu'une fois**. S'il est perdu :
   ```bash
   npm run acces -- --email=adresse@admedco.dz --generer
   ```
2. **Le compte n'existe pas.** Vérifiez : `npm run acces -- --liste`.
3. **Le mot de passe enregistré dans `.env` n'est plus le bon** — typiquement
   après un changement de mot de passe. Corrigez la ligne
   `AUTH_ACCES_RAPIDE_COMPTES`.

### Le compte est verrouillé

Après **5 échecs**, le compte est verrouillé **15 minutes**. Le débloquer
immédiatement :

```bash
npm run acces -- --email=adresse@admedco.dz --generer
```

### Zéro compte, impossible de se connecter

Aucun compte n'existe. Créez-en un :

```bash
npm run acces -- --email=admin@admedco.dz --generer
```

### Le portail employé refuse de s'ouvrir

*« Votre compte utilisateur n'est rattaché à aucune fiche employé. »*

Le compte doit être rattaché à un **matricule existant**. Vérifiez que la fiche
existe (**RH → Employés**), puis rattachez le compte depuis
**Administration → Utilisateurs**.

### `P1001: Can't reach database server at localhost:5433`

Voir « La base de données n'est pas joignable ».

### `EPERM: operation not permitted, rename … query_engine-windows.dll.node`

Le serveur `npm run dev` tient le moteur Prisma. **Arrêtez-le** (Ctrl+C) avant de
lancer `npm run setup`, puis relancez-le.

### `EADDRINUSE :::3000`

Un ancien serveur occupe encore le port 3000. Fermez-le, ou lancez
`npm run dev -- -p 3001`.

### L'import rejette **toutes** les lignes de tiers

**Symptôme** : des centaines de fois dans le terminal, puis un compteur sans
appel :

```
prisma:error
Invalid `tx.thirdParty.create()` invocation in src/lib/import/service.ts:1074:35
Unknown argument `birthDate`. Available options are marked with ?.
...
  lues=343 inserees=0 maj=0 protegees=0 ignorees=0 rejetees=343
```

**Cause** : le modèle `ThirdParty` ne déclarait pas les colonnes `birthDate` et
`gender`, alors que le fichier source les fournit — le fichier historique range
les personnes physiques et les sociétés dans une seule table. Les champs
`firstName`, `lastName`, `socialSecurityNumber` et `ccp` étaient bien présents :
c'était un oubli sur ces deux-là.

⚠️ **Ne cherchez pas l'erreur dans vos CSV** : ces lignes sont bonnes.
`npm run typecheck` ne la voit pas non plus — dans le script d'import, l'objet
est construit dans une variable avant d'être passé à `create()`, et TypeScript
ne contrôle les propriétés excédentaires que sur les littéraux. Seul le moteur
Prisma, à l'exécution, refuse.

**Correction** : les deux colonnes ont été ajoutées au modèle, et une migration
écrite dans `prisma/migrations/20260928103000_third_party_person_fields/`.
Colonnes nullables, ajout purement additif : aucune donnée existante n'est
touchée.

```bash
# 1. Arrêtez npm run dev (Ctrl+C) : le serveur tient le moteur Prisma
npm run db:deploy       # applique la migration en attente
npm run db:generate     # régénère le client Prisma
npm run dev
```

Puis **relancez l'import** : `npm run import:csv -- --executer`. L'import est
ré-exécutable sans doublon — les 3 803 enregistrements déjà créés seront ignorés
et les 343 tiers enfin insérés. Vérifiez que `rejetees` retombe à ~179.

### La liste est vide

Ce n'est probablement pas une panne : la donnée n'a pas encore été importée ou
saisie. Voir [§2](#2-démarrer-et-se-connecter) et
[§10](#10-importer-vos-données-réelles).

### J'ai modifié un rôle, rien ne change

Les rôles système sont **définis par le code**, dans `src/lib/rbac/roles.ts`. La
base ne fait que refléter cette définition. Modifier le fichier ne suffit donc
pas : il faut réécrire les liaisons rôle ↔ permission.

```bash
npm run db:seed
```

Le seed **ajoute** les permissions manquantes **et retire** celles qui ne sont
plus déclarées. Sans cette seconde partie, resserrer un rôle n'aurait aucun
effet : la base continuerait d'accorder des droits que le code refuse. La ligne
de sortie le dit :

```
Roles ....................... 18 verifie(s), 0 liaison(s) ajoutee(s), 12 obsolete(s) retiree(s)
```

Aucune reconnexion n'est nécessaire : les permissions sont relues en base à
chaque requête. Rechargez simplement la page.

### Un collègue ne voit pas un menu

Normal : son rôle n'a pas la permission. Ce n'est pas un bug d'affichage, c'est
le cloisonnement. Vérifiez ce que son rôle autorise dans
**Administration → Rôles et permissions**, et la matrice de
[§4](#quelles-sections-chaque-rôle-voit).

S'il devrait voir ce menu mais ne le voit toujours pas, c'est que les
permissions du code n'ont pas été reportées en base : voir l'entrée ci-dessus.

---

## 12. Commandes de référence

```bash
# --- Démarrage ---
npm run dev                    # serveur sur http://localhost:3000
npm run build                  # build de production
npm run start                  # serveur de production

# --- Base de données ---
npm run db:generate            # client Prisma
npm run db:deploy              # applique les migrations
npm run db:seed                # référentiel + rôles et permissions (idempotent)
npm run db:studio              # explorateur de base
npm run setup                  # generate + deploy + seed

# --- Comptes ---
npm run acces -- --liste
npm run acces -- --email=... --generer [--roles=...] [--matricule=...]
npm run comptes -- --liste
npm run comptes -- --amorcer --domaine=admedco.dz
npm run comptes -- --desactiver --domaine=admedco.dz

# --- Import ---
npm run import:csv -- --dossier=E:/Massiexporte   # simulation, aucune écriture
npm run import:csv -- --executer                  # import réel
npm run import:csv -- --executer --maj            # import réel + mise à jour
npm run import:all

# --- Vérification ---
npm run typecheck              # TypeScript
npm test                       # suite de tests (exige PostgreSQL)
npm run verify                 # typecheck + tests
```

---

## Annexe — Où sont les fichiers importants

| Fichier | Contenu |
|---|---|
| `.env` | Configuration locale : base, secret de session, accès rapide. **Jamais versionné.** |
| `.env.example` | Modèle de configuration |
| `prisma/schema.prisma` | Les 83 modèles de données |
| `prisma/seed.ts` | Référentiel de base installé par `npm run setup` |
| `scripts/acces-direct.ts` | Outil `npm run acces` |
| `scripts/comptes.ts` | Outil `npm run comptes` |
| `scripts/import-csv.ts` | Import des données réelles |
| `RAPPORT-FINAL.md` | Rapport de développement (technique) |
| `SPEC-INTERFACE.md` | Conventions de code (technique) |

---

*Document de référence utilisateur — ERP MES ADMEDCO / MOBILIX.*
