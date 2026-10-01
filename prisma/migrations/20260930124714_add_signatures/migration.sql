-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "signatureChefAtelier" TEXT,
ADD COLUMN     "signatureChefAtelierAt" TIMESTAMP(3),
ADD COLUMN     "signatureChefAtelierBy" INTEGER,
ADD COLUMN     "signatureMagasinier" TEXT,
ADD COLUMN     "signatureMagasinierAt" TIMESTAMP(3),
ADD COLUMN     "signatureMagasinierBy" INTEGER;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_signatureMagasinierBy_fkey" FOREIGN KEY ("signatureMagasinierBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_signatureChefAtelierBy_fkey" FOREIGN KEY ("signatureChefAtelierBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
