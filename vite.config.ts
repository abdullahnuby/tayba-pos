import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { kvDataAdapter } from "@vinext/cloudflare/cache/kv-data-adapter";

export default defineConfig({
  plugins: [
    tailwindcss(),

    vinext({
      cache: {
        data: kvDataAdapter({
          appPrefix: "tayba-pos",
        }),
      },
    }),

    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});