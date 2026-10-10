-- Reservation de stock portee par la ligne de matiere d'un ordre de fabrication.
--
-- La quantite reservee doit etre suivie sur la ligne figee, et pas seulement sur
-- le solde de stock : c'est ce qui permet de liberer exactement ce qui n'a pas
-- ete consomme a la cloture ou a l'annulation, sans liberer deux fois, et de
-- savoir ce qu'un ordre donne immobilise encore.
--
-- Ajout purement additif, valeur par defaut 0 : aucun ordre existant n'est
-- affecte, et les reservations deja portees par StockBalance restent valides.
-- Aucune reprise de donnees n'est necessaire.

ALTER TABLE "WorkOrderMaterial"
  ADD COLUMN "quantityReserved" DECIMAL(18,6) NOT NULL DEFAULT 0;
