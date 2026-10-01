@echo off
setlocal
cd /d "%~dp0"

echo ===========================================================================
echo   ERPMES ADMEDCO / MOBILIX - Deux comptes d'atelier POUR VALIDER LE PORTAIL
echo ===========================================================================
echo.
echo   OBJECTIF : ouvrir le portail employe en conditions reelles, avec un
echo   compte ADMEDCO et un compte MOBILIX, avant de traiter tout l'effectif.
echo.
echo   Ces deux fiches sont TECHNIQUES et PROVISOIRES :
echo       - matricule automatique ACC-0001 et ACC-0002
echo       - nom ............ Operateur TEST-ADMEDCO / TEST-MOBILIX
echo       - poste .......... "Compte d'acces direct (developpement)"
echo       - usine .......... COMMUN  (a corriger, voir la fin de ce script)
echo.
echo   Ce ne sont PAS vos vrais ouvriers. A remplacer avant toute mise en
echo   service reelle : voir les etapes 3 et 4 a la fin.
echo.
echo   Prerequis : PostgreSQL demarre.  Si ce n'est pas le cas :
echo       docker start erpmes-postgres
echo.
echo   Sans risque a relancer : un compte deja existant voit simplement son
echo   mot de passe repose et ses sessions ouvertes revoquees.
echo.
echo ---------------------------------------------------------------------------
echo.

call :creer operateur.admedco@admedco.dz OPERATEUR_ADMEDCO TEST-ADMEDCO
call :creer operateur.mobilix@admedco.dz OPERATEUR_MOBILIX TEST-MOBILIX

echo.
echo ===========================================================================
echo   Termine.
echo ===========================================================================
echo.
echo   1. REDEMARREZ le serveur (Ctrl+C, puis npm run dev) : les deux boutons
echo      "Operateur ADMEDCO" et "Operateur MOBILIX" apparaitront alors sur la
echo      page de connexion, a la suite des comptes de bureau.
echo.
echo   2. CLIQUEZ sur l'un des deux. Le portail doit s'ouvrir sur le nom de la
echo      fiche, avec "Mes affectations du jour" (vide pour l'instant : aucune
echo      affectation n'existe encore).
echo.
echo      Si vous lisez "Compte non rattache a une fiche employe", le
echo      rattachement a echoue : relancez et lisez le message d'erreur.
echo.
echo   3. POUR QUE LE PORTAIL AIT DU CONTENU, connectez-vous en administrateur
echo      et creez une affectation pour aujourd'hui :
echo          Ressources humaines -> Affectations quotidiennes
echo      Designez ACC-0001 (ou ACC-0002) et une operation reelle.
echo      Sans affectation, l'operateur ouvre un portail vide : ce n'est pas
echo      une panne, il n'y a simplement rien a lui montrer.
echo.
echo      Pour aller jusqu'a "Declarer une production", il faut un ordre de
echo      fabrication. Or aucun article n'est encore marque produisible :
echo          Referentiel -> Articles -> cocher "Fabriquable"
echo      sur les articles que vous voulez vraiment fabriquer.
echo.
echo   4. AVANT LA MISE EN SERVICE REELLE, remplacez ces fiches :
echo        - Ouvrez Ressources humaines -> Employes, corrigez ACC-0001 et
echo          ACC-0002 : identite reelle, vrai matricule, et surtout l'USINE
echo          (ADMEDCO ou MOBILIX - la fiche technique dit COMMUN, ce qui est
echo          faux pour un operateur).
echo        - Creez ensuite la fiche de chaque ouvrier, PUIS son compte
echo          rattache a son vrai matricule :
echo              npm run acces -- --email=<adresse> --generer ^
echo                  --roles=OPERATEUR_ADMEDCO --matricule=<matricule reel>
echo        - Supprimez les deux fiches de test et leurs comptes.
echo.
echo      Rappel : un compte ne peut pas etre rattache a une fiche qui a deja
echo      un compte. Creez donc la fiche AVANT le compte.
echo.
pause
exit /b 0

:creer
echo.
echo --- %2 : %1
echo ---------------------------------------------------------------------------
call npm run acces -- --email=%1 --generer --roles=%2 --creer-fiche --prenom=Operateur --nom=%3
if errorlevel 1 (
  echo.
  echo *** ECHEC pour %1
  echo *** La base est-elle demarree ?  docker start erpmes-postgres
)
exit /b 0
