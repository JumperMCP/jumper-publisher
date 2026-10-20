import { access, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { compareVersions } from "../src/releases";
// One command per release: bump, test, build, sign, publish to the channel, commit.
// Usage: RELEASE_SIGNING_KEY_FILE=… npm run ship -- 0.1.19 [--skip-tests]
// Pushing and deploying the installer stay manual; the script prints them at the end.
const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith("--")) ?? "";
const skipTests = args.includes("--skip-tests");
const run = (command: string, ...rest: string[]) =>
  execFileSync(command, rest, { stdio: "inherit" });
const git = (...rest: string[]) =>
  execFileSync("git", rest, { encoding: "utf8" }).trim();

// Every check runs before the first file changes.
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Usage: npm run ship -- <version>, e.g. 0.1.19");
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (compareVersions(version, pkg.version) <= 0)
  throw new Error(`${version} must be newer than ${pkg.version}.`);
if (git("status", "--porcelain"))
  throw new Error("Commit or stash your changes first.");
const keyPath = process.env.RELEASE_SIGNING_KEY_FILE;
if (
  !keyPath ||
  !(await access(keyPath).then(
    () => true,
    () => false,
  ))
)
  throw new Error(
    "Set RELEASE_SIGNING_KEY_FILE to your Ed25519 PEM signing key.",
  );
const notes = await readFile("docs/release-notes.md", "utf8");
if (!notes.startsWith(`# ${version} `))
  throw new Error(
    `docs/release-notes.md must start with "# ${version} — <summary>". Every update shows these notes for review.`,
  );

const previous = pkg.version;
pkg.version = version;
await writeFile("package.json", JSON.stringify(pkg, null, 2) + "\n");
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
lock.version = lock.packages[""].version = version;
await writeFile("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
const wrangler = await readFile("wrangler.jsonc", "utf8");
const bumped = wrangler.replace(
  /"RELEASE_VERSION": "[^"]+"/,
  `"RELEASE_VERSION": "${version}"`,
);
if (bumped === wrangler)
  throw new Error("RELEASE_VERSION not found in wrangler.jsonc.");
await writeFile("wrangler.jsonc", bumped);

try {
  run("npm", "run", "check");
  run("npm", "run", "build");
  if (!skipTests) run("npm", "test");
} catch (error) {
  git("checkout", "--", "package.json", "package-lock.json", "wrangler.jsonc");
  console.error(
    `Stopped before committing; the version is back to ${previous}.`,
  );
  throw error;
}
git("add", "package.json", "package-lock.json", "wrangler.jsonc");
git("commit", "-m", `Bump Publisher to ${version}`);
try {
  // release.ts signs dist/worker.js and records HEAD, so build from the committed tree.
  run("npm", "run", "build");
  run("npm", "run", "release");
  run("npm", "run", "publish-release");
  // Checks every published release against RELEASE_PUBLIC_KEY, so a wrong key stops here.
  run("node", "--import", "tsx", "--test", "tests/distribution.test.ts");
} catch (error) {
  console.error(
    `Signing or publishing failed after the bump commit. To retry: git reset --hard HEAD~1 && rm -rf public/releases/${version}, then run ship again.`,
  );
  throw error;
}
git("add", "public/releases");
git("commit", "-m", `Publish Publisher ${version}`);
console.log(`
Publisher ${version} is signed, on the channel and committed. Next:
  git push
  npx wrangler deploy --config wrangler.installer.jsonc
Then use Check for updates in each Publisher.`);
