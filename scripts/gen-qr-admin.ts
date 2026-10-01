import { PrismaClient } from "@prisma/client";
import QRCode from "qrcode";
import fs from "fs";

const BASE_URL = "http://192.168.0.200:3000";
const p = new PrismaClient();

(async () => {
  const wcs = await p.workCenter.findMany({
    where: { isActive: true },
    include: { workshop: { select: { label: true } } },
    orderBy: { id: "asc" },
  });

  const outDir = "C:/Users/stimanios/Documents/ERPMES/qr-codes";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const wc of wcs) {
    // Generate QR token if not exists
    let token = wc.qrToken;
    if (!token) {
      const crypto = require("crypto");
      token = crypto.randomBytes(16).toString("hex");
      await p.workCenter.update({
        where: { id: wc.id },
        data: { qrToken: token, qrGeneratedAt: new Date() },
      });
      console.log(`QR token generated for ${wc.code}`);
    }

    const url = `${BASE_URL}/portail/poste/${token}`;
    const filePath = `${outDir}/${wc.code}.png`;
    await QRCode.toFile(filePath, url, {
      width: 1024,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#000000", light: "#ffffff" },
    });
    console.log(`QR: ${wc.code} (${wc.factory}) -> ${wc.workshop?.label ?? "N/A"}`);
    console.log(`  URL: ${url}`);
  }

  console.log(`\n${wcs.length} QR codes ready in ${outDir}`);
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
