import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  aLaPermission,
  exigerPermission,
  usinesAutorisees,
} from "@/lib/rbac/guard";
import { PERMISSIONS, getPermissionLabel } from "@/lib/rbac/permissions";
import { identifiantOuNull } from "@/lib/liste";
import {
  actionCreerCompteEmploye,
  actionDeclarerCompetence,
  actionDesactiverEmploye,
  actionModifierEmploye,
} from "@/actions/rh";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  ListeDefinitions,
  Pagination,
  Section,
  Statistique,
  Tableau,
} from "@/components/ui";
import {
  Champ,
  FormulaireAction,
  FormulaireMotif,
} from "@/components/interactif";
import {
  DEVISE_PAR_DEFAUT,
  formatDate,
  formatDateTime,
  formatHeure,
  formatMontant,
  formatQuantite,
  toInputDate,
} from "@/lib/format";
import {
  LIBELLES_FIABILITE,
  LIBELLES_PERIODE_EVALUATION,
  LIBELLES_PRESENCE,
  LIBELLES_STATUT_AFFECTATION,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";
import { listerAffectations, listerEvaluations } from "@/lib/rh/service";

export const metadata = { title: "Fiche employe" };

/**
 * Fiche complete d'un employe.
 *
 * Les donnees salariales font l'objet d'une requete separee, declenchee
 * uniquement si l'utilisateur detient `RH_SALAIRE_LIRE` : sans cette permission,
 * aucune valeur de salaire n'est lue depuis PostgreSQL. Le formulaire de
 * modification ne rend pas davantage les champs correspondants.
 */

function debutEtFinDeMois(reference: Date) {
  return {
    debut: new Date(reference.getFullYear(), reference.getMonth(), 1),
    fin: new Date(
      reference.getFullYear(),
      reference.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    ),
  };
}

export default async function PageFicheEmploye({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.RH_LIRE);
  const { id } = await params;
  const identifiant = identifiantOuNull(id);
  if (!identifiant) notFound();

  // Cloisonnement par division : la fiche est bornee sur les usines autorisees.
  // Une fiche hors perimetre est traitee comme inexistante, ce qui ne revele ni
  // son existence ni son contenu.
  const portee = usinesAutorisees(utilisateur);

  const employe = await prisma.employee.findFirst({
    where: { id: identifiant, factory: { in: portee } },
    select: {
      id: true,
      matricule: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      email: true,
      phone: true,
      phone2: true,
      address: true,
      city: true,
      birthDate: true,
      gender: true,
      socialSecurityNumber: true,
      ccp: true,
      contractType: true,
      factory: true,
      hireDate: true,
      endDate: true,
      isActive: true,
      createdAt: true,
      workshopId: true,
      defaultWarehouseId: true,
      workshop: { select: { code: true, label: true } },
      defaultWarehouse: { select: { code: true, label: true } },
      user: {
        select: {
          id: true,
          email: true,
          isActive: true,
          mustChangePassword: true,
          lastLoginAt: true,
          roles: {
            select: { role: { select: { code: true, label: true } } },
          },
        },
      },
    },
  });
  if (!employe) notFound();

  const peutEcrire = aLaPermission(utilisateur, PERMISSIONS.RH_ECRIRE);
  const voitSalaires = aLaPermission(utilisateur, PERMISSIONS.RH_SALAIRE_LIRE);
  const peutCompetences = aLaPermission(
    utilisateur,
    PERMISSIONS.RH_COMPETENCE_GERER,
  );
  // Creer un compte utilisateur et lui attribuer des roles releve de la gestion
  // des utilisateurs : `RH_ECRIRE` ne suffit pas, sinon un profil RH pourrait
  // s'attribuer n'importe quel role.
  const peutGererComptes = aLaPermission(
    utilisateur,
    PERMISSIONS.UTILISATEUR_GERER,
  );

  // Le salaire n'est interroge que si la permission est detenue.
  const salaires = voitSalaires
    ? await prisma.employee.findUnique({
        where: { id: identifiant },
        select: { baseSalary: true, salaryPerDay: true },
      })
    : null;

  const { debut, fin } = debutEtFinDeMois(new Date());

  const [
    competences,
    competencesDisponibles,
    presences,
    ateliers,
    depots,
    roles,
    affectations,
    evaluations,
  ] = await Promise.all([
    prisma.employeeSkill.findMany({
      where: { employeeId: identifiant },
      orderBy: { level: "desc" },
      include: {
        skill: {
          select: {
            id: true,
            code: true,
            label: true,
            factory: true,
            operation: { select: { code: true, label: true } },
            item: { select: { code: true, label1: true } },
          },
        },
      },
    }),
    prisma.skill.findMany({
      where: { isActive: true, factory: { in: [employe.factory, "COMMUN"] } },
      orderBy: { code: "asc" },
      take: 300,
      select: { id: true, code: true, label: true },
    }),
    prisma.attendance.findMany({
      where: { employeeId: identifiant, date: { gte: debut, lte: fin } },
      orderBy: { date: "desc" },
      take: 62,
    }),
    prisma.workshop.findMany({
      where: { isActive: true, factory: { in: usinesAutorisees(utilisateur) } },
      orderBy: [{ factory: "asc" }, { code: "asc" }],
      take: 200,
      select: { id: true, code: true, label: true },
    }),
    prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 200,
      select: { id: true, code: true, label: true },
    }),
    prisma.role.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 100,
      select: { code: true, label: true },
    }),
    listerAffectations({ employeeId: identifiant, page: 1, taille: 20 }),
    listerEvaluations({ employeeId: identifiant, page: 1, taille: 10 }),
  ]);

  const heuresMois = presences.reduce(
    (total, presence) => total + presence.workedHours.toNumber(),
    0,
  );
  const heuresSupplementairesMois = presences.reduce(
    (total, presence) => total + presence.overtimeHours.toNumber(),
    0,
  );

  const identite: { terme: string; valeur: ReactNode }[] = [
    { terme: "Matricule", valeur: employe.matricule },
    {
      terme: "Nom et prenom",
      valeur: `${employe.lastName} ${employe.firstName}`.trim(),
    },
    { terme: "Poste", valeur: employe.jobTitle ?? "Non renseigne" },
    { terme: "Genre", valeur: employe.gender ?? "Non renseigne" },
    { terme: "Date de naissance", valeur: formatDate(employe.birthDate) },
    {
      terme: "Numero de securite sociale",
      valeur: employe.socialSecurityNumber ?? "Non renseigne",
    },
    { terme: "Compte CCP", valeur: employe.ccp ?? "Non renseigne" },
    { terme: "Telephone", valeur: employe.phone ?? "Non renseigne" },
    { terme: "Telephone secondaire", valeur: employe.phone2 ?? "Non renseigne" },
    { terme: "Adresse electronique", valeur: employe.email ?? "Non renseigne" },
    { terme: "Adresse", valeur: employe.address ?? "Non renseignee" },
    { terme: "Commune / ville", valeur: employe.city ?? "Non renseignee" },
    { terme: "Division", valeur: libelle(LIBELLES_USINE, employe.factory) },
    {
      terme: "Atelier de rattachement",
      valeur: employe.workshop
        ? `${employe.workshop.code} — ${employe.workshop.label}`
        : "Non rattache",
    },
    {
      terme: "Depot par defaut",
      valeur: employe.defaultWarehouse
        ? `${employe.defaultWarehouse.code} — ${employe.defaultWarehouse.label}`
        : "Non renseigne",
    },
    { terme: "Type de contrat", valeur: employe.contractType ?? "Non renseigne" },
    { terme: "Date d'embauche", valeur: formatDate(employe.hireDate) },
    { terme: "Date de fin de contrat", valeur: formatDate(employe.endDate) },
    {
      terme: "Statut",
      valeur: (
        <EtiquetteStatut
          libelle={employe.isActive ? "Actif" : "Inactif"}
          code={employe.isActive ? "ACTIF" : "INACTIF"}
        />
      ),
    },
    { terme: "Fiche creee le", valeur: formatDateTime(employe.createdAt) },
  ];

  if (salaires) {
    identite.push(
      {
        terme: `Salaire de base (${DEVISE_PAR_DEFAUT})`,
        valeur: formatMontant(salaires.baseSalary, DEVISE_PAR_DEFAUT),
      },
      {
        terme: `Salaire journalier (${DEVISE_PAR_DEFAUT})`,
        valeur: formatMontant(salaires.salaryPerDay, DEVISE_PAR_DEFAUT),
      },
    );
  }

  return (
    <>
      <EnTetePage
        titre={`${employe.firstName} ${employe.lastName}`}
        description={`Fiche employe ${employe.matricule} — ${libelle(LIBELLES_USINE, employe.factory)}.`}
        actions={
          <Link className="lien-nav text-sm" href="/rh/employes">
            Retour a la liste
          </Link>
        }
      />

      {!voitSalaires && (
        <div className="mb-5">
          <Alerte ton="neutre" titre="Donnees salariales non affichees">
            {`Votre profil ne detient pas la permission « ${getPermissionLabel(
              PERMISSIONS.RH_SALAIRE_LIRE,
            )} » : aucun salaire n'a ete charge depuis la base pour cette fiche.`}
          </Alerte>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        <Statistique
          libelle="Presences ce mois"
          valeur={presences.filter((p) => p.status === "PRESENT").length}
          detail={`${formatQuantite(heuresMois)} h travaillees`}
          ton="info"
        />
        <Statistique
          libelle="Retards ce mois"
          valeur={presences.filter((p) => p.status === "RETARD").length}
          detail={`${formatQuantite(heuresSupplementairesMois)} h supplementaires`}
          ton="alerte"
        />
        <Statistique
          libelle="Competences declarees"
          valeur={competences.length}
          detail={
            competences.length > 0
              ? `Niveau moyen ${formatQuantite(
                  competences.reduce((t, c) => t + c.level, 0) / competences.length,
                  2,
                )} / 5`
              : "Aucune competence declaree"
          }
          ton="primaire"
        />
        <Statistique
          libelle="Evaluations enregistrees"
          valeur={evaluations.total}
          detail="Evaluations dont cet employe est le sujet"
          ton="neutre"
        />
      </div>

      <div className="mt-5">
        <Carte titre="Identite, coordonnees et contrat">
          <ListeDefinitions elements={identite} />
        </Carte>
      </div>

      {peutEcrire && (
        <Section titre="Modifier la fiche">
          <Carte
            titre="Mise a jour"
            description="Une mise a jour partielle n'efface aucune donnee salariale par omission."
          >
            <FormulaireAction
              action={actionModifierEmploye}
              libelleSoumettre="Enregistrer les modifications"
            >
              <input type="hidden" name="employeeId" value={employe.id} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Champ
                  nom="lastName"
                  libelle="Nom"
                  requis
                  valeur={employe.lastName}
                />
                <Champ
                  nom="firstName"
                  libelle="Prenom"
                  requis
                  valeur={employe.firstName}
                />
                <Champ nom="jobTitle" libelle="Poste" valeur={employe.jobTitle ?? ""} />
                <Champ
                  nom="factory"
                  libelle="Division"
                  type="select"
                  valeur={employe.factory}
                  options={usinesAutorisees(utilisateur).map((usine) => ({
                    valeur: usine,
                    libelle: libelle(LIBELLES_USINE, usine),
                  }))}
                />
                <Champ
                  nom="workshopId"
                  libelle="Atelier"
                  type="select"
                  valeur={employe.workshopId}
                  options={ateliers.map((atelier) => ({
                    valeur: atelier.id,
                    libelle: `${atelier.code} — ${atelier.label}`,
                  }))}
                />
                <Champ
                  nom="defaultWarehouseId"
                  libelle="Depot par defaut"
                  type="select"
                  valeur={employe.defaultWarehouseId}
                  options={depots.map((depot) => ({
                    valeur: depot.id,
                    libelle: `${depot.code} — ${depot.label}`,
                  }))}
                />
                <Champ nom="phone" libelle="Telephone" valeur={employe.phone ?? ""} />
                <Champ
                  nom="phone2"
                  libelle="Telephone secondaire"
                  valeur={employe.phone2 ?? ""}
                />
                <Champ
                  nom="email"
                  libelle="Adresse electronique"
                  type="email"
                  valeur={employe.email ?? ""}
                />
                <Champ nom="address" libelle="Adresse" valeur={employe.address ?? ""} />
                <Champ nom="city" libelle="Commune / ville" valeur={employe.city ?? ""} />
                <Champ
                  nom="contractType"
                  libelle="Type de contrat"
                  valeur={employe.contractType ?? ""}
                />
                <Champ
                  nom="hireDate"
                  libelle="Date d'embauche"
                  type="date"
                  valeur={toInputDate(employe.hireDate)}
                />
                <Champ
                  nom="endDate"
                  libelle="Date de fin de contrat"
                  type="date"
                  valeur={toInputDate(employe.endDate)}
                />
                {voitSalaires && (
                  <>
                    <Champ
                      nom="baseSalary"
                      libelle={`Salaire de base (${DEVISE_PAR_DEFAUT})`}
                      type="number"
                      pas="0.01"
                      min="0"
                      valeur={salaires?.baseSalary ? salaires.baseSalary.toFixed(2) : ""}
                    />
                    <Champ
                      nom="salaryPerDay"
                      libelle={`Salaire journalier (${DEVISE_PAR_DEFAUT})`}
                      type="number"
                      pas="0.01"
                      min="0"
                      valeur={
                        salaires?.salaryPerDay ? salaires.salaryPerDay.toFixed(2) : ""
                      }
                    />
                  </>
                )}
              </div>
            </FormulaireAction>
          </Carte>
        </Section>
      )}

      <Section titre="Compte utilisateur nominatif">
        <Carte
          titre={employe.user ? "Compte rattache" : "Aucun compte rattache"}
          description="Un compte par personne : aucun compte partage n'est autorise sur la plateforme."
        >
          {employe.user ? (
            <ListeDefinitions
              elements={[
                { terme: "Adresse de connexion", valeur: employe.user.email },
                {
                  terme: "Roles attribues",
                  valeur:
                    employe.user.roles.map((r) => r.role.label).join(", ") ||
                    "Aucun role",
                },
                {
                  terme: "Statut du compte",
                  valeur: (
                    <EtiquetteStatut
                      libelle={employe.user.isActive ? "Actif" : "Inactif"}
                      code={employe.user.isActive ? "ACTIF" : "INACTIF"}
                    />
                  ),
                },
                {
                  terme: "Derniere connexion",
                  valeur: formatDateTime(employe.user.lastLoginAt),
                },
                {
                  terme: "Changement de mot de passe",
                  valeur: employe.user.mustChangePassword
                    ? "Exige a la prochaine connexion"
                    : "Deja effectue",
                },
              ]}
            />
          ) : peutGererComptes ? (
            <>
              <Alerte ton="alerte" titre="Mot de passe temporaire">
                Le mot de passe — celui que vous saisissez ou celui genere par le
                serveur — ne sera affiche qu'une seule fois, au moment de la
                creation. Notez-le et remettez-le en main propre. L'employe devra
                le changer des sa premiere connexion.
              </Alerte>
              <div className="mt-4">
                <FormulaireAction
                  action={actionCreerCompteEmploye}
                  libelleSoumettre="Creer le compte nominatif"
                >
                  <input type="hidden" name="employeeId" value={employe.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Champ
                      nom="email"
                      libelle="Adresse electronique du compte"
                      type="email"
                      requis
                      valeur={employe.email ?? ""}
                      aide="Cette adresse doit etre propre a cet employe."
                    />
                    <Champ
                      nom="motDePasse"
                      libelle="Mot de passe temporaire"
                      type="password"
                      aide="Laissez vide pour laisser le serveur en generer un robuste."
                    />
                  </div>
                  <fieldset className="mt-3">
                    <legend className="mb-2 text-sm font-medium">
                      Roles attribues
                    </legend>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {roles.map((role) => (
                        <label
                          key={role.code}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input type="checkbox" name="roleCodes" value={role.code} />
                          <span>{role.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </FormulaireAction>
              </div>
            </>
          ) : (
            <Alerte ton="neutre" titre="Creation de compte non autorisee">
              {`Aucun compte n'est rattache a cet employe et votre profil ne detient pas la permission « ${getPermissionLabel(
                PERMISSIONS.UTILISATEUR_GERER,
              )} », necessaire pour creer un compte utilisateur et lui attribuer des roles.`}
            </Alerte>
          )}
        </Carte>
      </Section>

      <Section titre="Competences et polyvalence">
        <Carte
          titre={`${competences.length} competence(s) declaree(s)`}
          description="La polyvalence est la norme : un employe peut couvrir plusieurs operations differentes au fil des journees."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "code", libelle: "Code" },
              { cle: "competence", libelle: "Competence" },
              { cle: "division", libelle: "Division" },
              { cle: "support", libelle: "Operation ou article associe" },
              { cle: "niveau", libelle: "Niveau", nombre: true },
              { cle: "certifie", libelle: "Certifiee le" },
              { cle: "notes", libelle: "Notes" },
            ]}
            lignes={competences.map((competence) => ({
              cle: String(competence.id),
              cellules: [
                competence.skill.code,
                competence.skill.label,
                libelle(LIBELLES_USINE, competence.skill.factory),
                competence.skill.operation
                  ? `${competence.skill.operation.code} — ${competence.skill.operation.label}`
                  : competence.skill.item
                    ? `Article ${competence.skill.item.code}`
                    : "Aucun support rattache",
                `${competence.level} / 5`,
                formatDate(competence.certifiedAt),
                competence.notes ?? "-",
              ],
            }))}
            messageVide="Aucune competence declaree pour cet employe."
          />
        </Carte>

        {peutCompetences && (
          <div className="mt-4">
            <Carte
              titre="Declarer une competence"
              description="Le niveau est certifie a la date de la declaration."
            >
              <FormulaireAction
                action={actionDeclarerCompetence}
                libelleSoumettre="Declarer la competence"
              >
                <input type="hidden" name="employeeId" value={employe.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Champ
                    nom="skillId"
                    libelle="Competence"
                    type="select"
                    requis
                    options={competencesDisponibles.map((competence) => ({
                      valeur: competence.id,
                      libelle: `${competence.code} — ${competence.label}`,
                    }))}
                  />
                  <Champ
                    nom="level"
                    libelle="Niveau (1 a 5)"
                    type="number"
                    requis
                    min="1"
                    max="5"
                  />
                  <Champ nom="notes" libelle="Notes" type="textarea" />
                </div>
              </FormulaireAction>
            </Carte>
          </div>
        )}
      </Section>

      <Section titre="Affectations recentes">
        <Carte
          titre="Vingt dernieres affectations"
          description="L'evaluation d'un employe ne porte que sur les operations qu'il a reellement effectuees."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "date", libelle: "Journee" },
              { cle: "operation", libelle: "Operation" },
              { cle: "ordre", libelle: "Ordre" },
              { cle: "atelier", libelle: "Atelier" },
              { cle: "statut", libelle: "Statut" },
              { cle: "debut", libelle: "Debut reel" },
              { cle: "fin", libelle: "Fin reelle" },
              { cle: "motif", libelle: "Motif de changement" },
            ]}
            lignes={affectations.lignes.map((affectation) => ({
              cle: String(affectation.id),
              cellules: [
                formatDate(affectation.date),
                `${affectation.operation.code} — ${affectation.operation.label}`,
                affectation.workOrder?.number ?? "Hors ordre",
                affectation.workshop
                  ? `${affectation.workshop.code} — ${affectation.workshop.label}`
                  : "-",
                <EtiquetteStatut
                  key="s"
                  libelle={libelle(
                    LIBELLES_STATUT_AFFECTATION,
                    affectation.status,
                  )}
                  code={affectation.status}
                />,
                formatDateTime(affectation.actualStart),
                formatDateTime(affectation.actualEnd),
                affectation.changeReason ?? "-",
              ],
            }))}
            messageVide="Aucune affectation enregistree pour cet employe."
          />
          <Pagination
            page={affectations.page}
            pages={affectations.pages}
            total={affectations.total}
            construireLien={(page) => `/rh/employes/${employe.id}?page=${page}`}
          />
        </Carte>
      </Section>

      <Section titre="Presences du mois en cours">
        <Carte
          titre={`${presences.length} pointage(s)`}
          description={`Du ${formatDate(debut)} au ${formatDate(fin)}.`}
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "date", libelle: "Journee" },
              { cle: "statut", libelle: "Statut" },
              { cle: "entree", libelle: "Arrivee" },
              { cle: "sortie", libelle: "Depart" },
              { cle: "heures", libelle: "Heures travaillees", nombre: true },
              { cle: "supp", libelle: "Heures supplementaires", nombre: true },
              { cle: "retard", libelle: "Retard (min)", nombre: true },
              { cle: "commentaire", libelle: "Commentaire" },
            ]}
            lignes={presences.map((presence) => ({
              cle: String(presence.id),
              cellules: [
                formatDate(presence.date),
                <EtiquetteStatut
                  key="s"
                  libelle={libelle(LIBELLES_PRESENCE, presence.status)}
                  code={presence.status}
                />,
                formatHeure(presence.checkIn),
                formatHeure(presence.checkOut),
                formatQuantite(presence.workedHours),
                formatQuantite(presence.overtimeHours),
                presence.lateMinutes,
                presence.comment ?? "-",
              ],
            }))}
            messageVide="Aucun pointage enregistre sur le mois en cours."
          />
        </Carte>
      </Section>

      <Section titre="Evaluations dont cet employe est le sujet">
        <Carte
          titre={`${evaluations.total} evaluation(s)`}
          description="Seules les evaluations de cet employe sont presentees."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "periode", libelle: "Periode" },
              { cle: "bornes", libelle: "Bornes" },
              { cle: "operation", libelle: "Operation" },
              { cle: "global", libelle: "Score global", nombre: true },
              { cle: "fiabilite", libelle: "Fiabilite" },
              { cle: "validation", libelle: "Validation" },
              { cle: "valideur", libelle: "Valideur" },
              { cle: "commentaire", libelle: "Commentaire" },
            ]}
            lignes={evaluations.lignes.map((evaluation) => ({
              cle: String(evaluation.id),
              cellules: [
                libelle(LIBELLES_PERIODE_EVALUATION, evaluation.periodType),
                `${formatDate(evaluation.periodStart)} au ${formatDate(evaluation.periodEnd)}`,
                evaluation.operation
                  ? `${evaluation.operation.code} — ${evaluation.operation.label}`
                  : "Toutes operations",
                evaluation.globalScore
                  ? evaluation.globalScore.toFixed(2)
                  : "Donnees insuffisantes",
                <EtiquetteStatut
                  key="f"
                  libelle={libelle(LIBELLES_FIABILITE, evaluation.reliability)}
                  code={evaluation.reliability}
                />,
                evaluation.isValidated ? (
                  <Etiquette key="v" ton="succes">
                    Validee
                  </Etiquette>
                ) : (
                  <Etiquette key="v" ton="alerte">
                    En attente de validation
                  </Etiquette>
                ),
                evaluation.validatedBy
                  ? `${evaluation.validatedBy.firstName} ${evaluation.validatedBy.lastName}`.trim()
                  : "-",
                evaluation.comment ?? "-",
              ],
            }))}
            messageVide="Aucune evaluation enregistree pour cet employe."
          />
        </Carte>
      </Section>

      {peutEcrire && employe.isActive && (
        <Section titre="Desactivation">
          <Carte
            titre="Desactiver la fiche employe"
            description="Aucune suppression n'est possible : la desactivation conserve l'historique complet et ferme le compte utilisateur rattache."
          >
            <FormulaireMotif
              action={actionDesactiverEmploye}
              libelleSoumettre="Desactiver l'employe"
              varianteSoumettre="danger"
              libelleMotif="Motif de la desactivation"
              motifMinimum={5}
              champsCaches={{ employeeId: employe.id }}
            />
          </Carte>
        </Section>
      )}
    </>
  );
}
