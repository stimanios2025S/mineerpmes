import Link from "next/link";
import { exigerPermission, usinesAutorisees } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { premiereValeur } from "@/lib/liste";
import {
  Alerte,
  Carte,
  EnTetePage,
  Etiquette,
  Statistique,
  Tableau,
} from "@/components/ui";
import { Champ } from "@/components/interactif";
import { tableauDeBordProprietaire } from "@/lib/mes/feuille-de-route";
import { D } from "@/lib/decimal";
import { formatDate, formatQuantite } from "@/lib/format";
import { LIBELLES_USINE } from "@/lib/libelles";
import { LIBELLE_PRIORITE } from "@/lib/mes/postes";
import type { Factory } from "@prisma/client";

export const metadata = { title: "Feuille de route" };

function estFactory(valeur: string | null): valeur is Factory {
  return valeur === "ADMEDCO" || valeur === "MOBILIX" || valeur === "COMMUN";
}

/**
 * Tableau du proprietaire : ou sont reellement les quantites.
 *
 * Une quantite declaree n'est jamais comptee comme arrivee a l'etape suivante :
 * seule une quantite conforme, validee puis effectivement transferee l'est. Une
 * etape a 100 pieces en cours dont 96 validees, 3 en reprise et 1 rebut n'a donc
 * pas « atteint » l'etape suivante.
 */
export default async function PageFeuilleDeRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const utilisateur = await exigerPermission(PERMISSIONS.PRODUCTION_LIRE);
  const parametres = await searchParams;

  const usines = usinesAutorisees(utilisateur);
  const usineParam = premiereValeur(parametres, "usine");
  const usineFiltre: Factory | undefined = estFactory(usineParam)
    ? usineParam
    : (usines[0] ?? undefined);

  if (usineFiltre && !usines.includes(usineFiltre)) {
    return (
      <>
        <EnTetePage titre="Feuille de route" />
        <Alerte ton="danger" titre="Perimetre insuffisant">
          Vous n'avez pas acces a la division {usineFiltre}.
        </Alerte>
      </>
    );
  }

  const lignes = await tableauDeBordProprietaire({
    factory: usineFiltre,
    limite: 40,
  });

  const avecAlerte = lignes.filter((ligne) => ligne.alertes.length > 0).length;
  const enAttente = lignes.reduce(
    (total, ligne) => D.add(total, ligne.enAttenteValidation),
    D.of(0),
  );
  const rebut = lignes.reduce(
    (total, ligne) => D.add(total, ligne.quantiteRebut),
    D.of(0),
  );
  const reprise = lignes.reduce(
    (total, ligne) => D.add(total, ligne.quantiteReprise),
    D.of(0),
  );

  return (
    <>
      <EnTetePage
        titre="Feuille de route"
        description="Pour chaque ordre en cours : ou sont les quantites, qui a fait quoi, et ce qui n'est pas encore arrive a l'etape suivante."
        actions={
          <Link className="bouton secondaire" href="/production/sous-stocks">
            Sous-stocks d'etape
          </Link>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Statistique libelle="Ordres suivis" valeur={lignes.length} />
        <Statistique
          libelle="Avec alerte"
          valeur={avecAlerte}
          ton={avecAlerte > 0 ? "alerte" : "succes"}
        />
        <Statistique
          libelle="En attente de validation"
          valeur={formatQuantite(enAttente)}
          detail="Declare conforme, pas encore valide"
        />
        <Statistique
          libelle="Reprise / rebut"
          valeur={`${formatQuantite(reprise)} / ${formatQuantite(rebut)}`}
        />
      </div>

      <Carte titre="Filtrer">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <Champ
            nom="usine"
            libelle="Division"
            type="select"
            valeur={usineFiltre ?? ""}
            options={usines.map((usine) => ({
              valeur: usine,
              libelle: LIBELLES_USINE[usine] ?? usine,
            }))}
          />
          <button className="bouton primaire" type="submit">
            Appliquer
          </button>
        </form>
      </Carte>

      <div className="mt-4">
        <Carte
          titre="Ordres de fabrication"
          description="L'avancement compte la quantite conforme validee, jamais la quantite simplement declaree."
        >
          <Tableau
            messageVide="Aucun ordre de fabrication en cours pour cette division."
            cleLigne={(index) => String(lignes[index]?.workOrderId ?? index)}
            colonnes={[
              { cle: "of", libelle: "Ordre" },
              { cle: "article", libelle: "Article" },
              { cle: "priorite", libelle: "Priorite" },
              { cle: "echeance", libelle: "Echeance" },
              { cle: "avancement", libelle: "Avancement", nombre: true },
              { cle: "quantites", libelle: "Planifie / conforme" },
              { cle: "etape", libelle: "Etape en cours" },
              { cle: "attente", libelle: "En attente de validation" },
              { cle: "alertes", libelle: "Alertes" },
            ]}
            lignes={lignes.map((ligne) => ({
              cle: String(ligne.workOrderId),
              cellules: [
                <span key={`o-${ligne.workOrderId}`}>
                  <Link
                    className="lien font-medium"
                    href={`/production/feuille-de-route/${ligne.workOrderId}`}
                  >
                    {ligne.numero}
                  </Link>
                  <span className="block text-sm" style={{ color: "var(--texte-doux)" }}>
                    {ligne.statut}
                  </span>
                </span>,
                ligne.article,
                <Etiquette
                  key={`p-${ligne.workOrderId}`}
                  ton={
                    ligne.priorite === "URGENTE"
                      ? "danger"
                      : ligne.priorite === "HAUTE"
                        ? "alerte"
                        : "neutre"
                  }
                >
                  {LIBELLE_PRIORITE[ligne.priorite as keyof typeof LIBELLE_PRIORITE] ??
                    ligne.priorite}
                </Etiquette>,
                ligne.dueDate ? formatDate(ligne.dueDate) : "—",
                `${ligne.avancementPourcent} %`,
                `${formatQuantite(ligne.quantitePlanifiee)} / ${formatQuantite(ligne.quantiteConforme)}`,
                ligne.etapeEnCours ?? "—",
                D.isZero(ligne.enAttenteValidation)
                  ? "—"
                  : formatQuantite(ligne.enAttenteValidation),
                ligne.alertes.length === 0 ? (
                  "—"
                ) : (
                  <span key={`a-${ligne.workOrderId}`} className="text-sm">
                    {ligne.alertes.join(" ")}
                  </span>
                ),
              ],
            }))}
          />
        </Carte>
      </div>

      <div className="mt-4">
        <Alerte ton="info" titre="Comment lire ces chiffres">
          La colonne « Planifie / conforme » compare ce qui a ete commande a ce
          qui a ete declare conforme ET valide. Une quantite declaree mais non
          validee, un rebut ou une reprise ne sont jamais comptes comme arrives :
          ils apparaissent dans leurs propres colonnes, et l'etape suivante ne
          demarre que sur du conforme reellement transfere.
        </Alerte>
      </div>
    </>
  );
}
