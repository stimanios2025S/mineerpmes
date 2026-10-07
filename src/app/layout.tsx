import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Racine de l'application ERP + MES ADMEDCO / MOBILIX.
 * La langue de reference est le francais (fr-FR) : elle est declaree ici et
 * toutes les valeurs affichees sont mises en forme selon les conventions
 * francaises (dates, nombres, montants, pourcentages).
 */
export const metadata: Metadata = {
  title: {
    default: "ERP MES",
    template: "%s - ERP MES",
  },
  description:
    "Plateforme de gestion industrielle et commerciale.",
  applicationName: "ERP MES",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr-FR">
      <body>{children}</body>
    </html>
  );
}
