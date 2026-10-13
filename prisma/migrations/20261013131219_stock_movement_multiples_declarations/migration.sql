-- DropIndex
DROP INDEX "StockMovement_declarationId_key";

-- CreateIndex
CREATE INDEX "StockMovement_declarationId_idx" ON "StockMovement"("declarationId");
