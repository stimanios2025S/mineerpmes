import Link from "next/link";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { actionCreerBonReception } from "@/actions/achat";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { construireLien, identifiantOuNull, premiereValeur } from "@/lib/liste";
import { CLE_PARAMETRE, lireParametreBooleen } from "@/lib/settings";
import { Alerte, Carte, EnTetePage, ListeDefinitions, Section } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatDate, formatQuantite, toInputDate } from "@/lib/format";
import { LIBELLES_STATUT_COMMANDE_FOURNISSEUR, libelle } from "@/lib/libelles";

export const metadata = { title: "Nouvelle reception fournisseur" };

const STATUTS_RECEVABLES = ["APPROUVE", "PARTIELLEMENT_RECU", "RECU", "FACTURE"] as const;

export default async function PageNouvelleReception({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.ACHAT_RECEPTIONNER);

  const parametres = await searchParams;
  const commandeId = identifiantOuNull(premiereValeur(parametres, "commande"));
  const depotId = identifiantOuNull(premiereValeur(parametres, "depot"));

  const controleQualitatifObligatoire = await lireParametreBooleen(
    CLE_PARAMETRE.QUALITE_CONTROLE_RECEPTION_OBLIGATOIRE,
    true,
  );

  const [commandes, depots, commande, emplacements] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { status: { in: [...STATUTS_RECEVABLES] } },
      orderBy: { orderDate: "desc" },
      take: 100,
      select: {
        id: true,
        number: true,
        status: true,
        orderDate: true,
        expectedDate: true,
        supplier: { select: { code: true, label1: true } },
        lines: { select: { quantity: true, quantityReceived: true } },
      },
    }),
    prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 200,
      select: { id: true, code: true, label: true },
    }),
    commandeId
      ? prisma.purchaseOrder.findUnique({
          where: { id: commandeId },
          include: {
            supplier: { select: { id: true, code: true, label1: true } },
            lines: {
              orderBy: { lineNo: "asc" },
              include: {
                item: {
                  select: {
                    id: true,
                    code: true,
                    label1: true,
                    unitCode: true,
                    isBatchManaged: true,
                    isPerishable: true,
                  },
                },
              },
            },
          },
        })
      : Promise.resolve(null),
    depotId
      ? prisma.location.findMany({
          where: { warehouseId: depotId, isActive: true },
          orderBy: { code: "asc" },
          take: 200,
          select: { id: true, code: true, label: true },
        })
      : Promise.resolve([]),
  ]);

  const depot = depotId ? (depots.find((element) => element.id === depotId) ?? null) : null;

  // Lignes reellement receptionnables : une ligne deja soldee reste visible mais
  // ne propose plus de quantite par defaut.
  const lignesOuvertes = commande
    ? commande.lines.map((ligne) => ({
        ...ligne,
        reste: D.sub(D.of(ligne.quantity), D.of(ligne.quantityReceived)),
      }))
    : [];

  const nombreLignes = lignesOuvertes.length;

  return (
    <>
      <EnTetePage
        titre="Nouvelle reception fournisseur"
        description="Enregistrement d'une entree de marchandises rattachee a un bon de commande approuve. Les mouvements de stock sont generes par le service des achats."
        actions={
          <Link className="lien-nav text-sm" href="/achats/receptions">
            Retour a la liste
          </Link>
        }
      />

      <div className="space-y-6">
        <Carte
          titre="Preparer la reception"
          description="Selectionnez le bon de commande et le depot de destination : les emplacements proposes sur les lignes dependent du depot choisi."
        >
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Bon de commande</span>
              <select className="champ" name="commande" defaultValue={commandeId ?? ""}>
                <option value="">— Selectionner —</option>
                {commandes.map((element) => (
                  <option key={element.id} value={element.id}>
                    {element.number} — {element.supplier.label1} —{" "}
                    {libelle(LIBELLES_STATUT_COMMANDE_FOURNISSEUR, element.status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Depot de destination</span>
              <select className="champ" name="depot" defaultValue={depotId ?? ""}>
                <option value="">— Selectionner —</option>
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
              Charger les lignes
            </button>
            <Link className="lien-nav text-sm" href="/achats/receptions/nouvelle">
              Reinitialiser
            </Link>
          </form>

          <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
            {commandes.length} bon(s) de commande recevables (approuve, partiellement recu, recu ou
            facture). Les commandes en brouillon et annulees sont refusees par le service.
          </p>
        </Carte>

        {!commande && (
          <Alerte ton="info" titre="Choix du bon de commande">
            Selectionnez un bon de commande pour afficher ses lignes et saisir les quantites recues.
          </Alerte>
        )}

        {commande && commandeId !== null && (
          <Carte
            titre={`Bon de commande ${commande.number}`}
            description="Quantites commandees et deja recues : seules les quantites reellement livrees doivent etre saisies."
          >
            <ListeDefinitions
              elements={[
                {
                  terme: "Fournisseur",
                  valeur: `${commande.supplier.code} — ${commande.supplier.label1}`,
                },
                {
                  terme: "Statut",
                  valeur: libelle(LIBELLES_STATUT_COMMANDE_FOURNISSEUR, commande.status),
                },
                { terme: "Date de commande", valeur: formatDate(commande.orderDate) },
                { terme: "Livraison prevue", valeur: formatDate(commande.expectedDate) },
                { terme: "Depot retenu", valeur: depot ? `${depot.code} — ${depot.label}` : "A choisir" },
                {
                  terme: "Controle qualitatif",
                  valeur: controleQualitatifObligatoire
                    ? "Obligatoire (parametre d'application) : la marchandise entrera en quarantaine"
                    : "Facultatif : cochez la demande de controle si elle est necessaire",
                },
              ]}
            />
          </Carte>
        )}

        {commande && depotId !== null && depot === null && (
          <Alerte ton="alerte" titre="Depot inconnu">
            Le depot selectionne n&apos;existe pas ou n&apos;est plus actif. Choisissez un depot
            valide pour preparer la reception.
          </Alerte>
        )}

        {commande && depot && (
          <Carte
            titre="Lignes receptionnees"
            description="Une ligne laissee a zero, ou vide, n'est pas receptionnee. Les quantites ne peuvent pas depasser le reste a recevoir."
          >
            <FormulaireAction
              action={actionCreerBonReception}
              libelleSoumettre="Enregistrer la reception"
              varianteSoumettre="primaire"
            >
              <input type="hidden" name="fournisseurId" value={commande.supplier.id} />
              <input type="hidden" name="commandeId" value={commande.id} />
              <input type="hidden" name="depotId" value={depot.id} />
              <input type="hidden" name="nombreLignes" value={nombreLignes} />

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Champ
                  nom="dateReception"
                  libelle="Date de reception"
                  type="date"
                  valeur={toInputDate(new Date())}
                />
                <Champ
                  nom="numeroBonLivraison"
                  libelle="Numero de bon de livraison fournisseur"
                  aide="Reference portee sur le document remis par le transporteur."
                />
                <Champ nom="notes" libelle="Observations" type="textarea" maxLength={1000} />
              </div>

              <div className="mt-4">
                {controleQualitatifObligatoire ? (
                  <Alerte ton="alerte" titre="Controle qualitatif requis">
                    Le controle qualitatif est obligatoire a la reception (parametre
                    d&apos;application actif). Les quantites recues entreront en quarantaine et ne
                    seront pas disponibles avant la decision de la qualite.
                  </Alerte>
                ) : (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="controleQualitatif" />
                    <span>
                      Soumettre cette reception au controle qualitatif (mise en quarantaine de la
                      marchandise recue)
                    </span>
                  </label>
                )}
              </div>

              <Section titre="Quantites recues par ligne">
                <div className="overflow-x-auto">
                  <table className="donnees">
                    <thead>
                      <tr>
                        <th>Article</th>
                        <th className="nombre">Commandee</th>
                        <th className="nombre">Deja recue</th>
                        <th className="nombre">Reste a recevoir</th>
                        <th className="nombre">Quantite recue</th>
                        <th style={{ minWidth: "10rem" }}>Numero de lot</th>
                        <th style={{ minWidth: "10rem" }}>Emplacement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignesOuvertes.map((ligne, index) => (
                        <tr key={ligne.id}>
                          <td>
                            <input type="hidden" name={`ligne_${index}_orderLineId`} value={ligne.id} />
                            <input type="hidden" name={`ligne_${index}_itemId`} value={ligne.item.id} />
                            <input
                              type="hidden"
                              name={`ligne_${index}_unite`}
                              value={ligne.unitCode ?? ligne.item.unitCode ?? ""}
                            />
                            {ligne.item.code} — {ligne.item.label1}
                            {ligne.item.isBatchManaged && (
                              <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                                Article gere par lot : le numero de lot est obligatoire.
                              </span>
                            )}
                          </td>
                          <td className="nombre">
                            {formatQuantite(ligne.quantity)} {ligne.unitCode ?? ""}
                          </td>
                          <td className="nombre">
                            {formatQuantite(ligne.quantityReceived)} {ligne.unitCode ?? ""}
                          </td>
                          <td className="nombre">
                            {formatQuantite(ligne.reste)} {ligne.unitCode ?? ""}
                          </td>
                          <td className="nombre">
                            <input
                              className="champ"
                              type="number"
                              name={`ligne_${index}_quantite`}
                              step="0.001"
                              min="0"
                              inputMode="decimal"
                              defaultValue={D.gt(ligne.reste, 0) ? D.toFixed(ligne.reste, 3) : ""}
                            />
                          </td>
                          <td>
                            <input
                              className="champ"
                              type="text"
                              name={`ligne_${index}_lot`}
                              maxLength={60}
                            />
                          </td>
                          <td>
                            <select
                              className="champ"
                              name={`ligne_${index}_emplacement`}
                              defaultValue=""
                            >
                              <option value="">Sans emplacement precis</option>
                              {emplacements.map((emplacement) => (
                                <option key={emplacement.id} value={emplacement.id}>
                                  {emplacement.code} — {emplacement.label}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            </FormulaireAction>
          </Carte>
        )}

        {commande && !depot && (
          <Alerte ton="info" titre="Depot de destination requis">
            Choisissez le depot de destination dans le formulaire ci-dessus : la marchandise y sera
            enregistree, et les emplacements disponibles en dependent.
          </Alerte>
        )}
      </div>
    </>
  );
}
