import Link from "next/link";
import { prisma } from "@/lib/db";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { Carte, EnTetePage, Etiquette, Statistique, Tableau, Vide } from "@/components/ui";
import { formatQuantite } from "@/lib/format";
import { listerSousStocks } from "@/lib/mes/sous-stocks";

export const metadata = { title: "Mes sous-stocks" };

/**
 * Sous-stocks des postes de l'ouvrier.
 *
 * Un sous-stock est l'emplacement d'atelier ou la production d'une etape se
 * depose. L'ouvrier y voit ce qui est disponible pour sa machine, sans avoir a
 * demander au magasin.
 */
export default async function PageSousStocksPortail() {
  const utilisateur = await exigerPermission(PERMISSIONS.PORTAIL_EMPLOYE);

  if (!utilisateur.employeeId) {
    return (
      <>
        <EnTetePage titre="Mes sous-stocks" />
        <Vide message="Votre compte n'est rattache a aucune fiche employe. Demandez a l'administration de faire le lien." />
      </>
    );
  }

  const employe = await prisma.employee.findUnique({
    where: { id: utilisateur.employeeId },
    select: { workshopId: true, workshop: { select: { code: true, label: true } } },
  });

  const sousStocks = employe?.workshopId
    ? await listerSousStocks(prisma, { workshopId: employe.workshopId })
    : [];

  const emplacements = sousStocks.map((sousStock) => sousStock.locationId);

  const soldes = emplacements.length
    ? await prisma.stockBalance.groupBy({
        by: ["locationId"],
        where: { locationId: { in: emplacements } },
        _sum: { quantityPhysical: true },
        _count: { _all: true },
      })
    : [];

  const parEmplacement = new Map(
    soldes.map((ligne) => [
      ligne.locationId,
      { quantite: ligne._sum.quantityPhysical ?? 0, articles: ligne._count._all },
    ]),
  );

  const totalArticles = soldes.reduce((total, ligne) => total + ligne._count._all, 0);

  return (
    <>
      <EnTetePage
        titre="Mes sous-stocks"
        description={
          employe?.workshop
            ? `Emplacements d'atelier de ${employe.workshop.label}. Ce qui s'y trouve est disponible pour vos operations.`
            : "Emplacements d'atelier disponibles pour vos operations."
        }
        actions={
          <Link className="bouton secondaire" href="/portail">
            Retour au portail
          </Link>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Statistique libelle="Sous-stocks" valeur={sousStocks.length} ton="primaire" />
        <Statistique libelle="References en stock" valeur={totalArticles} ton="info" />
        <Statistique
          libelle="Atelier"
          valeur={employe?.workshop?.code ?? "-"}
          detail={employe?.workshop?.label ?? "Aucun atelier rattache"}
        />
      </div>

      <Carte
        titre="Sous-stocks de mon atelier"
        description="Quantite physique presente et nombre de references, par emplacement."
        sansPadding
      >
        {sousStocks.length === 0 ? (
          <div className="p-4">
            <Vide message="Aucun sous-stock n'est defini pour votre atelier." />
          </div>
        ) : (
          <Tableau
            messageVide=""
            cleLigne={(index) => String(sousStocks[index].id)}
            colonnes={[
              { cle: "code", libelle: "Code" },
              { cle: "libelle", libelle: "Sous-stock" },
              { cle: "operation", libelle: "Operation" },
              { cle: "emplacement", libelle: "Emplacement" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "articles", libelle: "References", nombre: true },
              { cle: "etat", libelle: "Etat" },
            ]}
            lignes={sousStocks.map((sousStock) => {
              const solde = parEmplacement.get(sousStock.locationId);
              return {
                cle: String(sousStock.id),
                cellules: [
                  <span key="c" className="font-mono">
                    {sousStock.code}
                  </span>,
                  sousStock.label,
                  `${sousStock.operation.code} — ${sousStock.operation.label}`,
                  `${sousStock.warehouse.code} / ${sousStock.location.code}`,
                  formatQuantite(solde?.quantite ?? 0),
                  solde?.articles ?? 0,
                  <Etiquette key="e" ton={sousStock.isActive ? "succes" : "neutre"}>
                    {sousStock.isActive ? "Actif" : "Inactif"}
                  </Etiquette>,
                ],
              };
            })}
          />
        )}
      </Carte>
    </>
  );
}
