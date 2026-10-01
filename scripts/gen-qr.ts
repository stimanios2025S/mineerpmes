import { PrismaClient } from "@prisma/client";
import QRCode from "qrcode";
import fs from "fs";

const BASE_URL = "http://192.168.0.200:3000";
const p = new PrismaClient();

(async () => {
  const wcs = await p.workCenter.findMany({
    where: { qrToken: { not: null } },
    select: { code: true, label: true, qrToken: true, factory: true },
  });

  const outDir = "C:/Users/stimanios/Documents/ERPMES/qr-codes";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const wc of wcs) {
    const url = `${BASE_URL}/portail/poste/${wc.qrToken}`;
    const filePath = `${outDir}/${wc.code}.png`;
    await QRCode.toFile(filePath, url, {
      width: 512,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
    console.log(`QR: ${wc.code} (${wc.factory}) -> ${filePath}`);
    console.log(`   URL: ${url}`);
  }

  console.log(`\n${wcs.length} QR codes generated in ${outDir}`);
  await p.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
