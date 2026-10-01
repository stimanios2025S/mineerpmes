import { prisma } from "@/lib/db";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { actionScannerPosteParCode } from "@/actions/atelier";
import { Alerte, Carte, EnTetePage, Tableau } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { programmeEmploye } from "@/lib/mes/postes";
import { ProgrammeTaches } from "@/components/taches-programme";
import { bornesJour } from "@/lib/mes/jour";
import { formatHeure } from "@/lib/format";

export const metadata = { title: "Mon poste" };

/**
 * Saisie manuelle du code du poste.
 *
 * Meme chemin que le scan : le code est resolu cote serveur, puis l'affectation
 * reelle de l'employe connecte est verifiee avant qu'une seule tache soit
 * affichee. Un code saisi a la main ne raccourcit aucun controle.
 */
export default async function PageMonPoste() {
  const utilisateur = await exigerPermission(PERMISSIONS.PORTAIL_POSTE_SCANNER);

  if (!utilisateur.employeeId) {
    return (
      <>
        <EnTetePage titre="Mon poste" />
        <Alerte ton="danger" titre="Compte non rattache a une fiche employe">
          Le portail atelier exige une fiche employe rattachee a votre compte.
        </Alerte>
      </>
    );
  }

  const employeeId = utilisateur.employeeId;
  const { debut, fin } = bornesJour();

  const [postesScannes, taches] = await Promise.all([
    prisma.workCenterScan.findMany({
      where: {
        employeeId,
        scannedAt: { gte: debut, lt: fin },
      },
      include: {
        workCenter: { select: { code: true, label: true, factory: true } },
      },
      orderBy: { scannedAt: "desc" },
      take: 10,
    }),
    programmeEmploye(employeeId, {}),
  ]);

  return (
    <>
      <EnTetePage
        titre="Mon poste"
        description="Scannez le QR permanent du poste, ou saisissez son code. Le serveur verifie ensuite que ce poste vous est bien affecte aujourd'hui."
      />

      <div className="grid gap-4">
        <Carte titre="Saisir le code du poste">
          <FormulaireAction
            action={actionScannerPosteParCode}
            libelleSoumettre="Afficher mon programme"
            varianteSoumettre="primaire"
          >
            <Champ
              nom="codePoste"
              libelle="Code du poste"
              requis
              aide="Le code est inscrit sous le QR de l'etiquette, par exemple POSTE-COUPE-01."
            />
          </FormulaireAction>
        </Carte>

        {postesScannes.length > 0 && (
          <Carte titre="Mes scans d'aujourd'hui">
            <Tableau
              cleLigne={(index) => String(postesScannes[index]?.id ?? index)}
              colonnes={[
                { cle: "heure", libelle: "Heure" },
                { cle: "poste", libelle: "Poste" },
                { cle: "resultat", libelle: "Resultat" },
                { cle: "motif", libelle: "Motif" },
              ]}
              lignes={postesScannes.map((scan) => ({
                cle: String(scan.id),
                cellules: [
                  formatHeure(scan.scannedAt),
                  `${scan.workCenter.code} — ${scan.workCenter.label}`,
                  scan.result === "ACCEPTE" ? "Accepte" : "Refuse",
                  scan.reason ?? "—",
                ],
              }))}
            />
          </Carte>
        )}

        <ProgrammeTaches taches={taches} />
      </div>
    </>
  );
}
