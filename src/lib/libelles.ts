/**
 * Libelles francais de toutes les valeurs de reference affichees.
 *
 * Source unique de verite : aucune interface ne doit afficher un code technique
 * (statut, type, categorie, motif) tel quel. Les valeurs inconnues sont
 * renvoyees telles quelles pour ne jamais masquer une donnee imprevue.
 */

export const LIBELLES_USINE: Record<string, string> = {
  ADMEDCO: "ADMEDCO (fabrication metallique)",
  MOBILIX: "MOBILIX (bois, couture et garnissage)",
  COMMUN: "Transversal (les deux divisions)",
};

export const LIBELLES_TYPE_ARTICLE: Record<string, string> = {
  MATIERE_PREMIERE: "Matiere premiere",
  COMPOSANT: "Composant",
  SEMI_FINI: "Semi-fini",
  PRODUIT_FINI: "Produit fini",
  EMBALLAGE: "Emballage",
  CONSOMMABLE: "Consommable",
  SERVICE: "Service",
  MAIN_OEUVRE: "Main d'oeuvre",
};

export const LIBELLES_STATUT_ARTICLE: Record<string, string> = {
  ACTIF: "Actif",
  INACTIF: "Inactif",
  ARCHIVE: "Archive",
  NON_COMMERCIALISABLE: "Non commercialisable",
  NON_PRODUCTIBLE: "Non productible",
};

export const LIBELLES_TYPE_TIERS: Record<string, string> = {
  CLIENT: "Client",
  FOURNISSEUR: "Fournisseur",
  EMPLOYE: "Employe",
  AUTRE: "Autre tiers",
};

export const LIBELLES_TYPE_DEPOT: Record<string, string> = {
  MATIERES_PREMIERES: "Matieres premieres",
  PRODUITS_FINIS: "Produits finis",
  EN_COURS: "En-cours de fabrication",
  QUARANTAINE: "Quarantaine",
  REBUT: "Rebut",
  TRANSIT: "Transit",
  CONSOMMABLES: "Consommables",
};

export const LIBELLES_STATUT_STOCK: Record<string, string> = {
  LIBRE: "Libre",
  QUARANTAINE: "Quarantaine",
  BLOQUE: "Bloque",
  REBUT: "Rebut",
  EN_COURS_PRODUCTION: "En cours de production",
};

export const LIBELLES_TYPE_MOUVEMENT: Record<string, string> = {
  ENTREE_INITIALE: "Entree initiale",
  RECEPTION_FOURNISSEUR: "Reception fournisseur",
  SORTIE_PRODUCTION: "Sortie vers production",
  CONSOMMATION_OPERATION: "Consommation d'operation",
  PRODUCTION_SEMI_FINI: "Production de semi-fini",
  PRODUCTION_PRODUIT_FINI: "Production de produit fini",
  TRANSFERT_INTER_DEPOTS: "Transfert inter-ateliers",
  LIVRAISON_CLIENT: "Livraison client",
  RETOUR_CLIENT: "Retour client",
  RETOUR_FOURNISSEUR: "Retour fournisseur",
  MISE_EN_QUARANTAINE: "Mise en quarantaine",
  LIBERATION_QUALITE: "Liberation qualite",
  REBUT: "Mise au rebut",
  PERTE: "Perte declaree",
  CORRECTION_INVENTAIRE: "Correction d'inventaire",
  INVENTAIRE_PHYSIQUE: "Inventaire physique",
  RESERVATION: "Reservation",
  ANNULATION_RESERVATION: "Annulation de reservation",
  AJUSTEMENT: "Ajustement",
};

export const LIBELLES_STATUT_NOMENCLATURE: Record<string, string> = {
  BROUILLON: "Brouillon",
  EN_VALIDATION: "En validation",
  VALIDEE: "Validee",
  ACTIVE: "Active",
  REMPLACEE: "Remplacee",
  ARCHIVEE: "Archivee",
};

export const LIBELLES_STATUT_GAMME: Record<string, string> = {
  BROUILLON: "Brouillon",
  ACTIVE: "Active",
  REMPLACEE: "Remplacee",
  ARCHIVEE: "Archivee",
};

export const LIBELLES_STATUT_ORDRE: Record<string, string> = {
  BROUILLON: "Brouillon",
  PLANIFIE: "Planifie",
  LANCE: "Lance",
  EN_COURS: "En cours",
  SUSPENDU: "Suspendu",
  EN_CONTROLE_QUALITE: "En controle qualite",
  PARTIELLEMENT_TERMINE: "Partiellement termine",
  TERMINE: "Termine",
  CLOTURE: "Cloture",
  ANNULE: "Annule",
};

export const LIBELLES_STATUT_OPERATION: Record<string, string> = {
  NON_DEMARREE: "Non demarree",
  EN_COURS: "En cours",
  EN_PAUSE: "En pause",
  TERMINEE: "Terminee",
  VALIDEE: "Validee",
  ANNULEE: "Annulee",
};

export const LIBELLES_PRIORITE: Record<string, string> = {
  BASSE: "Basse",
  NORMALE: "Normale",
  HAUTE: "Haute",
  URGENTE: "Urgente",
};

export const LIBELLES_DECISION_QUALITE: Record<string, string> = {
  ACCEPTE: "Accepte",
  ACCEPTE_SOUS_RESERVE: "Accepte sous reserve",
  QUARANTAINE: "Quarantaine",
  REJETE: "Rejete",
};

export const LIBELLES_RESULTAT_CONTROLE: Record<string, string> = {
  CONFORME: "Conforme",
  NON_CONFORME: "Non conforme",
  NON_APPLICABLE: "Non applicable",
};

export const LIBELLES_STATUT_NON_CONFORMITE: Record<string, string> = {
  OUVERTE: "Ouverte",
  EN_ANALYSE: "En analyse",
  EN_REPRISE: "En reprise",
  RESOLUE: "Resolue",
  CLOTUREE: "Cloturee",
  REJETEE: "Rejetee",
};

export const LIBELLES_SOURCE_NON_CONFORMITE: Record<string, string> = {
  RECEPTION: "Reception fournisseur",
  PRODUCTION: "Production",
  CONTROLE_FINAL: "Controle final",
  CLIENT: "Retour client",
  INVENTAIRE: "Inventaire",
};

export const LIBELLES_CATEGORIE_PERTE: Record<string, string> = {
  CONSOMMATION_NORMALE: "Consommation normale",
  SURCONSOMMATION: "Surconsommation",
  PERTE_NORMALE: "Perte normale admise",
  PERTE_EXCEPTIONNELLE: "Perte exceptionnelle",
  REBUT: "Rebut",
  REPRISE: "Reprise",
  RETOUR_STOCK: "Retour en stock",
};

export const LIBELLES_MOTIF_PERTE: Record<string, string> = {
  DECOUPE_INCORRECTE: "Decoupe incorrecte",
  ERREUR_DE_MESURE: "Erreur de mesure",
  DEFAUT_MATIERE: "Defaut de matiere",
  DEFAUT_DE_COUTURE: "Defaut de couture",
  DEFAUT_DE_SOUDURE: "Defaut de soudure",
  DEFAUT_DE_PEINTURE: "Defaut de peinture",
  DOMMAGE_MACHINE: "Dommage machine",
  ERREUR_DE_MONTAGE: "Erreur de montage",
  DEFAUT_QUALITE: "Defaut de qualite",
  MATIERE_INUTILISABLE: "Matiere inutilisable",
  CHUTE_NORMALE: "Chute normale",
  AUTRE: "Autre motif",
};

export const LIBELLES_TYPE_DECLARATION: Record<string, string> = {
  DEMARRAGE: "Demarrage",
  PAUSE: "Mise en pause",
  REPRISE: "Reprise",
  PRODUCTION: "Quantite produite",
  CONSOMMATION: "Consommation",
  PERTE: "Perte ou rebut",
  PROBLEME: "Signalement de probleme",
  DEMANDE_CONTROLE: "Demande de controle",
  FIN: "Fin d'operation",
  DEPLACEMENT_KANBAN: "Deplacement Kanban",
};

export const LIBELLES_STATUT_DECLARATION: Record<string, string> = {
  SAISIE: "Saisie",
  SOUMISE: "Soumise",
  VALIDEE: "Validee",
  REJETEE: "Rejetee",
};

export const LIBELLES_STATUT_AFFECTATION: Record<string, string> = {
  PLANIFIEE: "Planifiee",
  EN_COURS: "En cours",
  EN_PAUSE: "En pause",
  TERMINEE: "Terminee",
  ANNULEE: "Annulee",
};

export const LIBELLES_PRESENCE: Record<string, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  RETARD: "Retard",
  CONGE: "Conge",
  MALADIE: "Maladie",
  FERIE: "Jour ferie",
  FORMATION: "Formation",
};

export const LIBELLES_PERIODE_EVALUATION: Record<string, string> = {
  JOUR: "Journaliere",
  SEMAINE: "Hebdomadaire",
  MOIS: "Mensuelle",
};

export const LIBELLES_FIABILITE: Record<string, string> = {
  INSUFFISANTE: "Donnees insuffisantes",
  FAIBLE: "Fiabilite faible",
  MOYENNE: "Fiabilite moyenne",
  BONNE: "Fiabilite bonne",
};

export const LIBELLES_AXE_EVALUATION: Record<string, string> = {
  PRODUCTIVITE: "Productivite",
  QUALITE: "Qualite",
  EFFICACITE_MATIERE: "Efficacite matiere",
  PRESENCE: "Presence",
  POLYVALENCE: "Polyvalence",
};

export const LIBELLES_STATUT_DEVIS: Record<string, string> = {
  BROUILLON: "Brouillon",
  ENVOYE: "Envoye",
  ACCEPTE: "Accepte",
  REFUSE: "Refuse",
  EXPIRE: "Expire",
  CONVERTI: "Converti en commande",
  ANNULE: "Annule",
};

export const LIBELLES_STATUT_COMMANDE_CLIENT: Record<string, string> = {
  BROUILLON: "Brouillon",
  CONFIRMEE: "Confirmee",
  PARTIELLEMENT_PRODUITE: "Partiellement produite",
  PRODUITE: "Produite",
  PARTIELLEMENT_LIVREE: "Partiellement livree",
  LIVREE: "Livree",
  FACTUREE: "Facturee",
  CLOTUREE: "Cloturee",
  ANNULEE: "Annulee",
};

export const LIBELLES_STATUT_LIVRAISON: Record<string, string> = {
  BROUILLON: "Brouillon",
  PREPAREE: "Preparee",
  EXPEDIEE: "Expediee",
  LIVREE: "Livree",
  ANNULEE: "Annulee",
};

export const LIBELLES_STATUT_DEMANDE_ACHAT: Record<string, string> = {
  BROUILLON: "Brouillon",
  SOUMISE: "Soumise",
  APPROUVEE: "Approuvee",
  REFUSEE: "Refusee",
  CONVERTIE: "Convertie en commande",
  ANNULEE: "Annulee",
};

export const LIBELLES_STATUT_COMMANDE_FOURNISSEUR: Record<string, string> = {
  BROUILLON: "Brouillon",
  SOUMIS: "Soumis",
  APPROUVE: "Approuve",
  PARTIELLEMENT_RECU: "Partiellement recu",
  RECU: "Recu",
  FACTURE: "Facture",
  CLOTURE: "Cloture",
  ANNULE: "Annule",
};

export const LIBELLES_STATUT_RECEPTION: Record<string, string> = {
  BROUILLON: "Brouillon",
  EN_CONTROLE_QUALITE: "En controle qualite",
  ACCEPTE: "Accepte",
  PARTIELLEMENT_ACCEPTE: "Partiellement accepte",
  REJETE: "Rejete",
  ANNULE: "Annule",
};

export const LIBELLES_SENS_FACTURE: Record<string, string> = {
  CLIENT: "Client",
  FOURNISSEUR: "Fournisseur",
};

export const LIBELLES_NATURE_FACTURE: Record<string, string> = {
  FACTURE: "Facture",
  AVOIR: "Avoir",
};

export const LIBELLES_STATUT_FACTURE: Record<string, string> = {
  BROUILLON: "Brouillon",
  VALIDEE: "Validee",
  POSTEE: "Comptabilisee",
  PARTIELLEMENT_REGLEE: "Partiellement reglee",
  REGLEE: "Reglee",
  EN_RETARD: "En retard",
  ANNULEE: "Annulee",
};

export const LIBELLES_SENS_REGLEMENT: Record<string, string> = {
  ENCAISSEMENT: "Encaissement",
  DECAISSEMENT: "Decaissement",
};

export const LIBELLES_MODE_REGLEMENT: Record<string, string> = {
  ESPECES: "Especes",
  CHEQUE: "Cheque",
  VIREMENT: "Virement",
  TRAITE: "Traite",
  CARTE: "Carte",
  COMPENSATION: "Compensation",
  AUTRE: "Autre",
};

export const LIBELLES_STATUT_REGLEMENT: Record<string, string> = {
  BROUILLON: "Brouillon",
  VALIDE: "Valide",
  POSTE: "Comptabilise",
  ANNULE: "Annule",
};

export const LIBELLES_TYPE_COMPTE: Record<string, string> = {
  ACTIF: "Actif",
  PASSIF: "Passif",
  CHARGE: "Charge",
  PRODUIT: "Produit",
  TRESORERIE: "Tresorerie",
  CAPITAUX: "Capitaux propres",
};

export const LIBELLES_TYPE_JOURNAL: Record<string, string> = {
  VENTE: "Journal des ventes",
  ACHAT: "Journal des achats",
  BANQUE: "Journal de banque",
  CAISSE: "Journal de caisse",
  STOCK: "Journal des stocks",
  PRODUCTION: "Journal de production",
  OPERATIONS_DIVERSES: "Operations diverses",
  PAIE: "Journal de paie",
};

export const LIBELLES_STATUT_ECRITURE: Record<string, string> = {
  BROUILLON: "Brouillon",
  VALIDEE: "Validee",
  POSTEE: "Comptabilisee",
  EXTOURNEE: "Contrepassee",
};

export const LIBELLES_STATUT_EXERCICE: Record<string, string> = {
  OUVERT: "Ouvert",
  CLOTURE: "Cloture",
};

export const LIBELLES_STATUT_PERIODE: Record<string, string> = {
  OUVERT: "Ouverte",
  CLOTURE: "Cloturee",
};

export const LIBELLES_ENTITE_IMPORT: Record<string, string> = {
  ITEM_FAMILY: "Familles d'articles",
  ITEM: "Articles",
  FORMULA: "Nomenclatures",
  FORMULA_LINE: "Lignes de nomenclature",
  BATCH: "Lots et stocks",
  THIRD_PARTY: "Tiers",
  EMPLOYEE: "Employes",
  SUPPLIER_PRICE: "Tarifs fournisseurs",
  ACCOUNT: "Comptes comptables",
};

export const LIBELLES_STATUT_IMPORT: Record<string, string> = {
  EN_COURS: "En cours",
  TERMINE: "Termine",
  PARTIEL: "Partiel",
  ECHEC: "Echec",
  ANNULE: "Annule",
};

export const LIBELLES_STATUT_ECART_NOMENCLATURE: Record<string, string> = {
  OUVERT: "Ecart ouvert",
  EN_ANALYSE: "En analyse",
  RESOLU: "Resolu",
  ACCEPTE: "Accepte",
};

/** Renvoie le libelle francais d'une valeur, ou la valeur brute si inconnue. */
export function libelle(
  table: Record<string, string>,
  valeur: string | null | undefined,
): string {
  if (!valeur) return "-";
  return table[valeur] ?? valeur;
}

/**
 * Ton d'affichage associe a un statut, utilise par les etiquettes colorees.
 * Le ton reste purement visuel : il ne remplace jamais un libelle explicite.
 */
export type TonEtiquette = "neutre" | "succes" | "alerte" | "danger" | "info" | "primaire";

const TONS_STATUTS: Record<string, TonEtiquette> = {
  // Termine / valide
  ACTIF: "succes",
  ACCEPTE: "succes",
  ACCEPTE_SOUS_RESERVE: "alerte",
  ACCEPTEE: "succes",
  APPROUVE: "succes",
  APPROUVEE: "succes",
  ACTIVE: "succes",
  CLOTURE: "neutre",
  CLOTUREE: "neutre",
  CONFORME: "succes",
  CONFIRMEE: "info",
  CONVERTI: "info",
  CONVERTIE: "info",
  FACTURE: "info",
  FACTUREE: "info",
  LIVREE: "succes",
  POSTE: "succes",
  POSTEE: "succes",
  PRODUITE: "succes",
  RECU: "succes",
  REGLEE: "succes",
  RESOLUE: "succes",
  TERMINE: "succes",
  TERMINEE: "succes",
  VALIDE: "succes",
  VALIDEE: "succes",

  // En cours / intermediaire
  BROUILLON: "neutre",
  EN_ANALYSE: "info",
  EN_CONTROLE_QUALITE: "alerte",
  EN_COURS: "info",
  EN_COURS_PRODUCTION: "info",
  EN_PAUSE: "alerte",
  EN_REPRISE: "alerte",
  EN_VALIDATION: "alerte",
  ENVOYE: "info",
  EXPEDIEE: "info",
  LIBRE: "succes",
  NON_DEMARREE: "neutre",
  PARTIELLEMENT_ACCEPTE: "alerte",
  PARTIELLEMENT_LIVREE: "alerte",
  PARTIELLEMENT_PRODUITE: "alerte",
  PARTIELLEMENT_RECU: "alerte",
  PARTIELLEMENT_REGLEE: "alerte",
  PARTIELLEMENT_TERMINE: "alerte",
  PLANIFIE: "info",
  PLANIFIEE: "info",
  PREPAREE: "info",
  QUARANTAINE: "alerte",
  RECEPTION: "info",
  SAISIE: "neutre",
  SOUMIS: "info",
  SOUMISE: "info",
  SOUMISE_: "info",

  // Blocage / probleme
  ABSENT: "danger",
  ANNULE: "danger",
  ANNULEE: "danger",
  ARCHIVE: "neutre",
  ARCHIVEE: "neutre",
  BLOQUE: "danger",
  ECHEC: "danger",
  EN_RETARD: "danger",
  EXPIRE: "danger",
  INACTIF: "neutre",
  INSUFFISANTE: "danger",
  MALADIE: "alerte",
  NON_CONFORME: "danger",
  NON_COMMERCIALISABLE: "alerte",
  NON_PRODUCTIBLE: "alerte",
  OUVERTE: "danger",
  PERTE: "danger",
  REBUT: "danger",
  REFUSE: "danger",
  REFUSEE: "danger",
  REJETE: "danger",
  REJETEE: "danger",
  RETARD: "alerte",
  SUSPENDU: "alerte",
  URGENTE: "danger",
  EXTOURNEE: "danger",
  REMPLACEE: "neutre",
};

export function tonStatut(valeur: string | null | undefined): TonEtiquette {
  if (!valeur) return "neutre";
  return TONS_STATUTS[valeur] ?? "neutre";
}
