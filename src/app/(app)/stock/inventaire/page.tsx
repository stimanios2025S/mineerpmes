import { prisma } from "@/lib/db";
import { exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fabricantLien,
  identifiantOuNull,
  lireParametresListe,
  pagination,
  premiereValeur,
} from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  Pagination,
  Statistique,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatEntier, formatQuantite } from "@/lib/format";
import { LIBELLES_USINE, libelle } from "@/lib/libelles";
import { actionEnregistrerInventaire } from "@/actions/stock";

export const metadata = { title: "Inventaire physique" };

/**
 * Inventaire physique.
 *
 * Le depot est choisi explicitement : la quantite theorique d'un article depend
 * du depot, de l'emplacement, du lot et du statut. Chaque ligne presentee est
 * un solde reel au statut LIBRE, c'est-a-dire exactement la ligne que le
 * service `enregistrerInventaire` va verrouiller au moment de l'enregistrement.
 *
 * L'ecart (compte moins theorique) est calcule par le serveur : il ne peut donc
 * pas etre affiche avant l'enregistrement. Il est restitue dans le message de
 * confirmation, et le motif ecrit devient obligatoire des qu'un ecart existe.
 */
export default async function PageInventaire({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.STOCK_INVENTAIRE);
  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["depot"]);

  const portee = usinesAutorisees(utilisateur);
  const depotId = identifiantOuNull(parametres.filtres.depot);

  const depots = await prisma.warehouse.findMany({
    where: { isActive: true, factory: { in: portee } },
    orderBy: [{ factory: "asc" }, { code: "asc" }],
    take: 500,
    select: { id: true, code: true, label: true, factory: true },
  });

  const depot = depotId ? depots.find((element) => element.id === depotId) ?? null : null;
  const depotHorsPortee = depotId !== null && depot === null;

  const where = depot
    ? { warehouseId: depot.id, status: "LIBRE" as const }
    : null;

  const total = where ? await prisma.stockBalance.count({ where }) : 0;
  const bornes = pagination(total, parametres.page, parametres.taille);

  const lignes = where
    ? await prisma.stockBalance.findMany({
        where,
        orderBy: [{ item: { code: "asc" } }, { locationId: "asc" }, { lotId: "asc" }],
        skip: bornes.skip,
        take: bornes.take,
        include: {
          item: { select: { code: true, label1: true, unitCode: true } },
          location: { select: { code: true } },
          lot: { select: { lotNumber: true } },
        },
      })
    : [];

  const filtresCourants = {
    depot: premiereValeur(parametresBruts, "depot"),
    taille: parametres.taille,
  };

  return (
    <>
      <EnTetePage
        titre="Inventaire physique"
        description="Comptage contradictoire du stock : la quantite comptee est confrontee au solde theorique. L'ecart est calcule par le serveur au moment de l'enregistrement ; des qu'il est non nul, un motif ecrit d'au moins 10 caracteres est exige et un mouvement d'inventaire est cree."
      />

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Choix du depot a inventorier"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Depot a inventorier</span>
          <select className="champ" name="depot" defaultValue={filtresCourants.depot ?? ""}>
            <option value="">— Selectionner un depot —</option>
            {depots.map((element) => (
              <option key={element.id} value={element.id}>
                {element.code} — {element.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
        >
          Afficher les articles
        </button>
      </form>

      {depotHorsPortee && (
        <div className="mb-4">
          <Alerte ton="danger" titre="Depot hors de votre portee">
            Le depot demande ne fait pas partie des divisions auxquelles votre profil
            donne acces : aucun comptage ne peut y etre saisi.
          </Alerte>
        </div>
      )}

      {!depot ? (
        <Alerte ton="info" titre="Depot non selectionne">
          Choisissez le depot a inventorier : la quantite theorique est celle du stock
          reel de ce depot, sans elle aucun ecart ne peut etre etabli.
        </Alerte>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Statistique
              libelle="Lignes a compter"
              valeur={formatEntier(total)}
              detail="Soldes au statut libre dans ce depot."
            />
            <Statistique
              libelle="Depot"
              valeur={depot.code}
              detail={`${depot.label} — ${libelle(LIBELLES_USINE, depot.factory)}`}
            />
            <Statistique
              libelle="Regle d'ecart"
              valeur="Motif ecrit"
              detail="Un ecart non nul exige un motif d'au moins 10 caracteres, verifie par le serveur."
              ton="alerte"
            />
          </div>

          <Carte
            titre="Feuille de comptage"
            description="Chaque ligne est un solde reel du depot. La quantite theorique est figee a l'affichage ; toute variation concurrente interrompt l'enregistrement et demande un nouveau comptage."
            sansPadding
          >
            <Tableau
              colonnes={[
                { cle: "article", libelle: "Article" },
                { cle: "emplacement", libelle: "Emplacement" },
                { cle: "lot", libelle: "Lot" },
                { cle: "unite", libelle: "Unite" },
                { cle: "theorique", libelle: "Quantite theorique", nombre: true },
                { cle: "comptage", libelle: "Comptage", largeur: "26rem" },
              ]}
              lignes={lignes.map((ligne) => ({
                cle: String(ligne.id),
                cellules: [
                  <span key="article">
                    <span className="font-medium">{ligne.item.code}</span>
                    <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                      {ligne.item.label1}
                    </span>
                  </span>,
                  ligne.location?.code ?? "Sans emplacement",
                  ligne.lot?.lotNumber ?? "Sans lot",
                  ligne.item.unitCode ?? "non definie",
                  formatQuantite(ligne.quantityPhysical),
                  <FormulaireAction
                    key="comptage"
                    action={actionEnregistrerInventaire}
                    libelleSoumettre="Enregistrer le comptage"
                    varianteSoumettre="primaire"
                    reinitialiser
                  >
                    <input type="hidden" name="itemId" value={ligne.itemId} />
                    <input type="hidden" name="warehouseId" value={ligne.warehouseId} />
                    <input
                      type="hidden"
                      name="locationId"
                      value={ligne.locationId ?? ""}
                    />
                    <input type="hidden" name="lotId" value={ligne.lotId ?? ""} />
                    <Champ
                      nom="quantityComptee"
                      libelle="Quantite comptee"
                      type="number"
                      pas="any"
                      min="0"
                      requis
                      aide={`Theorique : ${formatQuantite(ligne.quantityPhysical)}`}
                    />
                    <div className="mt-2">
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium">
                          Motif de l&apos;ecart
                        </span>
                        <textarea
                          className="champ"
                          name="motif"
                          rows={2}
                          minLength={10}
                          placeholder="Obligatoire si la quantite comptee differe de la theorique"
                        />
                      </label>
                    </div>
                    <div className="mt-2">
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium">
                          Observation (facultative)
                        </span>
                        <textarea
                          className="champ"
                          name="commentaire"
                          rows={2}
                          placeholder="Precision sur le comptage"
                        />
                      </label>
                    </div>
                  </FormulaireAction>,
                ],
              }))}
              messageVide="Aucun solde au statut libre dans ce depot : seules les lignes au statut libre peuvent etre inventoriees depuis cet ecran."
            />
            <Pagination
              page={parametres.page}
              pages={bornes.pages}
              total={total}
              construireLien={fabricantLien("/stock/inventaire", filtresCourants)}
            />
          </Carte>
        </>
      )}
    </>
  );
}
