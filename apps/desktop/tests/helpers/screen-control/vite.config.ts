import { mergeConfig } from "vite";
import config from "../../../vite.config";
export default mergeConfig(typeof config === "function" ? config({ mode: "development", command: "serve", isSsrBuild: false, isPreview: false }) : config, {
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
});
