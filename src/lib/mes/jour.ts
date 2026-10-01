/**
 * Fuseau metier de la plateforme.
 *
 * « Aujourd'hui », les bornes d'un programme de travail et la date d'une
 * affectation ne se deduisent JAMAIS du fuseau du serveur ni de celui du
 * navigateur : un operateur en atelier et un serveur heberge ailleurs ne
 * doivent pas vivre deux journees differentes.
 *
 * Le fuseau est celui de l'usine : Africa/Algiers (UTC+1, sans heure d'ete).
 * L'implementation reste generique : elle lit le decalage reel a l'instant
 * considere, donc elle resterait juste si le fuseau venait a changer.
 */

export const FUSEAU_METIER = "Africa/Algiers";

const NOMBRE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU_METIER,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Decalage du fuseau metier par rapport a UTC, en millisecondes, a cet instant. */
export function decalageMetier(instant: Date): number {
  const parties = NOMBRE.formatToParts(instant);
  const lire = (type: Intl.DateTimeFormatPartTypes): number => {
    const trouve = parties.find((partie) => partie.type === type);
    return trouve ? Number(trouve.value) : 0;
  };

  const commeSiUTC = Date.UTC(
    lire("year"),
    lire("month") - 1,
    lire("day"),
    lire("hour"),
    lire("minute"),
    lire("second"),
  );

  return commeSiUTC - instant.getTime();
}

/** Date civile du fuseau metier, au format `AAAA-MM-JJ`. */
export function jourMetier(instant: Date = new Date()): string {
  const local = new Date(instant.getTime() + decalageMetier(instant));
  const mois = String(local.getUTCMonth() + 1).padStart(2, "0");
  const jour = String(local.getUTCDate()).padStart(2, "0");
  return `${local.getUTCFullYear()}-${mois}-${jour}`;
}

/** Minuit local du fuseau metier, exprime en instant absolu. */
export function minuitMetier(instant: Date = new Date()): Date {
  const decalage = decalageMetier(instant);
  const local = new Date(instant.getTime() + decalage);
  const minuitLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  return new Date(minuitLocal - decalage);
}

export interface BornesJour {
  /** Minuit local, inclus. */
  debut: Date;
  /** Minuit local du lendemain, exclu. */
  fin: Date;
  /** Date civile `AAAA-MM-JJ` telle qu'un operateur la lit. */
  jour: string;
}

export function bornesJour(reference: Date = new Date()): BornesJour {
  const debut = minuitMetier(reference);
  return {
    debut,
    fin: new Date(debut.getTime() + 24 * 3600 * 1000),
    jour: jourMetier(reference),
  };
}

/**
 * Bornes d'une semaine de travail : du lundi minuit au lundi suivant minuit,
 * toujours dans le fuseau metier.
 */
export function bornesSemaine(reference: Date = new Date()): BornesJour & { jours: string[] } {
  const decalage = decalageMetier(reference);
  const local = new Date(reference.getTime() + decalage);
  // getUTCDay : 0 = dimanche. On recule jusqu'au lundi.
  const rang = (local.getUTCDay() + 6) % 7;
  const lundiLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - rang,
  );
  const debut = new Date(lundiLocal - decalage);
  const jours: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    jours.push(jourMetier(new Date(debut.getTime() + index * 24 * 3600 * 1000)));
  }
  return {
    debut,
    fin: new Date(debut.getTime() + 7 * 24 * 3600 * 1000),
    jour: jours[0],
    jours,
  };
}

/**
 * Date civile du fuseau metier, sous la forme attendue par une colonne
 * PostgreSQL `@db.Date` : minuit UTC du jour civil.
 *
 * A utiliser pour tout filtre `date: ...` sur un champ `@db.Date`
 * (`Assignment.date`, `WorkSchedule.periodStart`...). C'est deterministe :
 * contrairement a un intervalle de un a l'autre minuit, le resultat ne depend
 * ni du fuseau du serveur, ni de celui de la session PostgreSQL.
 */
export function jourCivilMetier(instant: Date = new Date()): Date {
  const [annee, mois, jour] = jourMetier(instant).split("-").map(Number);
  return new Date(Date.UTC(annee, mois - 1, jour));
}

/** Date civile obtenue en decalant de `jours` jours, dans le fuseau metier. */
export function jourCivilDecale(
  instant: Date,
  jours: number,
): Date {
  const base = jourCivilMetier(instant);
  return new Date(base.getTime() + jours * 24 * 3600 * 1000);
}

/**
 * Numero de semaine ISO et annee ISO, dans le fuseau metier.
 * Sert a numeroter un programme hebdomadaire de facon stable et lisible.
 */
export function semaineIso(reference: Date = new Date()): {
  annee: number;
  semaine: number;
} {
  const debut = bornesSemaine(reference).debut;
  // Le jeudi de la semaine determine l'annee ISO.
  const jeudi = new Date(debut.getTime() + 3 * 24 * 3600 * 1000);
  const decalage = decalageMetier(jeudi);
  const local = new Date(jeudi.getTime() + decalage);
  const annee = local.getUTCFullYear();

  const premierJeudi = new Date(Date.UTC(annee, 0, 4));
  const decalagePremier = decalageMetier(premierJeudi);
  const premierJeudiLocal = new Date(premierJeudi.getTime() + decalagePremier);
  const rang = (premierJeudiLocal.getUTCDay() + 6) % 7;
  const lundiSemaine1 = Date.UTC(
    premierJeudiLocal.getUTCFullYear(),
    premierJeudiLocal.getUTCMonth(),
    premierJeudiLocal.getUTCDate() - rang,
  );

  const lundiCourant = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - ((local.getUTCDay() + 6) % 7),
  );

  const semaine =
    Math.round((lundiCourant - lundiSemaine1) / (7 * 24 * 3600 * 1000)) + 1;

  return { annee, semaine };
}

/**
 * Instant correspondant a une heure d'atelier (`HH:MM`) un jour civil donne,
 * dans le fuseau metier.
 *
 * Une heure saisie par un responsable est une heure locale d'usine, pas une
 * heure UTC : `08:30` doit rester `08:30` a l'atelier quelle que soit l'heure du
 * serveur. Le calcul se fait en deux passes, car le decalage depend de
 * l'instant et l'instant depend du decalage.
 */
export function instantMetier(jour: string, heure: string): Date | null {
  const [annee, mois, jourDuMois] = jour.split("-").map(Number);
  const [hh, mm] = heure.split(":").map(Number);

  if (![annee, mois, jourDuMois, hh, mm].every((valeur) => Number.isFinite(valeur))) {
    return null;
  }
  if (
    annee < 1900 ||
    mois < 1 ||
    mois > 12 ||
    jourDuMois < 1 ||
    jourDuMois > 31 ||
    hh < 0 ||
    hh > 23 ||
    mm < 0 ||
    mm > 59
  ) {
    return null;
  }

  const heureMurale = Date.UTC(annee, mois - 1, jourDuMois, hh, mm);
  const premier = new Date(heureMurale - decalageMetier(new Date(heureMurale)));
  return new Date(heureMurale - decalageMetier(premier));
}

/**
 * Une tache est-elle due maintenant ? Sert au programme affiche apres un scan :
 * on montre ce qui est prevu pour la journee metier, pas pour la journee du
 * serveur.
 */
export function estAujourdHui(instant: Date, reference: Date = new Date()): boolean {
  return jourMetier(instant) === jourMetier(reference);
}
