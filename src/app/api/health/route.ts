import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Point de sante operationnel.
 *
 * Il ne divulgue aucune donnee metier : il indique seulement si le service et
 * la base PostgreSQL sont joignables. Cloudflare Tunnel et PM2 peuvent donc
 * verifier l'application sans exposer de configuration interne.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({
      status: "ok",
      service: "erpmes",
      environment: process.env.NODE_ENV ?? "development",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return Response.json(
      {
        status: "degraded",
        service: "erpmes",
        environment: process.env.NODE_ENV ?? "development",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
