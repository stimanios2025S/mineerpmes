/**
 * Import des donnees reelles depuis le dossier source de l'ancien ERP.
 *
 * Utilisation :
 *   npm run import:csv                 -> analyse seule (aucune ecriture)
 *   npm run import:csv -- --executer   -> import reel, dans l'ordre des dependances
 *   npm run import:csv -- --executer --maj   -> autorise la mise a jour des fiches
 *                                                non modifiees dans la plateforme
 *   npm run import:csv -- --dossier=E:/Massiexporte
 *
 * L'import est re-executable : la cle stable (sourceSystem + sourceOid) empeche
 * tout doublon, et les ecarts de stock produisent des mouvements de correction
 * traces plutot que des ecrasements silencieux.
 */

import { PrismaClient } from "@prisma/client";
import {
  analyserDossierSource,
  importerArticles,
  importerFamilles,
  importerLotsEtStocks,
  importerNomenclatures,
  importerTiers,
  lireSource,
  FICHIERS_SOURCE,
  type ContexteImport,
  type ResultatImport,
} from "../src/lib/import/service";

const prisma = new PrismaClient();

interface Options {
  dossier: string;
  executer: boolean;
  miseAJour: boolean;
  email: string;
}

function lireOptions(): Options {
  const arguments_ = process.argv.slice(2);
  const dossierArg = arguments_.find((argument) => argument.startsWith("--dossier="));

  return {
    dossier:
      dossierArg?.split("=")[1] ??
      process.env.CSV_SOURCE_DIR ??
      "E:/Massiexporte",
    executer: arguments_.includes("--executer"),
    miseAJour: arguments_.includes("--maj"),
    email: process.env.IMPORT_ACTOR_EMAIL ?? "import@local",
  };
}

async function resoudreActeur(email: string): Promise<{ id: number; email: string }> {
  const utilisateur = await prisma.user.findFirst({
    where: { email, isActive: true },
    select: { id: true, email: true },
  });

  if (utilisateur) return utilisateur;

  // A defaut de compte dedie, l'import est rattache au premier administrateur
  // actif : toute ecriture d'import reste attribuee a une identite reelle.
  const administrateur = await prisma.user.findFirst({
    where: { isActive: true, roles: { some: { role: { code: "ADMIN_SYSTEME" } } } },
    select: { id: true, email: true },
  });

  if (administrateur) {
    console.log(
      `  (aucun compte « ${email} » : l'import est rattache a ${administrateur.email})`,
    );
    return administrateur;
  }

  throw new Error(
    "Aucun compte utilisateur actif pour rattacher l'import. Creez d'abord l'administrateur avec : npm run bootstrap:admin",
  );
}

function afficherResultat(resultat: ResultatImport) {
  const { compteurs } = resultat;
  console.log(
    `  lues=${compteurs.lues} inserees=${compteurs.inserees} maj=${compteurs.misesAJour} ` +
      `protegees=${compteurs.protegees} ignorees=${compteurs.ignorees} ` +
      `rejetees=${compteurs.rejetees} (${resultat.dureeMs} ms)`,
  );

  for (const message of resultat.messages) console.log(`  > ${message}`);

  if (resultat.avertissements.length > 0) {
    console.log(`  Avertissements (${resultat.avertissements.length}) :`);
    for (const avertissement of resultat.avertissements.slice(0, 15)) {
      console.log(`    - ${avertissement}`);
    }
    if (resultat.avertissements.length > 15) {
      console.log(`    ... et ${resultat.avertissements.length - 15} autre(s).`);
    }
  }
}

async function principal() {
  const options = lireOptions();

  console.log("Import des donnees sources de l'ancien ERP");
  console.log(`Dossier source : ${options.dossier}`);
  console.log(
    options.executer
      ? `Mode : IMPORT REEL${options.miseAJour ? " (mise a jour autorisee)" : " (protection des fiches modifiees)"}`
      : "Mode : ANALYSE SEULE (aucune ecriture en base)",
  );
  console.log("");

  const analyse = analyserDossierSource(options.dossier);

  console.log("Analyse du dossier source :");
  for (const fichier of analyse.fichiers) {
    const marque = fichier.present ? (fichier.nombreLignes > 0 ? "OK " : "VIDE") : "ABS";
    console.log(
      `  [${marque}] ${fichier.fichier.padEnd(26)} ${String(fichier.nombreLignes).padStart(6)} ligne(s) ` +
        `${fichier.separateur ? `sep="${fichier.separateur}"` : ""} ${fichier.encodage ?? ""}`,
    );
    if (fichier.present && fichier.colonnes && fichier.colonnes.colonnesManquantes.length > 0) {
      console.log(
        `        colonnes manquantes : ${fichier.colonnes.colonnesManquantes.join(", ")}`,
      );
    }
    if (fichier.present && fichier.nombreLignes === 0) {
      console.log(`        ${fichier.message}`);
    }
  }
  console.log("");

  if (!options.executer) {
    console.log(
      "Analyse terminee. Aucune donnee n'a ete ecrite. Relancez avec --executer pour importer.",
    );
    return;
  }

  const acteur = await resoudreActeur(options.email);
  console.log(`Import rattache au compte : ${acteur.email}\n`);

  const base: Omit<ContexteImport, "fichier" | "nomFichier"> = {
    acteur,
    miseAJourAutorisee: options.miseAJour,
    simulation: false,
  };

  // L'ordre est impose par les dependances : familles -> articles -> tiers ->
  // nomenclatures (qui referencent articles et depots) -> lots et stocks.
  const etapes: {
    titre: string;
    executer: () => Promise<ResultatImport>;
  }[] = [
    {
      titre: "Familles d'articles",
      executer: () =>
        importerFamilles({
          ...base,
          fichier: lireSource(options.dossier, FICHIERS_SOURCE.ITEM_FAMILY),
          nomFichier: FICHIERS_SOURCE.ITEM_FAMILY,
        }),
    },
    {
      titre: "Articles",
      executer: () =>
        importerArticles({
          ...base,
          fichier: lireSource(options.dossier, FICHIERS_SOURCE.ITEM),
          nomFichier: FICHIERS_SOURCE.ITEM,
        }),
    },
    {
      titre: "Tiers (clients, fournisseurs, employes)",
      executer: () =>
        importerTiers({
          ...base,
          fichier: lireSource(options.dossier, FICHIERS_SOURCE.THIRD_PARTY),
          nomFichier: FICHIERS_SOURCE.THIRD_PARTY,
        }),
    },
    {
      titre: "Nomenclatures et composants",
      executer: () =>
        importerNomenclatures(
          {
            ...base,
            fichier: lireSource(options.dossier, FICHIERS_SOURCE.FORMULA),
            nomFichier: FICHIERS_SOURCE.FORMULA,
          },
          {
            ...base,
            fichier: lireSource(options.dossier, FICHIERS_SOURCE.FORMULA_LINE),
            nomFichier: FICHIERS_SOURCE.FORMULA_LINE,
          },
        ),
    },
    {
      titre: "Lots et stocks",
      executer: () =>
        importerLotsEtStocks({
          ...base,
          fichier: lireSource(options.dossier, FICHIERS_SOURCE.BATCH),
          nomFichier: FICHIERS_SOURCE.BATCH,
        }),
    },
  ];

  const resultats: ResultatImport[] = [];

  for (const etape of etapes) {
    console.log(`--- ${etape.titre} ---`);
    try {
      const resultat = await etape.executer();
      resultats.push(resultat);
      afficherResultat(resultat);
    } catch (erreur) {
      console.error(
        `  ECHEC : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
      );
    }
    console.log("");
  }

  console.log("Synthese de l'import");
  let totalLues = 0;
  let totalInserees = 0;
  let totalMaj = 0;
  let totalProtegees = 0;
  let totalRejetees = 0;
  let totalIgnorees = 0;

  for (const resultat of resultats) {
    totalLues += resultat.compteurs.lues;
    totalInserees += resultat.compteurs.inserees;
    totalMaj += resultat.compteurs.misesAJour;
    totalProtegees += resultat.compteurs.protegees;
    totalRejetees += resultat.compteurs.rejetees;
    totalIgnorees += resultat.compteurs.ignorees;
  }

  console.log(`  Lignes lues .................... ${totalLues}`);
  console.log(`  Enregistrements crees .......... ${totalInserees}`);
  console.log(`  Enregistrements mis a jour ..... ${totalMaj}`);
  console.log(`  Fiches protegees ............... ${totalProtegees}`);
  console.log(`  Lignes vides ignorees .......... ${totalIgnorees}`);
  console.log(`  Lignes rejetees ................ ${totalRejetees}`);
  console.log(
    "\nLe detail des rejets et des protections est consultable dans Administration > Import.",
  );
  console.log(
    "Aucune donnee existante n'a ete supprimee : les fiches absentes de la source restent en base.",
  );
}

principal()
  .catch((erreur) => {
    console.error("\nEchec de l'import :");
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
