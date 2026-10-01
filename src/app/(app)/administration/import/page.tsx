import {
  actionEnregistrerDossierImport,
  actionLancerImport,
} from "@/actions/administration";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { prisma } from "@/lib/db";
import { CLE_PARAMETRE, lireParametreTexte } from "@/lib/settings";
import { analyserDossierSource, listerCorrespondances } from "@/lib/import/service";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Statistique,
  Tableau,
  Vide,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatDate, formatDateTime, formatEntier } from "@/lib/format";
import { LIBELLES_ENTITE_IMPORT, LIBELLES_STATUT_IMPORT, libelle } from "@/lib/libelles";

export const metadata = { title: "Import des donnees" };

const IMPORT_TYPES: { code: string; libelle: string; description: string; fichiers: string[] }[] = [
  {
    code: "FAMILLES",
    libelle: "Familles d'articles",
    description: "Hierarchie des familles et sous-familles d'articles.",
    fichiers: ["COM_ItemFamily.csv"],
  },
  {
    code: "ARTICLES",
    libelle: "Articles",
    description:
      "Articles, unites, familles, seuils de stock et etats. Les codes existants sont conserves.",
    fichiers: ["COM_Item.csv"],
  },
  {
    code: "TIERS",
    libelle: "Clients, fournisseurs et employes",
    description:
      "Tiers avec distinction client / fournisseur / employe / autre. Les comptes employes ne sont pas crees automatiquement.",
    fichiers: ["COM_ThirdParty.csv"],
  },
  {
    code: "NOMENCLATURES",
    libelle: "Nomenclatures et composants",
    description:
      "Formules et lignes de composants. Une quantite contradictoire est conservee et signalee, jamais choisie en silence.",
    fichiers: ["COM_Formula.csv", "COM_BOM.csv"],
  },
  {
    code: "LOTS",
    libelle: "Lots et stocks reels",
    description:
      "Quantites physiques importees sous forme de mouvements d'entree initiale ou de correction d'inventaire tracee.",
    fichiers: ["COM_Batch.csv"],
  },
];

const FICHIERS_INFORMATIFS = [
  "COM_FormulaCharge.csv",
  "COM_FormulaEmpoyees.csv",
  "COM_FormulaMachine.csv",
];

export default async function PageImport() {
  await exigerPermission(PERMISSIONS.IMPORT_LIRE);

  const dossier = await lireParametreTexte(
    CLE_PARAMETRE.DOSSIER_IMPORT_SOURCE,
    "E:\\Massiexporte",
  );

  const analyse = analyserDossierSource(dossier);

  const [jobs, correspondances, rejets, articlesImportes, tiersImportes] = await Promise.all([
    prisma.importJob.findMany({
      orderBy: { startedAt: "desc" },
      take: 15,
      include: { user: { select: { email: true } } },
    }),
    listerCorrespondances({ confirmees: false }),
    prisma.importErrorLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { item: { select: { code: true } } },
    }),
    prisma.item.count({ where: { sourceSystem: { not: null } } }),
    prisma.thirdParty.count({ where: { sourceSystem: { not: null } } }),
  ]);

  // Un rejet signale une donnee refusee ; une ligne ignoree signale qu'il n'y
  // avait rien a importer. Les deux sont comptes separement : les confondre
  // laisserait croire a des pertes de donnees.
  const [totalRejets, totalIgnorees] = await Promise.all([
    prisma.importErrorLog.count({ where: { action: "REJETE" } }),
    prisma.importErrorLog.count({ where: { action: "IGNORE" } }),
  ]);

  return (
    <>
      <EnTetePage
        titre="Import des donnees sources"
        description="Import des fichiers CSV de l'ancien ERP. L'import est re-executable : la cle stable (systeme source + identifiant d'origine) evite les doublons. Une fiche absente du fichier source n'est jamais supprimee, et une fiche modifiee dans la plateforme n'est jamais ecrasee."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique
          libelle="Fichiers trouves"
          valeur={`${formatEntier(analyse.fichiers.filter((f) => f.present).length)} / ${formatEntier(
            analyse.fichiers.length,
          )}`}
          ton={analyse.pret ? "succes" : "alerte"}
          detail={analyse.pret ? "Tous les fichiers attendus sont presents" : "Fichiers manquants"}
        />
        <Statistique
          libelle="Articles importes"
          valeur={formatEntier(articlesImportes)}
          detail="Articles portant une reference d'origine"
        />
        <Statistique
          libelle="Tiers importes"
          valeur={formatEntier(tiersImportes)}
          detail="Clients, fournisseurs et employes confondus"
        />
        <Statistique
          libelle="Lignes rejetees au total"
          valeur={formatEntier(totalRejets)}
          ton={totalRejets > 0 ? "alerte" : "succes"}
          detail="Donnees refusees, conservees dans le journal des erreurs d'import"
        />
        <Statistique
          libelle="Lignes vides ignorees"
          valeur={formatEntier(totalIgnorees)}
          detail="Lignes de la source sans aucune donnee a importer"
        />
      </div>

      {!analyse.pret && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Fichiers sources manquants">
            <p>Le dossier examine ne contient pas tous les fichiers attendus :</p>
            <ul className="mt-2 list-disc pl-5">
              {analyse.fichiersManquants.map((fichier) => (
                <li key={fichier}>{fichier}</li>
              ))}
            </ul>
            <p className="mt-2">
              Les imports concernes seront refuses tant que ces fichiers seront absents. Aucun
              fichier n'est cree ni complete automatiquement.
            </p>
          </Alerte>
        </div>
      )}

      <div className="space-y-5">
        <Carte
          titre="Dossier des fichiers sources"
          description="Dossier contenant les fichiers CSV exportes de l'ancien ERP."
        >
          <FormulaireAction
            action={actionEnregistrerDossierImport}
            libelleSoumettre="Enregistrer le dossier"
            rafraichir
          >
            <Champ
              nom="dossier"
              libelle="Chemin du dossier"
              requis
              valeur={dossier}
              maxLength={260}
              aide="Exemple : E:\Massiexporte"
            />
          </FormulaireAction>
        </Carte>

        <Carte titre="Etat des fichiers sources" sansPadding>
          <Tableau
            colonnes={[
              { cle: "fichier", libelle: "Fichier" },
              { cle: "present", libelle: "Present" },
              { cle: "separateur", libelle: "Separateur" },
              { cle: "encodage", libelle: "Encodage" },
              { cle: "lignes", libelle: "Lignes", nombre: true },
              { cle: "colonnes", libelle: "Verification des colonnes" },
              { cle: "message", libelle: "Observation" },
            ]}
            lignes={analyse.fichiers.map((fichier) => ({
              cle: fichier.fichier,
              cellules: [
                fichier.fichier,
                <EtiquetteStatut
                  key="present"
                  libelle={fichier.present ? "Present" : "Absent"}
                  code={fichier.present ? "ACTIF" : "INACTIF"}
                />,
                fichier.separateur ?? "-",
                fichier.encodage ?? "-",
                fichier.present ? formatEntier(fichier.nombreLignes) : "-",
                    fichier.colonnes ? (
                      <EtiquetteStatut
                        key="colonnes"
                        libelle={
                          fichier.colonnes.conforme
                            ? "Colonnes conformes"
                            : `Colonnes manquantes : ${fichier.colonnes.colonnesManquantes.join(", ")}`
                        }
                        code={fichier.colonnes.conforme ? "ACTIF" : "INACTIF"}
                      />
                    ) : (
                      "-"
                    ),
                fichier.message,
              ],
            }))}
          />
        </Carte>

        <Carte
          titre="Lancer un import"
          description="La simulation n'ecrit aucune donnee : elle produit le meme rapport et permet de verifier les colonnes, les doublons et les lignes rejetees avant l'import reel."
        >
          <div className="space-y-5">
            {IMPORT_TYPES.map((type) => {
              const fichiersPresents = type.fichiers.map((nom) =>
                analyse.fichiers.find((fichier) => fichier.fichier === nom),
              );
              const pret = fichiersPresents.every((fichier) => fichier?.present);
              const colonnesConformes = fichiersPresents.every(
                (fichier) => fichier?.colonnes?.conforme !== false,
              );

              return (
                <div
                  key={type.code}
                  className="rounded-lg border p-4"
                  style={{ borderColor: "var(--bordure)" }}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{type.libelle}</p>
                    {!pret && <Etiquette ton="danger">Fichier source absent</Etiquette>}
                    {pret && !colonnesConformes && (
                      <Etiquette ton="alerte">Colonnes non conformes</Etiquette>
                    )}
                  </div>
                  <p className="mb-3 text-sm" style={{ color: "var(--texte-doux)" }}>
                    {type.description} Fichiers : {type.fichiers.join(", ")}.
                  </p>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <FormulaireAction
                      action={actionLancerImport}
                      libelleSoumettre="Simuler (aucune ecriture)"
                      varianteSoumettre="secondaire"
                    >
                      <input type="hidden" name="type" value={type.code} />
                      <input type="hidden" name="dossier" value={dossier} />
                      <input type="hidden" name="simulation" value="1" />
                      <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                        Analyse le fichier, verifie les colonnes et produit le rapport sans rien
                        enregistrer.
                      </p>
                    </FormulaireAction>

                    <FormulaireAction
                      action={actionLancerImport}
                      libelleSoumettre="Importer reellement"
                      varianteSoumettre="primaire"
                    >
                      <input type="hidden" name="type" value={type.code} />
                      <input type="hidden" name="dossier" value={dossier} />
                      <label className="flex items-start gap-3 text-sm">
                        <input type="checkbox" name="miseAJourAutorisee" className="mt-1 h-5 w-5" />
                        <span>
                          Autoriser la mise a jour des fiches deja importees. Une fiche modifiee
                          dans la plateforme reste protegee et sera signalee.
                        </span>
                      </label>
                    </FormulaireAction>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-sm">
            Fichiers complementaires presents dans le dossier mais lus par la nomenclature ou par
            les gammes : {FICHIERS_INFORMATIFS.join(", ")}.
          </p>
        </Carte>

        <Carte titre="Journal des imports" sansPadding>
          {jobs.length === 0 ? (
            <Vide message="Aucun import n'a encore ete execute." />
          ) : (
            <Tableau
              colonnes={[
                { cle: "date", libelle: "Date" },
                { cle: "fichier", libelle: "Fichier" },
                { cle: "entite", libelle: "Donnees" },
                { cle: "statut", libelle: "Statut" },
                { cle: "lues", libelle: "Lues", nombre: true },
                { cle: "inserees", libelle: "Creees", nombre: true },
                { cle: "maj", libelle: "Mises a jour", nombre: true },
                { cle: "protegees", libelle: "Protegees", nombre: true },
                { cle: "ignorees", libelle: "Ignorees", nombre: true },
                { cle: "rejetees", libelle: "Rejetees", nombre: true },
                { cle: "auteur", libelle: "Auteur" },
              ]}
              lignes={jobs.map((job) => ({
                cle: String(job.id),
                cellules: [
                  formatDateTime(job.startedAt),
                  job.fileName,
                  libelle(LIBELLES_ENTITE_IMPORT, job.entityType),
                  <EtiquetteStatut
                    key="statut"
                    libelle={libelle(LIBELLES_STATUT_IMPORT, job.status)}
                    code={job.status === "TERMINE" ? "ACTIF" : "INACTIF"}
                  />,
                  formatEntier(job.totalRows),
                  formatEntier(job.insertedRows),
                  formatEntier(job.updatedRows),
                  formatEntier(job.protectedRows),
                  formatEntier(job.skippedRows),
                  formatEntier(job.rejectedRows),
                  job.user?.email ?? "-",
                ],
              }))}
            />
          )}
        </Carte>

        <Carte
          titre="Lignes rejetees ou protegees"
          description="Chaque ligne conservee ici peut etre corrigee dans le fichier source puis re-importee. Aucune donnee existante n'est supprimee pour autant."
          sansPadding
        >
          {rejets.length === 0 ? (
            <Vide message="Aucune ligne rejetee n'a ete enregistree." />
          ) : (
            <Tableau
              colonnes={[
                { cle: "date", libelle: "Date" },
                { cle: "fichier", libelle: "Fichier" },
                { cle: "ligne", libelle: "Ligne", nombre: true },
                { cle: "code", libelle: "Code source" },
                { cle: "champ", libelle: "Champ" },
                { cle: "motif", libelle: "Motif du rejet" },
                { cle: "action", libelle: "Traitement" },
              ]}
              lignes={rejets.map((rejet) => ({
                cle: String(rejet.id),
                cellules: [
                  formatDate(rejet.createdAt),
                  libelle(LIBELLES_ENTITE_IMPORT, rejet.entityType),
                  formatEntier(rejet.rowNumber),
                  rejet.sourceCode ?? (rejet.sourceOid !== null ? String(rejet.sourceOid) : "-"),
                  rejet.field ?? "-",
                  rejet.message,
                  rejet.action === "INSERE"
                    ? "Creee"
                    : rejet.action === "MIS_A_JOUR"
                      ? "Fiche mise a jour"
                      : rejet.action === "IGNORE"
                        ? "Ligne ignoree"
                        : rejet.action === "PROTEGE"
                          ? "Fiche protegee (modifiee dans la plateforme)"
                          : "Ligne rejetee",
                ],
              }))}
            />
          )}
        </Carte>

        <Carte
          titre="Correspondances a confirmer"
          description="Valeurs presentes dans les fichiers sources et non reconnues automatiquement. Aucune n'est interpretee en silence : la valeur brute est conservee jusqu'a confirmation par un administrateur."
          sansPadding
        >
          {correspondances.length === 0 ? (
            <Vide message="Aucune correspondance en attente de confirmation." />
          ) : (
            <Tableau
              colonnes={[
                { cle: "entite", libelle: "Donnees" },
                { cle: "champ", libelle: "Champ" },
                { cle: "source", libelle: "Valeur source" },
                { cle: "cible", libelle: "Valeur proposee" },
                { cle: "etat", libelle: "Confirmee" },
              ]}
              lignes={correspondances.slice(0, 100).map((correspondance) => ({
                cle: String(correspondance.id),
                cellules: [
                  correspondance.sourceEntity,
                  correspondance.sourceField,
                  correspondance.sourceValue,
                  correspondance.targetValue,
                  <EtiquetteStatut
                    key="etat"
                    libelle={correspondance.isConfirmed ? "Confirmee" : "A confirmer"}
                    code={correspondance.isConfirmed ? "ACTIF" : "INACTIF"}
                  />,
                ],
              }))}
            />
          )}
        </Carte>
      </div>
    </>
  );
}
