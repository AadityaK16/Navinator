import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "monaco-editor-css": fileURLToPath(
        new URL("./node_modules/monaco-editor/min/vs/editor/editor.main.css", import.meta.url),
      ),
    },
  },
  worker: { format: "es" },
  server: {
    host: "0.0.0.0",
    port: 43123,
  },
});
