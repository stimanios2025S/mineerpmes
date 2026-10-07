"use server";

import { revalidatePath } from "next/cache";
import type { Factory } from "@prisma/client";
import { prisma } from "@/lib/db";
import { conflit, validation } from "@/lib/errors";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { exigerPermission, exigerPermissionEtUsine } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  decimalObligatoire,
  entierOu,
  executer,
  texteObligatoire,
  texteOuNull,
  type ResultatAction,
} from "@/lib/actions/resultat";

/**
 * Creation complete d'un produit, en une seule operation.
 *
 * Un produit, c'est trois choses creees ensemble :
 *   1. l'article lui-meme (produit fini, fabricable, rattache a une usine) ;
 *   2. sa chaine de fabrication, construite en selectionnant des etapes qui
 *      existent DEJA dans le referentiel de l'usine (la coupe, etc.) ;
 *   3. sa nomenclature, construite en selectionnant des matieres premieres
 *      qui existent DEJA dans le referentiel de l'usine.
 *
 * Regle centrale : rien n'est invente depuis ce formulaire. L'administrateur
 * choisit dans ce qui existe, et chaque etape comme chaque matiere premiere est
 * reverifiee cote serveur contre l'usine du produit. Une etape MOBILIX ne peut
 * donc pas entrer dans la chaine d'un produit ADMEDCO, meme si le formulaire
 * est falsifie : le controle ne repose jamais sur l'affichage.
 */

const ETAPES_MAXIMUM = 60;
const COMPOSANTS_MAXIMUM = 200;

/** Identifiants coches dans un groupe de cases, dedoublonnes et ordonnes. */
function identifiantsCoches(formData: FormData, champ: string): number[] {
  const valeurs = formData
    .getAll(champ)
    .map((valeur) => entierOu(valeur, null))
    .filter((valeur): valeur is number => valeur !== null && valeur > 0);
  return [...new Set(valeurs)];
}

/** Verifie une division saisie, et que le compte peut reellement y ecrire. */
async function divisionAutorisee(formData: FormData): Promise<Factory> {
  const saisie = texteOuNull(formData.get("division"));
  const divisions: readonly Factory[] = ["ADMEDCO", "MOBILIX"];
  const factory = saisie === null ? undefined : divisions.find((valeur) => valeur === saisie);

  if (!factory) {
    throw validation("Selectionnez la division du produit.", {
      division: "Division manquante ou inconnue.",
    });
  }

  // Verifie la permission ET l'appartenance de l'usine au perimetre du compte.
  await exigerPermissionEtUsine(PERMISSIONS.NOMENCLATURE_ECRIRE, factory);
  return factory;
}

export async function actionCreerProduit(formData: FormData): Promise<ResultatAction> {
  return executer(
    "Le produit a ete cree : article, chaine de fabrication et nomenclature sont en brouillon.",
    async () => {
      const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_ECRIRE);
      const factory = await divisionAutorisee(formData);

      // Creer un article et construire une chaine sont des actions distinctes.
      await exigerPermission(PERMISSIONS.ARTICLE_ECRIRE);
      await exigerPermission(PERMISSIONS.GAMME_GERER);

      const codeArticle = texteObligatoire(formData.get("code"), "code du produit");
      const libelle = texteObligatoire(formData.get("libelle"), "nom du produit");
      const unite = texteOuNull(formData.get("unite"));

      const codeChaine = texteObligatoire(formData.get("codeChaine"), "code de la chaine");
      const libelleChaine = texteOuNull(formData.get("libelleChaine")) ?? `${libelle} - chaine`;

      const codeNomenclature =
        texteOuNull(formData.get("codeNomenclature")) ?? `${codeArticle}-N1`;
      const libelleNomenclature =
        texteOuNull(formData.get("libelleNomenclature")) ?? `${libelle} - nomenclature`;

      const etapesChoisies = identifiantsCoches(formData, "etape");
      const composantsChoisis = identifiantsCoches(formData, "composant");

      if (etapesChoisies.length > ETAPES_MAXIMUM) {
        throw validation(`${ETAPES_MAXIMUM} etapes au maximum dans une chaine.`, {
          etape: "Trop d'etapes selectionnees.",
        });
      }
      if (composantsChoisis.length > COMPOSANTS_MAXIMUM) {
        throw validation(`${COMPOSANTS_MAXIMUM} matieres au maximum dans une nomenclature.`, {
          composant: "Trop de matieres selectionnees.",
        });
      }
      if (etapesChoisies.length === 0) {
        throw validation(
          "Une chaine de fabrication comporte au moins une etape : selectionnez les etapes du produit.",
          { etape: "Aucune etape selectionnee." },
        );
      }

      const acteur = { id: utilisateur.id, email: utilisateur.email };

      const resultat = await prisma.$transaction(async (tx) => {
        // --- 1. Unicite des codes ------------------------------------------
        const doublonArticle = await tx.item.findUnique({
          where: { code: codeArticle },
          select: { id: true },
        });
        if (doublonArticle) {
          throw conflit(
            `Le code produit « ${codeArticle} » est deja utilise par un article existant.`,
          );
        }
        const doublonChaine = await tx.productRoute.findUnique({
          where: { code: codeChaine },
          select: { id: true },
        });
        if (doublonChaine) {
          throw conflit(`Le code de chaine « ${codeChaine} » est deja utilise.`);
        }
        const doublonNomenclature = await tx.formula.findFirst({
          where: { code: codeNomenclature },
          select: { id: true },
        });
        if (doublonNomenclature) {
          throw conflit(`Le code de nomenclature « ${codeNomenclature} » est deja utilise.`);
        }

        if (unite !== null) {
          const uniteReference = await tx.unitOfMeasure.findUnique({
            where: { code: unite },
            select: { code: true },
          });
          if (!uniteReference) {
            throw validation(`L'unite « ${unite} » est introuvable dans le referentiel.`, {
              unite: "Unite inconnue.",
            });
          }
        }

        // --- 2. Etapes verifiees contre l'usine du produit ------------------
        const etapesReference = await tx.operation.findMany({
          where: { id: { in: etapesChoisies } },
          select: { id: true, code: true, label: true, factory: true, isActive: true, sequenceOrder: true },
        });

        if (etapesReference.length !== etapesChoisies.length) {
          throw validation(
            "Une des etapes selectionnees est introuvable dans le referentiel.",
            { etape: "Etape inconnue." },
          );
        }

        for (const operation of etapesReference) {
          if (!operation.isActive) {
            throw validation(
              `L'etape « ${operation.label} » est desactivee : elle ne peut pas entrer dans une nouvelle chaine.`,
              { etape: `Etape inactive : ${operation.code}.` },
            );
          }
          if (operation.factory !== factory && operation.factory !== "COMMUN") {
            throw validation(
              `L'etape « ${operation.label} » appartient a une autre division : elle ne peut pas entrer dans la chaine d'un produit ${factory}.`,
              { etape: `Etape hors division : ${operation.code}.` },
            );
          }
        }

        // L'ordre de la chaine suit l'ordre de reference des etapes, jamais
        // l'ordre d'arrivee du formulaire, qui n'est pas fiable.
        const etapesOrdonnees = [...etapesReference].sort(
          (a, b) => a.sequenceOrder - b.sequenceOrder || a.code.localeCompare(b.code),
        );

        // --- 3. Matieres premieres verifiees contre l'usine -----------------
        const matieresReference = await tx.item.findMany({
          where: { id: { in: composantsChoisis } },
          select: {
            id: true,
            code: true,
            label1: true,
            factory: true,
            unitCode: true,
            status: true,
          },
        });

        if (matieresReference.length !== composantsChoisis.length) {
          throw validation(
            "Une des matieres premieres selectionnees est introuvable dans le referentiel.",
            { composant: "Article inconnu." },
          );
        }

        const lignes = composantsChoisis.map((itemId, index) => {
          const article = matieresReference.find((candidat) => candidat.id === itemId);
          if (!article) {
            throw validation(`La matiere premiere de la ligne ${index + 1} est introuvable.`, {
              composant: "Article inconnu.",
            });
          }
          if (article.status !== "ACTIF") {
            throw validation(
              `L'article « ${article.label1} » n'est pas actif : il ne peut pas entrer dans une nouvelle nomenclature.`,
              { composant: `Article inactif : ${article.code}.` },
            );
          }
          if (article.factory !== factory && article.factory !== "COMMUN") {
            throw validation(
              `L'article « ${article.label1} » appartient a une autre division : il ne peut pas entrer dans la nomenclature d'un produit ${factory}.`,
              { composant: `Article hors division : ${article.code}.` },
            );
          }
          const quantiteSaisie = texteOuNull(formData.get(`qte_${itemId}`));
          return {
            componentItemId: article.id,
            quantity: decimalObligatoire(quantiteSaisie, `quantite de ${article.code}`),
            unitCode: article.unitCode,
          };
        });

        // --- 4. Article produit fini ----------------------------------------
        const article = await tx.item.create({
          data: {
            code: codeArticle,
            label1: libelle,
            type: "PRODUIT_FINI",
            status: "ACTIF",
            factory,
            unitCode: unite,
            isProducible: true,
            isRawMaterial: false,
            isPurchasable: false,
            isSellable: true,
          },
        });

        await enregistrerAudit(
          {
            action: ACTIONS_AUDIT.CREATION,
            module: MODULES_AUDIT.REFERENTIEL,
            entity: "Item",
            entityId: article.id,
            userId: acteur.id,
            userEmail: acteur.email,
            newValue: article,
            comment: `Creation du produit ${article.code} (${libelle}) pour la division ${factory}`,
          },
          tx,
        );

        // --- 5. Chaine de fabrication ---------------------------------------
        const chaine = await tx.productRoute.create({
          data: {
            code: codeChaine,
            label: libelleChaine,
            itemId: article.id,
            version: 1,
            status: "BROUILLON",
            factory,
            isDefault: true,
          },
        });

        let rang = 1;
        for (const etape of etapesOrdonnees) {
          await tx.routeStep.create({
            data: {
              routeId: chaine.id,
              stepNo: rang,
              operationId: etape.id,
              standardTimeMinutes: 0,
              isFinalStep: rang === etapesOrdonnees.length,
            },
          });
          rang += 1;
        }

        await enregistrerAudit(
          {
            action: ACTIONS_AUDIT.CREATION,
            module: MODULES_AUDIT.NOMENCLATURE,
            entity: "ProductRoute",
            entityId: chaine.id,
            userId: acteur.id,
            userEmail: acteur.email,
            newValue: chaine,
            comment: `Chaine ${chaine.code} du produit ${article.code} : ${etapesOrdonnees.length} etape(s) du referentiel ${factory}`,
          },
          tx,
        );

        // --- 6. Nomenclature -------------------------------------------------
        const nomenclature = await tx.formula.create({
          data: {
            code: codeNomenclature,
            label: libelleNomenclature,
            itemId: article.id,
            version: 1,
            status: "BROUILLON",
            isDefault: true,
          },
        });

        let ligneNo = 1;
        for (const ligne of lignes) {
          await tx.formulaLine.create({
            data: {
              formulaId: nomenclature.id,
              lineNo: ligneNo,
              componentItemId: ligne.componentItemId,
              quantity: ligne.quantity,
              unitCode: ligne.unitCode,
            },
          });
          ligneNo += 1;
        }

        await enregistrerAudit(
          {
            action: ACTIONS_AUDIT.CREATION,
            module: MODULES_AUDIT.NOMENCLATURE,
            entity: "Formula",
            entityId: nomenclature.id,
            userId: acteur.id,
            userEmail: acteur.email,
            newValue: nomenclature,
            comment: `Nomenclature ${nomenclature.code} du produit ${article.code} : ${lignes.length} matiere(s) premiere(s)`,
          },
          tx,
        );

        return {
          articleId: article.id,
          code: article.code,
          chaineId: chaine.id,
          nomenclatureId: nomenclature.id,
          etapes: etapesOrdonnees.length,
          composants: lignes.length,
        };
      });

      revalidatePath("/production/nouveau-produit");
      revalidatePath("/nomenclature");
      revalidatePath("/nomenclature/gammes");
      revalidatePath("/production");
      return resultat;
    },
  );
}
