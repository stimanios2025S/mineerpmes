import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const decoded = decodeURIComponent(token);

  // Find the work center by QR token
  const wc = await prisma.workCenter.findFirst({
    where: { qrToken: decoded },
    select: { code: true, qrToken: true },
  });

  if (!wc || !wc.qrToken) {
    return new Response("QR not found", { status: 404 });
  }

  // Adresse de base : variable d'environnement si definie, sinon l'hote reel
  // de la requete. Jamais d'adresse codee en dur.
  const hote = request.headers.get("host") ?? "localhost:3000";
  const protocole =
    request.headers.get("x-forwarded-proto") ?? (hote.startsWith("localhost") ? "http" : "https");
  const baseUrl = process.env.APP_URL?.replace(/\/+$/, "") || `${protocole}://${hote}`;
  const url = `${baseUrl}/portail/poste/${wc.qrToken}`;

  // Generate QR as PNG
  const buffer = await QRCode.toBuffer(url, {
    type: "png",
    width: 512,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#000000", light: "#ffffff" },
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
