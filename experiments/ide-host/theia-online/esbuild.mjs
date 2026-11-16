// Minimal browser-only Theia app. Theia CLI generates this module's imports.
// Keep build configuration isolated from the current GitHub Pages demo.
import {browserOptions,watch} from "./gen-esbuild.browser.mjs";
import esbuild from "esbuild";
const context=await esbuild.context(browserOptions);
if(watch){await context.watch();}
else{try{await context.rebuild();await context.dispose();}
catch(error){console.error(error);process.exitCode=1;}}
