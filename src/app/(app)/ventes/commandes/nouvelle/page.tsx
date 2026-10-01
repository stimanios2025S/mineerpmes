import Link from "next/link";
import { prisma } from "@/lib/db";
import { actionCreerCommandeClient } from "@/actions/vente";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { construireLien, premiereValeur } from "@/lib/liste";
import { lireParametreBooleen, lireParametreTexte, CLE_PARAMETRE } from "@/lib/settings";
import { Alerte, Carte, EnTetePage, Etiquette, Section } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { DEVISE_PAR_DEFAUT, formatPourcentage, toInputDate } from "@/lib/format";

export const metadata = { title: "Nouvelle commande client" };

const NOMBRE_LIGNES_DEFAUT = 4;
const NOMBRE_LIGNES_MAX = 30;

/** Convertit une valeur d'URL en entier borne, sans jamais faire echouer la page. */
function entierDeFiltre(valeur: string | null, defaut: number, minimum: number, maximum: number) {
  if (valeur === null) return defaut;
  const nombre = Number.parseInt(valeur, 10);
  if (!Number.isFinite(nombre)) return defaut;
  return Math.min(Math.max(nombre, minimum), maximum);
}

export default async function PageNouvelleCommandeClient({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.VENTE_COMMANDE_CREER);

  const parametres = await searchParams;
  const recherche = premiereValeur(parametres, "q");
  const nombreLignes = entierDeFiltre(
    premiereValeur(parametres, "lignes"),
    NOMBRE_LIGNES_DEFAUT,
    1,
    NOMBRE_LIGNES_MAX,
  );

  const [clients, articles, tauxTva, unites, devise, autoProduction] = await Promise.all([
    prisma.thirdParty.findMany({
      where: { isClient: true, isActive: true },
      orderBy: { code: "asc" },
      take: 500,
      select: { id: true, code: true, label1: true, deadlineDays: true },
    }),
    prisma.item.findMany({
      where: {
        status: "ACTIF",
        isSellable: true,
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
      select: {
        id: true,
        code: true,
        label1: true,
        unitCode: true,
        taxRateCode: true,
        isProducible: true,
      },
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
    lireParametreBooleen(CLE_PARAMETRE.CATALOGUE_AUTO_PRODUCTION, false),
  ]);

  const articlesProductibles = articles.filter((article) => article.isProducible);
  const optionsUnites = unites.map((unite) => ({
    valeur: unite.code,
    libelle: `${unite.code} — ${unite.label}`,
  }));
  const optionsTva = tauxTva.map((taux) => ({
    valeur: taux.code,
    libelle: `${taux.label} (${formatPourcentage(taux.rate)})`,
  }));

  const lienAjouterLigne = construireLien("/ventes/commandes/nouvelle", {
    q: recherche,
    lignes: Math.min(nombreLignes + 1, NOMBRE_LIGNES_MAX),
  });

  return (
    <>
      <EnTetePage
        titre="Nouvelle commande client"
        description="La commande est creee au statut brouillon. Sa confirmation est un acte distinct : c'est elle qui declenche la generation des ordres de fabrication des lignes concernees."
        actions={
          <Link className="lien-nav text-sm" href="/ventes/commandes">
            Retour a la liste
          </Link>
        }
      />

      <div className="space-y-6">
        <Carte
          titre="Rechercher un article vendable"
          description="La recherche filtre les articles proposes sur les lignes. Seuls les articles actifs marques comme vendables sont proposes ; le service refuse tout autre article."
        >
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Code ou designation</span>
              <input className="champ" type="search" name="q" defaultValue={recherche ?? ""} />
            </label>
            <input type="hidden" name="lignes" value={nombreLignes} />
            <button
              type="submit"
              className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
            >
              Rechercher
            </button>
            <Link className="lien-nav text-sm" href="/ventes/commandes/nouvelle">
              Reinitialiser
            </Link>
          </form>
          <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
            {articles.length} article(s) vendable(s) affiche(s)
            {recherche ? ` pour « ${recherche} »` : ""}, dont {articlesProductibles.length}{" "}
            productible(s) en interne.
          </p>
        </Carte>

        <Carte
          titre="Commande client"
          description="Les montants HT, TVA et TTC sont calcules par le service a partir des taux de TVA en vigueur : aucun taux n'est code en dur dans l'interface."
        >
          <FormulaireAction
            action={actionCreerCommandeClient}
            libelleSoumettre="Enregistrer la commande client"
            varianteSoumettre="primaire"
          >
            <input type="hidden" name="nombreLignes" value={nombreLignes} />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Champ
                nom="clientId"
                libelle="Client"
                type="select"
                requis
                options={clients.map((client) => ({
                  valeur: client.id,
                  libelle: `${client.code} — ${client.label1}`,
                }))}
              />
              <Champ
                nom="dateCommande"
                libelle="Date de la commande"
                type="date"
                valeur={toInputDate(new Date())}
              />
              <Champ nom="datePrevue" libelle="Date de livraison prevue" type="date" />
              <Champ nom="devise" libelle="Devise" valeur={devise} />
              <Champ
                nom="conditionsReglement"
                libelle="Conditions de reglement (jours)"
                type="number"
                min={0}
                pas="1"
                aide="Laissez vide pour reprendre le delai habituel du client."
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
              <Champ nom="referenceClient" libelle="Reference du client (bon de commande recu)" />
              <Champ nom="notes" libelle="Notes internes" type="textarea" maxLength={1000} />
            </div>

            <Section titre="Lignes de commande">
              <div className="mb-3">
                <Alerte
                  ton={autoProduction ? "info" : "alerte"}
                  titre={
                    autoProduction
                      ? "Generation automatique des ordres de fabrication activee par la configuration"
                      : "Generation automatique des ordres de fabrication desactivee par la configuration"
                  }
                >
                  {autoProduction
                    ? "Pour les articles productibles, une ligne avec l'interrupteur coche generera un ordre de fabrication a la confirmation de la commande. Le compte rendu de la confirmation indiquera, ligne par ligne, les ordres crees et les echecs eventuels."
                    : "Le parametre d'application « generation automatique a la creation » est desactive : cocher l'interrupteur d'une ligne demandera explicitement la generation d'un ordre de fabrication a la confirmation."}
                </Alerte>
              </div>
              <p className="mb-3 text-sm" style={{ color: "var(--texte-doux)" }}>
                Une ligne sans article et sans quantite est ignoree. Le nombre de lignes peut etre
                augmente jusqu&apos;a {NOMBRE_LIGNES_MAX}.
              </p>
              <div className="overflow-x-auto">
                <table className="donnees">
                  <thead>
                    <tr>
                      <th style={{ minWidth: "18rem" }}>Article vendable</th>
                      <th className="nombre">Quantite</th>
                      <th style={{ minWidth: "10rem" }}>Unite</th>
                      <th className="nombre">Prix unitaire</th>
                      <th className="nombre">Remise (%)</th>
                      <th style={{ minWidth: "10rem" }}>Code TVA</th>
                      <th>Livraison prevue</th>
                      <th style={{ minWidth: "14rem" }}>Description de la ligne</th>
                      <th style={{ minWidth: "12rem" }}>
                        Generer automatiquement un ordre de fabrication
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: nombreLignes }, (_, index) => (
                      <tr key={index}>
                        <td>
                          <select className="champ" name={`ligne_${index}_itemId`} defaultValue="">
                            <option value="">— Selectionner —</option>
                            {articles.map((article) => (
                              <option key={article.id} value={article.id}>
                                {article.code} — {article.label1}
                                {article.isProducible ? " (productible)" : ""}
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
                            step="0.01"
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
                            name={`ligne_${index}_dateLivraison`}
                          />
                        </td>
                        <td>
                          <input className="champ" type="text" name={`ligne_${index}_description`} />
                        </td>
                        <td>
                          <label className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              name={`ligne_${index}_ordreAutomatique`}
                              defaultChecked={autoProduction}
                            />
                            <span>Ordre de fabrication a la confirmation</span>
                          </label>
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
              {articlesProductibles.length === 0 && articles.length > 0 && (
                <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
                  Aucun article productible ne figure dans la liste affichee : l&apos;interrupteur
                  de generation d&apos;ordre de fabrication ne produira rien pour ces lignes.
                </p>
              )}
            </Section>

            {articles.length === 0 && (
              <div className="mt-4">
                <Alerte ton="alerte" titre="Aucun article vendable disponible">
                  Aucun article actif n&apos;est marque comme vendable
                  {recherche ? ` pour la recherche « ${recherche} »` : ""}. La commande ne pourra
                  pas etre enregistree : activez la propriete « vendable » sur les fiches articles
                  concernees, ou modifiez la recherche.
                </Alerte>
              </div>
            )}

            <div className="mt-4">
              <Etiquette ton="neutre">
                Le service revalide le client, chaque article, les quantites et les taux de TVA :
                son message d&apos;erreur s&apos;affichera tel quel.
              </Etiquette>
            </div>
          </FormulaireAction>
        </Carte>
      </div>
    </>
  );
}
