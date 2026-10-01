import Link from "next/link";
import type { DeclarationKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { lireParametresListe, fabricantLien, modeInsensible, pagination } from "@/lib/liste";
import {
  actionRejeterDeclaration,
  actionValiderDeclaration,
} from "@/actions/production";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Pagination,
  Tableau,
} from "@/components/ui";
import { BoutonAction, Champ, FormulaireMotif } from "@/components/interactif";
import { formatDateTime, formatQuantite } from "@/lib/format";
import {
  LIBELLES_CATEGORIE_PERTE,
  LIBELLES_MOTIF_PERTE,
  LIBELLES_STATUT_DECLARATION,
  LIBELLES_TYPE_DECLARATION,
  LIBELLES_USINE,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Declarations a valider" };

/**
 * File des declarations d'atelier en attente de validation.
 *
 * Seules les declarations au statut SOUMISE sont presentees : ce sont celles que
 * le moteur de production a jugees sensibles (perte exceptionnelle, rebut au
 * dela du seuil parametre). La validation et le rejet passent par les actions
 * serveur, qui revalident la permission et l'acces a la division.
 */

function typeOuNull(valeur: string | null): DeclarationKind | null {
  return valeur && valeur in LIBELLES_TYPE_DECLARATION
    ? (valeur as DeclarationKind)
    : null;
}

export default async function PageDeclarationsAValider({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(
    PERMISSIONS.PRODUCTION_VALIDER_DECLARATION,
  );
  const parametres = await searchParams;
  const liste = lireParametresListe(parametres, ["type"]);

  const type = typeOuNull(liste.filtres.type);
  const portee = usinesAutorisees(utilisateur);

  const where = {
    status: "SOUMISE" as const,
    ...(type ? { kind: type } : {}),
    workOrder: {
      factory: { in: portee },
      ...(liste.recherche ? { number: modeInsensible(liste.recherche) } : {}),
    },
  };

  const total = await prisma.operationDeclaration.count({ where });
  const bornes = pagination(total, liste.page, liste.taille);

  const declarations = await prisma.operationDeclaration.findMany({
    where,
    orderBy: { occurredAt: "asc" },
    skip: bornes.skip,
    take: bornes.take,
    include: {
      operation: { select: { code: true, label: true } },
      employee: { select: { firstName: true, lastName: true, matricule: true } },
      item: { select: { code: true } },
      componentItem: { select: { code: true } },
      warehouse: { select: { code: true } },
      material: { select: { lineNo: true } },
      workOrder: {
        select: {
          id: true,
          number: true,
          factory: true,
          item: { select: { code: true } },
        },
      },
    },
  });

  return (
    <>
      <EnTetePage
        titre="Declarations d'atelier a valider"
        description="Les declarations soumises portent une perte exceptionnelle ou un depassement du seuil parametre : elles attendent un arbitrage ecrit."
        actions={
          <Link className="lien-nav text-sm" href="/production">
            Ordres de fabrication
          </Link>
        }
      />

      {total === 0 ? (
        <Alerte ton="succes" titre="Aucune declaration en attente">
          Toutes les declarations d'atelier de votre perimetre ont ete traitees.
        </Alerte>
      ) : (
        <Alerte ton="alerte" titre={`${total} declaration(s) en attente d'arbitrage`}>
          La validation enregistre la decision ; le rejet exige un motif ecrit, conserve dans
          l'historique de la declaration.
        </Alerte>
      )}

      <div className="mt-5">
        <Carte titre="Filtres">
          <form method="get" className="grid gap-3 sm:grid-cols-3">
            <Champ
              nom="q"
              libelle="Recherche"
              type="search"
              valeur={liste.recherche}
              aide="Recherche sur le numero de l'ordre de fabrication."
            />
            <Champ
              nom="type"
              libelle="Type de declaration"
              type="select"
              valeur={liste.filtres.type}
              options={Object.entries(LIBELLES_TYPE_DECLARATION).map(([valeur, texte]) => ({
                valeur,
                libelle: texte,
              }))}
            />
            <div className="flex items-end">
              <button
                type="submit"
                className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
              >
                Filtrer
              </button>
            </div>
          </form>
        </Carte>
      </div>

      <div className="mt-5">
        <Carte
          titre="Declarations soumises"
          description="File d'attente, de la plus ancienne a la plus recente."
          sansPadding
        >
          <Tableau
            colonnes={[
              { cle: "numero", libelle: "Declaration" },
              { cle: "ordre", libelle: "Ordre" },
              { cle: "article", libelle: "Article" },
              { cle: "operation", libelle: "Operation" },
              { cle: "operateur", libelle: "Operateur" },
              { cle: "type", libelle: "Type" },
              { cle: "quantite", libelle: "Quantite", nombre: true },
              { cle: "categorie", libelle: "Categorie" },
              { cle: "motif", libelle: "Motif" },
              { cle: "date", libelle: "Date" },
              { cle: "commentaire", libelle: "Commentaire" },
              { cle: "decision", libelle: "Decision" },
            ]}
            lignes={declarations.map((declaration) => ({
              cle: String(declaration.id),
              cellules: [
                `#${declaration.id}`,
                <Link
                  key="o"
                  className="lien-nav"
                  href={`/production/${declaration.workOrder.id}`}
                >
                  {declaration.workOrder.number}
                </Link>,
                `${declaration.workOrder.item.code}${
                  declaration.componentItem ? ` / ${declaration.componentItem.code}` : ""
                }`,
                `${declaration.operation.code} — ${declaration.operation.label}`,
                declaration.employee
                  ? `${declaration.employee.firstName} ${declaration.employee.lastName} (${declaration.employee.matricule})`.trim()
                  : "Non renseigne",
                libelle(LIBELLES_TYPE_DECLARATION, declaration.kind),
                `${formatQuantite(declaration.quantity)} ${declaration.unitCode ?? ""}`.trim(),
                libelle(LIBELLES_CATEGORIE_PERTE, declaration.lossCategory),
                libelle(LIBELLES_MOTIF_PERTE, declaration.lossReason),
                formatDateTime(declaration.occurredAt),
                declaration.comment ?? "-",
                <div key="d" className="flex flex-col gap-2">
                  <EtiquetteStatut
                    libelle={libelle(LIBELLES_STATUT_DECLARATION, declaration.status)}
                    code={declaration.status}
                  />
                  {declaration.isExceptional && (
                    <Etiquette ton="danger" titre="Perte exceptionnelle">
                      Exceptionnelle
                    </Etiquette>
                  )}
                  <BoutonAction
                    action={actionValiderDeclaration}
                    libelle="Valider"
                    variante="primaire"
                    champsCaches={{ declarationId: String(declaration.id) }}
                    confirmation="Valider cette declaration ? La decision est journalisee."
                  />
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold">
                      Rejeter avec motif
                    </summary>
                    <FormulaireMotif
                      action={actionRejeterDeclaration}
                      libelleSoumettre="Rejeter"
                      varianteSoumettre="danger"
                      libelleMotif="Motif du rejet"
                      motifMinimum={10}
                      champsCaches={{ declarationId: String(declaration.id) }}
                    />
                  </details>
                </div>,
              ],
            }))}
            messageVide="Aucune declaration ne correspond aux filtres selectionnes."
          />
          <Pagination
            page={Math.min(liste.page, bornes.pages)}
            pages={bornes.pages}
            total={total}
            construireLien={fabricantLien("/production/declarations", {
              q: liste.recherche,
              type: liste.filtres.type,
            })}
          />
        </Carte>
      </div>

      <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
        Perimetre : {portee.map((usine) => libelle(LIBELLES_USINE, usine)).join(", ")}.
      </p>
    </>
  );
}
