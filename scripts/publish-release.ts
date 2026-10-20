import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
// Archives the signed release from dist/ into its immutable numbered folder and makes it
// the release channel's current version (public/releases/ root). Run after `npm run release`.
const FILES = ["release.json", "worker.js", "SHA256SUMS"];
const { manifest } = JSON.parse(await readFile("dist/release.json", "utf8"));
const version: string = manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error(`Unexpected release version ${version}.`);
const folder = `public/releases/${version}`;
if (await stat(folder).catch(() => null))
  throw new Error(`${folder} exists. Release folders are immutable.`);
await mkdir(folder);
for (const file of FILES) {
  await copyFile(`dist/${file}`, `${folder}/${file}`);
  await copyFile(`dist/${file}`, `public/releases/${file}`);
}
console.log(`Archived ${folder} and made ${version} the channel release.`);
