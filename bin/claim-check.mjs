#!/usr/bin/env node
// claim-check: find unsourced claims in text that other people will read (.md, .txt, .html).
// Usage: node claim-check.mjs <file> [--json]    exit 0 = no findings, 1 = findings, 2 = usage error.
// Rules (one block = one paragraph, list item with its indented lines, or table row):
//   R1 number claim (%, decimal, money, 12K, N of M, value >= 10) with no source in the block
//   R2 statement that names a person or a meeting, with a date or a name, and no URL in the block
//   R3 marker of unchecked content (not checked, could not confirm, TODO, "Open points" heading, ...)
//   R4 acronym with no definition at first use (warning only, does not fail)
// A source is a URL, a Markdown link, a repo path (x/y.md), "Source:", or an ID such as "issue 1234".
// Used by extensions/publish-guard.ts (publishTargets + checkFile). Origin: earlier sessions.
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const SOURCE = new RegExp([
  String.raw`https?://`,
  String.raw`\]\([^)]+\)`,
  String.raw`(?:^|[\s(\x60'"])[\w.~-]+(?:[\\/][\w.@~-]+)+\.(?:md|py|cs|xml|json|jsonl|ts|js|mjs|kql|csl|sql|csv|ipynb|yaml|yml|txt|docx|pptx|xlsx|pdf)\b`,
  String.raw`\bsources?\s*:`,
  String.raw`\b(?:see )?section\s+\d+(?:\.\d+)*\b`,
  String.raw`\b(?:scorecard|analysis|rollout|experiment|step|flight|PR|issue|commit|work item)s?\s*\(?#?[0-9a-f]{3,}\b`,
  String.raw`\barXiv[: ]\s*\d{4}\.\d{4,5}`,
].join("|"), "i");
const MARKERS = [
  /\b(?:not|never) (?:yet )?(?:checked|verified|confirmed|validated)\b/i,
  /\b(?:did|could|can) ?not (?:check|verify|confirm|validate|find a source)\b/i,
  /\bcannot (?:check|verify|confirm)\b/i,
  /\bun(?:verified|confirmed|sourced|checked)\b/i,
  /\bno (?:source|query|one|owner) (?:shows|proves|has confirmed|confirms)\b/i,
  /\bhas not (?:confirmed|answered)\b.*\b(?:value|number|claim)\b/i,
  /\bonly from (?:my|our) own\b/i,
  /\bfrom (?:my|our) own (?:analysis|notes)\b/i,
  /\b(?:TODO|TBD|FIXME)\b/,
  /\?\?\?/,
  /^\s*(?:#+\s*|\*\*)?(?:open (?:points|questions)|unverified claims)\b/im,
  /^\s*OPEN POINTS\b/m,
];
const ATTRIB = /\b(?:asked|said|says|requested|proposed|stated|according to|mentioned|agreed|decided)\b/i;
const MEETING = /\b(?:meeting|scrum|office hours?|standup|sync|1:1|recording|e-?mail|teams thread|teams chat|doc comment)\b/i;
const DATE = new RegExp(String.raw`\b${MONTH}\.? \d{1,2}\b|\b\d{1,2} ${MONTH}\b|\b\d{4}-\d{2}-\d{2}\b`, "i");
const NAME = /\b[A-Z][a-z]+ [A-Z][a-z]+(?:'s)?\b/;
const ACRO_OK = new Set("A AB AI API ADO ADX CI CLI CSS CSV DB DM EU FAQ GB GPU HTML HTTP HTTPS ID IDE JS JSON KB LLM LT MB MD ML MS OK OSS PDF PM PR PST QA README REST RoW SDK SLA SQL TB TS UI URL US USA UTC UX VM VS XML YAML CEO CTO ETA EOD NA".split(" "));

// Text for a block with dates, versions, paths, URLs, code, and list numbers removed.
function numericText(s) {
  return s
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\]\([^)]*\)/g, "] ")
    .replace(/\S*[\\/]\S*/g, " ")
    .replace(new RegExp(String.raw`\b${MONTH}\.? \d{1,2}(?:st|nd|rd|th)?(?:,? (?:19|20)\d{2})?\b`, "gi"), " ")
    .replace(new RegExp(String.raw`\b\d{1,2} ${MONTH}(?: (?:19|20)\d{2})?\b`, "gi"), " ")
    .replace(/\b\d{4}-\d{2}(?:-\d{2})?(?:T[\d:.]+Z?)?\b/g, " ")
    .replace(/\b[vV]\d+(?:\.\d+)*\b/g, " ")
    .replace(/\b\d+\.\d+\.\d+\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\b[A-Za-z]+[-_]?\d+[A-Za-z0-9-]*\b/g, " ")   // gpt-56, Q3, V4, metric_v2
    .replace(/\b(?:item|step|section|part|line|L|row|turn|phase|option|ring|level|tier)s? ?#?\d+(?:\.\d+)?(?:\s*(?:to|-|–|and)\s*\d+(?:\.\d+)?)?\b/gi, " ")
    .replace(/^\s*(?:[-*+]\s+)?(?:\(?\d+(?:\.\d+)*[.)]\s+|\d+(?:\.\d+)+\s+(?=[A-Z]))/, " ")
    .replace(/\(\d+\)/g, " ")
    .replace(/\(\s*(?:see\s+)?(?:§\s*)?\d+(?:\.\d+)+(?:\s*(?:,|and|to)\s*\d+(?:\.\d+)+)*\s*\)/gi, " ");
}

function numberClaim(s) {
  const t = numericText(s);
  const m = t.match(/\b(?:ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|dozens?)\b|\d+(?:[.,]\d+)?\s?%|\$\s?\d[\d.,]*|\d\s?(?:€|£)|\b\d+(?:\.\d+)?\s?[KMB]\b|\b\d+\.\d+\b|\b\d+ (?:of|out of) \d+\b|\b\d{1,3}(?:,\d{3})+\b|\b\d{2,}\b|\d\s?(?:→|->)\s?\d|\b\d+(?:\.\d+)?x\b/);
  return m ? m[0] : null;
}

// HTML to text: links keep their URL so that they count as sources.
function htmlToText(h) {
  return h
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a\b[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => "\n\n|" + row.replace(/\s+/g, " ") + "\n\n")
    .replace(/<\/?(?:td|th)\b[^>]*>/gi, " | ")
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, t) => "\n\n### " + t.replace(/\s+/g, " ") + "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n\n- ")
    .replace(/<\/?(?:p|div|li|tr|ul|ol|table|thead|tbody|section|article|blockquote|pre|br)\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n");
}

export function blocks(text) {
  const out = [];
  let cur = null, fence = false;
  const lines = text.replace(/\r/g, "").split("\n");
  lines.forEach((raw, i) => {
    if (/^\s*```/.test(raw)) { fence = !fence; cur = null; return; }
    if (fence) return;
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { cur = null; return; }
    const starts = /^\s*(?:[-*+•]\s|\d+(?:\.\d+)*[.)]\s|#{1,6}\s|\|)/.test(line) || /^[A-Z0-9][A-Z0-9 ,&/()'-]{3,}$/.test(line.trim());
    if (!cur || starts || cur.heading) {
      cur = { line: i + 1, text: line, list: starts, heading: /^\s*#{1,6}\s/.test(line) || /^[A-Z0-9][A-Z0-9 ,&/()'-]{3,}$/.test(line.trim()) };
      out.push(cur);
    } else cur.text += "\n" + line;
  });
  return out;
}

export function checkText(text, { html = false } = {}) {
  const body = html ? htmlToText(text) : text;
  const findings = [], warnings = [];
  const seen = new Set();
  const all = blocks(body);
  // A block is sourced by its own source, by the paragraph just before its list or table,
  // or by the heading or the first paragraph of its section. List items do not source each other.
  let sectionSourced = false, sectionFirst = true, leadSourced = false;
  for (const b of all) {
    const own = SOURCE.test(b.text);
    const isRow = /^\s*\|/.test(b.text);
    if (b.heading) { sectionSourced = own; sectionFirst = true; leadSourced = false; }
    else if (!b.list) { if (sectionFirst && own) sectionSourced = true; leadSourced = own; sectionFirst = false; }
    else sectionFirst = false;
    b.sourced = own || sectionSourced || ((b.list || isRow) && leadSourced);
  }
  for (const b of all) {
    const snip = b.text.replace(/\s+/g, " ").trim().slice(0, 140);
    for (const re of MARKERS) {
      const m = b.text.match(re);
      if (m) { findings.push({ rule: "R3", line: b.line, hit: m[0].trim(), text: snip, why: "marker of unchecked content in the shared text: fix the claim or remove it, and keep open points in the chat" }); break; }
    }
    if (b.heading) continue;
    if (!b.sourced) {
      const n = numberClaim(b.text);
      if (n) findings.push({ rule: "R1", line: b.line, hit: n, text: snip, why: "number with no source in the same block: add a link or path, or remove the number" });
      const who = ATTRIB.test(b.text) || MEETING.test(b.text);
      if (who && (DATE.test(b.text) || NAME.test(b.text)) && !/https?:\/\//i.test(b.text))
        findings.push({ rule: "R2", line: b.line, hit: (b.text.match(ATTRIB) || b.text.match(MEETING))[0], text: snip, why: "names a person or a meeting with no link: add the link to the meeting, mail, thread, or doc" });
    }
    for (const m of b.text.matchAll(/\b[A-Z][A-Z0-9]{1,5}s?\b/g)) {
      const a = m[0].replace(/s$/, "");
      if (seen.has(a) || ACRO_OK.has(a) || /^\d/.test(a)) continue;
      seen.add(a);
      const near = b.text.slice(Math.max(0, m.index - 3), m.index + m[0].length + 3);
      const defined = /\(\s*\w*$/.test(b.text.slice(0, m.index)) || /^s?\s*\(/.test(b.text.slice(m.index + m[0].length)) || /^s?\s*(?:=|:|is |means )/.test(b.text.slice(m.index + m[0].length));
      if (!defined && warnings.length < 15) warnings.push({ rule: "R4", line: b.line, hit: a, text: near, why: "acronym with no definition at first use" });
    }
  }
  return { findings, warnings, blocks: all.length };
}

export function checkFile(path) {
  const text = readFileSync(path, "utf8");
  return checkText(text, { html: /\.html?$/i.test(extname(path)) });
}

// ---- detection of publish commands (used by extensions/publish-guard.ts) ----
const winPath = (p) => p.replace(/^\/([a-z])\//i, "$1:/");
const FILE = /(?:[A-Za-z]:[\\/]|[\\/]|\.{1,2}[\\/])?[^\s'"`;|&<>()=@,]+\.(?:md|txt|html?)\b/gi;
const SCRIPT = /[^\s'"`;|&<>()]+\.(?:ps1|py|mjs|cjs|js|sh)\b/gi;

// Optional env PI_PUBLISH_GUARD_PATTERN: an extra regex (case-insensitive) for your own publish commands.
// An invalid regex is ignored with one warning on stderr.
let extraPattern;
function extraPublishPattern() {
  const src = process.env.PI_PUBLISH_GUARD_PATTERN;
  if (!src) return null;
  if (extraPattern?.src !== src) {
    try { extraPattern = { src, re: new RegExp(src, "i") }; }
    catch (e) { extraPattern = { src, re: null }; console.error(`claim-check: PI_PUBLISH_GUARD_PATTERN is not a valid regex: ${e.message}`); }
  }
  return extraPattern.re;
}

export function publishKind(cmd) {
  if (/\bSet-Clipboard\b|\|\s*clip(?:\.exe)?\b(?!\.ps1)|\bclip\.exe\b|clip(?:\.ps1)?\b[\s\S]*?-Mode\s+set\b|SetText\s*\(|pbcopy|xclip/i.test(cmd)) return "clipboard copy";
  if (extraPublishPattern()?.test(cmd)) return "publish command";
  return null;
}

export function publishTargets(cmd, cwd) {
  const kind = publishKind(cmd);
  if (!kind) return null;
  const cd = cmd.match(/(?:^|[;&|\n]\s*)cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/);
  const base = cd ? winPath(cd[1] || cd[2] || cd[3]) : cwd;
  const abs = (p) => { p = winPath(p); return isAbsolute(p) ? p : resolve(isAbsolute(base) ? base : resolve(cwd, base), p); };
  let text = cmd.replace(/https?:\/\/\S+/g, " ");
  for (const m of cmd.matchAll(SCRIPT)) {
    try { const f = abs(m[0]); if (/claim-check|clip\.ps1/i.test(f)) continue; if (existsSync(f) && statSync(f).size < 500_000) text += "\n" + readFileSync(f, "utf8").replace(/https?:\/\/\S+/g, " "); } catch {}
  }
  const files = new Map();
  for (const m of text.matchAll(FILE)) {
    try { const f = abs(m[0]); if (existsSync(f) && statSync(f).isFile()) files.set(resolve(f).replace(/\\/g, "/").toLowerCase(), resolve(f)); } catch {}
  }
  return { kind, files: [...files.values()] };
}

export function report(path, r) {
  const out = [];
  for (const f of r.findings) out.push(`FAIL ${f.rule} ${path}:${f.line} [${f.hit}] ${f.why}\n     "${f.text}"`);
  for (const w of r.warnings) out.push(`warn ${w.rule} ${path}:${w.line} [${w.hit}] ${w.why}`);
  const by = (k) => r.findings.filter((f) => f.rule === k).length;
  out.push(`claim-check: ${r.findings.length} findings (R1 ${by("R1")}, R2 ${by("R2")}, R3 ${by("R3")}), ${r.warnings.length} warnings, ${r.blocks} blocks`);
  return out.join("\n");
}

const isMain = (() => { try { return resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1] || "").toLowerCase(); } catch { return false; } })();
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const files = args.filter((a) => !a.startsWith("--"));
  if (!files.length) { console.error("usage: node claim-check.mjs <file> [<file> ...] [--json]"); process.exit(2); }
  let bad = 0; const all = {};
  for (const f of files) {
    if (!existsSync(f)) { console.error(`claim-check: no such file: ${f}`); process.exit(2); }
    const r = checkFile(f); all[f] = r; bad += r.findings.length;
    if (!json) console.log(report(f, r));
  }
  if (json) console.log(JSON.stringify(all, null, 1));
  process.exit(bad ? 1 : 0);
}
