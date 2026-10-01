import Link from "next/link";
import { exigerUtilisateur } from "@/lib/rbac/guard";
import { Alerte, Carte, EnTetePage, Etiquette, ListeDefinitions } from "@/components/ui";
import { PERMISSION_DEFINITIONS } from "@/lib/rbac/permissions";
import { formatDate, formatDateTime } from "@/lib/format";
import { LIBELLES_USINE, libelle } from "@/lib/libelles";

export const metadata = { title: "Mon compte" };

/** Espace personnel : identite reelle, roles et droits effectifs. */
export default async function PageMonCompte() {
  const utilisateur = await exigerUtilisateur();

  const parModule = new Map<string, string[]>();
  for (const definition of PERMISSION_DEFINITIONS) {
    if (!utilisateur.permissions.includes(definition.code)) continue;
    const module = definition.module;
    const liste = parModule.get(module) ?? [];
    liste.push(definition.label);
    parModule.set(module, liste);
  }

  return (
    <>
      <EnTetePage
        titre="Mon compte"
        description="Identite rattachee a vos actions et droits effectivement accordes par vos roles."
        actions={
          <Link className="lien-nav text-sm" href="/mon-compte/mot-de-passe">
            Modifier mon mot de passe
          </Link>
        }
      />

      {utilisateur.mustChangePassword && (
        <div className="mb-5">
          <Alerte ton="alerte" titre="Changement de mot de passe obligatoire">
            Votre mot de passe a ete reinitialise par un administrateur. Vous devez le
            remplacer avant de poursuivre.{" "}
            <Link className="lien-nav" href="/mon-compte/mot-de-passe">
              Modifier maintenant
            </Link>
          </Alerte>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Carte titre="Identite">
          <ListeDefinitions
            elements={[
              { terme: "Nom affiche", valeur: utilisateur.employeeName ?? utilisateur.email },
              { terme: "Matricule employe", valeur: utilisateur.employeeMatricule ?? "-" },
              { terme: "Adresse electronique", valeur: utilisateur.email },
              {
                terme: "Division de rattachement",
                valeur: utilisateur.factory
                  ? libelle(LIBELLES_USINE, utilisateur.factory)
                  : "Non rattache a une division",
              },
              {
                terme: "Derniere connexion",
                valeur: utilisateur.lastLoginAt
                  ? formatDateTime(utilisateur.lastLoginAt)
                  : "Premiere connexion",
              },
              {
                terme: "Session ouverte le",
                valeur: formatDate(new Date()),
              },
            ]}
          />
        </Carte>

        <Carte titre="Roles attribues">
          {utilisateur.roles.length === 0 ? (
            <Alerte ton="danger">
              Aucun role actif : votre compte ne dispose d'aucun droit dans la plateforme.
            </Alerte>
          ) : (
            <ul className="space-y-3">
              {utilisateur.roles.map((role) => (
                <li key={role.code} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{role.label}</p>
                    <p className="text-xs" style={{ color: "var(--texte-doux)" }}>
                      Code technique : {role.code}
                    </p>
                  </div>
                  <Etiquette ton="primaire">
                    {role.factoryScope
                      ? libelle(LIBELLES_USINE, role.factoryScope)
                      : "Portee transversale"}
                  </Etiquette>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 space-y-2 text-sm">
            <p className="font-semibold">Portee autorisee</p>
            <p>
              {utilisateur.scope.allFactories
                ? "Les deux divisions (ADMEDCO et MOBILIX)"
                : [
                    utilisateur.scope.admedco ? "ADMEDCO" : null,
                    utilisateur.scope.mobilix ? "MOBILIX" : null,
                  ]
                    .filter(Boolean)
                    .join(" et ") || "Aucune division"}
            </p>
          </div>
        </Carte>
      </div>

      <div className="mt-5">
        <Carte
          titre={`Droits effectifs (${utilisateur.permissions.length})`}
          description="Liste exhaustive des permissions accordees par vos roles actifs."
        >
          {parModule.size === 0 ? (
            <p className="text-sm">Aucune permission accordee.</p>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {Array.from(parModule.entries())
                .sort(([a], [b]) => a.localeCompare(b, "fr"))
                .map(([module, droits]) => (
                  <div key={module}>
                    <p
                      className="mb-2 text-xs font-semibold uppercase tracking-wide"
                      style={{ color: "var(--texte-doux)" }}
                    >
                      {module}
                    </p>
                    <ul className="list-disc pl-5 text-sm">
                      {droits.map((droit) => (
                        <li key={droit}>{droit}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </Carte>
      </div>

      <p className="mt-4 text-xs" style={{ color: "var(--texte-doux)" }}>
        Vous ne voyez ici que vos propres informations. Les donnees salariales, la
        comptabilite generale et les donnees des autres ateliers ne sont accessibles
        qu'aux profils autorises.
      </p>
    </>
  );
}
