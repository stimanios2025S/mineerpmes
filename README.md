# ERP MES — ADMEDCO / MOBILIX

Plateforme ERP + MES pour deux divisions industrielles complémentaires :

| Division | Métier | Dépôt principal |
|---|---|---|
| **ADMEDCO** | Métallurgie — coupe, usinage, soudage, meulage, vissage, poudrage | `DEP-MP` |
| **MOBILIX** | Bois, couture et garnissage | `DEP-MP-MBX` |

Un flux relie les deux : les châssis peints par ADMEDCO (fin de `POUDRAGE`) entrent
chez MOBILIX pour le garnissage. Ce flux est une règle encodée en base, pas dans le
code.

## Ateliers

### ADMEDCO — 3 ateliers

| Atelier | Libellé | Postes |
|---|---|---|
| `ADM-A01` | A01 — Coupe avec centrage | `PT-COUPE` |
| `ADM-A02` | A02 — Coupe sans centrage | `PT-USINAGE`, `PT-SOUDAGE` |
| `ADM-A03` | A03 — Poudrage et emballage | `PT-MEULAGE`, `PT-VISSAGE`, `PT-POUDRAGE` |

A01 et A02 travaillent **en parallèle** ; leurs sorties convergent vers A03.

### MOBILIX — 2 ateliers

| Atelier | Libellé | Postes |
|---|---|---|
| `MBX-A01` | A01 — Découpe bois | `PT-MBX-PREP-BOIS`, `PT-MBX-USINAGE-BOIS`, `PT-MBX-INSERTS` |
| `MBX-A02` | A02 — Tapissage | textile, couture, capitonnage, assemblage, qualité, emballage, expédition |

## Pile technique

| Élément | Version |
|---|---|
| Next.js (App Router, Turbopack) | 16 |
| React | 19 |
| TypeScript | 5 |
| Prisma | 6 |
| PostgreSQL | 17 |
| Tailwind CSS | 4 |

Interface **entièrement en français**. Les commentaires et messages techniques
restent sans accents (contrainte des consoles Windows).

## Portails

| Portail | Chemin | Rôle |
|---|---|---|
| Tableau de bord | `/tableau-de-bord` | `ADMIN_SYSTEME`, `DIRECTION`, `AUDITEUR` |
| Direction ADMEDCO | `/direction/admedco` | `RESPONSABLE_ADMEDCO` |
| Direction MOBILIX | `/direction/mobilix` | `RESPONSABLE_MOBILIX` |
| Atelier | `/atelier/{code}` | `CHEF_*` |
| Magasinier central | `/magasinier` | `RESPONSABLE_STOCK`, `MAGASINIER` |
| Magasinier de division | `/magasinier/admedco`, `/magasinier/mobilix` | `MAGASINIER_ADMEDCO/MOBILIX` |
| Portail opérateur | `/portail/admedco`, `/portail/mobilix` | `OPERATEUR_*` |
| Scan de poste | `/portail/poste/{token}` | QR imprimé sur la machine |

Chaque rôle a son **profil de menu** (`PROFIL_MENU` dans
`src/components/navigation.ts`) : il ne voit que les sections qui le concernent.

## Proprietaires et Direction generale

- `PROPRIETAIRE_ADMEDCO` : consultation du pilotage, des articles, de la production
  et des stocks ADMEDCO seulement ; accueil `/direction/admedco`.
- `PROPRIETAIRE_MOBILIX` : meme consultation, limitee a MOBILIX ; accueil `/direction/mobilix`.
- `DIRECTION` : Direction generale, supervision des deux usines.
- `ADMIN_SYSTEME` conserve son acces technique global.

Chaque portail connecte affiche uniquement l'identite de son usine (en-tete,
couleur et titre du navigateur). Connexions dediees :
`/connexion?usine=ADMEDCO` et `/connexion?usine=MOBILIX`.
Ces parametres choisissent l'apparence, jamais les droits : le compte authentifie
reste l'unique source du perimetre. La recherche globale est aussi bornee aux
articles, ordres et lots de l'usine. Les transferts inter-usines restent le seul
contexte de synchronisation entre les deux divisions.

Les droits sont verifies cote serveur, y compris sur une URL saisie directement.
Les proprietaires n'ont aucun droit d'ecriture, de gestion des comptes ou de
consultation des donnees transversales. Les responsables operationnels gardent
leurs roles existants. Le role de Direction n'est jamais attribue a un proprietaire.

## Cloisonnement

Quatre niveaux, tous vérifiés **côté serveur** :

1. **Permission** — 99 permissions fines. Revérifiées dans la page, l'action
   serveur, l'API et la requête.
2. **Usine** — un rôle `ADMEDCO` ne voit jamais une donnée `MOBILIX`, même par URL.
3. **Atelier** — un chef d'atelier ne voit que son atelier.
4. **Personne** — le portail opérateur est borné sur `employeeId`.

> Masquer un menu ne protège rien : la sécurité est dans le serveur.

## Démarrage

```bash
# 1. Base de données PostgreSQL (Docker)
docker run -d --name erpmes-postgres \
  -e POSTGRES_USER=erpmes -e POSTGRES_PASSWORD=<motdepasse> \
  -e POSTGRES_DB=erpmes -p 5433:5432 postgres:17

# 2. Dépendances, migrations, référentiel
npm install
cp .env.example .env    # puis renseigner DATABASE_URL et SESSION_SECRET
npm run setup

# 3. Premier administrateur
npm run bootstrap:admin

# 4. Serveur
npm run dev             # http://localhost:3000
```

## Import des données de l'ancien système

Les fichiers CSV sont lus depuis `CSV_SOURCE_DIR`, séparateur `;`.

```bash
npm run import:csv -- --dossier=E:/Massiexporte   # simulation, aucune écriture
npm run import:csv -- --executer                  # import réel
npm run import:csv -- --executer --maj            # + mise à jour des fiches
```

L'import procède par 6 étapes : familles → articles → tiers → **fiches de
personnel** → nomenclatures → lots et stocks. L'étape « fiches de personnel »
crée une fiche employé pour chaque tiers de nature « employé » (à confirmer par
l'administrateur) et ne crée aucun compte d'accès.

L'import est **ré-exécutable sans doublon** et ne supprime jamais une fiche absente
du CSV : elle est archivée. Aucune valeur source ambiguë n'est devinée ; l'import
applique un repli documenté et le signale à l'administrateur.

## Référentiel de base installé par `npm run setup`

Rôles, permissions, unités, TVA, dépôts, ateliers, postes, plan comptable,
exercice, grille d'évaluation, règle de transfert du châssis peint.

**Aucune donnée de démonstration** : pas de fausse facture, pas de faux employé,
pas de stock fictif. Les employés, articles, tiers et commandes viennent de vos
imports ou de votre saisie.

## Commandes utiles

```bash
npm run dev              # serveur de développement
npm run build            # build de production
npm run start            # serveur de production
npm run typecheck        # vérification TypeScript
npm test                 # suite de tests
npm run verify           # typecheck + tests
npm run db:seed          # référentiel + rôles (idempotent)
npm run db:studio        # explorateur de base
npm run production:audit # audit en lecture seule, aucune suppression
npm run backup           # sauvegarde vérifiée de la base (backups/)
npm run restore -- --fichier=backups/....dump [--base=essai] [--confirmer]
                         # restauration : simulation par défaut, --confirmer pour agir
```

> **Sauvegardez après chaque import de données réelles.** `npm run backup` vérifie
> l'archive avec `pg_restore` avant de la conserver, et `--dossier=` écrit sur un
> disque externe. Détail et dépannage : `GUIDE-PLATEFORME.md` §12.

## Où sont les fichiers importants

| Fichier | Contenu |
|---|---|
| `src/lib/rbac/roles.ts` | **Source de vérité** des rôles et de leurs permissions |
| `src/lib/rbac/permissions.ts` | Catalogue des 99 permissions |
| `src/components/navigation.ts` | Navigation, sections, profil de menu par rôle |
| `prisma/schema.prisma` | Modèles de données |
| `prisma/seed.ts` | Référentiel de base (idempotent, sans démo) |
| `src/lib/mes/` | Logique d'atelier : programme, postes, sous-stocks, réservation |
| `src/lib/auth/` | Authentification et session |
| `.env` | Configuration locale — **jamais versionné** |

## Invariants du produit

1. **Rien n'est supprimé.** Une erreur est annulée par un mouvement ou une
   écriture inverse ; l'original reste lisible.
2. **On ne tape jamais une quantité de stock.** Toute variation est un mouvement
   horodaté, tracé et signé.
3. **Les actes sensibles exigent un motif écrit**, vérifié côté serveur.
4. **Aucune contradiction de quantité n'est tranchée automatiquement.** Un écart
   reste ouvert jusqu'à décision humaine.
5. **Les nomenclatures sont versionnées.** Un ordre lancé garde la copie figée de
   ce qu'il a réellement consommé.
6. **Un produit fabriqué n'est ni vendable ni livrable avant sa libération
   qualité.**
7. **Un compte par personne.** Jamais de compte partagé.
8. **Aucun mot de passe en dur dans le dépôt.** Tout est dans `.env`.

## Déploiement

Voir `deploy/README.md` (serveur isolé, Cloudflare Tunnel, PM2).

## Etat de mise en service

Voir `ETAT-MISE-EN-SERVICE.md` pour les limites verifiees et les validations restantes.
La commande `demo:purge` est desormais en lecture seule ; `--executer` est refuse.
