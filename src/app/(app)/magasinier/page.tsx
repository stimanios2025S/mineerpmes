import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { EnTetePage, Carte, Etiquette, Tableau, Vide } from "@/components/ui";
import { formatDate, formatQuantite } from "@/lib/format";
import Link from "next/link";

export const metadata = { title: "Magasinier Central" };

export default async function PageMagasinier() {
  const utilisateur = await exigerPermission(PERMISSIONS.STOCK_LIRE);

  const usines = usinesAutorisees(utilisateur).filter((usine) => usine !== "COMMUN");
  if (usines.length === 1) redirect(`/magasinier/${usines[0].toLowerCase()}`);

  // Tous les OF autorises par le perimetre du compte
  const ordres = await prisma.workOrder.findMany({
    where: { factory: { in: usinesAutorisees(utilisateur) }, status: { in: ["LANCE", "EN_COURS"] } },
    include: {
      item: { select: { code: true, label1: true } },
      materials: {
        where: { isLabor: false },
        select: { quantityPlanned: true, quantityIssued: true },
      },
    },
    orderBy: [{ factory: "asc" }, { createdAt: "desc" }],
  });

  const ordresAvecStatut = ordres.map(of => {
    const totalLignes = of.materials.length;
    const lignesLivrees = of.materials.filter(m => m.quantityIssued >= m.quantityPlanned).length;
    const enAttente = totalLignes - lignesLivrees;
    return { ...of, totalLignes, lignesLivrees, enAttente };
  });

  const admedco = ordresAvecStatut.filter(o => o.factory === "ADMEDCO");
  const mobilix = ordresAvecStatut.filter(o => o.factory === "MOBILIX");

  function renderTable(data: typeof ordresAvecStatut) {
    if (data.length === 0) {
      return <Vide message="Aucun ordre en cours pour cette usine." />;
    }
    return (
      <Tableau
        messageVide=""
        cleLigne={(i) => String(data[i].id)}
        colonnes={[
          { cle: "of", libelle: "OF" },
          { cle: "article", libelle: "Article" },
          { cle: "quantite", libelle: "Qte", nombre: true },
          { cle: "lignes", libelle: "Lignes MP" },
          { cle: "etat", libelle: "Etat" },
          { cle: "actions", libelle: "Actions" },
        ]}
        lignes={data.map(of => ({
          cle: String(of.id),
          cellules: [
            <span key="of"><Link href={"/stock/bci/" + of.id} className="lien-nav font-mono">{of.number}</Link></span>,
            <span key="art">{of.item.code}</span>,
            <span key="qte">{formatQuantite(of.quantityPlanned)}</span>,
            <span key="lignes">{of.lignesLivrees}/{of.totalLignes}</span>,
            of.enAttente === 0 ? (
              <Etiquette key="etat" ton="succes">Tout livre</Etiquette>
            ) : (
              <Etiquette key="etat" ton="alerte">{of.enAttente} en attente</Etiquette>
            ),
            <Link key="bci" href={"/stock/bci/" + of.id} className="bouton secondaire text-xs" style={{minHeight:36}}>
              BCI
            </Link>,
          ],
        }))}
      />
    );
  }

  return (
    <>
      <EnTetePage
        titre="Magasinier Central"
        description="Bons de commande internes — les deux usines ADMEDCO et MOBILIX."
      />

      <div className="grid gap-4 sm:grid-cols-4 mb-5">
        <Carte titre="Total BCI">
          <p className="text-3xl font-bold">{ordres.length}</p>
        </Carte>
        <Carte titre="ADMEDCO">
          <p className="text-3xl font-bold">{admedco.length}</p>
        </Carte>
        <Carte titre="MOBILIX">
          <p className="text-3xl font-bold">{mobilix.length}</p>
        </Carte>
        <Carte titre="En attente">
          <p className="text-3xl font-bold" style={{color:"var(--alerte)"}}>
            {ordresAvecStatut.filter(o => o.enAttente > 0).length}
          </p>
        </Carte>
      </div>

      <Carte titre="ADMEDCO — Bons de commande internes">
        {renderTable(admedco)}
      </Carte>

      <div className="mt-4">
        <Carte titre="MOBILIX — Bons de commande internes">
          {renderTable(mobilix)}
        </Carte>
      </div>
    </>
  );
}
