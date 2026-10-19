import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma as p } from "@/lib/db";
import { aLaPermission, exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { Carte, EnTetePage, Etiquette, Statistique, Tableau, Vide } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { actionAffecterOperation } from "@/actions/atelier";
import { formatDate, formatQuantite } from "@/lib/format";
import {
  LIBELLES_PRIORITE,
  LIBELLES_STATUT_OPERATION,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Atelier" };

/**
 * Portail du chef d'atelier.
 *
 * Trois gestes, dans cet ordre : affecter les operations du jour aux ouvriers,
 * demander le materiel manquant au magasin, suivre ce qui se passe a l'atelier.
 *
 * Le chef s'affecte lui-meme comme n'importe quel ouvrier : il figure dans la
 * liste des employes de l'atelier, il n'a pas de traitement a part.
 */
export default async function PageAtelier({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.TABLEAU_BORD_PRODUCTION);
  const { code } = await params;

  const workshop = await p.workshop.findFirst({
    where: { code, factory: { in: usinesAutorisees(utilisateur) } },
    include: { workCenters: { select: { id: true, code: true, label: true } } },
  });

  if (!workshop) notFound();

  /*
   * Un chef d'atelier ne voit que son atelier.
   *
   * Le role porte le code de l'atelier (CHEF_ADM_A01 -> ADM-A01). Le menu
   * masque deja les autres entrees, mais une adresse tapee a la main ne doit
   * pas ouvrir l'atelier du voisin : le controle est refait ici, comme pour
   * toutes les pages.
   */
  const ateliersDuChef = utilisateur.roles
    .map((role) => role.code)
    .filter((codeRole) => codeRole.startsWith("CHEF_"))
    .map((codeRole) => codeRole.replace(/^CHEF_/, "").replace("_", "-"));

  if (ateliersDuChef.length > 0 && !ateliersDuChef.includes(workshop.code)) {
    notFound();
  }

  const peutOrganiser = aLaPermission(utilisateur, PERMISSIONS.PRODUCTION_PLANNING_GERER);

  const aujourdHui = new Date();
  const jour = new Date(
    Date.UTC(aujourdHui.getFullYear(), aujourdHui.getMonth(), aujourdHui.getDate()),
  );

  const employes = await p.employee.findMany({
    where: { workshopId: workshop.id, isActive: true },
    select: { id: true, matricule: true, firstName: true, lastName: true, jobTitle: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const operations = await p.workOrderOperation.findMany({
    where: {
      workCenter: { workshopId: workshop.id },
      workOrder: { status: { notIn: ["CLOTURE", "ANNULE"] } },
    },
    select: {
      id: true,
      stepNo: true,
      status: true,
      quantityPlanned: true,
      quantityConform: true,
      quantityScrapped: true,
      workOrder: {
        select: {
          id: true,
          number: true,
          priority: true,
          item: { select: { code: true, label1: true } },
        },
      },
      operation: { select: { label: true } },
      workCenter: { select: { code: true } },
      assignments: {
        where: { date: jour },
        select: {
          id: true,
          employee: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
    orderBy: [{ workOrder: { priority: "desc" } }, { stepNo: "asc" }],
    take: 60,
  });

  const ordres = await p.workOrder.findMany({
    where: {
      factory: workshop.factory,
      status: { notIn: ["CLOTURE", "ANNULE"] },
      operations: { some: { workCenter: { workshopId: workshop.id } } },
    },
    select: {
      id: true,
      number: true,
      item: { select: { code: true, label1: true } },
      _count: { select: { materials: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const totalConforme = operations.reduce(
    (total, o) => total + Number(o.quantityConform),
    0,
  );
  const totalRebut = operations.reduce(
    (total, o) => total + Number(o.quantityScrapped),
    0,
  );
  const enCours = operations.filter((o) => o.status === "EN_COURS").length;
  const nonAffectees = operations.filter((o) => o.assignments.length === 0).length;

  const optionsEmployes = employes.map((e) => ({
    valeur: e.id,
    libelle: `${e.lastName} ${e.firstName} (${e.matricule})`,
  }));

  return (
    <>
      <EnTetePage
        titre={workshop.label}
        description={`${LIBELLES_USINE[workshop.factory]} — ${workshop.workCenters.length} postes · programme du ${formatDate(jour)}`}
        actions={
          <>
            <Link className="bouton secondaire" href="/production/programme">
              Programme de travail
            </Link>
            <Link className="bouton secondaire" href="/production">
              Ordres de fabrication
            </Link>
          </>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Statistique libelle="Operations du jour" valeur={operations.length} ton="primaire" />
        <Statistique
          libelle="Non affectees"
          valeur={nonAffectees}
          ton={nonAffectees > 0 ? "alerte" : "succes"}
        />
        <Statistique libelle="En cours" valeur={enCours} ton="info" />
        <Statistique
          libelle="Rebuts"
          valeur={formatQuantite(totalRebut)}
          ton={totalRebut > 0 ? "alerte" : "succes"}
        />
      </div>

      <Carte
        titre="Programme du jour — affecter les operations"
        description="Chaque operation d'un ordre lance dans cet atelier. Choisissez l'ouvrier, y compris vous-meme, puis affectez."
      >
        {operations.length === 0 ? (
          <Vide message="Aucune operation en attente pour cet atelier. Les ordres doivent etre lances depuis la production." />
        ) : (
          <Tableau
            messageVide=""
            cleLigne={(i) => String(operations[i].id)}
            colonnes={[
              { cle: "priorite", libelle: "Priorite" },
              { cle: "of", libelle: "Ordre" },
              { cle: "article", libelle: "Article" },
              { cle: "etape", libelle: "Etape" },
              { cle: "poste", libelle: "Poste" },
              { cle: "quantite", libelle: "Prevu", nombre: true },
              { cle: "avancement", libelle: "Produit", nombre: true },
              { cle: "statut", libelle: "Statut" },
              { cle: "affecte", libelle: "Affecte a" },
              { cle: "action", libelle: "" },
            ]}
            lignes={operations.map((o) => {
              const affecte = o.assignments[0]?.employee;
              return {
                cle: String(o.id),
                cellules: [
                  <Etiquette key="p" ton={o.workOrder.priority === "URGENTE" ? "danger" : "neutre"}>
                    {libelle(LIBELLES_PRIORITE, o.workOrder.priority)}
                  </Etiquette>,
                  <Link
                    key="of"
                    href={`/production/${o.workOrder.id}`}
                    className="font-mono underline"
                  >
                    {o.workOrder.number}
                  </Link>,
                  <span key="a">{o.workOrder.item.code}</span>,
                  <span key="e">
                    {o.stepNo}. {o.operation.label}
                  </span>,
                  <span key="pc" className="font-mono">
                    {o.workCenter?.code ?? "-"}
                  </span>,
                  formatQuantite(o.quantityPlanned),
                  formatQuantite(o.quantityConform),
                  <Etiquette
                    key="s"
                    ton={
                      o.status === "EN_COURS"
                        ? "info"
                        : o.status === "TERMINEE"
                          ? "succes"
                          : "neutre"
                    }
                  >
                    {libelle(LIBELLES_STATUT_OPERATION, o.status)}
                  </Etiquette>,
                  affecte ? (
                    <span key="af">
                      {affecte.lastName} {affecte.firstName}
                    </span>
                  ) : (
                    <Etiquette key="af" ton="alerte">
                      Personne
                    </Etiquette>
                  ),
                  peutOrganiser ? (
                    <FormulaireAction
                      key="f"
                      action={actionAffecterOperation}
                      libelleSoumettre="Affecter"
                      className="flex flex-col gap-1"
                    >
                      <input type="hidden" name="workOrderOperationId" value={o.id} />
                      <Champ
                        nom="employeeId"
                        libelle=""
                        type="select"
                        requis
                        valeur={affecte?.id}
                        options={optionsEmployes}
                      />
                    </FormulaireAction>
                  ) : (
                    <span key="f" />
                  ),
                ],
              };
            })}
          />
        )}
      </Carte>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Carte
          titre="Materiel de l'atelier"
          description="Bons de commande internes : ce que l'atelier demande au magasin pour ses ordres."
        >
          {ordres.length === 0 ? (
            <Vide message="Aucun ordre en cours dans cet atelier." />
          ) : (
            <ul className="space-y-2">
              {ordres.map((of) => (
                <li
                  key={of.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--rayon-petit)] border p-3"
                >
                  <div>
                    <p className="font-mono text-sm font-semibold">{of.number}</p>
                    <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      {of.item.code} — {of._count.materials} ligne(s) de matiere
                    </p>
                  </div>
                  <Link className="bouton secondaire" href={`/stock/bci/${of.id}`}>
                    Bon interne
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Carte>

        <Carte
          titre="Equipe de l'atelier"
          description="Les ouvriers affectables, vous compris si votre fiche est rattachee a cet atelier."
        >
          {employes.length === 0 ? (
            <Vide message="Aucun employe rattache a cet atelier." />
          ) : (
            <Tableau
              messageVide=""
              cleLigne={(i) => String(employes[i].id)}
              colonnes={[
                { cle: "matricule", libelle: "Matricule" },
                { cle: "nom", libelle: "Nom" },
                { cle: "poste", libelle: "Poste" },
              ]}
              lignes={employes.map((e) => ({
                cle: String(e.id),
                cellules: [
                  <span key="m" className="font-mono">
                    {e.matricule}
                  </span>,
                  <span key="n">
                    {e.lastName} {e.firstName}
                  </span>,
                  <span key="p">{e.jobTitle ?? "-"}</span>,
                ],
              }))}
            />
          )}
        </Carte>
      </div>
    </>
  );
}
