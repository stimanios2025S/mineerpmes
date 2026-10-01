"use client";

import { useEffect, useState } from "react";

export function ScannerQR() {
  const [erreur, setErreur] = useState<string | null>(null);
  const [scanne, setScanne] = useState<string | null>(null);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    if (scanne) return;
    let html5QrCode: any = null;
    let demarre = false;
    let annule = false;

    async function demarrer() {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (annule) return;
        html5QrCode = new Html5Qrcode("qr-reader");
        if (annule) return;
        await html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
          (decodedText: string) => {
            let token = decodedText;
            const match = decodedText.match(/\/portail\/poste\/([^/?#]+)/);
            if (match) { token = match[1]; }
            if (token && token.length > 5 && !scanne) {
              setScanne(token);
              try { html5QrCode?.stop(); } catch {}
              const ua = encodeURIComponent(navigator.userAgent);
              window.location.href = "/portail/poste/" + encodeURIComponent(token) + "?ua=" + ua;
            }
          },
          () => {},
        );
        demarre = true;
        if (!annule) setPret(true);
      } catch (e: any) {
        if (!annule) {
          const msg = e?.message ?? "";
          if (msg.includes("Permission") || msg.includes("NotAllowedError")) {
            setErreur("Camera non autorisee. Activez l autorisation camera dans les parametres de votre navigateur.");
          } else if (msg.includes("NotFoundError")) {
            setErreur("Aucune camera detectee. Verifiez que votre appareil a une camera.");
          } else {
            setErreur("Impossible d ouvrir la camera. " + msg);
          }
        }
      }
    }

    demarrer();
    return () => {
      annule = true;
      if (demarre && html5QrCode) {
        try { html5QrCode.stop(); } catch {}
        try { html5QrCode.clear(); } catch {}
      }
    };
  }, [scanne]);

  if (scanne) {
    return (
      <div className="text-center p-6">
        <div className="text-4xl mb-4">✅</div>
        <p className="text-lg font-bold">Poste reconnu !</p>
        <p className="text-sm opacity-70 mt-2">Chargement de votre programme...</p>
      </div>
    );
  }

  if (erreur) {
    return (
      <div className="text-center p-4">
        <div className="text-3xl mb-3">📷</div>
        <p className="text-sm text-red-500 mb-4">{erreur}</p>
        <button onClick={() => { setErreur(null); setPret(false); }} className="bouton secondaire" style={{ minHeight: 56, fontSize: 18, padding: "12px 32px" }}>
          Reessayer
        </button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div id="qr-reader" style={{ width: "100%", maxWidth: 400, margin: "0 auto", borderRadius: 12, overflow: "hidden" }} />
      {!pret && <p className="text-sm mt-3 opacity-60">Ouverture de la camera...</p>}
      {pret && <p className="text-xs mt-3 opacity-60">Pointez votre camera vers le QR affiche sur votre machine</p>}
    </div>
  );
}
