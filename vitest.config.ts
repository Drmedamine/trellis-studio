import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Hors de Next, « server-only » lève une erreur dès l'import : les tests
      // prennent sa version vide, celle que Next sert au serveur.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: { environment: "node", testTimeout: 60_000 },
});
