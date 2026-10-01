"use server";

import { revalidatePath } from "next/cache";
import type { AccountType, PaymentDirection, PaymentMethod } from "@prisma/client";
import {
  contrepasserEcriture,
  creerCompte,
  definirRegleEcriture,
  lettrerLignes,
} from "@/lib/comptabilite/service";
import {
  actualiserFacturesEnRetard,
  annulerReglement,
  enregistrerReglement,
} from "@/lib/comptabilite/reglement";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  dateOuNull,
  decimalObligatoire,
  decimalOuNull,
  entierOu,
  executer,
  texteObligatoire,
  texteOuNull,
  type ResultatAction,
} from "@/lib/actions/resultat";
import { validation } from "@/lib/errors";

/**
 * Actions de comptabilite et de reglement.
 *
 * Aucune ecriture postee n'est supprimee : les corrections passent par une
 * contre-passation motivee ou un avoir. Les actions ci-dessous ne font que
 * transmettre au service, qui porte les regles et journalise l'audit.
 */

export async function actionContrepasserEcriture(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.COMPTABILITE_CONTREPASSER);

  const entryId = entierOu(formData.get("entryId"));
  const motif = texteObligatoire(formData.get("motif"), "Motif de contre-passation");
  const dateSaisie = dateOuNull(formData.get("entryDate"));

  if (entryId === null) {
    return executer("Impossible : ecriture non identifiee.", async () => {
      throw validation("L'ecriture a contre-passer est introuvable.");
    });
  }

  return executer(
    "Contre-passation enregistree. L'ecriture d'origine reste consultable et n'a pas ete modifiee.",
    async () => {
      const resultat = await contrepasserEcriture(
        { entryId, motif, entryDate: dateSaisie ?? undefined },
        { id: acteur.id, email: acteur.email },
      );
      revalidatePath("/comptabilite/ecritures");
      revalidatePath(`/comptabilite/ecritures/${entryId}`);
      revalidatePath("/comptabilite/balance");
      return { numero: resultat.numero };
    },
  );
}

export async function actionLettrerLignes(formData: FormData): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.COMPTABILITE_SAISIR);

  const identifiants = String(formData.get("entryLineIds") ?? "")
    .split(/[\s,;]+/)
    .map((valeur) => Number.parseInt(valeur, 10))
    .filter((valeur) => Number.isFinite(valeur) && valeur > 0);
  const codeLettrage = texteObligatoire(formData.get("matchingCode"), "Code de lettrage");

  return executer("Lettrage enregistre : aucun montant n'a ete modifie.", async () => {
    const nombre = await lettrerLignes(
      { entryLineIds: identifiants, matchingCode: codeLettrage },
      { id: acteur.id, email: acteur.email },
    );
    revalidatePath("/comptabilite/balance");
    return { nombreLignes: nombre };
  });
}

export async function actionDefinirRegleEcriture(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.COMPTABILITE_REGLES_GERER);

  const eventCode = texteObligatoire(formData.get("eventCode"), "Code evenement");
  const label = texteObligatoire(formData.get("label"), "Libelle de la regle");
  const journalCode = texteObligatoire(formData.get("journalCode"), "Journal");
  const debitAccountNumber = texteObligatoire(
    formData.get("debitAccountNumber"),
    "Compte a debiter",
  );
  const creditAccountNumber = texteObligatoire(
    formData.get("creditAccountNumber"),
    "Compte a crediter",
  );

  return executer(
    "Regle d'ecriture enregistree. Elle s'appliquera aux prochains evenements comptables.",
    async () => {
      const id = await definirRegleEcriture(
        {
          eventCode,
          label,
          journalCode,
          debitAccountNumber,
          creditAccountNumber,
          vatAccountNumber: texteOuNull(formData.get("vatAccountNumber")),
          vatRateCode: texteOuNull(formData.get("vatRateCode")),
          description: texteOuNull(formData.get("description")),
        },
        { id: acteur.id, email: acteur.email },
      );
      revalidatePath("/comptabilite/regles");
      return { id };
    },
  );
}

export async function actionCreerCompte(formData: FormData): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.PLAN_COMPTABLE_GERER);

  const number = texteObligatoire(formData.get("number"), "Numero de compte");
  const label = texteObligatoire(formData.get("label"), "Libelle du compte");
  const type = texteObligatoire(formData.get("type"), "Type de compte") as AccountType;

  const typesValides: AccountType[] = [
    "ACTIF",
    "PASSIF",
    "CHARGE",
    "PRODUIT",
    "TRESORERIE",
    "CAPITAUX",
  ];
  if (!typesValides.includes(type)) {
    return executer("Type de compte invalide.", async () => {
      throw validation("Le type de compte doit etre un type comptable reconnu.");
    });
  }

  return executer("Compte comptable cree.", async () => {
    const id = await creerCompte(
      {
        number,
        label,
        type,
        parentNumber: texteOuNull(formData.get("parentNumber")),
        isAnalytic: formData.get("isAnalytic") === "on",
      },
      { id: acteur.id, email: acteur.email },
    );
    revalidatePath("/comptabilite/plan");
    return { id };
  });
}

/** Enregistrement d'un reglement client ou fournisseur. */
export async function actionEnregistrerReglement(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.REGLEMENT_SAISIR);

  const direction = texteObligatoire(formData.get("direction"), "Sens du reglement") as PaymentDirection;
  const thirdPartyId = entierOu(formData.get("thirdPartyId"));
  const method = texteObligatoire(formData.get("method"), "Mode de reglement") as PaymentMethod;
  const amount = decimalObligatoire(formData.get("amount"), "Montant");

  if (thirdPartyId === null) {
    return executer("Tiers non identifie.", async () => {
      throw validation("Le tiers du reglement est obligatoire.");
    });
  }

  const invoiceIds = formData.getAll("invoiceId");
  const montants = formData.getAll("invoiceAmount");
  const allocations = invoiceIds
    .map((valeur, index) => ({
      invoiceId: Number.parseInt(String(valeur), 10),
      montant: decimalOuNull(montants[index] ?? null),
    }))
    .filter((ligne) => Number.isFinite(ligne.invoiceId) && ligne.invoiceId > 0)
    .map((ligne) => ({
      invoiceId: ligne.invoiceId,
      amount: ligne.montant ?? undefined,
    }));

  return executer("Reglement enregistre, affecte aux factures et comptabilise.", async () => {
    const resultat = await enregistrerReglement({
      direction,
      thirdPartyId,
      method,
      amount,
      paymentDate: dateOuNull(formData.get("paymentDate")) ?? undefined,
      reference: texteOuNull(formData.get("reference")),
      bankAccount: texteOuNull(formData.get("bankAccount")),
      notes: texteOuNull(formData.get("notes")),
      allocations: allocations.length > 0 ? allocations : undefined,
      acteur: { id: acteur.id, email: acteur.email },
    });
    revalidatePath("/comptabilite/reglements");
    return { numero: resultat.numero, numeroEcriture: resultat.numeroEcriture };
  });
}

export async function actionAnnulerReglement(formData: FormData): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.REGLEMENT_VALIDER);

  const paymentId = entierOu(formData.get("paymentId"));
  const motif = texteObligatoire(formData.get("motif"), "Motif d'annulation");

  if (paymentId === null) {
    return executer("Reglement non identifie.", async () => {
      throw validation("Le reglement a annuler est introuvable.");
    });
  }

  return executer(
    "Reglement annule par contre-passation. L'ecriture d'origine reste consultable.",
    async () => {
      const resultat = await annulerReglement(
        { paymentId, motif },
        { id: acteur.id, email: acteur.email },
      );
      revalidatePath("/comptabilite/reglements");
      return { numeroContrePassation: resultat.numeroContrePassation };
    },
  );
}

export async function actionActualiserFacturesEnRetard(): Promise<ResultatAction> {
  await exigerPermission(PERMISSIONS.REGLEMENT_SAISIR);

  return executer("Factures echues mises a jour.", async () => {
    const nombre = await actualiserFacturesEnRetard();
    revalidatePath("/comptabilite/reglements");
    revalidatePath("/ventes/factures");
    revalidatePath("/achats/factures");
    return { nombreFactures: nombre };
  });
}
