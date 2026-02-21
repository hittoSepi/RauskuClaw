import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { execSync } from "node:child_process";

const FILE = path.resolve("docs/milestones.yml");

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const flags = {
  dryRun: hasFlag("--dry-run"),
  commit: hasFlag("--commit"),
  push: hasFlag("--push"),
};

function sh(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function shOut(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function headShaShort() {
  return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
}

function load() {
  const data = YAML.parse(fs.readFileSync(FILE, "utf8"));
  if (!Array.isArray(data?.milestones)) die("milestones[] missing in YAML");
  return data;
}

function save(data) {
  fs.writeFileSync(FILE, YAML.stringify(data, { lineWidth: 120 }), "utf8");
}

function completeFromYaml(data) {
  const ms = data.milestones;
  const curr = ms.find((m) => m.status === "current");
  if (!curr) die("No current milestone (status: current).");

  if (curr.commits == null) curr.commits = [];

  if (typeof curr.commits === "string") {
    die(
      "commits must be a YAML list, not a string. Example:\n" +
        "commits:\n" +
        "  - 11c31de\n" +
        "  - 76c2d9a\n"
    );
  }
  if (!Array.isArray(curr.commits)) die("commits must be a YAML list (array).");
  if (curr.commits.some((x) => typeof x !== "string"))
    die("commits must be a list of strings.");

  const sha = headShaShort();
  if (!curr.commits.includes(sha)) curr.commits.push(sha);
  curr.status = "done";

  const next =
    ms
      .filter((m) => m.id > curr.id && m.status !== "done" && m.status !== "dropped")
      .sort((a, b) => a.id - b.id)[0] || null;

  if (next) next.status = "current";

  // merkkaa myös seuraava “next”:ksi (pelkkä label UI:lle / plannerille)
  const afterNext =
    next
      ? ms
          .filter((m) => m.id > next.id && m.status !== "done" && m.status !== "dropped")
          .sort((a, b) => a.id - b.id)[0] || null
      : null;

  if (afterNext && afterNext.status !== "current") afterNext.status = "next";

if (next) data.current = next.id;

  return { completed: curr, promoted: next };
}

const cmd = process.argv[2];
if (!cmd) die("Usage: node scripts/milestone.mjs <complete> [--dry-run] [--commit] [--push]");

const data = load();

if (cmd === "complete") {
  // Preview
  const previewData = structuredClone(data);
  const preview = completeFromYaml(previewData);

  if (flags.dryRun) {
    console.log(`[dry-run] Would complete M${preview.completed.id}: ${preview.completed.title}`);
    if (preview.promoted)
      console.log(`[dry-run] Would promote M${preview.promoted.id}: ${preview.promoted.title}`);
    console.log("[dry-run] Would update: docs/milestones.yml, docs/MILESTONES.md");
    if (flags.commit) console.log("[dry-run] Would git add + commit docs files");
    if (flags.push) console.log("[dry-run] Would git push");
    process.exit(0);
  }

  // Apply
  const real = completeFromYaml(data);
  save(data);
  
  console.log(`Completed M${real.completed.id}: ${real.completed.title}`);
  if (real.promoted) console.log(`Now current M${real.promoted.id}: ${real.promoted.title}`);

  // Generate docs after state change
  sh("node scripts/docs-gen.mjs");

  if (flags.commit) {
    const status = shOut("git status --porcelain");
    const lines = status ? status.split("\n").filter(Boolean) : [];

    // porcelain format: "XY path"
    const changedFiles = lines.map(l => l.slice(3)).map(p => p.trim());

    const allowed = new Set(["docs/milestones.yml", "docs/MILESTONES.md"]);
    const bad = changedFiles.filter(f => !allowed.has(f));

    if (bad.length) {
        die(
            "Refusing to auto-commit because non-doc files are changed/untracked:\n" +
            bad.map(f => `- ${f}`).join("\n")
        );
    }

    sh("git add docs/milestones.yml docs/MILESTONES.md");

    const msg = real.promoted
      ? `docs: complete M${real.completed.id} + promote M${real.promoted.id}`
      : `docs: complete M${real.completed.id}`;

    const staged = shOut("git diff --cached --name-only");
    if (!staged) {
      console.log("No staged changes to commit.");
    } else {
      sh(`git commit -m "${msg.replace(/"/g, '\\"')}"`);
    }

    if (flags.push) sh("git push");

  
  }
} else {
  die(`Unknown cmd: ${cmd}`);
}