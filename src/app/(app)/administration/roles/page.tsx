import Link from "next/link";
import { actionEnregistrerRole } from "@/actions/administration";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS, PERMISSION_DEFINITIONS, MODULES } from "@/lib/rbac/permissions";
import { prisma } from "@/lib/db";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Statistique,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatEntier } from "@/lib/format";
import { libelleUsine } from "@/lib/rbac/guard";

export const metadata = { title: "Roles et permissions" };

const CHEMIN = "/administration/roles";

function grillePermissions(prefixe: string) {
  const parModule = new Map<string, typeof PERMISSION_DEFINITIONS>();
  for (const permission of PERMISSION_DEFINITIONS) {
    const liste = parModule.get(permission.module) ?? [];
    liste.push(permission);
    parModule.set(permission.module, liste);
  }

  return (
    <div className="space-y-4">
      {[...parModule.entries()].map(([module, permissions]) => (
        <details key={module} className="rounded-lg border p-3" style={{ borderColor: "var(--bordure)" }}>
          <summary className="cursor-pointer text-sm font-semibold">
            {MODULES[module as keyof typeof MODULES]} — {permissions.length} permission(s)
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {permissions.map((permission) => (
              <label key={permission.code} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="permissionCode"
                  value={permission.code}
                  className="mt-1 h-4 w-4"
                  id={`${prefixe}-${permission.code}`}
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
  );
}

export default async function PageRoles() {
  const utilisateur = await exigerPermission(PERMISSIONS.ROLE_LIRE);

  const roles = await prisma.role.findMany({
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    include: {
      _count: { select: { permissions: true, users: true } },
    },
  });

  const comptes = await prisma.user.count();
  const peutGerer = utilisateur.permissions.includes(PERMISSIONS.ROLE_GERER);

  const optionsPortees = [
    { valeur: "ADMEDCO", libelle: libelleUsine("ADMEDCO") },
    { valeur: "MOBILIX", libelle: libelleUsine("MOBILIX") },
    { valeur: "COMMUN", libelle: libelleUsine("COMMUN") },
  ];

  return (
    <>
      <EnTetePage
        titre="Roles et permissions"
        description="Les droits sont verifies a chaque requete, dans les pages comme dans les actions et les exports : masquer un element d'interface ne suffit jamais. Toute modification de droit est journalisee et ferme les sessions ouvertes des comptes concernes."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique libelle="Roles" valeur={formatEntier(roles.length)} />
        <Statistique
          libelle="Roles actifs"
          valeur={formatEntier(roles.filter((role) => role.isActive).length)}
        />
        <Statistique
          libelle="Permissions au catalogue"
          valeur={formatEntier(PERMISSION_DEFINITIONS.length)}
          detail="Reference unique partagee par le code et la base"
        />
        <Statistique libelle="Comptes utilisateurs" valeur={formatEntier(comptes)} />
      </div>

      <Carte titre="Roles configures" sansPadding>
        <Tableau
          colonnes={[
            { cle: "code", libelle: "Code" },
            { cle: "libelle", libelle: "Libelle" },
            { cle: "portee", libelle: "Portee usine" },
            { cle: "permissions", libelle: "Permissions", nombre: true },
            { cle: "comptes", libelle: "Comptes", nombre: true },
            { cle: "origine", libelle: "Origine" },
            { cle: "etat", libelle: "Etat" },
            { cle: "actions", libelle: "Actions" },
          ]}
          lignes={roles.map((role) => ({
            cle: String(role.id),
            cellules: [
              role.code,
              role.label,
              libelleUsine(role.factoryScope ?? "COMMUN"),
              formatEntier(role._count.permissions),
              formatEntier(role._count.users),
              role.isSystem ? <Etiquette key="origine">Fourni par l'application</Etiquette> : "Personnalise",
              <EtiquetteStatut
                key="etat"
                libelle={role.isActive ? "Actif" : "Inactif"}
                code={role.isActive ? "ACTIF" : "INACTIF"}
              />,
              <Link key="lien" className="lien-nav" href={`${CHEMIN}/${role.code}`}>
                Modifier
              </Link>,
            ],
          }))}
        />
      </Carte>

      <div className="mt-5 space-y-5">
        <Alerte ton="info">
          Un role fourni par l'application peut etre ajuste, mais il n'est jamais supprime : sa
          desactivation, ou le retrait de ses permissions, suffit a retirer les droits
          correspondants aux comptes qui le portent.
        </Alerte>

        {peutGerer ? (
          <Carte
            titre="Creer un role"
            description="Le role est cree avec exactement les permissions cochees ci-dessous. Aucune permission n'est ajoutee par defaut."
          >
            <FormulaireAction
              action={actionEnregistrerRole}
              libelleSoumettre="Creer le role"
              rafraichir
            >
              <input type="hidden" name="estNouveau" value="1" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Champ
                  nom="code"
                  libelle="Code du role"
                  requis
                  maxLength={60}
                  aide="Identifiant technique en majuscules, unique. Exemple : CHEF_ATELIER_SOUDURE."
                />
                <Champ
                  nom="label"
                  libelle="Libelle affiche"
                  requis
                  maxLength={120}
                  aide="Nom du role tel qu'il apparait dans les ecrans."
                />
                <Champ
                  nom="factoryScope"
                  libelle="Portee usine"
                  type="select"
                  requis
                  options={optionsPortees}
                  aide="Un role ADMEDCO ou MOBILIX ne donne acces qu'aux donnees de cette division."
                />
                <Champ nom="description" libelle="Description (facultatif)" type="textarea" maxLength={300} />
              </div>

              <div className="mt-5">
                <p className="mb-3 text-sm font-medium">Permissions accordees</p>
                {grillePermissions("nouveau")}
              </div>
            </FormulaireAction>
          </Carte>
        ) : (
          <Alerte ton="info">
            La creation et la modification des roles exigent la permission dediee. Vous pouvez
            consulter les roles et leurs permissions.
          </Alerte>
        )}
      </div>
    </>
  );
}
