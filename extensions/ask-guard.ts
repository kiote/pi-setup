// ask-guard: stop the agent from ending a run with a permission question for a low-risk step,
// with a second merge question after the user approved the push or the PR,
// with an offer of a step that the agent itself recommends against,
// or with a question about the meaning or the goal of the request when the agent already names a default.
// Runs at agent_before_settle. Rechecks after correction, with at most two continuations per user prompt.
// Never treats a first push request, a refusal, or a no-merge limit as approval.
// Test: node bin/ask-guard-test.mjs (from the pi-setup package root). Log: ~/.pi/agent/logs/ask-guard.jsonl.
// Off for one session: start pi with PI_ASK_GUARD=off.
// Origin: retrospectives of earlier sessions (the permission, merge-repeat, and clarify-default checks).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TYPE = "ask-guard";

// A yes/no question that asks the user for permission for a next step.
const PERMISSION =
  /\b(do you want (me to|this|that|it|these|them)|would you like (me to|this|that)|shall (i|we)|should (i|we)|do (i|we)|can i|may i|do you approve|approve (this|the|these|that|my)|is it ok (if|to)|ok to|want me to)\b/i;
// Option prompts, such as: Answer "A" or "B". Used only for the merge-repeat check.
const OPTION_PROMPT = /\b(answer|reply|choose|pick)\s+["'`*]*[A-D1-4]["'`*]*\s*(,|or)\s/i;
// Offers written as a statement: "If you want, I can ...", "I can ... if you want."
const OFFER = /\bif you (want|like|wish)\b[^.?!]*\bI (can|will|could)\b|\bI (can|could) [^.?!]*\bif you (want|like|wish)\b|\b(tell|let) me if you want (me to|this|that|it)\b/i;
// A real choice: alternatives or an open question. The user must decide it.
const CHOICE = /^(which|what|where|who|how|or)\b|\bor\b|,\s*(which|what|where|who|how)\b/i;
// Approvals that the rules require (plan, layout, design, draft), and explicit approval gates.
const REQUIRED_APPROVAL = /\b(plan|layout|design|draft|wording)\b/i;
const PLAN_REQUEST = /\b(show me the plan|plan before|plan first|plan approval|propose a plan|before you change)\b/i;
// Steps that can need an approval: shipping, deleting, sending, contacting people, shared or admin changes.
const HIGH_RISK =
  /\b(merge|push|PR|pull request|delete|remove|uninstall|drop|wipe|purge|send|post|e-?mail|message|publish|release|deploy|force|reset --hard|consent|admin|grant|team skill|shared|repo|repository|reviewer|notify|invite|assign|ping|contact)\b|\.github\/skills/i;
// Read-only references to a PR or repository are not a write request.
const READ_ONLY = /\b(check|inspect|read|list|search|find|look up|compare)\b/i;
const WRITE_ACTION = /\b(push|merge|delete|remove|uninstall|drop|wipe|purge|send|post|publish|release|deploy|grant|assign|invite|notify|edit|update|change|create|open|add)\b/i;
const NO_MERGE = /\b(no merge|do not merge|don't merge|without merg\w*|(?:PR|pull request|push)[ -]only|(?:PR|pull request)(?:\s+#?\d+)? and stop|stop after (?:the |a )?(?:PR|pull request))\b/i;
const DENY_SHIP = /\b(?:do not|don't|never)\s+(?:push|publish)|\bno push\b|\blocal[ -]only\b|\bwait for (?:review|approval)|\bhold (?:off|the push|the merge)\b/i;
const SEPARATE_MERGE = /\b(?:stop and ask me before|ask me before|ask before)[^\n.]{0,160}\bmerge\b/i;
const MAX_NUDGES = 2;
// The user's explicit restrictions override the default PR-to-merge policy.
const SHIP = /\b(merge|push|open\w*\s+(the\s+|a\s+)?(draft\s+)?(PR|pull request)|create\s+(a\s+|the\s+)?(PR|pull request))\b/i;
const RECOMMEND_AGAINST =
  /\b(I (do not|don't) recommend|I recommend (that you )?(keep|not|do not|don't|against|leave)|my default is (to )?(keep|not|leave))/i;
const APPROVAL =
  /^\s*(y|yes|yep|ok|okay|sure|go|go ahead|do it|lgtm|approved?|merge|pls|please|[a-d1-4])\b|\b(do it|go ahead|lgtm|yes)\b/i;
const REFUSAL = /^\s*(no|nope|don'?t|do not|stop|wait|hold)\b/i;
// A question about what the user means or wants as the goal, the scope, or the output.
const CLARIFY =
  // Only meaning and goal questions. A menu of decisions ("choose one option") is not matched: it is often a high-risk choice.
  /\b(which (goal|meaning|interpretation)\b[^.?!\n]{0,40}\?|which \w+ do you mean|what (do you mean|did you mean)|what\b[^.?!\n]{0,40}\bmeans? (for|to) you|what does\b[^.?!\n]{0,40}\bmean\b|(the|your) goal (of|for) this|tell me (the goal|what you mean)|do you mean\b[^.?!\n]{0,80}\bor\b)/i;
// The agent names its own default or recommended option.
const DEFAULT_NAMED = /\b(my (recommended )?default|recommended default|this is my default|\(recommended\)|\*\*recommended|my recommendation)/i;
// The user asked for options, a plan, a recommendation, or questions: a menu is the answer.
const OPTIONS_REQUEST =
  /\b(options|alternatives|choices|which (should|would|do) (i|we|you)|what do you (suggest|recommend|think)|pros and cons|propose|plan|ask me|questions?)\b/i;

export type Msg = { role: string; text: string; customType?: string };
export type Verdict = { kind: "low-risk" | "repeat" | "recommend-against" | "clarify-default"; question: string };

const textOf = (c: any): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.filter((x) => x?.type === "text").map((x) => x.text).join("\n") : "";

export function toMsgs(messages: any[]): Msg[] {
  return (messages ?? [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant" || m.role === "custom"))
    .map((m) => ({ role: m.role, text: textOf(m.content), customType: m.customType }));
}

function sentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// The last permission question or option prompt near the end of a message, or undefined.
export function findQuestion(text: string): string | undefined {
  const tail = sentences(text.slice(-1200));
  for (let i = tail.length - 1; i >= 0; i--) {
    const s = tail[i];
    const plain = s.replace(/\*\*|__|`/g, "");
    const shipQuestion = /^(?:please\s+)?(?:push|merge|open (?:a |the )?PR)\b/i.test(plain);
    if ((plain.endsWith("?") && (PERMISSION.test(plain) || shipQuestion)) || OPTION_PROMPT.test(s) || OFFER.test(s)) return s;
  }
  return undefined;
}

// Did an earlier assistant message ask about a push, a PR, or a merge of the same PR, and did the user approve it?
// An earlier question that names a different PR number does not count.
const prNums = (s: string) => new Set([...s.matchAll(/#(\d+)|\/pull\/(\d+)|\bPR\s+(\d+)/gi)].map((m) => m[1] ?? m[2] ?? m[3]));
const repos = (s: string) => new Set([...s.matchAll(/https?:\/\/([^\s/]+\/[^\s/]+\/[^\s/]+)\/pull\/\d+/gi)].map(m => m[1].toLowerCase()));
const disjoint = (a: Set<string>, b: Set<string>) => a.size && b.size && ![...a].some(x => b.has(x));
function shipApprovedBefore(msgs: Msg[], lastUser: number, scope: string): boolean {
  // "Approve this push, with no merge?" asks about a push, not a merge.
  const positiveScope = scope.replace(NO_MERGE, "");
  const merging = /\bmerge\b/i.test(positiveScope);
  if (!merging && !SHIP.test(positiveScope)) return false;
  for (let i = lastUser; i >= 0; i--) {
    const reply = msgs[i];
    if (reply.role !== "user" || REFUSAL.test(reply.text)) continue;
    const prior = [...msgs.slice(0, i)].reverse().find(m => m.role === "assistant");
    const direct = /^(?:(?:please|pls|can you|could you)\s+)?(?:push|merge|open (?:a |the )?(?:PR|pull request)|create (?:a |the )?(?:PR|pull request))\b/i.test(reply.text.trim());
    let earlier = direct ? reply.text : prior?.text ?? "";
    if (!direct) {
      const permission = findQuestion(earlier);
      if (!APPROVAL.test(reply.text) || !permission) continue;
      const selected = reply.text.trim().match(/^(?:option\s+)?([a-d1-4])[.!]?$/i)?.[1];
      if (selected) {
        const line = earlier.replace(/\*\*/g, "").split(/\n/).find(s => new RegExp(`^\\s*(?:Option\\s+)?${selected}[.):\\s]`, "i").test(s));
        if (!line) continue; // An unresolved menu is not permission to ship.
        earlier = line;
      } else if (!SHIP.test(permission) && !/\b(plan|changes|proceed)\b/i.test(permission)) continue;
    }
    if (!SHIP.test(earlier)) continue;
    if (disjoint(prNums(scope), prNums(earlier)) || disjoint(repos(scope), repos(earlier))) continue;
    const later = msgs.slice(i, lastUser + 1).filter(m => m.role === "user");
    if (later.some(m => REFUSAL.test(m.text) || DENY_SHIP.test(m.text))) continue;
    if (merging) {
      if (NO_MERGE.test(earlier) || later.some(m => NO_MERGE.test(m.text))) continue;
      // A user who asked for a separate merge approval has not approved it by selecting a push/PR option.
      if (!/\bmerge\b/i.test(earlier) && msgs.slice(0, i + 1).some(m => m.role === "user" && SEPARATE_MERGE.test(m.text))) continue;
    }
    return true;
  }
  return false;
}

// The user asked for a plan first, and no permission question since then got an answer.
function planPending(msgs: Msg[], lastUser: number): boolean {
  let req = -1;
  for (let i = 0; i <= lastUser; i++) {
    if (msgs[i].role !== "user") continue;
    const text = msgs[i].text.replace(/\b(?:without|no) plan approval(?: is needed)?\b|\b(?:do not|don't) (?:need|ask for) plan approval\b/gi, "");
    if (text !== msgs[i].text && !PLAN_REQUEST.test(text)) req = -1;
    if (PLAN_REQUEST.test(text)) req = i;
  }
  if (req < 0) return false;
  for (let i = req + 1; i < lastUser; i++) if (msgs[i].role === "assistant" && findQuestion(msgs[i].text) && msgs.slice(i + 1, lastUser + 1).some(m => m.role === "user" && APPROVAL.test(m.text) && !REFUSAL.test(m.text))) return false;
  return true;
}

export function classify(msgs: Msg[]): Verdict | undefined {
  let lastUser = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user") { lastUser = i; break; }
  // A second offer must still pass the check; stop after a bounded correction budget.
  if (msgs.slice(lastUser + 1).filter((m) => m.role === "custom" && m.customType === TYPE).length >= MAX_NUDGES) return undefined;
  const last = [...msgs].reverse().find((m) => m.role === "assistant");
  if (!last || msgs.indexOf(last) < lastUser) return undefined;
  // 0. A question about the meaning or the goal, while the agent already names a default.
  const clarify = findClarify(last.text);
  if (clarify && !OPTIONS_REQUEST.test(msgs[lastUser]?.text ?? "") && !planPending(msgs, lastUser)) {
    return { kind: "clarify-default", question: clarify };
  }
  const question = findQuestion(last.text);
  if (!question) return undefined;
  const option = OPTION_PROMPT.test(question);
  const scope = option ? last.text.slice(-1500) : question;
  // 1. The agent offers a step and then recommends against it.
  const after = last.text.slice(last.text.lastIndexOf(question)).slice(0, 600);
  if (!option && RECOMMEND_AGAINST.test(after) && !/\bI recommend that I\b/i.test(after)) {
    return { kind: "recommend-against", question };
  }
  // 2. A repeated request for an already-approved shipping action on the same PR.
  if (SHIP.test(scope) && shipApprovedBefore(msgs, lastUser, scope)) return { kind: "repeat", question };
  // 3. A yes/no permission question for a low-risk step.
  const readOnly = READ_ONLY.test(question) && !WRITE_ACTION.test(question);
  const before = sentences(last.text.slice(0, last.text.lastIndexOf(question))).at(-1) ?? "";
  const statedRisk = /\b(?:shared|team) (?:file|repo|repository|skill)\b|\b(?:send|post|publish|push|merge|grant)\b/i.test(before);
  if (option || CHOICE.test(question) || REQUIRED_APPROVAL.test(question) || ((HIGH_RISK.test(question) || statedRisk) && !readOnly)) return undefined;
  if (planPending(msgs, lastUser)) return undefined;
  return { kind: "low-risk", question };
}

// The clarification sentence near the end of a message, if the message also names a default.
export function findClarify(text: string): string | undefined {
  const tail = text.replace(/```[\s\S]*?```/g, " ").slice(-2500);
  if (!DEFAULT_NAMED.test(tail)) return undefined;
  const s = sentences(tail).reverse().find((x) => CLARIFY.test(x));
  return s;
}

export function note(v: Verdict): string {
  if (v.kind === "clarify-default") {
    return `ask-guard: your last message asks the user what the request means or what its goal is: "${v.question.slice(0, 200)}"
You already named a default, so do not wait for an answer. Start the default now:
1. State your interpretation in one line, so the user can redirect you.
2. Do the read-only, analysis, and draft part of the default.
3. Ask only about a high-risk step in it (a post, a send, a push, a merge, a delete, a shared file), and do all other steps first.
Exception: if the meanings need very different high-risk steps and no part is safe to start, keep the question and add one sentence that names that risk.`;
  }
  const head = `ask-guard: your last message ends with this question: "${v.question.slice(0, 200)}"`;
  const body =
    v.kind === "low-risk"
      ? "This is a low-risk, reversible step (a note, a local or personal file, a link, a check, a test, a commit, or a local update). Do not ask. If the step helps the goal of the user, do it now, check it, and report it in one line. If its value is low, drop the offer and end without a question."
      : v.kind === "repeat"
        ? "The user already approved this shipping action. Continue only the approved action on the same PR, after the required checks pass. Preserve its scope and all limits, including no merge, PR only, and later refusals. This note grants no new permission."
        : "You recommend against this step. Do not offer it as a question. Remove the question and give the command for it in one line, so the user can run it later.";
  return `${head}\n${body}\nException: if the step is really high risk (a push or merge to a shared repo with no earlier approval, a delete of user data, a send or post, a shared file, or an admin consent), or if the user told you only to offer it, keep the question and add one sentence that names that reason.`;
}

function log(v: { kind?: Verdict["kind"]; question: string; decision: string }, cwd: string, sessionId?: string) {
  try {
    const dir = join(homedir(), ".pi", "agent", "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "ask-guard.jsonl"), JSON.stringify({ ts: new Date().toISOString(), version: 2, cwd, sessionId, ...v, question: v.question.slice(0,300) }) + "\n");
  } catch {}
}

export default function (pi: ExtensionAPI) {
  if (process.env.PI_ASK_GUARD === "off") return;
  pi.on("agent_before_settle", async (event, ctx) => {
    // Do not check context.canContinue: it is false until this note is added (final role is assistant).
    if (event.outcome !== "completed") return;
    const msgs = toMsgs(event.context?.contextMessages ?? []);
    const v = classify(msgs);
    const lastUser = msgs.findLastIndex(m => m.role === "user");
    const last = msgs.at(-1);
    const question = last?.role === "assistant" ? findQuestion(last.text) : undefined;
    const count = msgs.slice(lastUser + 1).filter(m => m.role === "custom" && m.customType === TYPE).length;
    if (!v) {
      if (question) {
        const exhausted = count >= MAX_NUDGES;
        log({ question, decision: exhausted ? "budget-exhausted" : "kept" }, ctx.cwd, ctx.sessionManager?.getSessionId?.());
        if (exhausted) ctx.ui?.notify("ask-guard reached its correction limit. The question remains; no extra authority was granted.", "warning");
      }
      return;
    }
    log({ ...v, decision: "continue" }, ctx.cwd, ctx.sessionManager?.getSessionId?.());
    return {
      entries: [...event.entries, { type: "custom_message", customType: TYPE, content: note(v), display: true }],
      continue: true,
    };
  });
}
