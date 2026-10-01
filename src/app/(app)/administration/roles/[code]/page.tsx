import Link from "next/link";
import { notFound } from "next/navigation";
import { actionBasculerActivationRole, actionEnregistrerRole } from "@/actions/administration";
import { exigerPermission, libelleUsine } from "@/lib/rbac/guard";
import { MODULES, PERMISSIONS, PERMISSION_DEFINITIONS } from "@/lib/rbac/permissions";
import { prisma } from "@/lib/db";
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

export const metadata = { title: "Role" };

export default async function PageRole({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const utilisateur = await exigerPermission(PERMISSIONS.ROLE_LIRE);

  const role = await prisma.role.findUnique({
    where: { code },
    include: {
      permissions: { include: { permission: true } },
      users: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              isActive: true,
              lastLoginAt: true,
              employee: { select: { firstName: true, lastName: true, matricule: true } },
            },
          },
        },
      },
    },
  });

  if (!role) notFound();

  const accordees = new Set(role.permissions.map((lien) => lien.permission.code));
  const peutGerer = utilisateur.permissions.includes(PERMISSIONS.ROLE_GERER);

  const parModule = new Map<string, typeof PERMISSION_DEFINITIONS>();
  for (const permission of PERMISSION_DEFINITIONS) {
    const liste = parModule.get(permission.module) ?? [];
    liste.push(permission);
    parModule.set(permission.module, liste);
  }

  const optionsPortees = [
    { valeur: "ADMEDCO", libelle: libelleUsine("ADMEDCO") },
    { valeur: "MOBILIX", libelle: libelleUsine("MOBILIX") },
    { valeur: "COMMUN", libelle: libelleUsine("COMMUN") },
  ];

  return (
    <>
      <EnTetePage
        titre={`Role ${role.label}`}
        description={`Code technique : ${role.code}. La portee usine et les permissions sont verifiees cote serveur a chaque requete.`}
        actions={
          <Link className="lien-nav text-sm" href="/administration/roles">
            Retour aux roles
          </Link>
        }
      />

      {!role.isActive && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Role inactif">
            Ce role est inactif : il ne donne plus aucun droit, meme aux comptes qui le portent
            encore. Le role n'a pas ete supprime.
          </Alerte>
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique
          libelle="Permissions accordees"
          valeur={formatEntier(role.permissions.length)}
          detail={`sur ${formatEntier(PERMISSION_DEFINITIONS.length)} au catalogue`}
        />
        <Statistique libelle="Comptes porteurs" valeur={formatEntier(role.users.length)} />
        <Statistique
          libelle="Portee usine"
          valeur={libelleUsine(role.factoryScope ?? "COMMUN")}
          detail="Determines les donnees accessibles"
        />
        <Statistique
          libelle="Origine"
          valeur={role.isSystem ? "Fourni par l'application" : "Personnalise"}
          detail={role.description ?? "Aucune description"}
        />
      </div>

      <div className="space-y-5">
        <Carte titre="Informations du role">
          <ListeDefinitions
            elements={[
              { terme: "Code", valeur: <Etiquette>{role.code}</Etiquette> },
              { terme: "Libelle", valeur: role.label },
              { terme: "Description", valeur: role.description ?? "-" },
              { terme: "Portee usine", valeur: libelleUsine(role.factoryScope ?? "COMMUN") },
              {
                terme: "Etat",
                valeur: (
                  <EtiquetteStatut
                    libelle={role.isActive ? "Actif" : "Inactif"}
                    code={role.isActive ? "ACTIF" : "INACTIF"}
                  />
                ),
              },
              { terme: "Cree le", valeur: formatDateTime(role.createdAt) },
            ]}
          />
        </Carte>

        {peutGerer && (
          <Carte
            titre="Permissions du role"
            description="Les cases cochees sont les permissions actuellement accordees. Decocher une permission la retire immediatement apres enregistrement, et ferme les sessions des comptes concernes."
          >
            <FormulaireAction
              action={actionEnregistrerRole}
              libelleSoumettre="Enregistrer les permissions"
              rafraichir
            >
              <input type="hidden" name="code" value={role.code} />

              <div className="grid gap-4 sm:grid-cols-2">
                <Champ nom="label" libelle="Libelle affiche" requis valeur={role.label} maxLength={120} />
                <Champ
                  nom="factoryScope"
                  libelle="Portee usine"
                  type="select"
                  requis
                  valeur={role.factoryScope ?? "COMMUN"}
                  options={optionsPortees}
                />
                <Champ
                  nom="description"
                  libelle="Description"
                  type="textarea"
                  valeur={role.description ?? ""}
                  maxLength={300}
                />
              </div>

              <div className="mt-5 space-y-4">
                {[...parModule.entries()].map(([module, permissions]) => (
                  <details
                    key={module}
                    open={permissions.some((permission) => accordees.has(permission.code))}
                    className="rounded-lg border p-3"
                    style={{ borderColor: "var(--bordure)" }}
                  >
                    <summary className="cursor-pointer text-sm font-semibold">
                      {MODULES[module as keyof typeof MODULES]} —{" "}
                      {permissions.filter((permission) => accordees.has(permission.code)).length} /{" "}
                      {permissions.length} accordee(s)
                    </summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {permissions.map((permission) => (
                        <label
                          key={permission.code}
                          className="flex items-start gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            name="permissionCode"
                            value={permission.code}
                            defaultChecked={accordees.has(permission.code)}
                            className="mt-1 h-4 w-4"
                          />
                          <span>
                            {permission.label}
                            <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                              {permission.code}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </FormulaireAction>
          </Carte>
        )}

        {peutGerer && (
          <Carte
            titre={role.isActive ? "Desactiver ce role" : "Reactiver ce role"}
            description={
              role.isActive
                ? "Un role desactive ne donne plus aucun droit. Les sessions des comptes qui le portent sont fermees ; le role n'est jamais supprime."
                : "La reactivation redonne immediatement les droits listes ci-dessus."
            }
          >
            <FormulaireMotif
              action={actionBasculerActivationRole}
              champsCaches={{ roleId: role.id }}
              libelleSoumettre={role.isActive ? "Desactiver le role" : "Reactiver le role"}
              libelleMotif="Motif"
              varianteSoumettre={role.isActive ? "danger" : "primaire"}
              placeholder="Motif explicite (au moins 10 caracteres)"
            />
          </Carte>
        )}

        <Carte titre="Comptes portant ce role" sansPadding>
          {role.users.length === 0 ? (
            <Vide message="Aucun compte ne porte ce role." />
          ) : (
            <Tableau
              colonnes={[
                { cle: "email", libelle: "Compte" },
                { cle: "employe", libelle: "Employe" },
                { cle: "connexion", libelle: "Derniere connexion" },
                { cle: "etat", libelle: "Etat du compte" },
              ]}
              lignes={role.users.map((lien) => ({
                cle: String(lien.user.id),
                cellules: [
                  <Link
                    key="lien"
                    className="lien-nav"
                    href={`/administration/utilisateurs/${lien.user.id}`}
                  >
                    {lien.user.email}
                  </Link>,
                  lien.user.employee
                    ? `${lien.user.employee.firstName} ${lien.user.employee.lastName} (${lien.user.employee.matricule})`
                    : "-",
                  lien.user.lastLoginAt ? formatDateTime(lien.user.lastLoginAt) : "Jamais connecte",
                  <EtiquetteStatut
                    key="etat"
                    libelle={lien.user.isActive ? "Actif" : "Desactive"}
                    code={lien.user.isActive ? "ACTIF" : "INACTIF"}
                  />,
                ],
              }))}
            />
          )}
        </Carte>
      </div>
    </>
  );
}
