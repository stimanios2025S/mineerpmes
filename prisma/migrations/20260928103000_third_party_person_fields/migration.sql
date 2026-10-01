-- Identite de la personne physique rattachee au tiers.
--
-- Le fichier source historique (SILWANE) range les personnes physiques et les
-- societes dans une seule table « tiers ». Le modele portait deja firstName,
-- lastName, socialSecurityNumber et ccp, mais omettait birthDate et gender :
-- l'import des tiers echouait donc entierement (« Unknown argument birthDate »).
--
-- Colonnes nullables, ajout additif : aucune donnee existante n'est affectee.
ALTER TABLE "ThirdParty" ADD COLUMN "birthDate" TIMESTAMP(3);
ALTER TABLE "ThirdParty" ADD COLUMN "gender" TEXT;
