/**
 * Configuration PM2 dediee a l'ERP MES.
 *
 * Cette configuration ne modifie pas les autres applications du serveur.
 * Elle utilise un nom de processus et un port explicites afin d'eviter tout
 * conflit avec un serveur Next.js deja en execution.
 */
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.ERPMES_PORT || 3000);

module.exports = {
  apps: [
    {
      name: "erpmes",
      script: path.join(root, "node_modules", "next", "dist", "bin", "next"),
      args: ["start", "-p", String(port)],
      cwd: root,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 3000,
      max_memory_restart: "768M",
      kill_timeout: 10000,
      env: {
        NODE_ENV: "production",
        PORT: String(port),
      },
      env_production: {
        NODE_ENV: "production",
        PORT: String(port),
      },
      out_file: path.join(root, "logs", "erpmes.out.log"),
      error_file: path.join(root, "logs", "erpmes.err.log"),
      merge_logs: true,
      time: true,
    },
  ],
};
