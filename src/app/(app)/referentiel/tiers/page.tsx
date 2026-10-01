import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fabricantLien,
  lireParametresListe,
  modeInsensible,
  pagination,
  premiereValeur,
} from "@/lib/liste";
import { CLE_PARAMETRE, lireParametreTexte } from "@/lib/settings";
import {
  Carte,
  EnTetePage,
  Etiquette,
  EtiquetteStatut,
  Pagination,
  Tableau,
} from "@/components/ui";
import { DEVISE_PAR_DEFAUT, formatMontant } from "@/lib/format";
import { LIBELLES_MODE_REGLEMENT, libelle } from "@/lib/libelles";

export const metadata = { title: "Clients et fournisseurs" };

/** Natures selectionnables : elles correspondent aux indicateurs de la fiche tiers. */
const NATURES = [
  { code: "CLIENT", libelle: "Clients" },
  { code: "FOURNISSEUR", libelle: "Fournisseurs" },
  { code: "EMPLOYE", libelle: "Employes" },
  { code: "AUTRE", libelle: "Autres tiers" },
] as const;

export default async function PageTiers({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission(PERMISSIONS.TIERS_LIRE);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["nature", "etat"]);
  const nature = NATURES.find((valeur) => valeur.code === parametres.filtres.nature);
  const etat = parametres.filtres.etat;

  const conditions: Prisma.ThirdPartyWhereInput[] = [];
  if (nature) {
    if (nature.code === "CLIENT") conditions.push({ isClient: true });
    if (nature.code === "FOURNISSEUR") conditions.push({ isSupplier: true });
    if (nature.code === "EMPLOYE") conditions.push({ isEmployee: true });
    if (nature.code === "AUTRE") conditions.push({ isOther: true });
  }
  if (etat === "ACTIF") conditions.push({ isActive: true });
  if (etat === "INACTIF") conditions.push({ isActive: false });
  if (etat === "BLOQUE") conditions.push({ isBlocked: true });
  if (parametres.recherche) {
    const recherche = parametres.recherche;
    conditions.push({
      OR: [
        { code: modeInsensible(recherche) },
        { label1: modeInsensible(recherche) },
        { label2: modeInsensible(recherche) },
        { email: modeInsensible(recherche) },
        { phone1: modeInsensible(recherche) },
        { mobile: modeInsensible(recherche) },
        { taxId: modeInsensible(recherche) },
        { nif: modeInsensible(recherche) },
        { nis: modeInsensible(recherche) },
        { rc: modeInsensible(recherche) },
        { ai: modeInsensible(recherche) },
      ],
    });
  }
  const where: Prisma.ThirdPartyWhereInput =
    conditions.length > 0 ? { AND: conditions } : {};

  const [total, devise] = await Promise.all([
    prisma.thirdParty.count({ where }),
    lireParametreTexte(CLE_PARAMETRE.DEVISE, DEVISE_PAR_DEFAUT),
  ]);

  const bornes = pagination(total, parametres.page, parametres.taille);
  const tiers = await prisma.thirdParty.findMany({
    where,
    orderBy: { code: "asc" },
    skip: bornes.skip,
    take: bornes.take,
    select: {
      id: true,
      code: true,
      label1: true,
      label2: true,
      city: true,
      phone1: true,
      mobile: true,
      balance: true,
      maxBalanceAmount: true,
      isClient: true,
      isSupplier: true,
      isEmployee: true,
      isOther: true,
      isActive: true,
      isBlocked: true,
      blockedReason: true,
      paymentMethod: true,
      deadlineDays: true,
    },
  });

  const filtresCourants = {
    q: parametres.recherche,
    nature: premiereValeur(parametresBruts, "nature"),
    etat: premiereValeur(parametresBruts, "etat"),
  };

  return (
    <>
      <EnTetePage
        titre="Clients et fournisseurs"
        description="Tiers de l'entreprise : clients, fournisseurs, employes et autres partenaires. Le solde affiche est le solde reel enregistre en comptabilite, jamais une estimation."
        actions={
          <Link className="lien-nav text-sm" href="/referentiel/tiers/nouveau">
            Nouveau tiers
          </Link>
        }
      />

      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3"
        aria-label="Filtres des tiers"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Recherche</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={parametres.recherche ?? ""}
            placeholder="Code, libelle, NIF, RC, telephone..."
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Nature</span>
          <select className="champ" name="nature" defaultValue={filtresCourants.nature ?? ""}>
            <option value="">Toutes les natures</option>
            {NATURES.map((valeur) => (
              <option key={valeur.code} value={valeur.code}>
                {valeur.libelle}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Etat</span>
          <select className="champ" name="etat" defaultValue={filtresCourants.etat ?? ""}>
            <option value="">Tous les etats</option>
            <option value="ACTIF">Actifs</option>
            <option value="INACTIF">Inactifs</option>
            <option value="BLOQUE">Bloques</option>
          </select>
        </label>
        <button
          type="submit"
          className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
        >
          Filtrer
        </button>
        <Link className="lien-nav text-sm" href="/referentiel/tiers">
          Reinitialiser
        </Link>
      </form>

      <Carte
        titre="Liste des tiers"
        description={`${total} tiers correspondant aux criteres.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "code", libelle: "Code" },
            { cle: "libelle", libelle: "Libelle" },
            { cle: "natures", libelle: "Natures" },
            { cle: "telephone", libelle: "Telephone" },
            { cle: "reglement", libelle: "Reglement" },
            { cle: "solde", libelle: "Solde", nombre: true },
            { cle: "plafond", libelle: "Plafond d'encours", nombre: true },
            { cle: "blocage", libelle: "Blocage" },
          ]}
          lignes={tiers.map((tiersCourant) => {
            const plafondDepasse =
              D.gt(tiersCourant.maxBalanceAmount, 0) &&
              D.gt(tiersCourant.balance, tiersCourant.maxBalanceAmount);
            return {
              cle: String(tiersCourant.id),
              cellules: [
                <Link
                  key="code"
                  className="lien-nav"
                  href={`/referentiel/tiers/${tiersCourant.id}`}
                >
                  {tiersCourant.code}
                </Link>,
                <span key="libelle">
                  {tiersCourant.label1}
                  {tiersCourant.city && (
                    <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                      {tiersCourant.city}
                    </span>
                  )}
                </span>,
                <span key="natures" className="inline-flex flex-wrap gap-1">
                  {tiersCourant.isClient && <Etiquette ton="primaire">Client</Etiquette>}
                  {tiersCourant.isSupplier && <Etiquette ton="info">Fournisseur</Etiquette>}
                  {tiersCourant.isEmployee && <Etiquette ton="neutre">Employe</Etiquette>}
                  {tiersCourant.isOther && <Etiquette ton="neutre">Autre</Etiquette>}
                  {!tiersCourant.isClient &&
                    !tiersCourant.isSupplier &&
                    !tiersCourant.isEmployee &&
                    !tiersCourant.isOther && <Etiquette ton="alerte">Sans nature</Etiquette>}
                </span>,
                tiersCourant.phone1 ?? tiersCourant.mobile ?? "Non renseigne",
                tiersCourant.paymentMethod
                  ? `${libelle(LIBELLES_MODE_REGLEMENT, tiersCourant.paymentMethod)} — ${
                      tiersCourant.deadlineDays
                    } jour(s)`
                  : "Non defini",
                formatMontant(tiersCourant.balance, devise),
                <span key="plafond" className="inline-flex flex-wrap items-center gap-1">
                  {D.isZero(tiersCourant.maxBalanceAmount)
                    ? "Aucun plafond"
                    : formatMontant(tiersCourant.maxBalanceAmount, devise)}
                  {plafondDepasse && <Etiquette ton="danger">Plafond depasse</Etiquette>}
                </span>,
                tiersCourant.isBlocked ? (
                  <span key="blocage" className="inline-flex flex-wrap items-center gap-1">
                    <EtiquetteStatut code="BLOQUE" libelle="Bloque" />
                    <span className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      {tiersCourant.blockedReason ?? "Motif non renseigne"}
                    </span>
                  </span>
                ) : (
                  <EtiquetteStatut
                    key="blocage"
                    code={tiersCourant.isActive ? "ACTIF" : "INACTIF"}
                    libelle={tiersCourant.isActive ? "Actif" : "Inactif"}
                  />
                ),
              ],
            };
          })}
          messageVide="Aucun tiers ne correspond aux criteres selectionnes."
        />
        <Pagination
          page={parametres.page}
          pages={bornes.pages}
          total={total}
          construireLien={fabricantLien("/referentiel/tiers", filtresCourants)}
        />
      </Carte>
    </>
  );
}
