import fs from 'fs';

// tsc compiles only .ts → build/; it does not copy bundled binary assets. The
// gig-pitch footer photo (web-jam-back#823) is read from disk at send time, so
// it has to be present under build/. Copy the template assets dir after every
// compile (wired into `dev` and `postinstall`). Idempotent.
const src = 'src/model/template/assets';
const dest = 'build/src/model/template/assets';

if (fs.existsSync(src)) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  // eslint-disable-next-line no-console
  console.log(`copied ${src} -> ${dest}`);
}

const mapSrc = 'docs/system-map.mmd';
const mapDest = 'build/docs/system-map.mmd';

if (fs.existsSync(mapSrc)) {
  fs.mkdirSync('build/docs', { recursive: true });
  fs.cpSync(mapSrc, mapDest);
  // eslint-disable-next-line no-console
  console.log(`copied ${mapSrc} -> ${mapDest}`);
}

