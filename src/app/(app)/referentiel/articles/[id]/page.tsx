import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { soldesArticle } from "@/lib/stock/service";
import { actionArchiverArticle, actionModifierArticle } from "@/actions/referentiel";
import { aLaPermission, exigerPermission, peutAccederUsine } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { identifiantOuNull } from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  ListeDefinitions,
  Section,
  Tableau,
  Vide,
} from "@/components/ui";
import {
  Champ,
  FormulaireAction,
  FormulaireMotif,
} from "@/components/interactif";
import { ACTIONS_AUDIT } from "@/lib/audit";
import {
  formatDate,
  formatDateTime,
  formatMontant,
  formatPourcentage,
  formatQuantite,
} from "@/lib/format";
import {
  LIBELLES_STATUT_ARTICLE,
  LIBELLES_STATUT_GAMME,
  LIBELLES_STATUT_NOMENCLATURE,
  LIBELLES_STATUT_STOCK,
  LIBELLES_TYPE_ARTICLE,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Fiche article" };

const TYPES_ARTICLE = [
  "MATIERE_PREMIERE",
  "COMPOSANT",
  "SEMI_FINI",
  "PRODUIT_FINI",
  "EMBALLAGE",
  "CONSOMMABLE",
  "SERVICE",
  "MAIN_OEUVRE",
] as const;

/** Le statut ARCHIVE ne se pose jamais par le formulaire de modification. */
const STATUTS_MODIFIABLES = [
  "ACTIF",
  "INACTIF",
  "NON_COMMERCIALISABLE",
  "NON_PRODUCTIBLE",
] as const;

const DIVISIONS = ["ADMEDCO", "MOBILIX", "COMMUN"] as const;

function CaseACocher({
  nom,
  libelle: intitule,
  coche,
}: {
  nom: string;
  libelle: string;
  coche: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={nom} defaultChecked={coche} className="mt-1" />
      <span className="font-medium">{intitule}</span>
    </label>
  );
}

export default async function PageArticle({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.ARTICLE_LIRE);

  const { id } = await params;
  const identifiant = identifiantOuNull(id);
  if (identifiant === null) notFound();

  const article = await prisma.item.findUnique({
    where: { id: identifiant },
    include: {
      family: { select: { id: true, code: true, label: true } },
      unit: { select: { code: true, label: true, decimals: true } },
      taxRate: { select: { code: true, label: true, rate: true } },
    },
  });
  if (!article) notFound();
  // Un article hors de la portee de l'utilisateur n'est pas divulgue : la page
  // se comporte comme si la fiche n'existait pas.
  if (!peutAccederUsine(utilisateur, article.factory)) notFound();

  const peutEcrire = aLaPermission(utilisateur, PERMISSIONS.ARTICLE_ECRIRE);
  const peutArchiver = aLaPermission(utilisateur, PERMISSIONS.ARTICLE_ARCHIVER);
  const peutVoirPrix = aLaPermission(utilisateur, PERMISSIONS.PRIX_LIRE);

  const [
    soldes,
    familles,
    unites,
    tauxTva,
    nomenclatures,
    gammes,
    lots,
    prixFournisseurs,
    tarifsVente,
  ] = await Promise.all([
    // Soldes reels : la fonction du grand livre applique la regle du disponible
    // (physique moins reserve, bloque, endommage et quarantaine).
    soldesArticle(article.id),
    peutEcrire
      ? prisma.itemFamily.findMany({
          where: { isActive: true },
          orderBy: { code: "asc" },
          take: 500,
          select: { id: true, code: true, label: true },
        })
      : Promise.resolve([]),
    peutEcrire
      ? prisma.unitOfMeasure.findMany({
          where: { isActive: true },
          orderBy: { code: "asc" },
          take: 200,
          select: { code: true, label: true },
        })
      : Promise.resolve([]),
    peutEcrire
      ? prisma.taxRate.findMany({
          where: { isActive: true },
          orderBy: { rate: "asc" },
          select: { code: true, label: true, rate: true },
        })
      : Promise.resolve([]),
    // Nomenclatures du produit : la version active est celle qui pilote la
    // production ; les autres versions restent visibles pour l'historique.
    prisma.formula.findMany({
      where: { itemId: article.id },
      orderBy: [{ version: "desc" }],
      select: {
        id: true,
        code: true,
        version: true,
        label: true,
        status: true,
        isDefault: true,
        effectiveFrom: true,
        effectiveTo: true,
        totalCost: true,
        _count: { select: { lines: true } },
      },
    }),
    prisma.productRoute.findMany({
      where: { itemId: article.id },
      orderBy: [{ version: "desc" }],
      include: {
        workshop: { select: { code: true, label: true } },
        _count: { select: { steps: true } },
      },
    }),
    prisma.stockLot.findMany({
      where: { itemId: article.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        warehouse: { select: { code: true } },
        location: { select: { code: true } },
        supplier: { select: { code: true, label1: true } },
      },
    }),
    peutVoirPrix
      ? prisma.itemSupplierPrice.findMany({
          where: { itemId: article.id },
          orderBy: { price: "asc" },
          include: { supplier: { select: { id: true, code: true, label1: true } } },
        })
      : Promise.resolve([]),
    peutVoirPrix
      ? prisma.itemPrice.findMany({
          where: { itemId: article.id },
          orderBy: [{ isActive: "desc" }, { validFrom: "desc" }],
          include: { thirdParty: { select: { id: true, code: true, label1: true } } },
        })
      : Promise.resolve([]),
  ]);

  const nomenclatureActive =
    nomenclatures.find((formule) => formule.status === "ACTIVE") ?? null;
  const nomenclatureActiveDetaillee = nomenclatureActive
    ? await prisma.formula.findUnique({
        where: { id: nomenclatureActive.id },
        include: {
          lines: {
            orderBy: { lineNo: "asc" },
            include: {
              componentItem: { select: { id: true, code: true, label1: true } },
              unit: { select: { code: true } },
            },
          },
          warehouseDest: { select: { code: true, label: true } },
          approvedBy: { select: { email: true } },
        },
      })
    : null;

  // L'archivage est un acte journalise : la date et le motif affiches sont ceux
  // reellement enregistres dans le journal d'audit, jamais une deduction.
  const archivage =
    article.status === "ARCHIVE"
      ? await prisma.auditLog.findFirst({
          where: {
            entity: "Item",
            entityId: String(article.id),
            action: ACTIONS_AUDIT.SUPPRESSION_LOGIQUE,
          },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, userEmail: true, reason: true },
        })
      : null;

  // Le statut propose reprend le statut reel s'il est modifiable ; un article
  // archive n'entre jamais dans ce formulaire.
  const statutModifiable = STATUTS_MODIFIABLES.includes(
    article.status as (typeof STATUTS_MODIFIABLES)[number],
  )
    ? article.status
    : "ACTIF";

  // Valorisation issue des soldes reels, jamais recalculee a partir d'un prix.
  const valeurTotale = D.sum(soldes.map((solde) => solde.totalValue));
  const physiqueTotal = D.sum(soldes.map((solde) => solde.quantityPhysical));
  const disponibleTotal = D.sum(soldes.map((solde) => solde.quantityAvailable));
  const quarantaineTotal = D.sum(soldes.map((solde) => solde.quantityQuarantine));
  const rebutTotal = D.sum(
    soldes.filter((solde) => solde.status === "REBUT").map((solde) => solde.quantityPhysical),
  );

  return (
    <>
      <EnTetePage
        titre={`${article.code} — ${article.label1}`}
        description="Fiche complete de l'article : configuration, seuils, stock reel par depot, nomenclature, gammes, lots et prix enregistres."
        actions={
          <Link className="lien-nav text-sm" href="/referentiel/articles">
            Retour a la liste
          </Link>
        }
      />

      <div className="space-y-6">
        <Carte titre="Identification">
          <ListeDefinitions
            elements={[
              { terme: "Code article", valeur: article.code },
              { terme: "Code-barres", valeur: article.barcode ?? "Non renseigne" },
              { terme: "Reference interne", valeur: article.reference ?? "Non renseignee" },
              { terme: "Libelle 1", valeur: article.label1 },
              { terme: "Libelle 2", valeur: article.label2 ?? "-" },
              { terme: "Libelle 3", valeur: article.label3 ?? "-" },
              { terme: "Designation", valeur: article.designation ?? "-" },
              {
                terme: "Type",
                valeur: libelle(LIBELLES_TYPE_ARTICLE, article.type),
              },
              {
                terme: "Statut",
                valeur: (
                  <EtiquetteStatut
                    code={article.status}
                    libelle={libelle(LIBELLES_STATUT_ARTICLE, article.status)}
                  />
                ),
              },
              { terme: "Division", valeur: libelle(LIBELLES_USINE, article.factory) },
              {
                terme: "Famille",
                valeur: article.family
                  ? `${article.family.code} — ${article.family.label}`
                  : "Sans famille",
              },
              {
                terme: "Unite de mesure",
                valeur: article.unit
                  ? `${article.unit.code} — ${article.unit.label} (${article.unit.decimals} decimales)`
                  : "Non definie",
              },
              {
                terme: "Taux de TVA",
                valeur: article.taxRate
                  ? `${article.taxRate.label} (${formatPourcentage(article.taxRate.rate)})`
                  : "Aucun taux rattache",
              },
            ]}
          />
        </Carte>

        <Carte
          titre="Configuration"
          description="Interrupteurs actifs sur cette fiche. Ils determinent les modules dans lesquels l'article peut etre utilise."
        >
          <div className="flex flex-wrap gap-2">
            <Etiquette ton={article.isPurchasable ? "succes" : "neutre"}>
              {article.isPurchasable ? "Achetable" : "Non achetable"}
            </Etiquette>
            <Etiquette ton={article.isSellable ? "succes" : "neutre"}>
              {article.isSellable ? "Vendable" : "Non vendable"}
            </Etiquette>
            <Etiquette ton={article.isProducible ? "succes" : "neutre"}>
              {article.isProducible ? "Fabricable" : "Non fabricable"}
            </Etiquette>
            <Etiquette ton={article.isSemiFinished ? "info" : "neutre"}>
              {article.isSemiFinished ? "Semi-fini" : "Non semi-fini"}
            </Etiquette>
            <Etiquette ton={article.isRawMaterial ? "info" : "neutre"}>
              {article.isRawMaterial ? "Matiere premiere" : "Hors matieres premieres"}
            </Etiquette>
            <Etiquette ton={article.isMainOeuvre ? "info" : "neutre"}>
              {article.isMainOeuvre ? "Main d'oeuvre" : "Hors main d'oeuvre"}
            </Etiquette>
            <Etiquette ton={article.isBatchManaged ? "primaire" : "neutre"}>
              {article.isBatchManaged ? "Suivi par lot" : "Sans suivi de lot"}
            </Etiquette>
            <Etiquette ton={article.useNegativeStock ? "danger" : "neutre"}>
              {article.useNegativeStock
                ? "Stock negatif autorise"
                : "Stock negatif interdit"}
            </Etiquette>
            <Etiquette ton={article.isOutOfService ? "danger" : "neutre"}>
              {article.isOutOfService ? "Hors service" : "En service"}
            </Etiquette>
            {article.isPerishable && <Etiquette ton="alerte">Perissable</Etiquette>}
            {article.isKit && <Etiquette ton="alerte">Kit</Etiquette>}
          </div>
        </Carte>

        <Carte titre="Seuils, valorisation et logistique">
          <ListeDefinitions
            elements={[
              { terme: "Quantite minimum", valeur: formatQuantite(article.quantityMin) },
              { terme: "Quantite maximum", valeur: formatQuantite(article.quantityMax) },
              { terme: "Stock de securite", valeur: formatQuantite(article.safetyStock) },
              { terme: "Cout moyen (VWAP)", valeur: formatMontant(article.vwap) },
              {
                terme: "Dernier prix d'achat",
                valeur: formatMontant(article.lastPurchasePrice),
              },
              {
                terme: "Dernier prix de vente",
                valeur: formatMontant(article.lastSalesPrice),
              },
              { terme: "Cout standard", valeur: formatMontant(article.standardCost) },
              { terme: "Poids unitaire (kg)", valeur: formatQuantite(article.unitWeight, 6) },
              { terme: "Longueur (mm)", valeur: formatQuantite(article.length, 6) },
              { terme: "Largeur (mm)", valeur: formatQuantite(article.width, 6) },
              { terme: "Hauteur (mm)", valeur: formatQuantite(article.height, 6) },
              { terme: "Epaisseur (mm)", valeur: formatQuantite(article.thickness, 6) },
            ]}
          />
        </Carte>

        <Carte
          titre="Stock par depot"
          description="Soldes reels du grand livre de stock. Le disponible deduit les quantites reservees, bloquees, endommagees et en quarantaine."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "depot", libelle: "Depot" },
              { cle: "emplacement", libelle: "Emplacement" },
              { cle: "lot", libelle: "Lot" },
              { cle: "statut", libelle: "Statut" },
              { cle: "physique", libelle: "Physique", nombre: true },
              { cle: "reserve", libelle: "Reserve", nombre: true },
              { cle: "bloque", libelle: "Bloque", nombre: true },
              { cle: "quarantaine", libelle: "Quarantaine", nombre: true },
              { cle: "disponible", libelle: "Disponible", nombre: true },
              { cle: "cout", libelle: "Cout unitaire", nombre: true },
              { cle: "valeur", libelle: "Valeur", nombre: true },
            ]}
            lignes={soldes.map((solde, index) => ({
              cle: `${solde.warehouseId}-${solde.locationId ?? 0}-${solde.lotId ?? 0}-${solde.status}-${index}`,
              cellules: [
                `${solde.warehouseCode} — ${solde.warehouseLabel}`,
                solde.locationCode ?? "-",
                solde.lotNumber ?? "-",
                <EtiquetteStatut
                  key="statut"
                  code={solde.status}
                  libelle={libelle(LIBELLES_STATUT_STOCK, solde.status)}
                />,
                formatQuantite(solde.quantityPhysical),
                formatQuantite(solde.quantityReserved),
                formatQuantite(solde.quantityBlocked),
                formatQuantite(solde.quantityQuarantine),
                formatQuantite(solde.quantityAvailable),
                formatMontant(solde.unitCost),
                formatMontant(solde.totalValue),
              ],
            }))}
            messageVide="Aucun solde de stock enregistre pour cet article dans les depots."
          />
        </Carte>

        <Carte titre="Synthese du stock">
          <ListeDefinitions
            elements={[
              { terme: "Quantite physique totale", valeur: formatQuantite(physiqueTotal) },
              { terme: "Disponible total", valeur: formatQuantite(disponibleTotal) },
              {
                terme: "Quantite en quarantaine",
                valeur: (
                  <span className="inline-flex items-center gap-2">
                    {formatQuantite(quarantaineTotal)}
                    {D.gt(quarantaineTotal, 0) && (
                      <Etiquette ton="alerte">Attente de liberation qualite</Etiquette>
                    )}
                  </span>
                ),
              },
              {
                terme: "Quantite classee en rebut",
                valeur: (
                  <span className="inline-flex items-center gap-2">
                    {formatQuantite(rebutTotal)}
                    {D.gt(rebutTotal, 0) && <Etiquette ton="danger">Rebut</Etiquette>}
                  </span>
                ),
              },
              { terme: "Valeur du stock", valeur: formatMontant(valeurTotale) },
            ]}
          />
        </Carte>

        <Carte
          titre="Nomenclature"
          description="Versions de nomenclature rattachees a cet article. La version active est celle appliquee par la production."
          sansPadding
        >
          {nomenclatures.length === 0 ? (
            <Vide
              titre="Aucune nomenclature"
              message="Cet article ne comporte aucune nomenclature : il est soit achete, soit fabrique sans composant enregistre."
            />
          ) : (
            <>
              <Tableau
                colonnes={[
                  { cle: "code", libelle: "Code" },
                  { cle: "version", libelle: "Version", nombre: true },
                  { cle: "libelle", libelle: "Libelle" },
                  { cle: "statut", libelle: "Statut" },
                  { cle: "composants", libelle: "Composants", nombre: true },
                  { cle: "cout", libelle: "Cout theorique", nombre: true },
                  { cle: "validite", libelle: "Validite" },
                ]}
                lignes={nomenclatures.map((formule) => ({
                  cle: String(formule.id),
                  cellules: [
                    formule.code,
                    String(formule.version),
                    formule.label,
                    <span key="statut" className="inline-flex flex-wrap items-center gap-1">
                      <EtiquetteStatut
                        code={formule.status}
                        libelle={libelle(LIBELLES_STATUT_NOMENCLATURE, formule.status)}
                      />
                      {formule.isDefault && <Etiquette ton="primaire">Par defaut</Etiquette>}
                    </span>,
                    String(formule._count.lines),
                    formatMontant(formule.totalCost),
                    formule.effectiveFrom
                      ? `${formatDate(formule.effectiveFrom)} au ${
                          formule.effectiveTo ? formatDate(formule.effectiveTo) : "sans echeance"
                        }`
                      : "Sans date d'effet",
                  ],
                }))}
                messageVide="Aucune nomenclature."
              />
              {nomenclatureActiveDetaillee && (
                <div className="border-t p-4">
                  <Section
                    titre={`Composants de la nomenclature active — ${nomenclatureActiveDetaillee.code} v${nomenclatureActiveDetaillee.version}`}
                  >
                    <ListeDefinitions
                      elements={[
                        {
                          terme: "Depot de destination",
                          valeur: nomenclatureActiveDetaillee.warehouseDest
                            ? `${nomenclatureActiveDetaillee.warehouseDest.code} — ${nomenclatureActiveDetaillee.warehouseDest.label}`
                            : "Non defini",
                        },
                        {
                          terme: "Quantite totale theorique",
                          valeur: formatQuantite(nomenclatureActiveDetaillee.totalQuantity),
                        },
                        {
                          terme: "Approuvee par",
                          valeur: nomenclatureActiveDetaillee.approvedBy?.email ?? "Non approuvee",
                        },
                        {
                          terme: "Date d'approbation",
                          valeur: formatDate(nomenclatureActiveDetaillee.approvedAt),
                        },
                      ]}
                    />
                    <div className="mt-4">
                      <Tableau
                        colonnes={[
                          { cle: "ligne", libelle: "Ligne", nombre: true },
                          { cle: "composant", libelle: "Composant" },
                          { cle: "quantite", libelle: "Quantite", nombre: true },
                          { cle: "unite", libelle: "Unite" },
                          { cle: "perte", libelle: "Perte prevue", nombre: true },
                          { cle: "cout", libelle: "Cout unitaire", nombre: true },
                          { cle: "total", libelle: "Cout total", nombre: true },
                        ]}
                        lignes={nomenclatureActiveDetaillee.lines.map((ligne) => ({
                          cle: String(ligne.id),
                          cellules: [
                            String(ligne.lineNo),
                            <Link
                              key="composant"
                              className="lien-nav"
                              href={`/referentiel/articles/${ligne.componentItem.id}`}
                            >
                              {ligne.componentItem.code} — {ligne.componentItem.label1}
                            </Link>,
                            formatQuantite(ligne.quantity),
                            ligne.unit?.code ?? "-",
                            formatPourcentage(ligne.lossRate),
                            formatMontant(ligne.unitCost),
                            formatMontant(ligne.totalCost),
                          ],
                        }))}
                        messageVide="La nomenclature active ne comporte aucun composant."
                      />
                    </div>
                  </Section>
                </div>
              )}
            </>
          )}
        </Carte>

        <Carte
          titre="Gammes de fabrication"
          description="Gammes operationnelles rattachees a l'article, avec le nombre d'operations reellement enregistrees."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "code", libelle: "Code" },
              { cle: "libelle", libelle: "Libelle" },
              { cle: "version", libelle: "Version", nombre: true },
              { cle: "statut", libelle: "Statut" },
              { cle: "atelier", libelle: "Atelier" },
              { cle: "operations", libelle: "Operations", nombre: true },
              { cle: "validite", libelle: "Validite" },
            ]}
            lignes={gammes.map((gamme) => ({
              cle: String(gamme.id),
              cellules: [
                gamme.code,
                <span key="libelle" className="inline-flex flex-wrap items-center gap-1">
                  {gamme.label}
                  {gamme.isDefault && <Etiquette ton="primaire">Par defaut</Etiquette>}
                </span>,
                String(gamme.version),
                <EtiquetteStatut
                  key="statut"
                  code={gamme.status}
                  libelle={libelle(LIBELLES_STATUT_GAMME, gamme.status)}
                />,
                gamme.workshop ? `${gamme.workshop.code} — ${gamme.workshop.label}` : "-",
                String(gamme._count.steps),
                gamme.effectiveFrom
                  ? `${formatDate(gamme.effectiveFrom)} au ${
                      gamme.effectiveTo ? formatDate(gamme.effectiveTo) : "sans echeance"
                    }`
                  : "Sans date d'effet",
              ],
            }))}
            messageVide="Aucune gamme de fabrication rattachee a cet article."
          />
        </Carte>

        <Carte
          titre="Lots"
          description="Lots de stock enregistres pour cet article, avec leur statut qualite et leur provenance reelle."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "lot", libelle: "Numero de lot" },
              { cle: "depot", libelle: "Depot" },
              { cle: "emplacement", libelle: "Emplacement" },
              { cle: "statut", libelle: "Statut" },
              { cle: "fabrication", libelle: "Fabrication" },
              { cle: "peremption", libelle: "Peremption" },
              { cle: "fournisseur", libelle: "Fournisseur" },
              { cle: "cout", libelle: "Cout unitaire", nombre: true },
              { cle: "blocage", libelle: "Motif de blocage" },
            ]}
            lignes={lots.map((lot) => ({
              cle: String(lot.id),
              cellules: [
                lot.lotNumber,
                lot.warehouse.code,
                lot.location?.code ?? "-",
                <EtiquetteStatut
                  key="statut"
                  code={lot.status}
                  libelle={libelle(LIBELLES_STATUT_STOCK, lot.status)}
                />,
                formatDate(lot.manufactureDate),
                formatDate(lot.expirationDate),
                lot.supplier
                  ? `${lot.supplier.code} — ${lot.supplier.label1}`
                  : lot.workOrderId
                    ? `Ordre de fabrication n° ${lot.workOrderId}`
                    : "-",
                formatMontant(lot.unitCost),
                lot.blockingReason ?? "-",
              ],
            }))}
            messageVide="Aucun lot enregistre pour cet article."
          />
        </Carte>

        {peutVoirPrix ? (
          <>
            <Carte
              titre="Prix fournisseurs"
              description="Offres d'achat reellement saisies pour cet article. Les prix ne sont jamais deduits d'une moyenne."
              sansPadding
            >
              <Tableau
                colonnes={[
                  { cle: "fournisseur", libelle: "Fournisseur" },
                  { cle: "reference", libelle: "Reference fournisseur" },
                  { cle: "prix", libelle: "Prix", nombre: true },
                  { cle: "devise", libelle: "Devise" },
                  { cle: "delai", libelle: "Delai (jours)", nombre: true },
                  { cle: "mini", libelle: "Quantite mini", nombre: true },
                  { cle: "validite", libelle: "Validite" },
                  { cle: "prefere", libelle: "Preference" },
                ]}
                lignes={prixFournisseurs.map((prix) => ({
                  cle: String(prix.id),
                  cellules: [
                    <Link
                      key="fournisseur"
                      className="lien-nav"
                      href={`/referentiel/tiers/${prix.supplier.id}`}
                    >
                      {prix.supplier.code} — {prix.supplier.label1}
                    </Link>,
                    prix.supplierRef ?? "-",
                    formatMontant(prix.price, prix.currency),
                    prix.currency,
                    String(prix.leadTimeDays),
                    formatQuantite(prix.minQuantity),
                    prix.validFrom || prix.validTo
                      ? `${formatDate(prix.validFrom)} au ${
                          prix.validTo ? formatDate(prix.validTo) : "sans echeance"
                        }`
                      : "Sans limite de validite",
                    prix.isPreferred ? (
                      <Etiquette key="prefere" ton="primaire">
                        Offre preferee
                      </Etiquette>
                    ) : (
                      "-"
                    ),
                  ],
                }))}
                messageVide="Aucun prix fournisseur enregistre pour cet article."
              />
            </Carte>

            <Carte
              titre="Tarifs de vente"
              description="Prix de vente enregistres, generaux ou propres a un client. Les lignes retirees restent visibles pour l'historique."
              sansPadding
            >
              <Tableau
                colonnes={[
                  { cle: "type", libelle: "Type de prix" },
                  { cle: "client", libelle: "Client" },
                  { cle: "prix", libelle: "Prix", nombre: true },
                  { cle: "remise", libelle: "Remise", nombre: true },
                  { cle: "validite", libelle: "Validite" },
                  { cle: "etat", libelle: "Etat" },
                ]}
                lignes={tarifsVente.map((prix) => ({
                  cle: String(prix.id),
                  cellules: [
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
                  ],
                }))}
                messageVide="Aucun tarif de vente enregistre pour cet article."
              />
            </Carte>
          </>
        ) : (
          <Alerte ton="alerte" titre="Prix non affiches">
            La consultation des prix et des tarifs exige la permission « consultation des prix
            et tarifs », que votre profil ne detient pas. Les donnees de prix restent donc
            masquees ici.
          </Alerte>
        )}

        {peutEcrire ? (
          <Carte
            titre="Modification de la fiche"
            description="Toute modification est journalisee avec son auteur et l'etat precedent de la fiche."
          >
            <FormulaireAction
              action={actionModifierArticle}
              libelleSoumettre="Enregistrer les modifications"
              varianteSoumettre="primaire"
            >
              <input type="hidden" name="articleId" value={article.id} />

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Champ nom="code" libelle="Code article" requis valeur={article.code} />
                <Champ
                  nom="codeBarres"
                  libelle="Code-barres"
                  valeur={article.barcode ?? ""}
                />
                <Champ
                  nom="reference"
                  libelle="Reference interne"
                  valeur={article.reference ?? ""}
                />
                <Champ nom="libelle1" libelle="Libelle principal" requis valeur={article.label1} />
                <Champ nom="libelle2" libelle="Libelle secondaire" valeur={article.label2 ?? ""} />
                <Champ nom="libelle3" libelle="Libelle tertiaire" valeur={article.label3 ?? ""} />
                <Champ
                  nom="designation"
                  libelle="Designation longue"
                  valeur={article.designation ?? ""}
                />
                <Champ
                  nom="type"
                  libelle="Type d'article"
                  type="select"
                  requis
                  valeur={article.type}
                  options={TYPES_ARTICLE.map((valeur) => ({
                    valeur,
                    libelle: libelle(LIBELLES_TYPE_ARTICLE, valeur),
                  }))}
                />
                <Champ
                  nom="statut"
                  libelle="Statut"
                  type="select"
                  requis
                  valeur={statutModifiable}
                  options={STATUTS_MODIFIABLES.map((valeur) => ({
                    valeur,
                    libelle: libelle(LIBELLES_STATUT_ARTICLE, valeur),
                  }))}
                  aide="L'archivage ne se fait pas ici : il dispose de sa propre action motivee."
                />
                <Champ
                  nom="division"
                  libelle="Division"
                  type="select"
                  requis
                  valeur={article.factory}
                  options={DIVISIONS.map((valeur) => ({
                    valeur,
                    libelle: libelle(LIBELLES_USINE, valeur),
                  }))}
                />
                <Champ
                  nom="familleId"
                  libelle="Famille d'articles"
                  type="select"
                  valeur={article.familyId ?? ""}
                  options={familles.map((famille) => ({
                    valeur: famille.id,
                    libelle: `${famille.code} — ${famille.label}`,
                  }))}
                />
                <Champ
                  nom="unite"
                  libelle="Unite de mesure"
                  type="select"
                  valeur={article.unitCode ?? ""}
                  options={unites.map((unite) => ({
                    valeur: unite.code,
                    libelle: `${unite.code} — ${unite.label}`,
                  }))}
                />
                <Champ
                  nom="codeTva"
                  libelle="Taux de TVA"
                  type="select"
                  valeur={article.taxRateCode ?? ""}
                  options={tauxTva.map((taux) => ({
                    valeur: taux.code,
                    libelle: `${taux.label} (${formatPourcentage(taux.rate)})`,
                  }))}
                />
              </div>

              <Section titre="Configuration">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <CaseACocher nom="achetable" libelle="Achetable" coche={article.isPurchasable} />
                  <CaseACocher nom="vendable" libelle="Vendable" coche={article.isSellable} />
                  <CaseACocher nom="fabricable" libelle="Fabricable" coche={article.isProducible} />
                  <CaseACocher nom="semiFini" libelle="Semi-fini" coche={article.isSemiFinished} />
                  <CaseACocher
                    nom="matierePremiere"
                    libelle="Matiere premiere"
                    coche={article.isRawMaterial}
                  />
                  <CaseACocher nom="mainOeuvre" libelle="Main d'oeuvre" coche={article.isMainOeuvre} />
                  <CaseACocher
                    nom="suiviParLot"
                    libelle="Suivi par lot"
                    coche={article.isBatchManaged}
                  />
                  <CaseACocher
                    nom="horsService"
                    libelle="Hors service"
                    coche={article.isOutOfService}
                  />
                  <CaseACocher
                    nom="stockNegatifAutorise"
                    libelle="Stock negatif autorise"
                    coche={article.useNegativeStock}
                  />
                </div>
              </Section>

              <Section titre="Seuils de stock">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Champ
                    nom="quantiteMin"
                    libelle="Quantite minimum"
                    type="number"
                    min={0}
                    pas="0.001"
                    valeur={article.quantityMin.toString()}
                  />
                  <Champ
                    nom="quantiteMax"
                    libelle="Quantite maximum"
                    type="number"
                    min={0}
                    pas="0.001"
                    valeur={article.quantityMax.toString()}
                  />
                  <Champ
                    nom="stockSecurite"
                    libelle="Stock de securite"
                    type="number"
                    min={0}
                    pas="0.001"
                    valeur={article.safetyStock.toString()}
                  />
                </div>
              </Section>

              <Section titre="Poids et dimensions">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Champ
                    nom="poidsUnitaire"
                    libelle="Poids unitaire (kg)"
                    type="number"
                    min={0}
                    pas="0.000001"
                    valeur={article.unitWeight.toString()}
                  />
                  <Champ
                    nom="longueur"
                    libelle="Longueur (mm)"
                    type="number"
                    min={0}
                    pas="0.000001"
                    valeur={article.length.toString()}
                  />
                  <Champ
                    nom="largeur"
                    libelle="Largeur (mm)"
                    type="number"
                    min={0}
                    pas="0.000001"
                    valeur={article.width.toString()}
                  />
                  <Champ
                    nom="hauteur"
                    libelle="Hauteur (mm)"
                    type="number"
                    min={0}
                    pas="0.000001"
                    valeur={article.height.toString()}
                  />
                  <Champ
                    nom="epaisseur"
                    libelle="Epaisseur (mm)"
                    type="number"
                    min={0}
                    pas="0.000001"
                    valeur={article.thickness.toString()}
                  />
                </div>
              </Section>
            </FormulaireAction>
          </Carte>
        ) : (
          <Alerte ton="info" titre="Fiche en lecture seule">
            Votre profil ne detient pas la permission de modification des articles : seuls la
            consultation et l&apos;historique vous sont accessibles.
          </Alerte>
        )}

        {peutArchiver && article.status !== "ARCHIVE" && (
          <Carte
            titre="Archivage"
            description="L'archivage remplace la suppression : l'article reste consultable, avec tout son historique de stock et de production."
          >
            {D.gt(physiqueTotal, 0) && (
              <div className="mb-4">
                <Alerte ton="alerte" titre="Stock encore present">
                  Cet article porte encore {formatQuantite(physiqueTotal)} unite(s) en stock.
                  L&apos;archivage ne supprime aucun stock : sortez ou transferez d&apos;abord
                  les quantites restantes, sinon elles resteront attachees a un article archive.
                </Alerte>
              </div>
            )}
            <FormulaireMotif
              action={actionArchiverArticle}
              libelleSoumettre="Archiver l'article"
              libelleMotif="Motif de l'archivage"
              varianteSoumettre="danger"
              motifMinimum={10}
              champsCaches={{ articleId: article.id }}
              placeholder="Motif obligatoire (au moins 10 caracteres) : article remplace, fin de gamme..."
            />
          </Carte>
        )}

        {article.status === "ARCHIVE" && (
          <Alerte ton="alerte" titre="Article archive">
            Cet article est archive
            {archivage ? ` depuis le ${formatDateTime(archivage.createdAt)}` : ""}
            {archivage?.reason ? ` — motif enregistre : ${archivage.reason}` : ""}. Il n&apos;est
            plus mouvemente et sa fiche n&apos;est plus modifiable ; son historique de stock et
            de production reste consultable.
          </Alerte>
        )}

        <Carte titre="Suivi de la fiche">
          <ListeDefinitions
            elements={[
              { terme: "Creee le", valeur: formatDate(article.createdAt) },
              { terme: "Derniere modification", valeur: formatDate(article.updatedAt) },
              {
                terme: "Origine des donnees",
                valeur: article.sourceSystem
                  ? `Import depuis ${article.sourceSystem}`
                  : "Saisie directe dans l'application",
              },
              {
                terme: "Identifiant interne",
                valeur: `Article n° ${article.id}`,
              },
              {
                terme: "Dernier archivage",
                valeur: archivage
                  ? `${formatDateTime(archivage.createdAt)} par ${
                      archivage.userEmail ?? "utilisateur inconnu"
                    } — motif : ${archivage.reason ?? "non renseigne"}`
                  : "Aucun archivage enregistre",
              },
            ]}
          />
        </Carte>
      </div>
    </>
  );
}
