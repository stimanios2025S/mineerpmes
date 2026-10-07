"use client";

/**
 * Filet de dernier recours : rendu lorsque le layout racine lui-meme echoue.
 *
 * Ce fichier remplace le layout racine, il doit donc fournir <html> et <body>,
 * et il ne peut pas compter sur globals.css : les styles sont en ligne.
 */
export default function ErreurGlobale({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          background: "#f4f6f9",
          color: "#16202c",
        }}
      >
        <main
          style={{
            display: "flex",
            minHeight: "100vh",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "32rem",
              background: "#ffffff",
              border: "1px solid #d8dee8",
              borderRadius: "8px",
              padding: "24px",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: "0.75rem",
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "#99241f",
              }}
            >
              Erreur inattendue
            </p>
            <h1 style={{ margin: "4px 0 0", fontSize: "1.5rem" }}>
              La plateforme n&apos;a pas pu demarrer cette page
            </h1>
            <p style={{ margin: "12px 0 0", fontSize: "0.875rem", color: "#5a6675" }}>
              L&apos;incident a ete journalise sur le serveur. Reessayez ; si le probleme
              persiste, transmettez la reference ci-dessous a l&apos;administration.
            </p>
            {error.digest ? (
              <p
                style={{
                  margin: "12px 0 0",
                  fontSize: "0.75rem",
                  fontFamily: "monospace",
                  color: "#5a6675",
                }}
              >
                Reference : {error.digest}
              </p>
            ) : null}
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: "20px",
                minHeight: "42px",
                padding: "0 16px",
                borderRadius: "8px",
                border: "1px solid #b9c3d2",
                background: "#ffffff",
                color: "#16202c",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reessayer
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
