import { randomBytes } from "node:crypto";
import {
  Prisma,
  type AssignmentStatus,
  type Factory,
  type Priority,
  type ScanResult,
} from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { D } from "@/lib/decimal";
import { accesRefuse, conflit, nonTrouve, validation } from "@/lib/errors";
import { enregistrerAudit, ACTIONS_AUDIT, MODULES_AUDIT } from "@/lib/audit";
import { jourCivilMetier, jourMetier } from "@/lib/mes/jour";
import {
  branchesEnAttente,
  sousStockDeSortie,
  type BrancheEnAttente,
} from "@/lib/mes/sous-stocks";

/**
 * QR permanent d'un poste de travail et programme de l'operateur.
 *
 * CE QUE LE QR CONTIENT
 * ---------------------
 * Un jeton opaque, et rien d'autre. Aucun secret de connexion, aucun mot de
 * passe, aucune donnee personnelle, aucune tache figee. Le QR identifie le
 * POSTE. Il ne donne aucun droit : scanner un QR ne remplace jamais
 * l'authentification, et ne remplace jamais la verification que l'employe
 * connecte est bien affecte a ce poste.
 *
 * Ce qui est affiche apres un scan est recalcule a chaque fois depuis les
 * affectations reelles du jour, dans le fuseau metier (`Africa/Algiers`).
 */

/** Rang lisible d'une priorite : l'ordre affiche est celui du responsable. */
export const RANG_PRIORITE: Record<Priority, number> = {
  BASSE: 0,
  NORMALE: 1,
  HAUTE: 2,
  URGENTE: 3,
};

export const LIBELLE_PRIORITE: Record<Priority, string> = {
  BASSE: "Basse",
  NORMALE: "Normale",
  HAUTE: "Haute",
  URGENTE: "Urgente",
};

// ---------------------------------------------------------------------------
// Cycle de vie du jeton
// ---------------------------------------------------------------------------

function nouveauJeton(): string {
  // 24 octets aleatoires, encodes en base64url : non devinable, sans
  // signification, et assez court pour tenir dans une URL imprimee.
  return `PST-${randomBytes(24).toString("base64url")}`;
}

export interface ActeurPoste {
  userId: number;
  email: string;
}

/**
 * Genere — ou remplace — le QR d'un poste.
 *
 * Regenerer incremente `qrVersion` et invalide instantanement l'ancien QR :
 * c'est le geste a faire si une etiquette disparait ou circule anormalement.
 */
export async function genererQrPoste(
  entree: { workCenterId: number; acteur: ActeurPoste; comment?: string | null },
  db: Db = prisma,
) {
  const poste = await db.workCenter.findUnique({
    where: { id: entree.workCenterId },
    select: {
      id: true,
      code: true,
      label: true,
      isActive: true,
      qrVersion: true,
      qrToken: true,
    },
  });
  if (!poste) throw nonTrouve("Le poste de travail");
  if (!poste.isActive) {
    throw conflit(
      `Le poste « ${poste.code} » est desactive : reactivez-le avant de generer son QR.`,
    );
  }

  const jeton = nouveauJeton();
  const remplacement = poste.qrToken !== null;

  const misAJour = await db.workCenter.update({
    where: { id: entree.workCenterId },
    data: {
      qrToken: jeton,
      qrVersion: poste.qrVersion + 1,
      qrGeneratedAt: new Date(),
      qrRevokedAt: null,
    },
  });

  await enregistrerAudit(
    {
      action: remplacement ? ACTIONS_AUDIT.MODIFICATION : ACTIONS_AUDIT.CREATION,
      module: MODULES_AUDIT.PRODUCTION,
      entity: "WorkCenter",
      entityId: poste.id,
      userId: entree.acteur.userId,
      userEmail: entree.acteur.email,
      oldValue: { qrVersion: poste.qrVersion, avaitJeton: poste.qrToken !== null },
      newValue: { qrVersion: misAJour.qrVersion },
      comment:
        entree.comment ??
        (remplacement
          ? "Remplacement du QR du poste : l'ancienne etiquette ne fonctionne plus."
          : "Generation du QR du poste."),
    },
    db,
  );

  return misAJour;
}

/** Revoque le QR d'un poste : le jeton est efface, l'ancienne etiquette meurt. */
export async function revoquerQrPoste(
  entree: { workCenterId: number; acteur: ActeurPoste; motif: string },
  db: Db = prisma,
) {
  if (!entree.motif?.trim()) {
    throw validation("Le motif de revocation est obligatoire.");
  }

  const poste = await db.workCenter.findUnique({
    where: { id: entree.workCenterId },
    select: { id: true, code: true, qrVersion: true, qrToken: true },
  });
  if (!poste) throw nonTrouve("Le poste de travail");

  const misAJour = await db.workCenter.update({
    where: { id: poste.id },
    data: { qrToken: null, qrRevokedAt: new Date() },
  });

  await enregistrerAudit(
    {
      action: ACTIONS_AUDIT.ANNULATION,
      module: MODULES_AUDIT.PRODUCTION,
      entity: "WorkCenter",
      entityId: poste.id,
      userId: entree.acteur.userId,
      userEmail: entree.acteur.email,
      oldValue: { qrVersion: poste.qrVersion, avaitJeton: poste.qrToken !== null },
      newValue: { qrVersion: poste.qrVersion },
      reason: entree.motif,
      comment: `QR du poste « ${poste.code} » revoque.`,
    },
    db,
  );

  return misAJour;
}

/** Marque l'etiquette comme imprimee (impression initiale ou reimpression). */
export async function marquerQrImprime(
  workCenterId: number,
  db: Db = prisma,
) {
  return db.workCenter.update({
    where: { id: workCenterId },
    data: { qrLastPrintedAt: new Date() },
  });
}

/** Poste resolu depuis un jeton de QR. Retourne null si le jeton est inconnu. */
export async function resoudrePosteParToken(token: string, db: Db = prisma) {
  const jeton = token.trim();
  if (!jeton) return null;

  const poste = await db.workCenter.findUnique({
    where: { qrToken: jeton },
    include: {
      workshop: { select: { id: true, code: true, label: true } },
      operation: { select: { id: true, code: true, label: true } },
      subStocks: {
        where: { isActive: true },
        select: { id: true, code: true, label: true, kind: true },
      },
    },
  });

  if (!poste) return null;
  if (poste.qrRevokedAt) return null;
  if (!poste.isActive) return null;

  return poste;
}

/** Poste resolu depuis son code lisible : la saisie manuelle suit le meme chemin. */
export async function resoudrePosteParCode(code: string, db: Db = prisma) {
  return db.workCenter.findUnique({ where: { code: code.trim() } });
}

// ---------------------------------------------------------------------------
// Programme de l'operateur
// ---------------------------------------------------------------------------

export interface TacheProgrammee {
  assignmentId: number;
  workOrderOperationId: number | null;
  poste: string | null;
  sequenceOrder: number;
  priority: Priority;
  libellePriorite: string;
  rangPriorite: number;
  statut: AssignmentStatus;

  operationId: number;
  operationCode: string;
  operationLabel: string;

  workOrderId: number | null;
  workOrderNumber: string | null;
  produit: string | null;
  stepNo: number | null;

  quantitePrevue: Prisma.Decimal;
  quantiteDejaConforme: Prisma.Decimal;
  quantiteRestante: Prisma.Decimal;

  lotId: number | null;
  lotCode: string | null;

  plannedStart: Date | null;
  plannedEnd: Date | null;
  dureePrevueMinutes: number | null;

  posteDeControleQualite: boolean;
  instructions: string | null;

  sousStockId: number | null;
  sousStockCode: string | null;
  disponibleDansSousStock: Prisma.Decimal | null;
  unite: string | null;

  /** Ce qui manque cote matiere : quantite a sortir qui n'est pas encore sortie. */
  matieresManquantes: {
    articleId: number;
    article: string;
    quantiteRequise: Prisma.Decimal;
    quantiteSortie: Prisma.Decimal;
    manque: Prisma.Decimal;
    unite: string | null;
  }[];

  /** Branches amont obligatoires qui n'ont pas encore livre. */
  branchesManquantes: BrancheEnAttente[];

  /** Tout ce qui, aujourd'hui, empeche de demarrer proprement cette tache. */
  blocages: string[];

  /**
   * Reaffectations subies par cette tache. L'operateur doit pouvoir voir que
   * son poste, sa priorite ou son ordre ont change en cours de journee, et
   * pourquoi.
   */
  changements: {
    changeType: string;
    reason: string | null;
    changedAt: Date;
    previousWorkCenterId: number | null;
    newWorkCenterId: number | null;
  }[];
}

const INCLUSION_TACHE = {
  operation: { select: { id: true, code: true, label: true } },
  workCenter: { select: { id: true, code: true, label: true } },
  workOrder: {
    select: {
      id: true,
      number: true,
      itemId: true,
      item: { select: { code: true, label1: true, unitCode: true } },
    },
  },
  workOrderOperation: {
    select: {
      id: true,
      stepNo: true,
      quantityPlanned: true,
      quantityConform: true,
      operationId: true,
      qualityStatus: true,
    },
  },
  plannedLot: { select: { id: true, lotNumber: true } },
  changes: {
    select: {
      changeType: true,
      reason: true,
      changedAt: true,
      previousWorkCenterId: true,
      newWorkCenterId: true,
    },
    orderBy: { changedAt: "asc" as const },
  },
} satisfies Prisma.AssignmentInclude;

type AffectationComplete = Prisma.AssignmentGetPayload<{
  include: typeof INCLUSION_TACHE;
}>;

/**
 * Construit le detail affichable d'une affectation : quantites, sous-stock de
 * l'etape, matieres a sortir et ce qui bloque le demarrage.
 */
async function construireTache(
  db: Db,
  affectation: AffectationComplete,
): Promise<TacheProgrammee> {
  const blocages: string[] = [];

  const quantitePrevue = D.of(affectation.plannedQuantity);
  const quantiteConforme = D.of(
    affectation.workOrderOperation?.quantityConform ?? 0,
  );
  const quantiteRestante = D.max(D.sub(quantitePrevue, quantiteConforme), D.of(0));

  // 1. Matieres : ce qui est planifie pour cette operation de l'OF et ce qui a
  //    deja ete sorti du depot. Un manque est un blocage, pas une information.
  const matieres = affectation.workOrderOperationId
    ? await db.workOrderMaterial.findMany({
        where: { workOrderOperationId: affectation.workOrderOperationId },
        include: {
          componentItem: { select: { id: true, code: true, label1: true, unitCode: true } },
        },
        orderBy: { lineNo: "asc" },
      })
    : [];

  const matieresManquantes = matieres
    .map((matiere) => {
      const requise = D.of(matiere.quantityPlanned);
      const sortie = D.of(matiere.quantityIssued);
      const manque = D.max(D.sub(requise, sortie), D.of(0));
      return {
        articleId: matiere.componentItem.id,
        article: `${matiere.componentItem.code} — ${matiere.componentItem.label1}`,
        quantiteRequise: requise,
        quantiteSortie: sortie,
        manque,
        unite: matiere.unitCode ?? matiere.componentItem.unitCode ?? null,
      };
    })
    .filter((ligne) => D.gt(ligne.manque, 0));

  if (matieresManquantes.length > 0) {
    blocages.push(
      `Matieres non sorties : ${matieresManquantes
        .map((ligne) => `${ligne.article} (${D.toFixed(ligne.manque, 3)})`)
        .join(", ")}.`,
    );
  }

  // 2. Sous-stock de l'etape : ce qui est deja disponible a ce poste.
  const sousStock = await sousStockDeSortie(
    db,
    affectation.operationId,
    affectation.factory,
  );

  let disponible: Prisma.Decimal | null = null;
  let branches: BrancheEnAttente[] = [];

  if (sousStock) {
    if (affectation.workOrder) {
      const soldes = await db.stockBalance.findMany({
        where: {
          locationId: sousStock.locationId,
          itemId: affectation.workOrder.itemId,
        },
      });
      disponible = D.sum(soldes.map((solde) => solde.quantityPhysical));

      branches = await branchesEnAttente(db, {
        toSubStockId: sousStock.id,
        itemId: affectation.workOrder.itemId,
        lotId: affectation.plannedLotId,
        quantiteRequise: quantiteRestante,
      });

      const requises = branches.filter((branche) => branche.isRequired);
      if (requises.length > 0) {
        blocages.push(
          `Etapes amont incompletes : ${requises
            .map(
              (branche) =>
                `${branche.fromLabel} (manque ${D.toFixed(branche.manque, 3)})`,
            )
            .join(", ")}.`,
        );
      }
    }
  } else {
    blocages.push(
      "Aucun sous-stock de sortie n'est declare pour cette operation : le passage a l'etape suivante ne pourra pas etre enregistre.",
    );
  }

  // 3. Instructions et porte qualite de l'etape de gamme.
  let instructions: string | null = null;
  let posteDeControleQualite = false;
  if (affectation.workOrderOperationId) {
    const etape = await db.routeStep.findFirst({
      where: {
        operationId: affectation.operationId,
        route: { workOrders: { some: { id: affectation.workOrderId ?? -1 } } },
      },
      select: { instructions: true, isQualityGate: true },
      orderBy: { stepNo: "asc" },
    });
    instructions = etape?.instructions ?? null;
    posteDeControleQualite = etape?.isQualityGate ?? false;
  }

  if (posteDeControleQualite) {
    blocages.push(
      "Etape sous controle qualite : la quantite conforme devra etre validee avant de passer a la suite.",
    );
  }

  return {
    assignmentId: affectation.id,
    workOrderOperationId: affectation.workOrderOperationId ?? null,
    poste: affectation.workCenter
      ? `${affectation.workCenter.code} - ${affectation.workCenter.label}`
      : null,
    sequenceOrder: affectation.sequenceOrder,
    priority: affectation.priority,
    libellePriorite: LIBELLE_PRIORITE[affectation.priority],
    rangPriorite: RANG_PRIORITE[affectation.priority],
    statut: affectation.status,

    operationId: affectation.operationId,
    operationCode: affectation.operation.code,
    operationLabel: affectation.operation.label,

    workOrderId: affectation.workOrder?.id ?? null,
    workOrderNumber: affectation.workOrder?.number ?? null,
    produit: affectation.workOrder
      ? `${affectation.workOrder.item.code} — ${affectation.workOrder.item.label1}`
      : null,
    stepNo: affectation.workOrderOperation?.stepNo ?? null,

    quantitePrevue,
    quantiteDejaConforme: quantiteConforme,
    quantiteRestante,

    lotId: affectation.plannedLot?.id ?? null,
    lotCode: affectation.plannedLot?.lotNumber ?? null,

    plannedStart: affectation.plannedStart,
    plannedEnd: affectation.plannedEnd,
    dureePrevueMinutes:
      affectation.plannedStart && affectation.plannedEnd
        ? Math.max(
            0,
            Math.round(
              (affectation.plannedEnd.getTime() -
                affectation.plannedStart.getTime()) /
                60000,
            ) - affectation.breakMinutes,
          )
        : null,

    posteDeControleQualite,
    instructions,

    sousStockId: sousStock?.id ?? null,
    sousStockCode: sousStock?.code ?? null,
    disponibleDansSousStock: disponible,
    unite: affectation.workOrder?.item.unitCode ?? matieres[0]?.unitCode ?? null,

    matieresManquantes,
    branchesManquantes: branches,
    blocages,
    changements: affectation.changes.map((changement) => ({
      changeType: changement.changeType,
      reason: changement.reason,
      changedAt: changement.changedAt,
      previousWorkCenterId: changement.previousWorkCenterId,
      newWorkCenterId: changement.newWorkCenterId,
    })),
  };
}

function trierProgramme(taches: TacheProgrammee[]): TacheProgrammee[] {
  return [...taches].sort((a, b) => {
    if (a.rangPriorite !== b.rangPriorite) return b.rangPriorite - a.rangPriorite;
    if (a.sequenceOrder !== b.sequenceOrder) {
      return a.sequenceOrder - b.sequenceOrder;
    }
    const aDebut = a.plannedStart?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bDebut = b.plannedStart?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (aDebut !== bDebut) return aDebut - bDebut;
    return a.assignmentId - b.assignmentId;
  });
}

export interface FiltreProgramme {
  /** Instant de reference. La journee est calculee en Africa/Algiers. */
  at?: Date;
  workCenterId?: number;
  fabriquesAutorisees?: Factory[] | null;
  /** Inclut les taches deja terminees (utile pour la feuille de route). */
  inclureTerminees?: boolean;
}

/**
 * Programme du jour d'un employe, dans l'ordre decide par le responsable.
 * Ne renvoie jamais autre chose que les affectations de CET employe.
 */
export async function programmeEmploye(
  employeId: number,
  filtres: FiltreProgramme = {},
  db: Db = prisma,
): Promise<TacheProgrammee[]> {
  const date = jourCivilMetier(filtres.at ?? new Date());

  const affectations = await db.assignment.findMany({
    where: {
      employeeId: employeId,
      date,
      ...(filtres.workCenterId ? { workCenterId: filtres.workCenterId } : {}),
      ...(filtres.fabriquesAutorisees && filtres.fabriquesAutorisees.length > 0
        ? { factory: { in: filtres.fabriquesAutorisees } }
        : {}),
      ...(filtres.inclureTerminees
        ? { status: { not: "ANNULEE" } }
        : { status: { in: ["PLANIFIEE", "EN_COURS", "EN_PAUSE", "TERMINEE"] } }),
    },
    include: INCLUSION_TACHE,
  });

  const taches = await Promise.all(
    affectations.map((affectation) => construireTache(db, affectation)),
  );

  return trierProgramme(taches);
}

// ---------------------------------------------------------------------------
// Scan du poste
// ---------------------------------------------------------------------------

export interface ScanPosteInput {
  /** Jeton lu dans le QR, ou code du poste saisi a la main. */
  token?: string;
  codePoste?: string;
  /** Employe du compte connecte. JAMAIS une valeur envoyee par le navigateur. */
  employeId: number;
  utilisateur: ActeurPoste;
  /** Portee du role connecte. null = toutes les usines. */
  fabriquesAutorisees?: Factory[] | null;
  at?: Date;
  userAgent?: string | null;
}

export interface PosteResume {
  id: number;
  code: string;
  label: string;
  factory: Factory;
  workshopId: number | null;
  atelierLabel: string | null;
  emplacement: string | null;
}

export type ResultatScan =
  | {
      accepte: true;
      scanId: bigint;
      poste: PosteResume;
      jour: string;
      taches: TacheProgrammee[];
    }
  | {
      accepte: false;
      motif: string;
      /** Renseigne quand le poste a pu etre identifie : le refus est trace. */
      poste: PosteResume | null;
    };

async function tracerScan(
  db: Db,
  entree: {
    workCenterId: number;
    employeeId: number | null;
    userId: number | null;
    factory: Factory;
    result: ScanResult;
    reason: string | null;
    userAgent?: string | null;
  },
) {
  return db.workCenterScan.create({ data: entree });
}

/**
 * Verifie un scan de poste et renvoie le programme autorise.
 *
 * L'ordre des controles est celui du metier, et il est volontairement strict :
 *  1. le poste existe et son QR est actif ;
 *  2. le poste appartient a une usine que le compte connecte peut voir ;
 *  3. l'employe connecte est REELLEMENT affecte a ce poste aujourd'hui ;
 *  4. seulement alors, on renvoie ses taches, dans l'ordre publie.
 *
 * Chaque refus est conserve dans `WorkCenterScan` : un scan refuse est une
 * information, pas un evenement a jeter.
 */
export async function executerScanPoste(
  entree: ScanPosteInput,
  db: Db = prisma,
): Promise<ResultatScan> {
  const at = entree.at ?? new Date();

  if (!entree.employeId) {
    throw validation(
      "Aucune fiche employe n'est rattachee a ce compte : le scan de poste est impossible.",
    );
  }

  // 1. Resolution du poste.
  let poste =
    entree.token && entree.token.trim()
      ? await resoudrePosteParToken(entree.token, db)
      : null;

  if (!poste && entree.codePoste && entree.codePoste.trim()) {
    const parCode = await resoudrePosteParCode(entree.codePoste, db);
    if (parCode) {
      poste = await resoudrePosteParToken(parCode.qrToken ?? "", db);
    }
  }

  if (!poste) {
    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.SCAN_POSTE,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "WorkCenterScan",
        entityId: null,
        userId: entree.utilisateur.userId,
        userEmail: entree.utilisateur.email,
        newValue: { resultat: "REFUSE", motif: "QR inconnu, revoque ou desactive" },
        userAgent: entree.userAgent ?? null,
        comment: "Scan de poste refuse : QR inconnu ou revoque.",
      },
      db,
    );
    return {
      accepte: false,
      motif:
        "Ce QR n'est pas (ou plus) valide. Demandez une etiquette au responsable d'atelier.",
      poste: null,
    };
  }

  const resume: PosteResume = {
    id: poste.id,
    code: poste.code,
    label: poste.label,
    factory: poste.factory,
    workshopId: poste.workshopId,
    atelierLabel: poste.workshop?.label ?? null,
    emplacement: poste.location ?? null,
  };

  const refuser = async (motif: string): Promise<ResultatScan> => {
    const scan = await tracerScan(db, {
      workCenterId: poste!.id,
      employeeId: entree.employeId,
      userId: entree.utilisateur.userId,
      factory: poste!.factory,
      result: "REFUSE",
      reason: motif,
      userAgent: entree.userAgent ?? null,
    });
    return { accepte: false, motif, poste: resume };
  };

  // 2. Portee de l'usine.
  if (
    entree.fabriquesAutorisees &&
    entree.fabriquesAutorisees.length > 0 &&
    !entree.fabriquesAutorisees.includes(poste.factory)
  ) {
    const motif =
      `Le poste « ${poste.code} » appartient a ${poste.factory} : ` +
      "votre compte n'a pas acces a cette usine.";
    const resultat = await refuser(motif);
    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.SCAN_POSTE,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "WorkCenterScan",
        entityId: null,
        userId: entree.utilisateur.userId,
        userEmail: entree.utilisateur.email,
        reason: motif,
        newValue: { poste: poste.code, resultat: "REFUSE" },
        userAgent: entree.userAgent ?? null,
      },
      db,
    );
    return resultat;
  }

  // 3. Affectation reelle a ce poste, pour la journee metier.
  const jourCivil = jourCivilMetier(at);
  const jour = jourMetier(at);

  const affectations = await db.assignment.findMany({
    where: {
      employeeId: entree.employeId,
      date: jourCivil,
      workCenterId: poste.id,
      status: { in: ["PLANIFIEE", "EN_COURS", "EN_PAUSE"] },
    },
    include: INCLUSION_TACHE,
  });

  if (affectations.length === 0) {
    const ailleurs = await db.assignment.findMany({
      where: {
        employeeId: entree.employeId,
        date: jourCivil,
        status: { in: ["PLANIFIEE", "EN_COURS", "EN_PAUSE"] },
      },
      include: {
        workCenter: { select: { code: true, label: true } },
      },
      orderBy: { sequenceOrder: "asc" },
    });

    const motif =
      ailleurs.length === 0
        ? `Aucune affectation ne vous est prevue le ${jour} : voyez votre responsable.`
        : `Vous n'etes pas affecte au poste « ${poste.code} » aujourd'hui. ` +
          `Vos postes du jour : ${ailleurs
            .map((affectation) =>
              affectation.workCenter
                ? affectation.workCenter.label
                : "poste non precise",
            )
            .join(", ")}.`;

    const resultat = await refuser(motif);
    await enregistrerAudit(
      {
        action: ACTIONS_AUDIT.SCAN_POSTE,
        module: MODULES_AUDIT.PRODUCTION,
        entity: "WorkCenterScan",
        entityId: null,
        userId: entree.utilisateur.userId,
        userEmail: entree.utilisateur.email,
        reason: motif,
        newValue: { poste: poste.code, resultat: "REFUSE" },
        userAgent: entree.userAgent ?? null,
      },
      db,
    );
    return resultat;
  }

  // 4. Scan accepte. On note le poste effectivement scanne, distinct du poste
  //    prevu : c'est la confrontation des deux que le scan verifie.
  const scan = await tracerScan(db, {
    workCenterId: poste.id,
    employeeId: entree.employeId,
    userId: entree.utilisateur.userId,
    factory: poste.factory,
    result: "ACCEPTE",
    reason: null,
    userAgent: entree.userAgent ?? null,
  });

  await db.assignment.updateMany({
    where: { id: { in: affectations.map((affectation) => affectation.id) } },
    data: { scannedWorkCenterId: poste.id, scannedAt: at },
  });

  const taches = await Promise.all(
    affectations.map((affectation) => construireTache(db, affectation)),
  );

  return {
    accepte: true,
    scanId: scan.id,
    poste: resume,
    jour,
    taches: trierProgramme(taches),
  };
}

// ---------------------------------------------------------------------------
// Hierarchie d'acces
// ---------------------------------------------------------------------------

/**
 * Verifie qu'un employe a le droit d'agir sur un poste, sans passer par un scan
 * (saisie d'une declaration par un responsable, par exemple).
 */
export async function verifierAccesPoste(
  entree: {
    employeId: number;
    workCenterId: number;
    at?: Date;
    fabriquesAutorisees?: Factory[] | null;
  },
  db: Db = prisma,
): Promise<void> {
  const poste = await db.workCenter.findUnique({
    where: { id: entree.workCenterId },
    select: { id: true, code: true, factory: true, isActive: true },
  });
  if (!poste) throw nonTrouve("Le poste de travail");

  if (
    entree.fabriquesAutorisees &&
    entree.fabriquesAutorisees.length > 0 &&
    !entree.fabriquesAutorisees.includes(poste.factory)
  ) {
    throw accesRefuse(
      `Le poste « ${poste.code} » appartient a une usine hors de votre perimetre.`,
    );
  }

  const affectation = await db.assignment.findFirst({
    where: {
      employeeId: entree.employeId,
      workCenterId: entree.workCenterId,
      date: jourCivilMetier(entree.at ?? new Date()),
      status: { in: ["PLANIFIEE", "EN_COURS", "EN_PAUSE"] },
    },
    select: { id: true },
  });

  if (!affectation) {
    throw accesRefuse(
      `Aucune affectation ne vous lie au poste « ${poste.code} » pour la journee metier.`,
    );
  }
}

/** Liste des postes, pour l'ecran d'administration des QR. */
export async function listerPostes(
  filtres: {
    factory?: Factory;
    workshopId?: number;
    actifsSeulement?: boolean;
    avecQr?: boolean;
  } = {},
  db: Db = prisma,
) {
  return db.workCenter.findMany({
    where: {
      ...(filtres.factory ? { factory: filtres.factory } : {}),
      ...(filtres.workshopId ? { workshopId: filtres.workshopId } : {}),
      ...(filtres.actifsSeulement === false ? {} : { isActive: true }),
      ...(filtres.avecQr === true ? { qrToken: { not: null } } : {}),
      ...(filtres.avecQr === false ? { qrToken: null } : {}),
    },
    include: {
      workshop: { select: { id: true, code: true, label: true } },
      _count: { select: { scans: true, plannedAssignments: true } },
    },
    orderBy: [{ factory: "asc" }, { code: "asc" }],
  });
}

/** Historique des scans d'un poste : utile pour comprendre un incident. */
export async function historiqueScans(
  workCenterId: number,
  limite = 50,
  db: Db = prisma,
) {
  return db.workCenterScan.findMany({
    where: { workCenterId },
    include: {
      employee: {
        select: { id: true, matricule: true, firstName: true, lastName: true },
      },
    },
    orderBy: { scannedAt: "desc" },
    take: Math.min(200, Math.max(1, limite)),
  });
}
