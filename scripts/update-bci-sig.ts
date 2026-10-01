import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/stock/bci/[id]/page.tsx";
let c = fs.readFileSync(f, "utf8");

// Add import for signature components
c = c.replace(
  'import { BoutonImprimer } from "@/components/bouton-imprimer";',
  'import { BoutonImprimer } from "@/components/bouton-imprimer";\nimport { SignatureMagasinier, SignatureChefAtelier } from "@/components/signature-bci";',
);

// Add signature fields to the include
c = c.replace(
  "      item: true,",
  "      item: true,\n      signatureMagasinier: true,\n      signatureMagasinierAt: true,\n      signatureChefAtelier: true,\n      signatureChefAtelierAt: true,",
);

// Replace the static signature section with interactive signature pads
const oldSigs = `        <div className="grid grid-cols-2 gap-8 mt-8 pt-4 border-t-2 border-black">
          <div>
            <p className="text-sm font-bold mb-12">Magasinier</p>
            <div className="border-t border-black w-48">&nbsp;</div>
            <p className="text-xs mt-1">Nom et signature</p>
          </div>
          <div>
            <p className="text-sm font-bold mb-12">Chef d atelier</p>
            <div className="border-t border-black w-48">&nbsp;</div>
            <p className="text-xs mt-1">Nom et signature - Reception confirmee</p>
          </div>
        </div>`;

const newSigs = `        {/* Signatures electroniques */}
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
        </div>`;

c = c.replace(oldSigs, newSigs);

fs.writeFileSync(f, c, "utf8");
console.log("BCI page updated with electronic signatures");
