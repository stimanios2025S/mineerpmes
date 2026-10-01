import Link from "next/link";
import { prisma } from "@/lib/db";
import { aLaPermission, exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { premiereValeur } from "@/lib/liste";
import {
  actionCreerSousStock,
  actionDefinirLienSousStock,
} from "@/actions/atelier";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  Statistique,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { listerSousStocks } from "@/lib/mes/sous-stocks";
import { D } from "@/lib/decimal";
import { formatQuantite } from "@/lib/format";
import { LIBELLES_USINE } from "@/lib/libelles";
import type { Factory } from "@prisma/client";

export const metadata = { title: "Sous-stocks d'etape" };

const LIBELLES_KIND: Record<string, string> = {
  ENTREE_OPERATION: "Entree d'operation",
  SORTIE_OPERATION: "Sortie d'operation",
  TAMPON: "Tampon entre deux etapes",
  ATTENTE_QUALITE: "Attente de controle qualite",
};

function estFactory(valeur: string | null): valeur is Factory {
  return valeur === "ADMEDCO" || valeur === "MOBILIX" || valeur === "COMMUN";
}

/**
 * Sous-stocks d'etape.
 *
 * Un sous-stock n'est PAS un second moteur de stock : c'est un emplacement
 * (`Location`) d'un depot existant, auquel on donne une identite metier — « la
 * sortie de l'operation Decoupe ». Les quantites restent dans le grand livre de
 * stock ; aucun ecran ne modifie une quantite directement. Le passage d'une
 * etape a la suivante est trace, transactionnel et idempotent.
 */
export default async function PageSousStocks({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.PRODUCTION_SOUS_STOCK_LIRE);
  const peutGerer = aLaPermission(utilisateur, PERMISSIONS.PRODUCTION_SOUS_STOCK_GERER);

  const parametres = await searchParams;
  const usines = usinesAutorisees(utilisateur);
  const usineParam = premiereValeur(parametres, "usine");
  const usineFiltre: Factory | undefined = estFactory(usineParam)
    ? usineParam
    : (usines[0] ?? undefined);

  if (usineFiltre && !usines.includes(usineFiltre)) {
    return (
      <>
        <EnTetePage titre="Sous-stocks d'etape" />
        <Alerte ton="danger" titre="Perimetre insuffisant">
          Vous n'avez pas acces a la division {usineFiltre}.
        </Alerte>
      </>
    );
  }

  const [sousStocks, operations, depots, ateliers] = await Promise.all([
    listerSousStocks(prisma, {
      factory: usineFiltre,
      actifsSeulement: false,
    }),
    prisma.operation.findMany({
      where: {
        isActive: true,
        ...(usineFiltre ? { factory: { in: [usineFiltre, "COMMUN"] } } : {}),
      },
      select: { id: true, code: true, label: true },
      orderBy: { code: "asc" },
      take: 500,
    }),
    prisma.warehouse.findMany({
      where: {
        isActive: true,
        ...(usineFiltre ? { factory: { in: [usineFiltre, "COMMUN"] } } : {}),
      },
      select: { id: true, code: true, label: true },
      orderBy: { code: "asc" },
    }),
    usineFiltre
      ? prisma.workshop.findMany({
          where: { factory: usineFiltre, isActive: true },
          select: { id: true, code: true, label: true },
          orderBy: { code: "asc" },
        })
      : Promise.resolve([]),
  ]);

  // Position reelle de chaque emplacement de sous-stock : lue depuis le grand
  // livre, jamais recalculee a la main.
  const emplacements = sousStocks.map((sousStock) => sousStock.locationId);
  const soldes =
    emplacements.length > 0
      ? await prisma.stockBalance.findMany({
          where: { locationId: { in: emplacements } },
          select: {
            locationId: true,
            itemId: true,
            quantityPhysical: true,
            quantityReserved: true,
            quantityBlocked: true,
            quantityDamaged: true,
            quantityQuarantine: true,
            item: { select: { code: true, label1: true, unitCode: true } },
          },
        })
      : [];

  interface PositionEmplacement {
    articles: number;
    physique: ReturnType<typeof D.of>;
    disponible: ReturnType<typeof D.of>;
    bloque: ReturnType<typeof D.of>;
    detail: { code: string; libelle: string; unite: string; physique: string; disponible: string }[];
  }

  const positionsParEmplacement = new Map<number, PositionEmplacement>();
  for (const solde of soldes) {
    if (solde.locationId === null) continue;
    const position =
      positionsParEmplacement.get(solde.locationId) ??
      ({
        articles: 0,
        physique: D.of(0),
        disponible: D.of(0),
        bloque: D.of(0),
        detail: [],
      } satisfies PositionEmplacement);

    const physique = D.of(solde.quantityPhysical);
    const indisponible = D.add(
      D.add(D.of(solde.quantityReserved), D.of(solde.quantityBlocked)),
      D.add(D.of(solde.quantityDamaged), D.of(solde.quantityQuarantine)),
    );
    const disponible = D.sub(physique, indisponible);

    position.physique = D.add(position.physique, physique);
    position.disponible = D.add(position.disponible, disponible);
    position.bloque = D.add(position.bloque, indisponible);
    position.articles += 1;
    position.detail.push({
      code: solde.item.code,
      libelle: solde.item.label1,
      unite: solde.item.unitCode ?? "",
      physique: formatQuantite(physique),
      disponible: formatQuantite(disponible),
    });

    positionsParEmplacement.set(solde.locationId, position);
  }

  const actifs = sousStocks.filter((sousStock) => sousStock.isActive).length;
  const sansAmont = sousStocks.filter(
    (sousStock) => sousStock.isActive && sousStock.incomingLinks.length === 0,
  ).length;
  const sorties = sousStocks.filter(
    (sousStock) => sousStock.kind === "SORTIE_OPERATION",
  ).length;

  return (
    <>
      <EnTetePage
        titre="Sous-stocks d'etape"
        description="Chaque etape depose sa production conforme dans son propre emplacement. Le passage a l'etape suivante est trace et ne se fait qu'apres validation."
        actions={
          <>
            <Link className="bouton secondaire" href="/production/feuille-de-route">
              Feuille de route
            </Link>
            <Link className="bouton secondaire" href="/production/programme">
              Programme
            </Link>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Statistique libelle="Sous-stocks" valeur={sousStocks.length} />
        <Statistique libelle="Actifs" valeur={actifs} />
        <Statistique
          libelle="Sorties d'operation"
          valeur={sorties}
          detail="Emplacement ou se depose la production conforme"
        />
        <Statistique
          libelle="Sans alimentation amont"
          valeur={sansAmont}
          detail="Etape sans lien entrant declare"
          ton={sansAmont > 0 ? "alerte" : "neutre"}
        />
      </div>

      <Carte titre="Filtrer">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <Champ
            nom="usine"
            libelle="Division"
            type="select"
            valeur={usineFiltre ?? ""}
            options={usines.map((usine) => ({
              valeur: usine,
              libelle: LIBELLES_USINE[usine] ?? usine,
            }))}
          />
          <button className="bouton primaire" type="submit">
            Appliquer
          </button>
        </form>
      </Carte>

      <div className="mt-4">
        <Carte
          titre="Emplacements d'etape"
          description="La position affichee vient du grand livre de stock. Aucune quantite n'est editée ici : elle resulte de mouvements traces."
        >
          <Tableau
            messageVide="Aucun sous-stock d'etape n'est declare."
            cleLigne={(index) => String(sousStocks[index]?.id ?? index)}
            colonnes={[
              { cle: "code", libelle: "Sous-stock" },
              { cle: "operation", libelle: "Operation" },
              { cle: "emplacement", libelle: "Depot / emplacement" },
              { cle: "type", libelle: "Type" },
              { cle: "position", libelle: "Position" },
              { cle: "amont", libelle: "Alimente par" },
              { cle: "aval", libelle: "Alimente" },
              { cle: "etat", libelle: "Etat" },
            ]}
            lignes={sousStocks.map((sousStock) => {
              const position = positionsParEmplacement.get(sousStock.locationId);
              return {
                cle: String(sousStock.id),
                cellules: [
                  <span key={`c-${sousStock.id}`}>
                    <span className="font-medium">{sousStock.code}</span>
                    <span
                      className="block text-sm"
                      style={{ color: "var(--texte-doux)" }}
                    >
                      {sousStock.label}
                    </span>
                  </span>,
                  `${sousStock.operation.code} — ${sousStock.operation.label}`,
                  `${sousStock.warehouse.code} / ${sousStock.location.code}`,
                  LIBELLES_KIND[sousStock.kind] ?? sousStock.kind,
                  position ? (
                    <span key={`p-${sousStock.id}`} className="text-sm">
                      <span className="font-medium">
                        {formatQuantite(position.physique)}
                      </span>{" "}
                      physique
                      <span className="block" style={{ color: "var(--texte-doux)" }}>
                        {formatQuantite(position.disponible)} disponible ·{" "}
                        {formatQuantite(position.bloque)} immobilise
                      </span>
                      {position.detail.slice(0, 3).map((article) => (
                        <span
                          key={`${sousStock.id}-${article.code}`}
                          className="block"
                          style={{ color: "var(--texte-doux)" }}
                        >
                          {article.code} : {article.physique} {article.unite} (
                          {article.disponible} disponible)
                        </span>
                      ))}
                      {position.detail.length > 3 && (
                        <span className="block" style={{ color: "var(--texte-doux)" }}>
                          et {position.detail.length - 3} autre(s) article(s)
                        </span>
                      )}
                    </span>
                  ) : (
                    <span key={`p-${sousStock.id}`} className="text-sm" style={{ color: "var(--texte-doux)" }}>
                      Aucun stock dans cet emplacement.
                    </span>
                  ),
                  sousStock.incomingLinks.length === 0
                    ? "—"
                    : sousStock.incomingLinks
                        .map(
                          (lien) =>
                            `${lien.fromSubStock.code}${lien.isRequired ? "" : " (facultatif)"}`,
                        )
                        .join(", "),
                  sousStock.outgoingLinks.length === 0
                    ? "—"
                    : sousStock.outgoingLinks
                        .map((lien) => lien.toSubStock.code)
                        .join(", "),
                  sousStock.isActive ? (
                    <Etiquette key={`e-${sousStock.id}`} ton="succes">
                      Actif
                    </Etiquette>
                  ) : (
                    <Etiquette key={`e-${sousStock.id}`} ton="neutre">
                      Inactif
                    </Etiquette>
                  ),
                ],
              };
            })}
          />
        </Carte>
      </div>

      {peutGerer && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Carte
            titre="Declarer un sous-stock d'etape"
            description="L'emplacement est cree dans un depot existant s'il n'existe pas encore."
          >
            <FormulaireAction
              action={actionCreerSousStock}
              libelleSoumettre="Creer le sous-stock"
              varianteSoumettre="primaire"
            >
              <input type="hidden" name="factory" value={usineFiltre ?? ""} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Champ nom="code" libelle="Code" requis maxLength={40} />
                <Champ nom="label" libelle="Libelle" requis maxLength={120} />
                <Champ
                  nom="operationId"
                  libelle="Operation"
                  type="select"
                  requis
                  options={operations.map((operation) => ({
                    valeur: operation.id,
                    libelle: `${operation.code} — ${operation.label}`,
                  }))}
                />
                <Champ
                  nom="warehouseId"
                  libelle="Depot"
                  type="select"
                  requis
                  options={depots.map((depot) => ({
                    valeur: depot.id,
                    libelle: `${depot.code} — ${depot.label}`,
                  }))}
                />
                <Champ
                  nom="locationCode"
                  libelle="Code emplacement"
                  requis
                  maxLength={40}
                  aide="Par exemple : SORTIE-COUPE."
                />
                <Champ
                  nom="locationLabel"
                  libelle="Libelle de l'emplacement"
                  maxLength={120}
                />
                <Champ
                  nom="kind"
                  libelle="Type"
                  type="select"
                  valeur="SORTIE_OPERATION"
                  options={[
                    { valeur: "ENTREE_OPERATION", libelle: "Entree d'operation" },
                    { valeur: "SORTIE_OPERATION", libelle: "Sortie d'operation" },
                    { valeur: "TAMPON", libelle: "Tampon" },
                    { valeur: "ATTENTE_QUALITE", libelle: "Attente qualite" },
                  ]}
                />
                <Champ
                  nom="workshopId"
                  libelle="Atelier"
                  type="select"
                  options={[
                    { valeur: "", libelle: "Non precise" },
                    ...ateliers.map((atelier) => ({
                      valeur: atelier.id,
                      libelle: `${atelier.code} — ${atelier.label}`,
                    })),
                  ]}
                />
                <Champ nom="sequenceOrder" libelle="Ordre" type="number" min={0} valeur="0" />
                <Champ nom="description" libelle="Description" maxLength={200} />
              </div>
            </FormulaireAction>
          </Carte>

          <Carte
            titre="Declarer une alimentation entre deux etapes"
            description="Deux branches qui alimentent la meme etape finale se declarent ici, l'une et l'autre : c'est ce qui rend le passage parallele verifiable."
          >
            {sousStocks.length < 2 ? (
              <Alerte ton="info" titre="Pas encore deux etapes">
                Declarez au moins deux sous-stocks d'etape pour pouvoir les
                relier.
              </Alerte>
            ) : (
              <FormulaireAction
                action={actionDefinirLienSousStock}
                libelleSoumettre="Enregistrer le lien"
                varianteSoumettre="primaire"
              >
                <div className="grid gap-3">
                  <Champ
                    nom="fromSubStockId"
                    libelle="Etape amont"
                    type="select"
                    requis
                    options={sousStocks.map((sousStock) => ({
                      valeur: sousStock.id,
                      libelle: `${sousStock.code} — ${sousStock.operation.label}`,
                    }))}
                  />
                  <Champ
                    nom="toSubStockId"
                    libelle="Etape aval"
                    type="select"
                    requis
                    options={sousStocks.map((sousStock) => ({
                      valeur: sousStock.id,
                      libelle: `${sousStock.code} — ${sousStock.operation.label}`,
                    }))}
                  />
                  <Champ
                    nom="isRequired"
                    libelle="Obligatoire pour demarrer l'etape aval"
                    type="select"
                    valeur="true"
                    options={[
                      { valeur: "true", libelle: "Oui : l'amont doit etre servi" },
                      { valeur: "false", libelle: "Non : alimentation facultative" },
                    ]}
                  />
                  <Champ
                    nom="quantityRatio"
                    libelle="Ratio de quantite"
                    type="number"
                    pas="0.000001"
                    min={0}
                    valeur="1"
                    aide="Quantite consommee en aval pour une unite produite en amont."
                  />
                  <Champ nom="note" libelle="Note" maxLength={200} />
                </div>
              </FormulaireAction>
            )}
          </Carte>
        </div>
      )}
    </>
  );
}
