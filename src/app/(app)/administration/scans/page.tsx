import { prisma } from "@/lib/db";
import { exigerPermission } from "@/lib/rbac/guard";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { EnTetePage, Carte, Etiquette, Tableau, Vide } from "@/components/ui";

export const metadata = { title: "Historique des scans QR" };

/**
 * Extrait un nom d'appareil lisible depuis le userAgent.
 * Ex: "Samsung SM-G991B" au lieu de tout le userAgent technique.
 */
function nomAppareil(userAgent: string | null): string {
  if (!userAgent) return "Appareil inconnu";

  const ua = userAgent;

  // Samsung
  const samsung = ua.match(/Samsung\/[^;]+;[^;]*;([^)]+)\)/);
  if (samsung) return `Samsung ${samsung[1].trim()}`;
  if (ua.includes("Samsung")) {
    const model = ua.match(/(SM-[A-Z0-9]+)/);
    return model ? `Samsung ${model[1]}` : "Samsung";
  }

  // iPhone / iPad
  if (ua.includes("iPhone")) return "iPhone";
  if (ua.includes("iPad")) return "iPad";

  // Huawei
  if (ua.includes("Huawei")) {
    const model = ua.match(/(?:HUAWEI|HONOR)[^;)]*?([A-Z]{2,4}-[A-Z0-9]+)/i);
    return model ? model[1] : "Huawei";
  }

  // Xiaomi / Redmi
  if (ua.includes("Xiaomi") || ua.includes("Redmi")) {
    const model = ua.match(/(?:Xiaomi|Redmi)\s*([A-Za-z0-9\s]+)/);
    return model ? `Xiaomi ${model[1].trim()}` : "Xiaomi";
  }

  // Google Pixel
  if (ua.includes("Pixel")) {
    const model = ua.match(/Pixel\s*([0-9A-Za-z\s]+)/);
    return model ? `Google Pixel ${model[1].trim()}` : "Google Pixel";
  }

  // OPPO / OnePlus
  if (ua.includes("OPPO")) return "OPPO";
  if (ua.includes("OnePlus")) return "OnePlus";

  // Windows
  if (ua.includes("Windows")) return "PC Windows";

  // Mac
  if (ua.includes("Macintosh")) return "Mac";

  // Linux / Android generic
  if (ua.includes("Android")) return "Android";
  if (ua.includes("Linux")) return "Linux";

  // Browser fallback
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Safari")) return "Safari";

  return ua.substring(0, 50);
}

export default async function PageScans() {
  await exigerPermission(PERMISSIONS.SYSTEME_ADMIN);

  const scans = await prisma.workCenterScan.findMany({
    include: {
      workCenter: { select: { code: true, label: true, factory: true } },
      employee: { select: { matricule: true, firstName: true, lastName: true } },
    },
    orderBy: { scannedAt: "desc" },
    take: 100,
  });

  return (
    <>
      <EnTetePage
        titre="Historique des scans QR"
        description="Qui a scanne quel poste, quand, et avec quel appareil."
      />

      <div className="grid gap-4 sm:grid-cols-4 mb-5">
        <Carte titre="Total scans">
          <p className="text-3xl font-bold">{scans.length}</p>
        </Carte>
        <Carte titre="Aujourd'hui">
          <p className="text-3xl font-bold">
            {scans.filter(s => new Date(s.scannedAt).toDateString() === new Date().toDateString()).length}
          </p>
        </Carte>
        <Carte titre="Acceptes">
          <p className="text-3xl font-bold" style={{color:"var(--succes)"}}>
            {scans.filter(s => s.result === "ACCEPTE").length}
          </p>
        </Carte>
        <Carte titre="Refuses">
          <p className="text-3xl font-bold" style={{color:"var(--danger)"}}>
            {scans.filter(s => s.result !== "ACCEPTE").length}
          </p>
        </Carte>
      </div>

      <Carte titre="Derniers scans">
        {scans.length === 0 ? (
          <Vide message="Aucun scan enregistre pour le moment." />
        ) : (
          <Tableau
            messageVide=""
            cleLigne={(i) => String(scans[i].id)}
            colonnes={[
              { cle: "date", libelle: "Date/Heure" },
              { cle: "poste", libelle: "Poste" },
              { cle: "usine", libelle: "Usine" },
              { cle: "employe", libelle: "Employe" },
              { cle: "appareil", libelle: "Appareil" },
              { cle: "resultat", libelle: "Resultat" },
            ]}
            lignes={scans.map((scan) => ({
              cle: String(scan.id),
              cellules: [
                <span key="d">{new Date(scan.scannedAt).toLocaleString("fr-FR")}</span>,
                <span key="p" className="font-mono">{scan.workCenter.code}</span>,
                <span key="u">{scan.workCenter.factory}</span>,
                <span key="e">
                  {scan.employee
                    ? `${scan.employee.lastName} ${scan.employee.firstName} (${scan.employee.matricule})`
                    : "Non identifie"}
                </span>,
                <span key="a">{nomAppareil(scan.userAgent)}</span>,
                scan.result === "ACCEPTE" ? (
                  <Etiquette key="r" ton="succes">Accepte</Etiquette>
                ) : (
                  <Etiquette key="r" ton="danger">{scan.result}</Etiquette>
                ),
              ],
            }))}
          />
        )}
      </Carte>
    </>
  );
}
