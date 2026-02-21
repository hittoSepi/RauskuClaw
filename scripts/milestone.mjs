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

  // clear stale next labels + extra current labels
  for (const m of ms) {
    if (m.status === "next") m.status = "planned";
    if (m !== curr && m.status === "current") m.status = "planned";
  }

  if (curr.commits == null) curr.commits = [];

  // ... (sun commits-validoinnit)

  const sha = headShaShort();
  if (!curr.commits.includes(sha)) curr.commits.push(sha);
  curr.status = "done";

  const next =
    ms
      .filter((m) => m.id > curr.id && m.status !== "done" && m.status !== "dropped")
      .sort((a, b) => a.id - b.id)[0] || null;

  if (next) {
    next.status = "current";
    data.current = next.id;
  } else {
    console.warn(`No next milestone to promote after M${curr.id}.`);
  }

  return { completed: curr, promoted: next };
}

function logFromYaml(data) {
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
  const added = !curr.commits.includes(sha);
  if (added) curr.commits.push(sha);

  return { current: curr, sha, added };
}


const cmd = process.argv[2];
if (!cmd) die("Usage: node scripts/milestone.mjs <log|complete> [--dry-run] [--commit] [--push]");

const data = load();


// Milestone partly completed
if (cmd === "log") {
  const previewData = structuredClone(data);
  const preview = logFromYaml(previewData);

  if (flags.dryRun) {
    console.log(
      `[dry-run] Would ${preview.added ? "add" : "keep"} ${preview.sha} in M${preview.current.id}: ${preview.current.title}`
    );
    console.log("[dry-run] Would update: docs/milestones.yml, docs/MILESTONES.md");
    if (flags.commit) console.log("[dry-run] Would git add + commit docs files");
    if (flags.push) console.log("[dry-run] Would git push");
    process.exit(0);
  }

  const real = logFromYaml(data);
  save(data);

  console.log(
    `${real.added ? "Logged" : "Already logged"} ${real.sha} in M${real.current.id}: ${real.current.title}`
  );

  sh("node scripts/docs-gen.mjs");

  if (flags.commit) {
   //  sh("git add docs/milestones.yml docs/MILESTONES.md");

    const msg = `docs: log ${real.sha} to M${real.current.id}`;

    // The pre-commit hook will auto-stage any other changed files
    sh(`git commit -m "${msg.replace(/"/g, '\\"')}"`);

    if (flags.push) sh("git push");
  }

  process.exit(0);
}


// Milestone compeled
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
    sh("git add docs/milestones.yml docs/MILESTONES.md");

    const msg = real.promoted
      ? `docs: complete M${real.completed.id} + promote M${real.promoted.id}`
      : `docs: complete M${real.completed.id}`;

    // The pre-commit hook will auto-stage any other changed files
    sh(`git commit -m "${msg.replace(/"/g, '\\"')}"`);

    if (flags.push) sh("git push");


  }
} else {
  die(`Unknown cmd: ${cmd}`);
}