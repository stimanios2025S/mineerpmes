import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  actionCloturerPrixFournisseur,
  actionCreerPrixFournisseur,
  actionCreerPrixVente,
  actionDesactiverPrixVente,
} from "@/actions/referentiel";
import { aLaPermission, exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fabricantLien,
  lireParametresListe,
  modeInsensible,
  pagination,
} from "@/lib/liste";
import { CLE_PARAMETRE, lireParametreTexte } from "@/lib/settings";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Pagination,
  Tableau,
} from "@/components/ui";
import { BoutonAction, Champ, FormulaireAction } from "@/components/interactif";
import {
  DEVISE_PAR_DEFAUT,
  formatDate,
  formatMontant,
  formatPourcentage,
  formatQuantite,
} from "@/lib/format";

export const metadata = { title: "Tarifs et prix" };

const LISTES = [
  { code: "vente", libelle: "Prix de vente" },
  { code: "fournisseur", libelle: "Tarifs fournisseurs" },
] as const;

export default async function PageTarifs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.PRIX_LIRE);
  const peutGerer = aLaPermission(utilisateur, PERMISSIONS.PRIX_GERER);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["liste"]);
  const listeChoisie =
    LISTES.find((valeur) => valeur.code === parametres.filtres.liste)?.code ?? "vente";

  // Le filtre de recherche porte sur l'article : c'est la cle de lecture des
  // tarifs, et il borne aussi les listes deroulantes des formulaires.
  const filtreArticle: Prisma.ItemWhereInput | undefined = parametres.recherche
    ? {
        OR: [
          { code: modeInsensible(parametres.recherche) },
          { label1: modeInsensible(parametres.recherche) },
        ],
      }
    : undefined;

  const whereVente: Prisma.ItemPriceWhereInput = filtreArticle
    ? { item: filtreArticle }
    : {};
  const whereFournisseur: Prisma.ItemSupplierPriceWhereInput = filtreArticle
    ? { item: filtreArticle }
    : {};

  const [
    totalVente,
    totalFournisseur,
    articles,
    tiers,
    fournisseurs,
    deviseParametre,
  ] = await Promise.all([
    prisma.itemPrice.count({ where: whereVente }),
    prisma.itemSupplierPrice.count({ where: whereFournisseur }),
    peutGerer
      ? prisma.item.findMany({
          where: {
            status: "ACTIF",
            ...(filtreArticle ?? {}),
          },
          orderBy: { code: "asc" },
          take: 200,
          select: { id: true, code: true, label1: true, unitCode: true },
        })
      : Promise.resolve([]),
    peutGerer
      ? prisma.thirdParty.findMany({
          where: { isClient: true },
          orderBy: { code: "asc" },
          take: 300,
          select: { id: true, code: true, label1: true },
        })
      : Promise.resolve([]),
    peutGerer
      ? prisma.thirdParty.findMany({
          where: { isSupplier: true },
          orderBy: { code: "asc" },
          take: 300,
          select: { id: true, code: true, label1: true },
        })
      : Promise.resolve([]),
    lireParametreTexte(CLE_PARAMETRE.DEVISE, DEVISE_PAR_DEFAUT),
  ]);

  // Une seule liste est paginee a la fois : la profondeur de lecture reste
  // bornee quel que soit le volume de tarifs enregistre.
  const totalCourant = listeChoisie === "vente" ? totalVente : totalFournisseur;
  const bornes = pagination(totalCourant, parametres.page, parametres.taille);

  const prixVente =
    listeChoisie === "vente"
      ? await prisma.itemPrice.findMany({
          where: whereVente,
          orderBy: [{ item: { code: "asc" } }, { validFrom: "desc" }],
          skip: bornes.skip,
          take: bornes.take,
          include: {
            item: { select: { id: true, code: true, label1: true, unitCode: true } },
            thirdParty: { select: { id: true, code: true, label1: true } },
          },
        })
      : [];

  const prixFournisseurs =
    listeChoisie === "fournisseur"
      ? await prisma.itemSupplierPrice.findMany({
          where: whereFournisseur,
          orderBy: [{ item: { code: "asc" } }, { price: "asc" }],
          skip: bornes.skip,
          take: bornes.take,
          include: {
            item: { select: { id: true, code: true, label1: true, unitCode: true } },
            supplier: { select: { id: true, code: true, label1: true } },
          },
        })
      : [];

  const filtresCourants = {
    q: parametres.recherche,
    liste: listeChoisie,
  };

  const optionsArticles = articles.map((article) => ({
    valeur: article.id,
    libelle: `${article.code} — ${article.label1}`,
  }));

  return (
    <>
      <EnTetePage
        titre="Tarifs et prix"
        description="Prix de vente et tarifs fournisseurs reels, saisis article par article. Aucun prix n'est deduit d'une moyenne ni d'un tarif suppose : seules les lignes enregistrees sont affichees."
        actions={
          <Link className="lien-nav text-sm" href="/referentiel/articles">
            Consulter les articles
          </Link>
        }
      />

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des tarifs"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Liste</span>
          <select className="champ" name="liste" defaultValue={listeChoisie}>
            {LISTES.map((valeur) => (
              <option key={valeur.code} value={valeur.code}>
                {valeur.libelle}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Recherche article</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={parametres.recherche ?? ""}
            placeholder="Code ou libelle de l'article"
          />
        </label>
        <button
          type="submit"
          className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
        >
          Filtrer
        </button>
        <Link className="lien-nav text-sm" href="/referentiel/tarifs">
          Reinitialiser
        </Link>
      </form>

      {peutGerer ? (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Carte
            titre="Nouveau prix de vente"
            description="Un prix general s'applique a tous les clients ; un prix rattache a un client ne s'applique qu'a lui."
          >
            <FormulaireAction
              action={actionCreerPrixVente}
              libelleSoumettre="Enregistrer le prix"
              varianteSoumettre="primaire"
              reinitialiser
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Champ
                  nom="articleId"
                  libelle="Article"
                  type="select"
                  requis
                  options={optionsArticles}
                  aide="Affinez la recherche ci-dessus pour reduire la liste des articles proposes."
                />
                <Champ
                  nom="tiersId"
                  libelle="Client"
                  type="select"
                  options={tiers.map((tiersCourant) => ({
                    valeur: tiersCourant.id,
                    libelle: `${tiersCourant.code} — ${tiersCourant.label1}`,
                  }))}
                  aide="Laisser vide pour un tarif general."
                />
                <Champ
                  nom="typePrix"
                  libelle="Type de prix"
                  valeur="VENTE"
                  maxLength={40}
                  aide="Libelle du tarif, repris tel quel dans les documents."
                />
                <Champ
                  nom="prix"
                  libelle="Prix unitaire"
                  type="number"
                  requis
                  min={0}
                  pas="0.0001"
                />
                <Champ
                  nom="devise"
                  libelle="Devise"
                  valeur={deviseParametre}
                  maxLength={10}
                />
                <Champ
                  nom="remise"
                  libelle="Remise (%)"
                  type="number"
                  min={0}
                  max={100}
                  pas="0.01"
                  valeur={0}
                />
                <Champ nom="du" libelle="Valide a partir du" type="date" />
                <Champ
                  nom="au"
                  libelle="Valide jusqu'au"
                  type="date"
                  aide="Laisser vide pour un tarif sans echeance."
                />
              </div>
            </FormulaireAction>
          </Carte>

          <Carte
            titre="Nouveau tarif fournisseur"
            description="Offre d'achat reelle d'un fournisseur pour un article donne, avec son delai et sa quantite minimum."
          >
            <FormulaireAction
              action={actionCreerPrixFournisseur}
              libelleSoumettre="Enregistrer le tarif"
              varianteSoumettre="primaire"
              reinitialiser
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Champ nom="articleId" libelle="Article" type="select" requis options={optionsArticles} />
                <Champ
                  nom="fournisseurId"
                  libelle="Fournisseur"
                  type="select"
                  requis
                  options={fournisseurs.map((fournisseur) => ({
                    valeur: fournisseur.id,
                    libelle: `${fournisseur.code} — ${fournisseur.label1}`,
                  }))}
                />
                <Champ
                  nom="referenceFournisseur"
                  libelle="Reference fournisseur"
                  maxLength={100}
                />
                <Champ nom="prix" libelle="Prix unitaire" type="number" requis min={0} pas="0.0001" />
                <Champ nom="devise" libelle="Devise" valeur={deviseParametre} maxLength={10} />
                <Champ
                  nom="delaiLivraison"
                  libelle="Delai de livraison (jours)"
                  type="number"
                  min={0}
                  pas="1"
                  valeur={0}
                />
                <Champ
                  nom="quantiteMini"
                  libelle="Quantite minimum"
                  type="number"
                  min={0}
                  pas="0.001"
                  valeur={0}
                />
                <Champ nom="du" libelle="Valide a partir du" type="date" />
                <Champ nom="au" libelle="Valide jusqu'au" type="date" />
              </div>
              <div className="mt-4">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="offrePreferee" className="mt-1" />
                  <span>
                    <span className="block font-medium">Offre preferee</span>
                    <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                      L&apos;offre proposee par defaut pour cet article.
                    </span>
                  </span>
                </label>
              </div>
            </FormulaireAction>
          </Carte>
        </div>
      ) : (
        <div className="mb-6">
          <Alerte ton="info" titre="Consultation seule">
            La saisie de prix exige la permission de gestion des prix et tarifs. Votre profil
            dispose de la consultation.
          </Alerte>
        </div>
      )}

      {listeChoisie === "vente" ? (
        <Carte
          titre="Prix de vente"
          description={`${totalVente} prix de vente enregistre(s) pour les criteres courants.`}
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "article", libelle: "Article" },
              { cle: "unite", libelle: "Unite" },
              { cle: "type", libelle: "Type de prix" },
              { cle: "client", libelle: "Client" },
              { cle: "prix", libelle: "Prix", nombre: true },
              { cle: "remise", libelle: "Remise", nombre: true },
              { cle: "validite", libelle: "Validite" },
              { cle: "etat", libelle: "Etat" },
              { cle: "action", libelle: "Action" },
            ]}
            lignes={prixVente.map((prix) => ({
              cle: String(prix.id),
              cellules: [
                <Link
                  key="article"
                  className="lien-nav"
                  href={`/referentiel/articles/${prix.item.id}`}
                >
                  {prix.item.code}
                </Link>,
                prix.item.unitCode ?? "-",
                prix.priceType,
                prix.thirdParty
                  ? `${prix.thirdParty.code} — ${prix.thirdParty.label1}`
                  : "Tarif general",
                formatMontant(prix.price, prix.currency),
                formatPourcentage(prix.discountRate),
                prix.validFrom || prix.validTo
                  ? `${formatDate(prix.validFrom)} au ${
                      prix.validTo ? formatDate(prix.validTo) : "sans echeance"
                    }`
                  : "Sans limite de validite",
                <EtiquetteStatut
                  key="etat"
                  code={prix.isActive ? "ACTIF" : "INACTIF"}
                  libelle={prix.isActive ? "Actif" : "Inactif"}
                />,
                peutGerer && prix.isActive ? (
                  <BoutonAction
                    key="action"
                    action={actionDesactiverPrixVente}
                    libelle="Retirer"
                    variante="secondaire"
                    champsCaches={{ prixId: prix.id }}
                    confirmation="Retirer ce prix du catalogue actif ? La ligne restera consultable dans l'historique."
                    titre="Le prix n'est pas supprime : il devient inactif."
                  />
                ) : (
                  <span key="action" style={{ color: "var(--texte-doux)" }}>
                    -
                  </span>
                ),
              ],
            }))}
            messageVide="Aucun prix de vente ne correspond aux criteres."
          />
          <Pagination
            page={parametres.page}
            pages={bornes.pages}
            total={totalVente}
            construireLien={fabricantLien("/referentiel/tarifs", filtresCourants)}
          />
        </Carte>
      ) : (
        <Carte
          titre="Tarifs fournisseurs"
          description={`${totalFournisseur} tarif(s) fournisseur enregistre(s) pour les criteres courants.`}
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "article", libelle: "Article" },
              { cle: "unite", libelle: "Unite" },
              { cle: "fournisseur", libelle: "Fournisseur" },
              { cle: "reference", libelle: "Reference fournisseur" },
              { cle: "prix", libelle: "Prix", nombre: true },
              { cle: "delai", libelle: "Delai (jours)", nombre: true },
              { cle: "mini", libelle: "Quantite mini", nombre: true },
              { cle: "validite", libelle: "Validite" },
              { cle: "preference", libelle: "Preference" },
              { cle: "action", libelle: "Action" },
            ]}
            lignes={prixFournisseurs.map((prix) => {
              const cloture = prix.validTo !== null && prix.validTo.getTime() <= Date.now();
              return {
                cle: String(prix.id),
                cellules: [
                  <Link
                    key="article"
                    className="lien-nav"
                    href={`/referentiel/articles/${prix.item.id}`}
                  >
                    {prix.item.code}
                  </Link>,
                  prix.item.unitCode ?? "-",
                  <Link
                    key="fournisseur"
                    className="lien-nav"
                    href={`/referentiel/tiers/${prix.supplier.id}`}
                  >
                    {prix.supplier.code} — {prix.supplier.label1}
                  </Link>,
                  prix.supplierRef ?? "-",
                  formatMontant(prix.price, prix.currency),
                  String(prix.leadTimeDays),
                  formatQuantite(prix.minQuantity),
                  prix.validFrom || prix.validTo
                    ? `${formatDate(prix.validFrom)} au ${
                        prix.validTo ? formatDate(prix.validTo) : "sans echeance"
                      }`
                    : "Sans limite de validite",
                  <span key="preference" className="inline-flex flex-wrap items-center gap-1">
                    {prix.isPreferred && <Etiquette ton="primaire">Offre preferee</Etiquette>}
                    {cloture && <Etiquette ton="neutre">Tarif cloture</Etiquette>}
                    {!prix.isPreferred && !cloture && <span>-</span>}
                  </span>,
                  peutGerer && prix.validTo === null ? (
                    <BoutonAction
                      key="action"
                      action={actionCloturerPrixFournisseur}
                      libelle="Cloturer"
                      variante="secondaire"
                      champsCaches={{ tarifId: prix.id }}
                      confirmation="Cloturer ce tarif fournisseur ? Il restera consultable mais ne sera plus courant."
                    />
                  ) : (
                    <span key="action" style={{ color: "var(--texte-doux)" }}>
                      -
                    </span>
                  ),
                ],
              };
            })}
            messageVide="Aucun tarif fournisseur ne correspond aux criteres."
          />
          <Pagination
            page={parametres.page}
            pages={bornes.pages}
            total={totalFournisseur}
            construireLien={fabricantLien("/referentiel/tarifs", filtresCourants)}
          />
        </Carte>
      )}

      {peutGerer && articles.length === 0 && (
        <div className="mt-6">
          <Alerte ton="alerte" titre="Aucun article actif disponible">
            Aucun article actif ne correspond a la recherche : la saisie d&apos;un prix est
            impossible tant qu&apos;un article n&apos;est pas selectionnable.
          </Alerte>
        </div>
      )}

      <p className="mt-4 text-xs" style={{ color: "var(--texte-doux)" }}>
        Les prix sont enregistres en {deviseParametre}, devise de parametrage de
        l&apos;application.
      </p>
    </>
  );
}
