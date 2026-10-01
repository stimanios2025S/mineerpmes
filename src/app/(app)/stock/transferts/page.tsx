import type { Factory } from "@prisma/client";
import { prisma } from "@/lib/db";
import { listerMouvements } from "@/lib/stock/service";
import { exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fabricantLien,
  lireParametresListe,
  premiereValeur,
} from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  Pagination,
  Section,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatDateTime, formatQuantite } from "@/lib/format";
import { actionTransfererStock } from "@/actions/stock";

export const metadata = { title: "Transferts inter-ateliers" };

/**
 * Transferts inter-ateliers.
 *
 * Un transfert genere deux ecritures indissociables : une sortie du depot
 * source et une entree dans le depot de destination, rattachees au meme
 * document (`documentType` / `documentNumber`). L'historique conserve les deux
 * lignes, car ce sont les ecritures reelles du grand livre.
 *
 * Le cas industriel structurant est le chassis peint : produit par ADMEDCO, il
 * est transmis a MOBILIX pour l'habillage. Ces transferts sont mis en evidence
 * afin qu'ils restent identifiables au milieu des autres deplacements.
 */
export default async function PageTransfertsStock({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.STOCK_TRANSFERT);
  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["q"]);

  const portee: Factory[] = usinesAutorisees(utilisateur);

  const [historique, depots, articles, emplacements, lots] = await Promise.all([
    listerMouvements({
      type: "TRANSFERT_INTER_DEPOTS",
      recherche: parametres.recherche ?? undefined,
      page: parametres.page,
      taille: parametres.taille,
    }),
    prisma.warehouse.findMany({
      where: { isActive: true, factory: { in: portee } },
      orderBy: [{ factory: "asc" }, { code: "asc" }],
      take: 500,
      select: { id: true, code: true, label: true },
    }),
    prisma.item.findMany({
      where: { status: "ACTIF" },
      orderBy: { code: "asc" },
      take: 500,
      select: { id: true, code: true, label1: true, unitCode: true },
    }),
    prisma.location.findMany({
      where: { isActive: true, warehouse: { factory: { in: portee } } },
      orderBy: [{ warehouseId: "asc" }, { code: "asc" }],
      take: 500,
      select: { id: true, code: true, warehouse: { select: { code: true } } },
    }),
    prisma.stockLot.findMany({
      where: { warehouse: { factory: { in: portee } } },
      orderBy: { id: "desc" },
      take: 500,
      select: {
        id: true,
        lotNumber: true,
        item: { select: { code: true } },
        warehouse: { select: { code: true } },
      },
    }),
  ]);

  // Divisions des depots cites par l'historique : elles ne figurent pas dans
  // les lignes du grand livre, qui ne portent que les identifiants de depot.
  const identifiantsDepots = new Set<number>();
  for (const ligne of historique.lignes) {
    if (ligne.sourceWarehouseId !== null) identifiantsDepots.add(ligne.sourceWarehouseId);
    if (ligne.targetWarehouseId !== null) identifiantsDepots.add(ligne.targetWarehouseId);
  }
  const depotsCites = identifiantsDepots.size
    ? await prisma.warehouse.findMany({
        where: { id: { in: [...identifiantsDepots] } },
        select: { id: true, code: true, label: true, factory: true },
      })
    : [];
  const parIdentifiant = new Map(depotsCites.map((depot) => [depot.id, depot]));

  const optionsArticles = articles.map((article) => ({
    valeur: article.id,
    libelle: `${article.code} — ${article.label1}${article.unitCode ? ` (${article.unitCode})` : ""}`,
  }));
  const optionsDepots = depots.map((depot) => ({
    valeur: depot.id,
    libelle: `${depot.code} — ${depot.label}`,
  }));
  const optionsEmplacements = emplacements.map((emplacement) => ({
    valeur: emplacement.id,
    libelle: `${emplacement.warehouse.code} / ${emplacement.code}`,
  }));
  const optionsLots = lots.map((lot) => ({
    valeur: lot.id,
    libelle: `${lot.lotNumber} — ${lot.item.code} (${lot.warehouse.code})`,
  }));

  return (
    <>
      <EnTetePage
        titre="Transferts inter-ateliers"
        description="Deplacement de stock d'un depot a un autre. Le transfert produit une sortie et une entree numerotees sous un meme document, dans une seule transaction : soit les deux ecritures existent, soit aucune."
      />

      <Carte
        titre="Nouveau transfert"
        description="La quantite transferee doit etre strictement positive et disponible dans le depot source. Un motif ecrit est obligatoire."
      >
        <FormulaireAction
          action={actionTransfererStock}
          libelleSoumettre="Enregistrer le transfert"
          reinitialiser
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Champ nom="itemId" libelle="Article" type="select" requis options={optionsArticles} />
            <Champ
              nom="sourceWarehouseId"
              libelle="Depot source"
              type="select"
              requis
              options={optionsDepots}
            />
            <Champ
              nom="targetWarehouseId"
              libelle="Depot de destination"
              type="select"
              requis
              options={optionsDepots}
              aide="Obligatoirement different du depot source."
            />
            <Champ
              nom="sourceLocationId"
              libelle="Emplacement source"
              type="select"
              options={optionsEmplacements}
              aide="Facultatif : laisser vide pour un stock sans emplacement."
            />
            <Champ
              nom="targetLocationId"
              libelle="Emplacement de destination"
              type="select"
              options={optionsEmplacements}
              aide="Facultatif : laisser vide pour un stock sans emplacement."
            />
            <Champ
              nom="lotId"
              libelle="Lot"
              type="select"
              options={optionsLots}
              aide="Facultatif : le lot doit appartenir au depot source."
            />
            <Champ
              nom="quantity"
              libelle="Quantite transferee"
              type="number"
              pas="any"
              min="0"
              requis
            />
          </div>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-medium">
              Motif du transfert<span style={{ color: "var(--danger)" }}> *</span>
            </span>
            <textarea
              className="champ"
              name="motif"
              rows={3}
              required
              minLength={10}
              placeholder="Motif obligatoire (au moins 10 caracteres)"
            />
          </label>
        </FormulaireAction>
      </Carte>

      <Section titre="Historique des transferts">
        <form
          method="get"
          className="mb-4 flex flex-wrap items-end gap-3"
          aria-label="Filtres de l'historique des transferts"
        >
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Recherche</span>
            <input
              className="champ"
              type="search"
              name="q"
              defaultValue={parametres.recherche ?? ""}
              placeholder="Numero de transfert, article"
            />
          </label>
          <button
            type="submit"
            className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
          >
            Filtrer
          </button>
        </form>

        <Carte
          titre="Mouvements TRANSFERT_INTER_DEPOTS"
          description={`${historique.total} ecriture(s) de transfert. Chaque transfert apparait en deux lignes : la sortie du depot source (quantite negative) et l'entree dans le depot de destination.`}
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "date", libelle: "Date" },
              { cle: "document", libelle: "Document d'origine" },
              { cle: "article", libelle: "Article" },
              { cle: "trajet", libelle: "Depot source vers depot de destination" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "ordre", libelle: "Ordre de fabrication" },
              { cle: "auteur", libelle: "Auteur" },
            ]}
            lignes={historique.lignes.map((mouvement) => {
              const source =
                mouvement.sourceWarehouseId !== null
                  ? parIdentifiant.get(mouvement.sourceWarehouseId) ?? null
                  : null;
              const destination =
                mouvement.targetWarehouseId !== null
                  ? parIdentifiant.get(mouvement.targetWarehouseId) ?? null
                  : null;

              // Transfert structurant : chassis peint produit par ADMEDCO et
              // transmis a MOBILIX pour l'habillage.
              const versMobilix =
                source?.factory === "ADMEDCO" && destination?.factory === "MOBILIX";

              return {
                cle: String(mouvement.id),
                cellules: [
                  formatDateTime(mouvement.occurredAt),
                  <span key="document">
                    <span className="font-medium">{mouvement.documentNumber ?? "-"}</span>
                    <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                      {mouvement.documentType ?? "sans document"} — ecriture{" "}
                      {mouvement.number}
                    </span>
                  </span>,
                  <span key="article">
                    <span className="font-medium">{mouvement.item.code}</span>
                    <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                      {mouvement.item.label1}
                      {mouvement.lot ? ` — lot ${mouvement.lot.lotNumber}` : ""}
                    </span>
                  </span>,
                  <span key="trajet">
                    {source?.code ?? "-"} <span aria-hidden="true">&#8594;</span>{" "}
                    {destination?.code ?? "-"}
                    <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                      {mouvement.quantity.isNegative()
                        ? `sortie du depot ${source?.code ?? "-"}`
                        : `entree dans le depot ${destination?.code ?? "-"}`}
                    </span>
                    {versMobilix && (
                      <span className="mt-1 block">
                        <Etiquette ton="primaire">
                          ADMEDCO vers MOBILIX — chassis peint transmis a MOBILIX
                        </Etiquette>
                      </span>
                    )}
                  </span>,
                  <span
                    key="quantite"
                    style={{
                      color: mouvement.quantity.isNegative()
                        ? "var(--danger)"
                        : "var(--succes)",
                    }}
                  >
                    {mouvement.quantity.isNegative() ? "-" : "+"}{" "}
                    {formatQuantite(mouvement.quantity.abs())}
                  </span>,
                  mouvement.workOrder?.number ?? "-",
                  <span key="auteur">
                    {mouvement.userEmail ?? "-"}
                    {mouvement.reason && (
                      <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                        {mouvement.reason}
                      </span>
                    )}
                  </span>,
                ],
              };
            })}
            messageVide="Aucun transfert inter-ateliers ne correspond aux criteres."
          />
          <Pagination
            page={historique.page}
            pages={historique.pages}
            total={historique.total}
            construireLien={fabricantLien("/stock/transferts", {
              q: premiereValeur(parametresBruts, "q"),
              taille: parametres.taille,
            })}
          />
        </Carte>

        <div className="mt-4">
          <Alerte ton="info" titre="Lecture de l'historique">
            Les transferts generes automatiquement par la fin d&apos;operation de
            poudrage portent un document de type TRANSFERT_DIVISION et l&apos;ordre de
            fabrication d&apos;origine : ce sont les chassis peints transmis d&apos;ADMEDCO
            a MOBILIX. Ceux saisis depuis cet ecran portent un numero de transfert
            propre.
          </Alerte>
        </div>
      </Section>
    </>
  );
}
