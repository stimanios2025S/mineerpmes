import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { aLaPermission, utilisateurCourant } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { lireMedia, mimeDe } from "@/lib/media/articles";

/**
 * Sert la photo ou le dessin technique d'un article.
 *
 * Les fichiers ne sont pas dans `/public` : cette route verifie la session et
 * la permission de lecture du referentiel avant de renvoyer le contenu. Une
 * reponse `private` empeche tout cache partage de conserver le document.
 */
export async function GET(
  _requete: Request,
  contexte: { params: Promise<{ id: string; type: string }> },
) {
  const { id, type } = await contexte.params;

  if (type !== "photo" && type !== "dessin") {
    return new NextResponse("Introuvable", { status: 404 });
  }

  const utilisateur = await utilisateurCourant();
  if (!utilisateur) {
    return new NextResponse("Non authentifie", { status: 401 });
  }
  if (!aLaPermission(utilisateur, PERMISSIONS.ARTICLE_LIRE)) {
    return new NextResponse("Acces refuse", { status: 403 });
  }

  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return new NextResponse("Introuvable", { status: 404 });
  }

  const article = await prisma.item.findUnique({
    where: { id: itemId },
    select: { photoFile: true, photoName: true, drawingFile: true, drawingName: true },
  });
  if (!article) {
    return new NextResponse("Introuvable", { status: 404 });
  }

  const fichier = type === "photo" ? article.photoFile : article.drawingFile;
  const nom = type === "photo" ? article.photoName : article.drawingName;
  if (!fichier) {
    return new NextResponse("Introuvable", { status: 404 });
  }

  const contenu = await lireMedia(fichier);
  if (!contenu) {
    return new NextResponse("Fichier absent du disque", { status: 404 });
  }

  return new NextResponse(new Uint8Array(contenu), {
    headers: {
      "Content-Type": mimeDe(fichier),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(nom ?? "piece-jointe")}`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
