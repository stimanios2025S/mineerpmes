/*
  Warnings:

  - A unique constraint covering the columns `[qrToken]` on the table `WorkCenter` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SupplyMode" AS ENUM ('ACHAT', 'FABRICATION', 'TRANSFERT_INTERNE');

-- CreateEnum
CREATE TYPE "ReplenishmentStatus" AS ENUM ('PROPOSEE', 'VALIDEE', 'REJETEE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "SubStockKind" AS ENUM ('ENTREE_OPERATION', 'SORTIE_OPERATION', 'TAMPON', 'ATTENTE_QUALITE');

-- CreateEnum
CREATE TYPE "ScanResult" AS ENUM ('ACCEPTE', 'REFUSE');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('BROUILLON', 'PUBLIE', 'ARCHIVE');

-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'TRANSFERT_SOUS_STOCK';

-- DropIndex
DROP INDEX "Assignment_employeeId_date_idx";

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "plannedLotId" INTEGER,
ADD COLUMN     "plannedQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
ADD COLUMN     "priority" "Priority" NOT NULL DEFAULT 'NORMALE',
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "scannedAt" TIMESTAMP(3),
ADD COLUMN     "scannedWorkCenterId" INTEGER,
ADD COLUMN     "scheduleId" INTEGER,
ADD COLUMN     "sequenceOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ItemWarehouseSetting" ADD COLUMN     "approachedById" INTEGER,
ADD COLUMN     "isReplenishmentActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastProposalAt" TIMESTAMP(3),
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "sourceWarehouseId" INTEGER,
ADD COLUMN     "supplierId" INTEGER,
ADD COLUMN     "supplyMode" "SupplyMode" NOT NULL DEFAULT 'ACHAT';

-- AlterTable
ALTER TABLE "OperationDeclaration" ADD COLUMN     "subStockId" INTEGER,
ADD COLUMN     "workCenterId" INTEGER;

-- AlterTable
ALTER TABLE "WorkCenter" ADD COLUMN     "qrGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "qrLastPrintedAt" TIMESTAMP(3),
ADD COLUMN     "qrRevokedAt" TIMESTAMP(3),
ADD COLUMN     "qrToken" TEXT,
ADD COLUMN     "qrVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ReplenishmentProposal" (
    "id" SERIAL NOT NULL,
    "proposalKey" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "quantityPhysical" DECIMAL(18,6) NOT NULL,
    "quantityReserved" DECIMAL(18,6) NOT NULL,
    "quantityImmobilized" DECIMAL(18,6) NOT NULL,
    "quantityPosition" DECIMAL(18,6) NOT NULL,
    "quantityMin" DECIMAL(18,6) NOT NULL,
    "quantityTarget" DECIMAL(18,6) NOT NULL,
    "proposedQuantity" DECIMAL(18,6) NOT NULL,
    "quantityOnOrder" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "supplyMode" "SupplyMode" NOT NULL,
    "supplierId" INTEGER,
    "sourceWarehouseId" INTEGER,
    "status" "ReplenishmentStatus" NOT NULL DEFAULT 'PROPOSEE',
    "motif" TEXT,
    "comment" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedById" INTEGER,
    "validatedAt" TIMESTAMP(3),
    "quantityApproved" DECIMAL(18,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplenishmentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationSubStock" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "operationId" INTEGER NOT NULL,
    "factory" "Factory" NOT NULL DEFAULT 'ADMEDCO',
    "workshopId" INTEGER,
    "workCenterId" INTEGER,
    "warehouseId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "kind" "SubStockKind" NOT NULL DEFAULT 'SORTIE_OPERATION',
    "sequenceOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationSubStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationSubStockLink" (
    "id" SERIAL NOT NULL,
    "fromSubStockId" INTEGER NOT NULL,
    "toSubStockId" INTEGER NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "quantityRatio" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationSubStockLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationStepTransfer" (
    "id" BIGSERIAL NOT NULL,
    "transferKey" TEXT NOT NULL,
    "workOrderId" INTEGER NOT NULL,
    "workOrderOperationId" INTEGER NOT NULL,
    "operationId" INTEGER NOT NULL,
    "fromSubStockId" INTEGER NOT NULL,
    "toSubStockId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unitCode" TEXT,
    "outMovementId" BIGINT,
    "inMovementId" BIGINT,
    "declarationId" BIGINT,
    "validatedById" INTEGER,
    "validatedAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationStepTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkCenterScan" (
    "id" BIGSERIAL NOT NULL,
    "workCenterId" INTEGER NOT NULL,
    "employeeId" INTEGER,
    "userId" INTEGER,
    "factory" "Factory" NOT NULL,
    "result" "ScanResult" NOT NULL,
    "reason" TEXT,
    "userAgent" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkCenterScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "factory" "Factory" NOT NULL,
    "workshopId" INTEGER,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'BROUILLON',
    "responsibleId" INTEGER,
    "publishedById" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "note" TEXT,
    "replacesId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentChange" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "changeType" TEXT NOT NULL,
    "previousEmployeeId" INTEGER,
    "newEmployeeId" INTEGER,
    "previousWorkCenterId" INTEGER,
    "newWorkCenterId" INTEGER,
    "previousPriority" "Priority",
    "newPriority" "Priority",
    "previousSequence" INTEGER,
    "newSequence" INTEGER,
    "reason" TEXT,
    "changedById" INTEGER,
    "changedByUserId" INTEGER,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReplenishmentProposal_proposalKey_key" ON "ReplenishmentProposal"("proposalKey");

-- CreateIndex
CREATE INDEX "ReplenishmentProposal_status_computedAt_idx" ON "ReplenishmentProposal"("status", "computedAt");

-- CreateIndex
CREATE INDEX "ReplenishmentProposal_itemId_warehouseId_idx" ON "ReplenishmentProposal"("itemId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationSubStock_code_key" ON "OperationSubStock"("code");

-- CreateIndex
CREATE INDEX "OperationSubStock_factory_idx" ON "OperationSubStock"("factory");

-- CreateIndex
CREATE INDEX "OperationSubStock_sequenceOrder_idx" ON "OperationSubStock"("sequenceOrder");

-- CreateIndex
CREATE UNIQUE INDEX "OperationSubStock_operationId_warehouseId_key" ON "OperationSubStock"("operationId", "warehouseId");

-- CreateIndex
CREATE INDEX "OperationSubStockLink_toSubStockId_idx" ON "OperationSubStockLink"("toSubStockId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationSubStockLink_fromSubStockId_toSubStockId_key" ON "OperationSubStockLink"("fromSubStockId", "toSubStockId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationStepTransfer_transferKey_key" ON "OperationStepTransfer"("transferKey");

-- CreateIndex
CREATE INDEX "OperationStepTransfer_workOrderId_idx" ON "OperationStepTransfer"("workOrderId");

-- CreateIndex
CREATE INDEX "OperationStepTransfer_workOrderOperationId_idx" ON "OperationStepTransfer"("workOrderOperationId");

-- CreateIndex
CREATE INDEX "OperationStepTransfer_occurredAt_idx" ON "OperationStepTransfer"("occurredAt");

-- CreateIndex
CREATE INDEX "WorkCenterScan_workCenterId_scannedAt_idx" ON "WorkCenterScan"("workCenterId", "scannedAt");

-- CreateIndex
CREATE INDEX "WorkCenterScan_employeeId_scannedAt_idx" ON "WorkCenterScan"("employeeId", "scannedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSchedule_code_key" ON "WorkSchedule"("code");

-- CreateIndex
CREATE INDEX "WorkSchedule_factory_periodStart_idx" ON "WorkSchedule"("factory", "periodStart");

-- CreateIndex
CREATE INDEX "WorkSchedule_status_idx" ON "WorkSchedule"("status");

-- CreateIndex
CREATE INDEX "WorkSchedule_workshopId_periodStart_idx" ON "WorkSchedule"("workshopId", "periodStart");

-- CreateIndex
CREATE INDEX "AssignmentChange_assignmentId_idx" ON "AssignmentChange"("assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentChange_changedAt_idx" ON "AssignmentChange"("changedAt");

-- CreateIndex
CREATE INDEX "Assignment_employeeId_date_sequenceOrder_idx" ON "Assignment"("employeeId", "date", "sequenceOrder");

-- CreateIndex
CREATE INDEX "Assignment_workCenterId_date_idx" ON "Assignment"("workCenterId", "date");

-- CreateIndex
CREATE INDEX "Assignment_scheduleId_idx" ON "Assignment"("scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCenter_qrToken_key" ON "WorkCenter"("qrToken");

-- AddForeignKey
ALTER TABLE "ItemWarehouseSetting" ADD CONSTRAINT "ItemWarehouseSetting_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ThirdParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemWarehouseSetting" ADD CONSTRAINT "ItemWarehouseSetting_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemWarehouseSetting" ADD CONSTRAINT "ItemWarehouseSetting_approachedById_fkey" FOREIGN KEY ("approachedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentProposal" ADD CONSTRAINT "ReplenishmentProposal_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentProposal" ADD CONSTRAINT "ReplenishmentProposal_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentProposal" ADD CONSTRAINT "ReplenishmentProposal_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentProposal" ADD CONSTRAINT "ReplenishmentProposal_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ThirdParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentProposal" ADD CONSTRAINT "ReplenishmentProposal_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentProposal" ADD CONSTRAINT "ReplenishmentProposal_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationDeclaration" ADD CONSTRAINT "OperationDeclaration_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationDeclaration" ADD CONSTRAINT "OperationDeclaration_subStockId_fkey" FOREIGN KEY ("subStockId") REFERENCES "OperationSubStock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_scannedWorkCenterId_fkey" FOREIGN KEY ("scannedWorkCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_plannedLotId_fkey" FOREIGN KEY ("plannedLotId") REFERENCES "StockLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSubStock" ADD CONSTRAINT "OperationSubStock_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSubStock" ADD CONSTRAINT "OperationSubStock_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSubStock" ADD CONSTRAINT "OperationSubStock_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSubStock" ADD CONSTRAINT "OperationSubStock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSubStock" ADD CONSTRAINT "OperationSubStock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSubStockLink" ADD CONSTRAINT "OperationSubStockLink_fromSubStockId_fkey" FOREIGN KEY ("fromSubStockId") REFERENCES "OperationSubStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSubStockLink" ADD CONSTRAINT "OperationSubStockLink_toSubStockId_fkey" FOREIGN KEY ("toSubStockId") REFERENCES "OperationSubStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationStepTransfer" ADD CONSTRAINT "OperationStepTransfer_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationStepTransfer" ADD CONSTRAINT "OperationStepTransfer_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationStepTransfer" ADD CONSTRAINT "OperationStepTransfer_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationStepTransfer" ADD CONSTRAINT "OperationStepTransfer_fromSubStockId_fkey" FOREIGN KEY ("fromSubStockId") REFERENCES "OperationSubStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationStepTransfer" ADD CONSTRAINT "OperationStepTransfer_toSubStockId_fkey" FOREIGN KEY ("toSubStockId") REFERENCES "OperationSubStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationStepTransfer" ADD CONSTRAINT "OperationStepTransfer_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationStepTransfer" ADD CONSTRAINT "OperationStepTransfer_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationStepTransfer" ADD CONSTRAINT "OperationStepTransfer_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "OperationDeclaration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationStepTransfer" ADD CONSTRAINT "OperationStepTransfer_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCenterScan" ADD CONSTRAINT "WorkCenterScan_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCenterScan" ADD CONSTRAINT "WorkCenterScan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "WorkSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentChange" ADD CONSTRAINT "AssignmentChange_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentChange" ADD CONSTRAINT "AssignmentChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
