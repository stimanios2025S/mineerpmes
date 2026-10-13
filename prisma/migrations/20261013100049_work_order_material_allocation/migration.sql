-- CreateTable
CREATE TABLE "WorkOrderMaterialAllocation" (
    "id" SERIAL NOT NULL,
    "materialId" INTEGER NOT NULL,
    "allocationKey" TEXT NOT NULL,
    "locationId" INTEGER,
    "lotId" INTEGER,
    "quantityReserved" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityConsumed" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderMaterialAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderMaterialAllocation_allocationKey_key" ON "WorkOrderMaterialAllocation"("allocationKey");

-- CreateIndex
CREATE INDEX "WorkOrderMaterialAllocation_materialId_idx" ON "WorkOrderMaterialAllocation"("materialId");

-- CreateIndex
CREATE INDEX "WorkOrderMaterialAllocation_lotId_idx" ON "WorkOrderMaterialAllocation"("lotId");

-- CreateIndex
CREATE INDEX "WorkOrderMaterialAllocation_locationId_idx" ON "WorkOrderMaterialAllocation"("locationId");

-- AddForeignKey
ALTER TABLE "WorkOrderMaterialAllocation" ADD CONSTRAINT "WorkOrderMaterialAllocation_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "WorkOrderMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderMaterialAllocation" ADD CONSTRAINT "WorkOrderMaterialAllocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderMaterialAllocation" ADD CONSTRAINT "WorkOrderMaterialAllocation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
