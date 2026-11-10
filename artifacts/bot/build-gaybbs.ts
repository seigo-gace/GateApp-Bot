import * as esbuild from "esbuild";

const banner={
  js:"import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
};
const opts={bundle:true,platform:"node" as const,target:"node20",format:"esm" as const,
  external:["pg-native"],packages:"bundle" as const,banner};
await esbuild.build({...opts,entryPoints:["src/gaybbsBot.ts"],outfile:"dist/gaybbs.mjs"});
await esbuild.build({...opts,entryPoints:["scripts/publishMenuPanels.ts"],outfile:"dist/publishMenuPanels.mjs"});
await esbuild.build({...opts,entryPoints:["scripts/recordPhaseADmEvidence.ts"],outfile:"dist/recordPhaseADmEvidence.mjs"});
await esbuild.build({...opts,entryPoints:["scripts/publishTopicBoards.ts"],outfile:"dist/publishTopicBoards.mjs"});
console.log("GayBBS standalone Bot build complete.");
