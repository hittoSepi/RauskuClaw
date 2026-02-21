// scripts/docs-gen.mjs
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "docs", "milestones.yml");
const OUT = path.join(ROOT, "docs", "MILESTONES.md");

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function bullet(lines, indent = "") {
  if (!lines || lines.length === 0) return "";
  return lines.map((s) => `${indent}- ${s}`).join("\n") + "\n";
}

if (!fs.existsSync(SRC)) die(`Missing ${SRC}`);

const data = YAML.parse(fs.readFileSync(SRC, "utf8"));
const ms = Array.isArray(data?.milestones) ? data.milestones : [];
if (!ms.length) die(`No milestones[] in ${SRC}`);

const currentList = ms.filter((m) => m.status === "current");
if (currentList.length !== 1) {
  die(`Expected exactly 1 current milestone, found ${currentList.length}.`);
}
const current = currentList[0];

const next = ms.filter((m) => m.status === "next").sort((a, b) => a.id - b.id);
const done = ms.filter((m) => m.status === "done").sort((a, b) => b.id - a.id);

let md = `# Implementation Milestones (UI v2)\n\n`;
md += `**UPDATE THIS DOCUMENT AS WE GO!**\n\n`;
md += `**Current:** Milestone ${current.id} — ${current.title}\n\n`;

if (current.notes?.length) md += `### Notes\n${bullet(current.notes)}\n`;
if (current.goals?.length) md += `### Goals\n${bullet(current.goals)}\n`;
if (current.dod?.length) md += `### DoD\n${bullet(current.dod)}\n`;

md += `## Next\n\n`;
if (!next.length) {
  md += `- (empty)\n\n`;
} else {
  for (const m of next) {
    md += `- Milestone ${m.id} — ${m.title}\n`;
    if (m.goals?.length) md += bullet(m.goals, "  ");
    if (m.dod?.length) md += bullet(m.dod, "  ");
    if (m.notes?.length) md += bullet(m.notes, "  ");
    md += `\n`;
  }
}

md += `## Done\n\n`;
md += done.length
  ? done.map((m) => `- Milestone ${m.id} — ${m.title}`).join("\n") + "\n"
  : `- (none)\n`;

fs.writeFileSync(OUT, md, "utf8");
console.log(`Generated ${path.relative(ROOT, OUT)} from ${path.relative(ROOT, SRC)}`);