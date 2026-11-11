// Theia CLI generates the browser build options before invoking this script.
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { browserOptions, watch } from './gen-esbuild.browser.mjs';

// Local file: extensions resolve from their source directory. Resolve their
// Theia imports against the same installation as the generated application.
const options = {
  ...browserOptions,
  nodePaths: [
    ...(browserOptions.nodePaths ?? []),
    fileURLToPath(new URL('./node_modules/', import.meta.url)),
  ],
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
