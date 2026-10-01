-- CreateTable
CREATE TABLE "ImportRowSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceEntity" TEXT NOT NULL,
    "sourceOid" INTEGER NOT NULL,
    "sourceSyncId" TEXT,
    "fileName" TEXT NOT NULL,
    "jobId" INTEGER,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportRowSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportRowSnapshot_sourceEntity_idx" ON "ImportRowSnapshot"("sourceEntity");

-- CreateIndex
CREATE INDEX "ImportRowSnapshot_jobId_idx" ON "ImportRowSnapshot"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRowSnapshot_sourceSystem_sourceEntity_sourceOid_key" ON "ImportRowSnapshot"("sourceSystem", "sourceEntity", "sourceOid");
