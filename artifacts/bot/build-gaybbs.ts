import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints:["src/gaybbsBot.ts"],
  bundle:true,
  platform:"node",
  target:"node20",
  format:"esm",
  outfile:"dist/gaybbs.mjs",
  external:["pg-native"],
  packages:"bundle",
  banner:{js:"import { createRequire } from 'module'; const require = createRequire(import.meta.url);"},
});
console.log("GayBBS standalone Bot build complete.");
