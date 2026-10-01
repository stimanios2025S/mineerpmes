import type { Factory, MovementType, Prisma } from "@prisma/client";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { listerMouvements } from "@/lib/stock/service";
import { aLaPermission, exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fabricantLien,
  identifiantOuNull,
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
import { Champ, FormulaireAction, FormulaireMotif } from "@/components/interactif";
import { formatDateTime, formatMontant, formatQuantite } from "@/lib/format";
import { LIBELLES_STATUT_STOCK, LIBELLES_TYPE_MOUVEMENT, libelle } from "@/lib/libelles";
import {
  actionAnnulerMouvement,
  actionCorrectionStock,
  actionMouvementManuel,
} from "@/actions/stock";

export const metadata = { title: "Mouvements de stock" };

/** Tous les types du grand livre, dans l'ordre du referentiel francais. */
const TYPES_MOUVEMENT = Object.keys(LIBELLES_TYPE_MOUVEMENT) as MovementType[];

/**
 * Types proposes en saisie manuelle. Cette liste doit rester identique a celle
 * verifiee par `actionMouvementManuel` : le serveur reste seul juge.
 */
const TYPES_ENTREE_MANUELLE: readonly MovementType[] = [
  "ENTREE_INITIALE",
  "RECEPTION_FOURNISSEUR",
  "RETOUR_CLIENT",
];
const TYPES_SORTIE_MANUELLE: readonly MovementType[] = [
  "SORTIE_PRODUCTION",
  "CONSOMMATION_OPERATION",
  "LIVRAISON_CLIENT",
  "RETOUR_FOURNISSEUR",
  "PERTE",
];

/** Bornes de journee locale : la periode saisie couvre des journees entieres. */
function borneJour(valeur: string | null, fin: boolean): Date | null {
  if (!valeur) return null;
  const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur);
  if (!correspondance) return null;
  const date = fin
    ? new Date(
        Number(correspondance[1]),
        Number(correspondance[2]) - 1,
        Number(correspondance[3]),
        23,
        59,
        59,
        999,
      )
    : new Date(
        Number(correspondance[1]),
        Number(correspondance[2]) - 1,
        Number(correspondance[3]),
        0,
        0,
        0,
        0,
      );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Quantite signee : une sortie est negative dans le grand livre. */
function quantiteSignee(quantite: Prisma.Decimal): string {
  return `${quantite.isNegative() ? "-" : "+"} ${formatQuantite(quantite.abs())}`;
}

/**
 * Historique du grand livre.
 *
 * L'ecran ne recalcule rien : les mouvements viennent de `listerMouvements`,
 * qui porte deja les filtres de periode, de type, d'article et de depot. Les
 * trois operations proposees (saisie manuelle, correction, annulation) sont des
 * ecritures nouvelles : aucun mouvement valide n'est supprime.
 */
export default async function PageMouvementsStock({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.STOCK_LIRE);
  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, [
    "type",
    "depot",
    "du",
    "au",
  ]);

  const portee: Factory[] = usinesAutorisees(utilisateur);

  const type = TYPES_MOUVEMENT.find((valeur) => valeur === parametres.filtres.type) ?? null;
  const depotId = identifiantOuNull(parametres.filtres.depot);
  const du = borneJour(parametres.filtres.du, false);
  const au = borneJour(parametres.filtres.au, true);

  const liste = await listerMouvements({
    type: type ?? undefined,
    warehouseId: depotId ?? undefined,
    du: du ?? undefined,
    au: au ?? undefined,
    recherche: parametres.recherche ?? undefined,
    page: parametres.page,
    taille: parametres.taille,
  });

  const identifiants = liste.lignes.map((ligne) => ligne.id);
  const contrepassations = identifiants.length
    ? await prisma.stockMovement.findMany({
        where: {
          OR: [
            { id: { in: identifiants }, isReversal: true },
            { reversedById: { in: identifiants } },
          ],
        },
        select: {
          id: true,
          number: true,
          isReversal: true,
          reversedById: true,
          reversalOf: { select: { number: true } },
        },
      })
    : [];

  // Annulation d'un mouvement : numero du mouvement inverse, par mouvement d'origine.
  const annulations = new Map<string, string>();
  // Contrepassation : numero du mouvement d'origine, par mouvement inverse.
  const origines = new Map<string, string>();
  for (const mouvement of contrepassations) {
    if (mouvement.isReversal && mouvement.reversedById !== null) {
      origines.set(String(mouvement.id), mouvement.reversalOf?.number ?? "-");
    }
    if (mouvement.reversedById !== null) {
      annulations.set(String(mouvement.reversedById), mouvement.number);
    }
  }

  const peutSaisir = aLaPermission(utilisateur, PERMISSIONS.STOCK_MOUVEMENT_CREER);
  const peutCorriger = aLaPermission(utilisateur, PERMISSIONS.STOCK_CORRECTION);
  const peutAnnuler = aLaPermission(utilisateur, PERMISSIONS.STOCK_ANNULER_MOUVEMENT);
  const peutEcrire = peutSaisir || peutCorriger;

  // Les depots servent aussi au filtre : ils sont toujours lus. Le reste des
  // donnees de reference n'est charge que si l'utilisateur peut ecrire.
  const [depots, donneesEcriture] = await Promise.all([
    prisma.warehouse.findMany({
      where: { isActive: true, factory: { in: portee } },
      orderBy: [{ factory: "asc" }, { code: "asc" }],
      take: 500,
      select: { id: true, code: true, label: true },
    }),
    peutEcrire
      ? Promise.all([
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
        ])
      : Promise.resolve(null),
  ]);

  const [articles, emplacements, lots] = donneesEcriture ?? [
    [] as { id: number; code: string; label1: string; unitCode: string | null }[],
    [] as { id: number; code: string; warehouse: { code: string } }[],
    [] as {
      id: number;
      lotNumber: string;
      item: { code: string };
      warehouse: { code: string };
    }[],
  ];

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
  const optionsStatuts = [
    "LIBRE",
    "QUARANTAINE",
    "BLOQUE",
    "REBUT",
    "EN_COURS_PRODUCTION",
  ].map((valeur) => ({
    valeur,
    libelle: libelle(LIBELLES_STATUT_STOCK, valeur),
  }));

  const filtresCourants = {
    q: premiereValeur(parametresBruts, "q"),
    type: premiereValeur(parametresBruts, "type"),
    depot: premiereValeur(parametresBruts, "depot"),
    du: premiereValeur(parametresBruts, "du"),
    au: premiereValeur(parametresBruts, "au"),
    taille: parametres.taille,
  };

  return (
    <>
      <EnTetePage
        titre="Mouvements de stock"
        description="Grand livre des entrees et sorties : chaque ligne est une ecriture definitive. Une correction ou une annulation produit un nouveau mouvement, jamais une suppression."
      />

      {du && au && du.getTime() > au.getTime() && (
        <div className="mb-4">
          <Alerte ton="danger" titre="Periode incoherente">
            La date de debut est posterieure a la date de fin : la periode demandee
            ne peut pas etre appliquee telle quelle.
          </Alerte>
        </div>
      )}

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des mouvements de stock"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Recherche</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={parametres.recherche ?? ""}
            placeholder="Numero, document ou article"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Type</span>
          <select className="champ" name="type" defaultValue={filtresCourants.type ?? ""}>
            <option value="">Tous les types</option>
            {TYPES_MOUVEMENT.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_TYPE_MOUVEMENT, valeur)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Depot</span>
          <select className="champ" name="depot" defaultValue={filtresCourants.depot ?? ""}>
            <option value="">Tous les depots</option>
            {depots.map((depot) => (
              <option key={depot.id} value={depot.id}>
                {depot.code} — {depot.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Du</span>
          <input className="champ" type="date" name="du" defaultValue={filtresCourants.du ?? ""} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Au</span>
          <input className="champ" type="date" name="au" defaultValue={filtresCourants.au ?? ""} />
        </label>
        <button
          type="submit"
          className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
        >
          Filtrer
        </button>
      </form>

      <Carte
        titre="Ecritures du grand livre"
        description={`${liste.total} mouvement(s) correspondant aux criteres.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "numero", libelle: "Numero" },
            { cle: "date", libelle: "Date" },
            { cle: "type", libelle: "Type" },
            { cle: "article", libelle: "Article" },
            { cle: "depot", libelle: "Depot" },
            { cle: "quantite", libelle: "Quantite", nombre: true },
            { cle: "cout", libelle: "Cout unitaire", nombre: true },
            { cle: "valeur", libelle: "Valeur", nombre: true },
            { cle: "document", libelle: "Document d'origine" },
            { cle: "utilisateur", libelle: "Utilisateur" },
            { cle: "motif", libelle: "Motif / justification" },
            { cle: "etat", libelle: "Etat" },
          ]}
          lignes={liste.lignes.map((mouvement) => {
            const identifiant = String(mouvement.id);
            const annulation = annulations.get(identifiant);
            const origine = origines.get(identifiant);
            const motif = mouvement.justification ?? mouvement.reason;

            return {
              cle: identifiant,
              cellules: [
                <span key="numero" className="font-medium">
                  {mouvement.number}
                </span>,
                formatDateTime(mouvement.occurredAt),
                libelle(LIBELLES_TYPE_MOUVEMENT, mouvement.type),
                <span key="article">
                  <span className="font-medium">{mouvement.item.code}</span>
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    {mouvement.item.label1}
                    {mouvement.lot ? ` — lot ${mouvement.lot.lotNumber}` : ""}
                  </span>
                </span>,
                mouvement.warehouse.code,
                <span key="quantite" style={{ color: mouvement.quantity.isNegative() ? "var(--danger)" : "var(--succes)" }}>
                  {quantiteSignee(mouvement.quantity)}
                </span>,
                formatMontant(mouvement.unitCost),
                formatMontant(mouvement.totalCost),
                <span key="document">
                  {mouvement.documentNumber ?? "-"}
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    {mouvement.documentType ?? "sans document"}
                    {mouvement.workOrder ? ` — OF ${mouvement.workOrder.number}` : ""}
                    {mouvement.thirdParty ? ` — ${mouvement.thirdParty.label1}` : ""}
                  </span>
                </span>,
                mouvement.userEmail ?? "-",
                <span key="motif">
                  {motif ?? "-"}
                  {mouvement.comment && (
                    <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                      {mouvement.comment}
                    </span>
                  )}
                </span>,
                <span key="etat" className="flex flex-col items-start gap-1">
                  {mouvement.isReversal && (
                    <Etiquette ton="alerte" titre={`Contrepassation du mouvement ${origine ?? "-"}`}>
                      Contrepassation de {origine ?? "-"}
                    </Etiquette>
                  )}
                  {annulation && <Etiquette ton="danger">Annule par {annulation}</Etiquette>}
                  {!mouvement.isReversal && !annulation && (
                    <Etiquette ton="succes">Valide</Etiquette>
                  )}
                  {peutAnnuler && !mouvement.isReversal && !annulation && (
                    <details>
                      <summary className="lien-nav cursor-pointer text-xs">
                        Annuler ce mouvement
                      </summary>
                      <div className="mt-2 w-64">
                        <FormulaireMotif
                          action={actionAnnulerMouvement}
                          libelleSoumettre="Annuler le mouvement"
                          libelleMotif="Motif de l'annulation"
                          varianteSoumettre="danger"
                          champsCaches={{ mouvementId: identifiant }}
                        />
                      </div>
                    </details>
                  )}
                </span>,
              ],
            };
          })}
          messageVide="Aucun mouvement ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={liste.page}
          pages={liste.pages}
          total={liste.total}
          construireLien={fabricantLien("/stock/mouvements", filtresCourants)}
        />
      </Carte>

      {peutEcrire ? (
        <Section titre="Saisir une operation">
          <div className="grid gap-4 xl:grid-cols-2">
            {peutSaisir && (
              <Carte
                titre="Mouvement manuel d'entree ou de sortie"
                description="Le sens du mouvement decoule du type choisi : la quantite saisie est toujours positive. Une justification ecrite est obligatoire."
              >
                <FormulaireAction
                  action={actionMouvementManuel}
                  libelleSoumettre="Enregistrer le mouvement"
                  reinitialiser
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Champ
                      nom="type"
                      libelle="Type de mouvement"
                      type="select"
                      requis
                      options={[
                        ...TYPES_ENTREE_MANUELLE.map((valeur) => ({
                          valeur,
                          libelle: `Entree — ${libelle(LIBELLES_TYPE_MOUVEMENT, valeur)}`,
                        })),
                        ...TYPES_SORTIE_MANUELLE.map((valeur) => ({
                          valeur,
                          libelle: `Sortie — ${libelle(LIBELLES_TYPE_MOUVEMENT, valeur)}`,
                        })),
                      ]}
                    />
                    <Champ nom="itemId" libelle="Article" type="select" requis options={optionsArticles} />
                    <Champ nom="warehouseId" libelle="Depot" type="select" requis options={optionsDepots} />
                    <Champ
                      nom="locationId"
                      libelle="Emplacement"
                      type="select"
                      options={optionsEmplacements}
                      aide="Facultatif : laisser vide pour un stock sans emplacement."
                    />
                    <Champ
                      nom="lotId"
                      libelle="Lot"
                      type="select"
                      options={optionsLots}
                      aide="Facultatif : reserver aux articles suivis en lot."
                    />
                    <Champ
                      nom="status"
                      libelle="Statut qualite"
                      type="select"
                      requis
                      valeur="LIBRE"
                      options={optionsStatuts}
                      aide="Le stock en quarantaine, bloque ou rebut n'est pas consommable."
                    />
                    <Champ
                      nom="quantity"
                      libelle="Quantite"
                      type="number"
                      pas="any"
                      min="0"
                      requis
                      aide="Toujours positive : le signe est porte par le type de mouvement."
                    />
                  </div>
                  <label className="mt-3 block text-sm">
                    <span className="mb-1 block font-medium">
                      Justification<span style={{ color: "var(--danger)" }}> *</span>
                    </span>
                    <textarea
                      className="champ"
                      name="justification"
                      rows={3}
                      required
                      minLength={10}
                      placeholder="Justification obligatoire (au moins 10 caracteres)"
                    />
                  </label>
                </FormulaireAction>
              </Carte>
            )}

            {peutCorriger && (
              <Carte
                titre="Correction de stock"
                description="La correction applique un ecart signe au solde et cree un mouvement d'ajustement. Le stock n'est jamais reecrit en silence : l'ecart et son motif restent au grand livre."
              >
                <FormulaireAction
                  action={actionCorrectionStock}
                  libelleSoumettre="Enregistrer la correction"
                  varianteSoumettre="danger"
                  reinitialiser
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Champ nom="itemId" libelle="Article" type="select" requis options={optionsArticles} />
                    <Champ nom="warehouseId" libelle="Depot" type="select" requis options={optionsDepots} />
                    <Champ
                      nom="locationId"
                      libelle="Emplacement"
                      type="select"
                      options={optionsEmplacements}
                    />
                    <Champ nom="lotId" libelle="Lot" type="select" options={optionsLots} />
                    <Champ
                      nom="status"
                      libelle="Statut qualite"
                      type="select"
                      requis
                      valeur="LIBRE"
                      options={optionsStatuts}
                    />
                    <Champ
                      nom="ecart"
                      libelle="Ecart a appliquer"
                      type="number"
                      pas="any"
                      requis
                      aide="Positif pour ajouter du stock, negatif pour en retirer."
                    />
                  </div>
                  <label className="mt-3 block text-sm">
                    <span className="mb-1 block font-medium">
                      Motif de la correction<span style={{ color: "var(--danger)" }}> *</span>
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
            )}
          </div>

          <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
            Les sorties superieures au disponible sont refusees, sauf si votre profil
            porte la permission d&apos;autoriser un stock negatif. Toutes les ecritures
            sont horodatees et signees par votre compte.
          </p>
        </Section>
      ) : (
        <div className="mt-5">
          <Alerte ton="info" titre="Consultation seule">
            Votre profil consulte le grand livre sans pouvoir l&apos;alimenter. Les
            droits de saisie, de correction et d&apos;annulation sont attribues
            separement.
          </Alerte>
        </div>
      )}

      <p className="mt-4 text-xs" style={{ color: "var(--texte-doux)" }}>
        <Link className="lien-nav" href="/stock">
          Consulter l&apos;etat des stocks
        </Link>
      </p>
    </>
  );
}
