-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "customerId" INTEGER,
ADD COLUMN     "customerReference" TEXT,
ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryNotes" TEXT,
ADD COLUMN     "plannedDeliveryDate" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "ThirdParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
