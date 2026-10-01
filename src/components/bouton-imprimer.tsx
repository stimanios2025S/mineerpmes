"use client";

export function BoutonImprimer() {
  return (
    <button
      onClick={() => window.print()}
      className="bouton primaire"
      style={{ minHeight: 48, fontSize: 16 }}
    >
      Imprimer / PDF
    </button>
  );
}
