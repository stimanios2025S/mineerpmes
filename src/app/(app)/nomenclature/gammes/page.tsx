import Link from "next/link";
import type { Factory, Prisma, RouteStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actionCreerGamme } from "@/actions/nomenclature";
import {
  aLaPermission,
  exigerPermission,
  usinesAutorisees,
} from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fabricantLien,
  lireParametresListe,
  modeInsensible,
  pagination,
  premiereValeur,
} from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Pagination,
  Section,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatEntier } from "@/lib/format";
import { LIBELLES_STATUT_GAMME, LIBELLES_USINE, libelle } from "@/lib/libelles";

export const metadata = { title: "Gammes de fabrication" };

const STATUTS_GAMME: RouteStatus[] = ["BROUILLON", "ACTIVE", "REMPLACEE", "ARCHIVEE"];
const DIVISIONS: Factory[] = ["ADMEDCO", "MOBILIX", "COMMUN"];

function CaseACocher({
  nom,
  intitule,
  coche,
  aide,
}: {
  nom: string;
  intitule: string;
  coche: boolean;
  aide?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={nom} defaultChecked={coche} className="mt-1" />
      <span>
        <span className="block font-medium">{intitule}</span>
        {aide && (
          <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
            {aide}
          </span>
        )}
      </span>
    </label>
  );
}

export default async function PageGammes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.GAMME_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, [
    "statut",
    "division",
    "atelier",
  ]);

  const statut = STATUTS_GAMME.find((valeur) => valeur === parametres.filtres.statut);
  const division = DIVISIONS.find((valeur) => valeur === parametres.filtres.division);
  const atelierId = Number.parseInt(parametres.filtres.atelier ?? "", 10);

  const usines = usinesAutorisees(utilisateur);

  // La portee de division est appliquee a la gamme ET a son article : aucune
  // gamme d'une autre division ne peut apparaitre par URL directe.
  const conditions: Prisma.ProductRouteWhereInput[] = [
    { factory: { in: usines } },
    { item: { factory: { in: usines } } },
  ];
  if (statut) conditions.push({ status: statut });
  if (division) conditions.push({ factory: division });
  if (Number.isFinite(atelierId) && atelierId > 0) conditions.push({ workshopId: atelierId });
  if (parametres.recherche) {
    const recherche = parametres.recherche;
    conditions.push({
      OR: [
        { code: modeInsensible(recherche) },
        { label: modeInsensible(recherche) },
        { item: { code: modeInsensible(recherche) } },
        { item: { label1: modeInsensible(recherche) } },
      ],
    });
  }

  const where: Prisma.ProductRouteWhereInput = { AND: conditions };

  const [total, ateliers, articles] = await Promise.all([
    prisma.productRoute.count({ where }),
    prisma.workshop.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      take: 200,
      select: { id: true, code: true, label: true, factory: true },
    }),
    prisma.item.findMany({
      where: {
        status: { not: "ARCHIVE" },
        factory: { in: usines },
        OR: [{ isProducible: true }, { type: { in: ["PRODUIT_FINI", "SEMI_FINI"] } }],
      },
      orderBy: { code: "asc" },
      take: 1000,
      select: { id: true, code: true, label1: true, factory: true },
    }),
  ]);

  const bornes = pagination(total, parametres.page, parametres.taille);
  const gammes = await prisma.productRoute.findMany({
    where,
    orderBy: [{ item: { code: "asc" } }, { version: "desc" }],
    skip: bornes.skip,
    take: bornes.take,
    include: {
      item: { select: { id: true, code: true, label1: true, factory: true } },
      workshop: { select: { code: true, label: true } },
      _count: { select: { steps: true } },
    },
  });

  const peutGerer = aLaPermission(utilisateur, PERMISSIONS.GAMME_GERER);

  const filtresCourants = {
    q: parametres.recherche,
    statut: premiereValeur(parametresBruts, "statut"),
    division: premiereValeur(parametresBruts, "division"),
    atelier: premiereValeur(parametresBruts, "atelier"),
    taille: parametres.taille,
  };

  return (
    <>
      <EnTetePage
        titre="Gammes de fabrication"
        description="Enchainement des operations par produit. Une gamme est configurable produit par produit : les produits CANADA et G21 n'ont pas le meme enchainement d'operations, chacun porte donc sa propre gamme."
        actions={
          <Link className="lien-nav text-sm" href="/nomenclature">
            Retour aux nomenclatures
          </Link>
        }
      />

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des gammes"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Recherche</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={parametres.recherche ?? ""}
            placeholder="Code gamme, libelle, code ou designation du produit"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Statut</span>
          <select className="champ" name="statut" defaultValue={filtresCourants.statut ?? ""}>
            <option value="">Tous les statuts</option>
            {STATUTS_GAMME.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_STATUT_GAMME, valeur)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Division</span>
          <select className="champ" name="division" defaultValue={filtresCourants.division ?? ""}>
            <option value="">Toutes les divisions</option>
            {DIVISIONS.map((valeur) => (
              <option key={valeur} value={valeur}>
                {libelle(LIBELLES_USINE, valeur)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Atelier</span>
          <select className="champ" name="atelier" defaultValue={filtresCourants.atelier ?? ""}>
            <option value="">Tous les ateliers</option>
            {ateliers.map((atelier) => (
              <option key={atelier.id} value={atelier.id}>
                {atelier.code} — {atelier.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex min-h-[42px] items-center rounded-lg border px-4 text-sm font-semibold"
          style={{
            background: "var(--surface)",
            borderColor: "var(--bordure-forte)",
            color: "var(--texte)",
          }}
        >
          Filtrer
        </button>
        <Link className="lien-nav text-sm" href="/nomenclature/gammes">
          Reinitialiser
        </Link>
      </form>

      <Carte
        titre="Gammes enregistrees"
        description="Le nombre d'etapes est compte en base ; la gamme par defaut est celle utilisee par defaut pour la planification du produit."
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "article", libelle: "Article" },
            { cle: "code", libelle: "Code" },
            { cle: "libelle", libelle: "Libelle" },
            { cle: "version", libelle: "Version", nombre: true },
            { cle: "statut", libelle: "Statut" },
            { cle: "etapes", libelle: "Etapes", nombre: true },
            { cle: "division", libelle: "Division" },
            { cle: "defaut", libelle: "Gamme par defaut" },
          ]}
          lignes={gammes.map((gamme) => ({
            cle: String(gamme.id),
            cellules: [
              <div key="article">
                <Link className="lien-nav" href={`/referentiel/articles/${gamme.item.id}`}>
                  {gamme.item.code}
                </Link>
                <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                  {gamme.item.label1}
                </span>
              </div>,
              <Link key="code" className="lien-nav" href={`/nomenclature/gammes/${gamme.id}`}>
                {gamme.code}
              </Link>,
              <span key="libelle">{gamme.label}</span>,
              <span key="version" className="tabular-nums">
                v{gamme.version}
              </span>,
              <EtiquetteStatut
                key="statut"
                libelle={libelle(LIBELLES_STATUT_GAMME, gamme.status)}
                code={gamme.status}
              />,
              <span key="etapes" className="tabular-nums">
                {formatEntier(gamme._count.steps)}
              </span>,
              <span key="division">
                {libelle(LIBELLES_USINE, gamme.factory)}
                {gamme.workshop && (
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    Atelier : {gamme.workshop.code} — {gamme.workshop.label}
                  </span>
                )}
              </span>,
              <span key="defaut">
                {gamme.isDefault ? (
                  <Etiquette ton="primaire">Gamme par defaut</Etiquette>
                ) : (
                  <span style={{ color: "var(--texte-doux)" }}>—</span>
                )}
              </span>,
            ],
          }))}
          messageVide="Aucune gamme ne correspond aux filtres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={bornes.pages}
          total={total}
          construireLien={fabricantLien("/nomenclature/gammes", filtresCourants)}
        />
      </Carte>

      {peutGerer ? (
        <Section titre="Creer une gamme">
          <Carte
            titre="Nouvelle gamme"
            description="La gamme est creee au statut brouillon. Ses etapes sont modifiables jusqu'a son activation."
          >
            {articles.length === 0 ? (
              <Alerte ton="alerte" titre="Aucun produit disponible">
                Aucun article produisible, produit fini ou semi-fini n'est accessible avec
                votre portee de division.
              </Alerte>
            ) : (
              <FormulaireAction
                action={actionCreerGamme}
                libelleSoumettre="Creer la gamme"
                reinitialiser
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Champ
                    nom="articleId"
                    libelle="Produit"
                    type="select"
                    requis
                    options={articles.map((article) => ({
                      valeur: article.id,
                      libelle: `${article.code} — ${article.label1} (${article.factory})`,
                    }))}
                    aide="Chaque produit porte son propre enchainement d'operations."
                  />
                  <Champ nom="code" libelle="Code de la gamme" requis maxLength={60} />
                  <Champ nom="libelle" libelle="Libelle" requis maxLength={200} />
                  <Champ
                    nom="version"
                    libelle="Numero de version"
                    type="number"
                    min={1}
                    valeur={1}
                    requis
                  />
                  <Champ
                    nom="division"
                    libelle="Division"
                    type="select"
                    valeur="COMMUN"
                    options={DIVISIONS.filter((valeur) =>
                      usines.includes(valeur),
                    ).map((valeur) => ({
                      valeur,
                      libelle: libelle(LIBELLES_USINE, valeur),
                    }))}
                  />
                  <Champ
                    nom="atelier"
                    libelle="Atelier"
                    type="select"
                    options={ateliers.map((atelier) => ({
                      valeur: atelier.id,
                      libelle: `${atelier.code} — ${atelier.label} (${atelier.factory})`,
                    }))}
                    aide="Atelier de rattachement par defaut des etapes."
                  />
                  <Champ nom="notes" libelle="Notes" type="textarea" maxLength={2000} />
                </div>
                <div className="mt-4">
                  <CaseACocher
                    nom="parDefaut"
                    intitule="Definir comme gamme par defaut du produit"
                    coche={false}
                    aide="Les autres gammes du meme produit cesseront d'etre la gamme par defaut."
                  />
                </div>
              </FormulaireAction>
            )}
          </Carte>
        </Section>
      ) : (
        <Section titre="Creer une gamme">
          <Alerte ton="info" titre="Creation reservee">
            La permission « gestion des gammes de fabrication » est requise pour creer
            une gamme.
          </Alerte>
        </Section>
      )}
    </>
  );
}
