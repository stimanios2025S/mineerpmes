import { notFound } from "next/navigation";
import { prisma as p } from "@/lib/db";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { EnTetePage, Carte, Etiquette, Statistique, Tableau, Vide } from "@/components/ui";
import { formatDate, formatQuantite } from "@/lib/format";
import { LIBELLES_USINE } from "@/lib/libelles";
import Link from "next/link";

export const metadata = { title: "Atelier" };

export default async function PageAtelier({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await exigerPermission(PERMISSIONS.TABLEAU_BORD_PRODUCTION);
  const { code } = await params;

  const workshop = await p.workshop.findFirst({
    where: { code },
    include: { workCenters: { select: { id: true, code: true, label: true } } },
  });

  if (!workshop) notFound();

  const ordres = await p.workOrder.findMany({
    where: {
      factory: workshop.factory,
      status: { notIn: ["CLOTURE", "ANNULE"] },
      operations: { some: { workCenter: { workshopId: workshop.id } } },
    },
    include: {
      item: { select: { code: true, label1: true } },
      operations: {
        where: { workCenter: { workshopId: workshop.id } },
        select: { stepNo: true, status: true, quantityPlanned: true, quantityConform: true, quantityScrapped: true, workCenter: { select: { code: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const employes = await p.employee.findMany({
    where: { workshopId: workshop.id, isActive: true },
    select: { matricule: true, firstName: true, lastName: true, jobTitle: true },
  });

  const today = new Date();
  const jour = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const affectations = await p.assignment.findMany({
    where: { workshopId: workshop.id, date: jour },
    include: {
      employee: { select: { matricule: true, firstName: true, lastName: true } },
      operation: { select: { code: true, label: true } },
      workOrder: { select: { number: true } },
    },
  });

  const scans = await p.workCenterScan.findMany({
    where: { workCenter: { workshopId: workshop.id } },
    include: {
      workCenter: { select: { code: true } },
      employee: { select: { matricule: true, firstName: true, lastName: true } },
    },
    orderBy: { scannedAt: "desc" },
    take: 10,
  });

  const totalConforme = ordres.reduce((total, of) =>
    total + of.operations.reduce((s, o) => s + Number(o.quantityConform), 0), 0);
  const totalRebut = ordres.reduce((total, of) =>
    total + of.operations.reduce((s, o) => s + Number(o.quantityScrapped), 0), 0);
  const operationsEnCours = ordres.reduce((total, of) =>
    total + of.operations.filter(o => o.status === "EN_COURS").length, 0);

  return (
    <>
      <EnTetePage
        titre={workshop.label}
        description={`${LIBELLES_USINE[workshop.factory]} — ${workshop.workCenters.length} postes`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-5">
        <Statistique libelle="OF en cours" valeur={ordres.length} ton="primaire" />
        <Statistique libelle="Operations en cours" valeur={operationsEnCours} ton="info" />
        <Statistique libelle="Quantite conforme" valeur={formatQuantite(totalConforme)} ton="succes" />
        <Statistique libelle="Rebuts" valeur={formatQuantite(totalRebut)} ton={totalRebut > 0 ? "alerte" : "succes"} />
        <Statistique libelle="Employes" valeur={employes.length} />
      </div>

      <Carte titre="Employes de l atelier">
        {employes.length === 0 ? (
          <Vide message="Aucun employe affecte a cet atelier." />
        ) : (
          <Tableau
            messageVide=""
            cleLigne={(i) => employes[i].matricule}
            colonnes={[
              { cle: "matricule", libelle: "Matricule" },
              { cle: "nom", libelle: "Nom" },
              { cle: "poste", libelle: "Poste" },
            ]}
            lignes={employes.map(e => ({
              cle: e.matricule,
              cellules: [
                <span key="m" className="font-mono">{e.matricule}</span>,
                <span key="n">{e.lastName} {e.firstName}</span>,
                <span key="p">{e.jobTitle ?? "-"}</span>,
              ],
            }))}
          />
        )}
      </Carte>

      <div className="mt-4">
        <Carte titre={`Affectations du jour — ${formatDate(jour)}`}>
          {affectations.length === 0 ? (
            <Vide message="Aucune affectation pour aujourd hui." />
          ) : (
            <Tableau
              messageVide=""
              cleLigne={(i) => String(affectations[i].id)}
              colonnes={[
                { cle: "employe", libelle: "Employe" },
                { cle: "operation", libelle: "Operation" },
                { cle: "of", libelle: "OF" },
                { cle: "statut", libelle: "Statut" },
              ]}
              lignes={affectations.map(a => ({
                cle: String(a.id),
                cellules: [
                  <span key="e">{a.employee.lastName} {a.employee.firstName}</span>,
                  <span key="o">{a.operation.code}</span>,
                  <span key="of">{a.workOrder?.number ?? "-"}</span>,
                  <Etiquette key="s" ton={a.status === "EN_COURS" ? "info" : "neutre"}>{a.status}</Etiquette>,
                ],
              }))}
            />
          )}
        </Carte>
      </div>

      <div className="mt-4">
        <Carte titre="Ordres de fabrication en cours">
          {ordres.length === 0 ? (
            <Vide message="Aucun OF en cours pour cet atelier." />
          ) : (
            <Tableau
              messageVide=""
              cleLigne={(i) => String(ordres[i].id)}
              colonnes={[
                { cle: "of", libelle: "OF" },
                { cle: "article", libelle: "Article" },
                { cle: "quantite", libelle: "Qte", nombre: true },
                { cle: "etape", libelle: "Etape" },
                { cle: "avancement", libelle: "Avancement" },
              ]}
              lignes={ordres.map(of => {
                const op = of.operations[0];
                return {
                  cle: String(of.id),
                  cellules: [
                    <span key="o"><Link href={`/production/${of.id}`} className="lien-nav font-mono">{of.number}</Link></span>,
                    <span key="a">{of.item.code}</span>,
                    <span key="q">{formatQuantite(of.quantityPlanned)}</span>,
                    <span key="e">{op ? `Etape ${op.stepNo} (${op.workCenter?.code ?? "poste non precise"})` : "-"}</span>,
                    <span key="v">{formatQuantite(op?.quantityConform ?? 0)} / {formatQuantite(op?.quantityPlanned ?? 0)}</span>,
                  ],
                };
              })}
            />
          )}
        </Carte>
      </div>

      <div className="mt-4">
        <Carte titre="Derniers scans QR">
          {scans.length === 0 ? (
            <Vide message="Aucun scan enregistre." />
          ) : (
            <Tableau
              messageVide=""
              cleLigne={(i) => String(scans[i].id)}
              colonnes={[
                { cle: "date", libelle: "Date" },
                { cle: "poste", libelle: "Poste" },
                { cle: "employe", libelle: "Employe" },
                { cle: "resultat", libelle: "Resultat" },
              ]}
              lignes={scans.map(s => ({
                cle: String(s.id),
                cellules: [
                  <span key="d">{new Date(s.scannedAt).toLocaleString("fr-FR")}</span>,
                  <span key="p" className="font-mono">{s.workCenter.code}</span>,
                  <span key="e">{s.employee ? `${s.employee.lastName} ${s.employee.firstName}` : "-"}</span>,
                  s.result === "ACCEPTE" ? (
                    <Etiquette key="r" ton="succes">Accepte</Etiquette>
                  ) : (
                    <Etiquette key="r" ton="danger">{s.result}</Etiquette>
                  ),
                ],
              }))}
            />
          )}
        </Carte>
      </div>
    </>
  );
}
