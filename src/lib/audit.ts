import { Prisma } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";

/**
 * Journal d'audit : toute operation sensible y laisse une trace immuable.
 * Les valeurs sont serialisees en JSON en convertissant les Decimal en chaine
 * afin de conserver la precision exacte des quantites et des montants.
 */

export const ACTIONS_AUDIT = {
  CONNEXION: "CONNEXION",
  CONNEXION_ECHOUEE: "CONNEXION_ECHOUEE",
  DECONNEXION: "DECONNEXION",
  COMPTE_VERROUILLE: "COMPTE_VERROUILLE",
  MOT_DE_PASSE_CHANGE: "MOT_DE_PASSE_CHANGE",
  MOT_DE_PASSE_REINITIALISE: "MOT_DE_PASSE_REINITIALISE",
  CREATION: "CREATION",
  MODIFICATION: "MODIFICATION",
  VALIDATION: "VALIDATION",
  APPROBATION: "APPROBATION",
  ANNULATION: "ANNULATION",
  SUPPRESSION_LOGIQUE: "SUPPRESSION_LOGIQUE",
  MOUVEMENT_STOCK: "MOUVEMENT_STOCK",
  MOUVEMENT_ANNULE: "MOUVEMENT_ANNULE",
  CONSOMMATION: "CONSOMMATION",
  PERTE: "PERTE",
  REBUT: "REBUT",
  REPRISE: "REPRISE",
  PRODUCTION: "PRODUCTION",
  TRANSFERT_DIVISION: "TRANSFERT_DIVISION",
  TRANSFERT_SOUS_STOCK: "TRANSFERT_SOUS_STOCK",
  SCAN_POSTE: "SCAN_POSTE",
  PUBLICATION_PROGRAMME: "PUBLICATION_PROGRAMME",
  CHANGEMENT_NOMENCLATURE: "CHANGEMENT_NOMENCLATURE",
  CHANGEMENT_PERMISSION: "CHANGEMENT_PERMISSION",
  CHANGEMENT_AFFECTATION: "CHANGEMENT_AFFECTATION",
  IMPORT: "IMPORT",
  EXPORT: "EXPORT",
  FACTURATION: "FACTURATION",
  REGLEMENT: "REGLEMENT",
  ECRITURE_COMPTABLE: "ECRITURE_COMPTABLE",
  CONTREPASSATION: "CONTREPASSATION",
  CORRECTION: "CORRECTION",
  QUALITE: "QUALITE",
  QUANTITE_MODIFIEE: "QUANTITE_MODIFIEE",
  UTILISATEUR_CREE: "UTILISATEUR_CREE",
  UTILISATEUR_DESACTIVE: "UTILISATEUR_DESACTIVE",
} as const;

export type ActionAudit = (typeof ACTIONS_AUDIT)[keyof typeof ACTIONS_AUDIT];

export const MODULES_AUDIT = {
  AUTHENTIFICATION: "Authentification",
  SYSTEME: "Systeme",
  REFERENTIEL: "Referentiel",
  NOMENCLATURE: "Nomenclature",
  STOCK: "Stocks",
  PRODUCTION: "Production",
  QUALITE: "Qualite",
  ACHAT: "Achats",
  VENTE: "Ventes",
  FINANCE: "Finance",
  COMPTABILITE: "Comptabilite",
  RH: "Ressources humaines",
  IMPORT: "Import",
} as const;

export type ModuleAudit = (typeof MODULES_AUDIT)[keyof typeof MODULES_AUDIT];

export interface EntreeAudit {
  action: ActionAudit | string;
  module: ModuleAudit | string;
  entity: string;
  entityId?: string | number | bigint | null;
  userId?: number | null;
  userEmail?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  comment?: string | null;
  reason?: string | null;
}

/**
 * Convertit une valeur quelconque en structure JSON serialisable
 * sans perdre la precision des decimaux.
 */
export function serialiserPourAudit(valeur: unknown, profondeur = 0): unknown {
  if (valeur === null || valeur === undefined) return null;
  if (profondeur > 8) return "[profondeur maximale atteinte]";

  if (valeur instanceof Prisma.Decimal) return valeur.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  if (valeur instanceof Date) return valeur.toISOString();
  if (typeof valeur === "bigint") return valeur.toString();
  if (typeof valeur === "string" || typeof valeur === "number" || typeof valeur === "boolean") {
    return valeur;
  }
  if (Array.isArray(valeur)) {
    return valeur.map((element) => serialiserPourAudit(element, profondeur + 1));
  }
  if (typeof valeur === "object") {
    const resultat: Record<string, unknown> = {};
    for (const [cle, val] of Object.entries(valeur as Record<string, unknown>)) {
      resultat[cle] = serialiserPourAudit(val, profondeur + 1);
    }
    return resultat;
  }
  return String(valeur);
}

function versJson(valeur: unknown): Prisma.InputJsonValue | undefined {
  if (valeur === undefined || valeur === null) return undefined;
  const serialise = serialiserPourAudit(valeur);
  if (serialise === null || serialise === undefined) return undefined;
  return serialise as Prisma.InputJsonValue;
}

/**
 * Ecrit une entree d'audit. Accepte un client transactionnel pour que la trace
 * soit validee en meme temps que l'operation metier qu'elle decrit.
 */
export async function enregistrerAudit(
  entree: EntreeAudit,
  db: Db = prisma,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: entree.action,
        module: entree.module,
        entity: entree.entity,
        entityId: entree.entityId === null || entree.entityId === undefined
          ? null
          : String(entree.entityId),
        userId: entree.userId ?? null,
        userEmail: entree.userEmail ?? null,
        oldValue: versJson(entree.oldValue),
        newValue: versJson(entree.newValue),
        ip: entree.ip ?? null,
        userAgent: entree.userAgent ?? null,
        comment: entree.comment ?? null,
        reason: entree.reason ?? null,
      },
    });
  } catch (erreur) {
    // Le journal d'audit ne doit jamais faire echouer une operation metier
    // deja validee, mais l'incident doit rester visible dans les journaux.
    console.error("[audit] Echec de l'enregistrement du journal d'audit :", erreur);
  }
}

export interface FiltresAudit {
  userId?: number;
  module?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  du?: Date;
  au?: Date;
  recherche?: string;
  page?: number;
  taille?: number;
}

export async function consulterJournalAudit(filtres: FiltresAudit) {
  const page = Math.max(1, filtres.page ?? 1);
  const taille = Math.min(200, Math.max(10, filtres.taille ?? 50));

  const where: Prisma.AuditLogWhereInput = {};
  if (filtres.userId) where.userId = filtres.userId;
  if (filtres.module) where.module = filtres.module;
  if (filtres.action) where.action = filtres.action;
  if (filtres.entity) where.entity = filtres.entity;
  if (filtres.entityId) where.entityId = filtres.entityId;
  if (filtres.du || filtres.au) {
    where.createdAt = {};
    if (filtres.du) where.createdAt.gte = filtres.du;
    if (filtres.au) where.createdAt.lte = filtres.au;
  }
  if (filtres.recherche) {
    where.OR = [
      { userEmail: { contains: filtres.recherche, mode: "insensitive" } },
      { entity: { contains: filtres.recherche, mode: "insensitive" } },
      { comment: { contains: filtres.recherche, mode: "insensitive" } },
    ];
  }

  const [total, lignes] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * taille,
      take: taille,
      include: { user: { select: { id: true, email: true } } },
    }),
  ]);

  return {
    lignes,
    total,
    page,
    taille,
    pages: Math.max(1, Math.ceil(total / taille)),
  };
}
