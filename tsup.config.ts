import { defineConfig } from 'tsup';

/**
 * Builds the two committed entry points:
 *   - `dist/index.js` — the GitHub Action (`node20`, see action.yml)
 *   - `dist/cli.js`   — the local CLI (`bin.payfuzz` in package.json)
 *
 * Everything is bundled (`noExternal`): a `node20` Action is started with plain `node dist/index.js`,
 * so there is no `npm install` step on the runner and nothing may be resolved from node_modules.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  outDir: 'dist',
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  bundle: true,
  splitting: false,
  clean: true,
  sourcemap: false,
  minify: false,
  noExternal: [/.*/],
});
