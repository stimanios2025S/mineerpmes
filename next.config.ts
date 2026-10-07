import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  experimental: {
    // Interruptions d'authentification : `forbidden()` et `unauthorized()`
    // interrompent le rendu et affichent les pages dediees (403 / 401) au lieu
    // de laisser remonter une erreur brute jusqu'a la page d'erreur de Next.js.
    authInterrupts: true,
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
