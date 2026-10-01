import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  actionCreerFamille,
  actionModifierFamille,
} from "@/actions/referentiel";
import { aLaPermission, exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  construireLien,
  fabricantLien,
  identifiantOuNull,
  lireParametresListe,
  modeInsensible,
  pagination,
  premiereValeur,
} from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  Pagination,
  Tableau,
} from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatEntier } from "@/lib/format";

export const metadata = { title: "Familles d'articles" };

export default async function PageFamilles({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.FAMILLE_LIRE);
  const peutGerer = aLaPermission(utilisateur, PERMISSIONS.FAMILLE_GERER);

  const parametresBruts = await searchParams;
  const parametres = lireParametresListe(parametresBruts);
  const modifierId = identifiantOuNull(premiereValeur(parametresBruts, "modifier"));

  const where: Prisma.ItemFamilyWhereInput = parametres.recherche
    ? {
        OR: [
          { code: modeInsensible(parametres.recherche) },
          { label: modeInsensible(parametres.recherche) },
          { label2: modeInsensible(parametres.recherche) },
        ],
      }
    : {};

  const [total, familleAModifier] = await Promise.all([
    prisma.itemFamily.count({ where }),
    peutGerer && modifierId !== null
      ? prisma.itemFamily.findUnique({ where: { id: modifierId } })
      : Promise.resolve(null),
  ]);

  const bornes = pagination(total, parametres.page, parametres.taille);
  const [familles, famillesParentes] = await Promise.all([
    prisma.itemFamily.findMany({
      where,
      orderBy: { code: "asc" },
      skip: bornes.skip,
      take: bornes.take,
      include: {
        parent: { select: { id: true, code: true, label: true } },
        _count: { select: { items: true, children: true } },
      },
    }),
    peutGerer
      ? prisma.itemFamily.findMany({
          where: { isActive: true },
          orderBy: { code: "asc" },
          take: 500,
          select: { id: true, code: true, label: true },
        })
      : Promise.resolve([]),
  ]);

  const optionsParentes = famillesParentes
    // Une famille ne peut jamais etre rattachee a elle-meme.
    .filter((famille) => famille.id !== familleAModifier?.id)
    .map((famille) => ({
      valeur: famille.id,
      libelle: `${famille.code} — ${famille.label}`,
    }));

  const filtresCourants = {
    q: parametres.recherche,
    modifier: premiereValeur(parametresBruts, "modifier"),
  };

  return (
    <>
      <EnTetePage
        titre="Familles d'articles"
        description="Classement des articles par famille et sous-famille. Le code famille sert de regroupement analytique et de rattachement comptable."
      />

      {peutGerer && (
        <div className="mb-6">
          <Carte
            titre={
              familleAModifier
                ? `Modifier la famille ${familleAModifier.code}`
                : "Nouvelle famille d'articles"
            }
            description="Toute creation ou modification est journalisee avec son auteur."
            actions={
              familleAModifier ? (
                <Link className="lien-nav text-sm" href="/referentiel/familles">
                  Annuler la modification
                </Link>
              ) : undefined
            }
          >
            <FormulaireAction
              action={familleAModifier ? actionModifierFamille : actionCreerFamille}
              libelleSoumettre={
                familleAModifier ? "Enregistrer les modifications" : "Creer la famille"
              }
              varianteSoumettre="primaire"
              reinitialiser={familleAModifier === null}
            >
              {familleAModifier && (
                <input type="hidden" name="familleId" value={familleAModifier.id} />
              )}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Champ
                  nom="code"
                  libelle="Code famille"
                  requis
                  maxLength={40}
                  valeur={familleAModifier?.code ?? ""}
                  aide="Code unique, repris par les imports et les etats analytiques."
                />
                <Champ
                  nom="libelle"
                  libelle="Libelle"
                  requis
                  maxLength={200}
                  valeur={familleAModifier?.label ?? ""}
                />
                <Champ
                  nom="libelle2"
                  libelle="Libelle secondaire"
                  maxLength={200}
                  valeur={familleAModifier?.label2 ?? ""}
                />
                <Champ
                  nom="familleParenteId"
                  libelle="Famille parente"
                  type="select"
                  valeur={familleAModifier?.parentId ?? ""}
                  options={optionsParentes}
                  aide="Laisser vide pour une famille de premier niveau."
                />
                <Champ
                  nom="compteComptable"
                  libelle="Compte comptable"
                  maxLength={30}
                  valeur={familleAModifier?.accountingCode ?? ""}
                  aide="Compte de stock rattache a la famille, utilise par la comptabilite."
                />
              </div>

              <div className="mt-4">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="actif"
                    defaultChecked={familleAModifier ? familleAModifier.isActive : true}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium">Famille active</span>
                    <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                      Une famille inactive ne peut plus etre selectionnee sur une nouvelle fiche
                      article ; elle reste affichee sur les articles qui la portent deja.
                    </span>
                  </span>
                </label>
              </div>

              <div className="mt-4">
                <Alerte ton="info" titre="Division">
                  La division n&apos;est pas portee par la famille d&apos;articles dans le schema
                  actuel : elle est determinee par l&apos;article lui-meme. Aucun champ de
                  division n&apos;est donc propose ici, afin de ne pas enregistrer une donnee
                  qui n&apos;existerait pas en base.
                </Alerte>
              </div>
            </FormulaireAction>
          </Carte>
        </div>
      )}

      <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Recherche</span>
          <input
            className="champ"
            type="search"
            name="q"
            defaultValue={parametres.recherche ?? ""}
            placeholder="Code ou libelle"
          />
        </label>
        <button
          type="submit"
          className="min-h-[42px] rounded-lg border px-4 text-sm font-semibold"
        >
          Rechercher
        </button>
        <Link className="lien-nav text-sm" href="/referentiel/familles">
          Reinitialiser
        </Link>
      </form>

      <Carte
        titre="Familles"
        description={`${total} famille(s) correspondant aux criteres.`}
        sansPadding
      >
        <Tableau
          colonnes={[
            { cle: "code", libelle: "Code" },
            { cle: "libelle", libelle: "Libelle" },
            { cle: "parente", libelle: "Famille parente" },
            { cle: "compte", libelle: "Compte comptable" },
            { cle: "articles", libelle: "Articles", nombre: true },
            { cle: "sousfamilles", libelle: "Sous-familles", nombre: true },
            { cle: "statut", libelle: "Statut" },
            { cle: "action", libelle: "Action" },
          ]}
          lignes={familles.map((famille) => ({
            cle: String(famille.id),
            cellules: [
              famille.code,
              <span key="libelle">
                {famille.label}
                {famille.label2 && (
                  <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
                    {famille.label2}
                  </span>
                )}
              </span>,
              famille.parent
                ? `${famille.parent.code} — ${famille.parent.label}`
                : "Famille de premier niveau",
              famille.accountingCode ?? "Non rattachee",
              formatEntier(famille._count.items),
              formatEntier(famille._count.children),
              <Etiquette key="statut" ton={famille.isActive ? "succes" : "neutre"}>
                {famille.isActive ? "Active" : "Inactive"}
              </Etiquette>,
              peutGerer ? (
                <Link
                  key="action"
                  className="lien-nav"
                  href={construireLien("/referentiel/familles", {
                    q: filtresCourants.q,
                    modifier: famille.id,
                  })}
                >
                  Modifier
                </Link>
              ) : (
                <span key="action" style={{ color: "var(--texte-doux)" }}>
                  Lecture seule
                </span>
              ),
            ],
          }))}
          messageVide="Aucune famille d'articles ne correspond aux criteres."
        />
        <Pagination
          page={parametres.page}
          pages={bornes.pages}
          total={total}
          construireLien={fabricantLien("/referentiel/familles", filtresCourants)}
        />
      </Carte>
    </>
  );
}
