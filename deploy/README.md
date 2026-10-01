# Deploiement ERP MES

Ce dossier decrit un deploiement isole de l'application sur un serveur qui
heberge deja d'autres applications.

## Regles de securite

- Ne jamais versionner `.env`, les mots de passe ou les cles SSH.
- Revoquer tout mot de passe transmis dans une conversation ou un ticket.
- Utiliser un compte SSH dedie, sans droits inutiles.
- Utiliser un port dedie si le port 3000 est deja occupe.

## Cloudflare Tunnel

Dans Cloudflare Zero Trust :

1. Ouvrir `Networks > Tunnels`.
2. Selectionner le tunnel existant.
3. Ouvrir `Public Hostname`.
4. Ajouter ou modifier :

   - Hostname : `erp.admedco.com`
   - Service : `http://localhost:3000`

Si le port cible est different :

```text
http://localhost:3100
```

DNS :

- Cloudflare peut creer automatiquement l'enregistrement CNAME du tunnel.
- L'enregistrement doit rester proxied.
- Avec `cloudflared` :

```powershell
cloudflared tunnel route dns <tunnel-id> erp.admedco.com
```

## Application

Sur le serveur, dans le dossier de l'application :

```powershell
Copy-Item .env.production.example .env
# Completer DATABASE_URL, SESSION_SECRET et APP_URL sans les committer
```

Valeurs minimales :

```ini
NODE_ENV=production
APP_URL=https://erp.admedco.com
DATABASE_URL=postgresql://...
SESSION_SECRET=...
```

## Deploiement PM2

Simulation :

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-server.ps1
```

Application :

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-server.ps1 -Apply
```

Le script :

1. verifie Node.js ;
2. installe les dependances ;
3. genere le client Prisma ;
4. applique les migrations ;
5. construit Next.js ;
6. recharge le processus PM2 `erpmes`.

Le script ne modifie pas les autres applications du serveur.

## Verification

```powershell
Invoke-WebRequest http://localhost:3000/api/health
```

Puis depuis l'exterieur :

```text
https://erp.admedco.com/api/health
```

Le point `/api/health` ne retourne aucune donnee metier.

## GitHub

Le workflow `.github/workflows/deploy.yml` attend ces secrets GitHub :

- `DEPLOY_SSH_KEY`
- `DEPLOY_SSH_HOST`
- `DEPLOY_SSH_USER`
- `DEPLOY_APP_PATH`
- `ERPMES_PORT` (optionnel)

Il ne contient aucun identifiant ni mot de passe.
