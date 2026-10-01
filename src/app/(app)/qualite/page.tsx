import Link from "next/link";
import type { Prisma, QualityDecision } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { listerControlesQualite } from "@/lib/qualite/service";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { fabricantLien, lireParametresListe, pagination } from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Pagination,
  Statistique,
  Tableau,
} from "@/components/ui";
import { Champ } from "@/components/interactif";
import { formatDateTime, formatPourcentage, formatQuantite } from "@/lib/format";
import {
  LIBELLES_DECISION_QUALITE,
  LIBELLES_RESULTAT_CONTROLE,
  libelle,
  type TonEtiquette,
} from "@/lib/libelles";

export const metadata = { title: "Controles qualite" };

/**
 * Registre des controles qualite.
 *
 * Toutes les valeurs affichees viennent de la base : aucun indicateur n'est
 * calcule dans le navigateur, et le taux de conformite est un rapport de
 * quantites issues du grand livre des controles (jamais un comptage suppose).
 */

const DECISIONS: QualityDecision[] = [
  "ACCEPTE",
  "ACCEPTE_SOUS_RESERVE",
  "QUARANTAINE",
  "REJETE",
];

const ORIGINES = [
  { valeur: "RECEPTION", libelle: "Reception fournisseur" },
  { valeur: "PRODUCTION", libelle: "Production" },
  { valeur: "CONTROLE_FINAL", libelle: "Controle final" },
] as const;

type Origine = (typeof ORIGINES)[number]["valeur"];

const TON_DECISION: Record<string, TonEtiquette> = {
  ACCEPTE: "succes",
  ACCEPTE_SOUS_RESERVE: "info",
  QUARANTAINE: "alerte",
  REJETE: "danger",
};

const JOURS_SYNTHESE = 30;

/** Convertit une date de filtre (aaaa-mm-jj) en borne de requete. */
function dateBorne(valeur: string | null, finDeJournee: boolean): Date | null {
  if (valeur === null) return null;
  const date = new Date(`${valeur}T${finDeJournee ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

type ControleAffiche = Awaited<ReturnType<typeof listerControlesQualite>>["lignes"][number];

/**
 * Le lecteur du module qualite fournit la liste de reference des controles.
 * Il n'accepte ni filtre de periode ni filtre d'origine : lorsque l'un des deux
 * est demande, la page interroge directement la table des controles, avec
 * exactement les memes garanties (filtres, tri et pagination cotes base).
 */
async function lireControles(filtres: {
  decision?: QualityDecision;
  itemId?: number;
  du: Date | null;
  au: Date | null;
  origine: Origine | null;
  page: number;
  taille: number;
}): Promise<{ lignes: ControleAffiche[]; total: number; pages: number }> {
  const avance = filtres.du !== null || filtres.au !== null || filtres.origine !== null;

  if (!avance) {
    return listerControlesQualite({
      decision: filtres.decision,
      itemId: filtres.itemId,
      page: filtres.page,
      taille: filtres.taille,
    });
  }

  const where: Prisma.QualityCheckWhereInput = {};
  if (filtres.decision) where.decision = filtres.decision;
  if (filtres.itemId) where.itemId = filtres.itemId;
  if (filtres.du || filtres.au) {
    where.checkedAt = {};
    if (filtres.du) where.checkedAt.gte = filtres.du;
    if (filtres.au) where.checkedAt.lte = filtres.au;
  }
  if (filtres.origine === "RECEPTION") where.goodsReceiptLineId = { not: null };
  if (filtres.origine === "PRODUCTION") where.workOrderId = { not: null };
  if (filtres.origine === "CONTROLE_FINAL") {
    where.workOrderId = null;
    where.goodsReceiptLineId = null;
  }

  const total = await prisma.qualityCheck.count({ where });
  const bornes = pagination(total, filtres.page, filtres.taille);

  const lignes = await prisma.qualityCheck.findMany({
    where,
    orderBy: { checkedAt: "desc" },
    skip: bornes.skip,
    take: bornes.take,
    include: {
      item: { select: { code: true, label1: true } },
      workOrder: { select: { number: true } },
      checkedBy: { select: { firstName: true, lastName: true } },
      checkpoint: { select: { code: true, label: true } },
    },
  });

  return { lignes, total, pages: bornes.pages };
}

export default async function PageControlesQualite({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.QUALITE_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, [
    "decision",
    "article",
    "origine",
    "du",
    "au",
  ]);

  const decision = DECISIONS.find((valeur) => valeur === parametres.filtres.decision);
  const articleBrut = parametres.filtres.article;
  const itemId =
    articleBrut !== null && /^\d+$/.test(articleBrut)
      ? Number.parseInt(articleBrut, 10)
      : undefined;
  const origine =
    ORIGINES.find((element) => element.valeur === parametres.filtres.origine)?.valeur ?? null;
  const du = dateBorne(parametres.filtres.du, false);
  const au = dateBorne(parametres.filtres.au, true);

  const debutSynthese = new Date(Date.now() - JOURS_SYNTHESE * 24 * 60 * 60 * 1000);

  const [liste, synthese, articles] = await Promise.all([
    lireControles({
      decision,
      itemId,
      du,
      au,
      origine,
      page: parametres.page,
      taille: parametres.taille,
    }),
    prisma.qualityCheck.aggregate({
      where: { checkedAt: { gte: debutSynthese } },
      _count: { _all: true },
      _sum: { quantityChecked: true, quantityConform: true, quantityRejected: true },
    }),
    prisma.item.findMany({
      where: { qualityChecks: { some: {} } },
      orderBy: { code: "asc" },
      take: 300,
      select: { id: true, code: true, label1: true },
    }),
  ]);

  // Ligne de reception d'origine : le lecteur de service ne la porte pas, elle
  // est donc lue ici pour les seules lignes affichees.
  const identifiantsLignes = liste.lignes
    .map((controle) => controle.goodsReceiptLineId)
    .filter((identifiant): identifiant is number => identifiant !== null);

  const lignesReception = identifiantsLignes.length
    ? await prisma.goodsReceiptLine.findMany({
        where: { id: { in: identifiantsLignes } },
        select: {
          id: true,
          lineNo: true,
          lotNumber: true,
          receipt: {
            select: { id: true, number: true, receiptDate: true, supplier: { select: { code: true } } },
          },
        },
      })
    : [];

  const receptionsParLigne = new Map(lignesReception.map((ligne) => [ligne.id, ligne]));

  const nombreControles = synthese._count._all ?? 0;
  const quantiteControlee = D.of(synthese._sum.quantityChecked ?? 0);
  const quantiteConforme = D.of(synthese._sum.quantityConform ?? 0);
  const quantiteRejetee = D.of(synthese._sum.quantityRejected ?? 0);
  const tauxConformite = D.percent(quantiteConforme, quantiteControlee);

  const filtresCourants = {
    decision: parametres.filtres.decision,
    article: parametres.filtres.article,
    origine: parametres.filtres.origine,
    du: parametres.filtres.du,
    au: parametres.filtres.au,
  };

  return (
    <>
      <EnTetePage
        titre="Controles qualite"
        description="Tout controle est enregistre avec sa quantite controlee, sa quantite conforme, sa quantite rejetee et la decision prise. Une marchandise non acceptee reste indisponible."
        actions={
          <span className="flex flex-wrap items-center gap-3">
            <Link className="lien-nav text-sm" href="/qualite/controles/nouveau">
              Nouveau controle
            </Link>
            <Link className="lien-nav text-sm" href="/qualite/non-conformites">
              Non-conformites
            </Link>
            <Link className="lien-nav text-sm" href="/qualite/a-liberer">
              Articles a liberer
            </Link>
            <Link className="lien-nav text-sm" href="/qualite/plans">
              Plans de controle
            </Link>
          </span>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Statistique
          libelle={`Taux de conformite (${JOURS_SYNTHESE} jours)`}
          valeur={formatPourcentage(tauxConformite)}
          detail={`${formatQuantite(quantiteConforme)} conforme(s) sur ${formatQuantite(quantiteControlee)} controlee(s)`}
          ton={D.gte(tauxConformite, 95) ? "succes" : D.gte(tauxConformite, 80) ? "alerte" : "danger"}
        />
        <Statistique
          libelle={`Controles enregistres (${JOURS_SYNTHESE} jours)`}
          valeur={nombreControles}
          detail="Tous resultats et toutes decisions confondus"
        />
        <Statistique
          libelle={`Quantite rejetee (${JOURS_SYNTHESE} jours)`}
          valeur={formatQuantite(quantiteRejetee)}
          detail="Quantites ecartees par une decision qualite"
          ton={D.gt(quantiteRejetee, 0) ? "alerte" : "succes"}
        />
      </div>

      <div className="mb-5">
        <Carte titre="Filtres" description="Periode, decision, article et origine du controle.">
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <Champ
              nom="du"
              libelle="Du"
              type="date"
              valeur={parametres.filtres.du}
              aide="Date du controle (incluse)."
            />
            <Champ
              nom="au"
              libelle="Au"
              type="date"
              valeur={parametres.filtres.au}
              aide="Date du controle (incluse)."
            />
            <Champ
              nom="decision"
              libelle="Decision"
              type="select"
              valeur={parametres.filtres.decision}
              options={DECISIONS.map((valeur) => ({
                valeur,
                libelle: libelle(LIBELLES_DECISION_QUALITE, valeur),
              }))}
            />
            <Champ
              nom="article"
              libelle="Article"
              type="select"
              valeur={parametres.filtres.article}
              options={articles.map((article) => ({
                valeur: article.id,
                libelle: `${article.code} — ${article.label1}`,
              }))}
            />
            <Champ
              nom="origine"
              libelle="Origine"
              type="select"
              valeur={parametres.filtres.origine}
              options={ORIGINES.map((element) => ({
                valeur: element.valeur,
                libelle: element.libelle,
              }))}
            />
            <div className="flex items-end gap-3">
              <button
                type="submit"
                className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
              >
                Filtrer
              </button>
              <Link className="lien-nav text-sm" href="/qualite">
                Reinitialiser
              </Link>
            </div>
          </form>
        </Carte>
      </div>

      {(du === null) !== (au === null) && (
        <div className="mb-5">
          <Alerte ton="info" titre="Periode partiellement renseignee">
            Une seule borne de date est renseignee : les controles sont filtres a partir de cette
            borne, sans limite de l&apos;autre cote.
          </Alerte>
        </div>
      )}

      <Carte
        titre="Controles enregistres"
        description={`${liste.total} controle(s) correspondant aux criteres, du plus recent au plus ancien.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "numero", libelle: "Numero" },
            { cle: "date", libelle: "Date" },
            { cle: "article", libelle: "Article" },
            { cle: "origine", libelle: "Origine" },
            { cle: "controlee", libelle: "Controlee", nombre: true },
            { cle: "conforme", libelle: "Conforme", nombre: true },
            { cle: "rejetee", libelle: "Rejetee", nombre: true },
            { cle: "resultat", libelle: "Resultat" },
            { cle: "decision", libelle: "Decision" },
            { cle: "controleur", libelle: "Controleur" },
            { cle: "commentaire", libelle: "Commentaire" },
          ]}
          lignes={liste.lignes.map((controle) => {
            const ligneReception =
              controle.goodsReceiptLineId === null
                ? null
                : (receptionsParLigne.get(controle.goodsReceiptLineId) ?? null);

            const origineControle =
              ligneReception !== null
                ? "Reception fournisseur"
                : controle.workOrderId !== null
                  ? "Production"
                  : "Controle final";

            return {
              cle: String(controle.id),
              cellules: [
                controle.number,
                formatDateTime(controle.checkedAt),
                controle.item
                  ? `${controle.item.code} — ${controle.item.label1}`
                  : "Article non renseigne",
                <span key="origine" className="inline-flex flex-col gap-1">
                  <span>{origineControle}</span>
                  {ligneReception ? (
                    <Link
                      key="reception"
                      className="lien-nav text-xs"
                      href={`/achats/receptions/${ligneReception.receipt.id}`}
                    >
                      {ligneReception.receipt.number} — ligne {ligneReception.lineNo}
                      {ligneReception.lotNumber ? ` (lot ${ligneReception.lotNumber})` : ""}
                    </Link>
                  ) : controle.workOrder ? (
                    <span key="ordre" className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      Ordre {controle.workOrder.number}
                    </span>
                  ) : null}
                  {controle.checkpoint && (
                    <span key="point" className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      Point {controle.checkpoint.code} — {controle.checkpoint.label}
                    </span>
                  )}
                </span>,
                formatQuantite(controle.quantityChecked),
                formatQuantite(controle.quantityConform),
                formatQuantite(controle.quantityRejected),
                <EtiquetteStatut
                  key="resultat"
                  code={controle.result}
                  libelle={libelle(LIBELLES_RESULTAT_CONTROLE, controle.result)}
                />,
                <Etiquette key="decision" ton={TON_DECISION[controle.decision] ?? "neutre"}>
                  {libelle(LIBELLES_DECISION_QUALITE, controle.decision)}
                </Etiquette>,
                controle.checkedBy
                  ? `${controle.checkedBy.firstName} ${controle.checkedBy.lastName}`
                  : "Non renseigne",
                controle.comment ?? "-",
              ],
            };
          })}
          messageVide="Aucun controle qualite ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={Math.min(parametres.page, liste.pages)}
          pages={liste.pages}
          total={liste.total}
          construireLien={fabricantLien("/qualite", filtresCourants)}
        />
      </Carte>
    </>
  );
}
