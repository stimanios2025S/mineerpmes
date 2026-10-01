import Link from "next/link";
import { prisma } from "@/lib/db";
import { aLaPermission, exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  actionGenererQrPoste,
  actionRevoquerQrPoste,
} from "@/actions/atelier";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  Statistique,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { listerPostes } from "@/lib/mes/postes";
import { formatDateTime } from "@/lib/format";
import { LIBELLES_USINE } from "@/lib/libelles";

export const metadata = { title: "QR des postes" };

/**
 * Administration des QR permanents des postes de travail.
 *
 * Un QR identifie un poste et rien d'autre. Il ne contient ni mot de passe, ni
 * donnee personnelle, ni tache figee. Revoquer un poste efface son jeton :
 * l'ancienne etiquette imprimee ne fonctionne plus, et elle est remplacee par
 * une nouvelle version.
 */
export default async function PagePostesQr() {
  const utilisateur = await exigerPermission(PERMISSIONS.POSTE_QR_GERER);
  const peutGerer = aLaPermission(utilisateur, PERMISSIONS.POSTE_QR_GERER);

  const postes = await listerPostes({ actifsSeulement: false });

  const avecQr = postes.filter((poste) => poste.qrToken !== null).length;
  const sansQr = postes.length - avecQr;
  const desactives = postes.filter((poste) => !poste.isActive).length;

  return (
    <>
      <EnTetePage
        titre="QR permanents des postes"
        description="Chaque poste de travail porte une etiquette permanente. L'operateur la scanne pour afficher son programme ; le serveur verifie ensuite qu'il est bien affecte a ce poste."
        actions={
          <Link className="bouton secondaire" href="/production/programme">
            Programme de travail
          </Link>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Statistique libelle="Postes avec QR actif" valeur={avecQr} />
        <Statistique libelle="Postes sans QR" valeur={sansQr} />
        <Statistique libelle="Postes desactives" valeur={desactives} />
      </div>

      {sansQr > 0 && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Etiquettes a produire">
            {sansQr} poste(s) n'ont pas encore de QR : leur acces par scan est
            impossible tant que l'etiquette n'a pas ete generee et imprimee.
          </Alerte>
        </div>
      )}

      <Carte
        titre="Postes de travail"
        description="La version du QR s'incremente a chaque generation ou remplacement. Une revocation invalide immediatement l'etiquette precedente."
      >
        <Tableau
          messageVide="Aucun poste de travail n'est declare."
          cleLigne={(index) => String(postes[index]?.id ?? index)}
          colonnes={[
            { cle: "code", libelle: "Poste" },
            { cle: "usine", libelle: "Usine" },
            { cle: "atelier", libelle: "Atelier" },
            { cle: "qr", libelle: "QR" },
            { cle: "version", libelle: "Version", nombre: true },
            { cle: "imprime", libelle: "Dernier tirage" },
            { cle: "actions", libelle: "Actions" },
          ]}
          lignes={postes.map((poste) => ({
            cle: String(poste.id),
            cellules: [
              <span key={`c-${poste.id}`}>
                <Link
                  className="lien"
                  href={`/production/postes/${poste.id}`}
                >
                  {poste.code}
                </Link>
                <span className="block text-sm" style={{ color: "var(--texte-doux)" }}>
                  {poste.label}
                </span>
              </span>,
              LIBELLES_USINE[poste.factory] ?? poste.factory,
              poste.workshop?.label ?? "—",
              poste.qrToken ? (
                <Etiquette key={`q-${poste.id}`} ton="succes">
                  Actif
                </Etiquette>
              ) : (
                <Etiquette key={`q-${poste.id}`} ton="neutre">
                  Aucun
                </Etiquette>
              ),
              String(poste.qrVersion),
              poste.qrLastPrintedAt
                ? formatDateTime(poste.qrLastPrintedAt)
                : "Jamais imprime",
              peutGerer ? (
                <div key={`a-${poste.id}`} className="flex flex-col gap-2">
                  <FormulaireAction
                    action={actionGenererQrPoste}
                    libelleSoumettre={
                      poste.qrToken ? "Remplacer le QR" : "Generer le QR"
                    }
                    varianteSoumettre={poste.qrToken ? "secondaire" : "primaire"}
                    discret
                  >
                    <input type="hidden" name="workCenterId" value={poste.id} />
                  </FormulaireAction>
                  {poste.qrToken && (
                    <FormulaireAction
                      action={actionRevoquerQrPoste}
                      libelleSoumettre="Revoquer"
                      varianteSoumettre="danger"
                      discret
                    >
                      <input type="hidden" name="workCenterId" value={poste.id} />
                      <Champ
                        nom="motif"
                        libelle="Motif de revocation"
                        requis
                        maxLength={200}
                      />
                    </FormulaireAction>
                  )}
                </div>
              ) : (
                "Consultation seule"
              ),
            ],
          }))}
        />
      </Carte>
    </>
  );
}
