import Link from "next/link";
import { notFound } from "next/navigation";
import {
  actionAssignerRolesUtilisateur,
  actionBasculerActivationUtilisateur,
  actionReinitialiserMotDePasseUtilisateur,
  actionRevoquerSessionsUtilisateur,
} from "@/actions/administration";
import { exigerPermission, libelleUsine } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { prisma } from "@/lib/db";
import { consulterJournalAudit } from "@/lib/audit";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  ListeDefinitions,
  Statistique,
  Tableau,
  Vide,
} from "@/components/ui";
import { Champ, FormulaireAction, FormulaireMotif } from "@/components/interactif";
import { formatDateTime, formatEntier } from "@/lib/format";
import { identifiantOuNull } from "@/lib/liste";

export const metadata = { title: "Compte utilisateur" };

export default async function PageUtilisateur({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = identifiantOuNull(id);
  if (userId === null) notFound();

  const acteur = await exigerPermission(PERMISSIONS.UTILISATEUR_LIRE);

  const compte = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      employee: {
        select: {
          id: true,
          matricule: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          factory: true,
          workshop: { select: { label: true } },
        },
      },
      roles: { include: { role: { select: { code: true, label: true, isActive: true } } } },
      sessions: {
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!compte) notFound();

  const [rolesDisponibles, journal] = await Promise.all([
    prisma.role.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { code: true, label: true },
    }),
    consulterJournalAudit({ userId, taille: 25 }),
  ]);

  const peutGererUtilisateurs = acteur.permissions.includes(PERMISSIONS.UTILISATEUR_GERER);
  const peutGererRoles = acteur.permissions.includes(PERMISSIONS.ROLE_GERER);
  const estLuiMeme = acteur.id === compte.id;

  const rolesActuels = compte.roles.map((lien) => lien.role.code);
  const optionsRoles = rolesDisponibles.map((role) => ({
    valeur: role.code,
    libelle: `${role.label} (${role.code})`,
  }));

  return (
    <>
      <EnTetePage
        titre={`Compte ${compte.email}`}
        description={
          compte.employee
            ? `${compte.employee.firstName} ${compte.employee.lastName} — matricule ${compte.employee.matricule}`
            : "Compte sans fiche employe rattachee."
        }
        actions={
          <Link className="lien-nav text-sm" href="/administration/utilisateurs">
            Retour aux utilisateurs
          </Link>
        }
      />

      {!compte.isActive && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Compte desactive">
            Ce compte ne peut plus se connecter. Il n'a pas ete supprime : son historique, ses
            ecritures et son journal d'audit restent consultables.
          </Alerte>
        </div>
      )}

      {compte.lockedUntil && compte.lockedUntil.getTime() > Date.now() && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Compte temporairement verrouille">
            Le compte est verrouille jusqu'au {formatDateTime(compte.lockedUntil)} apres{" "}
            {formatEntier(compte.failedAttempts)} tentatives de connexion infructueuses.
          </Alerte>
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique
          libelle="Roles"
          valeur={formatEntier(compte.roles.length)}
          detail={
            compte.roles.length === 0
              ? "Aucun role : le compte n'a acces a rien"
              : compte.roles.map((lien) => lien.role.label).join(", ")
          }
          ton={compte.roles.length === 0 ? "alerte" : "neutre"}
        />
        <Statistique
          libelle="Sessions ouvertes"
          valeur={formatEntier(compte.sessions.length)}
          detail="Connexions actuellement actives"
        />
        <Statistique
          libelle="Tentatives echouees"
          valeur={formatEntier(compte.failedAttempts)}
          ton={compte.failedAttempts > 0 ? "alerte" : "succes"}
        />
        <Statistique
          libelle="Changement de mot de passe"
          valeur={compte.mustChangePassword ? "Requis" : "A jour"}
          ton={compte.mustChangePassword ? "alerte" : "succes"}
          detail="Impose a la prochaine connexion"
        />
      </div>

      <div className="space-y-5">
        <Carte titre="Identite et securite">
          <ListeDefinitions
            elements={[
              { terme: "Adresse electronique", valeur: compte.email },
              {
                terme: "Employe rattache",
                valeur: compte.employee ? (
                  <Link className="lien-nav" href={`/rh/employes/${compte.employee.id}`}>
                    {compte.employee.firstName} {compte.employee.lastName} (
                    {compte.employee.matricule})
                  </Link>
                ) : (
                  "-"
                ),
              },
              { terme: "Poste", valeur: compte.employee?.jobTitle ?? "-" },
              {
                terme: "Usine",
                valeur: compte.employee ? libelleUsine(compte.employee.factory) : "-",
              },
              {
                terme: "Atelier",
                valeur: compte.employee?.workshop?.label ?? "-",
              },
              {
                terme: "Etat",
                valeur: (
                  <EtiquetteStatut
                    libelle={compte.isActive ? "Actif" : "Desactive"}
                    code={compte.isActive ? "ACTIF" : "INACTIF"}
                  />
                ),
              },
              { terme: "Compte cree le", valeur: formatDateTime(compte.createdAt) },
              {
                terme: "Derniere connexion",
                valeur: compte.lastLoginAt
                  ? `${formatDateTime(compte.lastLoginAt)}${
                      compte.lastLoginIp ? ` (${compte.lastLoginIp})` : ""
                    }`
                  : "Jamais connecte",
              },
              {
                terme: "Desactive le",
                valeur: compte.disabledAt ? formatDateTime(compte.disabledAt) : "-",
              },
            ]}
          />
        </Carte>

        <Carte titre="Roles du compte">
          <p className="mb-3 text-sm" style={{ color: "var(--texte-doux)" }}>
            Les droits sont calcules a partir des roles actifs. Toute modification ferme
            immediatement les sessions ouvertes de ce compte.
          </p>

          {peutGererRoles ? (
            <FormulaireAction
              action={actionAssignerRolesUtilisateur}
              libelleSoumettre="Enregistrer les roles"
              rafraichir
            >
              <input type="hidden" name="userId" value={compte.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Champ
                  nom="roleCode"
                  libelle="Roles attribues"
                  type="select"
                  plusieurs
                  requis
                  valeur={rolesActuels.length > 0 ? rolesActuels : undefined}
                  options={optionsRoles}
                  aide="Selection multiple. Le compte ne recoit que les droits des roles coches."
                />
                <Champ
                  nom="motif"
                  libelle="Motif du changement"
                  requis
                  maxLength={300}
                  aide="Ce motif est conserve dans le journal d'audit."
                />
              </div>
            </FormulaireAction>
          ) : (
            <div className="flex flex-wrap gap-2">
              {compte.roles.length === 0 ? (
                <Etiquette ton="danger">Aucun role</Etiquette>
              ) : (
                compte.roles.map((lien) => (
                  <Etiquette key={lien.role.code} ton={lien.role.isActive ? "neutre" : "danger"}>
                    {lien.role.label}
                    {lien.role.isActive ? "" : " (inactif)"}
                  </Etiquette>
                ))
              )}
            </div>
          )}
        </Carte>

        {peutGererUtilisateurs && (
          <Carte
            titre="Actions sur le compte"
            description="Ces actions sont journalisees. Aucun compte n'est supprime : un compte inutilise est desactive."
          >
            <div className="grid gap-5 lg:grid-cols-3">
              <div>
                <p className="mb-2 text-sm font-semibold">Mot de passe</p>
                <FormulaireAction
                  action={actionReinitialiserMotDePasseUtilisateur}
                  libelleSoumettre="Reinitialiser le mot de passe"
                  varianteSoumettre="secondaire"
                >
                  <input type="hidden" name="userId" value={compte.id} />
                  <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                    Un mot de passe temporaire aleatoire est genere, affiche une seule fois puis
                    jamais conserve en clair. Le compte devra le changer a sa prochaine connexion.
                    {estLuiMeme
                      ? " Votre propre compte n'est pas concerne : utilisez la page Mon compte."
                      : ""}
                  </p>
                </FormulaireAction>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold">Sessions ouvertes</p>
                <FormulaireMotif
                  action={actionRevoquerSessionsUtilisateur}
                  champsCaches={{ userId: compte.id }}
                  libelleSoumettre="Fermer les sessions"
                  libelleMotif="Motif"
                  varianteSoumettre="secondaire"
                  placeholder="Motif explicite (au moins 10 caracteres)"
                />
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold">
                  {compte.isActive ? "Desactivation" : "Reactivation"}
                </p>
                {estLuiMeme ? (
                  <Alerte ton="info">
                    Vous ne pouvez pas desactiver votre propre compte.
                  </Alerte>
                ) : (
                  <FormulaireMotif
                    action={actionBasculerActivationUtilisateur}
                    champsCaches={{ userId: compte.id }}
                    libelleSoumettre={
                      compte.isActive ? "Desactiver le compte" : "Reactiver le compte"
                    }
                    libelleMotif="Motif"
                    varianteSoumettre={compte.isActive ? "danger" : "primaire"}
                    placeholder="Motif explicite (au moins 10 caracteres)"
                  />
                )}
              </div>
            </div>
          </Carte>
        )}

        <Carte titre="Sessions ouvertes" sansPadding>
          {compte.sessions.length === 0 ? (
            <Vide message="Aucune session ouverte pour ce compte." />
          ) : (
            <Tableau
              colonnes={[
                { cle: "debut", libelle: "Ouverture" },
                { cle: "expiration", libelle: "Expiration" },
                { cle: "ip", libelle: "Adresse IP" },
                { cle: "agent", libelle: "Navigateur" },
              ]}
              lignes={compte.sessions.map((session) => ({
                cle: session.id,
                cellules: [
                  formatDateTime(session.createdAt),
                  formatDateTime(session.expiresAt),
                  session.ip ?? "-",
                  session.userAgent ?? "-",
                ],
              }))}
            />
          )}
        </Carte>

        <Carte
          titre="Dernieres actions journalisees"
          description="Extrait du registre d'audit pour ce compte."
          sansPadding
        >
          {journal.lignes.length === 0 ? (
            <Vide message="Aucune action journalisee pour ce compte." />
          ) : (
            <Tableau
              colonnes={[
                { cle: "date", libelle: "Date" },
                { cle: "action", libelle: "Action" },
                { cle: "module", libelle: "Module" },
                { cle: "entite", libelle: "Objet" },
                { cle: "commentaire", libelle: "Commentaire" },
              ]}
              lignes={journal.lignes.map((entree) => ({
                cle: String(entree.id),
                cellules: [
                  formatDateTime(entree.createdAt),
                  entree.action,
                  entree.module,
                  `${entree.entity}${entree.entityId ? ` #${entree.entityId}` : ""}`,
                  entree.comment ?? entree.reason ?? "-",
                ],
              }))}
            />
          )}
        </Carte>
      </div>
    </>
  );
}
