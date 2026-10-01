import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/**
 * Client Prisma unique pour toute l'application.
 * En developpement, Next.js recharge les modules : on reutilise l'instance
 * globale pour ne pas saturer les connexions PostgreSQL.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Reconnait une base de donnees injoignable (conteneur Docker arrete,
 * PostgreSQL eteint, port 5433 ferme...).
 *
 * Sans ce test, Prisma remonte une erreur d'infrastructure que le contrat
 * d'action traduit en « une erreur inattendue est survenue » : l'operateur ne
 * dispose alors d'aucune piste, alors que la cause est connue et se corrige en
 * une commande. Le diagnostic est donc fait ici, une fois pour toute
 * l'application.
 */
export function baseInjoignable(erreur: unknown): boolean {
  if (erreur instanceof Prisma.PrismaClientInitializationError) return true;

  if (erreur instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P1000", "P1001", "P1002", "P1003", "P1008", "P1010", "P1017"].includes(
      erreur.code,
    );
  }

  const message = erreur instanceof Error ? erreur.message : "";
  return (
    message.includes("Can't reach database server") ||
    message.includes("ECONNREFUSED") ||
    message.includes("Connection refused")
  );
}

/** Client transactionnel transmis aux services metier. */
export type Tx = Prisma.TransactionClient;

/** Accepte soit le client global, soit une transaction en cours. */
export type Db = PrismaClient | Tx;

export { Prisma };
export default prisma;
