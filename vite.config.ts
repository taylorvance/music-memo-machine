import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.API_PORT || "3001";
const webPort = Number(process.env.WEB_PORT || 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    allowedHosts: ["tvmini"],
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
      "/media": `http://127.0.0.1:${apiPort}`
    }
  }
});
