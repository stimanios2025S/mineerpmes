/**
 * Audit en lecture seule avant mise en service.
 * Compatibilite : demo:purge ne supprime plus rien.
 * L'ancien outil pouvait supprimer tous les ordres et de futurs vrais comptes.
 * --executer est refuse AVANT toute connexion a la base.
 */
import { PrismaClient } from "@prisma/client";

async function principal() {
  if (process.argv.includes("--executer")) {
    throw new Error("Suppression desactivee : audit en lecture seule. Aucune donnee n'a ete modifiee.");
  }
  const prisma = new PrismaClient();
  try {
    const [comptesActifs, employesActifs, ordres, affectations, articles, tiers, lots,
      correspondancesNonConfirmees, ecartsOuverts, fichesTechniquesActives] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.employee.count({ where: { isActive: true } }),
      prisma.workOrder.count(),
      prisma.assignment.count({ where: { status: { not: "ANNULEE" } } }),
      prisma.item.count(),
      prisma.thirdParty.count(),
      prisma.stockLot.count(),
      prisma.importValueMapping.count({ where: { isConfirmed: false } }),
      prisma.formulaVariance.count({ where: { status: "OUVERT" } }),
      prisma.employee.count({ where: {
        isActive: true,
        OR: [
          { lastName: { startsWith: "TEST-" } },
          { jobTitle: "Compte d'acces direct (developpement)" },
        ],
      } }),
    ]);
    console.log("Audit de mise en service - LECTURE SEULE (aucune suppression)");
    console.log(JSON.stringify({ comptesActifs, employesActifs, ordres, affectations,
      articles, tiers, lots, correspondancesNonConfirmees, ecartsOuverts,
      fichesTechniquesActives }, null, 2));
    if (employesActifs === 0) {
      console.log("A traiter : fournir les vrais employes avant utilisation des portails d'atelier.");
    }
    if (correspondancesNonConfirmees || ecartsOuverts) {
      console.log("A traiter : valider les correspondances et arbitrer les ecarts dans l'application.");
    }
    console.log("Cet audit ne certifie pas les identites, la configuration metier ou le deploiement.");
  } finally {
    await prisma.$disconnect();
  }
}
principal().catch((erreur: unknown) => {
  console.error(erreur instanceof Error ? erreur.message : String(erreur));
  process.exitCode = 1;
});
