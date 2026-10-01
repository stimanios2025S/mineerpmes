/**
 * Bocal de cookies en memoire utilise par les tests d'authentification.
 *
 * Les services d'authentification ecrivent et lisent le cookie de session via
 * `next/headers`, qui n'existe pas hors d'une requete Next.js. Les tests
 * remplacent uniquement ce module : le hachage, le verrouillage de compte, la
 * creation de session et le journal d'audit s'executent ensuite pour de vrai
 * contre la base PostgreSQL.
 */

const bocal = new Map<string, string>();

export { bocal };

export function viderBocal(): void {
  bocal.clear();
}
