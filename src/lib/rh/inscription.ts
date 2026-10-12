import type { Factory } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { genererMotDePasseTemporaire, verifierRobustesseMotDePasse } from "@/lib/auth/password";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { estProprietaireUsine, peutAccederUsine } from "@/lib/rbac/portee";
import { accesRefuse, conflit, validation } from "@/lib/errors";
import { prochainNumero } from "@/lib/numbering";
import { creerCompteEmploye, creerEmploye, type EmployeInput } from "./service";

export type AccesNouvelEmploye = {
  id: number;
  matricule: string;
  nom: string;
  factory: Factory;
  identifiant: string;
  motDePasseTemporaire: string;
};

export function peutCreerAccesEmploye(utilisateur: SessionUser): boolean {
  return utilisateur.permissions.includes(PERMISSIONS.RH_ECRIRE) &&
    (utilisateur.permissions.includes(PERMISSIONS.UTILISATEUR_GERER) || estProprietaireUsine(utilisateur));
}

/** Le role est fixe par le serveur : aucun role du formulaire n'est utilise. */
export function verifierCreationAcces(utilisateur: SessionUser, factory: Factory): void {
  if (!peutCreerAccesEmploye(utilisateur) || !peutAccederUsine(utilisateur, factory)) {
    throw accesRefuse("Votre profil ne permet pas de creer un compte employe dans cette usine.");
  }
  if (factory !== "ADMEDCO" && factory !== "MOBILIX") {
    throw validation("Selectionnez l'usine ADMEDCO ou MOBILIX pour le compte operateur.");
  }
}

async function prochainMatricule(tx: Db, factory: Factory): Promise<string> {
  const prefix = factory === "ADMEDCO" ? "ADM" : "MBX";
  const code = "MATRICULE_" + factory;
  await tx.numberingSequence.upsert({
    where: { code }, update: {},
    create: { code, label: "Matricules " + factory, prefix, pattern: "{PREFIX}-{SEQ}", padding: 5, resetYearly: false },
  });
  // Les matricules saisis ou importes restent prioritaires. La sequence est atomique.
  for (let essai = 0;essai < 1000;essai += 1) {
    const matricule = await prochainNumero(code, tx);
    if (!await tx.employee.findUnique({ where: { matricule }, select: { id: true } })) return matricule;
  }
  throw conflit("La numerotation des employes doit etre verifiee par l'administrateur.");
}

export async function creerEmployeAvecAcces(
  entree: Omit<EmployeInput, "matricule"> & { matricule?: string },
  utilisateur: SessionUser,
): Promise<AccesNouvelEmploye> {
  const factory = entree.factory ?? "COMMUN";
  verifierCreationAcces(utilisateur, factory);
  if (!entree.firstName.trim() || !entree.lastName.trim()) throw validation("Le prenom et le nom sont obligatoires.");
  if (entree.firstName.trim().length > 80 || entree.lastName.trim().length > 80) throw validation("Le nom et le prenom sont limites a 80 caracteres.");
  if ((entree.matricule?.trim().length ?? 0) > 40) throw validation("Le matricule est limite a 40 caracteres.");

  let motDePasseTemporaire = genererMotDePasseTemporaire(14);
  while (!verifierRobustesseMotDePasse(motDePasseTemporaire).valide) {
    motDePasseTemporaire = genererMotDePasseTemporaire(14);
  }
  const acteur = { id: utilisateur.id, email: utilisateur.email };

  return prisma.$transaction(async (tx) => {
    if (entree.workshopId) {
      const atelier = await tx.workshop.findUnique({ where: { id: entree.workshopId } });
      if (!atelier?.isActive || atelier.factory !== factory) throw validation("L'atelier doit appartenir a l'usine de l'employe.");
    }
    if (entree.defaultWarehouseId) {
      const depot = await tx.warehouse.findUnique({ where: { id: entree.defaultWarehouseId } });
      if (!depot?.isActive || depot.factory !== factory) throw validation("Le depot doit appartenir a l'usine de l'employe.");
    }
    const matricule = entree.matricule?.trim() || await prochainMatricule(tx, factory);
    const id = await creerEmploye({ ...entree, matricule, factory }, acteur, tx);
    // Identifiant interne pour la connexion existante ; aucune boite mail n'est creee.
    const identifiant = entree.email?.trim().toLowerCase() || (factory === "ADMEDCO" ? "adm" : "mbx") + "." + id + "@erpmes.local";
    await creerCompteEmploye({
      employeeId: id, email: identifiant, motDePasse: motDePasseTemporaire,
      roleCodes: ["OPERATEUR_" + factory], mustChangePassword: true,
    }, acteur, tx);
    return { id, matricule, factory, nom: entree.firstName.trim() + " " + entree.lastName.trim(), identifiant, motDePasseTemporaire };
  }, { timeout: 30_000 });
}
