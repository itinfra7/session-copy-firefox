import esbuild from 'esbuild';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import vue from 'unplugin-vue/esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const isWatch = process.argv.includes('--watch');
const isRelease = process.argv.includes('--release');
/** Test build adds tests/harness (exposes core modules to the e2e runner). Never ship it. */
const isTest = process.argv.includes('--test');
const outDir = path.join(rootDir, isTest ? 'dist-test' : 'dist');

const esbuildCommon = {
  bundle: true,
  sourcemap: !isRelease,
  minify: isRelease,
  target: 'firefox140',
  platform: 'browser',
  legalComments: 'none',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' }
};

/** Icons (manifest) + popup logo only. */
async function copyExtensionAssets() {
  await fs.copy(path.join(rootDir, 'assets', 'icons'), path.join(outDir, 'assets', 'icons'));
  await fs.copy(
    path.join(rootDir, 'assets', 'images', 'logo512.png'),
    path.join(outDir, 'assets', 'images', 'logo512.png')
  );
}

async function writeDistManifest() {
  const pkgJson = await fs.readJson(path.join(rootDir, 'package.json'));
  const manifest = await fs.readJson(path.join(rootDir, 'manifest.json'));
  manifest.version = pkgJson.version;
  await fs.writeJson(path.join(outDir, 'manifest.json'), manifest, { spaces: 2 });
  console.log(`Manifest version -> ${pkgJson.version}${isRelease ? ' (release)' : ''}`);
  return pkgJson.version;
}

/** dist/popup/popup.css = brand popup shell (tokens + base) + extension-only app.css */
async function writePopupCss() {
  const brandCss = await fs.readFile(require.resolve('@makogai/extension-brand/popup.css'), 'utf8');
  const appCss = await fs.readFile(path.join(rootDir, 'src/popup/app.css'), 'utf8');
  await fs.outputFile(
    path.join(outDir, 'popup', 'popup.css'),
    `${brandCss.trimEnd()}\n\n${appCss.trimStart()}`
  );
}

async function copyStaticFiles() {
  if (!isWatch) {
    await fs.emptyDir(outDir);
  }
  await fs.ensureDir(outDir);

  await writeDistManifest();
  await copyExtensionAssets();
  await fs.copy(path.join(rootDir, 'changelog'), path.join(outDir, 'changelog'));
  await writePopupCss();

  await fs.copy(path.join(rootDir, 'src/popup/popup.html'), path.join(outDir, 'popup/popup.html'));
  await fs.copy(path.join(rootDir, 'src/import/import.html'), path.join(outDir, 'import/import.html'));
  if (isTest) {
    await fs.copy(path.join(rootDir, 'tests/harness/harness.html'), path.join(outDir, 'harness/harness.html'));
  }

  await fs.copy(path.join(rootDir, 'LICENSE'), path.join(outDir, 'LICENSE'));
  console.log('Static files copied');
}

async function buildJs() {
  const entryPoints = {
    background: path.join(rootDir, 'src/background.js'),
    'popup/popup': path.join(rootDir, 'src/popup/main.ts'),
    'import/import': path.join(rootDir, 'src/import/main.ts')
  };
  if (isTest) {
    entryPoints['harness/harness'] = path.join(rootDir, 'tests/harness/harness.js');
  }

  const config = {
    ...esbuildCommon,
    plugins: [vue()],
    entryPoints,
    outdir: outDir
  };

  if (isWatch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log('Watching for changes...');

    const pkgPath = path.join(rootDir, 'package.json');
    let pkgTimer;
    fs.watch(pkgPath, () => {
      clearTimeout(pkgTimer);
      pkgTimer = setTimeout(() => {
        void writeDistManifest().then((v) => {
          console.log(`package.json changed — reload the add-on in about:debugging (v${v})`);
        });
      }, 80);
    });
  } else {
    await esbuild.build(config);
    console.log('JavaScript bundled');
  }
}

async function main() {
  try {
    await copyStaticFiles();
    await buildJs();
    console.log(`Build complete -> ${outDir}`);
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

main();
