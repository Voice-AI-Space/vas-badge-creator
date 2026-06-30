import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base: "./" emits relative asset paths so the build works under any GitHub
// Pages subpath (e.g. https://user.github.io/<repo>/) without further config.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
});
