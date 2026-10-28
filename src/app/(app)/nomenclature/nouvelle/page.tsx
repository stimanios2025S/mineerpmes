import Link from "next/link";
import type { Factory } from "@prisma/client";
import { prisma } from "@/lib/db";
import { exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { Alerte, Carte, EnTetePage } from "@/components/ui";
import { AssistantNomenclature } from "@/components/assistant-nomenclature";
import { LIBELLES_USINE, libelle } from "@/lib/libelles";

export const metadata = { title: "Nouvelle nomenclature" };

/**
 * Creation d'un produit : matieres, operations, identite.
 *
 * Les listes proposees viennent du referentiel de l'usine : on ne saisit pas
 * une matiere ni une operation qui n'existe pas. Le serveur revalide tout.
 */
export default async function PageNouvelleNomenclature() {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_ECRIRE);

  const divisions: Factory[] = usinesAutorisees(utilisateur).filter(
    (usine): usine is "ADMEDCO" | "MOBILIX" =>
      usine === "ADMEDCO" || usine === "MOBILIX",
  );

  if (divisions.length === 0) {
    return (
      <>
        <EnTetePage titre="Nouvelle nomenclature" />
        <Alerte ton="danger" titre="Aucune division dans votre perimetre">
          Votre compte n&apos;est rattache a aucune usine : la creation d&apos;un
          produit est impossible. Contactez l&apos;administration.
        </Alerte>
      </>
    );
  }

  const portee: Factory[] =
    divisions.length === 1 ? [divisions[0], "COMMUN"] : [...divisions, "COMMUN"];

  /*
   * Seules les familles de produits finis sont proposees : une nomenclature
   * decrit un produit fini, jamais une matiere premiere. Les familles filles de
   * « PRODUIT FINI » sont donc les seules utiles ici.
   */
  const familleProduits = await prisma.itemFamily.findFirst({
    where: { code: "002" },
    select: { id: true },
  });

  const [matieres, operations, familles] = await Promise.all([
    prisma.item.findMany({
      where: {
        status: "ACTIF",
        factory: { in: portee },
        OR: [{ isRawMaterial: true }, { type: "COMPOSANT" }, { type: "MATIERE_PREMIERE" }],
      },
      orderBy: { code: "asc" },
      take: 1500,
      select: { id: true, code: true, label1: true, unitCode: true, factory: true },
    }),
    prisma.operation.findMany({
      where: { isActive: true, factory: { in: portee } },
      orderBy: [{ sequenceOrder: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        label: true,
        factory: true,
        workshop: { select: { label: true } },
      },
    }),
    prisma.itemFamily.findMany({
      where: {
        OR: [
          ...(familleProduits ? [{ parentId: familleProduits.id }] : []),
          { code: "FAM-PF" },
        ],
      },
      orderBy: { label: "asc" },
      select: { id: true, code: true, label: true },
    }),
  ]);

  return (
    <>
      <EnTetePage
        titre="Nouvelle nomenclature"
        description="Trois etapes : ce que le produit consomme, les operations qu'il traverse, puis son identite."
        actions={
          <Link className="bouton secondaire" href="/nomenclature">
            Retour aux nomenclatures
          </Link>
        }
      />

      {operations.length === 0 ? (
        <Alerte ton="alerte" titre="Aucune operation dans le referentiel">
          Un produit ne peut pas etre cree sans operation : declarez d&apos;abord les
          operations de votre usine.
        </Alerte>
      ) : (
        <Carte>
          <AssistantNomenclature
            divisions={divisions.map((code) => ({
              code,
              libelle: libelle(LIBELLES_USINE, code),
            }))}
            divisionImposee={divisions.length === 1 ? divisions[0] : null}
            matieres={matieres.map((matiere) => ({
              id: matiere.id,
              code: matiere.code,
              label: matiere.label1,
              unitCode: matiere.unitCode,
              factory: matiere.factory,
            }))}
            operations={operations.map((operation) => ({
              id: operation.id,
              code: operation.code,
              label: operation.label,
              workshop: operation.workshop?.label ?? null,
              factory: operation.factory,
            }))}
            familles={familles}
          />
        </Carte>
      )}
    </>
  );
}
