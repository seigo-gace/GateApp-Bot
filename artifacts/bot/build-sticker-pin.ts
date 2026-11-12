import * as esbuild from "esbuild";
await esbuild.build({
 entryPoints:["scripts/ensureStickerTopicPin.ts"],
 bundle:true,platform:"node",target:"node20",format:"esm",
 outfile:"dist/sticker-topic-pin.mjs",external:["pg-native"],
 packages:"bundle",
 banner:{js:"import { createRequire } from 'module'; const require = createRequire(import.meta.url);"}
});
console.log("Sticker topic pin one-shot CLI build complete.");
