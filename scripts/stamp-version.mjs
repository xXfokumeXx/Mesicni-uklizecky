// Před nasazením (L-60): doplní do js/version.js BUILD (zkrácený hash commitu) a DATE (teď)
// a zapíše version.json do kořene webu. Spuštění z kořene projektu:  node scripts/stamp-version.mjs
// (VERSION a NET_PROTOCOL se mění ručně v js/version.js.)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'js', 'version.js');
let src = fs.readFileSync(file, 'utf8');

let build = 'dev';
try { build = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'; } catch { /* bez gitu */ }
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

const set = (name, value) => {
  const re = new RegExp(`(export const ${name} = )'[^']*'`);
  if (!re.test(src)) throw new Error(`V js/version.js chybí ${name}`);
  src = src.replace(re, (_, a) => `${a}'${value}'`);
};
set('BUILD', build);
set('DATE', date);
fs.writeFileSync(file, src);

const version = /export const VERSION = '([^']+)'/.exec(src)[1];
const np = Number(/export const NET_PROTOCOL = (\d+)/.exec(src)[1]);
fs.writeFileSync(path.join(root, 'version.json'), `${JSON.stringify({ version, build, date, np })}\n`);
console.log(`Verze ${version} · build ${build} · ${date} (protokol ${np}) → js/version.js, version.json`);
