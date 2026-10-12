# Creation des employes par les proprietaires

Chaque proprietaire gere uniquement les employes de son usine.

1. Ouvrir **Ressources humaines > Employes > Nouvel employe**.
2. Saisir le **nom** et le **prenom**. L'usine du proprietaire est deja selectionnee.
3. Laisser le matricule vide pour une numerotation automatique (ADM-00001 ou MBX-00001). Si le travailleur possede deja un matricule, saisir celui-ci.
4. Les informations complementaires (atelier, depot, contrat, telephone) sont facultatives.
5. Cliquer sur **Creer l'employe et ses acces**.
6. Copier la carte d'identifiants et la remettre au travailleur avant de quitter la page.

Le compte cree est un **operateur de la meme usine**. Le proprietaire ne choisit pas un role d'administration. Sans adresse electronique, le systeme fournit un identifiant interne au format adm.ID@erpmes.local ou mbx.ID@erpmes.local. Il s'utilise dans le champ de connexion existant ; aucune boite mail n'est necessaire.

Le mot de passe temporaire est genere automatiquement, conserve uniquement sous forme de hachage en base, et doit etre change a la premiere connexion. Il n'est pas recuperable depuis la fiche employe. En cas de perte, l'administrateur doit le reinitialiser.

La fiche et le compte sont crees dans la meme transaction : un echec de creation du compte annule aussi la fiche. Cette inscription ne remplace pas la planification : le responsable doit ensuite affecter l'employe a son poste et publier son programme de travail.

## Verification de livraison

Les tests d'autorisation sont dans src/tests/inscription-employe.test.ts ; la recette avec PostgreSQL est dans src/tests/inscription-employe-integration.test.ts. Verification locale effectuee sur une instance PostgreSQL 16 temporaire et isolee : 206 tests passes sur 15 fichiers, verification TypeScript reussie. Le serveur applicatif et sa base ne sont pas modifies par cette recette. Le deploiement reste a effectuer dans l'environnement cible.
