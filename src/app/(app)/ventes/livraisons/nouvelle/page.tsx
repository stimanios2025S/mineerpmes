import Link from "next/link";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { actionCreerBonLivraison } from "@/actions/vente";
import { commandesARelivrer } from "@/lib/vente/service";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { construireLien, identifiantOuNull, premiereValeur } from "@/lib/liste";
import { lireParametreTexte, CLE_PARAMETRE } from "@/lib/settings";
import { Alerte, Carte, EnTetePage, ListeDefinitions, Tableau } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { DEVISE_PAR_DEFAUT, formatDate, formatMontant, formatQuantite, toInputDate } from "@/lib/format";
import { LIBELLES_STATUT_COMMANDE_CLIENT, libelle } from "@/lib/libelles";

export const metadata = { title: "Nouveau bon de livraison" };

/**
 * Creation d'un bon de livraison a partir d'une commande client.
 *
 * La page ne choisit jamais a la place de l'utilisateur : elle affiche le reste
 * reel a livrer, ligne par ligne, et le service revalide la commande, les lignes
 * et les quantites avant tout enregistrement.
 */
export default async function PageNouvelleLivraison({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.VENTE_LIVRER);

  const parametres = await searchParams;
  const commandeId = identifiantOuNull(premiereValeur(parametres, "commande"));

  const [commandes, depots, devise] = await Promise.all([
    commandesARelivrer(),
    prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 100,
      select: { id: true, code: true, label: true, type: true },
    }),
    lireParametreTexte(CLE_PARAMETRE.DEVISE, DEVISE_PAR_DEFAUT),
  ]);

  // La commande choisie est relue avec ses quantites reelles : le reste a
  // livrer n'est jamais devine, il vient des quantites deja livrees en base.
  const commande = commandeId
    ? await prisma.salesOrder.findUnique({
        where: { id: commandeId },
        include: {
          customer: { select: { id: true, code: true, label1: true } },
          lines: {
            orderBy: { lineNo: "asc" },
            include: { item: { select: { code: true, label1: true, unitCode: true } } },
          },
          deliveryNotes: {
            where: { status: { not: "ANNULEE" } },
            select: { number: true, status: true },
          },
        },
      })
    : null;

  const lignesLivrables = commande
    ? commande.lines
        .map((ligne) => ({
          id: ligne.id,
          lineNo: ligne.lineNo,
          itemId: ligne.itemId,
          itemCode: ligne.item.code,
          itemLabel: ligne.item.label1,
          unite: ligne.unitCode ?? ligne.item.unitCode ?? "",
          quantity: D.of(ligne.quantity),
          quantityDelivered: D.of(ligne.quantityDelivered),
          reste: D.sub(D.of(ligne.quantity), D.of(ligne.quantityDelivered)),
          price: D.of(ligne.unitPrice),
          description: ligne.description,
        }))
        .filter((ligne) => D.gt(ligne.reste, 0))
    : [];

  return (
    <>
      <EnTetePage
        titre="Nouveau bon de livraison"
        description="Le bon est cree au statut brouillon : la marchandise ne sort du stock qu'a l'expedition, lot par lot, et sous reserve de la liberation qualite lorsque celle-ci est obligatoire."
        actions={
          <Link className="lien-nav text-sm" href="/ventes/livraisons">
            Retour a la liste
          </Link>
        }
      />

      <div className="space-y-6">
        <Carte
          titre="Choix de la commande a livrer"
          description="Seules les commandes confirmees dont il reste des quantites a livrer sont proposees : le service refuse toute autre commande."
        >
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Commande client</span>
              <select className="champ" name="commande" defaultValue={commandeId ?? ""}>
                <option value="">— Selectionner —</option>
                {commandes.map((element) => (
                  <option key={element.id} value={element.id}>
                    {element.number} — {element.customer.label1} —{" "}
                    {libelle(LIBELLES_STATUT_COMMANDE_CLIENT, element.status)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
            >
              Charger la commande
            </button>
          </form>

          {commandes.length === 0 && (
            <div className="mt-4">
              <Alerte ton="alerte" titre="Aucune commande a livrer">
                Aucune commande confirmee n&apos;attend de livraison. Confirmez d&apos;abord une
                commande client depuis sa fiche.
              </Alerte>
            </div>
          )}

          {commandeId !== null && !commande && (
            <div className="mt-4">
              <Alerte ton="danger" titre="Commande introuvable">
                La commande demandee n&apos;existe pas. Selectionnez-en une autre dans la liste.
              </Alerte>
            </div>
          )}
        </Carte>

        {commande && (
          <Carte titre={`Commande ${commande.number}`}>
            <ListeDefinitions
              elements={[
                { terme: "Client", valeur: `${commande.customer.code} — ${commande.customer.label1}` },
                {
                  terme: "Statut",
                  valeur: libelle(LIBELLES_STATUT_COMMANDE_CLIENT, commande.status),
                },
                { terme: "Date de commande", valeur: formatDate(commande.orderDate) },
                { terme: "Livraison prevue", valeur: formatDate(commande.expectedDate) },
                { terme: "Total TTC", valeur: formatMontant(commande.totalTTC, commande.currency) },
                {
                  terme: "Livraisons deja enregistrees",
                  valeur:
                    commande.deliveryNotes.length > 0
                      ? commande.deliveryNotes.map((note) => note.number).join(", ")
                      : "Aucune",
                },
              ]}
            />
            <div className="mt-4">
              <Tableau
                colonnes={[
                  { cle: "ligne", libelle: "Ligne", nombre: true },
                  { cle: "article", libelle: "Article" },
                  { cle: "commandee", libelle: "Commandee", nombre: true },
                  { cle: "deja", libelle: "Deja livree", nombre: true },
                  { cle: "reste", libelle: "Reste a livrer", nombre: true },
                  { cle: "prix", libelle: "Prix unitaire", nombre: true },
                ]}
                lignes={commande.lines.map((ligne) => ({
                  cle: String(ligne.id),
                  cellules: [
                    String(ligne.lineNo),
                    `${ligne.item.code} — ${ligne.item.label1}`,
                    `${formatQuantite(ligne.quantity)} ${ligne.unitCode ?? ""}`.trim(),
                    formatQuantite(ligne.quantityDelivered),
                    formatQuantite(D.sub(D.of(ligne.quantity), D.of(ligne.quantityDelivered))),
                    formatMontant(ligne.unitPrice, commande.currency),
                  ],
                }))}
                messageVide="Cette commande ne comporte aucune ligne."
              />
            </div>
          </Carte>
        )}

        {commande && (
          <Carte
            titre="Bon de livraison"
            description={`Montants exprimes en ${devise}. Les quantites livrees mettent a jour l'avancement de la commande a l'expedition.`}
          >
            {lignesLivrables.length === 0 ? (
              <Alerte ton="info" titre="Aucune quantite restante">
                Toutes les lignes de cette commande sont deja integralement livrees. Aucun bon de
                livraison ne peut etre prepare.
              </Alerte>
            ) : (
              <FormulaireAction
                action={actionCreerBonLivraison}
                libelleSoumettre="Enregistrer le bon de livraison"
                varianteSoumettre="primaire"
              >
                <input type="hidden" name="nombreLignes" value={lignesLivrables.length} />
                <input type="hidden" name="commandeId" value={commande.id} />
                <input type="hidden" name="clientId" value={commande.customer.id} />

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Champ
                    nom="depotId"
                    libelle="Depot de depart"
                    type="select"
                    requis
                    options={depots.map((depot) => ({
                      valeur: depot.id,
                      libelle: `${depot.code} — ${depot.label}`,
                    }))}
                  />
                  <Champ
                    nom="dateLivraison"
                    libelle="Date de livraison"
                    type="date"
                    valeur={toInputDate(new Date())}
                  />
                  <Champ nom="transporteur" libelle="Transporteur" />
                  <Champ
                    nom="adresse"
                    libelle="Adresse de livraison"
                    valeur={commande.deliveryAddress ?? ""}
                  />
                  <Champ nom="referenceClient" libelle="Reference du client" />
                  <Champ nom="notes" libelle="Notes" type="textarea" maxLength={1000} />
                </div>

                <div className="mt-5 overflow-x-auto">
                  <table className="donnees">
                    <thead>
                      <tr>
                        <th>Ligne</th>
                        <th style={{ minWidth: "18rem" }}>Article</th>
                        <th className="nombre">Reste a livrer</th>
                        <th className="nombre">Quantite livree</th>
                        <th>Unite</th>
                        <th style={{ minWidth: "14rem" }}>Note de ligne</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignesLivrables.map((ligne, index) => (
                        <tr key={ligne.id}>
                          <td>{ligne.lineNo}</td>
                          <td>{`${ligne.itemCode} — ${ligne.itemLabel}`}</td>
                          <td className="nombre">{formatQuantite(ligne.reste)}</td>
                          <td className="nombre">
                            <input type="hidden" name={`ligne_${index}_orderLineId`} value={ligne.id} />
                            <input type="hidden" name={`ligne_${index}_itemId`} value={ligne.itemId} />
                            <input
                              type="hidden"
                              name={`ligne_${index}_prixUnitaire`}
                              value={ligne.price.toFixed(4)}
                            />
                            <input
                              type="hidden"
                              name={`ligne_${index}_unite`}
                              value={ligne.unite}
                            />
                            <input
                              className="champ"
                              type="number"
                              name={`ligne_${index}_quantite`}
                              step="0.001"
                              min="0"
                              max={ligne.reste.toFixed(6)}
                              inputMode="decimal"
                              defaultValue={ligne.reste.toFixed(6)}
                            />
                          </td>
                          <td>{ligne.unite || "Unite de l'article"}</td>
                          <td>
                            <input className="champ" type="text" name={`ligne_${index}_note`} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4">
                  <Alerte ton="info" titre="Regles appliquees par le service">
                    <p>
                      Une ligne laissee a zero n&apos;est pas livree. La quantite livree ne peut pas
                      deporter le total au-dela de la quantite commandee : le service refuse alors
                      la ligne avec le detail des quantites.
                    </p>
                    <p className="mt-1">
                      Si le stock du depot choisi est insuffisant, le bon est tout de meme
                      enregistre : l&apos;expedition sera refusee et la ligne apparaitra dans le
                      bandeau des livraisons en attente de stock.
                    </p>
                  </Alerte>
                </div>
              </FormulaireAction>
            )}
          </Carte>
        )}

        {!commande && (
          <Carte titre="Comment proceder">
            <Alerte ton="info" titre="Choisissez d'abord une commande client">
              Un bon de livraison reprend toujours les lignes d&apos;une commande client confirmee :
              la tracabilite entre la commande, la livraison et la facture reste ainsi etablie.
              {commandeId === null && (
                <>
                  {" "}
                  <Link className="lien-nav" href={construireLien("/ventes/commandes", {})}>
                    Consulter les commandes client
                  </Link>
                </>
              )}
            </Alerte>
          </Carte>
        )}
      </div>
    </>
  );
}
