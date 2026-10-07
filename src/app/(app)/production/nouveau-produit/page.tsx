import { prisma } from "@/lib/db";
import { exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import type { Factory } from "@prisma/client";
import { Alerte, Carte, EnTetePage, Etiquette } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { LIBELLES_USINE, libelle } from "@/lib/libelles";
import { actionCreerProduit } from "@/actions/produit";

export const metadata = { title: "Nouveau produit" };

/**
 * Creation d'un produit : le nom, la chaine de fabrication et la nomenclature,
 * en une seule operation.
 *
 * Les etapes et les matieres premieres proposees proviennent EXCLUSIVEMENT du
 * referentiel de l'usine du compte : l'administrateur ou le proprietaire
 * selectionne dans ce qui existe deja, il ne saisit pas d'etape nouvelle ici.
 *
 * Le serveur revalide tout (permissions, appartenance de l'usine, codes non
 * utilises, etapes actives) : cette page n'est qu'une aide a la saisie.
 */
export default async function PageNouveauProduit() {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_ECRIRE);

  const divisions: Factory[] = usinesAutorisees(utilisateur).filter(
    (usine): usine is "ADMEDCO" | "MOBILIX" => usine === "ADMEDCO" || usine === "MOBILIX",
  );

  if (divisions.length === 0) {
    return (
      <>
        <EnTetePage titre="Nouveau produit" />
        <Alerte ton="danger" titre="Aucune division dans votre perimetre">
          Votre compte n'est rattache a aucune usine : la creation d'un produit est
          impossible. Contactez l'administration.
        </Alerte>
      </>
    );
  }

  // Un proprietaire d'usine n'a qu'une division : elle est imposee.
  const divisionImposee = divisions.length === 1 ? divisions[0] : null;

  const [etapes, matieres, unites] = await Promise.all([
    prisma.operation.findMany({
      where: { isActive: true, factory: { in: divisions.length === 1 ? [divisions[0], "COMMUN"] : divisions } },
      orderBy: [{ sequenceOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, label: true, factory: true, workshop: { select: { label: true } } },
    }),
    prisma.item.findMany({
      where: {
        status: "ACTIF",
        factory: { in: divisions.length === 1 ? [divisions[0], "COMMUN"] : divisions },
        OR: [{ isRawMaterial: true }, { type: "MATIERE_PREMIERE" }, { type: "COMPOSANT" }],
      },
      orderBy: { code: "asc" },
      take: 1500,
      select: { id: true, code: true, label1: true, unitCode: true, factory: true },
    }),
    prisma.unitOfMeasure.findMany({
      orderBy: { code: "asc" },
      select: { code: true, label: true },
    }),
  ]);

  if (etapes.length === 0) {
    return (
      <>
        <EnTetePage titre="Nouveau produit" />
        <Alerte ton="alerte" titre="Aucune etape disponible">
          Le referentiel de votre division ne contient encore aucune etape de fabrication
          active. Les etapes se definissent dans <strong>Production &gt; Postes de travail</strong>.
          Creez les etapes (la coupe, l'assemblage, la finition...) avant de composer un produit.
        </Alerte>
      </>
    );
  }

  return (
    <>
      <EnTetePage
        titre="Nouveau produit"
        description="Un produit se compose de trois elements : son nom, sa chaine de fabrication (les etapes, choisies dans le referentiel de votre usine) et sa nomenclature (les matieres premieres, choisies dans le meme referentiel)."
      />

      <Alerte ton="info" titre="A quoi sert cet ecran">
        Vous selectionnez ici des etapes et des matieres premieres qui <strong>existent deja</strong>.
        L'article est cree en <strong>produit fini</strong>, fabricable, et sa chaine comme sa
        nomenclature sont creees en <strong>brouillon</strong> : elles devront etre activees
        depuis les ecrans Nomenclature et Gammes.
      </Alerte>

      <div className="mt-5">
        <FormulaireAction
          action={actionCreerProduit}
          libelleSoumettre="Creer le produit"
          reinitialiser
          className="space-y-5"
        >
          <Carte titre="1. Le produit">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Champ
                nom="code"
                libelle="Code du produit"
                requis
                maxLength={40}
                aide="Code unique dans tout l'ERP. Exemple : CHCANADA."
              />
              <Champ
                nom="libelle"
                libelle="Nom du produit"
                requis
                maxLength={200}
                aide="Le nom affiche partout, atelier compris."
              />
              <Champ
                nom="unite"
                libelle="Unite"
                type="select"
                options={unites.map((unite) => ({ valeur: unite.code, libelle: `${unite.code} — ${unite.label}` }))}
                aide="Unite de fabrication du produit."
              />
              {divisionImposee ? (
                <Champ
                  nom="division"
                  libelle="Division"
                  type="select"
                  requis
                  options={[{ valeur: divisionImposee, libelle: libelle(LIBELLES_USINE, divisionImposee) }]}
                  valeur={divisionImposee}
                  aide="Votre profil est rattache a cette division."
                />
              ) : (
                <Champ
                  nom="division"
                  libelle="Division"
                  type="select"
                  requis
                  options={divisions.map((valeur) => ({ valeur, libelle: libelle(LIBELLES_USINE, valeur) }))}
                  aide="Seules les divisions de votre profil sont proposees."
                />
              )}
            </div>
          </Carte>

          <Carte
            titre="2. La chaine de fabrication"
            description={`${etapes.length} etape(s) disponible(s) dans le referentiel de votre division. Cochez celles qui composent ce produit, dans l'ordre du referentiel.`}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ nom="codeChaine" libelle="Code de la chaine" requis maxLength={40} aide="Exemple : GAM-CHCANADA-1." />
              <Champ nom="libelleChaine" libelle="Nom de la chaine" maxLength={200} aide="Facultatif : un nom est propose par defaut." />
            </div>

            <div className="mt-4 max-h-96 overflow-y-auto rounded-lg border p-3" style={{ borderColor: "var(--bordure)" }}>
              <div className="space-y-2">
                {etapes.map((etape) => (
                  <label key={etape.id} className="flex cursor-pointer items-start gap-3 rounded p-2 hover:bg-black/5">
                    <input type="checkbox" name="etape" value={etape.id} className="mt-1 h-4 w-4" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        <span className="font-mono">{etape.code}</span> — {etape.label}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2">
                        <Etiquette ton="primaire">{libelle(LIBELLES_USINE, etape.factory)}</Etiquette>
                        {etape.workshop ? <span className="text-xs" style={{ color: "var(--texte-doux)" }}>{etape.workshop.label}</span> : null}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
              L&apos;ordre des etapes est celui du referentiel (Production &gt; Postes de travail).
              La derniere etape selectionnee devient l&apos;etape finale de la chaine.
            </p>
          </Carte>

          <Carte
            titre="3. La nomenclature (matieres premieres)"
            description={`${matieres.length} article(s) disponible(s). Cochez les matieres premieres et indiquez la quantite necessaire par unite produite.`}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ nom="codeNomenclature" libelle="Code de la nomenclature" maxLength={40} aide="Facultatif : un code est propose par defaut." />
              <Champ nom="libelleNomenclature" libelle="Nom de la nomenclature" maxLength={200} aide="Facultatif." />
            </div>

            <div className="mt-4 max-h-96 overflow-y-auto rounded-lg border p-3" style={{ borderColor: "var(--bordure)" }}>
              <div className="space-y-2">
                {matieres.map((matiere) => (
                  <div key={matiere.id} className="flex items-center gap-3 rounded p-2 hover:bg-black/5">
                    <input type="checkbox" name="composant" value={matiere.id} id={`c-${matiere.id}`} className="h-4 w-4" />
                    <label htmlFor={`c-${matiere.id}`} className="min-w-0 flex-1 cursor-pointer text-sm">
                      <span className="font-mono">{matiere.code}</span> — {matiere.label1}
                      <span className="ml-2 text-xs" style={{ color: "var(--texte-doux)" }}>
                        {libelle(LIBELLES_USINE, matiere.factory)}
                      </span>
                    </label>
                    <input
                      type="number"
                      name={`qte_${matiere.id}`}
                      step="0.000001"
                      min="0"
                      placeholder="Qte"
                      className="champ w-28"
                      aria-label={`Quantite pour ${matiere.code}`}
                    />
                    <span className="w-12 text-xs" style={{ color: "var(--texte-doux)" }}>
                      {matiere.unitCode ?? "-"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-2 text-xs" style={{ color: "var(--texte-doux)" }}>
              La quantite n&apos;est lue que pour les lignes cochees. Une matiere cochee sans
              quantite est refusee : le produit serait incomplet.
            </p>
          </Carte>
        </FormulaireAction>
      </div>
    </>
  );
}
