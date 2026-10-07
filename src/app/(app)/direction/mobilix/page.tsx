import { prisma } from "@/lib/db";
import { exigerPageUsine } from "@/lib/rbac/pages";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { EnTetePage, Carte, Etiquette, Statistique, Tableau, Vide } from "@/components/ui";
import { formatDate, formatQuantite } from "@/lib/format";
import { LIBELLES_USINE } from "@/lib/libelles";
import Link from "next/link";

export const metadata = { title: "Direction MOBILIX" };

export default async function PageDirectionMobilix() {
  await exigerPageUsine(PERMISSIONS.TABLEAU_BORD_LIRE, "MOBILIX");

  const [ordres, employes, stockAlertes, scansJour, chassisesAttente] = await Promise.all([
    prisma.workOrder.findMany({
      where: { factory: "MOBILIX", status: { notIn: ["CLOTURE", "ANNULE"] } },
      include: {
        item: { select: { code: true, label1: true } },
        operations: { select: { stepNo: true, status: true, quantityConform: true, quantityScrapped: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.employee.count({ where: { factory: "MOBILIX", isActive: true } }),
    prisma.stockBalance.findMany({
      where: { warehouse: { factory: "MOBILIX" } },
      include: { item: { select: { code: true, label1: true } } },
      take: 50,
    }),
    prisma.workCenterScan.count({
      where: { factory: "MOBILIX", scannedAt: { gte: new Date(new Date().setHours(0,0,0,0)) } },
    }),
    // Chassis peints disponibles pour MOBILIX
    prisma.stockBalance.findMany({
      where: {
        warehouse: { factory: "MOBILIX" },
        item: { label1: { contains: "CHASSIS" } },
      },
      include: { item: { select: { code: true, label1: true } } },
      take: 10,
    }),
  ]);

  const ordresEnCours = ordres.length;
  const operationsTerminees = ordres.reduce((total, of) =>
    total + of.operations.filter(o => o.status === "VALIDEE").length, 0);
  const totalRebuts = ordres.reduce((total, of) =>
    total + of.operations.reduce((s, o) => s + Number(o.quantityScrapped), 0), 0);
  const totalConforme = ordres.reduce((total, of) =>
    total + of.operations.reduce((s, o) => s + Number(o.quantityConform), 0), 0);

  const alertes = stockAlertes.filter(b => {
    const dispo = Number(b.quantityPhysical) - Number(b.quantityReserved);
    return dispo <= 10;
  });

  return (
    <>
      <EnTetePage
        titre="Direction MOBILIX"
        description={`Division bois, couture et garnissage — ${LIBELLES_USINE.MOBILIX}`}
        actions={
          <Link href="/production/feuille-de-route" className="bouton primaire">
            Feuille de route
          </Link>
        }
      />

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-5">
        <Statistique libelle="OF en cours" valeur={ordresEnCours} ton="primaire" />
        <Statistique libelle="Operations validees" valeur={operationsTerminees} ton="succes" />
        <Statistique libelle="Quantite conforme" valeur={formatQuantite(totalConforme)} />
        <Statistique libelle="Rebuts" valeur={formatQuantite(totalRebuts)} ton={totalRebuts > 0 ? "alerte" : "succes"} />
        <Statistique libelle="Scans du jour" valeur={scansJour} />
      </div>

      {/* Employes + Chassis + Liens */}
      <div className="grid gap-4 sm:grid-cols-3 mb-5">
        <Carte titre="Employes MOBILIX">
          <p className="text-3xl font-bold">{employes}</p>
          <p className="text-sm opacity-60">Operateurs actifs</p>
        </Carte>
        <Carte titre="Chassis en stock">
          <p className="text-3xl font-bold" style={{color: chassisesAttente.length > 0 ? "var(--succes)" : "var(--alerte)"}}>
            {chassisesAttente.length}
          </p>
          <p className="text-sm opacity-60">Articles chassis disponibles</p>
        </Carte>
        <Carte titre="Liens rapides">
          <div className="flex flex-col gap-2">
            <Link href="/production" className="lien-nav">OF MOBILIX</Link>
            <Link href="/production/kanban" className="lien-nav">Kanban</Link>
            <Link href="/stock" className="lien-nav">Stock</Link>
            <Link href="/portail/mobilix" className="lien-nav">Portail operateurs</Link>
          </div>
        </Carte>
      </div>

      {/* OF en cours */}
      <Carte titre="Ordres de fabrication MOBILIX en cours">
        {ordres.length === 0 ? (
          <Vide message="Aucun OF MOBILIX en cours." />
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
              { cle: "statut", libelle: "Statut" },
            ]}
            lignes={ordres.map(of => {
              const currentOp = of.operations.find(o => o.status === "EN_COURS") ?? of.operations[0];
              return {
                cle: String(of.id),
                cellules: [
                  <span key="o"><Link href={`/production/${of.id}`} className="lien-nav font-mono">{of.number}</Link></span>,
                  <span key="a">{of.item.code}</span>,
                  <span key="q">{formatQuantite(of.quantityPlanned)}</span>,
                  <span key="e">{currentOp ? `Etape ${currentOp.stepNo}` : "-"}</span>,
                  <span key="v">{formatQuantite(currentOp?.quantityConform ?? 0)} / {formatQuantite(of.quantityPlanned)}</span>,
                  <Etiquette key="s" ton={of.status === "EN_COURS" ? "info" : "alerte"}>{of.status}</Etiquette>,
                ],
              };
            })}
          />
        )}
      </Carte>

      {/* Alertes stock */}
      {alertes.length > 0 && (
        <div className="mt-4">
          <Carte titre="Alertes stock MOBILIX">
            <Tableau
              messageVide=""
              cleLigne={(i) => String(alertes[i].id)}
              colonnes={[
                { cle: "article", libelle: "Article" },
                { cle: "dispo", libelle: "Disponible", nombre: true },
                { cle: "physique", libelle: "Physique", nombre: true },
                { cle: "reserve", libelle: "Reserve", nombre: true },
              ]}
              lignes={alertes.map(b => ({
                cle: String(b.id),
                cellules: [
                  <span key="a">{b.item.code} — {b.item.label1}</span>,
                  <span key="d" style={{color: "var(--alerte)", fontWeight: "bold"}}>
                    {formatQuantite(Number(b.quantityPhysical) - Number(b.quantityReserved))}
                  </span>,
                  <span key="p">{formatQuantite(b.quantityPhysical)}</span>,
                  <span key="r">{formatQuantite(b.quantityReserved)}</span>,
                ],
              }))}
            />
          </Carte>
        </div>
      )}
    </>
  );
}
