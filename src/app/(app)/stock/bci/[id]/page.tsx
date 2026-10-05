import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { EnTetePage, Etiquette } from "@/components/ui";
import { formatDate, formatQuantite } from "@/lib/format";
import { BoutonImprimer } from "@/components/bouton-imprimer";
import { SignatureMagasinier, SignatureChefAtelier } from "@/components/signature-bci";

export const metadata = { title: "Bon de Commande Interne" };

export default async function PageBCI({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigerPermission(PERMISSIONS.STOCK_LIRE);
  const { id } = await params;
  const workOrderId = Number(id);
  if (isNaN(workOrderId)) notFound();

  const of = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      item: true,
      materials: {
        where: { isLabor: false },
        include: {
          componentItem: { select: { code: true, label1: true } },
        },
        orderBy: { lineNo: "asc" },
      },
    },
  });
  if (!of) notFound();

  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2,"0")}/${String(now.getMonth()+1).padStart(2,"0")}/${now.getFullYear()}`;
  const heureStr = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #bci, #bci * { visibility: visible; }
          #bci { position: absolute; left: 0; top: 0; width: 100%; padding: 20px; }
          .no-print { display: none !important; }
          table { border-collapse: collapse; width: 100%; }
          td, th { border: 1px solid #333; padding: 6px 10px; font-size: 12px; }
          th { background: #f0f0f0; }
        }
      `}</style>

      <div className="no-print">
        <EnTetePage
          titre={`BCI ${of.number}`}
          description="Bon de Commande Interne"
          actions={
            <BoutonImprimer />
          }
        />
      </div>

      <div id="bci" className="rounded-lg border bg-white p-6 text-black">
        <div className="flex items-start justify-between border-b-2 border-black pb-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold">BON DE COMMANDE INTERNE</h1>
            <p className="text-sm mt-1">N {of.number}</p>
            <p className="text-sm">Date : {dateStr} a {heureStr}</p>
          </div>
          <div className="text-right">
            <p className="text-sm"><strong>Division :</strong> {of.factory}</p>
            <p className="text-sm"><strong>Statut :</strong> {of.status}</p>
            <p className="text-sm"><strong>Priorite :</strong> {of.priority}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div>
            <p><strong>Article :</strong> {of.item.code} - {of.item.label1}</p>
            <p><strong>Quantite planifiee :</strong> {formatQuantite(of.quantityPlanned)}</p>
          </div>
          <div>
            {of.dueDate && <p><strong>Echeance :</strong> {formatDate(of.dueDate)}</p>}
          </div>
        </div>

        <table className="w-full text-sm mb-4">
          <thead>
            <tr>
              <th className="text-left">N</th>
              <th className="text-left">Code</th>
              <th className="text-left">Designation</th>
              <th className="text-left">Depot</th>
              <th className="text-right">Qte requise</th>
              <th className="text-right">Qte livree</th>
              <th className="text-center">Etat</th>
            </tr>
          </thead>
          <tbody>
            {of.materials.map((mat, i) => (
              <tr key={mat.id}>
                <td>{i + 1}</td>
                <td className="font-mono">{mat.componentItem.code}</td>
                <td>{mat.componentItem.label1}</td>
                <td>{mat.warehouseId ? "Depot" : "-"}</td>
                <td className="text-right">{formatQuantite(mat.quantityPlanned)}</td>
                <td className="text-right">{formatQuantite(mat.quantityIssued)}</td>
                <td className="text-center">
                  {Number(mat.quantityIssued) >= Number(mat.quantityPlanned) ? (
                    <Etiquette ton="succes">Livree</Etiquette>
                  ) : Number(mat.quantityIssued) > 0 ? (
                    <Etiquette ton="alerte">Partielle</Etiquette>
                  ) : (
                    <Etiquette ton="info">En attente</Etiquette>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Signatures electroniques */}
        <div className="mt-8 pt-4 border-t-2 border-black">
          <h3 className="text-lg font-bold mb-4">Signatures electroniques</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              {of.signatureMagasinier ? (
                <div className="p-4 rounded-lg border" style={{ borderColor: "var(--succes)" }}>
                  <p className="text-sm font-bold mb-2" style={{ color: "var(--succes)" }}>
                    ? Magasinier - signe le {of.signatureMagasinierAt ? new Date(of.signatureMagasinierAt).toLocaleString("fr-FR") : ""}
                  </p>
                  <img src={of.signatureMagasinier} alt="Signature magasinier" style={{ maxHeight: 80 }} />
                </div>
              ) : (
                <SignatureMagasinier workOrderId={of.id} />
              )}
            </div>
            <div>
              {of.signatureChefAtelier ? (
                <div className="p-4 rounded-lg border" style={{ borderColor: "var(--succes)" }}>
                  <p className="text-sm font-bold mb-2" style={{ color: "var(--succes)" }}>
                    ? Chef d&apos;atelier - signe le {of.signatureChefAtelierAt ? new Date(of.signatureChefAtelierAt).toLocaleString("fr-FR") : ""}
                  </p>
                  <img src={of.signatureChefAtelier} alt="Signature chef atelier" style={{ maxHeight: 80 }} />
                </div>
              ) : (
                <SignatureChefAtelier workOrderId={of.id} />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
