import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { BoutonImprimer } from "@/components/bouton-imprimer";
import { formatDate, formatQuantite } from "@/lib/format";
import { LIBELLES_USINE, libelle } from "@/lib/libelles";

export const metadata = { title: "Fiche technique" };

/**
 * Fiche technique d'un produit, prete a imprimer ou a enregistrer en PDF.
 *
 * Elle rassemble ce qu'un atelier doit savoir : a quoi ressemble le produit,
 * ce qu'il consomme, et par quelles operations il passe. Le dessin technique
 * y figure en grand — c'est lui qui montre ou centrer et ou percer.
 */
export default async function PageFicheTechnique({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigerPermission(PERMISSIONS.ARTICLE_LIRE);

  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) notFound();

  const article = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      code: true,
      label1: true,
      designation: true,
      type: true,
      factory: true,
      photoFile: true,
      drawingFile: true,
      unitCode: true,
      unitWeight: true,
      width: true,
      length: true,
      height: true,
      thickness: true,
      family: { select: { code: true, label: true } },
      unit: { select: { code: true, label: true } },
      formulaParents: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          code: true,
          version: true,
          lines: {
            orderBy: { lineNo: "asc" },
            select: {
              lineNo: true,
              quantity: true,
              unitCode: true,
              componentItem: { select: { code: true, label1: true } },
            },
          },
        },
      },
      routes: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          code: true,
          version: true,
          steps: {
            orderBy: { stepNo: "asc" },
            select: {
              stepNo: true,
              operation: { select: { code: true, label: true } },
              workCenter: { select: { code: true, label: true } },
              standardTimeMinutes: true,
            },
          },
        },
      },
    },
  });

  if (!article) notFound();

  const nomenclature = article.formulaParents[0] ?? null;
  const gamme = article.routes[0] ?? null;
  const estPdf = article.drawingFile?.toLowerCase().endsWith(".pdf") ?? false;

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #fiche, #fiche * { visibility: visible; }
          #fiche { position: absolute; left: 0; top: 0; width: 100%; padding: 16px; }
          .no-print { display: none !important; }
          .saut { page-break-before: always; }
          table { border-collapse: collapse; width: 100%; }
          td, th { border: 1px solid #999; padding: 5px 8px; font-size: 11px; }
          th { background: #eee; text-align: left; }
        }
      `}</style>

      <div id="fiche">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--texte-doux)" }}>
              Fiche technique
            </p>
            <h1 className="mt-1 text-2xl font-semibold">
              {article.code} — {article.label1}
            </h1>
            <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
              {article.family ? `${article.family.code} — ${article.family.label} · ` : ""}
              {libelle(LIBELLES_USINE, article.factory)}
            </p>
          </div>
          <div className="no-print flex gap-2">
            <BoutonImprimer />
            <Link className="bouton secondaire" href={`/referentiel/articles/${article.id}`}>
              Retour a la fiche
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-[var(--rayon-petit)] border p-3">
            <p className="mb-2 text-xs font-semibold uppercase" style={{ color: "var(--texte-doux)" }}>
              Photo du produit
            </p>
            {article.photoFile ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/articles/${article.id}/media/photo`}
                alt={article.label1}
                className="w-full rounded-[var(--rayon-petit)] object-contain"
                style={{ maxHeight: 320 }}
              />
            ) : (
              <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                Aucune photo deposee.
              </p>
            )}
          </div>

          <div className="rounded-[var(--rayon-petit)] border p-3">
            <p className="mb-2 text-xs font-semibold uppercase" style={{ color: "var(--texte-doux)" }}>
              Dessin technique
            </p>
            {article.drawingFile ? (
              estPdf ? (
                <p className="text-sm">Dessin fourni au format PDF — voir le fichier joint.</p>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/articles/${article.id}/media/dessin`}
                  alt={`Dessin technique ${article.code}`}
                  className="w-full rounded-[var(--rayon-petit)] object-contain"
                  style={{ maxHeight: 320 }}
                />
              )
            ) : (
              <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                Aucun dessin depose.
              </p>
            )}
          </div>
        </div>

        <table className="mt-5 w-full text-sm">
          <tbody>
            <tr>
              <th style={{ width: "25%" }}>Unite</th>
              <td>{article.unit ? `${article.unit.code} — ${article.unit.label}` : "-"}</td>
              <th style={{ width: "25%" }}>Poids unitaire</th>
              <td>{formatQuantite(article.unitWeight)} kg</td>
            </tr>
            <tr>
              <th>Dimensions (L × l × H)</th>
              <td>
                {formatQuantite(article.length)} × {formatQuantite(article.width)} ×{" "}
                {formatQuantite(article.height)} mm
              </td>
              <th>Epaisseur</th>
              <td>{formatQuantite(article.thickness)} mm</td>
            </tr>
          </tbody>
        </table>

        <h2 className="mt-6 mb-2 text-lg font-semibold">Matieres consommees</h2>
        {nomenclature && nomenclature.lines.length > 0 ? (
          <>
            <p className="mb-2 text-sm" style={{ color: "var(--texte-doux)" }}>
              Nomenclature {nomenclature.code} v{nomenclature.version} —{" "}
              {nomenclature.lines.length} ligne(s).
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Code</th>
                  <th>Designation</th>
                  <th>Quantite</th>
                  <th>Unite</th>
                </tr>
              </thead>
              <tbody>
                {nomenclature.lines.map((ligne) => (
                  <tr key={ligne.lineNo}>
                    <td>{ligne.lineNo}</td>
                    <td className="font-mono">{ligne.componentItem.code}</td>
                    <td>{ligne.componentItem.label1}</td>
                    <td>{formatQuantite(ligne.quantity)}</td>
                    <td>{ligne.unitCode ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
            Aucune nomenclature rattachee a ce produit.
          </p>
        )}

        <h2 className="mt-6 mb-2 text-lg font-semibold">Operations de fabrication</h2>
        {gamme && gamme.steps.length > 0 ? (
          <>
            <p className="mb-2 text-sm" style={{ color: "var(--texte-doux)" }}>
              Chaine {gamme.code} v{gamme.version} — {gamme.steps.length} etape(s).
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>Etape</th>
                  <th>Operation</th>
                  <th>Poste</th>
                  <th>Temps standard</th>
                </tr>
              </thead>
              <tbody>
                {gamme.steps.map((etape) => (
                  <tr key={etape.stepNo}>
                    <td>{etape.stepNo}</td>
                    <td>
                      {etape.operation.code} — {etape.operation.label}
                    </td>
                    <td>{etape.workCenter?.label ?? "-"}</td>
                    <td>{formatQuantite(etape.standardTimeMinutes)} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
            Aucune gamme rattachee a ce produit.
          </p>
        )}

        <p className="mt-8 text-xs" style={{ color: "var(--texte-doux)" }}>
          Fiche generee le {formatDate(new Date())} — ERP MES ADMEDCO / MOBILIX.
        </p>
      </div>
    </>
  );
}
