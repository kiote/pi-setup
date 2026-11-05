// addendums: append the enabled addendums/*.md files to the system prompt in before_agent_start.
// Select with env PI_SETUP_ADDENDUMS: unset or empty = all (ste100, coordination, sdd, agents-generic);
// `none` = nothing; else a comma list of names, appended in list order (unknown names: one warning).
// The text `<pi-setup>` in a file becomes the absolute package root (forward slashes).
// The selection is read once, when pi loads the extension. Test: node <pi-setup>/bin/addendums-test.mjs.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ADDENDUM_NAMES = ["ste100", "coordination", "sdd", "agents-generic"] as const;

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/");

export function selectAddendums(value: string | undefined, warn: (msg: string) => void = console.warn): string[] {
  const raw = (value ?? "").trim();
  if (raw === "") return [...ADDENDUM_NAMES];
  if (raw.toLowerCase() === "none") return [];
  const known = new Set<string>(ADDENDUM_NAMES);
  const selected: string[] = [];
  const unknown: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (name === "") continue;
    if (!known.has(name)) unknown.push(name);
    else if (!selected.includes(name)) selected.push(name);
  }
  if (unknown.length > 0) {
    warn(`[addendums] PI_SETUP_ADDENDUMS: unknown names ignored: ${unknown.join(", ")} (known: ${ADDENDUM_NAMES.join(", ")})`);
  }
  return selected;
}

// Returns the text to append (selected files + root line), or "" when no file is enabled.
export function buildAddendumText(
  value: string | undefined,
  root: string = PACKAGE_ROOT,
  warn: (msg: string) => void = console.warn,
): string {
  const parts: string[] = [];
  for (const name of selectAddendums(value, warn)) {
    let text: string;
    try {
      text = readFileSync(join(root, "addendums", `${name}.md`), "utf8");
    } catch (e) {
      warn(`[addendums] cannot read ${name}.md: ${(e as Error).message}`);
      continue;
    }
    parts.push(text.split("<pi-setup>").join(root).trim());
  }
  if (parts.length === 0) return "";
  parts.push(`pi-setup package root: ${root}`);
  return parts.join("\n\n");
}

export default function addendumsExtension(pi: ExtensionAPI) {
  const addendum = buildAddendumText(process.env.PI_SETUP_ADDENDUMS);
  if (addendum === "") return;
  pi.on("before_agent_start", async (event) => {
    return { systemPrompt: `${event.systemPrompt}\n\n${addendum}` };
  });
}
