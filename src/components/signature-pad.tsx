"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Signature electronique par dessin sur canvas.
 * L operateur dessine avec le doigt ou la souris.
 * La signature est sauvegardee en base64 PNG.
 */
export function SignaturePad({
  onSave,
  label,
  ton = "primaire",
}: {
  onSave: (signature: string) => Promise<void>;
  label: string;
  ton?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dessine, setDessine] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 400;
    canvas.height = 150;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 400, 150);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  function getPos(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setDessine(true);
  }

  function move(e: React.MouseEvent | React.TouchEvent) {
    if (!dessine) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function end() {
    setDessine(false);
  }

  function effacer() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 400, 150);
    setEnregistre(false);
    setErreur(null);
  }

  async function sauvegarder() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setEnCours(true);
    setErreur(null);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      await onSave(dataUrl);
      setEnregistre(true);
    } catch (e: any) {
      setErreur(e?.message ?? "Erreur lors de la signature.");
    } finally {
      setEnCours(false);
    }
  }

  if (enregistre) {
    return (
      <div className="text-center p-4 rounded-lg border" style={{ borderColor: "var(--succes)" }}>
        <div className="text-3xl mb-2">??</div>
        <p className="font-bold" style={{ color: "var(--succes)" }}>Signature enregistree</p>
        <button onClick={effacer} className="bouton secondaire mt-3" style={{ minHeight: 40 }}>
          Refaire la signature
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-bold mb-2">{label}</p>
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg border cursor-crosshair touch-none"
        style={{ height: 150, borderColor: "var(--bordure)", background: "#fff" }}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      {erreur && <p className="text-sm text-red-500 mt-2">{erreur}</p>}
      <div className="flex gap-2 mt-3">
        <button onClick={sauvegarder} disabled={enCours} className="bouton primaire" style={{ minHeight: 44 }}>
          {enCours ? "Signature..." : "Signer"}
        </button>
        <button onClick={effacer} className="bouton secondaire" style={{ minHeight: 44 }}>
          Effacer
        </button>
      </div>
    </div>
  );
}
