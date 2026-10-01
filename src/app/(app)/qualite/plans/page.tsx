import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actionAjouterPointDeControle, actionCreerPlanControle } from "@/actions/qualite";
import { aLaPermission, exigerAuMoinsUnePermission, libelleUsine } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fabricantLien,
  lireParametresListe,
  modeInsensible,
  pagination,
} from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  ListeDefinitions,
  Pagination,
  Section,
  Statistique,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatQuantite } from "@/lib/format";

export const metadata = { title: "Plans de controle" };

/**
 * Plans de controle qualite et leurs points de controle.
 *
 * Un plan decrit ce qu'il faut verifier sur un article ou sur une operation :
 * chaque point porte son type de controle, la caracteristique mesuree, sa
 * valeur cible, ses tolerances et son caractere obligatoire.
 *
 * Le modele d'enregistrement ne stocke aucune periodicite : cet ecran n'affiche
 * donc pas de frequence inventee. Chaque controle realise est enregistre a
 * l'unite, avec sa date, son controleur et sa decision.
 */

const PORTEES = [
  { valeur: "ARTICLE", libelle: "Plans rattaches a un article" },
  { valeur: "OPERATION", libelle: "Plans rattaches a une operation" },
] as const;

const OUI_NON = [
  { valeur: "true", libelle: "Oui" },
  { valeur: "false", libelle: "Non" },
] as const;

export default async function PagePlansControle({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerAuMoinsUnePermission([
    PERMISSIONS.QUALITE_LIRE,
    PERMISSIONS.QUALITE_PLAN_GERER,
  ]);
  const peutGerer = aLaPermission(utilisateur, PERMISSIONS.QUALITE_PLAN_GERER);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts, ["portee", "actif"]);
  const recherche = parametres.recherche;

  const where: Prisma.QualityPlanWhereInput = {};
  if (recherche !== null) {
    where.OR = [
      { code: modeInsensible(recherche) },
      { label: modeInsensible(recherche) },
      { description: modeInsensible(recherche) },
    ];
  }
  if (parametres.filtres.portee === "ARTICLE") where.itemId = { not: null };
  if (parametres.filtres.portee === "OPERATION") where.operationId = { not: null };
  if (parametres.filtres.actif === "true") where.isActive = true;
  if (parametres.filtres.actif === "false") where.isActive = false;

  const [total, nbActifs, nbObligatoires, nbPoints, articles, operations, unites] =
    await Promise.all([
      prisma.qualityPlan.count({ where }),
      prisma.qualityPlan.count({ where: { isActive: true } }),
      prisma.qualityPlan.count({ where: { isActive: true, isMandatoryForRelease: true } }),
      prisma.qualityCheckpoint.count(),
      peutGerer
        ? prisma.item.findMany({
            where: { status: "ACTIF" },
            orderBy: { code: "asc" },
            take: 300,
            select: { id: true, code: true, label1: true, unitCode: true },
          })
        : Promise.resolve([]),
      peutGerer
        ? prisma.operation.findMany({
            where: { isActive: true },
            orderBy: { code: "asc" },
            take: 200,
            select: { id: true, code: true, label: true, requiresQualityCheck: true },
          })
        : Promise.resolve([]),
      peutGerer
        ? prisma.unitOfMeasure.findMany({
            where: { isActive: true },
            orderBy: { code: "asc" },
            take: 100,
            select: { code: true, label: true },
          })
        : Promise.resolve([]),
    ]);

  const bornes = pagination(total, parametres.page, parametres.taille);
  const plans = await prisma.qualityPlan.findMany({
    where,
    orderBy: { code: "asc" },
    skip: bornes.skip,
    take: bornes.take,
    include: {
      item: { select: { code: true, label1: true } },
      operation: { select: { code: true, label: true } },
      _count: { select: { checkpoints: true, checks: true } },
      checkpoints: {
        orderBy: [{ sequence: "asc" }, { id: "asc" }],
        include: { unit: { select: { code: true, label: true } } },
      },
    },
  });

  const filtresCourants = {
    q: recherche,
    portee: parametres.filtres.portee,
    actif: parametres.filtres.actif,
  };

  return (
    <>
      <EnTetePage
        titre="Plans de controle"
        description="Ce qu'il faut verifier sur un article ou une operation : caracteristique mesuree, valeur cible, tolerances et points obligatoires."
        actions={
          <span className="flex flex-wrap items-center gap-3">
            <Link className="lien-nav text-sm" href="/qualite">
              Controles qualite
            </Link>
            <Link className="lien-nav text-sm" href="/qualite/controles/nouveau">
              Saisir un controle
            </Link>
          </span>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique libelle="Plans de controle" valeur={total} detail="Correspondant aux criteres" />
        <Statistique
          libelle="Plans actifs"
          valeur={nbActifs}
          detail="Appliques aux controles en cours"
          ton="succes"
        />
        <Statistique
          libelle="Obligatoires avant liberation"
          valeur={nbObligatoires}
          detail="Plans actifs qui bloquent la mise a disposition"
          ton={nbObligatoires > 0 ? "alerte" : "succes"}
        />
        <Statistique
          libelle="Points de controle"
          valeur={nbPoints}
          detail="Tous plans confondus"
        />
      </div>

      <div className="mb-5">
        <Carte
          titre="Filtres"
          description="Recherche sur le code, le libelle ou la description du plan."
        >
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Champ
              nom="q"
              libelle="Recherche"
              type="search"
              valeur={recherche}
              aide="Code, libelle ou description du plan."
            />
            <Champ
              nom="portee"
              libelle="Portee"
              type="select"
              valeur={parametres.filtres.portee}
              options={PORTEES.map((portee) => ({
                valeur: portee.valeur,
                libelle: portee.libelle,
              }))}
            />
            <Champ
              nom="actif"
              libelle="Plan actif"
              type="select"
              valeur={parametres.filtres.actif}
              options={[
                { valeur: "true", libelle: "Actifs uniquement" },
                { valeur: "false", libelle: "Inactifs uniquement" },
              ]}
            />
            <div className="flex items-end gap-3">
              <button
                type="submit"
                className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
              >
                Filtrer
              </button>
              <Link className="lien-nav text-sm" href="/qualite/plans">
                Reinitialiser
              </Link>
            </div>
          </form>
        </Carte>
      </div>

      <div className="mb-5">
        <Alerte ton="info" titre="Ce que porte un plan de controle">
          Un plan vise un article ou une operation et decrit les points a verifier. La periodicite
          n&apos;est pas un champ du modele : chaque controle est enregistre a l&apos;unite, avec sa
          date et son controleur, ce qui evite d&apos;inventer une frequence que le systeme ne
          stocke pas.
        </Alerte>
      </div>

      {!peutGerer && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Consultation seule">
            La creation d&apos;un plan et l&apos;ajout d&apos;un point exigent la permission
            « gestion des plans de controle ». Elle est revalidee par le serveur a chaque envoi.
          </Alerte>
        </div>
      )}

      {peutGerer && (
        <Section titre="Creer un plan de controle">
          <Carte
            titre="Nouveau plan"
            description="Le plan doit viser soit un article, soit une operation : sans cible, il ne pourrait jamais s'appliquer a un controle reel."
          >
            <FormulaireAction
              action={actionCreerPlanControle}
              libelleSoumettre="Creer le plan"
              varianteSoumettre="primaire"
              reinitialiser
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Champ
                  nom="code"
                  libelle="Code du plan"
                  requis
                  maxLength={40}
                  aide="Identifiant unique, par exemple PC-REC-AC-001."
                />
                <Champ
                  nom="label"
                  libelle="Libelle du plan"
                  requis
                  maxLength={200}
                />
                <Champ
                  nom="itemId"
                  libelle="Article concerne"
                  type="select"
                  options={articles.map((article) => ({
                    valeur: article.id,
                    libelle: `${article.code} — ${article.label1}`,
                  }))}
                  aide="Un plan sur article s'applique aux controles de cet article."
                />
                <Champ
                  nom="operationId"
                  libelle="Operation concernee"
                  type="select"
                  options={operations.map((operation) => ({
                    valeur: operation.id,
                    libelle: `${operation.code} — ${operation.label}${
                      operation.requiresQualityCheck ? " (controle declare)" : ""
                    }`,
                  }))}
                  aide="Un plan sur operation s'applique aux controles de production de cette operation."
                />
                <Champ
                  nom="isMandatoryForRelease"
                  libelle="Obligatoire avant liberation"
                  type="select"
                  valeur="false"
                  options={OUI_NON.map((choix) => ({
                    valeur: choix.valeur,
                    libelle: choix.libelle,
                  }))}
                  aide="Lorsque le plan est obligatoire, le produit ne peut pas etre libere sans controle."
                />
              </div>
              <div className="mt-4">
                <Champ
                  nom="description"
                  libelle="Description du plan"
                  type="textarea"
                  maxLength={1000}
                  aide="Facultative. Precisez le cadre du controle, sans y mettre de tolerance : celles-ci appartiennent aux points."
                />
              </div>
            </FormulaireAction>
          </Carte>
        </Section>
      )}

      {plans.length === 0 && (
        <div className="mb-5">
          <Alerte ton="info" titre="Aucun plan de controle">
            Aucun plan ne correspond aux criteres. Les controles restent possibles sans plan, mais
            ils n&apos;enregistrent alors aucune caracteristique attendue.
          </Alerte>
        </div>
      )}

      {plans.map((plan) => (
        <Section key={plan.id} titre={`${plan.code} — ${plan.label}`}>
          <Carte
            titre="Identification"
            description={plan.description ?? undefined}
          >
            <ListeDefinitions
              elements={[
                { terme: "Code", valeur: plan.code },
                { terme: "Libelle", valeur: plan.label },
                {
                  terme: "Article concerne",
                  valeur: plan.item
                    ? `${plan.item.code} — ${plan.item.label1}`
                    : "Aucun article : le plan vise une operation",
                },
                {
                  terme: "Operation concernee",
                  valeur: plan.operation
                    ? `${plan.operation.code} — ${plan.operation.label}`
                    : "Aucune operation : le plan vise un article",
                },
                { terme: "Division", valeur: libelleUsine(plan.factory) },
                {
                  terme: "Actif",
                  valeur: (
                    <Etiquette ton={plan.isActive ? "succes" : "info"}>
                      {plan.isActive ? "Oui" : "Non"}
                    </Etiquette>
                  ),
                },
                {
                  terme: "Obligatoire avant liberation",
                  valeur: (
                    <Etiquette ton={plan.isMandatoryForRelease ? "alerte" : "info"}>
                      {plan.isMandatoryForRelease ? "Oui" : "Non"}
                    </Etiquette>
                  ),
                },
                { terme: "Points de controle", valeur: plan._count.checkpoints },
                { terme: "Controles enregistres", valeur: plan._count.checks },
              ]}
            />
          </Carte>

          <Carte
            titre="Points de controle"
            description={`${plan.checkpoints.length} point(s), dans l'ordre d'execution.`}
            sansPadding
          >
            <Tableau
              colonnes={[
                { cle: "ordre", libelle: "Ordre", nombre: true },
                { cle: "code", libelle: "Code" },
                { cle: "label", libelle: "Point de controle" },
                { cle: "type", libelle: "Type de controle" },
                { cle: "cible", libelle: "Valeur cible" },
                { cle: "unite", libelle: "Unite" },
                { cle: "min", libelle: "Tolerance min", nombre: true },
                { cle: "max", libelle: "Tolerance max", nombre: true },
                { cle: "obligatoire", libelle: "Obligatoire" },
                { cle: "instructions", libelle: "Instructions" },
              ]}
              lignes={plan.checkpoints.map((point) => ({
                cle: String(point.id),
                cellules: [
                  String(point.sequence),
                  point.code,
                  point.label,
                  point.checkType,
                  point.expectedValue ?? "-",
                  point.unit?.label ?? point.unitCode ?? "-",
                  point.toleranceMin === null ? "-" : formatQuantite(point.toleranceMin),
                  point.toleranceMax === null ? "-" : formatQuantite(point.toleranceMax),
                  <Etiquette key="obligatoire" ton={point.isMandatory ? "alerte" : "info"}>
                    {point.isMandatory ? "Oui" : "Non"}
                  </Etiquette>,
                  point.instructions ?? "-",
                ],
              }))}
              messageVide="Aucun point de controle : ce plan ne decrit encore rien de verifiable."
            />
          </Carte>

          {peutGerer && (
            <Carte>
              <details>
                <summary className="cursor-pointer text-sm font-semibold">
                  Ajouter un point de controle
                </summary>
                <div className="mt-4">
                  <FormulaireAction
                    action={actionAjouterPointDeControle}
                    libelleSoumettre="Ajouter le point"
                    varianteSoumettre="secondaire"
                    reinitialiser
                  >
                    <input type="hidden" name="planId" value={plan.id} />
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Champ
                        nom="code"
                        libelle="Code du point"
                        requis
                        maxLength={40}
                        aide="Unique dans le plan, par exemple DIM-LONGUEUR."
                      />
                      <Champ
                        nom="label"
                        libelle="Point de controle"
                        requis
                        maxLength={200}
                      />
                      <Champ
                        nom="checkType"
                        libelle="Type de controle"
                        requis
                        maxLength={60}
                        aide="Par exemple : mesure, visuel, documentaire, essai."
                      />
                      <Champ
                        nom="sequence"
                        libelle="Ordre d'execution"
                        type="number"
                        min={1}
                        pas="1"
                        aide="Laissez vide pour placer le point a la suite."
                      />
                      <Champ
                        nom="expectedValue"
                        libelle="Valeur cible"
                        maxLength={120}
                        aide="Valeur ou plage attendue, telle qu'elle doit etre verifiee."
                      />
                      <Champ
                        nom="unitCode"
                        libelle="Unite de mesure"
                        type="select"
                        options={unites.map((unite) => ({
                          valeur: unite.code,
                          libelle: `${unite.code} — ${unite.label}`,
                        }))}
                      />
                      <Champ
                        nom="toleranceMin"
                        libelle="Tolerance minimale"
                        type="number"
                        pas="0.000001"
                        aide="Facultative : laissee vide, aucune borne basse n'est appliquee."
                      />
                      <Champ
                        nom="toleranceMax"
                        libelle="Tolerance maximale"
                        type="number"
                        pas="0.000001"
                        aide="Facultative : laissee vide, aucune borne haute n'est appliquee."
                      />
                      <Champ
                        nom="isMandatory"
                        libelle="Point obligatoire"
                        type="select"
                        valeur="true"
                        options={OUI_NON.map((choix) => ({
                          valeur: choix.valeur,
                          libelle: choix.libelle,
                        }))}
                        aide="Un point obligatoire doit etre renseigne lors du controle."
                      />
                    </div>
                    <div className="mt-4">
                      <Champ
                        nom="instructions"
                        libelle="Instructions de realisation"
                        type="textarea"
                        maxLength={1000}
                        aide="Facultatives : moyen de mesure, conditions, precautions."
                      />
                    </div>
                  </FormulaireAction>
                </div>
              </details>
            </Carte>
          )}
        </Section>
      ))}

      {total > 0 && (
        <Carte sansPadding>
          <Pagination
            page={Math.min(parametres.page, bornes.pages)}
            pages={bornes.pages}
            total={total}
            construireLien={fabricantLien("/qualite/plans", filtresCourants)}
          />
        </Carte>
      )}

      <p className="mt-3 text-xs" style={{ color: "var(--texte-doux)" }}>
        <Etiquette ton="info">Rappel</Etiquette> Les points de controle ne sont jamais supprimes
        lorsqu&apos;un controle les a utilises : un plan se desactive pour ne plus s&apos;appliquer,
        ce qui preserve l&apos;historique des controles deja enregistres.
      </p>
    </>
  );
}
