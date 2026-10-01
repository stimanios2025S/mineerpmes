"use client";

import { SignaturePad } from "./signature-pad";
import { actionSignerMagasinier, actionSignerChefAtelier } from "@/actions/signature";

export function SignatureMagasinier({ workOrderId }: { workOrderId: number }) {
  return (
    <SignaturePad
      label="Signature du magasinier"
      onSave={async (sig) => { await actionSignerMagasinier(workOrderId, sig); }}
    />
  );
}

export function SignatureChefAtelier({ workOrderId }: { workOrderId: number }) {
  return (
    <SignaturePad
      label="Signature du chef d atelier"
      ton="alerte"
      onSave={async (sig) => { await actionSignerChefAtelier(workOrderId, sig); }}
    />
  );
}
