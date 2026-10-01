import Link from "next/link";
import { notFound } from "next/navigation";
import { actionContrepasserEcriture } from "@/actions/comptabilite";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { consulterEcriture } from "@/lib/comptabilite/service";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  ListeDefinitions,
  Tableau,
} from "@/components/ui";
import { FormulaireMotif } from "@/components/interactif";
import { formatDate, formatDateTime, formatMontant } from "@/lib/format";
import { D } from "@/lib/decimal";
import { LIBELLES_STATUT_ECRITURE, libelle } from "@/lib/libelles";
import { identifiantOuNull } from "@/lib/liste";

export const metadata = { title: "Ecriture comptable" };

export default async function PageEcriture({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entryId = identifiantOuNull(id);
  if (entryId === null) notFound();

  const utilisateur = await exigerPermission(PERMISSIONS.COMPTABILITE_LIRE);
  const ecriture = await consulterEcriture(entryId);

  const peutContrepasser = utilisateur.permissions.includes(
    PERMISSIONS.COMPTABILITE_CONTREPASSER,
  );
  const dejaContrepassee = ecriture.reversals.length > 0;
  const estExtournee = ecriture.status === "EXTOURNEE";

  return (
    <>
      <EnTetePage
        titre={`Ecriture ${ecriture.number}`}
        description={ecriture.label}
        actions={
          <Link className="lien-nav text-sm" href="/comptabilite/ecritures">
            Retour aux ecritures
          </Link>
        }
      />

      {estExtournee && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Ecriture contre-passee">
            Cette ecriture a ete extournee. Elle n'a pas ete supprimee ni modifiee : elle reste
            consultable comme piece d'origine. Voir l'ecriture inverse ci-dessous.
          </Alerte>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Carte titre="Lignes de l'ecriture" sansPadding>
            <Tableau
              colonnes={[
                { cle: "compte", libelle: "Compte" },
                { cle: "libelle", libelle: "Libelle" },
                { cle: "tiers", libelle: "Tiers" },
                { cle: "debit", libelle: "Debit", nombre: true },
                { cle: "credit", libelle: "Credit", nombre: true },
                { cle: "echeance", libelle: "Echeance" },
              ]}
              lignes={ecriture.lines.map((ligne) => ({
                cle: String(ligne.id),
                cellules: [
                  `${ligne.account.number} — ${ligne.account.label}`,
                  ligne.label ?? "-",
                  ligne.thirdParty ? `${ligne.thirdParty.code} — ${ligne.thirdParty.label1}` : "-",
                  ligne.debit.isZero() ? "-" : formatMontant(ligne.debit),
                  ligne.credit.isZero() ? "-" : formatMontant(ligne.credit),
                  ligne.dueDate ? formatDate(ligne.dueDate) : "-",
                ],
              }))}
            />

            <dl
              className="grid gap-2 border-t p-4 text-sm sm:grid-cols-3"
              style={{ borderColor: "var(--bordure)" }}
            >
              <div>
                <dt className="text-xs font-semibold uppercase" style={{ color: "var(--texte-doux)" }}>
                  Total debit
                </dt>
                <dd className="tabular-nums">{formatMontant(ecriture.totalDebit)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase" style={{ color: "var(--texte-doux)" }}>
                  Total credit
                </dt>
                <dd className="tabular-nums">{formatMontant(ecriture.totalCredit)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase" style={{ color: "var(--texte-doux)" }}>
                  Equilibre
                </dt>
                <dd>
                  {D.eq(ecriture.totalDebit, ecriture.totalCredit) ? (
                    <Etiquette ton="succes">Equilibree</Etiquette>
                  ) : (
                    <Etiquette ton="danger">Desequilibree</Etiquette>
                  )}
                </dd>
              </div>
            </dl>
          </Carte>
        </div>

        <div className="space-y-5">
          <Carte titre="Informations">
            <ListeDefinitions
              elements={[
                { terme: "Numero", valeur: ecriture.number },
                { terme: "Date comptable", valeur: formatDate(ecriture.entryDate) },
                {
                  terme: "Journal",
                  valeur: `${ecriture.journal.code} — ${ecriture.journal.label}`,
                },
                {
                  terme: "Periode",
                  valeur: ecriture.period
                    ? `${ecriture.period.code} (${libelle(
                        { OUVERT: "Ouverte", CLOTURE: "Cloturee" },
                        ecriture.period.status,
                      )})`
                    : "Non rattachee",
                },
                {
                  terme: "Statut",
                  valeur: (
                    <EtiquetteStatut
                      libelle={libelle(LIBELLES_STATUT_ECRITURE, ecriture.status)}
                      code={ecriture.status}
                    />
                  ),
                },
                { terme: "Reference", valeur: ecriture.reference ?? "-" },
                {
                  terme: "Document d'origine",
                  valeur: ecriture.documentType
                    ? `${ecriture.documentType} ${ecriture.documentId ?? ""}`.trim()
                    : "-",
                },
                {
                  terme: "Comptabilisee le",
                  valeur: ecriture.postedAt ? formatDateTime(ecriture.postedAt) : "Non comptabilisee",
                },
              ]}
            />
          </Carte>

          {ecriture.reversalOf && (
            <Carte titre="Ecriture d'origine">
              <p className="text-sm">
                Cette ecriture est la contre-passation de{" "}
                <Link className="lien-nav" href={`/comptabilite/ecritures/${ecriture.reversalOf.id}`}>
                  {ecriture.reversalOf.number}
                </Link>{" "}
                — {ecriture.reversalOf.label}.
              </p>
            </Carte>
          )}

          {dejaContrepassee && (
            <Carte titre="Contre-passation existante">
              <ul className="space-y-2 text-sm">
                {ecriture.reversals.map((inverse) => (
                  <li key={inverse.id}>
                    <Link className="lien-nav" href={`/comptabilite/ecritures/${inverse.id}`}>
                      {inverse.number}
                    </Link>{" "}
                    — {libelle(LIBELLES_STATUT_ECRITURE, inverse.status)}
                  </li>
                ))}
              </ul>
            </Carte>
          )}

          {peutContrepasser && !dejaContrepassee && !estExtournee && (
            <Carte
              titre="Contre-passer cette ecriture"
              description="Une contre-passation cree une ecriture inverse. L'ecriture d'origine n'est ni supprimee ni modifiee : elle reste consultable."
            >
              <FormulaireMotif
                action={actionContrepasserEcriture}
                champsCaches={{ entryId: ecriture.id }}
                libelleSoumettre="Contre-passer"
                libelleMotif="Motif de la contre-passation"
                placeholder="Motif explicite de la correction (au moins 10 caracteres)"
              />
            </Carte>
          )}

          {!peutContrepasser && (
            <Alerte ton="info">
              La contre-passation exige la permission « contrepassation ». Vous pouvez consulter
              cette ecriture mais pas la corriger.
            </Alerte>
          )}
        </div>
      </div>
    </>
  );
}
