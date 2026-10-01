import Link from "next/link";
import { prisma } from "@/lib/db";
import { actionCreerDevis } from "@/actions/vente";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { construireLien, premiereValeur } from "@/lib/liste";
import { lireParametreTexte, CLE_PARAMETRE } from "@/lib/settings";
import { Alerte, Carte, EnTetePage, Section } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { DEVISE_PAR_DEFAUT, formatPourcentage, toInputDate } from "@/lib/format";

export const metadata = { title: "Nouveau devis" };

const NOMBRE_LIGNES_DEFAUT = 4;
const NOMBRE_LIGNES_MAX = 30;

/** Convertit une valeur d'URL en entier borne, sans jamais faire echouer la page. */
function entierDeFiltre(valeur: string | null, defaut: number, minimum: number, maximum: number) {
  if (valeur === null) return defaut;
  const nombre = Number.parseInt(valeur, 10);
  if (!Number.isFinite(nombre)) return defaut;
  return Math.min(Math.max(nombre, minimum), maximum);
}

export default async function PageNouveauDevis({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.VENTE_DEVIS_CREER);

  const parametres = await searchParams;
  const recherche = premiereValeur(parametres, "q");
  const nombreLignes = entierDeFiltre(
    premiereValeur(parametres, "lignes"),
    NOMBRE_LIGNES_DEFAUT,
    1,
    NOMBRE_LIGNES_MAX,
  );

  const [clients, articles, tauxTva, unites, devise] = await Promise.all([
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

  const optionsArticles = articles.map((article) => ({
    valeur: article.id,
    libelle: `${article.code} — ${article.label1}`,
  }));
  const optionsUnites = unites.map((unite) => ({
    valeur: unite.code,
    libelle: `${unite.code} — ${unite.label}`,
  }));
  const optionsTva = tauxTva.map((taux) => ({
    valeur: taux.code,
    libelle: `${taux.label} (${formatPourcentage(taux.rate)})`,
  }));

  const lienAjouterLigne = construireLien("/ventes/devis/nouveau", {
    q: recherche,
    lignes: Math.min(nombreLignes + 1, NOMBRE_LIGNES_MAX),
  });

  return (
    <>
      <EnTetePage
        titre="Nouveau devis client"
        description="Proposition commerciale chiffree. Le devis est cree au statut brouillon : son envoi, son acceptation puis sa transformation en commande sont des actes distincts, traces chacun dans le journal."
        actions={
          <Link className="lien-nav text-sm" href="/ventes/devis">
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
            <Link className="lien-nav text-sm" href="/ventes/devis/nouveau">
              Reinitialiser
            </Link>
          </form>
          <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
            {articles.length} article(s) vendable(s) affiche(s)
            {recherche ? ` pour « ${recherche} »` : ""}.
          </p>
        </Carte>

        <Carte
          titre="Devis"
          description="Les montants HT, TVA et TTC sont calcules par le service a partir des taux de TVA en vigueur : aucun taux n'est code en dur dans l'interface."
        >
          <FormulaireAction
            action={actionCreerDevis}
            libelleSoumettre="Enregistrer le devis"
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
                nom="dateDevis"
                libelle="Date du devis"
                type="date"
                valeur={toInputDate(new Date())}
              />
              <Champ
                nom="dateValidite"
                libelle="Valable jusqu'au"
                type="date"
                aide="Laissez vide pour un devis sans echeance."
              />
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
              <Champ nom="notes" libelle="Notes internes" type="textarea" maxLength={1000} />
            </div>

            <Section titre="Lignes du devis">
              <p className="mb-3 text-sm" style={{ color: "var(--texte-doux)" }}>
                Une ligne sans article et sans quantite est ignoree. Le code TVA laisse vide
                applique le taux de la fiche article, ou le taux par defaut. Le nombre de lignes
                peut etre augmente jusqu&apos;a {NOMBRE_LIGNES_MAX}.
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
                      <th style={{ minWidth: "14rem" }}>Description de la ligne</th>
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

            {articles.length === 0 && (
              <div className="mt-4">
                <Alerte ton="alerte" titre="Aucun article vendable disponible">
                  Aucun article actif n&apos;est marque comme vendable
                  {recherche ? ` pour la recherche « ${recherche} »` : ""}. Le devis ne pourra pas
                  etre enregistre : activez la propriete « vendable » sur les fiches articles
                  concernees, ou modifiez la recherche.
                </Alerte>
              </div>
            )}
          </FormulaireAction>
        </Carte>
      </div>
    </>
  );
}
