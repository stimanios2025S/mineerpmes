import fs from "fs";
const f = "C:/Users/stimanios/Documents/ERPMES/prisma/schema.prisma";
let c = fs.readFileSync(f, "utf8");

// Add reverse relations on User model
if (!c.includes("signatureMagasinierWorkOrders")) {
  c = c.replace(
    "  qualityReleasedWorkOrders WorkOrder[]       @relation(\"WorkOrderQualityReleasedBy\")",
    `  qualityReleasedWorkOrders WorkOrder[]       @relation("WorkOrderQualityReleasedBy")
  signatureMagasinierWorkOrders WorkOrder[]   @relation("SigMagasinier")
  signatureChefAtelierWorkOrders WorkOrder[]  @relation("SigChefAtelier")`,
  );
}

fs.writeFileSync(f, c, "utf8");
console.log("User relations added");
