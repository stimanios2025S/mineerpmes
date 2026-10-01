import Link from "next/link";
import {
  actionBasculerActivationUtilisateur,
  actionCreerUtilisateur,
  actionReinitialiserMotDePasseUtilisateur,
} from "@/actions/administration";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Pagination,
  Statistique,
  Tableau,
  Vide,
} from "@/components/ui";
import { Champ, FormulaireAction, FormulaireMotif } from "@/components/interactif";
import { formatDateTime, formatEntier } from "@/lib/format";
import { fabricantLien, lireParametresListe } from "@/lib/liste";

export const metadata = { title: "Utilisateurs" };

const CHEMIN = "/administration/utilisateurs";

export default async function PageUtilisateurs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.UTILISATEUR_LIRE);

  const parametres = await searchParams;
  const liste = lireParametresListe(parametres, ["recherche", "statut", "role"]);

  const where: Prisma.UserWhereInput = {};
  const recherche = liste.filtres.recherche?.trim();
  if (recherche) {
    where.OR = [
      { email: { contains: recherche, mode: "insensitive" } },
      {
        employee: {
          is: {
            OR: [
              { firstName: { contains: recherche, mode: "insensitive" } },
              { lastName: { contains: recherche, mode: "insensitive" } },
              { matricule: { contains: recherche, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }
  if (liste.filtres.statut === "ACTIF") where.isActive = true;
  if (liste.filtres.statut === "INACTIF") where.isActive = false;
  if (liste.filtres.role) where.roles = { some: { role: { code: liste.filtres.role } } };

  const [total, utilisateurs, roles, employesSansCompte, comptesActifs, verrouilles] =
    await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { email: "asc" },
        skip: (liste.page - 1) * liste.taille,
        take: liste.taille,
        include: {
          employee: { select: { firstName: true, lastName: true, matricule: true } },
          roles: { include: { role: { select: { code: true, label: true, isActive: true } } } },
          _count: { select: { sessions: true } },
        },
      }),
      prisma.role.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: { code: true, label: true },
      }),
      prisma.employee.findMany({
        where: { userId: null, isActive: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        take: 500,
        select: { id: true, matricule: true, firstName: true, lastName: true },
      }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { lockedUntil: { gt: new Date() } } }),
    ]);

  const pages = Math.max(1, Math.ceil(total / liste.taille));
  const peutGerer = utilisateur.permissions.includes(PERMISSIONS.UTILISATEUR_GERER);

  const optionsRoles = roles.map((role) => ({
    valeur: role.code,
    libelle: `${role.label} (${role.code})`,
  }));
  const optionsEmployes = employesSansCompte.map((employe) => ({
    valeur: employe.id,
    libelle: `${employe.lastName} ${employe.firstName} — ${employe.matricule}`,
  }));

  return (
    <>
      <EnTetePage
        titre="Utilisateurs"
        description="Chaque personne dispose de son propre compte nominatif : aucun compte partage n'est autorise. Les mots de passe ne sont jamais visibles ni choisis par l'administration ; le systeme genere un mot de passe temporaire que l'interesse doit changer a sa premiere connexion."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique libelle="Comptes" valeur={formatEntier(total)} detail="Apres filtres" />
        <Statistique libelle="Comptes actifs" valeur={formatEntier(comptesActifs)} />
        <Statistique
          libelle="Comptes verrouilles"
          valeur={formatEntier(verrouilles)}
          ton={verrouilles > 0 ? "alerte" : "succes"}
          detail="Verrouillage temporaire apres plusieurs echecs de connexion"
        />
        <Statistique
          libelle="Employes sans compte"
          valeur={formatEntier(employesSansCompte.length)}
          detail="Employes actifs n'ayant pas encore d'acces nominatif"
        />
      </div>

      <Carte titre="Filtrer">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Recherche</span>
            <input
              className="champ"
              type="search"
              name="recherche"
              defaultValue={liste.filtres.recherche ?? ""}
              placeholder="Adresse, nom ou matricule"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Etat du compte</span>
            <select className="champ" name="statut" defaultValue={liste.filtres.statut ?? ""}>
              <option value="">Tous les etats</option>
              <option value="ACTIF">Actif</option>
              <option value="INACTIF">Desactive</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Role</span>
            <select className="champ" name="role" defaultValue={liste.filtres.role ?? ""}>
              <option value="">Tous les roles</option>
              {roles.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-3">
            <button
              type="submit"
              className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
              style={{ background: "var(--primaire)", color: "#ffffff", borderColor: "var(--primaire)" }}
            >
              Filtrer
            </button>
            <Link className="lien-nav text-sm" href={CHEMIN}>
              Reinitialiser
            </Link>
          </div>
        </form>
      </Carte>

      <div className="mt-5 space-y-5">
        <Carte titre="Comptes nominatifs" sansPadding>
          {utilisateurs.length === 0 ? (
            <Vide message="Aucun compte ne correspond aux filtres selectionnes." />
          ) : (
            <>
              <Tableau
                colonnes={[
                  { cle: "email", libelle: "Adresse electronique" },
                  { cle: "employe", libelle: "Employe" },
                  { cle: "roles", libelle: "Roles" },
                  { cle: "connexion", libelle: "Derniere connexion" },
                  { cle: "sessions", libelle: "Sessions ouvertes", nombre: true },
                  { cle: "etat", libelle: "Etat" },
                ]}
                lignes={utilisateurs.map((compte) => ({
                  cle: String(compte.id),
                  cellules: [
                    <Link
                      key="lien"
                      className="lien-nav"
                      href={`${CHEMIN}/${compte.id}`}
                    >
                      {compte.email}
                    </Link>,
                    compte.employee
                      ? `${compte.employee.firstName} ${compte.employee.lastName} (${compte.employee.matricule})`
                      : "-",
                    <span key="roles" className="flex flex-wrap gap-1">
                      {compte.roles.length === 0 ? (
                        <Etiquette ton="danger">Aucun role</Etiquette>
                      ) : (
                        compte.roles.map((lien) => (
                          <Etiquette
                            key={lien.role.code}
                            ton={lien.role.isActive ? "neutre" : "danger"}
                          >
                            {lien.role.label}
                          </Etiquette>
                        ))
                      )}
                    </span>,
                    compte.lastLoginAt
                      ? formatDateTime(compte.lastLoginAt)
                      : "Jamais connecte",
                    formatEntier(compte._count.sessions),
                    <EtiquetteStatut
                      key="etat"
                      libelle={
                        compte.isActive
                          ? compte.mustChangePassword
                            ? "Actif — mot de passe a changer"
                            : "Actif"
                          : "Desactive"
                      }
                      code={compte.isActive ? "ACTIF" : "INACTIF"}
                    />,
                  ],
                }))}
              />
              <Pagination
                page={liste.page}
                pages={pages}
                total={total}
                construireLien={fabricantLien(CHEMIN, {
                  recherche: liste.filtres.recherche,
                  statut: liste.filtres.statut,
                  role: liste.filtres.role,
                  taille: liste.taille,
                })}
              />
            </>
          )}
        </Carte>

        {peutGerer && (
          <>
            <Carte
              titre="Creer un compte nominatif"
              description="Le mot de passe temporaire est genere par le systeme : il ne transite pas par ce formulaire et n'est jamais conserve en clair. Il s'affiche une seule fois apres la creation."
            >
              <FormulaireAction action={actionCreerUtilisateur} libelleSoumettre="Creer le compte">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Champ
                    nom="email"
                    libelle="Adresse electronique"
                    type="email"
                    requis
                    maxLength={160}
                    aide="Une adresse par personne : les comptes partages sont refuses."
                  />
                  <Champ
                    nom="roleCode"
                    libelle="Roles attribues"
                    type="select"
                    plusieurs
                    requis
                    options={optionsRoles}
                    aide="Maintenez la touche de selection multiple pour choisir plusieurs roles."
                  />
                  <Champ
                    nom="employeeId"
                    libelle="Employe rattache (facultatif)"
                    type="select"
                    options={optionsEmployes}
                    aide="Rattacher le compte a une fiche employe permet de suivre ses affectations et ses evaluations. Un employe ne peut avoir qu'un seul compte."
                  />
                </div>
              </FormulaireAction>
            </Carte>

            {employesSansCompte.length === 0 && (
              <Alerte ton="info">
                Tous les employes actifs disposent deja d'un compte nominatif, ou aucune fiche
                employe n'a encore ete creee.
              </Alerte>
            )}
          </>
        )}

        {peutGerer && utilisateurs.length > 0 && (
          <Carte
            titre="Gestion des comptes affiches"
            description="Ces operations sont journalisees. La reinitialisation d'un mot de passe ferme les sessions ouvertes du compte et impose le changement a la prochaine connexion."
          >
            <div className="space-y-4">
              {utilisateurs.map((compte) => (
                <div
                  key={compte.id}
                  className="rounded-lg border p-4"
                  style={{ borderColor: "var(--bordure)" }}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{compte.email}</p>
                    <EtiquetteStatut
                      libelle={compte.isActive ? "Actif" : "Desactive"}
                      code={compte.isActive ? "ACTIF" : "INACTIF"}
                    />
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <FormulaireMotif
                      action={actionBasculerActivationUtilisateur}
                      champsCaches={{ userId: compte.id }}
                      libelleSoumettre={
                        compte.isActive ? "Desactiver le compte" : "Reactiver le compte"
                      }
                      libelleMotif={
                        compte.isActive
                          ? "Motif de la desactivation (le compte n'est jamais supprime)"
                          : "Motif de la reactivation"
                      }
                      varianteSoumettre={compte.isActive ? "danger" : "primaire"}
                      placeholder="Motif explicite (au moins 10 caracteres)"
                    />

                    <div>
                      <FormulaireAction
                        action={actionReinitialiserMotDePasseUtilisateur}
                        libelleSoumettre="Reinitialiser le mot de passe"
                        varianteSoumettre="secondaire"
                      >
                        <input type="hidden" name="userId" value={compte.id} />
                        <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                          Un mot de passe temporaire aleatoire est genere, affiche une seule fois
                          puis jamais conserve en clair. Le compte devra le changer a sa prochaine
                          connexion.
                        </p>
                      </FormulaireAction>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Carte>
        )}

        {!peutGerer && (
          <Alerte ton="info">
            La creation et la modification des comptes exigent la permission dediee. Vous pouvez
            consulter les comptes et leurs roles.
          </Alerte>
        )}
      </div>
    </>
  );
}
