import Link from "next/link";
import { prisma } from "@/lib/db";
import { actionCreerNomenclature } from "@/actions/nomenclature";
import { exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { Alerte, Carte, EnTetePage, Section } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatEntier } from "@/lib/format";

export const metadata = { title: "Nouvelle nomenclature" };

export default async function PageNouvelleNomenclature() {
  const utilisateur = await exigerPermission(PERMISSIONS.NOMENCLATURE_ECRIRE);

  const [articles, depots] = await Promise.all([
    prisma.item.findMany({
      where: {
        status: { not: "ARCHIVE" },
        factory: { in: usinesAutorisees(utilisateur) },
        OR: [
          { isProducible: true },
          { type: { in: ["PRODUIT_FINI", "SEMI_FINI"] } },
        ],
      },
      orderBy: { code: "asc" },
      take: 1000,
      select: {
        id: true,
        code: true,
        label1: true,
        type: true,
        factory: true,
      },
    }),
    prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 300,
      select: { id: true, code: true, label: true },
    }),
  ]);

  return (
    <>
      <EnTetePage
        titre="Nouvelle nomenclature"
        description="La version est creee au statut brouillon. Ses composants restent modifiables jusqu'a la soumission a validation."
        actions={
          <Link className="lien-nav text-sm" href="/nomenclature">
            Retour a la liste
          </Link>
        }
      />

      <div className="mb-5">
        <Alerte
          ton="info"
          titre="Une nomenclature deja utilisee ne se modifie jamais en place"
        >
          Des qu'une version quitte le brouillon, ses composants sont figes. Toute
          evolution ulterieure se fait en creant une nouvelle version depuis la fiche
          de la version existante : les ordres de fabrication deja lances conservent
          la formulation qu'ils ont consommee.
        </Alerte>
      </div>

      {articles.length === 0 && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Aucun article parent disponible">
            Aucun article produisible, produit fini ou semi-fini n'est accessible avec
            votre portee de division. Verifiez le referentiel des articles avant de
            creer une nomenclature.
          </Alerte>
        </div>
      )}

      <Carte titre="En-tete de la version">
        <FormulaireAction
          action={actionCreerNomenclature}
          libelleSoumettre="Creer la nomenclature"
          reinitialiser
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Champ
              nom="articleId"
              libelle="Article parent"
              type="select"
              requis
              options={articles.map((article) => ({
                valeur: article.id,
                libelle: `${article.code} — ${article.label1} (${article.factory})`,
              }))}
              aide={`${formatEntier(articles.length)} article(s) produisible(s) accessible(s) avec votre portee.`}
            />
            <Champ
              nom="code"
              libelle="Code de la nomenclature"
              requis
              maxLength={60}
              aide="Code de la formule tel qu'il doit apparaitre en production."
            />
            <Champ
              nom="libelle"
              libelle="Libelle de la version"
              requis
              maxLength={200}
              aide="Designation lisible de cette version de formulation."
            />
            <Champ
              nom="version"
              libelle="Numero de version"
              type="number"
              min={1}
              valeur={1}
              requis
              aide="Un article ne peut pas porter deux fois le meme numero de version."
            />
            <Champ
              nom="dateEffet"
              libelle="Date d'effet"
              type="date"
              aide="Debut de la periode d'application. Laisser vide si la version n'est pas encore planifiee."
            />
            <Champ
              nom="dateFin"
              libelle="Date de fin"
              type="date"
              aide="Fin de la periode d'application. Laisser vide si aucune echeance n'est fixee."
            />
            <Champ
              nom="depotConsommation"
              libelle="Depot de consommation"
              type="select"
              options={depots.map((depot) => ({
                valeur: depot.id,
                libelle: `${depot.code} — ${depot.label}`,
              }))}
              aide="Depot dans lequel les composants sont preleves par defaut."
            />
            <Champ
              nom="depotProduction"
              libelle="Depot de production"
              type="select"
              options={depots.map((depot) => ({
                valeur: depot.id,
                libelle: `${depot.code} — ${depot.label}`,
              }))}
              aide="Depot alimente par la production des produits issus de cette formulation."
            />
            <Champ
              nom="notes"
              libelle="Notes"
              type="textarea"
              maxLength={2000}
              aide="Precisions techniques utiles aux valideurs."
            />
          </div>
        </FormulaireAction>
      </Carte>

      <Section titre="Suite du parcours">
        <Carte>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Creer la version (statut brouillon).</li>
            <li>Ajouter ses composants depuis la fiche de la nomenclature.</li>
            <li>Soumettre la version a validation.</li>
            <li>La faire valider, puis l'activer pour la production.</li>
          </ol>
        </Carte>
      </Section>
    </>
  );
}
