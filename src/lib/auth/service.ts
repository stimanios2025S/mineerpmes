import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { accesRefuse, nonTrouve, validation } from "@/lib/errors";
import {
  ACTIONS_AUDIT,
  MODULES_AUDIT,
  enregistrerAudit,
} from "@/lib/audit";
import {
  hashDoitEtreMisAJour,
  hacherMotDePasse,
  verifierMotDePasse,
  verifierRobustesseMotDePasse,
} from "./password";
import {
  SESSION_COOKIE,
  creerSession,
  optionsCookieSession,
  revoquerSession,
  revoquerToutesLesSessions,
  chargerUtilisateurCourant,
  type SessionUser,
} from "./session";

const TENTATIVES_MAX = 5;
const VERROUILLAGE_MINUTES = 15;

export interface ContexteRequete {
  ip: string | null;
  userAgent: string | null;
}

export async function contexteRequete(): Promise<ContexteRequete> {
  const entetes = await headers();
  const ipBrute =
    entetes.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    entetes.get("x-real-ip") ??
    null;
  return {
    ip: ipBrute,
    userAgent: entetes.get("user-agent"),
  };
}

export interface ResultatConnexion {
  utilisateur: SessionUser;
  expiresAt: Date;
}

/**
 * Authentification par identifiant et mot de passe.
 * Les echecs sont journalises, le compte est verrouille temporairement apres
 * plusieurs tentatives infructueuses.
 */
export async function connecter(
  emailSaisi: string,
  motDePasse: string,
): Promise<ResultatConnexion> {
  const email = emailSaisi.trim().toLowerCase();
  const contexte = await contexteRequete();

  if (!email || !motDePasse) {
    throw validation("L'adresse electronique et le mot de passe sont obligatoires.");
  }

  const utilisateur = await prisma.user.findUnique({ where: { email } });

  // Message identique dans tous les cas d'echec : aucune information sur
  // l'existence ou non du compte n'est divulguee.
  const messageEchec = "Adresse electronique ou mot de passe incorrect.";

  if (!utilisateur) {
    await enregistrerAudit({
      action: ACTIONS_AUDIT.CONNEXION_ECHOUEE,
      module: MODULES_AUDIT.AUTHENTIFICATION,
      entity: "User",
      entityId: null,
      userEmail: email,
      ip: contexte.ip,
      userAgent: contexte.userAgent,
      reason: "Compte inconnu",
    });
    throw accesRefuse(messageEchec);
  }

  if (utilisateur.lockedUntil && utilisateur.lockedUntil.getTime() > Date.now()) {
    const minutesRestantes = Math.max(
      1,
      Math.ceil((utilisateur.lockedUntil.getTime() - Date.now()) / 60000),
    );
    await enregistrerAudit({
      action: ACTIONS_AUDIT.CONNEXION_ECHOUEE,
      module: MODULES_AUDIT.AUTHENTIFICATION,
      entity: "User",
      entityId: utilisateur.id,
      userId: utilisateur.id,
      userEmail: utilisateur.email,
      ip: contexte.ip,
      reason: "Compte verrouille",
    });
    throw accesRefuse(
      `Ce compte est temporairement verrouille. Nouvelle tentative possible dans ${minutesRestantes} minute(s).`,
    );
  }

  if (!utilisateur.isActive) {
    await enregistrerAudit({
      action: ACTIONS_AUDIT.CONNEXION_ECHOUEE,
      module: MODULES_AUDIT.AUTHENTIFICATION,
      entity: "User",
      entityId: utilisateur.id,
      userId: utilisateur.id,
      userEmail: utilisateur.email,
      ip: contexte.ip,
      reason: "Compte desactive",
    });
    throw accesRefuse(
      "Ce compte est desactive. Contactez l'administrateur de la plateforme.",
    );
  }

  const motDePasseValide = await verifierMotDePasse(motDePasse, utilisateur.passwordHash);

  if (!motDePasseValide) {
    const tentatives = utilisateur.failedAttempts + 1;
    const verrouiller = tentatives >= TENTATIVES_MAX;
    await prisma.user.update({
      where: { id: utilisateur.id },
      data: {
        failedAttempts: verrouiller ? 0 : tentatives,
        lockedUntil: verrouiller
          ? new Date(Date.now() + VERROUILLAGE_MINUTES * 60000)
          : utilisateur.lockedUntil,
      },
    });

    await enregistrerAudit({
      action: verrouiller ? ACTIONS_AUDIT.COMPTE_VERROUILLE : ACTIONS_AUDIT.CONNEXION_ECHOUEE,
      module: MODULES_AUDIT.AUTHENTIFICATION,
      entity: "User",
      entityId: utilisateur.id,
      userId: utilisateur.id,
      userEmail: utilisateur.email,
      ip: contexte.ip,
      userAgent: contexte.userAgent,
      reason: verrouiller
        ? `Verrouillage apres ${TENTATIVES_MAX} tentatives infructueuses`
        : `Mot de passe invalide (tentative ${tentatives})`,
    });

    if (verrouiller) {
      throw accesRefuse(
        `Trop de tentatives infructueuses. Le compte est verrouille pendant ${VERROUILLAGE_MINUTES} minutes.`,
      );
    }
    throw accesRefuse(messageEchec);
  }

  // Rehachage transparent si les parametres de cout ont evolue.
  if (hashDoitEtreMisAJour(utilisateur.passwordHash)) {
    const nouveauHash = await hacherMotDePasse(motDePasse);
    await prisma.user.update({
      where: { id: utilisateur.id },
      data: { passwordHash: nouveauHash },
    });
  }

  await prisma.user.update({
    where: { id: utilisateur.id },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: contexte.ip,
    },
  });

  const { token, expiresAt } = await creerSession(utilisateur.id, contexte);

  const cookieStore = await cookies();
  cookieStore.set({ ...optionsCookieSession(expiresAt), value: token });

  const sessionUtilisateur = await chargerUtilisateurCourant();
  if (!sessionUtilisateur) {
    throw nonTrouve("Session utilisateur");
  }

  await enregistrerAudit({
    action: ACTIONS_AUDIT.CONNEXION,
    module: MODULES_AUDIT.AUTHENTIFICATION,
    entity: "User",
    entityId: utilisateur.id,
    userId: utilisateur.id,
    userEmail: utilisateur.email,
    ip: contexte.ip,
    userAgent: contexte.userAgent,
  });

  return { utilisateur: sessionUtilisateur, expiresAt };
}

export async function deconnecter(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const contexte = await contexteRequete();

  if (token) {
    const session = await prisma.session.findUnique({
      where: { tokenHash: (await import("./session")).hashToken(token) },
      include: { user: { select: { id: true, email: true } } },
    });

    await revoquerSession(token);

    if (session) {
      await enregistrerAudit({
        action: ACTIONS_AUDIT.DECONNEXION,
        module: MODULES_AUDIT.AUTHENTIFICATION,
        entity: "User",
        entityId: session.user.id,
        userId: session.user.id,
        userEmail: session.user.email,
        ip: contexte.ip,
      });
    }
  }

  cookieStore.delete(SESSION_COOKIE);
}

export interface ResultatChangementMotDePasse {
  ok: true;
}

export async function changerMotDePasse(
  userId: number,
  motDePasseActuel: string,
  nouveauMotDePasse: string,
  confirmation: string,
): Promise<ResultatChangementMotDePasse> {
  const contexte = await contexteRequete();

  const utilisateur = await prisma.user.findUnique({ where: { id: userId } });
  if (!utilisateur || !utilisateur.isActive) {
    throw nonTrouve("Utilisateur");
  }

  const actuelValide = await verifierMotDePasse(motDePasseActuel, utilisateur.passwordHash);
  if (!actuelValide) {
    throw validation("Le mot de passe actuel est incorrect.", {
      motDePasseActuel: "Mot de passe actuel incorrect.",
    });
  }

  if (nouveauMotDePasse !== confirmation) {
    throw validation("Les deux saisies du nouveau mot de passe ne correspondent pas.", {
      confirmation: "La confirmation ne correspond pas au nouveau mot de passe.",
    });
  }

  const robustesse = verifierRobustesseMotDePasse(nouveauMotDePasse);
  if (!robustesse.valide) {
    throw validation(robustesse.erreurs[0], { nouveauMotDePasse: robustesse.erreurs[0] });
  }

  if (await verifierMotDePasse(nouveauMotDePasse, utilisateur.passwordHash)) {
    throw validation("Le nouveau mot de passe doit etre different de l'ancien.", {
      nouveauMotDePasse: "Ce mot de passe est deja utilise.",
    });
  }

  const nouveauHash = await hacherMotDePasse(nouveauMotDePasse);
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: nouveauHash,
      mustChangePassword: false,
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  // Toutes les autres sessions sont invalidees apres un changement de mot de passe.
  await revoquerToutesLesSessions(userId);

  await enregistrerAudit({
    action: ACTIONS_AUDIT.MOT_DE_PASSE_CHANGE,
    module: MODULES_AUDIT.AUTHENTIFICATION,
    entity: "User",
    entityId: userId,
    userId,
    userEmail: utilisateur.email,
    ip: contexte.ip,
    reason: "Changement de mot de passe par l'utilisateur",
  });

  return { ok: true };
}

/** Reinitialisation par un administrateur : renvoie un mot de passe temporaire. */
export async function reinitialiserMotDePasse(
  userId: number,
  motDePasseTemporaire: string,
  administrateurId: number,
): Promise<void> {
  const contexte = await contexteRequete();

  const utilisateur = await prisma.user.findUnique({ where: { id: userId } });
  if (!utilisateur) throw nonTrouve("Utilisateur");

  const hash = await hacherMotDePasse(motDePasseTemporaire);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: hash,
      mustChangePassword: true,
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  await revoquerToutesLesSessions(userId);

  await enregistrerAudit({
    action: ACTIONS_AUDIT.MOT_DE_PASSE_REINITIALISE,
    module: MODULES_AUDIT.AUTHENTIFICATION,
    entity: "User",
    entityId: userId,
    userId: administrateurId,
    userEmail: utilisateur.email,
    ip: contexte.ip,
    reason: "Reinitialisation par un administrateur",
    comment: "L'utilisateur devra changer son mot de passe a la prochaine connexion.",
  });
}
