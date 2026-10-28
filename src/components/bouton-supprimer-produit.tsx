"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actionSupprimerProduit } from "@/actions/produit";

/**
 * Suppression d'un produit depuis sa carte.
 *
 * Aucune justification n'est demandee. Le retour du serveur est affiche tel
 * quel : si la fabrication a deja touche ce produit, la suppression est
 * refusee et il faut le savoir — sinon on croit l'avoir supprime.
 */
export function BoutonSupprimerProduit({ itemId, code }: { itemId: number; code: string }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const supprimer = () => {
    const donnees = new FormData();
    donnees.set("itemId", String(itemId));
    demarrer(async () => {
      const resultat = await actionSupprimerProduit(donnees);
      setMessage({ ok: resultat.ok, texte: resultat.message });
      if (resultat.ok) router.refresh();
    });
  };

  return (
    <span>
      <button type="button" className="bouton" onClick={supprimer} disabled={enCours}>
        {enCours ? "..." : "Supprimer"}
      </button>
      {message && !message.ok && (
        <span
          className="mt-1 block text-xs"
          style={{ color: "var(--danger)" }}
          role="alert"
        >
          {code} : {message.texte}
        </span>
      )}
    </span>
  );
}
