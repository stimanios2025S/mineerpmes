import Link from "next/link";
import type { NonConformitySource, NonConformityStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { listerNonConformites } from "@/lib/qualite/service";
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
import { formatDate, formatDateTime, formatMontant, formatQuantite } from "@/lib/format";
import {
  LIBELLES_SOURCE_NON_CONFORMITE,
  LIBELLES_STATUT_NON_CONFORMITE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Non-conformites" };

/**
 * Registre des non-conformites.
 *
 * Une non-conformite n'est jamais un simple compteur : elle porte l'article,
 * l'ordre de fabrication, la quantite concernee, le detecteur, le responsable
 * assigne et le cout estime. Aucune fiche n'est supprimee : une fiche close ou
 * rejetee reste consultable.
 */

const STATUTS: NonConformityStatus[] = [
  "OUVERTE",
  "EN_ANALYSE",
  "EN_REPRISE",
  "RESOLUE",
  "CLOTUREE",
  "REJETEE",
];

const SOURCES: NonConformitySource[] = [
  "RECEPTION",
  "PRODUCTION",
  "CONTROLE_FINAL",
  "CLIENT",
  "INVENTAIRE",
];

const STATUTS_EN_COURS: NonConformityStatus[] = ["OUVERTE", "EN_ANALYSE", "EN_REPRISE"];

/** Convertit une date de filtre (aaaa-mm-jj) en borne de requete. */
function dateBorne(valeur: string | null, finDeJournee: boolean): Date | null {
  if (valeur === null) return null;
  const date = new Date(`${valeur}T${finDeJournee ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

type NonConformiteAffichee = Awaited<
  ReturnType<typeof listerNonConformites>
>["lignes"][number];

/**
 * Le lecteur du module qualite porte les filtres de statut et d'origine mais
 * pas celui de periode : lorsque des bornes de date sont demandees, la page
 * interroge directement la table des non-conformites, avec les memes garanties
 * (filtres, tri et pagination cotes base).
 */
async function lireNonConformites(filtres: {
  statut?: NonConformityStatus;
  source?: NonConformitySource;
  du: Date | null;
  au: Date | null;
  page: number;
  taille: number;
}): Promise<{ lignes: NonConformiteAffichee[]; total: number; pages: number }> {
  if (filtres.du === null && filtres.au === null) {
    return listerNonConformites({
      statut: filtres.statut,
      source: filtres.source,
      page: filtres.page,
      taille: filtres.taille,
    });
  }

  const where: Prisma.NonConformityWhereInput = {};
  if (filtres.statut) where.status = filtres.statut;
  if (filtres.source) where.source = filtres.source;
  where.detectedAt = {};
  if (filtres.du) where.detectedAt.gte = filtres.du;
  if (filtres.au) where.detectedAt.lte = filtres.au;

  const total = await prisma.nonConformity.count({ where });
  const bornes = pagination(total, filtres.page, filtres.taille);

  const lignes = await prisma.nonConformity.findMany({
    where,
    orderBy: { detectedAt: "desc" },
    skip: bornes.skip,
    take: bornes.take,
    include: {
      item: { select: { code: true, label1: true } },
      workOrder: { select: { number: true } },
      detectedBy: { select: { firstName: true, lastName: true } },
      assignedTo: { select: { firstName: true, lastName: true } },
    },
  });

  return { lignes, total, pages: bornes.pages };
}

export default async function PageNonConformites({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.QUALITE_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["statut", "origine", "du", "au"]);

  const statut = STATUTS.find((valeur) => valeur === parametres.filtres.statut);
  const source = SOURCES.find((valeur) => valeur === parametres.filtres.origine);
  const du = dateBorne(parametres.filtres.du, false);
  const au = dateBorne(parametres.filtres.au, true);

  // Criteres communs a la liste et aux indicateurs : ils sont construits une
  // seule fois pour que les deux restent strictement coherents.
  const where: Prisma.NonConformityWhereInput = {};
  if (statut) where.status = statut;
  if (source) where.source = source;
  if (du || au) {
    where.detectedAt = {};
    if (du) where.detectedAt.gte = du;
    if (au) where.detectedAt.lte = au;
  }

  const [liste, enCours, cours] = await Promise.all([
    lireNonConformites({
      statut,
      source,
      du,
      au,
      page: parametres.page,
      taille: parametres.taille,
    }),
    prisma.nonConformity.count({
      where: { ...where, status: { in: STATUTS_EN_COURS } },
    }),
    prisma.nonConformity.aggregate({
      where,
      _sum: { costImpact: true },
    }),
  ]);

  const coutEstime = D.of(cours._sum.costImpact ?? 0);

  const filtresCourants = {
    statut: parametres.filtres.statut,
    origine: parametres.filtres.origine,
    du: parametres.filtres.du,
    au: parametres.filtres.au,
  };

  return (
    <>
      <EnTetePage
        titre="Non-conformites"
        description="Ecart constate a la reception, en production, au controle final, chez le client ou lors d'un inventaire. Chaque fiche porte sa cause, son action corrective et sa decision qualite."
        actions={
          <span className="flex flex-wrap items-center gap-3">
            <Link className="lien-nav text-sm" href="/qualite/non-conformites/nouvelle">
              Ouvrir une fiche
            </Link>
            <Link className="lien-nav text-sm" href="/qualite">
              Controles qualite
            </Link>
          </span>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Statistique
          libelle="Fiches correspondant aux criteres"
          valeur={liste.total}
          detail="Toutes situations confondues"
        />
        <Statistique
          libelle="Fiches en cours de traitement"
          valeur={enCours}
          detail="Ouvertes, en analyse ou en reprise"
          ton={enCours > 0 ? "alerte" : "succes"}
        />
        <Statistique
          libelle="Cout estime cumule"
          valeur={formatMontant(coutEstime)}
          detail="Somme des couts saisis sur les fiches filtrees"
        />
      </div>

      <div className="mb-5">
        <Carte titre="Filtres" description="Statut, origine et periode de detection.">
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Champ
              nom="statut"
              libelle="Statut"
              type="select"
              valeur={parametres.filtres.statut}
              options={STATUTS.map((valeur) => ({
                valeur,
                libelle: libelle(LIBELLES_STATUT_NON_CONFORMITE, valeur),
              }))}
            />
            <Champ
              nom="origine"
              libelle="Origine"
              type="select"
              valeur={parametres.filtres.origine}
              options={SOURCES.map((valeur) => ({
                valeur,
                libelle: libelle(LIBELLES_SOURCE_NON_CONFORMITE, valeur),
              }))}
            />
            <Champ nom="du" libelle="Detectee du" type="date" valeur={parametres.filtres.du} />
            <Champ nom="au" libelle="Detectee au" type="date" valeur={parametres.filtres.au} />
            <div className="flex items-end gap-3">
              <button
                type="submit"
                className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
              >
                Filtrer
              </button>
              <Link className="lien-nav text-sm" href="/qualite/non-conformites">
                Reinitialiser
              </Link>
            </div>
          </form>
        </Carte>
      </div>

      {liste.total === 0 && liste.pages === 1 && (
        <div className="mb-5">
          <Alerte ton="succes" titre="Aucune non-conformite pour ces criteres">
            Aucune fiche ne correspond aux filtres appliques. Les non-conformites naissent des
            controles refuses, des rejets de production et des saisies manuelles.
          </Alerte>
        </div>
      )}

      <Carte
        titre="Fiches de non-conformite"
        description={`${liste.total} fiche(s), de la plus recente a la plus ancienne.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "numero", libelle: "Numero" },
            { cle: "origine", libelle: "Origine" },
            { cle: "statut", libelle: "Statut" },
            { cle: "article", libelle: "Article" },
            { cle: "ordre", libelle: "Ordre" },
            { cle: "quantite", libelle: "Quantite", nombre: true },
            { cle: "description", libelle: "Description" },
            { cle: "detecteur", libelle: "Detectee par" },
            { cle: "assigne", libelle: "Assignee a" },
            { cle: "cout", libelle: "Cout estime", nombre: true },
            { cle: "detection", libelle: "Detectee le" },
            { cle: "resolution", libelle: "Resolue le" },
            { cle: "cloture", libelle: "Cloturee le" },
          ]}
          lignes={liste.lignes.map((nonConformite) => ({
            cle: String(nonConformite.id),
            cellules: [
              <Link
                key="numero"
                className="lien-nav"
                href={`/qualite/non-conformites/${nonConformite.id}`}
              >
                {nonConformite.number}
              </Link>,
              libelle(LIBELLES_SOURCE_NON_CONFORMITE, nonConformite.source),
              <EtiquetteStatut
                key="statut"
                code={nonConformite.status}
                libelle={libelle(LIBELLES_STATUT_NON_CONFORMITE, nonConformite.status)}
              />,
              nonConformite.item
                ? `${nonConformite.item.code} — ${nonConformite.item.label1}`
                : "Article non renseigne",
              nonConformite.workOrder ? (
                <Link
                  key="ordre"
                  className="lien-nav"
                  href={`/production/${nonConformite.workOrderId}`}
                >
                  {nonConformite.workOrder.number}
                </Link>
              ) : (
                "-"
              ),
              formatQuantite(nonConformite.quantity),
              nonConformite.description,
              nonConformite.detectedBy
                ? `${nonConformite.detectedBy.firstName} ${nonConformite.detectedBy.lastName}`
                : "Non renseigne",
              nonConformite.assignedTo
                ? `${nonConformite.assignedTo.firstName} ${nonConformite.assignedTo.lastName}`
                : "Non assignee",
              formatMontant(nonConformite.costImpact),
              formatDateTime(nonConformite.detectedAt),
              nonConformite.resolvedAt ? formatDate(nonConformite.resolvedAt) : "-",
              nonConformite.closedAt ? formatDate(nonConformite.closedAt) : "-",
            ],
          }))}
          messageVide="Aucune non-conformite ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={Math.min(parametres.page, liste.pages)}
          pages={liste.pages}
          total={liste.total}
          construireLien={fabricantLien("/qualite/non-conformites", filtresCourants)}
        />
      </Carte>

      <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
        <Etiquette ton="info">Rappel</Etiquette> Une fiche close ou rejetee n&apos;est jamais
        supprimee : elle reste consultable et son historique demeure.
      </p>
    </>
  );
}
