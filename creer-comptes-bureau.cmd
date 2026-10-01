@echo off
setlocal
cd /d "%~dp0"

echo ===========================================================================
echo   ERPMES ADMEDCO / MOBILIX - Creation des 8 comptes de bureau
echo ===========================================================================
echo.
echo   Chaque commande cree le compte, genere un mot de passe conforme
echo   et l'inscrit dans .env (les autres entrees sont conservees).
echo.
echo   Le mot de passe est affiche a l'ecran. Il n'est PAS stocke en clair
echo   en base : seul un hachage scrypt y figure. Notez-le au fur et a mesure,
echo   ou utilisez simplement les boutons d'acces rapide de la page de connexion.
echo.
echo   Prerequis : PostgreSQL demarre.  Si ce n'est pas le cas :
echo       docker start erpmes-postgres
echo.
echo   Sans risque a relancer : un compte deja existant voit simplement son
echo   mot de passe repose et ses sessions ouvertes revoquees.
echo.
echo ---------------------------------------------------------------------------
echo.

call :creer direction@admedco.dz      DIRECTION
call :creer production@admedco.dz     RESPONSABLE_PRODUCTION
call :creer stock@admedco.dz          RESPONSABLE_STOCK
call :creer qualite@admedco.dz        RESPONSABLE_QUALITE
call :creer achats@admedco.dz         ACHETEUR
call :creer ventes@admedco.dz         COMMERCIAL
call :creer comptabilite@admedco.dz   COMPTABLE
call :creer rh@admedco.dz             RESPONSABLE_RH

echo.
echo ===========================================================================
echo   Termine.
echo ===========================================================================
echo.
echo   1. REDEMARREZ le serveur de developpement (Ctrl+C, puis npm run dev)
echo      pour que les boutons apparaissent sur la page de connexion.
echo   2. Verifiez la liste complete :  npm run acces -- --liste
echo.
echo   Les comptes operateurs (portail atelier) se creent separement, apres
echo   l'import des employes, en rattachant chacun a un matricule reel :
echo       npm run acces -- --email=operateur1@admedco.dz --generer ^
echo           --roles=OPERATEUR_ADMEDCO --matricule=EMP-0007
echo.
pause
exit /b 0

:creer
echo.
echo --- %2 : %1
echo ---------------------------------------------------------------------------
call npm run acces -- --email=%1 --generer --roles=%2
if errorlevel 1 (
  echo.
  echo *** ECHEC pour %1
  echo *** La base est-elle demarree ?  docker start erpmes-postgres
)
exit /b 0
