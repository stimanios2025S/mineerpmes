import Link from "next/link";
import type { Prisma, PurchaseRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D, type Decimal } from "@/lib/decimal";
import { listerDemandesAchat } from "@/lib/achat/service";
import { lireParametreTexte, CLE_PARAMETRE } from "@/lib/settings";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { fabricantLien, lireParametresListe, premiereValeur } from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  EtiquetteStatut,
  Pagination,
  Tableau,
} from "@/components/ui";
import { DEVISE_PAR_DEFAUT, formatDate, formatEntier, formatMontant } from "@/lib/format";
import { LIBELLES_STATUT_DEMANDE_ACHAT, libelle } from "@/lib/libelles";

export const metadata = { title: "Demandes d'achat" };

const STATUTS_DEMANDE: PurchaseRequestStatus[] = [
  "BROUILLON",
  "SOUMISE",
  "APPROUVEE",
  "REFUSEE",
  "CONVERTIE",
  "ANNULEE",
];

/** Date de filtre lue dans l'URL : une saisie invalide est ignoree, jamais fatale. */
function dateDeFiltre(valeur: string | null): Date | null {
  if (!valeur) return null;
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Une ligne de la liste, reduite aux informations de consultation.
 * Le montant estime est la somme des quantites demandees valorisees au prix
 * estime de chaque ligne : aucun prix n'est suppose s'il n'a pas ete saisi.
 */
interface LigneDemande {
  id: number;
  numero: string;
  statut: PurchaseRequestStatus;
  demandeurId: number | null;
  demandeeLe: Date;
  besoinLe: Date | null;
  fournisseur: string | null;
  montantEstime: Decimal;
  nombreLignes: number;
}

async function chargerDemandes(entree: {
  statut: PurchaseRequestStatus | undefined;
  du: Date | null;
  au: Date | null;
  page: number;
  taille: number;
}): Promise<{ lignes: LigneDemande[]; total: number; pages: number }> {
  const versLigne = (demande: {
    id: number;
    number: string;
    status: PurchaseRequestStatus;
    requesterId: number | null;
    requestedAt: Date;
    neededBy: Date | null;
    supplier: { label1: string } | null;
    lines: { quantity: Decimal; estimatedPrice: Decimal }[];
  }): LigneDemande => ({
    id: demande.id,
    numero: demande.number,
    statut: demande.status,
    demandeurId: demande.requesterId,
    demandeeLe: demande.requestedAt,
    besoinLe: demande.neededBy,
    fournisseur: demande.supplier?.label1 ?? null,
    montantEstime: D.sum(
      demande.lines.map((ligne) => D.mul(D.of(ligne.quantity), D.of(ligne.estimatedPrice))),
    ),
    nombreLignes: demande.lines.length,
  });

  // Sans periode : la consultation officielle du module d'achat est utilisee.
  if (!entree.du && !entree.au) {
    const liste = await listerDemandesAchat({
      statut: entree.statut,
      page: entree.page,
      taille: entree.taille,
    });
    return {
      lignes: liste.lignes.map(versLigne),
      total: liste.total,
      pages: liste.pages,
    };
  }

  // Avec periode : le service de consultation n'offre pas ce filtre, il est donc
  // applique en base (lecture seule, bornee et triee). Filtrer les lignes de la
  // page courante dans le navigateur fausserait le total et la pagination.
  const where: Prisma.PurchaseRequestWhereInput = {};
  if (entree.statut) where.status = entree.statut;
  where.requestedAt = {
    ...(entree.du ? { gte: entree.du } : {}),
    ...(entree.au ? { lte: entree.au } : {}),
  };

  const [total, lignes] = await Promise.all([
    prisma.purchaseRequest.count({ where }),
    prisma.purchaseRequest.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      skip: (entree.page - 1) * entree.taille,
      take: entree.taille,
      include: {
        supplier: { select: { label1: true } },
        lines: { select: { quantity: true, estimatedPrice: true } },
      },
    }),
  ]);

  return {
    lignes: lignes.map(versLigne),
    total,
    pages: Math.max(1, Math.ceil(total / entree.taille)),
  };
}

export default async function PageDemandesAchat({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Les documents d'achat sont transversaux : le modele ne porte pas de division,
  // la portee d'usine ne s'applique donc pas. Le controle reste la permission.
  await exigerPermission(PERMISSIONS.ACHAT_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["statut", "du", "au"]);

  const statut = STATUTS_DEMANDE.find((valeur) => valeur === parametres.filtres.statut);
  const du = dateDeFiltre(parametres.filtres.du);
  const au = dateDeFiltre(parametres.filtres.au);
  const periodeActive = du !== null || au !== null;

  const liste = await chargerDemandes({
    statut,
    du,
    au,
    page: parametres.page,
    taille: parametres.taille,
  });

  const devise = await lireParametreTexte(CLE_PARAMETRE.DEVISE, DEVISE_PAR_DEFAUT);

  const identifiantsDemandeurs = [
    ...new Set(
      liste.lignes
        .map((ligne) => ligne.demandeurId)
        .filter((identifiant): identifiant is number => identifiant !== null),
    ),
  ];
  const demandeurs = identifiantsDemandeurs.length
    ? await prisma.user.findMany({
        where: { id: { in: identifiantsDemandeurs } },
        select: {
          id: true,
          email: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      })
    : [];
  const nomDemandeur = new Map(
    demandeurs.map((demandeur) => [
      demandeur.id,
      demandeur.employee
        ? `${demandeur.employee.firstName} ${demandeur.employee.lastName}`
        : demandeur.email,
    ]),
  );

  const filtresCourants = {
    statut: premiereValeur(parametresBruts, "statut"),
    du: premiereValeur(parametresBruts, "du"),
    au: premiereValeur(parametresBruts, "au"),
  };

  return (
    <>
      <EnTetePage
        titre="Demandes d'achat"
        description="Demandes enregistrees par les services demandeurs, du brouillon a la conversion en bon de commande. Le circuit d'approbation interdit au demandeur d'approuver sa propre demande."
        actions={
          <Link className="lien-nav text-sm" href="/achats/commandes/nouvelle">
            Nouveau bon de commande
          </Link>
        }
      />

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des demandes d'achat"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Statut</span>
          <select className="champ" name="statut" defaultValue={filtresCourants.statut ?? ""}>
            <option value="">Tous les statuts</option>
            {STATUTS_DEMANDE.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_STATUT_DEMANDE_ACHAT, valeur)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Demandees a partir du</span>
          <input className="champ" type="date" name="du" defaultValue={filtresCourants.du ?? ""} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Jusqu'au</span>
          <input className="champ" type="date" name="au" defaultValue={filtresCourants.au ?? ""} />
        </label>
        <button
          type="submit"
          className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
        >
          Filtrer
        </button>
        {periodeActive && (
          <Link className="lien-nav text-sm" href="/achats/demandes">
            Reinitialiser
          </Link>
        )}
      </form>

      {periodeActive && (
        <div className="mb-4">
          <Alerte ton="info" titre="Filtre de periode actif">
            La periode s&apos;applique a la date de demande et est filtree en base : le total et la
            pagination portent sur l&apos;ensemble des demandes de la periode.
          </Alerte>
        </div>
      )}

      <Carte
        titre="Demandes d'achat"
        description={`${liste.total} demande(s) correspondant aux criteres.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "numero", libelle: "Numero" },
            { cle: "demandeur", libelle: "Demandeur" },
            { cle: "statut", libelle: "Statut" },
            { cle: "date", libelle: "Demandee le" },
            { cle: "besoin", libelle: "Besoin le" },
            { cle: "fournisseur", libelle: "Fournisseur propose" },
            { cle: "lignes", libelle: "Lignes", nombre: true },
            { cle: "montant", libelle: "Montant estime", nombre: true },
          ]}
          lignes={liste.lignes.map((demande) => ({
            cle: String(demande.id),
            cellules: [
              <Link key="numero" className="lien-nav" href={`/achats/demandes/${demande.id}`}>
                {demande.numero}
              </Link>,
              demande.demandeurId === null
                ? "-"
                : (nomDemandeur.get(demande.demandeurId) ?? "-"),
              <EtiquetteStatut
                key="statut"
                code={demande.statut}
                libelle={libelle(LIBELLES_STATUT_DEMANDE_ACHAT, demande.statut)}
              />,
              formatDate(demande.demandeeLe),
              formatDate(demande.besoinLe),
              demande.fournisseur ?? "Aucun",
              formatEntier(demande.nombreLignes),
              formatMontant(demande.montantEstime, devise),
            ],
          }))}
          messageVide="Aucune demande d'achat ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={liste.pages}
          total={liste.total}
          construireLien={fabricantLien("/achats/demandes", filtresCourants)}
        />
      </Carte>
    </>
  );
}
