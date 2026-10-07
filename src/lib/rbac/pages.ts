import type { Factory } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { DomainError } from "@/lib/errors";
import { exigerPermissionEtUsine } from "./guard";

/** Refuse une page hors usine avant toute lecture metier. */
export async function exigerPageUsine(permission: string, usine: Factory) {
  try {
    return await exigerPermissionEtUsine(permission, usine);
  } catch (erreur) {
    if (erreur instanceof DomainError) {
      if (erreur.code === "NON_AUTHENTIFIE") redirect("/connexion");
      if (erreur.code === "ACCES_REFUSE") notFound();
    }
    throw erreur;
  }
}
