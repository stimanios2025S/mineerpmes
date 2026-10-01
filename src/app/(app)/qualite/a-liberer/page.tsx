import Link from "next/link";
import type { Prisma, QualityCheckResult, QualityDecision, StockStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { stocksEnAttenteQualite } from "@/lib/qualite/service";
import { actionLibererArticle } from "@/actions/qualite";
import { aLaPermission, exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { CLE_PARAMETRE, lireParametreBooleen } from "@/lib/settings";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Section,
  Statistique,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatDate, formatDateTime, formatQuantite } from "@/lib/format";
import {
  LIBELLES_DECISION_QUALITE,
  LIBELLES_RESULTAT_CONTROLE,
  LIBELLES_STATUT_STOCK,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Articles a liberer" };

/**
 * Marchandise bloquee en attente de la decision qualite.
 *
 * La liste provient du lecteur `stocksEnAttenteQualite` : uniquement des soldes
 * de stock reellement detenus en quarantaine ou bloques. Aucun stock n'est
 * ecrit ici : chaque liberation passe par l'action serveur, qui enregistre le
 * mouvement dans le grand livre de stock.
 */

const ORIGINES: Record<"PRODUCTION" | "RECEPTION", string> = {
  PRODUCTION: "Production",
  RECEPTION: "Reception fournisseur",
};

const DECISIONS_RECEPTION: QualityDecision[] = [
  "ACCEPTE",
  "ACCEPTE_SOUS_RESERVE",
  "QUARANTAINE",
  "REJETE",
];

const DECISIONS_PRODUCTION: QualityDecision[] = ["ACCEPTE", "ACCEPTE_SOUS_RESERVE", "REJETE"];

type LigneBloquee = {
  cle: string;
  itemId: number;
  article: string;
  lotNumero: string | null;
  lotId: number | null;
  depotId: number;
  depot: string;
  quantite: Prisma.Decimal;
  statut: StockStatus;
  origine: "PRODUCTION" | "RECEPTION" | null;
  ordreId: number | null;
  ordreNumero: string | null;
  conformeDisponible: Prisma.Decimal | null;
  ligneReceptionId: number | null;
  receptionNumero: string | null;
  tiers: string | null;
  entreeEnQuarantaine: Date | null;
  motifBlocage: string | null;
  controle: {
    number: string;
    checkedAt: Date;
    result: QualityCheckResult;
    decision: QualityDecision;
  } | null;
};

/**
 * Formulaire de liberation d'une ligne de stock bloquee.
 *
 * Les champs caches designent la marchandise d'origine : la ligne de reception
 * d'un cote, l'ordre de fabrication et le lot de l'autre. Le serveur revalide
 * ces identifiants et refuse toute liberation portant sur une autre quantite
 * que celle reellement detenue.
 */
function FormulaireLiberation({
  ligne,
  peutLiberer,
}: {
  ligne: LigneBloquee;
  peutLiberer: boolean;
}) {
  if (!peutLiberer) {
    return (
      <span className="text-xs" style={{ color: "var(--texte-doux)" }}>
        Permission de liberation requise
      </span>
    );
  }

  if (ligne.origine === null) {
    return (
      <span className="text-xs" style={{ color: "var(--texte-doux)" }}>
        Origine indeterminee : ni ordre de fabrication, ni ligne de reception identifiable. La
        liberation ne peut pas etre engagee depuis cet ecran.
      </span>
    );
  }

  if (ligne.origine === "PRODUCTION" && (ligne.ordreId === null || ligne.lotId === null)) {
    return (
      <span className="text-xs" style={{ color: "var(--texte-doux)" }}>
        Lot ou ordre de fabrication incomplet : la liberation d&apos;un produit fini exige les
        deux.
      </span>
    );
  }

  const conformeParDefaut =
    ligne.origine === "PRODUCTION"
      ? D.toFixed(ligne.conformeDisponible ?? ligne.quantite, 3)
      : D.toFixed(ligne.quantite, 3);

  return (
    <details className="min-w-[16rem]">
      <summary className="cursor-pointer text-sm font-semibold">Liberer</summary>
      <div className="mt-3">
        <FormulaireAction
          action={actionLibererArticle}
          libelleSoumettre="Enregistrer la liberation"
          varianteSoumettre="primaire"
          reinitialiser
        >
          <input type="hidden" name="origine" value={ligne.origine} />
          {ligne.origine === "PRODUCTION" ? (
            <>
              <input type="hidden" name="ordreId" value={ligne.ordreId ?? ""} />
              <input type="hidden" name="depotId" value={ligne.depotId} />
              <input type="hidden" name="lotId" value={ligne.lotId ?? ""} />
            </>
          ) : (
            <>
              <input
                type="hidden"
                name="ligneReceptionId"
                value={ligne.ligneReceptionId ?? ""}
              />
              <input
                type="hidden"
                name="quantiteControlee"
                value={D.toFixed(ligne.quantite, 6)}
              />
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Champ
              nom="quantiteConforme"
              libelle="Quantite conforme liberee"
              type="number"
              pas="0.001"
              min="0"
              requis
              valeur={conformeParDefaut}
            />
            <Champ
              nom="quantiteRejetee"
              libelle="Quantite rejetee"
              type="number"
              pas="0.001"
              min="0"
              valeur="0"
              aide="Mise au rebut : le mouvement de stock correspondant est enregistre par le serveur."
            />
            <Champ
              nom="decision"
              libelle="Decision qualite"
              type="select"
              requis
              valeur="ACCEPTE"
              options={(ligne.origine === "PRODUCTION"
                ? DECISIONS_PRODUCTION
                : DECISIONS_RECEPTION
              ).map((valeur) => ({
                valeur,
                libelle: libelle(LIBELLES_DECISION_QUALITE, valeur),
              }))}
            />
          </div>
          <div className="mt-3">
            <Champ
              nom="commentaire"
              libelle="Commentaire de liberation"
              type="textarea"
              requis
              maxLength={1000}
              aide="Obligatoire, au moins 10 caracteres : il justifie la decision et reste dans l'historique."
            />
          </div>
        </FormulaireAction>
      </div>
    </details>
  );
}

export default async function PageArticlesALiberer() {
  const utilisateur = await exigerPermission(PERMISSIONS.QUALITE_LIRE);
  const peutLiberer = aLaPermission(utilisateur, PERMISSIONS.QUALITE_LIBERER);

  const [liberationObligatoire, controleReceptionObligatoire, soldes] = await Promise.all([
    lireParametreBooleen(CLE_PARAMETRE.QUALITE_LIBERATION_OBLIGATOIRE, true),
    lireParametreBooleen(CLE_PARAMETRE.QUALITE_CONTROLE_RECEPTION_OBLIGATOIRE, true),
    stocksEnAttenteQualite(),
  ]);

  const itemIds = [...new Set(soldes.map((solde) => solde.itemId))];
  const lotIds = [
    ...new Set(
      soldes
        .map((solde) => solde.lotId)
        .filter((identifiant): identifiant is number => identifiant !== null),
    ),
  ];
  const numerosDeLot = [
    ...new Set(
      soldes
        .map((solde) => solde.lot?.lotNumber)
        .filter((numero): numero is string => typeof numero === "string" && numero.length > 0),
    ),
  ];

  // Deux rattachements possibles pour une marchandise bloquee : un lot de
  // production porte par un ordre de fabrication, ou une ligne de reception
  // fournisseur. Les deux sont resolus par des requetes bornees aux references
  // affichees.
  const [lots, lignesReception] = await Promise.all([
    lotIds.length === 0
      ? Promise.resolve([])
      : prisma.stockLot.findMany({
          where: { id: { in: lotIds } },
          select: {
            id: true,
            lotNumber: true,
            receivedAt: true,
            blockingReason: true,
            workOrderId: true,
            workOrder: {
              select: {
                id: true,
                number: true,
                qualityReleasedAt: true,
                quantityConform: true,
                quantityScrapped: true,
              },
            },
            supplier: { select: { code: true, label1: true } },
          },
        }),
    itemIds.length === 0 || numerosDeLot.length === 0
      ? Promise.resolve([])
      : prisma.goodsReceiptLine.findMany({
          where: {
            itemId: { in: itemIds },
            lotNumber: { in: numerosDeLot },
            qualityStatus: { in: ["QUARANTAINE", "BLOQUE"] },
          },
          orderBy: { id: "desc" },
          take: 400,
          select: {
            id: true,
            itemId: true,
            lotNumber: true,
            quantityReceived: true,
            qualityStatus: true,
            receipt: {
              select: {
                id: true,
                number: true,
                receiptDate: true,
                warehouseId: true,
                supplier: { select: { code: true, label1: true } },
              },
            },
          },
        }),
  ]);

  const lotParId = new Map(lots.map((lot) => [lot.id, lot]));
  const receptionParCle = new Map<string, (typeof lignesReception)[number]>();
  for (const ligne of lignesReception) {
    const cle = `${ligne.itemId}|${ligne.lotNumber}|${ligne.receipt.warehouseId}`;
    if (!receptionParCle.has(cle)) receptionParCle.set(cle, ligne);
  }

  const ordreIds = [
    ...new Set(
      lots
        .map((lot) => lot.workOrderId)
        .filter((identifiant): identifiant is number => identifiant !== null),
    ),
  ];
  const ligneReceptionIds = lignesReception.map((ligne) => ligne.id);

  // Date d'entree en quarantaine : derniere entree en stock enregistree avec
  // ce statut dans le grand livre. Aucune date n'est supposee : sans mouvement,
  // la colonne reste vide.
  const [entreesQuarantaine, controles] = await Promise.all([
    itemIds.length === 0
      ? Promise.resolve([])
      : prisma.stockMovement.groupBy({
          by: ["itemId", "warehouseId", "lotId"],
          where: { status: "QUARANTAINE", itemId: { in: itemIds } },
          _max: { occurredAt: true },
        }),
    ordreIds.length === 0 && ligneReceptionIds.length === 0
      ? Promise.resolve([])
      : prisma.qualityCheck.findMany({
          where: {
            OR: [
              { workOrderId: { in: ordreIds } },
              { goodsReceiptLineId: { in: ligneReceptionIds } },
            ],
          },
          orderBy: { checkedAt: "desc" },
          take: 200,
          select: {
            number: true,
            checkedAt: true,
            result: true,
            decision: true,
            workOrderId: true,
            goodsReceiptLineId: true,
          },
        }),
  ]);

  const entreeParCle = new Map(
    entreesQuarantaine.map((entree) => [
      `${entree.itemId}|${entree.warehouseId}|${entree.lotId ?? ""}`,
      entree._max.occurredAt,
    ]),
  );

  const controleParOrdre = new Map<number, (typeof controles)[number]>();
  const controleParLigne = new Map<number, (typeof controles)[number]>();
  for (const controle of controles) {
    if (controle.workOrderId !== null && !controleParOrdre.has(controle.workOrderId)) {
      controleParOrdre.set(controle.workOrderId, controle);
    }
    if (controle.goodsReceiptLineId !== null && !controleParLigne.has(controle.goodsReceiptLineId)) {
      controleParLigne.set(controle.goodsReceiptLineId, controle);
    }
  }

  const lignes: LigneBloquee[] = soldes.map((solde) => {
    const lot = solde.lotId === null ? null : (lotParId.get(solde.lotId) ?? null);
    const reception =
      lot === null
        ? null
        : (receptionParCle.get(`${solde.itemId}|${lot.lotNumber}|${solde.warehouseId}`) ?? null);

    const origine: "PRODUCTION" | "RECEPTION" | null =
      lot !== null && lot.workOrderId !== null
        ? "PRODUCTION"
        : reception !== null
          ? "RECEPTION"
          : null;

    const controle =
      origine === "PRODUCTION" && lot?.workOrderId != null
        ? (controleParOrdre.get(lot.workOrderId) ?? null)
        : origine === "RECEPTION" && reception !== null
          ? (controleParLigne.get(reception.id) ?? null)
          : null;

    const conformeDisponible =
      lot?.workOrder != null
        ? D.sub(lot.workOrder.quantityConform, lot.workOrder.quantityScrapped)
        : null;

    return {
      cle: String(solde.id),
      itemId: solde.itemId,
      article: `${solde.item.code} — ${solde.item.label1}`,
      lotNumero: lot?.lotNumber ?? solde.lot?.lotNumber ?? null,
      lotId: solde.lotId,
      depotId: solde.warehouseId,
      depot: `${solde.warehouse.code} — ${solde.warehouse.label}`,
      quantite: D.of(solde.quantityPhysical),
      statut: solde.status,
      origine,
      ordreId: lot?.workOrder?.id ?? null,
      ordreNumero: lot?.workOrder?.number ?? null,
      conformeDisponible,
      ligneReceptionId: reception?.id ?? null,
      receptionNumero: reception?.receipt.number ?? null,
      tiers: lot?.supplier
        ? `${lot.supplier.code} — ${lot.supplier.label1}`
        : reception?.receipt.supplier
          ? `${reception.receipt.supplier.code} — ${reception.receipt.supplier.label1}`
          : null,
      entreeEnQuarantaine:
        entreeParCle.get(`${solde.itemId}|${solde.warehouseId}|${solde.lotId ?? ""}`) ?? null,
      motifBlocage: lot?.blockingReason ?? null,
      controle: controle
        ? {
            number: controle.number,
            checkedAt: controle.checkedAt,
            result: controle.result,
            decision: controle.decision,
          }
        : null,
    };
  });

  const quantiteTotale = D.sum(lignes.map((ligne) => ligne.quantite));
  const quantiteQuarantaine = D.sum(
    lignes.filter((ligne) => ligne.statut === "QUARANTAINE").map((ligne) => ligne.quantite),
  );
  const quantiteBloquee = D.sum(
    lignes.filter((ligne) => ligne.statut === "BLOQUE").map((ligne) => ligne.quantite),
  );

  return (
    <>
      <EnTetePage
        titre="Articles a liberer"
        description="Marchandise detenue en quarantaine ou bloquee, en attente de la decision qualite. Tant qu'elle n'est pas liberee, elle n'est ni consommable ni vendable."
        actions={
          <span className="flex flex-wrap items-center gap-3">
            <Link className="lien-nav text-sm" href="/qualite">
              Controles qualite
            </Link>
            <Link className="lien-nav text-sm" href="/qualite/non-conformites">
              Non-conformites
            </Link>
          </span>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique
          libelle="Lignes de stock bloquees"
          valeur={lignes.length}
          detail="Par article, depot et lot"
        />
        <Statistique
          libelle="Quantite totale bloquee"
          valeur={formatQuantite(quantiteTotale)}
          detail="Toutes origines confondues"
          ton={lignes.length > 0 ? "alerte" : "succes"}
        />
        <Statistique
          libelle="Dont en quarantaine"
          valeur={formatQuantite(quantiteQuarantaine)}
          detail="Marchandise non liberee"
        />
        <Statistique
          libelle="Dont bloquee"
          valeur={formatQuantite(quantiteBloquee)}
          detail="Blocage independant de la quarantaine"
        />
      </div>

      <div className="mb-5 space-y-4">
        <Alerte
          ton={liberationObligatoire ? "alerte" : "info"}
          titre={
            liberationObligatoire
              ? "La liberation par la qualite est obligatoire dans les parametres"
              : "La liberation par la qualite n'est pas rendue obligatoire dans les parametres"
          }
        >
          {liberationObligatoire
            ? "Un produit fini ne devient vendable qu'apres sa liberation par la qualite. Sans cette liberation, il reste hors des quantites disponibles a la vente."
            : "Le parametre actuel n'impose pas la liberation qualite avant la mise a disposition. La marchandise presente sur cet ecran reste toutefois bloquee : elle ne peut pas sortir tant qu'elle n'est pas liberee."}
        </Alerte>
        <Alerte ton="info" titre="Une sortie de quarantaine est refusee par le systeme">
          Le stock en quarantaine ne peut pas etre consomme, transfere ni livre : le grand livre de
          stock refuse ces mouvements. Seule une liberation (ou une mise au rebut) enregistree par
          la qualite fait changer le statut du lot.
        </Alerte>
        {!controleReceptionObligatoire && (
          <Alerte ton="info" titre="Controle a la reception non obligatoire">
            Le parametre n'impose pas le controle qualite systematique des receptions fournisseur :
            les lignes presentes ici proviennent des receptions pour lesquelles le controle a ete
            demande.
          </Alerte>
        )}
        {soldes.length >= 200 && (
          <Alerte ton="info" titre="Liste bornee">
            L&apos;ecran affiche les 200 premieres lignes bloquees, les plus recemment mises a jour.
            Liberez-les ou filtrez votre travail depuis les non-conformites pour voir la suite.
          </Alerte>
        )}
      </div>

      <Carte
        titre="Marchandise en attente de decision"
        description={`${lignes.length} ligne(s). La quantite affichee est la quantite physiquement detenue.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "article", libelle: "Article" },
            { cle: "lot", libelle: "Lot" },
            { cle: "depot", libelle: "Depot" },
            { cle: "quantite", libelle: "Quantite", nombre: true },
            { cle: "statut", libelle: "Statut" },
            { cle: "origine", libelle: "Origine" },
            { cle: "ordre", libelle: "Ordre de fabrication" },
            { cle: "reception", libelle: "Reception" },
            { cle: "tiers", libelle: "Fournisseur" },
            { cle: "entree", libelle: "Entree en quarantaine" },
            { cle: "controle", libelle: "Controle eventuel" },
            { cle: "action", libelle: "Liberation" },
          ]}
          lignes={lignes.map((ligne) => ({
            cle: ligne.cle,
            cellules: [
              <span key="article">
                {ligne.article}
                {ligne.motifBlocage && (
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    Motif de blocage : {ligne.motifBlocage}
                  </span>
                )}
              </span>,
              ligne.lotNumero ?? "Sans lot",
              ligne.depot,
              formatQuantite(ligne.quantite),
              <EtiquetteStatut
                key="statut"
                code={ligne.statut}
                libelle={libelle(LIBELLES_STATUT_STOCK, ligne.statut)}
              />,
              ligne.origine === null ? (
                <span key="origine" style={{ color: "var(--texte-doux)" }}>
                  Indeterminee
                </span>
              ) : (
                ORIGINES[ligne.origine]
              ),
              ligne.ordreNumero ? (
                <span key="ordre">
                  <Link className="lien-nav" href={`/production/${ligne.ordreId}`}>
                    {ligne.ordreNumero}
                  </Link>
                  {ligne.conformeDisponible && (
                    <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                      Conforme disponible : {formatQuantite(ligne.conformeDisponible)}
                    </span>
                  )}
                </span>
              ) : (
                "-"
              ),
              ligne.receptionNumero ?? "-",
              ligne.tiers ?? "-",
              ligne.entreeEnQuarantaine ? (
                formatDate(ligne.entreeEnQuarantaine)
              ) : (
                <span key="entree" style={{ color: "var(--texte-doux)" }}>
                  Non tracee
                </span>
              ),
              ligne.controle ? (
                <span key="controle">
                  {ligne.controle.number}
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    {formatDateTime(ligne.controle.checkedAt)} —{" "}
                    {libelle(LIBELLES_RESULTAT_CONTROLE, ligne.controle.result)} /{" "}
                    {libelle(LIBELLES_DECISION_QUALITE, ligne.controle.decision)}
                  </span>
                </span>
              ) : (
                <span key="controle" style={{ color: "var(--texte-doux)" }}>
                  Aucun controle
                </span>
              ),
              <FormulaireLiberation key="action" ligne={ligne} peutLiberer={peutLiberer} />,
            ],
          }))}
          messageVide="Aucune marchandise bloquee : aucun lot n'est en quarantaine et aucune quantite n'est bloquee."
        />
      </Carte>

      <Section titre="Regles appliquees par le serveur">
        <Carte>
          <ul className="list-disc pl-5 text-sm" style={{ color: "var(--texte-doux)" }}>
            <li>
              Une liberation, meme partielle, exige la quantite conforme liberee, la quantite
              rejetee et un commentaire ecrit d&apos;au moins 10 caracteres.
            </li>
            <li>
              Une decision de rejet ne peut pas liberer de quantite conforme : declarez la quantite
              rejetee, qui est mise au rebut par le grand livre de stock.
            </li>
            <li>
              Une liberation de produit fini exige que l&apos;ordre de fabrication ne soit pas
              deja libere, et que la quantite demandee ne depasse pas la quantite conforme restante
              apres rebut.
            </li>
            <li>
              Toute liberation est journalisee avec son auteur, sa decision et son commentaire ;
              aucune quantite contradictoire n&apos;est arbitree silencieusement.
            </li>
          </ul>
          <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
            <Etiquette ton="info">Rappel</Etiquette> Aucune ecriture directe sur les stocks
            n&apos;est possible depuis cet ecran : les mouvements sont enregistres par le service
            qualite, qui alimente le grand livre de stock.
          </p>
        </Carte>
      </Section>
    </>
  );
}
