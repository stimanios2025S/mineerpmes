-- CreateEnum
CREATE TYPE "Factory" AS ENUM ('ADMEDCO', 'MOBILIX', 'COMMUN');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('MATIERE_PREMIERE', 'COMPOSANT', 'SEMI_FINI', 'PRODUIT_FINI', 'EMBALLAGE', 'CONSOMMABLE', 'SERVICE', 'MAIN_OEUVRE');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('ACTIF', 'INACTIF', 'ARCHIVE', 'NON_COMMERCIALISABLE', 'NON_PRODUCTIBLE');

-- CreateEnum
CREATE TYPE "ThirdPartyType" AS ENUM ('CLIENT', 'FOURNISSEUR', 'EMPLOYE', 'AUTRE');

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('MATIERES_PREMIERES', 'PRODUITS_FINIS', 'EN_COURS', 'QUARANTAINE', 'REBUT', 'TRANSIT', 'CONSOMMABLES');

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('LIBRE', 'QUARANTAINE', 'BLOQUE', 'REBUT', 'EN_COURS_PRODUCTION');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTREE_INITIALE', 'RECEPTION_FOURNISSEUR', 'SORTIE_PRODUCTION', 'CONSOMMATION_OPERATION', 'PRODUCTION_SEMI_FINI', 'PRODUCTION_PRODUIT_FINI', 'TRANSFERT_INTER_DEPOTS', 'LIVRAISON_CLIENT', 'RETOUR_CLIENT', 'RETOUR_FOURNISSEUR', 'MISE_EN_QUARANTAINE', 'LIBERATION_QUALITE', 'REBUT', 'PERTE', 'CORRECTION_INVENTAIRE', 'INVENTAIRE_PHYSIQUE', 'RESERVATION', 'ANNULATION_RESERVATION', 'AJUSTEMENT');

-- CreateEnum
CREATE TYPE "FormulaStatus" AS ENUM ('BROUILLON', 'EN_VALIDATION', 'VALIDEE', 'ACTIVE', 'REMPLACEE', 'ARCHIVEE');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('BROUILLON', 'ACTIVE', 'REMPLACEE', 'ARCHIVEE');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('BROUILLON', 'PLANIFIE', 'LANCE', 'EN_COURS', 'SUSPENDU', 'EN_CONTROLE_QUALITE', 'PARTIELLEMENT_TERMINE', 'TERMINE', 'CLOTURE', 'ANNULE');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('NON_DEMARREE', 'EN_COURS', 'EN_PAUSE', 'TERMINEE', 'VALIDEE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('BASSE', 'NORMALE', 'HAUTE', 'URGENTE');

-- CreateEnum
CREATE TYPE "QualityDecision" AS ENUM ('ACCEPTE', 'ACCEPTE_SOUS_RESERVE', 'QUARANTAINE', 'REJETE');

-- CreateEnum
CREATE TYPE "QualityCheckResult" AS ENUM ('CONFORME', 'NON_CONFORME', 'NON_APPLICABLE');

-- CreateEnum
CREATE TYPE "NonConformityStatus" AS ENUM ('OUVERTE', 'EN_ANALYSE', 'EN_REPRISE', 'RESOLUE', 'CLOTUREE', 'REJETEE');

-- CreateEnum
CREATE TYPE "NonConformitySource" AS ENUM ('RECEPTION', 'PRODUCTION', 'CONTROLE_FINAL', 'CLIENT', 'INVENTAIRE');

-- CreateEnum
CREATE TYPE "LossCategory" AS ENUM ('CONSOMMATION_NORMALE', 'SURCONSOMMATION', 'PERTE_NORMALE', 'PERTE_EXCEPTIONNELLE', 'REBUT', 'REPRISE', 'RETOUR_STOCK');

-- CreateEnum
CREATE TYPE "LossReason" AS ENUM ('DECOUPE_INCORRECTE', 'ERREUR_DE_MESURE', 'DEFAUT_MATIERE', 'DEFAUT_DE_COUTURE', 'DEFAUT_DE_SOUDURE', 'DEFAUT_DE_PEINTURE', 'DOMMAGE_MACHINE', 'ERREUR_DE_MONTAGE', 'DEFAUT_QUALITE', 'MATIERE_INUTILISABLE', 'CHUTE_NORMALE', 'AUTRE');

-- CreateEnum
CREATE TYPE "DeclarationKind" AS ENUM ('DEMARRAGE', 'PAUSE', 'REPRISE', 'PRODUCTION', 'CONSOMMATION', 'PERTE', 'PROBLEME', 'DEMANDE_CONTROLE', 'FIN', 'DEPLACEMENT_KANBAN');

-- CreateEnum
CREATE TYPE "DeclarationStatus" AS ENUM ('SAISIE', 'SOUMISE', 'VALIDEE', 'REJETEE');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PLANIFIEE', 'EN_COURS', 'EN_PAUSE', 'TERMINEE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'RETARD', 'CONGE', 'MALADIE', 'FERIE', 'FORMATION');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('BROUILLON', 'ENVOYE', 'ACCEPTE', 'REFUSE', 'EXPIRE', 'CONVERTI', 'ANNULE');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('BROUILLON', 'CONFIRMEE', 'PARTIELLEMENT_PRODUITE', 'PRODUITE', 'PARTIELLEMENT_LIVREE', 'LIVREE', 'FACTUREE', 'CLOTUREE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('BROUILLON', 'PREPAREE', 'EXPEDIEE', 'LIVREE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('BROUILLON', 'SOUMISE', 'APPROUVEE', 'REFUSEE', 'CONVERTIE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('BROUILLON', 'SOUMIS', 'APPROUVE', 'PARTIELLEMENT_RECU', 'RECU', 'FACTURE', 'CLOTURE', 'ANNULE');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('BROUILLON', 'EN_CONTROLE_QUALITE', 'ACCEPTE', 'PARTIELLEMENT_ACCEPTE', 'REJETE', 'ANNULE');

-- CreateEnum
CREATE TYPE "InvoiceDirection" AS ENUM ('CLIENT', 'FOURNISSEUR');

-- CreateEnum
CREATE TYPE "InvoiceNature" AS ENUM ('FACTURE', 'AVOIR');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('BROUILLON', 'VALIDEE', 'POSTEE', 'PARTIELLEMENT_REGLEE', 'REGLEE', 'EN_RETARD', 'ANNULEE');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('ENCAISSEMENT', 'DECAISSEMENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ESPECES', 'CHEQUE', 'VIREMENT', 'TRAITE', 'CARTE', 'COMPENSATION', 'AUTRE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('BROUILLON', 'VALIDE', 'POSTE', 'ANNULE');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ACTIF', 'PASSIF', 'CHARGE', 'PRODUIT', 'TRESORERIE', 'CAPITAUX');

-- CreateEnum
CREATE TYPE "JournalType" AS ENUM ('VENTE', 'ACHAT', 'BANQUE', 'CAISSE', 'STOCK', 'PRODUCTION', 'OPERATIONS_DIVERSES', 'PAIE');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('BROUILLON', 'VALIDEE', 'POSTEE', 'EXTOURNEE');

-- CreateEnum
CREATE TYPE "FiscalYearStatus" AS ENUM ('OUVERT', 'CLOTURE');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OUVERT', 'CLOTURE');

-- CreateEnum
CREATE TYPE "FormulaVarianceStatus" AS ENUM ('OUVERT', 'EN_ANALYSE', 'RESOLU', 'ACCEPTE');

-- CreateEnum
CREATE TYPE "ImportEntityType" AS ENUM ('ITEM_FAMILY', 'ITEM', 'FORMULA', 'FORMULA_LINE', 'BATCH', 'THIRD_PARTY', 'SUPPLIER_PRICE', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('EN_COURS', 'TERMINE', 'PARTIEL', 'ECHEC');

-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('INSERE', 'MIS_A_JOUR', 'IGNORE', 'PROTEGE', 'REJETE');

-- CreateEnum
CREATE TYPE "EvaluationPeriodType" AS ENUM ('JOUR', 'SEMAINE', 'MOIS');

-- CreateEnum
CREATE TYPE "ReliabilityLevel" AS ENUM ('INSUFFISANTE', 'FAIBLE', 'MOYENNE', 'BONNE');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "factoryScope" "Factory" DEFAULT 'COMMUN',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "userId" INTEGER,
    "userEmail" TEXT,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "comment" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "label" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberingSequence" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "pattern" TEXT NOT NULL DEFAULT '{PREFIX}-{YYYY}-{SEQ}',
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 5,
    "resetYearly" BOOLEAN NOT NULL DEFAULT true,
    "lastYear" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberingSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "collectedAccountNumber" TEXT,
    "deductibleAccountNumber" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "DivisionTransferRule" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "triggerOperationCode" TEXT NOT NULL,
    "producedItemId" INTEGER NOT NULL,
    "sourceWarehouseId" INTEGER NOT NULL,
    "targetWarehouseId" INTEGER NOT NULL,
    "factorySource" "Factory" NOT NULL DEFAULT 'ADMEDCO',
    "factoryTarget" "Factory" NOT NULL DEFAULT 'MOBILIX',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DivisionTransferRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemFamily" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "label2" TEXT,
    "parentId" INTEGER,
    "hierarchy" TEXT,
    "accountingCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceSystem" TEXT,
    "sourceOid" INTEGER,
    "sourceSyncId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "barcode" TEXT,
    "reference" TEXT,
    "label1" TEXT NOT NULL,
    "label2" TEXT,
    "label3" TEXT,
    "designation" TEXT,
    "type" "ItemType" NOT NULL DEFAULT 'COMPOSANT',
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIF',
    "familyId" INTEGER,
    "unitCode" TEXT,
    "taxRateCode" TEXT,
    "factory" "Factory" NOT NULL DEFAULT 'COMMUN',
    "isPurchasable" BOOLEAN NOT NULL DEFAULT false,
    "isSellable" BOOLEAN NOT NULL DEFAULT false,
    "isProducible" BOOLEAN NOT NULL DEFAULT false,
    "isSemiFinished" BOOLEAN NOT NULL DEFAULT false,
    "isBatchManaged" BOOLEAN NOT NULL DEFAULT false,
    "isPerishable" BOOLEAN NOT NULL DEFAULT false,
    "isRawMaterial" BOOLEAN NOT NULL DEFAULT false,
    "isMainOeuvre" BOOLEAN NOT NULL DEFAULT false,
    "isKit" BOOLEAN NOT NULL DEFAULT false,
    "isOutOfService" BOOLEAN NOT NULL DEFAULT false,
    "useNegativeStock" BOOLEAN NOT NULL DEFAULT false,
    "vwap" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "vwapPhysical" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "lastPurchasePrice" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lastSalesPrice" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "standardCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quantityMin" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityMin2" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityMax" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityMax2" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "safetyStock" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "accountingCode" TEXT,
    "stockAccount" TEXT,
    "productionAccount" TEXT,
    "consumptionAccount" TEXT,
    "unitWeight" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unitValue" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "width" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "height" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "length" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "thickness" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "defaultPacking" TEXT,
    "image" TEXT,
    "brand" TEXT,
    "remark" TEXT,
    "note" TEXT,
    "sourceSystem" TEXT,
    "sourceOid" INTEGER,
    "sourceSyncId" TEXT,
    "sourceDefaultFormula" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "WarehouseType" NOT NULL DEFAULT 'MATIERES_PREMIERES',
    "factory" "Factory" NOT NULL DEFAULT 'ADMEDCO',
    "address" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isQuarantineWarehouse" BOOLEAN NOT NULL DEFAULT false,
    "sourceSystem" TEXT,
    "sourceOid" INTEGER,
    "sourceSyncId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "aisle" TEXT,
    "rack" TEXT,
    "level" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThirdParty" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ThirdPartyType" NOT NULL DEFAULT 'CLIENT',
    "isClient" BOOLEAN NOT NULL DEFAULT false,
    "isSupplier" BOOLEAN NOT NULL DEFAULT false,
    "isEmployee" BOOLEAN NOT NULL DEFAULT false,
    "isOther" BOOLEAN NOT NULL DEFAULT false,
    "label1" TEXT NOT NULL,
    "label2" TEXT,
    "designation" TEXT,
    "reference" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "address1" TEXT,
    "address2" TEXT,
    "city" TEXT,
    "postCode" TEXT,
    "commune" TEXT,
    "department" TEXT,
    "country" TEXT DEFAULT 'Algerie',
    "region" TEXT,
    "phone1" TEXT,
    "phone2" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "url" TEXT,
    "mobile" TEXT,
    "taxId" TEXT,
    "nif" TEXT,
    "nis" TEXT,
    "rc" TEXT,
    "ai" TEXT,
    "ccp" TEXT,
    "socialSecurityNumber" TEXT,
    "legalForm" TEXT,
    "activity" TEXT,
    "accountingCode" TEXT,
    "familyCode" TEXT,
    "category1" TEXT,
    "category2" TEXT,
    "category3" TEXT,
    "category4" TEXT,
    "category5" TEXT,
    "paymentMethod" "PaymentMethod",
    "deadlineDays" INTEGER NOT NULL DEFAULT 0,
    "discountRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "increaseRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "maxBalanceAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "exemptFromVat" BOOLEAN NOT NULL DEFAULT false,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "responsibilityCenter" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "remark" TEXT,
    "note" TEXT,
    "sourceSystem" TEXT,
    "sourceOid" INTEGER,
    "sourceSyncId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThirdParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemSupplierPrice" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "supplierRef" TEXT,
    "price" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "minQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "sourceSystem" TEXT,
    "sourceOid" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemSupplierPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemPrice" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "thirdPartyId" INTEGER,
    "priceType" TEXT NOT NULL DEFAULT 'VENTE',
    "price" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "discountRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemWarehouseSetting" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "quantityMin" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityMax" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "safetyStock" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "reorderPoint" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemWarehouseSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Formula" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "label" TEXT NOT NULL,
    "label2" TEXT,
    "itemId" INTEGER NOT NULL,
    "status" "FormulaStatus" NOT NULL DEFAULT 'BROUILLON',
    "type" TEXT,
    "typeFormule" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "changeReason" TEXT,
    "previousVersionId" INTEGER,
    "warehouseProdId" INTEGER,
    "warehouseStoreId" INTEGER,
    "warehouseDestId" INTEGER,
    "productionTimePerUnit" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "productionCostPerUnit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "costCalcMethod" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "isQuarantineWarehouse" BOOLEAN NOT NULL DEFAULT false,
    "isDecomposable" BOOLEAN NOT NULL DEFAULT false,
    "sourceSystem" TEXT,
    "sourceOid" INTEGER,
    "sourceSyncId" TEXT,
    "importedFrom" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Formula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormulaLine" (
    "id" SERIAL NOT NULL,
    "formulaId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "componentItemId" INTEGER NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitCode" TEXT,
    "lossRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "scrapRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "toleratedError" DECIMAL(9,4),
    "operationCode" TEXT,
    "consumptionWarehouseId" INTEGER,
    "productionWarehouseId" INTEGER,
    "unitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "apartFromCost" BOOLEAN NOT NULL DEFAULT false,
    "lineClass" TEXT,
    "inProcess" BOOLEAN NOT NULL DEFAULT false,
    "isLabor" BOOLEAN NOT NULL DEFAULT false,
    "rate" DECIMAL(9,4),
    "taux" DECIMAL(9,4),
    "label1" TEXT,
    "notes" TEXT,
    "sourceSystem" TEXT,
    "sourceOid" INTEGER,
    "sourceSyncId" TEXT,
    "importedFrom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormulaLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormulaVariance" (
    "id" SERIAL NOT NULL,
    "formulaId" INTEGER NOT NULL,
    "formulaLineId" INTEGER,
    "componentItemId" INTEGER,
    "lineNo" INTEGER,
    "sourceA" TEXT NOT NULL,
    "valueA" TEXT,
    "sourceB" TEXT NOT NULL,
    "valueB" TEXT,
    "delta" TEXT,
    "status" "FormulaVarianceStatus" NOT NULL DEFAULT 'OUVERT',
    "resolutionNote" TEXT,
    "resolvedValue" TEXT,
    "resolvedById" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormulaVariance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workshop" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "factory" "Factory" NOT NULL DEFAULT 'ADMEDCO',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workshop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "factory" "Factory" NOT NULL,
    "workshopId" INTEGER,
    "sequenceOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "standardTimeMinutes" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "standardLossRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "requiresQualityCheck" BOOLEAN NOT NULL DEFAULT false,
    "consumesSemiFinished" BOOLEAN NOT NULL DEFAULT false,
    "producesSemiFinished" BOOLEAN NOT NULL DEFAULT false,
    "isKanbanVisible" BOOLEAN NOT NULL DEFAULT true,
    "boardOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "colorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkCenter" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "factory" "Factory" NOT NULL DEFAULT 'ADMEDCO',
    "workshopId" INTEGER,
    "operationId" INTEGER,
    "location" TEXT,
    "capacityPerHour" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "operatorsRequired" INTEGER NOT NULL DEFAULT 1,
    "costPerHour" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRoute" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "RouteStatus" NOT NULL DEFAULT 'BROUILLON',
    "factory" "Factory" NOT NULL DEFAULT 'COMMUN',
    "workshopId" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteStep" (
    "id" SERIAL NOT NULL,
    "routeId" INTEGER NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "operationId" INTEGER NOT NULL,
    "workCenterId" INTEGER,
    "standardTimeMinutes" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "setupTimeMinutes" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "isQualityGate" BOOLEAN NOT NULL DEFAULT false,
    "isFinalStep" BOOLEAN NOT NULL DEFAULT false,
    "consumesSemiFinished" BOOLEAN NOT NULL DEFAULT false,
    "producesSemiFinished" BOOLEAN NOT NULL DEFAULT false,
    "producedItemId" INTEGER,
    "unitCode" TEXT,
    "description" TEXT,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLot" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "lotNumber" TEXT NOT NULL,
    "status" "StockStatus" NOT NULL DEFAULT 'LIBRE',
    "manufactureDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "inventoryDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "supplierId" INTEGER,
    "workOrderId" INTEGER,
    "originCountry" TEXT,
    "blockingReason" TEXT,
    "unitCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "isImmobilization" BOOLEAN NOT NULL DEFAULT false,
    "sourceSystem" TEXT,
    "sourceOid" INTEGER,
    "sourceCode" TEXT,
    "sourceSyncId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" BIGSERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "itemId" INTEGER NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "lotId" INTEGER,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitCode" TEXT,
    "unitCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "balanceAfter" DECIMAL(18,6),
    "status" "StockStatus" NOT NULL DEFAULT 'LIBRE',
    "sourceWarehouseId" INTEGER,
    "targetWarehouseId" INTEGER,
    "workOrderId" INTEGER,
    "workOrderOperationId" INTEGER,
    "operationId" INTEGER,
    "declarationId" BIGINT,
    "documentType" TEXT,
    "documentId" TEXT,
    "documentNumber" TEXT,
    "thirdPartyId" INTEGER,
    "userId" INTEGER,
    "userEmail" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "reason" TEXT,
    "justification" TEXT,
    "isReversal" BOOLEAN NOT NULL DEFAULT false,
    "reversedById" BIGINT,
    "accountingEntryId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" BIGSERIAL NOT NULL,
    "balanceKey" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "lotId" INTEGER,
    "status" "StockStatus" NOT NULL DEFAULT 'LIBRE',
    "quantityPhysical" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityReserved" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityBlocked" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityDamaged" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityQuarantine" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityInProduction" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "formulaId" INTEGER,
    "routeId" INTEGER,
    "factory" "Factory" NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'BROUILLON',
    "priority" "Priority" NOT NULL DEFAULT 'NORMALE',
    "quantityPlanned" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityLaunched" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityProduced" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityConform" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityScrapped" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityRework" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityRemaining" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "sourceWarehouseId" INTEGER,
    "targetWarehouseId" INTEGER,
    "workshopId" INTEGER,
    "salesOrderId" INTEGER,
    "salesOrderLineId" INTEGER,
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "responsibleId" INTEGER,
    "createdById" INTEGER,
    "notes" TEXT,
    "priorityReason" TEXT,
    "qualityStatus" "QualityDecision",
    "qualityReleasedAt" TIMESTAMP(3),
    "qualityReleasedById" INTEGER,
    "isSemiFinishedOutput" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderOperation" (
    "id" SERIAL NOT NULL,
    "workOrderId" INTEGER NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "operationId" INTEGER NOT NULL,
    "workCenterId" INTEGER,
    "status" "OperationStatus" NOT NULL DEFAULT 'NON_DEMARREE',
    "boardOrder" INTEGER NOT NULL DEFAULT 0,
    "quantityPlanned" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityProduced" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityConform" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityScrapped" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityRework" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityConsumed" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "totalPausedMs" BIGINT NOT NULL DEFAULT 0,
    "operatorId" INTEGER,
    "teamLabel" TEXT,
    "qualityStatus" "QualityDecision",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderMaterial" (
    "id" SERIAL NOT NULL,
    "workOrderId" INTEGER NOT NULL,
    "workOrderOperationId" INTEGER,
    "operationId" INTEGER,
    "componentItemId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL DEFAULT 0,
    "quantityPlanned" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityIssued" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityConsumed" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityLost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityReturned" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unitCode" TEXT,
    "lossRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "scrapRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "warehouseId" INTEGER,
    "snapshotSource" TEXT,
    "isLabor" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationDeclaration" (
    "id" BIGSERIAL NOT NULL,
    "workOrderId" INTEGER NOT NULL,
    "workOrderOperationId" INTEGER NOT NULL,
    "operationId" INTEGER NOT NULL,
    "employeeId" INTEGER,
    "userId" INTEGER,
    "kind" "DeclarationKind" NOT NULL,
    "status" "DeclarationStatus" NOT NULL DEFAULT 'SAISIE',
    "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityConform" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unitCode" TEXT,
    "itemId" INTEGER,
    "componentItemId" INTEGER,
    "lotId" INTEGER,
    "warehouseId" INTEGER,
    "materialId" INTEGER,
    "lossCategory" "LossCategory",
    "lossReason" "LossReason",
    "isExceptional" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMinutes" DECIMAL(18,4),
    "comment" TEXT,
    "attachmentUrl" TEXT,
    "validatedById" INTEGER,
    "validatedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KanbanTransition" (
    "id" BIGSERIAL NOT NULL,
    "workOrderId" INTEGER NOT NULL,
    "fromOperationId" INTEGER,
    "toOperationId" INTEGER,
    "fromWorkOrderOperationId" INTEGER,
    "toWorkOrderOperationId" INTEGER,
    "userId" INTEGER,
    "employeeId" INTEGER,
    "quantity" DECIMAL(18,6) NOT NULL,
    "declaredConsumptions" JSONB,
    "declaredLosses" JSONB,
    "qualityResult" "QualityDecision",
    "comment" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KanbanTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityPlan" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "itemId" INTEGER,
    "operationId" INTEGER,
    "factory" "Factory" NOT NULL DEFAULT 'COMMUN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isMandatoryForRelease" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityCheckpoint" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "checkType" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "expectedValue" TEXT,
    "toleranceMin" DECIMAL(18,6),
    "toleranceMax" DECIMAL(18,6),
    "unitCode" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityCheck" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "planId" INTEGER,
    "checkpointId" INTEGER,
    "itemId" INTEGER,
    "workOrderId" INTEGER,
    "workOrderOperationId" INTEGER,
    "goodsReceiptLineId" INTEGER,
    "thirdPartyId" INTEGER,
    "quantityChecked" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityConform" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityRejected" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "measuredValue" DECIMAL(18,6),
    "result" "QualityCheckResult" NOT NULL DEFAULT 'CONFORME',
    "decision" "QualityDecision" NOT NULL DEFAULT 'ACCEPTE',
    "comment" TEXT,
    "photoUrl" TEXT,
    "checkedById" INTEGER,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonConformity" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "source" "NonConformitySource" NOT NULL,
    "status" "NonConformityStatus" NOT NULL DEFAULT 'OUVERTE',
    "itemId" INTEGER,
    "workOrderId" INTEGER,
    "thirdPartyId" INTEGER,
    "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "rootCause" TEXT,
    "decision" "QualityDecision",
    "correctiveAction" TEXT,
    "costImpact" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "detectedById" INTEGER,
    "assignedToId" INTEGER,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NonConformity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" SERIAL NOT NULL,
    "matricule" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "photo" TEXT,
    "phone" TEXT,
    "phone2" TEXT,
    "email" TEXT,
    "jobTitle" TEXT,
    "factory" "Factory" NOT NULL DEFAULT 'COMMUN',
    "workshopId" INTEGER,
    "hireDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "address" TEXT,
    "city" TEXT,
    "birthDate" TIMESTAMP(3),
    "gender" TEXT,
    "socialSecurityNumber" TEXT,
    "ccp" TEXT,
    "contractType" TEXT,
    "baseSalary" DECIMAL(18,4),
    "salaryPerDay" DECIMAL(18,4),
    "defaultWarehouseId" INTEGER,
    "userId" INTEGER,
    "thirdPartyId" INTEGER,
    "sourceSystem" TEXT,
    "sourceOid" INTEGER,
    "sourceSyncId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "factory" "Factory" NOT NULL DEFAULT 'COMMUN',
    "operationId" INTEGER,
    "itemId" INTEGER,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeSkill" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "skillId" INTEGER NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "certifiedAt" TIMESTAMP(3),
    "certifiedById" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "factory" "Factory" NOT NULL,
    "operationId" INTEGER NOT NULL,
    "workCenterId" INTEGER,
    "workOrderId" INTEGER,
    "workOrderOperationId" INTEGER,
    "workshopId" INTEGER,
    "warehouseId" INTEGER,
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PLANIFIEE',
    "responsibleId" INTEGER,
    "comment" TEXT,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "workedHours" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "comment" TEXT,
    "recordedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceEvaluation" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "periodType" "EvaluationPeriodType" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "factory" "Factory" NOT NULL DEFAULT 'COMMUN',
    "operationId" INTEGER,
    "workOrderId" INTEGER,
    "productivityScore" DECIMAL(9,4),
    "qualityScore" DECIMAL(9,4),
    "materialEfficiencyScore" DECIMAL(9,4),
    "attendanceScore" DECIMAL(9,4),
    "versatilityScore" DECIMAL(9,4),
    "globalScore" DECIMAL(9,4),
    "weightsSnapshot" JSONB,
    "rawMetrics" JSONB,
    "assignmentsCount" INTEGER NOT NULL DEFAULT 0,
    "operationsMastered" INTEGER NOT NULL DEFAULT 0,
    "reliability" "ReliabilityLevel" NOT NULL DEFAULT 'INSUFFISANTE',
    "comment" TEXT,
    "isValidated" BOOLEAN NOT NULL DEFAULT false,
    "validatedById" INTEGER,
    "validatedAt" TIMESTAMP(3),
    "isCorrected" BOOLEAN NOT NULL DEFAULT false,
    "correctionReason" TEXT,
    "correctedById" INTEGER,
    "correctedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationWeight" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "weight" DECIMAL(9,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationWeight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'BROUILLON',
    "supplierId" INTEGER,
    "requesterId" INTEGER,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "neededBy" TIMESTAMP(3),
    "justification" TEXT,
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequestLine" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitCode" TEXT,
    "neededBy" TIMESTAMP(3),
    "estimatedPrice" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "PurchaseRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'BROUILLON',
    "supplierId" INTEGER NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "requestId" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "discountRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "subtotalHT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalTTC" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "deliveryAddress" TEXT,
    "notes" TEXT,
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "quantityReceived" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityInvoiced" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unitCode" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "vatRateCode" TEXT,
    "vatRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "lineHT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineVAT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTTC" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "expectedDate" TIMESTAMP(3),

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'BROUILLON',
    "supplierId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "receiptDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "warehouseId" INTEGER NOT NULL,
    "deliveryNoteNumber" TEXT,
    "qualityRequired" BOOLEAN NOT NULL DEFAULT true,
    "receivedById" INTEGER,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" SERIAL NOT NULL,
    "receiptId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "orderLineId" INTEGER,
    "itemId" INTEGER NOT NULL,
    "quantityOrdered" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityReceived" DECIMAL(18,6) NOT NULL,
    "quantityAccepted" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityRejected" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityQuarantined" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unitCode" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "lotNumber" TEXT,
    "manufactureDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "qualityStatus" "StockStatus" NOT NULL DEFAULT 'LIBRE',
    "qualityDecision" "QualityDecision",
    "locationId" INTEGER,
    "notes" TEXT,
    "movementId" BIGINT,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "supplierRef" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'BROUILLON',
    "supplierId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "receiptId" INTEGER,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "subtotalHT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalTTC" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "isCreditNote" BOOLEAN NOT NULL DEFAULT false,
    "threeWayMatched" BOOLEAN NOT NULL DEFAULT false,
    "matchingNotes" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceLine" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "orderLineId" INTEGER,
    "receiptLineId" INTEGER,
    "itemId" INTEGER,
    "description" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "vatRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "lineHT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineVAT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTTC" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "priceVariance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quantityVariance" DECIMAL(18,6) NOT NULL DEFAULT 0,

    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'BROUILLON',
    "customerId" INTEGER NOT NULL,
    "quoteDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "discountRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "subtotalHT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalTTC" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "convertedOrderId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" SERIAL NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitCode" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "vatRateCode" TEXT,
    "vatRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "lineHT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineVAT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTTC" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'BROUILLON',
    "customerId" INTEGER NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "quoteId" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "discountRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "subtotalHT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalTTC" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "deliveryAddress" TEXT,
    "customerRef" TEXT,
    "notes" TEXT,
    "createdById" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderLine" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "quantityProduced" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityDelivered" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityInvoiced" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unitCode" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "vatRateCode" TEXT,
    "vatRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "lineHT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineVAT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTTC" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "autoCreateWorkOrder" BOOLEAN NOT NULL DEFAULT false,
    "deliveryDate" TIMESTAMP(3),

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryNote" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'BROUILLON',
    "customerId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "deliveryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "warehouseId" INTEGER NOT NULL,
    "address" TEXT,
    "carrier" TEXT,
    "customerRef" TEXT,
    "qualityReleased" BOOLEAN NOT NULL DEFAULT false,
    "preparedById" INTEGER,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryNoteLine" (
    "id" SERIAL NOT NULL,
    "deliveryId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "orderLineId" INTEGER,
    "itemId" INTEGER NOT NULL,
    "quantityOrdered" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "quantityDelivered" DECIMAL(18,6) NOT NULL,
    "unitCode" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lotId" INTEGER,
    "locationId" INTEGER,
    "notes" TEXT,
    "movementId" BIGINT,

    CONSTRAINT "DeliveryNoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "direction" "InvoiceDirection" NOT NULL,
    "nature" "InvoiceNature" NOT NULL DEFAULT 'FACTURE',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'BROUILLON',
    "thirdPartyId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "deliveryId" INTEGER,
    "supplierInvoiceId" INTEGER,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "subtotalHT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalTTC" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT,
    "notes" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedById" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "originalInvoiceId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" INTEGER,
    "description" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitCode" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "vatRateCode" TEXT,
    "vatRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "lineHT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineVAT" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTTC" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "orderLineId" INTEGER,
    "deliveryLineId" INTEGER,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'BROUILLON',
    "thirdPartyId" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'VIREMENT',
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(18,4) NOT NULL,
    "allocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "reference" TEXT,
    "bankAccount" TEXT,
    "journalId" INTEGER,
    "postedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" SERIAL NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "parentNumber" TEXT,
    "isAnalytic" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "sourceSystem" TEXT,
    "sourceOid" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journal" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "JournalType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "FiscalYearStatus" NOT NULL DEFAULT 'OUVERT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" SERIAL NOT NULL,
    "fiscalYearId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OUVERT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingEntry" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "journalId" INTEGER NOT NULL,
    "periodId" INTEGER,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "reference" TEXT,
    "status" "EntryStatus" NOT NULL DEFAULT 'BROUILLON',
    "documentType" TEXT,
    "documentId" TEXT,
    "eventCode" TEXT,
    "totalDebit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "invoiceId" INTEGER,
    "paymentId" INTEGER,
    "isReversal" BOOLEAN NOT NULL DEFAULT false,
    "reversalOfId" INTEGER,
    "reversalReason" TEXT,
    "createdById" INTEGER,
    "postedById" INTEGER,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingEntryLine" (
    "id" SERIAL NOT NULL,
    "entryId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "label" TEXT,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "thirdPartyId" INTEGER,
    "matchingCode" TEXT,
    "isMatched" BOOLEAN NOT NULL DEFAULT false,
    "analyticCode" TEXT,
    "dueDate" TIMESTAMP(3),

    CONSTRAINT "AccountingEntryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingRule" (
    "id" SERIAL NOT NULL,
    "eventCode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "journalCode" TEXT NOT NULL,
    "debitAccountNumber" TEXT NOT NULL,
    "creditAccountNumber" TEXT NOT NULL,
    "vatAccountNumber" TEXT,
    "vatRateCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" SERIAL NOT NULL,
    "fileName" TEXT NOT NULL,
    "entityType" "ImportEntityType" NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'EN_COURS',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "insertedRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "protectedRows" INTEGER NOT NULL DEFAULT 0,
    "rejectedRows" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "userId" INTEGER,
    "options" JSONB,
    "summary" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportErrorLog" (
    "id" BIGSERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "entityType" "ImportEntityType" NOT NULL,
    "sourceOid" INTEGER,
    "sourceCode" TEXT,
    "itemId" INTEGER,
    "field" TEXT,
    "message" TEXT NOT NULL,
    "rawLine" TEXT,
    "action" "ImportRowAction" NOT NULL DEFAULT 'REJETE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE INDEX "Role_isActive_idx" ON "Role"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "Permission_module_idx" ON "Permission"("module");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_module_idx" ON "AuditLog"("module");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");

-- CreateIndex
CREATE INDEX "AppSetting_category_idx" ON "AppSetting"("category");

-- CreateIndex
CREATE UNIQUE INDEX "NumberingSequence_code_key" ON "NumberingSequence"("code");

-- CreateIndex
CREATE INDEX "TaxRate_isActive_idx" ON "TaxRate"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DivisionTransferRule_code_key" ON "DivisionTransferRule"("code");

-- CreateIndex
CREATE INDEX "DivisionTransferRule_isActive_idx" ON "DivisionTransferRule"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ItemFamily_code_key" ON "ItemFamily"("code");

-- CreateIndex
CREATE INDEX "ItemFamily_parentId_idx" ON "ItemFamily"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemFamily_sourceSystem_sourceOid_key" ON "ItemFamily"("sourceSystem", "sourceOid");

-- CreateIndex
CREATE UNIQUE INDEX "Item_code_key" ON "Item"("code");

-- CreateIndex
CREATE INDEX "Item_familyId_idx" ON "Item"("familyId");

-- CreateIndex
CREATE INDEX "Item_type_idx" ON "Item"("type");

-- CreateIndex
CREATE INDEX "Item_status_idx" ON "Item"("status");

-- CreateIndex
CREATE INDEX "Item_isSellable_idx" ON "Item"("isSellable");

-- CreateIndex
CREATE INDEX "Item_isProducible_idx" ON "Item"("isProducible");

-- CreateIndex
CREATE INDEX "Item_label1_idx" ON "Item"("label1");

-- CreateIndex
CREATE UNIQUE INDEX "Item_sourceSystem_sourceOid_key" ON "Item"("sourceSystem", "sourceOid");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE INDEX "Warehouse_factory_idx" ON "Warehouse"("factory");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_sourceSystem_sourceOid_key" ON "Warehouse"("sourceSystem", "sourceOid");

-- CreateIndex
CREATE UNIQUE INDEX "Location_warehouseId_code_key" ON "Location"("warehouseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ThirdParty_code_key" ON "ThirdParty"("code");

-- CreateIndex
CREATE INDEX "ThirdParty_type_idx" ON "ThirdParty"("type");

-- CreateIndex
CREATE INDEX "ThirdParty_isClient_idx" ON "ThirdParty"("isClient");

-- CreateIndex
CREATE INDEX "ThirdParty_isSupplier_idx" ON "ThirdParty"("isSupplier");

-- CreateIndex
CREATE INDEX "ThirdParty_label1_idx" ON "ThirdParty"("label1");

-- CreateIndex
CREATE UNIQUE INDEX "ThirdParty_sourceSystem_sourceOid_key" ON "ThirdParty"("sourceSystem", "sourceOid");

-- CreateIndex
CREATE INDEX "ItemSupplierPrice_itemId_idx" ON "ItemSupplierPrice"("itemId");

-- CreateIndex
CREATE INDEX "ItemSupplierPrice_supplierId_idx" ON "ItemSupplierPrice"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemSupplierPrice_sourceSystem_sourceOid_key" ON "ItemSupplierPrice"("sourceSystem", "sourceOid");

-- CreateIndex
CREATE INDEX "ItemPrice_itemId_idx" ON "ItemPrice"("itemId");

-- CreateIndex
CREATE INDEX "ItemPrice_thirdPartyId_idx" ON "ItemPrice"("thirdPartyId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemWarehouseSetting_itemId_warehouseId_key" ON "ItemWarehouseSetting"("itemId", "warehouseId");

-- CreateIndex
CREATE INDEX "Formula_status_idx" ON "Formula"("status");

-- CreateIndex
CREATE INDEX "Formula_itemId_idx" ON "Formula"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Formula_sourceSystem_sourceOid_key" ON "Formula"("sourceSystem", "sourceOid");

-- CreateIndex
CREATE UNIQUE INDEX "Formula_itemId_version_key" ON "Formula"("itemId", "version");

-- CreateIndex
CREATE INDEX "FormulaLine_formulaId_idx" ON "FormulaLine"("formulaId");

-- CreateIndex
CREATE INDEX "FormulaLine_componentItemId_idx" ON "FormulaLine"("componentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "FormulaLine_sourceSystem_sourceOid_key" ON "FormulaLine"("sourceSystem", "sourceOid");

-- CreateIndex
CREATE INDEX "FormulaVariance_formulaId_idx" ON "FormulaVariance"("formulaId");

-- CreateIndex
CREATE INDEX "FormulaVariance_status_idx" ON "FormulaVariance"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Workshop_code_key" ON "Workshop"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Operation_code_key" ON "Operation"("code");

-- CreateIndex
CREATE INDEX "Operation_factory_idx" ON "Operation"("factory");

-- CreateIndex
CREATE INDEX "Operation_boardOrder_idx" ON "Operation"("boardOrder");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCenter_code_key" ON "WorkCenter"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRoute_code_key" ON "ProductRoute"("code");

-- CreateIndex
CREATE INDEX "ProductRoute_status_idx" ON "ProductRoute"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRoute_itemId_version_key" ON "ProductRoute"("itemId", "version");

-- CreateIndex
CREATE INDEX "RouteStep_operationId_idx" ON "RouteStep"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "RouteStep_routeId_stepNo_key" ON "RouteStep"("routeId", "stepNo");

-- CreateIndex
CREATE INDEX "StockLot_itemId_idx" ON "StockLot"("itemId");

-- CreateIndex
CREATE INDEX "StockLot_warehouseId_idx" ON "StockLot"("warehouseId");

-- CreateIndex
CREATE INDEX "StockLot_expirationDate_idx" ON "StockLot"("expirationDate");

-- CreateIndex
CREATE UNIQUE INDEX "StockLot_itemId_warehouseId_lotNumber_key" ON "StockLot"("itemId", "warehouseId", "lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StockLot_sourceSystem_sourceOid_key" ON "StockLot"("sourceSystem", "sourceOid");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_number_key" ON "StockMovement"("number");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_declarationId_key" ON "StockMovement"("declarationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_reversedById_key" ON "StockMovement"("reversedById");

-- CreateIndex
CREATE INDEX "StockMovement_itemId_warehouseId_idx" ON "StockMovement"("itemId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockMovement_type_idx" ON "StockMovement"("type");

-- CreateIndex
CREATE INDEX "StockMovement_occurredAt_idx" ON "StockMovement"("occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_workOrderId_idx" ON "StockMovement"("workOrderId");

-- CreateIndex
CREATE INDEX "StockMovement_documentType_documentId_idx" ON "StockMovement"("documentType", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_balanceKey_key" ON "StockBalance"("balanceKey");

-- CreateIndex
CREATE INDEX "StockBalance_itemId_idx" ON "StockBalance"("itemId");

-- CreateIndex
CREATE INDEX "StockBalance_warehouseId_idx" ON "StockBalance"("warehouseId");

-- CreateIndex
CREATE INDEX "StockBalance_itemId_warehouseId_idx" ON "StockBalance"("itemId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_number_key" ON "WorkOrder"("number");

-- CreateIndex
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");

-- CreateIndex
CREATE INDEX "WorkOrder_factory_idx" ON "WorkOrder"("factory");

-- CreateIndex
CREATE INDEX "WorkOrder_itemId_idx" ON "WorkOrder"("itemId");

-- CreateIndex
CREATE INDEX "WorkOrder_dueDate_idx" ON "WorkOrder"("dueDate");

-- CreateIndex
CREATE INDEX "WorkOrderOperation_status_idx" ON "WorkOrderOperation"("status");

-- CreateIndex
CREATE INDEX "WorkOrderOperation_operationId_idx" ON "WorkOrderOperation"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderOperation_workOrderId_stepNo_key" ON "WorkOrderOperation"("workOrderId", "stepNo");

-- CreateIndex
CREATE INDEX "WorkOrderMaterial_workOrderId_idx" ON "WorkOrderMaterial"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderMaterial_componentItemId_idx" ON "WorkOrderMaterial"("componentItemId");

-- CreateIndex
CREATE INDEX "OperationDeclaration_workOrderId_idx" ON "OperationDeclaration"("workOrderId");

-- CreateIndex
CREATE INDEX "OperationDeclaration_workOrderOperationId_idx" ON "OperationDeclaration"("workOrderOperationId");

-- CreateIndex
CREATE INDEX "OperationDeclaration_kind_idx" ON "OperationDeclaration"("kind");

-- CreateIndex
CREATE INDEX "OperationDeclaration_employeeId_idx" ON "OperationDeclaration"("employeeId");

-- CreateIndex
CREATE INDEX "OperationDeclaration_occurredAt_idx" ON "OperationDeclaration"("occurredAt");

-- CreateIndex
CREATE INDEX "KanbanTransition_workOrderId_idx" ON "KanbanTransition"("workOrderId");

-- CreateIndex
CREATE INDEX "KanbanTransition_occurredAt_idx" ON "KanbanTransition"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "QualityPlan_code_key" ON "QualityPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "QualityCheckpoint_planId_code_key" ON "QualityCheckpoint"("planId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "QualityCheck_number_key" ON "QualityCheck"("number");

-- CreateIndex
CREATE INDEX "QualityCheck_workOrderId_idx" ON "QualityCheck"("workOrderId");

-- CreateIndex
CREATE INDEX "QualityCheck_itemId_idx" ON "QualityCheck"("itemId");

-- CreateIndex
CREATE INDEX "QualityCheck_decision_idx" ON "QualityCheck"("decision");

-- CreateIndex
CREATE UNIQUE INDEX "NonConformity_number_key" ON "NonConformity"("number");

-- CreateIndex
CREATE INDEX "NonConformity_status_idx" ON "NonConformity"("status");

-- CreateIndex
CREATE INDEX "NonConformity_workOrderId_idx" ON "NonConformity"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_matricule_key" ON "Employee"("matricule");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_thirdPartyId_key" ON "Employee"("thirdPartyId");

-- CreateIndex
CREATE INDEX "Employee_factory_idx" ON "Employee"("factory");

-- CreateIndex
CREATE INDEX "Employee_isActive_idx" ON "Employee"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_sourceSystem_sourceOid_key" ON "Employee"("sourceSystem", "sourceOid");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_code_key" ON "Skill"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeSkill_employeeId_skillId_key" ON "EmployeeSkill"("employeeId", "skillId");

-- CreateIndex
CREATE INDEX "Assignment_employeeId_date_idx" ON "Assignment"("employeeId", "date");

-- CreateIndex
CREATE INDEX "Assignment_date_idx" ON "Assignment"("date");

-- CreateIndex
CREATE INDEX "Assignment_operationId_idx" ON "Assignment"("operationId");

-- CreateIndex
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_date_key" ON "Attendance"("employeeId", "date");

-- CreateIndex
CREATE INDEX "PerformanceEvaluation_employeeId_periodType_periodStart_idx" ON "PerformanceEvaluation"("employeeId", "periodType", "periodStart");

-- CreateIndex
CREATE INDEX "PerformanceEvaluation_periodType_idx" ON "PerformanceEvaluation"("periodType");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationWeight_code_key" ON "EvaluationWeight"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_number_key" ON "PurchaseRequest"("number");

-- CreateIndex
CREATE INDEX "PurchaseRequestLine_requestId_idx" ON "PurchaseRequestLine"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_orderId_lineNo_key" ON "PurchaseOrderLine"("orderId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_number_key" ON "GoodsReceipt"("number");

-- CreateIndex
CREATE INDEX "GoodsReceipt_status_idx" ON "GoodsReceipt"("status");

-- CreateIndex
CREATE INDEX "GoodsReceipt_supplierId_idx" ON "GoodsReceipt"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptLine_receiptId_lineNo_key" ON "GoodsReceiptLine"("receiptId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_number_key" ON "SupplierInvoice"("number");

-- CreateIndex
CREATE INDEX "SupplierInvoice_status_idx" ON "SupplierInvoice"("status");

-- CreateIndex
CREATE INDEX "SupplierInvoice_supplierId_idx" ON "SupplierInvoice"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoiceLine_invoiceId_lineNo_key" ON "SupplierInvoiceLine"("invoiceId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_number_key" ON "Quote"("number");

-- CreateIndex
CREATE INDEX "Quote_status_idx" ON "Quote"("status");

-- CreateIndex
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLine_quoteId_lineNo_key" ON "QuoteLine"("quoteId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_number_key" ON "SalesOrder"("number");

-- CreateIndex
CREATE INDEX "SalesOrder_status_idx" ON "SalesOrder"("status");

-- CreateIndex
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderLine_orderId_lineNo_key" ON "SalesOrderLine"("orderId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryNote_number_key" ON "DeliveryNote"("number");

-- CreateIndex
CREATE INDEX "DeliveryNote_status_idx" ON "DeliveryNote"("status");

-- CreateIndex
CREATE INDEX "DeliveryNote_customerId_idx" ON "DeliveryNote"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryNoteLine_deliveryId_lineNo_key" ON "DeliveryNoteLine"("deliveryId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_supplierInvoiceId_key" ON "Invoice"("supplierInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_thirdPartyId_idx" ON "Invoice"("thirdPartyId");

-- CreateIndex
CREATE INDEX "Invoice_direction_nature_idx" ON "Invoice"("direction", "nature");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_invoiceId_lineNo_key" ON "InvoiceLine"("invoiceId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_number_key" ON "Payment"("number");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_invoiceId_key" ON "PaymentAllocation"("paymentId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_number_key" ON "Account"("number");

-- CreateIndex
CREATE INDEX "Account_type_idx" ON "Account"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Journal_code_key" ON "Journal"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_code_key" ON "FiscalYear"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_fiscalYearId_code_key" ON "AccountingPeriod"("fiscalYearId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingEntry_number_key" ON "AccountingEntry"("number");

-- CreateIndex
CREATE INDEX "AccountingEntry_journalId_idx" ON "AccountingEntry"("journalId");

-- CreateIndex
CREATE INDEX "AccountingEntry_entryDate_idx" ON "AccountingEntry"("entryDate");

-- CreateIndex
CREATE INDEX "AccountingEntry_status_idx" ON "AccountingEntry"("status");

-- CreateIndex
CREATE INDEX "AccountingEntry_documentType_documentId_idx" ON "AccountingEntry"("documentType", "documentId");

-- CreateIndex
CREATE INDEX "AccountingEntryLine_accountId_idx" ON "AccountingEntryLine"("accountId");

-- CreateIndex
CREATE INDEX "AccountingEntryLine_thirdPartyId_idx" ON "AccountingEntryLine"("thirdPartyId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingEntryLine_entryId_lineNo_key" ON "AccountingEntryLine"("entryId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingRule_eventCode_key" ON "AccountingRule"("eventCode");

-- CreateIndex
CREATE INDEX "ImportJob_entityType_idx" ON "ImportJob"("entityType");

-- CreateIndex
CREATE INDEX "ImportJob_status_idx" ON "ImportJob"("status");

-- CreateIndex
CREATE INDEX "ImportJob_startedAt_idx" ON "ImportJob"("startedAt");

-- CreateIndex
CREATE INDEX "ImportErrorLog_jobId_idx" ON "ImportErrorLog"("jobId");

-- CreateIndex
CREATE INDEX "ImportErrorLog_entityType_idx" ON "ImportErrorLog"("entityType");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivisionTransferRule" ADD CONSTRAINT "DivisionTransferRule_producedItemId_fkey" FOREIGN KEY ("producedItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivisionTransferRule" ADD CONSTRAINT "DivisionTransferRule_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivisionTransferRule" ADD CONSTRAINT "DivisionTransferRule_targetWarehouseId_fkey" FOREIGN KEY ("targetWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemFamily" ADD CONSTRAINT "ItemFamily_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ItemFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "ItemFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "UnitOfMeasure"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_taxRateCode_fkey" FOREIGN KEY ("taxRateCode") REFERENCES "TaxRate"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSupplierPrice" ADD CONSTRAINT "ItemSupplierPrice_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSupplierPrice" ADD CONSTRAINT "ItemSupplierPrice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ThirdParty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPrice" ADD CONSTRAINT "ItemPrice_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPrice" ADD CONSTRAINT "ItemPrice_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "ThirdParty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemWarehouseSetting" ADD CONSTRAINT "ItemWarehouseSetting_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemWarehouseSetting" ADD CONSTRAINT "ItemWarehouseSetting_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemWarehouseSetting" ADD CONSTRAINT "ItemWarehouseSetting_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Formula" ADD CONSTRAINT "Formula_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Formula" ADD CONSTRAINT "Formula_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Formula" ADD CONSTRAINT "Formula_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "Formula"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Formula" ADD CONSTRAINT "Formula_warehouseProdId_fkey" FOREIGN KEY ("warehouseProdId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Formula" ADD CONSTRAINT "Formula_warehouseStoreId_fkey" FOREIGN KEY ("warehouseStoreId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Formula" ADD CONSTRAINT "Formula_warehouseDestId_fkey" FOREIGN KEY ("warehouseDestId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormulaLine" ADD CONSTRAINT "FormulaLine_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "Formula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormulaLine" ADD CONSTRAINT "FormulaLine_componentItemId_fkey" FOREIGN KEY ("componentItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormulaLine" ADD CONSTRAINT "FormulaLine_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "UnitOfMeasure"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormulaLine" ADD CONSTRAINT "FormulaLine_consumptionWarehouseId_fkey" FOREIGN KEY ("consumptionWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormulaLine" ADD CONSTRAINT "FormulaLine_productionWarehouseId_fkey" FOREIGN KEY ("productionWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormulaVariance" ADD CONSTRAINT "FormulaVariance_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "Formula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormulaVariance" ADD CONSTRAINT "FormulaVariance_formulaLineId_fkey" FOREIGN KEY ("formulaLineId") REFERENCES "FormulaLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCenter" ADD CONSTRAINT "WorkCenter_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCenter" ADD CONSTRAINT "WorkCenter_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRoute" ADD CONSTRAINT "ProductRoute_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRoute" ADD CONSTRAINT "ProductRoute_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStep" ADD CONSTRAINT "RouteStep_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "ProductRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStep" ADD CONSTRAINT "RouteStep_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStep" ADD CONSTRAINT "RouteStep_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStep" ADD CONSTRAINT "RouteStep_producedItemId_fkey" FOREIGN KEY ("producedItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStep" ADD CONSTRAINT "RouteStep_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "UnitOfMeasure"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ThirdParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "StockMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_targetWarehouseId_fkey" FOREIGN KEY ("targetWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "ThirdParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_accountingEntryId_fkey" FOREIGN KEY ("accountingEntryId") REFERENCES "AccountingEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "OperationDeclaration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "Formula"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "ProductRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_targetWarehouseId_fkey" FOREIGN KEY ("targetWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_qualityReleasedById_fkey" FOREIGN KEY ("qualityReleasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperation" ADD CONSTRAINT "WorkOrderOperation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperation" ADD CONSTRAINT "WorkOrderOperation_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperation" ADD CONSTRAINT "WorkOrderOperation_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperation" ADD CONSTRAINT "WorkOrderOperation_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderMaterial" ADD CONSTRAINT "WorkOrderMaterial_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderMaterial" ADD CONSTRAINT "WorkOrderMaterial_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderMaterial" ADD CONSTRAINT "WorkOrderMaterial_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderMaterial" ADD CONSTRAINT "WorkOrderMaterial_componentItemId_fkey" FOREIGN KEY ("componentItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderMaterial" ADD CONSTRAINT "WorkOrderMaterial_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "UnitOfMeasure"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationDeclaration" ADD CONSTRAINT "OperationDeclaration_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationDeclaration" ADD CONSTRAINT "OperationDeclaration_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationDeclaration" ADD CONSTRAINT "OperationDeclaration_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationDeclaration" ADD CONSTRAINT "OperationDeclaration_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationDeclaration" ADD CONSTRAINT "OperationDeclaration_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationDeclaration" ADD CONSTRAINT "OperationDeclaration_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationDeclaration" ADD CONSTRAINT "OperationDeclaration_componentItemId_fkey" FOREIGN KEY ("componentItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationDeclaration" ADD CONSTRAINT "OperationDeclaration_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationDeclaration" ADD CONSTRAINT "OperationDeclaration_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationDeclaration" ADD CONSTRAINT "OperationDeclaration_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "UnitOfMeasure"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationDeclaration" ADD CONSTRAINT "OperationDeclaration_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "WorkOrderMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KanbanTransition" ADD CONSTRAINT "KanbanTransition_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KanbanTransition" ADD CONSTRAINT "KanbanTransition_fromOperationId_fkey" FOREIGN KEY ("fromOperationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KanbanTransition" ADD CONSTRAINT "KanbanTransition_toOperationId_fkey" FOREIGN KEY ("toOperationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KanbanTransition" ADD CONSTRAINT "KanbanTransition_fromWorkOrderOperationId_fkey" FOREIGN KEY ("fromWorkOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KanbanTransition" ADD CONSTRAINT "KanbanTransition_toWorkOrderOperationId_fkey" FOREIGN KEY ("toWorkOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KanbanTransition" ADD CONSTRAINT "KanbanTransition_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityPlan" ADD CONSTRAINT "QualityPlan_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityPlan" ADD CONSTRAINT "QualityPlan_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheckpoint" ADD CONSTRAINT "QualityCheckpoint_planId_fkey" FOREIGN KEY ("planId") REFERENCES "QualityPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheckpoint" ADD CONSTRAINT "QualityCheckpoint_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "UnitOfMeasure"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_planId_fkey" FOREIGN KEY ("planId") REFERENCES "QualityPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "QualityCheckpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_goodsReceiptLineId_fkey" FOREIGN KEY ("goodsReceiptLineId") REFERENCES "GoodsReceiptLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "ThirdParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonConformity" ADD CONSTRAINT "NonConformity_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonConformity" ADD CONSTRAINT "NonConformity_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonConformity" ADD CONSTRAINT "NonConformity_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "ThirdParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonConformity" ADD CONSTRAINT "NonConformity_detectedById_fkey" FOREIGN KEY ("detectedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonConformity" ADD CONSTRAINT "NonConformity_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_defaultWarehouseId_fkey" FOREIGN KEY ("defaultWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "ThirdParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSkill" ADD CONSTRAINT "EmployeeSkill_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSkill" ADD CONSTRAINT "EmployeeSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceEvaluation" ADD CONSTRAINT "PerformanceEvaluation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceEvaluation" ADD CONSTRAINT "PerformanceEvaluation_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceEvaluation" ADD CONSTRAINT "PerformanceEvaluation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceEvaluation" ADD CONSTRAINT "PerformanceEvaluation_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ThirdParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ThirdParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "UnitOfMeasure"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_vatRateCode_fkey" FOREIGN KEY ("vatRateCode") REFERENCES "TaxRate"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ThirdParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "UnitOfMeasure"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ThirdParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "GoodsReceiptLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "ThirdParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "UnitOfMeasure"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_vatRateCode_fkey" FOREIGN KEY ("vatRateCode") REFERENCES "TaxRate"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "ThirdParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "UnitOfMeasure"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_vatRateCode_fkey" FOREIGN KEY ("vatRateCode") REFERENCES "TaxRate"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "ThirdParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNoteLine" ADD CONSTRAINT "DeliveryNoteLine_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "DeliveryNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNoteLine" ADD CONSTRAINT "DeliveryNoteLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNoteLine" ADD CONSTRAINT "DeliveryNoteLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNoteLine" ADD CONSTRAINT "DeliveryNoteLine_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "UnitOfMeasure"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "ThirdParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "DeliveryNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "UnitOfMeasure"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_vatRateCode_fkey" FOREIGN KEY ("vatRateCode") REFERENCES "TaxRate"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_deliveryLineId_fkey" FOREIGN KEY ("deliveryLineId") REFERENCES "DeliveryNoteLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "ThirdParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "AccountingEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntryLine" ADD CONSTRAINT "AccountingEntryLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "AccountingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntryLine" ADD CONSTRAINT "AccountingEntryLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntryLine" ADD CONSTRAINT "AccountingEntryLine_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "ThirdParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportErrorLog" ADD CONSTRAINT "ImportErrorLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportErrorLog" ADD CONSTRAINT "ImportErrorLog_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
