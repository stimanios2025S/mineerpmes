import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { aLaPermission, exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { identifiantOuNull } from "@/lib/liste";
import {
  actionGenererQrPoste,
  actionMarquerQrImprime,
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
import { BoutonImprimer } from "@/components/bouton-imprimer";
import { historiqueScans, resoudrePosteParToken } from "@/lib/mes/postes";
import { qrSvg, urlScanPoste } from "@/lib/mes/qr";
import { formatDateTime } from "@/lib/format";
import { LIBELLES_USINE } from "@/lib/libelles";

export const metadata = { title: "Etiquette de poste" };

/**
 * Etiquette permanente d'un poste : le QR, le code lisible, et rien d'autre.
 *
 * Le QR contient une URL absolue vers la page de scan, avec le jeton du poste.
 * Aucun mot de passe, aucune donnee personnelle, aucune tache figee : tout ce
 * qui s'affiche apres le scan est recalcule cote serveur depuis les
 * affectations reelles du jour.
 */
export default async function PageEtiquettePoste({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.POSTE_QR_GERER);
  const peutGerer = aLaPermission(utilisateur, PERMISSIONS.POSTE_QR_GERER);

  const { id } = await params;
  const identifiant = identifiantOuNull(id);
  if (!identifiant) notFound();

  const poste = await prisma.workCenter.findUnique({
    where: { id: identifiant },
    include: {
      workshop: { select: { code: true, label: true } },
      operation: { select: { code: true, label: true } },
      subStocks: {
        where: { isActive: true },
        select: { id: true, code: true, label: true, kind: true },
        orderBy: { sequenceOrder: "asc" },
      },
    },
  });

  if (!poste) notFound();

  // Adresse reellement joignable depuis l'atelier : c'est celle-la qui doit
  // etre inscrite dans le QR, pas un chemin relatif.
  const entetes = await headers();
  const hote = entetes.get("host") ?? "localhost:3000";
  const protocole =
    entetes.get("x-forwarded-proto") ?? (hote.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${protocole}://${hote}`;

  const scans = await historiqueScans(poste.id, 20);

  const posteResolu = poste.qrToken
    ? await resoudrePosteParToken(poste.qrToken)
    : null;

  const urlScan = poste.qrToken ? urlScanPoste(baseUrl, poste.qrToken) : null;
  const svg = urlScan ? await qrSvg(urlScan, { largeur: 512, marge: 2 }) : null;

  return (
    <>
      <EnTetePage
        titre={`Etiquette du poste ${poste.code}`}
        description={`${poste.label} · ${LIBELLES_USINE[poste.factory] ?? poste.factory}${poste.workshop ? ` · ${poste.workshop.label}` : ""}`}
        actions={
          <Link className="bouton secondaire" href="/production/postes">
            Tous les postes
          </Link>
        }
      />

      {!poste.isActive && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Poste desactive">
            Ce poste est desactive : meme avec un QR valide, aucun scan ne sera
            accepte tant qu'il n'aura pas ete reactive.
          </Alerte>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Carte titre="Etiquette a imprimer">
          {svg && posteResolu ? (
            <>
              <div
                className="mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-lg border p-6"
                style={{ background: "#ffffff", color: "#000000" }}
              >
                <p className="text-sm font-semibold uppercase tracking-wide">
                  {LIBELLES_USINE[poste.factory] ?? poste.factory}
                </p>
                <p className="text-2xl font-bold">{poste.code}</p>
                <p className="text-center text-sm">{poste.label}</p>
                <div
                  className="w-full max-w-[280px]"
                  // Le SVG est genere localement par `qrSvg` a partir de notre
                  // propre jeton : aucune donnee externe n'entre ici.
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
                <p className="font-mono text-xs break-all">{poste.code}</p>
                <p className="text-center text-xs">
                  Scannez pour afficher votre programme de la journee.
                </p>
                <p className="text-center text-[10px]">
                  Version {poste.qrVersion}
                  {poste.qrGeneratedAt
                    ? ` · genere le ${formatDateTime(poste.qrGeneratedAt)}`
                    : ""}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <BoutonImprimer />
                {peutGerer && (
                  <FormulaireAction
                    action={actionMarquerQrImprime}
                    libelleSoumettre="Noter cette impression"
                    varianteSoumettre="secondaire"
                    discret
                  >
                    <input type="hidden" name="workCenterId" value={poste.id} />
                  </FormulaireAction>
                )}
              </div>

              <p className="mt-3 text-sm" style={{ color: "var(--texte-doux)" }}>
                Le QR ouvre l'adresse {urlScan}. Si la plateforme n'est pas
                joignable depuis les telephones de l'atelier par cette adresse,
                l'etiquette doit etre regeneree depuis une adresse accessible.
              </p>
            </>
          ) : (
            <Alerte ton="alerte" titre="Aucune etiquette active">
              Ce poste n'a pas de QR actif : il a ete revoque, ou il n'a jamais
              ete genere. Generez un QR pour produire son etiquette.
            </Alerte>
          )}
        </Carte>

        <div className="grid gap-4">
          <Carte titre="Etat du QR">
            <div className="grid gap-3">
              <Statistique libelle="Version" valeur={poste.qrVersion} />
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt style={{ color: "var(--texte-doux)" }}>Jeton actif</dt>
                  <dd className="font-medium">
                    {poste.qrToken ? "Oui" : "Non"}
                  </dd>
                </div>
                <div>
                  <dt style={{ color: "var(--texte-doux)" }}>Genere le</dt>
                  <dd className="font-medium">
                    {poste.qrGeneratedAt
                      ? formatDateTime(poste.qrGeneratedAt)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt style={{ color: "var(--texte-doux)" }}>Revoque le</dt>
                  <dd className="font-medium">
                    {poste.qrRevokedAt ? formatDateTime(poste.qrRevokedAt) : "—"}
                  </dd>
                </div>
                <div>
                  <dt style={{ color: "var(--texte-doux)" }}>Dernier tirage</dt>
                  <dd className="font-medium">
                    {poste.qrLastPrintedAt
                      ? formatDateTime(poste.qrLastPrintedAt)
                      : "Jamais imprime"}
                  </dd>
                </div>
              </dl>
              {poste.qrToken ? (
                <Etiquette ton="succes">Etiquette active</Etiquette>
              ) : (
                <Etiquette ton="neutre">Aucune etiquette</Etiquette>
              )}
            </div>
          </Carte>

          {peutGerer && (
            <Carte titre="Actions">
              <div className="grid gap-3">
                <FormulaireAction
                  action={actionGenererQrPoste}
                  libelleSoumettre={
                    poste.qrToken ? "Remplacer le QR" : "Generer le QR"
                  }
                  varianteSoumettre={poste.qrToken ? "secondaire" : "primaire"}
                >
                  <input type="hidden" name="workCenterId" value={poste.id} />
                  <p className="text-sm" style={{ color: "var(--texte-doux)" }}>
                    {poste.qrToken
                      ? "Remplacer incremente la version et invalide immediatement l'etiquette en circulation."
                      : "Generer produit un jeton opaque et une etiquette imprimable."}
                  </p>
                </FormulaireAction>

                {poste.qrToken && (
                  <FormulaireAction
                    action={actionRevoquerQrPoste}
                    libelleSoumettre="Revoquer le QR"
                    varianteSoumettre="danger"
                  >
                    <input type="hidden" name="workCenterId" value={poste.id} />
                    <Champ
                      nom="motif"
                      libelle="Motif de revocation"
                      requis
                      maxLength={200}
                      aide="Obligatoire : l'etiquette perdue ou compromise doit etre justifiee."
                    />
                  </FormulaireAction>
                )}
              </div>
            </Carte>
          )}

          {poste.subStocks.length > 0 && (
            <Carte titre="Sous-stocks rattaches">
              <ul className="grid gap-2 text-sm">
                {poste.subStocks.map((sousStock) => (
                  <li key={sousStock.id}>
                    <span className="font-medium">{sousStock.code}</span> —{" "}
                    {sousStock.label}
                  </li>
                ))}
              </ul>
            </Carte>
          )}
        </div>
      </div>

      <div className="mt-4">
        <Carte
          titre="Derniers scans"
          description="Les refus sont conserves : un scan refuse est une information, pas un evenement a jeter."
        >
          <Tableau
            messageVide="Aucun scan enregistre sur ce poste."
            cleLigne={(index) => String(scans[index]?.id ?? index)}
            colonnes={[
              { cle: "quand", libelle: "Quand" },
              { cle: "employe", libelle: "Employe" },
              { cle: "resultat", libelle: "Resultat" },
              { cle: "motif", libelle: "Motif" },
            ]}
            lignes={scans.map((scan) => ({
              cle: String(scan.id),
              cellules: [
                formatDateTime(scan.scannedAt),
                scan.employee
                  ? `${scan.employee.matricule} — ${scan.employee.firstName} ${scan.employee.lastName}`
                  : "—",
                scan.result === "ACCEPTE" ? "Accepte" : "Refuse",
                scan.reason ?? "—",
              ],
            }))}
          />
        </Carte>
      </div>
    </>
  );
}
