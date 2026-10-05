"use server";

import { revalidatePath } from "next/cache";
import type { Factory } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { ACTIONS_AUDIT, MODULES_AUDIT, enregistrerAudit } from "@/lib/audit";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  genererMotDePasseTemporaire,
  hacherMotDePasse,
  verifierRobustesseMotDePasse,
} from "@/lib/auth/password";
import { reinitialiserMotDePasse } from "@/lib/auth/service";
import { revoquerToutesLesSessions } from "@/lib/auth/session";
import { CLE_PARAMETRE, DEFINITIONS_PARAMETRES, ecrireParametre } from "@/lib/settings";
import { adopterArticleChassisPeint } from "@/lib/production/chassis-peint";
import {
  FICHIERS_SOURCE,
  importerArticles,
  importerEmployes,
  importerFamilles,
  importerLotsEtStocks,
  importerNomenclatures,
  importerTiers,
  lireSource,
  simulerImport,
  type ContexteImport,
  type ResultatImport,
} from "@/lib/import/service";
import {
  booleen,
  entierOu,
  executer,
  texteObligatoire,
  texteOuNull,
  type ResultatAction,
} from "@/lib/actions/resultat";
import { validation } from "@/lib/errors";

/**
 * Actions d'administration : parametres, utilisateurs, roles et import.
 *
 * Regles tenues par ce fichier :
 *   - aucun mot de passe n'est code en dur ni choisi par l'administrateur : le
 *     systeme genere un mot de passe temporaire aleatoire, impose son
 *     changement a la premiere connexion, et ne le conserve jamais en clair ;
 *   - chaque changement de permission ou de compte est journalise dans l'audit ;
 *   - un import ne supprime jamais une fiche absente du fichier source et
 *     n'ecrase jamais une fiche modifiee dans la plateforme.
 */

// -----------------------------------------------------------------------------
// Parametres applicatifs
// -----------------------------------------------------------------------------

export async function actionEcrireParametre(formData: FormData): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.CONFIG_GERER);

  const key = texteObligatoire(formData.get("key"), "Cle du parametre");
  const definition = DEFINITIONS_PARAMETRES[key];
  if (!definition) {
    return executer("Parametre inconnu.", async () => {
      throw validation(
        "Ce parametre n'est pas reconnu. Les parametres disponibles sont definis par l'application.",
      );
    });
  }

  const brut = formData.get("value");
  let valeur: string | number | boolean;

  if (typeof definition.valeur === "boolean") {
    valeur = booleen(brut);
  } else if (typeof definition.valeur === "number") {
    const nombre = Number(String(brut ?? "").replace(",", "."));
    if (!Number.isFinite(nombre)) {
      return executer("Valeur numerique invalide.", async () => {
        throw validation(`« ${definition.label} » doit etre un nombre.`);
      });
    }
    valeur = nombre;
  } else {
    const texte = texteOuNull(brut);
    if (texte === null) {
      return executer("Valeur obligatoire.", async () => {
        throw validation(`« ${definition.label} » ne peut pas etre vide.`);
      });
    }
    valeur = texte;
  }

  return executer("Parametre enregistre. La modification est journalisee.", async () => {
    await ecrireParametre(key, valeur, { id: acteur.id, email: acteur.email });
    revalidatePath("/administration/parametres");
    return { cle: key };
  });
}

// -----------------------------------------------------------------------------
// Semi-fini du transfert inter-divisions (chassis peint)
// -----------------------------------------------------------------------------

/**
 * Confirme l'article utilise par le transfert automatique de fin de poudrage.
 * L'ancien article n'est ni supprime ni modifie : seule la regle de transfert
 * change de cible, et le changement est journalise.
 */
export async function actionAdopterArticleChassisPeint(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.CONFIG_GERER);
  const itemId = entierOu(formData.get("itemId"), 0) ?? 0;

  return executer("Article du transfert inter-divisions mis a jour.", async () => {
    if (itemId <= 0) {
      throw validation("Aucun article n'a ete transmis.");
    }

    const resultat = await adopterArticleChassisPeint(prisma, itemId, {
      id: acteur.id,
      email: acteur.email,
    });

    revalidatePath("/administration/parametres");
    return { itemId: resultat.itemId, code: resultat.code };
  });
}

// -----------------------------------------------------------------------------
// Utilisateurs
// -----------------------------------------------------------------------------

async function resoudreRoles(roleCodes: string[]) {
  if (roleCodes.length === 0) {
    throw validation("Au moins un role doit etre attribue au compte.");
  }
  const roles = await prisma.role.findMany({
    where: { code: { in: roleCodes }, isActive: true },
    select: { id: true, code: true },
  });
  const manquants = roleCodes.filter((code) => !roles.some((role) => role.code === code));
  if (manquants.length > 0) {
    throw validation(`Roles inconnus ou inactifs : ${manquants.join(", ")}.`);
  }
  return roles;
}

export async function actionCreerUtilisateur(formData: FormData): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.UTILISATEUR_GERER);

  const email = texteObligatoire(formData.get("email"), "Adresse electronique").toLowerCase();
  const roleCodes = formData.getAll("roleCode").map((valeur) => String(valeur));
  const employeeId = entierOu(formData.get("employeeId"));

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return executer("Adresse electronique invalide.", async () => {
      throw validation("L'adresse electronique n'est pas valide.");
    });
  }

  return executer(
    "Compte cree. Le mot de passe temporaire s'affiche une seule fois : transmettez-le a l'interesse, qui devra le changer a sa premiere connexion.",
    async () => {
      const roles = await resoudreRoles(roleCodes);

      const existant = await prisma.user.findUnique({ where: { email } });
      if (existant) {
        throw validation(
          `L'adresse « ${email} » est deja utilisee. Chaque personne doit disposer de son propre compte.`,
        );
      }

      if (employeeId !== null) {
        const employe = await prisma.employee.findUnique({ where: { id: employeeId } });
        if (!employe) throw validation("La fiche employe indiquee est introuvable.");
        if (employe.userId) {
          throw validation(
            `${employe.firstName} ${employe.lastName} possede deja un compte nominatif.`,
          );
        }
      }

      const motDePasseTemporaire = genererMotDePasseTemporaire(16);
      const passwordHash = await hacherMotDePasse(motDePasseTemporaire);

      const compte = await prisma.$transaction(async (tx) => {
        const utilisateur = await tx.user.create({
          data: { email, passwordHash, isActive: true, mustChangePassword: true },
        });

        for (const role of roles) {
          await tx.userRole.create({ data: { userId: utilisateur.id, roleId: role.id } });
        }

        if (employeeId !== null) {
          await tx.employee.update({
            where: { id: employeeId },
            data: { userId: utilisateur.id, email },
          });
        }

        return utilisateur;
      });

      await enregistrerAudit({
        action: ACTIONS_AUDIT.UTILISATEUR_CREE,
        module: MODULES_AUDIT.SYSTEME,
        entity: "User",
        entityId: compte.id,
        userId: acteur.id,
        userEmail: acteur.email,
        newValue: {
          email,
          roles: roles.map((role) => role.code),
          employeeId,
          changementMotDePasseObligatoire: true,
        },
        comment:
          "Mot de passe temporaire genere par le systeme et transmis hors plateforme ; il n'est jamais conserve en clair.",
      });

      revalidatePath("/administration/utilisateurs");

      return { motDePasseTemporaire, identifiant: compte.id };
    },
  );
}

export async function actionReinitialiserMotDePasseUtilisateur(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.UTILISATEUR_GERER);

  const userId = entierOu(formData.get("userId"));
  if (userId === null) {
    return executer("Compte non identifie.", async () => {
      throw validation("Le compte a reinitialiser est introuvable.");
    });
  }
  if (userId === acteur.id) {
    return executer("Operation refusee.", async () => {
      throw validation(
        "Utilisez la page « Mon compte » pour changer votre propre mot de passe : la reinitialisation administrateur ne s'applique pas a votre propre compte.",
      );
    });
  }

  return executer(
    "Mot de passe reinitialise. Le nouveau mot de passe temporaire s'affiche une seule fois et devra etre change a la prochaine connexion.",
    async () => {
      const motDePasseTemporaire = genererMotDePasseTemporaire(16);
      const robustesse = verifierRobustesseMotDePasse(motDePasseTemporaire);
      if (!robustesse.valide) {
        throw validation(
          "Le mot de passe genere n'a pas satisfait les regles de robustesse. Relancez l'operation.",
        );
      }

      await reinitialiserMotDePasse(userId, motDePasseTemporaire, acteur.id);
      const sessions = await revoquerToutesLesSessions(userId);

      revalidatePath("/administration/utilisateurs");
      return { motDePasseTemporaire, sessionsRevoquees: sessions };
    },
  );
}

export async function actionBasculerActivationUtilisateur(
  formData: FormData,
): Promise<ResultatAction> {  const acteur = await exigerPermission(PERMISSIONS.UTILISATEUR_GERER);

  const userId = entierOu(formData.get("userId"));
  const motif = texteObligatoire(formData.get("motif"), "Motif");
  if (userId === null) {
    return executer("Compte non identifie.", async () => {
      throw validation("Le compte est introuvable.");
    });
  }
  if (userId === acteur.id) {
    return executer("Operation refusee.", async () => {
      throw validation("Vous ne pouvez pas desactiver votre propre compte.");
    });
  }

  return executer("Etat du compte modifie.", async () => {
    const compte = await prisma.user.findUnique({
      where: { id: userId },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    if (!compte) throw validation("Le compte est introuvable.");

    const nouvelleValeur = !compte.isActive;

    await prisma.user.update({
      where: { id: userId },
      data: {
        isActive: nouvelleValeur,
        disabledAt: nouvelleValeur ? null : new Date(),
        failedAttempts: nouvelleValeur ? compte.failedAttempts : 0,
        lockedUntil: nouvelleValeur ? compte.lockedUntil : null,
      },
    });

    let sessions = 0;
    if (!nouvelleValeur) {
      sessions = await revoquerToutesLesSessions(userId);
    }

    await enregistrerAudit({
      action: nouvelleValeur
        ? ACTIONS_AUDIT.MODIFICATION
        : ACTIONS_AUDIT.UTILISATEUR_DESACTIVE,
      module: MODULES_AUDIT.SYSTEME,
      entity: "User",
      entityId: userId,
      userId: acteur.id,
      userEmail: acteur.email,
      oldValue: { isActive: compte.isActive },
      newValue: { isActive: nouvelleValeur, sessionsRevoquees: sessions },
      reason: motif,
    });

    revalidatePath("/administration/utilisateurs");
    return { actif: nouvelleValeur, sessionsRevoquees: sessions };
  });
}

export async function actionAssignerRolesUtilisateur(formData: FormData): Promise<ResultatAction> {  const acteur = await exigerPermission(PERMISSIONS.ROLE_GERER);

  const userId = entierOu(formData.get("userId"));
  const roleCodes = formData.getAll("roleCode").map((valeur) => String(valeur));
  const motif = texteObligatoire(formData.get("motif"), "Motif");

  if (userId === null) {
    return executer("Compte non identifie.", async () => {
      throw validation("Le compte est introuvable.");
    });
  }

  return executer("Roles du compte mis a jour. Le changement est journalise.", async () => {
    const roles = await resoudreRoles(roleCodes);
    const compte = await prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!compte) throw validation("Le compte est introuvable.");

    const avant = compte.roles.map((lien) => lien.role.code);

    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      for (const role of roles) {
        await tx.userRole.create({ data: { userId, roleId: role.id } });
      }
    });

    // Un changement de droits ne doit pas rester actif dans les sessions
    // ouvertes : l'utilisateur se reconnecte avec ses nouveaux droits.
    const sessions = await revoquerToutesLesSessions(userId);

    await enregistrerAudit({
      action: ACTIONS_AUDIT.CHANGEMENT_PERMISSION,
      module: MODULES_AUDIT.SYSTEME,
      entity: "User",
      entityId: userId,
      userId: acteur.id,
      userEmail: acteur.email,
      oldValue: { roles: avant },
      newValue: { roles: roles.map((role) => role.code), sessionsRevoquees: sessions },
      reason: motif,
    });

    revalidatePath("/administration/utilisateurs");
    return { roles: roles.map((role) => role.code), sessionsRevoquees: sessions };
  });
}

export async function actionRevoquerSessionsUtilisateur(
  formData: FormData,
): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.UTILISATEUR_GERER);

  const userId = entierOu(formData.get("userId"));
  const motif = texteObligatoire(formData.get("motif"), "Motif");
  if (userId === null) {
    return executer("Compte non identifie.", async () => {
      throw validation("Le compte est introuvable.");
    });
  }

  return executer("Sessions ouvertes fermees. Le compte devra se reconnecter.", async () => {
    const compte = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!compte) throw validation("Le compte est introuvable.");

    const sessions = await revoquerToutesLesSessions(userId);

    await enregistrerAudit({
      action: ACTIONS_AUDIT.MODIFICATION,
      module: MODULES_AUDIT.SYSTEME,
      entity: "User",
      entityId: userId,
      userId: acteur.id,
      userEmail: acteur.email,
      newValue: { sessionsRevoquees: sessions },
      reason: motif,
    });

    revalidatePath(`/administration/utilisateurs/${userId}`);
    return { sessionsRevoquees: sessions };
  });
}

// -----------------------------------------------------------------------------
// Roles et permissions
// -----------------------------------------------------------------------------
export async function actionEnregistrerRole(formData: FormData): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.ROLE_GERER);

  const code = texteObligatoire(formData.get("code"), "Code du role").toUpperCase();
  const label = texteObligatoire(formData.get("label"), "Libelle du role");
  const description = texteOuNull(formData.get("description"));
  const factoryScope = texteObligatoire(formData.get("factoryScope"), "Portee") as Factory;
  const permissionCodes = formData.getAll("permissionCode").map((valeur) => String(valeur));
  const estNouveau = booleen(formData.get("estNouveau"));

  const porteesValides: Factory[] = ["ADMEDCO", "MOBILIX", "COMMUN"];
  if (!porteesValides.includes(factoryScope)) {
    return executer("Portee invalide.", async () => {
      throw validation("La portee doit etre ADMEDCO, MOBILIX ou COMMUN.");
    });
  }
  if (permissionCodes.length === 0) {
    return executer("Aucune permission selectionnee.", async () => {
      throw validation(
        "Un role sans permission ne donnerait acces a rien : selectionnez au moins une permission.",
      );
    });
  }

  return executer("Role enregistre. Les comptes concernes se reconnecteront avec les nouveaux droits.", async () => {
    const permissions = await prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
      select: { id: true, code: true },
    });
    const manquantes = permissionCodes.filter(
      (codePermission) => !permissions.some((p) => p.code === codePermission),
    );
    if (manquantes.length > 0) {
      throw validation(`Permissions inconnues : ${manquantes.join(", ")}.`);
    }

    const existant = await prisma.role.findUnique({
      where: { code },
      include: { permissions: { include: { permission: true } } },
    });

    if (estNouveau && existant) {
      throw validation(`Le role « ${code} » existe deja.`);
    }
    if (!estNouveau && !existant) {
      throw validation(`Le role « ${code} » est introuvable.`);
    }

    const avant = existant?.permissions.map((lien) => lien.permission.code) ?? [];

    const roleId = await prisma.$transaction(async (tx) => {
      const role = existant
        ? await tx.role.update({
            where: { id: existant.id },
            data: { label, description, factoryScope },
          })
        : await tx.role.create({
            data: { code, label, description, factoryScope, isActive: true },
          });

      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      for (const permission of permissions) {
        await tx.rolePermission.create({
          data: { roleId: role.id, permissionId: permission.id },
        });
      }

      return role.id;
    });

    await enregistrerAudit({
      action: ACTIONS_AUDIT.CHANGEMENT_PERMISSION,
      module: MODULES_AUDIT.SYSTEME,
      entity: "Role",
      entityId: roleId,
      userId: acteur.id,
      userEmail: acteur.email,
      oldValue: { permissions: avant, label: existant?.label ?? null },
      newValue: {
        code,
        label,
        factoryScope,
        permissions: permissions.map((permission) => permission.code),
      },
      comment: estNouveau ? "Creation du role" : "Modification du role",
    });

    revalidatePath("/administration/roles");
    return { roleId };
  });
}

export async function actionBasculerActivationRole(formData: FormData): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.ROLE_GERER);

  const roleId = entierOu(formData.get("roleId"));
  const motif = texteObligatoire(formData.get("motif"), "Motif");
  if (roleId === null) {
    return executer("Role non identifie.", async () => {
      throw validation("Le role est introuvable.");
    });
  }

  return executer("Etat du role modifie.", async () => {
    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: { users: { select: { userId: true } } },
    });
    if (!role) throw validation("Le role est introuvable.");

    const nouvelleValeur = !role.isActive;
    await prisma.role.update({ where: { id: roleId }, data: { isActive: nouvelleValeur } });

    let sessions = 0;
    if (!nouvelleValeur) {
      for (const lien of role.users) {
        sessions += await revoquerToutesLesSessions(lien.userId);
      }
    }

    await enregistrerAudit({
      action: ACTIONS_AUDIT.CHANGEMENT_PERMISSION,
      module: MODULES_AUDIT.SYSTEME,
      entity: "Role",
      entityId: roleId,
      userId: acteur.id,
      userEmail: acteur.email,
      oldValue: { isActive: role.isActive },
      newValue: {
        isActive: nouvelleValeur,
        comptesConcernes: role.users.length,
        sessionsRevoquees: sessions,
      },
      reason: motif,
    });

    revalidatePath("/administration/roles");
    return { actif: nouvelleValeur, comptesConcernes: role.users.length };
  });
}

// -----------------------------------------------------------------------------
// Import des donnees sources
// -----------------------------------------------------------------------------

type TypeImport =
  | "FAMILLES"
  | "ARTICLES"
  | "TIERS"
  | "EMPLOYES"
  | "NOMENCLATURES"
  | "LOTS";

function resumeImport(resultat: ResultatImport): string {
  const compteurs = resultat.compteurs;
  const parties = [
    `${compteurs.lues} ligne(s) lue(s)`,
    `${compteurs.inserees} creation(s)`,
    `${compteurs.misesAJour} mise(s) a jour`,
    `${compteurs.ignorees} ignoree(s)`,
    `${compteurs.protegees} protegee(s)`,
    `${compteurs.rejetees} rejetee(s)`,
  ];
  const avertissements =
    resultat.avertissements.length > 0
      ? ` Points a examiner : ${resultat.avertissements.slice(0, 3).join(" ")}`
      : "";
  return `${resultat.fichier} — ${parties.join(", ")}.${avertissements}`;
}

/**
 * Lance un import depuis le dossier source configure.
 *
 * Le mode simulation n'ecrit rien : il produit exactement le meme rapport et
 * permet de verifier les colonnes, les doublons et les rejets avant d'ecrire.
 */
export async function actionLancerImport(formData: FormData): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.IMPORT_EXECUTER);

  const type = texteObligatoire(formData.get("type"), "Type d'import") as TypeImport;
  const dossierConfigure =
    texteOuNull(formData.get("dossier")) ?? "E:\\Massiexporte";
  const simulation = booleen(formData.get("simulation"));
  const miseAJourAutorisee = booleen(formData.get("miseAJourAutorisee"));

  const typesValides: TypeImport[] = [
    "FAMILLES",
    "ARTICLES",
    "TIERS",
    "EMPLOYES",
    "NOMENCLATURES",
    "LOTS",
  ];
  if (!typesValides.includes(type)) {
    return executer("Type d'import inconnu.", async () => {
      throw validation("Ce type d'import n'existe pas.");
    });
  }

  const fichiersDuType: string[] =
    type === "FAMILLES"
      ? [FICHIERS_SOURCE.ITEM_FAMILY]
      : type === "ARTICLES"
        ? [FICHIERS_SOURCE.ITEM]
        : type === "TIERS"
          ? [FICHIERS_SOURCE.THIRD_PARTY]
          : type === "EMPLOYES"
            ? [FICHIERS_SOURCE.THIRD_PARTY]
            : type === "NOMENCLATURES"
            ? [FICHIERS_SOURCE.FORMULA, FICHIERS_SOURCE.FORMULA_LINE]
            : [FICHIERS_SOURCE.BATCH];

  const messageSucces = simulation
    ? "Simulation terminee : aucune donnee n'a ete ecrite. Le rapport indique ce que l'import reel produirait."
    : "Import termine. Les fiches absentes du fichier source n'ont pas ete supprimees et les fiches modifiees dans la plateforme ont ete protegees.";

  return executer(messageSucces, async () => {
    // Les fichiers sont lus avant l'ouverture de la transaction : celle-ci ne
    // contient alors que les ecritures a annuler.
    const contextes = new Map<string, ContexteImport>();
    const contexte = (nomFichier: string, db?: Db): ContexteImport => {
      let base = contextes.get(nomFichier);
      if (!base) {
        base = {
          acteur: { id: acteur.id, email: acteur.email },
          fichier: lireSource(dossierConfigure, nomFichier),
          nomFichier,
          miseAJourAutorisee,
          simulation,
        };
        contextes.set(nomFichier, base);
      }
      return db ? { ...base, db } : base;
    };

    for (const nomFichier of fichiersDuType) contexte(nomFichier);

    const executerImport = (db?: Db): Promise<ResultatImport> => {
      switch (type) {
        case "FAMILLES":
          return importerFamilles(contexte(FICHIERS_SOURCE.ITEM_FAMILY, db));
        case "ARTICLES":
          return importerArticles(contexte(FICHIERS_SOURCE.ITEM, db));
        case "TIERS":
          return importerTiers(contexte(FICHIERS_SOURCE.THIRD_PARTY, db));
        case "EMPLOYES":
          return importerEmployes(contexte(FICHIERS_SOURCE.THIRD_PARTY, db));
        case "NOMENCLATURES":
          return importerNomenclatures(
            contexte(FICHIERS_SOURCE.FORMULA, db),
            contexte(FICHIERS_SOURCE.FORMULA_LINE, db),
          );
        default:
          return importerLotsEtStocks(contexte(FICHIERS_SOURCE.BATCH, db));
      }
    };

    // Une simulation execute l'import complet puis annule la transaction :
    // le rapport est celui d'un import reel, sans aucune ecriture conservee.
    const resultat = simulation
      ? await simulerImport((tx) => executerImport(tx))
      : await executerImport();

    revalidatePath("/administration/import");

    return {
      rapport: resumeImport(resultat),
      jobId: resultat.jobId,
      simulation,
      rejetees: resultat.compteurs.rejetees,
    };
  });
}

export async function actionEnregistrerDossierImport(formData: FormData): Promise<ResultatAction> {
  const acteur = await exigerPermission(PERMISSIONS.CONFIG_GERER);
  const dossier = texteObligatoire(formData.get("dossier"), "Dossier source");

  return executer("Dossier source enregistre.", async () => {
    await ecrireParametre(CLE_PARAMETRE.DOSSIER_IMPORT_SOURCE, dossier, {
      id: acteur.id,
      email: acteur.email,
    });
    revalidatePath("/administration/import");
    revalidatePath("/administration/parametres");
    return { dossier };
  });
}
