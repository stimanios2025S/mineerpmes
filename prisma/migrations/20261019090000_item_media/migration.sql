-- Pieces jointes produit : photo et dessin technique.
-- Les fichiers eux-memes sont stockes hors base, dans le dossier `storage/` ;
-- la base ne garde que le nom du fichier et son nom d'origine.

ALTER TABLE "Item"
  ADD COLUMN "photoFile"   TEXT,
  ADD COLUMN "photoName"   TEXT,
  ADD COLUMN "drawingFile" TEXT,
  ADD COLUMN "drawingName" TEXT;
