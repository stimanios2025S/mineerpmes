-- CreateTable
CREATE TABLE "ImportValueMapping" (
    "id" SERIAL NOT NULL,
    "sourceEntity" TEXT NOT NULL,
    "sourceField" TEXT NOT NULL,
    "sourceValue" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "label" TEXT,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportValueMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportValueMapping_sourceEntity_sourceField_idx" ON "ImportValueMapping"("sourceEntity", "sourceField");

-- CreateIndex
CREATE UNIQUE INDEX "ImportValueMapping_sourceEntity_sourceField_sourceValue_key" ON "ImportValueMapping"("sourceEntity", "sourceField", "sourceValue");
