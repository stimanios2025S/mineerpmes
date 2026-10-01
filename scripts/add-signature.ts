import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/prisma/schema.prisma";
let c = fs.readFileSync(f, "utf8");

// Add signature fields to WorkOrder
if (!c.includes("signatureMagasinier")) {
  c = c.replace(
    "  isSemiFinishedOutput Boolean @default(false)\n\n  createdAt DateTime @default(now())",
    `  isSemiFinishedOutput Boolean @default(false)

  // Signatures electroniques
  signatureMagasinier    String?
  signatureMagasinierAt  DateTime?
  signatureMagasinierBy  Int?
  signatureChefAtelier   String?
  signatureChefAtelierAt DateTime?
  signatureChefAtelierBy Int?

  createdAt DateTime @default(now())`,
  );
}

// Add relations
if (!c.includes("signatureMagasinierUser")) {
  c = c.replace(
    "  isSemiFinishedOutput Boolean @default(false)\n\n  // Signatures electroniques",
    `  isSemiFinishedOutput Boolean @default(false)

  signatureMagasinierUser    User? @relation("SigMagasinier", fields: [signatureMagasinierBy], references: [id])
  signatureChefAtelierUser   User? @relation("SigChefAtelier", fields: [signatureChefAtelierBy], references: [id])

  // Signatures electroniques`,
  );
}

fs.writeFileSync(f, c, "utf8");
console.log("Schema updated with signature fields");
