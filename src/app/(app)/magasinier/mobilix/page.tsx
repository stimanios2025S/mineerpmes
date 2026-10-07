import { prisma } from "@/lib/db";
import { exigerPageUsine } from "@/lib/rbac/pages";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { EnTetePage, Carte, Etiquette, Statistique, Tableau, Vide } from "@/components/ui";
import { formatDate, formatQuantite } from "@/lib/format";
import { LIBELLES_USINE } from "@/lib/libelles";
import Link from "next/link";

export const metadata = { title: "Magasinier MOBILIX" };

export default async function PageMagasinierMobilix() {
  await exigerPageUsine(PERMISSIONS.STOCK_LIRE, "MOBILIX");

  const [ordres, depots, alertes, chassises] = await Promise.all([
    prisma.workOrder.findMany({
      where: { factory: "MOBILIX", status: { in: ["LANCE", "EN_COURS"] } },
      include: {
        item: { select: { code: true, label1: true } },
        materials: {
          where: { isLabor: false },
          include: { componentItem: { select: { code: true, label1: true } } },
          select: { quantityPlanned: true, quantityIssued: true, quantityConsumed: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.warehouse.findMany({
      where: { factory: "MOBILIX" },
      include: {
        balances: {
          include: { item: { select: { code: true, label1: true } } },
          take: 100,
        },
      },
    }),
    prisma.stockBalance.findMany({
      where: { warehouse: { factory: "MOBILIX" } },
      include: { item: { select: { code: true, label1: true } } },
    }),
    prisma.stockBalance.findMany({
      where: {
        warehouse: { factory: "MOBILIX" },
        item: { label1: { contains: "CHASSIS" } },
      },
      include: { item: { select: { code: true, label1: true } } },
    }),
  ]);

  const alertesReelles = alertes.filter(b => {
    const dispo = Number(b.quantityPhysical) - Number(b.quantityReserved);
    return dispo <= 10;
  });

  const totalMatieres = ordres.reduce((total, of) => total + of.materials.length, 0);
  const totalLivrees = ordres.reduce((total, of) =>
    total + of.materials.filter(m => m.quantityIssued >= m.quantityPlanned).length, 0);

  return (
    <>
      <EnTetePage
        titre="Magasinier MOBILIX"
        description={`Gestion des stocks MOBILIX — ${LIBELLES_USINE.MOBILIX}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-5">
        <Statistique libelle="BCI en cours" valeur={ordres.length} ton="primaire" />
        <Statistique libelle="Lignes MP" valeur={totalMatieres} />
        <Statistique libelle="Lignes livrees" valeur={totalLivrees} ton="succes" />
        <Statistique libelle="Chassis en stock" valeur={chassises.length} ton="info" />
        <Statistique libelle="Alertes stock" valeur={alertesReelles.length} ton={alertesReelles.length > 0 ? "alerte" : "succes"} />
      </div>

      <Carte titre="Bons de commande internes MOBILIX">
        {ordres.length === 0 ? (
          <Vide message="Aucun BCI MOBILIX en cours." />
        ) : (
          <Tableau
            messageVide=""
            cleLigne={(i) => String(ordres[i].id)}
            colonnes={[
              { cle: "of", libelle: "OF" },
              { cle: "article", libelle: "Article" },
              { cle: "quantite", libelle: "Qte", nombre: true },
              { cle: "lignes", libelle: "Lignes MP" },
              { cle: "livrees", libelle: "Livrees" },
              { cle: "actions", libelle: "Actions" },
            ]}
            lignes={ordres.map(of => {
              const totalLignes = of.materials.length;
              const livrees = of.materials.filter(m => m.quantityIssued >= m.quantityPlanned).length;
              return {
                cle: String(of.id),
                cellules: [
                  <span key="o"><Link href={`/stock/bci/${of.id}`} className="lien-nav font-mono">{of.number}</Link></span>,
                  <span key="a">{of.item.code}</span>,
                  <span key="q">{formatQuantite(of.quantityPlanned)}</span>,
                  <span key="l">{totalLignes}</span>,
                  livrees === totalLignes ? (
                    <Etiquette key="v" ton="succes">Tout</Etiquette>
                  ) : (
                    <Etiquette key="v" ton="alerte">{livrees}/{totalLignes}</Etiquette>
                  ),
                  <Link key="bci" href={`/stock/bci/${of.id}`} className="bouton secondaire text-xs" style={{minHeight:36}}>BCI</Link>,
                ],
              };
            })}
          />
        )}
      </Carte>

      {chassises.length > 0 && (
        <div className="mt-4">
          <Carte titre="Chassis peints en stock MOBILIX">
            <Tableau
              messageVide=""
              cleLigne={(i) => String(chassises[i].id)}
              colonnes={[
                { cle: "article", libelle: "Article" },
                { cle: "dispo", libelle: "Disponible", nombre: true },
                { cle: "physique", libelle: "Physique", nombre: true },
              ]}
              lignes={chassises.map(b => ({
                cle: String(b.id),
                cellules: [
                  <span key="a">{b.item.code} — {b.item.label1}</span>,
                  <span key="d">{formatQuantite(Number(b.quantityPhysical) - Number(b.quantityReserved))}</span>,
                  <span key="p">{formatQuantite(b.quantityPhysical)}</span>,
                ],
              }))}
            />
          </Carte>
        </div>
      )}

      {alertesReelles.length > 0 && (
        <div className="mt-4">
          <Carte titre="Alertes stock MOBILIX">
            <Tableau
              messageVide=""
              cleLigne={(i) => String(alertesReelles[i].id)}
              colonnes={[
                { cle: "article", libelle: "Article" },
                { cle: "dispo", libelle: "Disponible", nombre: true },
                { cle: "physique", libelle: "Physique", nombre: true },
                { cle: "reserve", libelle: "Reserve", nombre: true },
              ]}
              lignes={alertesReelles.map(b => ({
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

      <div className="mt-4">
        <Carte titre="Depots MOBILIX">
          <Tableau
            messageVide=""
            cleLigne={(i) => String(depots[i].id)}
            colonnes={[
              { cle: "code", libelle: "Code" },
              { cle: "label", libelle: "Designation" },
              { cle: "articles", libelle: "Articles", nombre: true },
            ]}
            lignes={depots.map(d => ({
              cle: String(d.id),
              cellules: [
                <span key="c" className="font-mono">{d.code}</span>,
                <span key="l">{d.label}</span>,
                <span key="a">{d.balances.length}</span>,
              ],
            }))}
          />
        </Carte>
      </div>
    </>
  );
}
