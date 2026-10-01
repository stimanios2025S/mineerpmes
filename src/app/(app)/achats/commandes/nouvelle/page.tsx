import Link from "next/link";
import { prisma } from "@/lib/db";
import { actionCreerCommandeFournisseur } from "@/actions/achat";
import { comparerPrixFournisseurs } from "@/lib/achat/service";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { construireLien, identifiantOuNull, premiereValeur } from "@/lib/liste";
import { lireParametreTexte, CLE_PARAMETRE } from "@/lib/settings";
import { Alerte, Carte, EnTetePage, ListeDefinitions, Section, Tableau } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import {
  DEVISE_PAR_DEFAUT,
  formatDate,
  formatMontant,
  formatPourcentage,
  formatQuantite,
  toInputDate,
} from "@/lib/format";
import { LIBELLES_STATUT_DEMANDE_ACHAT, libelle } from "@/lib/libelles";

export const metadata = { title: "Nouveau bon de commande" };

const NOMBRE_LIGNES_DEFAUT = 5;
const NOMBRE_LIGNES_MAX = 30;

/** Convertit une valeur d'URL en entier borne, sans jamais faire echouer la page. */
function entierDeFiltre(valeur: string | null, defaut: number, minimum: number, maximum: number) {
  if (valeur === null) return defaut;
  const nombre = Number.parseInt(valeur, 10);
  if (!Number.isFinite(nombre)) return defaut;
  return Math.min(Math.max(nombre, minimum), maximum);
}

export default async function PageNouvelleCommandeFournisseur({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.ACHAT_COMMANDE_CREER);

  const parametres = await searchParams;
  const recherche = premiereValeur(parametres, "q");
  const articleId = identifiantOuNull(premiereValeur(parametres, "article"));
  const demandeId = identifiantOuNull(premiereValeur(parametres, "demande"));
  const nombreLignes = entierDeFiltre(
    premiereValeur(parametres, "lignes"),
    NOMBRE_LIGNES_DEFAUT,
    1,
    NOMBRE_LIGNES_MAX,
  );

  const [fournisseurs, articles, tauxTva, unites, deviseParametre] = await Promise.all([
    prisma.thirdParty.findMany({
      where: { isSupplier: true, isActive: true },
      orderBy: { code: "asc" },
      take: 500,
      select: { id: true, code: true, label1: true, deadlineDays: true, paymentMethod: true },
    }),
    prisma.item.findMany({
      where: {
        status: "ACTIF",
        isPurchasable: true,
        ...(recherche
          ? {
              OR: [
                { code: { contains: recherche, mode: "insensitive" as const } },
                { label1: { contains: recherche, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { code: "asc" },
      take: 300,
      select: { id: true, code: true, label1: true, unitCode: true, taxRateCode: true },
    }),
    prisma.taxRate.findMany({
      where: { isActive: true },
      orderBy: { rate: "asc" },
      select: { code: true, label: true, rate: true },
    }),
    prisma.unitOfMeasure.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 200,
      select: { code: true, label: true },
    }),
    lireParametreTexte(CLE_PARAMETRE.DEVISE, DEVISE_PAR_DEFAUT),
  ]);

  // Demande d'achat a convertir : seules les demandes approuvees sont proposees,
  // le service refusant de son cote toute autre situation.
  const demande = demandeId
    ? await prisma.purchaseRequest.findUnique({
        where: { id: demandeId },
        include: {
          supplier: { select: { id: true, code: true, label1: true } },
          lines: {
            orderBy: { lineNo: "asc" },
            include: { item: { select: { code: true, label1: true, unitCode: true } } },
          },
        },
      })
    : null;

  const demandesConvertibles = await prisma.purchaseRequest.findMany({
    where: { status: "APPROUVEE" },
    orderBy: { requestedAt: "desc" },
    take: 100,
    select: { id: true, number: true, requestedAt: true, supplier: { select: { label1: true } } },
  });

  // Comparateur de prix : seules les offres reellement saisies sont comparees.
  const article = articleId
    ? await prisma.item.findUnique({
        where: { id: articleId },
        select: { id: true, code: true, label1: true },
      })
    : null;
  const comparaison = article ? await comparerPrixFournisseurs(article.id) : null;

  const optionsArticles = articles.map((element) => ({
    valeur: element.id,
    libelle: `${element.code} — ${element.label1}`,
  }));
  const optionsUnites = unites.map((unite) => ({
    valeur: unite.code,
    libelle: `${unite.code} — ${unite.label}`,
  }));
  const optionsTva = tauxTva.map((taux) => ({
    valeur: taux.code,
    libelle: `${taux.label} (${formatPourcentage(taux.rate)})`,
  }));

  const lienAjouterLigne = construireLien("/achats/commandes/nouvelle", {
    q: recherche,
    demande: demandeId,
    article: articleId,
    lignes: Math.min(nombreLignes + 1, NOMBRE_LIGNES_MAX),
  });

  return (
    <>
      <EnTetePage
        titre="Nouveau bon de commande fournisseur"
        description="Engagement d'achat aupres d'un fournisseur. Le bon est cree au statut brouillon : son approbation est un acte distinct, realise par une autre personne."
        actions={
          <Link className="lien-nav text-sm" href="/achats/commandes">
            Retour a la liste
          </Link>
        }
      />

      <div className="space-y-6">
        <Carte
          titre="Rechercher un article"
          description="Filtre la liste des articles proposes sur les lignes de commande et permet d'afficher le comparateur de prix fournisseurs."
        >
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Code ou designation</span>
              <input className="champ" type="search" name="q" defaultValue={recherche ?? ""} />
            </label>
            <input type="hidden" name="lignes" value={nombreLignes} />
            {demandeId !== null && <input type="hidden" name="demande" value={demandeId} />}
            <button
              type="submit"
              className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
            >
              Rechercher
            </button>
            <Link className="lien-nav text-sm" href="/achats/commandes/nouvelle">
              Reinitialiser
            </Link>
          </form>

          <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
            {articles.length} article(s) achetable(s) affiche(s){recherche ? ` pour « ${recherche} »` : ""}.
          </p>

          <div className="mt-3">
            <Tableau
              colonnes={[
                { cle: "article", libelle: "Article" },
                { cle: "unite", libelle: "Unite" },
                { cle: "tva", libelle: "Code TVA" },
                { cle: "comparer", libelle: "Comparateur" },
              ]}
              lignes={articles.slice(0, 50).map((element) => ({
                cle: String(element.id),
                cellules: [
                  `${element.code} — ${element.label1}`,
                  element.unitCode ?? "-",
                  element.taxRateCode ?? "Taux par defaut",
                  <Link
                    key="comparer"
                    className="lien-nav"
                    href={construireLien("/achats/commandes/nouvelle", {
                      q: recherche,
                      demande: demandeId,
                      lignes: nombreLignes,
                      article: element.id,
                    })}
                  >
                    Comparer les prix fournisseurs
                  </Link>,
                ],
              }))}
              messageVide="Aucun article achetable ne correspond a la recherche."
            />
            {articles.length > 50 && (
              <p className="px-4 py-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                Seuls les 50 premiers articles sont listes ; precisez la recherche pour affiner.
              </p>
            )}
          </div>
        </Carte>

        {comparaison && (
          <Carte
            titre={`Comparateur de prix — ${comparaison.article.code} ${comparaison.article.label1}`}
            description="Offres fournisseurs reellement enregistrees et en cours de validite. Aucun prix n'est suppose."
            sansPadding
          >
            <ListeDefinitions
              elements={[
                { terme: "Unite d'achat", valeur: comparaison.article.unitCode ?? "-" },
                {
                  terme: "Dernier prix d'achat (VWAP)",
                  valeur: formatMontant(comparaison.article.vwap, deviseParametre),
                },
                {
                  terme: "Meilleure offre",
                  valeur: comparaison.meilleureOffre
                    ? `${comparaison.meilleureOffre.supplier.label1} — ${formatMontant(
                        comparaison.meilleureOffre.price,
                        deviseParametre,
                      )}`
                    : "Aucune offre enregistree pour cet article",
                },
              ]}
            />
            <div className="mt-4">
              <Tableau
                colonnes={[
                  { cle: "fournisseur", libelle: "Fournisseur" },
                  { cle: "prix", libelle: "Prix", nombre: true },
                  { cle: "ecart", libelle: "Ecart au dernier prix", nombre: true },
                  { cle: "delai", libelle: "Delai (jours)", nombre: true },
                  { cle: "mini", libelle: "Quantite mini", nombre: true },
                  { cle: "reference", libelle: "Reference fournisseur" },
                  { cle: "validite", libelle: "Validite" },
                  { cle: "prefere", libelle: "Preference" },
                ]}
                lignes={comparaison.offres.map((offre) => ({
                  cle: String(offre.id),
                  cellules: [
                    `${offre.supplier.code} — ${offre.supplier.label1}`,
                    formatMontant(offre.price, deviseParametre),
                    offre.ecartPourcent === null
                      ? "Non calculable (aucun prix d'achat anterieur)"
                      : formatPourcentage(offre.ecartPourcent),
                    String(offre.leadTimeDays),
                    formatQuantite(offre.minQuantity),
                    offre.supplierRef ?? "-",
                    `${formatDate(offre.validFrom)} au ${offre.validTo ? formatDate(offre.validTo) : "sans echeance"}`,
                    offre.isPreferred ? "Offre preferee" : "-",
                  ],
                }))}
                messageVide="Aucune offre fournisseur enregistree pour cet article : saisissez un prix manuellement sur la ligne de commande."
              />
            </div>
          </Carte>
        )}

        {demandesConvertibles.length > 0 && (
          <Carte
            titre="Convertir une demande d'achat approuvee"
            description="Les lignes de la demande sont alors reprises telles quelles, avec les prix estimes saisis par le demandeur."
          >
            <form method="get" className="flex flex-wrap items-end gap-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Demande approuvee</span>
                <select className="champ" name="demande" defaultValue="">
                  <option value="">Aucune conversion — saisie manuelle</option>
                  {demandesConvertibles.map((element) => (
                    <option key={element.id} value={element.id}>
                      {element.number} — {formatDate(element.requestedAt)}
                      {element.supplier ? ` — ${element.supplier.label1}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
              >
                Charger la demande
              </button>
            </form>
          </Carte>
        )}

        <Carte
          titre="Bon de commande"
          description="Les montants HT, TVA et TTC sont calcules par le service a partir des taux de TVA en vigueur."
        >
          <FormulaireAction
            action={actionCreerCommandeFournisseur}
            libelleSoumettre="Enregistrer le bon de commande"
            varianteSoumettre="primaire"
          >
            <input type="hidden" name="nombreLignes" value={nombreLignes} />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Champ
                nom="fournisseurId"
                libelle="Fournisseur"
                type="select"
                requis
                valeur={demande?.supplierId ?? ""}
                options={fournisseurs.map((fournisseur) => ({
                  valeur: fournisseur.id,
                  libelle: `${fournisseur.code} — ${fournisseur.label1}`,
                }))}
              />
              <Champ
                nom="dateCommande"
                libelle="Date de la commande"
                type="date"
                valeur={toInputDate(new Date())}
              />
              <Champ nom="datePrevue" libelle="Date de livraison prevue" type="date" />
              <Champ
                nom="devise"
                libelle="Devise"
                valeur={deviseParametre}
                aide="Devise de facturation du fournisseur."
              />
              <Champ
                nom="conditionsReglement"
                libelle="Conditions de reglement (jours)"
                type="number"
                min={0}
                pas="1"
                aide="Laisser vide pour reprendre le delai du fournisseur."
              />
              <Champ
                nom="remiseGlobale"
                libelle="Remise globale (%)"
                type="number"
                min={0}
                max={99.99}
                pas="0.01"
              />
              <Champ nom="adresseLivraison" libelle="Adresse de livraison" />
              <Champ nom="notes" libelle="Notes internes" type="textarea" maxLength={1000} />
            </div>

            {demande && (
              <div className="mt-5">
                <input type="hidden" name="demandeId" value={demande.id} />
                <input type="hidden" name="depuisDemande" value="1" />
                <Alerte
                  ton={demande.status === "APPROUVEE" ? "info" : "alerte"}
                  titre={`Reprise de la demande ${demande.number} (${libelle(
                    LIBELLES_STATUT_DEMANDE_ACHAT,
                    demande.status,
                  )})`}
                >
                  <p>
                    Les lignes de cette demande seront reprises par le service, avec les prix
                    estimes du demandeur. Seules les demandes approuvees peuvent etre converties :
                    toute autre situation sera refusee par le serveur, avec son propre message.
                  </p>
                </Alerte>
                <div className="mt-3">
                  <Tableau
                    colonnes={[
                      { cle: "ligne", libelle: "Ligne", nombre: true },
                      { cle: "article", libelle: "Article" },
                      { cle: "quantite", libelle: "Quantite demandee", nombre: true },
                      { cle: "prix", libelle: "Prix estime", nombre: true },
                      { cle: "besoin", libelle: "Besoin le" },
                    ]}
                    lignes={demande.lines.map((ligne) => ({
                      cle: String(ligne.id),
                      cellules: [
                        String(ligne.lineNo),
                        `${ligne.item.code} — ${ligne.item.label1}`,
                        formatQuantite(ligne.quantity),
                        formatMontant(ligne.estimatedPrice, deviseParametre),
                        formatDate(ligne.neededBy),
                      ],
                    }))}
                    messageVide="Cette demande ne comporte aucune ligne."
                  />
                </div>
              </div>
            )}

            {!demande && (
              <Section titre="Lignes de commande">
                <p className="mb-3 text-sm" style={{ color: "var(--texte-doux)" }}>
                  Une ligne sans article et sans quantite est ignoree. Le nombre de lignes peut etre
                  augmente jusqu&apos;a {NOMBRE_LIGNES_MAX}.
                </p>
                <div className="overflow-x-auto">
                  <table className="donnees">
                    <thead>
                      <tr>
                        <th style={{ minWidth: "18rem" }}>Article</th>
                        <th className="nombre">Quantite</th>
                        <th style={{ minWidth: "10rem" }}>Unite</th>
                        <th className="nombre">Prix unitaire</th>
                        <th className="nombre">Remise (%)</th>
                        <th style={{ minWidth: "10rem" }}>Code TVA</th>
                        <th>Date prevue</th>
                        <th style={{ minWidth: "12rem" }}>Description de la ligne</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: nombreLignes }, (_, index) => (
                        <tr key={index}>
                          <td>
                            <select className="champ" name={`ligne_${index}_itemId`} defaultValue="">
                              <option value="">— Selectionner —</option>
                              {optionsArticles.map((option) => (
                                <option key={String(option.valeur)} value={String(option.valeur)}>
                                  {option.libelle}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="nombre">
                            <input
                              className="champ"
                              type="number"
                              name={`ligne_${index}_quantite`}
                              step="0.001"
                              min="0"
                              inputMode="decimal"
                            />
                          </td>
                          <td>
                            <select className="champ" name={`ligne_${index}_unite`} defaultValue="">
                              <option value="">Unite de l&apos;article</option>
                              {optionsUnites.map((option) => (
                                <option key={String(option.valeur)} value={String(option.valeur)}>
                                  {option.libelle}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="nombre">
                            <input
                              className="champ"
                              type="number"
                              name={`ligne_${index}_prixUnitaire`}
                              step="0.0001"
                              min="0"
                              inputMode="decimal"
                            />
                          </td>
                          <td className="nombre">
                            <input
                              className="champ"
                              type="number"
                              name={`ligne_${index}_remise`}
                              step="0.01"
                              min="0"
                              max="99.99"
                              inputMode="decimal"
                            />
                          </td>
                          <td>
                            <select className="champ" name={`ligne_${index}_codeTva`} defaultValue="">
                              <option value="">Taux par defaut</option>
                              {optionsTva.map((option) => (
                                <option key={String(option.valeur)} value={String(option.valeur)}>
                                  {option.libelle}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="champ"
                              type="date"
                              name={`ligne_${index}_datePrevue`}
                            />
                          </td>
                          <td>
                            <input className="champ" type="text" name={`ligne_${index}_description`} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {nombreLignes < NOMBRE_LIGNES_MAX && (
                  <p className="mt-3 text-sm">
                    <Link className="lien-nav" href={lienAjouterLigne}>
                      Ajouter une ligne
                    </Link>
                  </p>
                )}
              </Section>
            )}

            {!demande && articles.length === 0 && (
              <div className="mt-4">
                <Alerte ton="alerte" titre="Aucun article achetable disponible">
                  Aucun article actif n&apos;est marque comme achetable. La commande ne pourra pas
                  etre enregistree : activez la propriete « achetable » sur les fiches articles
                  concernees.
                </Alerte>
              </div>
            )}
          </FormulaireAction>
        </Carte>
      </div>
    </>
  );
}
