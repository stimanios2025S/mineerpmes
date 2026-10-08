import Link from "next/link";
import type { Factory, Priority, WorkOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { exigerPermission, aLaPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { lireParametresListe, fabricantLien, modeInsensible } from "@/lib/liste";
import {
  listerOrdresFabrication,
  type FiltresOrdres,
} from "@/lib/production/service";
import {
  actionCreerOrdreFabrication,
} from "@/actions/production";
import {
  Alerte,
  Carte,
  EnTetePage,
  EtiquetteStatut,
  Pagination,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatDate, formatQuantite, toInputDate } from "@/lib/format";
import {
  LIBELLES_PRIORITE,
  LIBELLES_STATUT_ORDRE,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Ordres de fabrication" };

/**
 * Liste des ordres de fabrication.
 *
 * Les donnees proviennent exclusivement de `listerOrdresFabrication` et de la
 * base : aucun statut, aucune quantite et aucun total n'est calcule dans le
 * navigateur. Le filtre de priorite n'est pas expose par le service : lorsqu'il
 * est demande, la meme portee est appliquee par une lecture Prisma bornee
 * (voir `listerAvecPriorite`), sans jamais ecrire en base.
 */

type LignesOrdres = Awaited<ReturnType<typeof listerOrdresFabrication>>["lignes"];

interface ListeOrdres {
  lignes: LignesOrdres;
  total: number;
  page: number;
  taille: number;
  pages: number;
}

const STATUTS_ORDRE_FERMES: WorkOrderStatus[] = ["TERMINE", "CLOTURE", "ANNULE"];

function statutOuNull(valeur: string | null): WorkOrderStatus | null {
  return valeur && valeur in LIBELLES_STATUT_ORDRE ? (valeur as WorkOrderStatus) : null;
}

function prioriteOuNull(valeur: string | null): Priority | null {
  return valeur && valeur in LIBELLES_PRIORITE ? (valeur as Priority) : null;
}

function divisionOuNull(valeur: string | null): Factory | null {
  return valeur && valeur in LIBELLES_USINE ? (valeur as Factory) : null;
}

/**
 * `listerOrdresFabrication` ne prend pas encore en charge le filtre de priorite.
 * La meme portee (divisions autorisees, statut, retard, recherche, tri et
 * pagination) est donc reproduite ici par une lecture bornee, afin que le total
 * et la pagination restent exacts.
 */
async function listerAvecPriorite(
  filtres: FiltresOrdres,
  usines: Factory[],
  priorite: Priority,
): Promise<ListeOrdres> {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));
  const recherche = filtres.recherche?.trim();

  const where = {
    factory: { in: usines },
    priority: priorite,
    ...(filtres.statut ? { status: filtres.statut } : {}),
    ...(filtres.enRetard
      ? {
          dueDate: { lt: new Date() },
          status: { notIn: STATUTS_ORDRE_FERMES },
        }
      : {}),
    ...(recherche
      ? {
          OR: [
            { number: modeInsensible(recherche) },
            { item: { code: modeInsensible(recherche) } },
            { item: { label1: modeInsensible(recherche) } },
          ],
        }
      : {}),
  };

  const [total, lignes] = await Promise.all([
    prisma.workOrder.count({ where }),
    prisma.workOrder.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { id: "desc" }],
      skip: (page - 1) * taille,
      take: taille,
      include: {
        item: { select: { code: true, label1: true, unitCode: true } },
        customer: { select: { id: true, code: true, label1: true } },
        salesOrder: { select: { id: true, number: true } },
        operations: {
          orderBy: { stepNo: "asc" },
          include: { operation: { select: { code: true, label: true } } },
        },
      },
    }),
  ]);

  return {
    lignes,
    total,
    page,
    taille,
    pages: Math.max(1, Math.ceil(total / taille)),
  };
}

export default async function PageOrdresFabrication({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.PRODUCTION_LIRE);
  const parametres = await searchParams;
  const liste = lireParametresListe(parametres, [
    "statut",
    "division",
    "priorite",
    "retard",
  ]);

  const statut = statutOuNull(liste.filtres.statut);
  const priorite = prioriteOuNull(liste.filtres.priorite);
  const divisionDemandee = divisionOuNull(liste.filtres.division);
  const enRetard = liste.filtres.retard === "1" || liste.filtres.retard === "true";

  const portee = usinesAutorisees(utilisateur);
  // La division demandee est confrontee aux divisions reellement autorisees :
  // une division hors portee ne peut jamais elargir la lecture.
  const usinesRetenues: Factory[] = divisionDemandee
    ? portee.filter((usine) => usine === divisionDemandee)
    : portee;

  const filtres: FiltresOrdres = {
    statut: statut ?? undefined,
    recherche: liste.recherche ?? undefined,
    enRetard: enRetard || undefined,
    page: liste.page,
    taille: liste.taille,
  };

  const listeOrdres: ListeOrdres =
    usinesRetenues.length === 0
      ? { lignes: [], total: 0, page: 1, taille: liste.taille, pages: 1 }
      : priorite
        ? await listerAvecPriorite(filtres, usinesRetenues, priorite)
        : await listerOrdresFabrication(filtres, usinesRetenues);

  // Bandeau : ordres en retard et ordres en controle qualite.
  const [enRetardListe, enControleQualite] = await Promise.all([
    listerOrdresFabrication({ enRetard: true, taille: 25 }, portee),
    listerOrdresFabrication(
      { statut: "EN_CONTROLE_QUALITE", taille: 25 },
      portee,
    ),
  ]);

  // `listerOrdresFabrication` ne ramene pas le responsable : les noms sont
  // resolus en une seule lecture, jamais devines.
  const identifiantsResponsables = Array.from(
    new Set(
      listeOrdres.lignes
        .map((ordre) => ordre.responsibleId)
        .filter((valeur): valeur is number => valeur !== null),
    ),
  );
  const responsables =
    identifiantsResponsables.length === 0
      ? []
      : await prisma.employee.findMany({
          where: { id: { in: identifiantsResponsables } },
          select: { id: true, firstName: true, lastName: true, matricule: true },
        });
  const nomResponsable = new Map(
    responsables.map((employe) => [
      employe.id,
      `${employe.firstName} ${employe.lastName}`.trim() || employe.matricule,
    ]),
  );

  const peutCreer = aLaPermission(utilisateur, PERMISSIONS.PRODUCTION_ORDRE_CREER);

  // Donnees de reference du formulaire de creation (lectures bornees).
  const [articlesFabricables, nomenclatures, gammes, depots, employes] = peutCreer
    ? await Promise.all([
        prisma.item.findMany({
          where: { isProducible: true, status: "ACTIF" },
          orderBy: { code: "asc" },
          take: 500,
          select: { id: true, code: true, label1: true, unitCode: true },
        }),
        prisma.formula.findMany({
          where: { status: { in: ["ACTIVE", "VALIDEE"] } },
          orderBy: [{ itemId: "asc" }, { version: "desc" }],
          take: 500,
          select: {
            id: true,
            code: true,
            version: true,
            label: true,
            item: { select: { code: true } },
          },
        }),
        prisma.productRoute.findMany({
          where: { status: "ACTIVE" },
          orderBy: [{ itemId: "asc" }, { version: "desc" }],
          take: 500,
          select: {
            id: true,
            code: true,
            version: true,
            label: true,
            item: { select: { code: true } },
          },
        }),
        prisma.warehouse.findMany({
          where: { isActive: true },
          orderBy: [{ factory: "asc" }, { code: "asc" }],
          take: 500,
          select: { id: true, code: true, label: true, factory: true },
        }),
        prisma.employee.findMany({
          where: { isActive: true },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: 500,
          select: { id: true, firstName: true, lastName: true, matricule: true },
        }),
      ])
    : [[], [], [], [], []];

  const clients = peutCreer
    ? await prisma.thirdParty.findMany({
        where: { isClient: true, isActive: true },
        orderBy: [{ label1: "asc" }, { code: "asc" }],
        take: 500,
        select: { id: true, code: true, label1: true },
      })
    : [];

  const commandesClient = peutCreer
    ? await prisma.salesOrder.findMany({
        where: {
          customerId: { in: clients.map((client) => client.id) },
          status: {
            in: ["BROUILLON", "CONFIRMEE", "PARTIELLEMENT_PRODUITE", "PRODUITE", "PARTIELLEMENT_LIVREE"],
          },
        },
        orderBy: [{ orderDate: "desc" }, { id: "desc" }],
        take: 300,
        include: {
          customer: { select: { id: true, code: true, label1: true } },
          lines: {
            orderBy: { lineNo: "asc" },
            include: {
              item: { select: { code: true, label1: true, unitCode: true } },
            },
          },
        },
      })
    : [];

  const lignesCommande = commandesClient.flatMap((commande) =>
    commande.lines.map((ligne) => ({
      id: ligne.id,
      commandeId: commande.id,
      commandeNumero: commande.number,
      lineNo: ligne.lineNo,
      itemCode: ligne.item.code,
      itemLabel: ligne.item.label1,
      unite: ligne.unitCode ?? ligne.item.unitCode ?? null,
    })),
  );

  const divisionsAutorisees = portee.filter(
    (usine): usine is "ADMEDCO" | "MOBILIX" =>
      usine === "ADMEDCO" || usine === "MOBILIX",
  );

  const lienPagination = fabricantLien("/production", {
    q: liste.recherche,
    statut: liste.filtres.statut,
    division: liste.filtres.division,
    priorite: liste.filtres.priorite,
    retard: enRetard ? "1" : null,
  });

  return (
    <>
      <EnTetePage
        titre="Ordres de fabrication"
        description="Toutes les quantites affichees sont celles enregistrees en base par le moteur de production. Aucune valeur n'est calculee dans le navigateur."
        actions={
          <>
            <Link className="lien-nav text-sm" href="/production/kanban">
              Kanban atelier
            </Link>
            <Link className="lien-nav text-sm" href="/production/declarations">
              Declarations a valider
            </Link>
          </>
        }
      />

      {(enRetardListe.total > 0 || enControleQualite.total > 0) && (
        <div className="mb-5 grid gap-3 lg:grid-cols-2">
          {enRetardListe.total > 0 && (
            <Alerte
              ton="danger"
              titre={`${enRetardListe.total} ordre(s) de fabrication en retard`}
            >
              <p>
                Echeance depassee et ordre encore ouvert.{" "}
                <Link className="lien-nav" href="/production?retard=1">
                  Voir ces ordres
                </Link>
              </p>
              <ul className="mt-1 list-disc pl-5">
                {enRetardListe.lignes.slice(0, 5).map((ordre) => (
                  <li key={ordre.id}>
                    <Link className="lien-nav" href={`/production/${ordre.id}`}>
                      {ordre.number}
                    </Link>{" "}
                    â€” {ordre.item.code}, echeance du {formatDate(ordre.dueDate)} (
                    {formatQuantite(ordre.quantityRemaining)} restant)
                  </li>
                ))}
              </ul>
            </Alerte>
          )}
          {enControleQualite.total > 0 && (
            <Alerte
              ton="alerte"
              titre={`${enControleQualite.total} ordre(s) en controle qualite`}
            >
              <p>
                Production suspendue tant que la qualite n'a pas statue.{" "}
                <Link className="lien-nav" href="/production?statut=EN_CONTROLE_QUALITE">
                  Voir ces ordres
                </Link>
              </p>
              <ul className="mt-1 list-disc pl-5">
                {enControleQualite.lignes.slice(0, 5).map((ordre) => (
                  <li key={ordre.id}>
                    <Link className="lien-nav" href={`/production/${ordre.id}`}>
                      {ordre.number}
                    </Link>{" "}
                    â€” {ordre.item.code}, {formatQuantite(ordre.quantityConform)} conforme(s)
                  </li>
                ))}
              </ul>
            </Alerte>
          )}
        </div>
      )}

      <Carte
        titre="Filtres"
        description="Les filtres sont appliques en base ; la recherche porte sur le numero d'ordre et sur l'article."
      >
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Champ nom="q" libelle="Recherche" type="search" valeur={liste.recherche} />
          <Champ
            nom="statut"
            libelle="Statut"
            type="select"
            valeur={liste.filtres.statut}
            options={Object.entries(LIBELLES_STATUT_ORDRE).map(([valeur, texte]) => ({
              valeur,
              libelle: texte,
            }))}
          />
          <Champ
            nom="division"
            libelle="Division"
            type="select"
            valeur={liste.filtres.division}
            options={divisionsAutorisees.map((usine) => ({
              valeur: usine,
              libelle: libelle(LIBELLES_USINE, usine),
            }))}
          />
          <Champ
            nom="priorite"
            libelle="Priorite"
            type="select"
            valeur={liste.filtres.priorite}
            options={Object.entries(LIBELLES_PRIORITE).map(([valeur, texte]) => ({
              valeur,
              libelle: texte,
            }))}
          />
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Retard</span>
            <select className="champ" name="retard" defaultValue={enRetard ? "1" : ""}>
              <option value="">Tous les ordres</option>
              <option value="1">Uniquement les ordres en retard</option>
            </select>
          </label>
          <div className="sm:col-span-2 lg:col-span-5">
            <button
              type="submit"
              className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
            >
              Filtrer
            </button>
          </div>
        </form>
      </Carte>

      {usinesRetenues.length === 0 && (
        <div className="mt-4">
          <Alerte ton="danger" titre="Division hors de votre perimetre">
            Votre profil ne donne acces a aucune des divisions demandees : aucun ordre ne peut
            etre affiche.
          </Alerte>
        </div>
      )}

      <div className="mt-5">
        <Carte
          titre="Ordres de fabrication"
          description={`${listeOrdres.total} ordre(s) correspondant aux filtres.`}
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Numero" },
              { cle: "article", libelle: "Article" },
              { cle: "division", libelle: "Division" },
              { cle: "client", libelle: "Client / BL" },
              { cle: "statut", libelle: "Statut" },
              { cle: "priorite", libelle: "Priorite" },
              { cle: "planifiee", libelle: "Planifiee", nombre: true },
              { cle: "lancee", libelle: "Lancee", nombre: true },
              { cle: "produite", libelle: "Produite", nombre: true },
              { cle: "conforme", libelle: "Conforme", nombre: true },
              { cle: "rebutee", libelle: "Rebutee", nombre: true },
              { cle: "restante", libelle: "Restante", nombre: true },
              { cle: "echeance", libelle: "Echeance" },
              { cle: "responsable", libelle: "Responsable" },
            ]}
            lignes={listeOrdres.lignes.map((ordre) => ({
              cle: String(ordre.id),
              cellules: [
                <Link key="n" className="lien-nav" href={`/production/${ordre.id}`}>
                  {ordre.number}
                </Link>,
                `${ordre.item.code} â€” ${ordre.item.label1}`,
                libelle(LIBELLES_USINE, ordre.factory),
                ordre.customer
                  ? `${ordre.customer.code} - ${ordre.customer.label1}${ordre.customerReference ? ` (${ordre.customerReference})` : ""}`
                  : "Interne / sans client",
                <EtiquetteStatut
                  key="s"
                  libelle={libelle(LIBELLES_STATUT_ORDRE, ordre.status)}
                  code={ordre.status}
                />,
                libelle(LIBELLES_PRIORITE, ordre.priority),
                formatQuantite(ordre.quantityPlanned),
                formatQuantite(ordre.quantityLaunched),
                formatQuantite(ordre.quantityProduced),
                formatQuantite(ordre.quantityConform),
                formatQuantite(ordre.quantityScrapped),
                formatQuantite(ordre.quantityRemaining),
                ordre.dueDate ? (
                  <span key="e">
                    {formatDate(ordre.dueDate)}
                    {ordre.dueDate < new Date() &&
                      !STATUTS_ORDRE_FERMES.includes(ordre.status) && (
                        <strong style={{ color: "var(--danger)" }}> â€” en retard</strong>
                      )}
                  </span>
                ) : (
                  "Non planifiee"
                ),
                ordre.responsibleId
                  ? (nomResponsable.get(ordre.responsibleId) ?? "Responsable introuvable")
                  : "Non affecte",
              ],
            }))}
            messageVide="Aucun ordre de fabrication ne correspond aux filtres selectionnes."
          />
          <Pagination
            page={listeOrdres.page}
            pages={listeOrdres.pages}
            total={listeOrdres.total}
            construireLien={lienPagination}
          />
        </Carte>
      </div>

      {peutCreer && (
        <div className="mt-5">
          <Carte
            titre="Creer un ordre de fabrication"
            description="La nomenclature et la gamme retenues sont celles de l'article ; vous pouvez les imposer explicitement. Un ordre cree sans lancement reste en brouillon."
          >
            <FormulaireAction
              action={actionCreerOrdreFabrication}
              libelleSoumettre="Creer l'ordre"
              reinitialiser
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Champ
                  nom="itemId"
                  libelle="Article a fabriquer"
                  type="select"
                  requis
                  options={articlesFabricables.map((article) => ({
                    valeur: article.id,
                    libelle: `${article.code} â€” ${article.label1}${article.unitCode ? ` (${article.unitCode})` : ""}`,
                  }))}
                  aide="Articles fabricables et actifs (500 au maximum)."
                />
                <Champ
                  nom="quantityPlanned"
                  libelle="Quantite planifiee"
                  type="number"
                  requis
                  pas="0.001"
                  min="0.001"
                />
                <Champ
                  nom="factory"
                  libelle="Division"
                  type="select"
                  requis
                  options={divisionsAutorisees.map((usine) => ({
                    valeur: usine,
                    libelle: libelle(LIBELLES_USINE, usine),
                  }))}
                  aide="Seules les divisions de votre profil sont proposees."
                />
                <Champ
                  nom="priority"
                  libelle="Priorite"
                  type="select"
                  valeur="NORMALE"
                  options={Object.entries(LIBELLES_PRIORITE).map(([valeur, texte]) => ({
                    valeur,
                    libelle: texte,
                  }))}
                />
                <Champ
                  nom="formulaId"
                  libelle="Nomenclature"
                  type="select"
                  options={nomenclatures.map((formule) => ({
                    valeur: formule.id,
                    libelle: `${formule.code} v${formule.version} â€” ${formule.label} (${formule.item.code})`,
                  }))}
                  aide="Laisser vide pour retenir la nomenclature active de l'article."
                />
                <Champ
                  nom="routeId"
                  libelle="Gamme de fabrication"
                  type="select"
                  options={gammes.map((gamme) => ({
                    valeur: gamme.id,
                    libelle: `${gamme.code} v${gamme.version} â€” ${gamme.label} (${gamme.item.code})`,
                  }))}
                  aide="Laisser vide pour retenir la gamme active de l'article."
                />
                <Champ
                  nom="sourceWarehouseId"
                  libelle="Depot source (consommation)"
                  type="select"
                  options={depots.map((depot) => ({
                    valeur: depot.id,
                    libelle: `${depot.code} â€” ${depot.label} (${libelle(LIBELLES_USINE, depot.factory)})`,
                  }))}
                />
                <Champ
                  nom="targetWarehouseId"
                  libelle="Depot de destination (produit fini)"
                  type="select"
                  options={depots.map((depot) => ({
                    valeur: depot.id,
                    libelle: `${depot.code} â€” ${depot.label} (${libelle(LIBELLES_USINE, depot.factory)})`,
                  }))}
                />
                <div className="sm:col-span-2 lg:col-span-3 rounded-lg border p-3" style={{ borderColor: "var(--bordure)" }}>
                  <h3 className="mb-1 text-sm font-semibold">Client et bon de livraison</h3>
                  <p className="mb-3 text-xs" style={{ color: "var(--texte-doux)" }}>
                    Bloc facultatif pour un ordre interne. Lorsqu&apos;un client ou une commande
                    est selectionne, le service verifie la coherence avec l&apos;article et la
                    ligne de commande.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Champ
                      nom="customerId"
                      libelle="Client"
                      type="select"
                      options={clients.map((client) => ({
                        valeur: client.id,
                        libelle: `${client.code} - ${client.label1}`,
                      }))}
                      aide="Laisser vide pour un ordre interne, ou saisissez le nom juste apres."
                    />
                    <Champ
                      nom="nouveauClient"
                      libelle="Nouveau client (saisie libre)"
                      maxLength={200}
                      aide="Nom d'un client absent de la liste : sa fiche est creee automatiquement dans le referentiel, puis rattachee a l'ordre."
                    />
                    <Champ
                      nom="salesOrderId"
                      libelle="Commande client"
                      type="select"
                      options={commandesClient.map((commande) => ({
                        valeur: commande.id,
                        libelle: `${commande.number} - ${commande.customer.label1}`,
                      }))}
                      aide="Laisser vide si l'ordre n'est pas rattache a une commande."
                    />
                    <Champ
                      nom="salesOrderLineId"
                      libelle="Ligne de commande"
                      type="select"
                      options={lignesCommande.map((ligne) => ({
                        valeur: ligne.id,
                        libelle: `${ligne.commandeNumero} / ligne ${ligne.lineNo} - ${ligne.itemCode}${ligne.unite ? ` (${ligne.unite})` : ""}`,
                      }))}
                      aide="La ligne doit porter l'article fabrique."
                    />
                    <Champ
                      nom="customerReference"
                      libelle="Reference client"
                      aide="Reference du client ou reference du bon de livraison."
                    />
                    <Champ
                      nom="deliveryAddress"
                      libelle="Adresse de livraison"
                      type="textarea"
                      maxLength={1000}
                    />
                    <Champ
                      nom="carrier"
                      libelle="Transporteur"
                      maxLength={200}
                    />
                    <Champ
                      nom="plannedDeliveryDate"
                      libelle="Livraison prevue"
                      type="date"
                    />
                    <Champ
                      nom="deliveryNotes"
                      libelle="Notes de livraison"
                      type="textarea"
                      maxLength={2000}
                      aide="Instructions, contact sur place ou particularites du transport."
                    />
                  </div>
                </div>
                <Champ nom="plannedStart" libelle="Debut prevu" type="date" valeur={toInputDate(new Date())} />
                <Champ nom="dueDate" libelle="Echeance" type="date" />
                <Champ
                  nom="responsibleId"
                  libelle="Responsable"
                  type="select"
                  options={employes.map((employe) => ({
                    valeur: employe.id,
                    libelle: `${employe.lastName} ${employe.firstName} (${employe.matricule})`,
                  }))}
                />
                <Champ nom="notes" libelle="Notes" type="textarea" />
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="lancerImmediatement" />
                <span>
                  Lancer immediatement l'ordre : la nomenclature est figee et les operations
                  deviennent executables.
                </span>
              </label>
            </FormulaireAction>
          </Carte>
        </div>
      )}
    </>
  );
}
