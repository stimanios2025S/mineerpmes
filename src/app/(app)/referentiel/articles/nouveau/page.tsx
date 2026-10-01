import Link from "next/link";
import { prisma } from "@/lib/db";
import { actionCreerArticle } from "@/actions/referentiel";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { Alerte, Carte, EnTetePage, Section } from "@/components/ui";
import { Champ, FormulaireAction } from "@/components/interactif";
import { formatPourcentage } from "@/lib/format";
import { LIBELLES_TYPE_ARTICLE, LIBELLES_USINE, libelle } from "@/lib/libelles";

export const metadata = { title: "Nouvel article" };

const TYPES_ARTICLE = [
  "MATIERE_PREMIERE",
  "COMPOSANT",
  "SEMI_FINI",
  "PRODUIT_FINI",
  "EMBALLAGE",
  "CONSOMMABLE",
  "SERVICE",
  "MAIN_OEUVRE",
] as const;

const DIVISIONS = ["ADMEDCO", "MOBILIX", "COMMUN"] as const;

/** Case a cocher de configuration : la valeur est lue cote serveur via `booleen`. */
function CaseACocher({
  nom,
  libelle: intitule,
  aide,
  coche = false,
}: {
  nom: string;
  libelle: string;
  aide?: string;
  coche?: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={nom} defaultChecked={coche} className="mt-1" />
      <span>
        <span className="block font-medium">{intitule}</span>
        {aide && (
          <span className="block text-xs" style={{ color: "var(--texte-doux)" }}>
            {aide}
          </span>
        )}
      </span>
    </label>
  );
}

export default async function PageNouvelArticle() {
  await exigerPermission(PERMISSIONS.ARTICLE_ECRIRE);

  const [familles, unites, tauxTva] = await Promise.all([
    prisma.itemFamily.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 500,
      select: { id: true, code: true, label: true },
    }),
    prisma.unitOfMeasure.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 200,
      select: { code: true, label: true },
    }),
    prisma.taxRate.findMany({
      where: { isActive: true },
      orderBy: { rate: "asc" },
      select: { code: true, label: true, rate: true },
    }),
  ]);

  return (
    <>
      <EnTetePage
        titre="Nouvel article"
        description="Creation d'une fiche article. Les quantites, le cout moyen et la valorisation ne se saisissent pas ici : ils proviennent des mouvements de stock et des receptions."
        actions={
          <Link className="lien-nav text-sm" href="/referentiel/articles">
            Retour a la liste
          </Link>
        }
      />

      <FormulaireAction
        action={actionCreerArticle}
        libelleSoumettre="Enregistrer l'article"
        varianteSoumettre="primaire"
        reinitialiser
      >
        <div className="space-y-6">
          <Carte titre="Identification">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Champ
                nom="code"
                libelle="Code article"
                requis
                maxLength={50}
                aide="Code unique utilise par tous les documents et les imports."
              />
              <Champ nom="codeBarres" libelle="Code-barres" maxLength={50} />
              <Champ nom="reference" libelle="Reference interne" maxLength={50} />
              <Champ nom="libelle1" libelle="Libelle principal" requis maxLength={200} />
              <Champ nom="libelle2" libelle="Libelle secondaire" maxLength={200} />
              <Champ nom="libelle3" libelle="Libelle tertiaire" maxLength={200} />
              <Champ nom="designation" libelle="Designation longue" maxLength={300} />
              <Champ
                nom="type"
                libelle="Type d'article"
                type="select"
                requis
                valeur="COMPOSANT"
                options={TYPES_ARTICLE.map((valeur) => ({
                  valeur,
                  libelle: libelle(LIBELLES_TYPE_ARTICLE, valeur),
                }))}
              />
              <Champ
                nom="division"
                libelle="Division"
                type="select"
                requis
                valeur="COMMUN"
                options={DIVISIONS.map((valeur) => ({
                  valeur,
                  libelle: libelle(LIBELLES_USINE, valeur),
                }))}
                aide="Division qui porte l'article : les documents des autres divisions n'y accedent pas."
              />
              <Champ
                nom="familleId"
                libelle="Famille d'articles"
                type="select"
                options={familles.map((famille) => ({
                  valeur: famille.id,
                  libelle: `${famille.code} — ${famille.label}`,
                }))}
                aide={
                  familles.length === 0
                    ? "Aucune famille active : creez d'abord une famille d'articles."
                    : undefined
                }
              />
              <Champ
                nom="unite"
                libelle="Unite de mesure"
                type="select"
                options={unites.map((unite) => ({
                  valeur: unite.code,
                  libelle: `${unite.code} — ${unite.label}`,
                }))}
                aide={
                  unites.length === 0
                    ? "Aucune unite de mesure n'est definie : les quantites seront exprimees sans unite."
                    : undefined
                }
              />
              <Champ
                nom="codeTva"
                libelle="Taux de TVA"
                type="select"
                options={tauxTva.map((taux) => ({
                  valeur: taux.code,
                  libelle: `${taux.label} (${formatPourcentage(taux.rate)})`,
                }))}
              />
            </div>
          </Carte>

          <Carte
            titre="Configuration industrielle et commerciale"
            description="Ces interrupteurs conditionnent l'apparition de l'article dans les achats, les ventes, la production et les controles de stock."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <CaseACocher
                nom="achetable"
                libelle="Achetable"
                aide="L'article peut figurer sur une commande fournisseur."
              />
              <CaseACocher
                nom="vendable"
                libelle="Vendable"
                aide="L'article peut figurer sur un devis, une commande ou une facture client."
              />
              <CaseACocher
                nom="fabricable"
                libelle="Fabricable"
                aide="L'article peut faire l'objet d'un ordre de fabrication."
              />
              <CaseACocher
                nom="semiFini"
                libelle="Semi-fini"
                aide="Produit intermediaire, consomme par une operation suivante."
              />
              <CaseACocher
                nom="matierePremiere"
                libelle="Matiere premiere"
                aide="Entre directement dans la composition des produits."
              />
              <CaseACocher
                nom="mainOeuvre"
                libelle="Main d'oeuvre"
                aide="Article de main d'oeuvre : porte un cout horaire, pas de stock."
              />
              <CaseACocher
                nom="suiviParLot"
                libelle="Suivi par lot"
                aide="Oblige la saisie d'un lot a chaque entree en stock."
              />
              <CaseACocher
                nom="horsService"
                libelle="Hors service"
                aide="Article conserve pour l'historique, plus utilise dans les flux courants."
              />
              <CaseACocher
                nom="stockNegatifAutorise"
                libelle="Stock negatif autorise"
                aide="Autorise les sorties superieures au disponible pour cet article uniquement."
              />
            </div>
          </Carte>

          <Carte
            titre="Seuils de stock"
            description="Ces seuils servent aux alertes de reapprovisionnement. Ils ne creent aucun mouvement de stock."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Champ
                nom="quantiteMin"
                libelle="Quantite minimum"
                type="number"
                min={0}
                pas="0.001"
                valeur="0"
              />
              <Champ
                nom="quantiteMax"
                libelle="Quantite maximum"
                type="number"
                min={0}
                pas="0.001"
                valeur="0"
              />
              <Champ
                nom="stockSecurite"
                libelle="Stock de securite"
                type="number"
                min={0}
                pas="0.001"
                valeur="0"
              />
            </div>
          </Carte>

          <Carte
            titre="Poids et dimensions"
            description="Donnees logistiques utilisees pour le transport et le rangement. Aucune valorisation n'en decoule."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Champ
                nom="poidsUnitaire"
                libelle="Poids unitaire (kg)"
                type="number"
                min={0}
                pas="0.000001"
                valeur="0"
              />
              <Champ
                nom="longueur"
                libelle="Longueur (mm)"
                type="number"
                min={0}
                pas="0.000001"
                valeur="0"
              />
              <Champ
                nom="largeur"
                libelle="Largeur (mm)"
                type="number"
                min={0}
                pas="0.000001"
                valeur="0"
              />
              <Champ
                nom="hauteur"
                libelle="Hauteur (mm)"
                type="number"
                min={0}
                pas="0.000001"
                valeur="0"
              />
              <Champ
                nom="epaisseur"
                libelle="Epaisseur (mm)"
                type="number"
                min={0}
                pas="0.000001"
                valeur="0"
              />
            </div>
          </Carte>

          <Section titre="Enregistrement">
            <Alerte ton="info" titre="Article cree au statut actif">
              Le cout moyen pondere, la valorisation et le disponible restent a zero tant
              qu&apos;aucun mouvement de stock n&apos;a ete enregistre. Le cout moyen ne se
              saisit jamais a la main.
            </Alerte>
          </Section>
        </div>
      </FormulaireAction>
    </>
  );
}
