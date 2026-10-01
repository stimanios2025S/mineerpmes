import { prisma } from "@/lib/db";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { EnTetePage, Carte, Etiquette } from "@/components/ui";
import { urlScanPoste } from "@/lib/mes/qr";
import { BoutonImprimer } from "@/components/bouton-imprimer";

export const metadata = { title: "QR Codes des postes" };

function qrSvgLocal(contenu: string): string {
  // Simple QR as SVG using the qrcode library on the server
  // We render it inline using a data URL approach
  const encoded = Buffer.from(contenu).toString("base64");
  return `/api/qr/${encoded}`;
}

export default async function PageQrCodes() {
  await exigerPermission(PERMISSIONS.ADMINISTRER_SYSTEME);

  const postes = await prisma.workCenter.findMany({
    where: { isActive: true },
    include: { workshop: { select: { label: true, factory: true } } },
    orderBy: [{ factory: "asc" }, { id: "asc" }],
  });

  // Base URL from the request host
  const baseUrl = "http://192.168.0.200:3000";

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #qr-print, #qr-print * { visibility: visible; }
          #qr-print { position: absolute; left: 0; top: 0; width: 100%; padding: 10px; }
          .no-print { display: none !important; }
          .qr-card { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="no-print">
        <EnTetePage
          titre="QR Codes des postes"
          description="Imprimez ces QR et collez-les sur chaque poste de travail. Les operateurs les scannent avec leur telephone."
          actions={
            <BoutonImprimer />
          }
        />
      </div>

      <div id="qr-print" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {postes.map((poste) => {
          const url = poste.qrToken ? urlScanPoste(baseUrl, poste.qrToken) : null;
          return (
            <Carte key={poste.id} titre={poste.code}>
              <div className="text-center">
                <p className="text-sm font-bold mb-1">{poste.label}</p>
                <p className="text-xs mb-3" style={{color:"var(--texte-doux)"}}>
                  {poste.workshop?.label} � {poste.workshop?.factory ?? poste.factory}
                </p>

                {poste.qrToken ? (
                  <>
                    <img
                      src={`/api/qr/${encodeURIComponent(poste.qrToken)}`}
                      alt={`QR ${poste.code}`}
                      style={{ width: 200, height: 200, margin: "0 auto", display: "block" }}
                    />
                    <p className="text-xs mt-2 font-mono" style={{wordBreak:"break-all"}}>
                      {url}
                    </p>
                    <Etiquette ton="succes">Actif</Etiquette>
                  </>
                ) : (
                  <div className="p-4">
                    <p className="text-sm" style={{color:"var(--texte-doux)"}}>
                      Aucun QR genere pour ce poste.
                    </p>
                  </div>
                )}
              </div>
            </Carte>
          );
        })}
      </div>
    </>
  );
}
