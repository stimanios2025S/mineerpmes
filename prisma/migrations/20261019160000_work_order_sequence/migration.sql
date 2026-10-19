-- Ordre de passage explicite des ordres de fabrication, decide par le chef
-- d'atelier. 0 = premier. La liste est renumerotee a chaque deplacement.
ALTER TABLE "WorkOrder" ADD COLUMN "sequenceOrder" INTEGER NOT NULL DEFAULT 0;
