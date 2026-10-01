import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { actionModifierTiers } from "@/actions/referentiel";
import { aLaPermission, exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { identifiantOuNull } from "@/lib/liste";
import { CLE_PARAMETRE, lireParametreTexte } from "@/lib/settings";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  ListeDefinitions,
  Section,
  Statistique,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { DEVISE_PAR_DEFAUT, formatDate, formatEntier, formatMontant } from "@/lib/format";
import {
  LIBELLES_MODE_REGLEMENT,
  LIBELLES_TYPE_TIERS,
  libelle,
} from "@/lib/libelles";

export const metadata = { title: "Fiche tiers" };

const NATURES_TIERS = ["CLIENT", "FOURNISSEUR", "EMPLOYE", "AUTRE"] as const;

const MODES_REGLEMENT = [
  "ESPECES",
  "CHEQUE",
  "VIREMENT",
  "TRAITE",
  "CARTE",
  "COMPENSATION",
  "AUTRE",
] as const;

function CaseACocher({
  nom,
  libelle: intitule,
  coche,
}: {
  nom: string;
  libelle: string;
  coche: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={nom} defaultChecked={coche} className="mt-1" />
      <span className="font-medium">{intitule}</span>
    </label>
  );
}

export default async function PageTiers({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.TIERS_LIRE);

  const { id } = await params;
  const identifiant = identifiantOuNull(id);
  if (identifiant === null) notFound();

  const tiers = await prisma.thirdParty.findUnique({
    where: { id: identifiant },
    include: {
      _count: {
        select: {
          purchaseOrders: true,
          salesOrders: true,
          quotes: true,
          invoices: true,
          supplierInvoices: true,
          receipts: true,
          deliveryNotes: true,
          payments: true,
          priceLists: true,
          supplierPrices: true,
          lots: true,
        },
      },
    },
  });
  if (!tiers) notFound();

  const peutEcrire = aLaPermission(utilisateur, PERMISSIONS.TIERS_ECRIRE);
  const devise = await lireParametreTexte(CLE_PARAMETRE.DEVISE, DEVISE_PAR_DEFAUT);

  const plafondDepasse =
    D.gt(tiers.maxBalanceAmount, 0) && D.gt(tiers.balance, tiers.maxBalanceAmount);

  return (
    <>
      <EnTetePage
        titre={`${tiers.code} — ${tiers.label1}`}
        description="Fiche complete du tiers : coordonnees, identifiants fiscaux, conditions de reglement, encours et blocage."
        actions={
          <Link className="lien-nav text-sm" href="/referentiel/tiers">
            Retour a la liste
          </Link>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Statistique
            libelle="Solde enregistre"
            valeur={formatMontant(tiers.balance, devise)}
            detail="Solde reel issu des factures et des reglements"
            ton={D.lt(tiers.balance, 0) ? "danger" : "neutre"}
          />
          <Statistique
            libelle="Plafond d'encours"
            valeur={
              D.isZero(tiers.maxBalanceAmount)
                ? "Aucun plafond"
                : formatMontant(tiers.maxBalanceAmount, devise)
            }
            detail={plafondDepasse ? "Plafond depasse" : "Encours dans les limites"}
            ton={plafondDepasse ? "danger" : "neutre"}
          />
          <Statistique
            libelle="Commandes client"
            valeur={formatEntier(tiers._count.salesOrders)}
            detail={`${formatEntier(tiers._count.quotes)} devis et ${formatEntier(
              tiers._count.deliveryNotes,
            )} bon(s) de livraison`}
          />
          <Statistique
            libelle="Commandes fournisseur"
            valeur={formatEntier(tiers._count.purchaseOrders)}
            detail={`${formatEntier(tiers._count.receipts)} reception(s)`}
          />
        </div>

        {tiers.isBlocked && (
          <Alerte ton="danger" titre="Tiers bloque">
            Ce tiers est bloque{""}
            {tiers.blockedReason ? ` — motif enregistre : ${tiers.blockedReason}` : ""}. Il reste
            consultable, mais aucun nouveau document ne doit lui etre rattache sans decision
            explicite.
          </Alerte>
        )}

        <Carte titre="Identification">
          <ListeDefinitions
            elements={[
              { terme: "Code tiers", valeur: tiers.code },
              {
                terme: "Nature principale",
                valeur: libelle(LIBELLES_TYPE_TIERS, tiers.type),
              },
              { terme: "Libelle 1", valeur: tiers.label1 },
              { terme: "Libelle 2", valeur: tiers.label2 ?? "-" },
              { terme: "Designation", valeur: tiers.designation ?? "-" },
              { terme: "Nom", valeur: tiers.lastName ?? "-" },
              { terme: "Prenom", valeur: tiers.firstName ?? "-" },
              {
                terme: "Natures",
                valeur: (
                  <span className="inline-flex flex-wrap gap-1">
                    {tiers.isClient && <Etiquette ton="primaire">Client</Etiquette>}
                    {tiers.isSupplier && <Etiquette ton="info">Fournisseur</Etiquette>}
                    {tiers.isEmployee && <Etiquette ton="neutre">Employe</Etiquette>}
                    {tiers.isOther && <Etiquette ton="neutre">Autre tiers</Etiquette>}
                    {!tiers.isClient &&
                      !tiers.isSupplier &&
                      !tiers.isEmployee &&
                      !tiers.isOther && <Etiquette ton="alerte">Sans nature</Etiquette>}
                  </span>
                ),
              },
              {
                terme: "Etat",
                valeur: (
                  <EtiquetteStatut
                    code={tiers.isActive ? "ACTIF" : "INACTIF"}
                    libelle={tiers.isActive ? "Actif" : "Inactif"}
                  />
                ),
              },
            ]}
          />
        </Carte>

        <Carte titre="Coordonnees">
          <ListeDefinitions
            elements={[
              { terme: "Adresse", valeur: tiers.address1 ?? "-" },
              { terme: "Complement", valeur: tiers.address2 ?? "-" },
              { terme: "Ville", valeur: tiers.city ?? "-" },
              { terme: "Code postal", valeur: tiers.postCode ?? "-" },
              { terme: "Commune", valeur: tiers.commune ?? "-" },
              { terme: "Wilaya / departement", valeur: tiers.department ?? "-" },
              { terme: "Pays", valeur: tiers.country ?? "-" },
              { terme: "Telephone principal", valeur: tiers.phone1 ?? "-" },
              { terme: "Telephone secondaire", valeur: tiers.phone2 ?? "-" },
              { terme: "Mobile", valeur: tiers.mobile ?? "-" },
              { terme: "Fax", valeur: tiers.fax ?? "-" },
              { terme: "Adresse electronique", valeur: tiers.email ?? "-" },
              { terme: "Site web", valeur: tiers.url ?? "-" },
            ]}
          />
        </Carte>

        <Carte
          titre="Identifiants fiscaux et comptables"
          description="Les mentions absentes de la fiche restent vides : aucune valeur n'est deduite ni inventee."
        >
          <ListeDefinitions
            elements={[
              { terme: "Identifiant fiscal", valeur: tiers.taxId ?? "Non renseigne" },
              { terme: "NIF", valeur: tiers.nif ?? "Non renseigne" },
              { terme: "NIS", valeur: tiers.nis ?? "Non renseigne" },
              { terme: "Registre de commerce (RC)", valeur: tiers.rc ?? "Non renseigne" },
              { terme: "Article d'imposition (AI)", valeur: tiers.ai ?? "Non renseigne" },
              { terme: "Compte CCP", valeur: tiers.ccp ?? "Non renseigne" },
              { terme: "Forme juridique", valeur: tiers.legalForm ?? "Non renseignee" },
              { terme: "Activite", valeur: tiers.activity ?? "Non renseignee" },
              { terme: "Compte comptable", valeur: tiers.accountingCode ?? "Non rattache" },
            ]}
          />
        </Carte>

        <Carte titre="Conditions de reglement">
          <ListeDefinitions
            elements={[
              {
                terme: "Mode de reglement",
                valeur: tiers.paymentMethod
                  ? libelle(LIBELLES_MODE_REGLEMENT, tiers.paymentMethod)
                  : "Non defini",
              },
              {
                terme: "Delai de reglement",
                valeur: `${formatEntier(tiers.deadlineDays)} jour(s)`,
              },
              { terme: "Remise", valeur: `${tiers.discountRate.toString()} %` },
              { terme: "Majoration", valeur: `${tiers.increaseRate.toString()} %` },
              {
                terme: "Exoneration de TVA",
                valeur: tiers.exemptFromVat
                  ? "Tiers exonere de TVA"
                  : "TVA applicable selon le taux de l'article",
              },
              {
                terme: "Encours",
                valeur: `${formatMontant(tiers.balance, devise)} sur un plafond de ${
                  D.isZero(tiers.maxBalanceAmount)
                    ? "aucun plafond"
                    : formatMontant(tiers.maxBalanceAmount, devise)
                }`,
              },
              { terme: "Remarque interne", valeur: tiers.remark ?? "-" },
              { terme: "Origine des donnees", valeur: tiers.sourceSystem ?? "Saisie directe" },
              { terme: "Fiche mise a jour le", valeur: formatDate(tiers.updatedAt) },
            ]}
          />
        </Carte>

        <Carte
          titre="Activite enregistree"
          description="Volumes reels de documents rattaches a ce tiers, comptes dans la base."
          sansPadding
        >
          <ListeDefinitions
            elements={[
              { terme: "Devis", valeur: formatEntier(tiers._count.quotes) },
              { terme: "Commandes client", valeur: formatEntier(tiers._count.salesOrders) },
              { terme: "Bons de livraison", valeur: formatEntier(tiers._count.deliveryNotes) },
              { terme: "Factures client", valeur: formatEntier(tiers._count.invoices) },
              {
                terme: "Commandes fournisseur",
                valeur: formatEntier(tiers._count.purchaseOrders),
              },
              { terme: "Receptions", valeur: formatEntier(tiers._count.receipts) },
              {
                terme: "Factures fournisseur",
                valeur: formatEntier(tiers._count.supplierInvoices),
              },
              { terme: "Reglements", valeur: formatEntier(tiers._count.payments) },
              { terme: "Tarifs de vente", valeur: formatEntier(tiers._count.priceLists) },
              {
                terme: "Prix fournisseur",
                valeur: formatEntier(tiers._count.supplierPrices),
              },
              { terme: "Lots rattaches", valeur: formatEntier(tiers._count.lots) },
            ]}
          />
        </Carte>

        {peutEcrire ? (
          <Carte
            titre="Modification de la fiche"
            description="Le solde n'est pas modifiable ici : il est tenu par les factures et les reglements. Chaque enregistrement est journalise."
          >
            <FormulaireAction
              action={actionModifierTiers}
              libelleSoumettre="Enregistrer les modifications"
              varianteSoumettre="primaire"
            >
              <input type="hidden" name="tiersId" value={tiers.id} />

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Champ nom="code" libelle="Code tiers" requis valeur={tiers.code} />
                <Champ
                  nom="naturePrincipale"
                  libelle="Nature principale"
                  type="select"
                  requis
                  valeur={tiers.type}
                  options={NATURES_TIERS.map((valeur) => ({
                    valeur,
                    libelle: libelle(LIBELLES_TYPE_TIERS, valeur),
                  }))}
                />
                <Champ nom="libelle1" libelle="Libelle principal" requis valeur={tiers.label1} />
                <Champ nom="libelle2" libelle="Libelle secondaire" valeur={tiers.label2 ?? ""} />
                <Champ
                  nom="designation"
                  libelle="Designation longue"
                  valeur={tiers.designation ?? ""}
                />
                <Champ nom="nom" libelle="Nom" valeur={tiers.lastName ?? ""} />
                <Champ nom="prenom" libelle="Prenom" valeur={tiers.firstName ?? ""} />
              </div>

              <Section titre="Natures du tiers">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <CaseACocher nom="natureClient" libelle="Client" coche={tiers.isClient} />
                  <CaseACocher
                    nom="natureFournisseur"
                    libelle="Fournisseur"
                    coche={tiers.isSupplier}
                  />
                  <CaseACocher nom="natureEmploye" libelle="Employe" coche={tiers.isEmployee} />
                  <CaseACocher nom="natureAutre" libelle="Autre tiers" coche={tiers.isOther} />
                </div>
              </Section>

              <Section titre="Coordonnees">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Champ nom="adresse1" libelle="Adresse" valeur={tiers.address1 ?? ""} />
                  <Champ nom="adresse2" libelle="Complement" valeur={tiers.address2 ?? ""} />
                  <Champ nom="ville" libelle="Ville" valeur={tiers.city ?? ""} />
                  <Champ nom="codePostal" libelle="Code postal" valeur={tiers.postCode ?? ""} />
                  <Champ nom="commune" libelle="Commune" valeur={tiers.commune ?? ""} />
                  <Champ
                    nom="wilaya"
                    libelle="Wilaya / departement"
                    valeur={tiers.department ?? ""}
                  />
                  <Champ nom="pays" libelle="Pays" valeur={tiers.country ?? ""} />
                  <Champ nom="telephone1" libelle="Telephone principal" valeur={tiers.phone1 ?? ""} />
                  <Champ
                    nom="telephone2"
                    libelle="Telephone secondaire"
                    valeur={tiers.phone2 ?? ""}
                  />
                  <Champ nom="mobile" libelle="Mobile" valeur={tiers.mobile ?? ""} />
                  <Champ nom="fax" libelle="Fax" valeur={tiers.fax ?? ""} />
                  <Champ nom="email" libelle="Adresse electronique" valeur={tiers.email ?? ""} />
                  <Champ nom="siteWeb" libelle="Site web" valeur={tiers.url ?? ""} />
                </div>
              </Section>

              <Section titre="Identifiants fiscaux et comptables">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Champ
                    nom="identifiantFiscal"
                    libelle="Identifiant fiscal"
                    valeur={tiers.taxId ?? ""}
                  />
                  <Champ nom="nif" libelle="NIF" valeur={tiers.nif ?? ""} />
                  <Champ nom="nis" libelle="NIS" valeur={tiers.nis ?? ""} />
                  <Champ nom="rc" libelle="Registre de commerce (RC)" valeur={tiers.rc ?? ""} />
                  <Champ nom="ai" libelle="Article d'imposition (AI)" valeur={tiers.ai ?? ""} />
                  <Champ nom="ccp" libelle="Compte CCP" valeur={tiers.ccp ?? ""} />
                  <Champ
                    nom="formeJuridique"
                    libelle="Forme juridique"
                    valeur={tiers.legalForm ?? ""}
                  />
                  <Champ nom="activite" libelle="Activite" valeur={tiers.activity ?? ""} />
                  <Champ
                    nom="compteComptable"
                    libelle="Compte comptable"
                    valeur={tiers.accountingCode ?? ""}
                  />
                </div>
              </Section>

              <Section titre="Conditions de reglement">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Champ
                    nom="modeReglement"
                    libelle="Mode de reglement"
                    type="select"
                    valeur={tiers.paymentMethod ?? ""}
                    options={MODES_REGLEMENT.map((valeur) => ({
                      valeur,
                      libelle: libelle(LIBELLES_MODE_REGLEMENT, valeur),
                    }))}
                  />
                  <Champ
                    nom="delaiReglement"
                    libelle="Delai de reglement (jours)"
                    type="number"
                    min={0}
                    pas="1"
                    valeur={tiers.deadlineDays}
                  />
                  <Champ
                    nom="remise"
                    libelle="Remise (%)"
                    type="number"
                    min={0}
                    max={100}
                    pas="0.01"
                    valeur={tiers.discountRate.toString()}
                  />
                  <Champ
                    nom="majoration"
                    libelle="Majoration (%)"
                    type="number"
                    min={0}
                    max={100}
                    pas="0.01"
                    valeur={tiers.increaseRate.toString()}
                  />
                  <Champ
                    nom="plafondEncours"
                    libelle="Plafond d'encours"
                    type="number"
                    min={0}
                    pas="0.01"
                    valeur={tiers.maxBalanceAmount.toString()}
                    aide="0 signifie qu'aucun plafond n'est applique."
                  />
                  <CaseACocher
                    nom="exonereTva"
                    libelle="Exonere de TVA"
                    coche={tiers.exemptFromVat}
                  />
                </div>
              </Section>

              <Section titre="Etat et blocage">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <CaseACocher nom="actif" libelle="Tiers actif" coche={tiers.isActive} />
                  <CaseACocher nom="bloque" libelle="Tiers bloque" coche={tiers.isBlocked} />
                  <Champ
                    nom="motifBlocage"
                    libelle="Motif du blocage"
                    type="textarea"
                    maxLength={500}
                    valeur={tiers.blockedReason ?? ""}
                    aide="Obligatoire des que le blocage est coche (au moins 5 caracteres)."
                  />
                  <Champ
                    nom="remarque"
                    libelle="Remarque interne"
                    type="textarea"
                    maxLength={1000}
                    valeur={tiers.remark ?? ""}
                  />
                </div>
              </Section>
            </FormulaireAction>
          </Carte>
        ) : (
          <Alerte ton="info" titre="Fiche en lecture seule">
            Votre profil ne detient pas la permission de modification des tiers : seuls la
            consultation et l&apos;historique documentaire vous sont accessibles.
          </Alerte>
        )}
      </div>
    </>
  );
}
