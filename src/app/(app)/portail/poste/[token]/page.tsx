import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  exigerPermission,
  libelleUsine,
  peutAccederUsine,
} from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { actionScannerPoste } from "@/actions/atelier";
import { Alerte, Carte, EnTetePage, Etiquette } from "@/components/ui";
import { FormulaireAction } from "@/components/interactif";
import { ProgrammeTaches } from "@/components/taches-programme";
import { resoudrePosteParToken, programmeEmploye } from "@/lib/mes/postes";
import { bornesJour } from "@/lib/mes/jour";

export const metadata = { title: "Scan du poste" };

/**
 * Arrivee apres un scan de QR de poste.
 *
 * Ce que fait cette page, dans l'ordre :
 *
 *  1. elle exige une session valide et la permission de scanner ;
 *  2. elle resout le poste depuis le jeton du QR — un QR revoque, desactive ou
 *     inconnu ne resout rien, et rien ne s'affiche ;
 *  3. elle verifie que le poste appartient a une usine que le compte peut voir ;
 *  4. elle ne montre AUCUNE tache tant que l'affectation reelle n'a pas ete
 *     confirmee par le serveur (`actionScannerPoste`).
 *
 * Autrement dit : photographier un QR ne donne aucun droit. Le QR identifie un
 * poste, et rien d'autre.
 */
export default async function PageScanPoste({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.PORTAIL_POSTE_SCANNER);
  const { token } = await params;

  if (!token) notFound();

  if (!utilisateur.employeeId) {
    return (
      <>
        <EnTetePage titre="Scan du poste" />
        <Alerte ton="danger" titre="Compte non rattache a une fiche employe">
          Le scan de poste exige une fiche employe rattachee a votre compte.
          Contactez le service des ressources humaines pour regulariser votre
          situation.
        </Alerte>
      </>
    );
  }

  const employeeId = utilisateur.employeeId;

  const poste = await resoudrePosteParToken(token);
  if (!poste) {
    return (
      <>
        <EnTetePage titre="Scan du poste" />
        <Alerte ton="danger" titre="QR inconnu ou revoque">
          Cette etiquette ne correspond a aucun poste actif. Elle a peut-etre ete
          remplacee apres une revocation. Demandez l'etiquette courante au
          responsable d'atelier.
        </Alerte>
      </>
    );
  }

  const posteResume = {
    id: poste.id,
    code: poste.code,
    label: poste.label,
    factory: poste.factory,
    atelier: poste.workshop?.label ?? null,
    emplacement: poste.location ?? null,
  };

  if (!peutAccederUsine(utilisateur, poste.factory)) {
    return (
      <>
        <EnTetePage titre="Scan du poste" />
        <Alerte ton="danger" titre="Poste hors de votre perimetre">
          Le poste « {posteResume.code} » appartient a la division{" "}
          {libelleUsine(posteResume.factory)}. Votre profil ne vous autorise pas a
          intervenir sur cette division.
        </Alerte>
      </>
    );
  }

  // Le scan a-t-il deja ete confirme aujourd'hui par cet employe sur ce poste ?
  // Si oui, on affiche directement le programme : l'operateur n'a pas a
  // confirmer deux fois la meme chose.
  const { debut, fin } = bornesJour();
  const scanDuJour = await prisma.workCenterScan.findFirst({
    where: {
      workCenterId: poste.id,
      employeeId,
      result: "ACCEPTE",
      scannedAt: { gte: debut, lt: fin },
    },
    orderBy: { scannedAt: "desc" },
  });

  if (scanDuJour) {
    const taches = await programmeEmploye(employeeId, { workCenterId: poste.id });
    return (
      <>
        <EnTetePage
          titre={`Poste ${posteResume.code}`}
          description={`${posteResume.label}${posteResume.atelier ? ` · ${posteResume.atelier}` : ""} · ${libelleUsine(posteResume.factory)}`}
        />
        <div className="mb-4">
          <Alerte ton="succes" titre="Affectation confirmee">
            Votre affectation a ce poste a ete verifiee. Voici votre programme,
            dans l'ordre publie par votre responsable.
          </Alerte>
        </div>
        <ProgrammeTaches
          taches={taches}
          titre="Programme a ce poste"
          messageVide="Aucune tache planifiee sur ce poste pour le moment."
        />
      </>
    );
  }

  return (
    <>
      <EnTetePage
        titre={`Poste ${posteResume.code}`}
        description={`${posteResume.label}${posteResume.atelier ? ` · ${posteResume.atelier}` : ""} · ${libelleUsine(posteResume.factory)}`}
      />

      <div className="grid gap-4">
        <Carte titre="Poste identifie">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Code</dt>
              <dd className="font-medium">{posteResume.code}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Libelle</dt>
              <dd className="font-medium">{posteResume.label}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Atelier</dt>
              <dd className="font-medium">{posteResume.atelier ?? "—"}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--texte-doux)" }}>Emplacement</dt>
              <dd className="font-medium">{posteResume.emplacement ?? "—"}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm" style={{ color: "var(--texte-doux)" }}>
            Le scan ne donne aucun droit supplementaire : le serveur verifie que
            ce poste vous est bien affecte aujourd'hui avant d'afficher la moindre
            tache.
          </p>
        </Carte>

        <Carte titre="Confirmer mon affectation">
          <FormulaireAction
            action={actionScannerPoste}
            libelleSoumettre="Afficher mon programme"
            varianteSoumettre="primaire"
          >
            <input type="hidden" name="token" value={token} />
            <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
              Si vous etes affecte a ce poste pour la journee en cours, votre
              programme s'affichera immediatement.
            </p>
          </FormulaireAction>
        </Carte>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Etiquette ton="info">Session : {utilisateur.email}</Etiquette>
          <Etiquette ton="neutre">
            Journee metier : Africa/Algiers
          </Etiquette>
        </div>
      </div>
    </>
  );
}
