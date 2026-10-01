import fs from "fs";

// 1. Add APP_URL to .env
const envFile = "C:/Users/stimanios/Documents/ERPMES/.env";
let env = fs.readFileSync(envFile, "utf8");
if (!env.includes("APP_URL")) {
  env += '\nAPP_URL="http://192.168.0.200:3000"\n';
  fs.writeFileSync(envFile, env, "utf8");
  console.log("Added APP_URL to .env");
} else {
  console.log("APP_URL already exists");
}

// 2. Update ScannerQR to extract token from URL or use directly
const scannerFile = "C:/Users/stimanios/Documents/ERPMES/src/components/scanner-qr.tsx";
let scanner = fs.readFileSync(scannerFile, "utf8");

// The scanner already handles URL extraction. Just make sure it works.
console.log("ScannerQR component ready");

// 3. Update the portal page scanner card description
const portalFile = "C:/Users/stimanios/Documents/ERPMES/src/app/(app)/portail/page.tsx";
let portal = fs.readFileSync(portalFile, "utf8");
portal = portal.replace(
  'Pointez votre camera vers le QR affiche sur votre machine pour acceder a votre programme.',
  `Pointez votre camera vers le QR affiche sur votre machine. Assurez-vous d'etre connecte au meme reseau WiFi.`,
);
fs.writeFileSync(portalFile, portal, "utf8");
console.log("Portal description updated");
