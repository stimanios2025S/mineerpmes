import fs from "fs";

// 1. Add "Livree" button to BCI page
const bciFile = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/stock/bci/[id]/page.tsx";
let bci = fs.readFileSync(bciFile, "utf8");

// Add import for actionConfirmerLivraison
bci = bci.replace(
  'import { formatDate, formatQuantite } from "@/lib/format";',
  'import { formatDate, formatQuantite } from "@/lib/format";\nimport { actionConfirmerLivraison } from "@/actions/lancement";\nimport { FormulaireAction } from "@/components/interactif";',
);

// Add Livree button after the materials table
bci = bci.replace(
  `        {/* Signatures */}`,
  `        {/* Bouton Livree */}
        <div className="no-print mt-4">
          <FormulaireAction
            action={async () => { "use server"; await actionConfirmerLivraison(${"{workOrderId}"}); }}
            libelleSoumettre="Confirmer la livraison des MP"
            varianteSoumettre="primaire"
          >
            <p className="text-sm" style={{color:"var(--texte-doux)"}}>
              Cliquez ici quand toutes les matieres premieres ont ete livrees a l atelier.
            </p>
          </FormulaireAction>
        </div>

        {/* Signatures */}`,
);

fs.writeFileSync(bciFile, bci, "utf8");
console.log("BCI: Livree button added");

// 2. Create magasinier portal page
const magDir = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/magasinier";
if (!fs.existsSync(magDir)) fs.mkdirSync(magDir, { recursive: true });

const magPage = `import { prisma } from "@/lib/db";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { EnTetePage, Carte, Etiquette, Tableau, Vide } from "@/components/ui";
import { formatDate, formatQuantite } from "@/lib/format";
import Link from "next/link";

export const metadata = { title: "Magasinier - Bons de commande internes" };

export default async function PageMagasinier() {
  const utilisateur = await exigerPermission(PERMISSIONS.STOCK_LIRE);

  // Tous les OF avec des BCI en attente
  const ordres = await prisma.workOrder.findMany({
    where: { status: { in: ["LANCE", "EN_COURS"] } },
    include: {
      item: { select: { code: true, label1: true } },
      materials: {
        where: { isLabor: false },
        select: { quantityPlanned: true, quantityIssued: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const ordresAvecStatut = ordres.map(of => {
    const totalLignes = of.materials.length;
    const lignesLivrees = of.materials.filter(m => m.quantityIssued >= m.quantityPlanned).length;
    const enAttente = totalLignes - lignesLivrees;
    return { ...of, totalLignes, lignesLivrees, enAttente };
  });

  return (
    <>
      <EnTetePage
        titre="Magasinier"
        description="Bons de commande internes a preparer et livrer aux ateliers."
      />

      <div className="grid gap-4 sm:grid-cols-3 mb-5">
        <Carte titre="En attente">
          <p className="text-3xl font-bold">{ordresAvecStatut.filter(o => o.enAttente > 0).length}</p>
          <p className="text-sm opacity-60">BCI a preparer</p>
        </Carte>
        <Carte titre="Livrees">
          <p className="text-3xl font-bold">{ordresAvecStatut.filter(o => o.enAttente === 0).length}</p>
          <p className="text-sm opacity-60">MP livrees a l atelier</p>
        </Carte>
        <Carte titre="Total OF actifs">
          <p className="text-3xl font-bold">{ordres.length}</p>
          <p className="text-sm opacity-60">Ordres en cours</p>
        </Carte>
      </div>

      <Carte titre="Bons de commande internes">
        {ordresAvecStatut.length === 0 ? (
          <Vide message="Aucun ordre de fabrication en cours." />
        ) : (
          <Tableau
            messageVide=""
            cleLigne={(i) => String(ordresAvecStatut[i].id)}
            colonnes={[
              { cle: "of", libelle: "OF" },
              { cle: "article", libelle: "Article" },
              { cle: "quantite", libelle: "Qte", nombre: true },
              { cle: "lignes", libelle: "Lignes MP" },
              { cle: "etat", libelle: "Etat" },
              { cle: "actions", libelle: "Actions" },
            ]}
            lignes={ordresAvecStatut.map(of => ({
              cle: String(of.id),
              cellules: [
                <span key="of"><Link href={"/stock/bci/" + of.id} className="lien-nav font-mono">{of.number}</Link></span>,
                <span key="art">{of.item.code}</span>,
                <span key="qte">{formatQuantite(of.quantityPlanned)}</span>,
                <span key="lignes">{of.lignesLivrees}/{of.totalLignes} livrees</span>,
                of.enAttente === 0 ? (
                  <Etiquette key="etat" ton="succes">Tout livre</Etiquette>
                ) : (
                  <Etiquette key="etat" ton="alerte">{of.enAttente} en attente</Etiquette>
                ),
                <Link key="bci" href={"/stock/bci/" + of.id} className="bouton secondaire text-xs" style={{minHeight:36}}>
                  Voir BCI
                </Link>,
              ],
            }))}
          />
        )}
      </Carte>
    </>
  );
}
`;
fs.writeFileSync(`${magDir}/page.tsx`, magPage);
console.log("Magasinier portal created");

// 3. Add MAGASINIER_BCI to navigation for MAGASINIER role
const navFile = "C:/Users/stimanios/Documents/ERPMES/src/components/navigation.ts";
let nav = fs.readFileSync(navFile, "utf8");
if (!nav.includes("/magasinier")) {
  // Add after the stock section
  nav = nav.replace(
    '      {\n        chemin: "/stock/lots",',
    '      {\n        chemin: "/stock/bci",\n        libelle: "BCI (Bons de commande internes)",\n        permission: PERMISSIONS.STOCK_LIRE,\n      },\n      {\n        chemin: "/magasinier",\n        libelle: "Magasinier",\n        permission: PERMISSIONS.STOCK_LIRE,\n      },\n      {\n        chemin: "/stock/lots",',
  );
  fs.writeFileSync(navFile, nav, "utf8");
  console.log("Navigation: BCI + Magasinier added");
} else {
  console.log("Navigation: already has /magasinier");
}

console.log("\nAll done!");
