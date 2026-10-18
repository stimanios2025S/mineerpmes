"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { echec, succes, type ResultatAction } from "@/lib/actions/resultat";
import {
  FORMATS,
  TAILLE_MAX,
  enregistrerMedia,
  supprimerMedia,
  type TypeMedia,
} from "@/lib/media/articles";

/**
 * Pieces jointes d'un article : photo du produit et dessin technique.
 *
 * Un seul fichier par emplacement : deposer un nouveau remplace l'ancien, qui
 * est efface du disque apres l'ecriture en base. Le controle d'acces est refait
 * ici avec la permission d'ecriture du referentiel, et chaque depot laisse une
 * trace dans le journal d'audit — sans le contenu du fichier.
 */

function estTypeMedia(valeur: unknown): valeur is TypeMedia {
  return valeur === "photo" || valeur === "dessin";
}

export async function actionDeposerMedia(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.ARTICLE_ECRIRE);

  const itemId = Number(formData.get("itemId"));
  const type = formData.get("type");
  const fichier = formData.get("fichier");

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return echec("Article invalide.");
  }
  if (!estTypeMedia(type)) {
    return echec("Emplacement de piece jointe inconnu.");
  }
  if (!(fichier instanceof File) || fichier.size === 0) {
    return echec("Choisissez un fichier avant d'envoyer.");
  }
  if (fichier.size > TAILLE_MAX) {
    return echec("Fichier trop volumineux : 10 Mo maximum.");
  }
  if (!FORMATS[type].includes(fichier.type)) {
    return echec(
      type === "photo"
        ? "Format non accepte : JPEG, PNG ou WebP."
        : "Format non accepte : JPEG, PNG, WebP ou PDF.",
    );
  }

  const article = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, code: true, photoFile: true, drawingFile: true },
  });
  if (!article) {
    return echec("Article introuvable.");
  }

  const donnees = Buffer.from(await fichier.arrayBuffer());
  const enregistre = await enregistrerMedia(itemId, type, fichier.name, fichier.type, donnees);

  const ancien = type === "photo" ? article.photoFile : article.drawingFile;
  await prisma.item.update({
    where: { id: itemId },
    data:
      type === "photo"
        ? { photoFile: enregistre.fichier, photoName: enregistre.nom }
        : { drawingFile: enregistre.fichier, drawingName: enregistre.nom },
  });

  await supprimerMedia(ancien);

  await enregistrerAudit({
    action: ACTIONS_AUDIT.MODIFICATION,
    module: MODULES_AUDIT.REFERENTIEL,
    entity: "Item",
    entityId: itemId,
    userId: utilisateur.id,
    userEmail: utilisateur.email,
    oldValue: ancien ? { fichier: ancien } : null,
    newValue: { pieceJointe: type, fichier: enregistre.fichier, nom: enregistre.nom },
  });

  revalidatePath(`/referentiel/articles/${itemId}`);
  revalidatePath("/nomenclature");

  return succes(
    type === "photo" ? "Photo du produit enregistree." : "Dessin technique enregistre.",
  );
}

export async function actionRetirerMedia(formData: FormData): Promise<ResultatAction> {
  const utilisateur = await exigerPermission(PERMISSIONS.ARTICLE_ECRIRE);

  const itemId = Number(formData.get("itemId"));
  const type = formData.get("type");

  if (!Number.isInteger(itemId) || itemId <= 0 || !estTypeMedia(type)) {
    return echec("Demande invalide.");
  }

  const article = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, photoFile: true, drawingFile: true },
  });
  if (!article) {
    return echec("Article introuvable.");
  }

  const fichier = type === "photo" ? article.photoFile : article.drawingFile;
  if (!fichier) {
    return succes("Aucune piece jointe a retirer.");
  }

  await prisma.item.update({
    where: { id: itemId },
    data:
      type === "photo"
        ? { photoFile: null, photoName: null }
        : { drawingFile: null, drawingName: null },
  });

  await supprimerMedia(fichier);

  await enregistrerAudit({
    action: ACTIONS_AUDIT.SUPPRESSION_LOGIQUE,
    module: MODULES_AUDIT.REFERENTIEL,
    entity: "Item",
    entityId: itemId,
    userId: utilisateur.id,
    userEmail: utilisateur.email,
    oldValue: { pieceJointe: type, fichier },
    newValue: null,
  });

  revalidatePath(`/referentiel/articles/${itemId}`);
  revalidatePath("/nomenclature");

  return succes(type === "photo" ? "Photo retiree." : "Dessin technique retire.");
}
