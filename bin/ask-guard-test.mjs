// Test for extensions/ask-guard.ts. Run: node bin/ask-guard-test.mjs (from the pi-setup package root)
// Cases are short synthetic versions of agent replies from earlier sessions.
import { classify } from "../extensions/ask-guard.ts";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const u = (text) => ({ role: "user", text });
const a = (text) => ({ role: "assistant", text });
const cases = [
  ["nightly remove task (recommend against)", "recommend-against", [
    u("find and stop nightly backup automation"),
    a("I disabled the task.\n```powershell\nEnable-ScheduledTask -TaskName X\n```\nDo you want me to remove the task permanently? I recommend that you keep it disabled. If you choose to remove it, I will use the skill's own script:\n```powershell\n& Remove-NightlyBackup.ps1\n```"),
  ]],
  ["NightlyBackup stop (recommend against)", "recommend-against", [
    u("any other tasks we have running periodiaclally"),
    a("There are no active pi loops.\nDo you want me to stop or disable NightlyBackup too? I recommend that you keep it, unless you no longer use the backup."),
  ]],
  ["skill note", "low-risk", [
    u("we can't do it, the calendar service has no read api"),
    a("I can add one line to the build bot `SKILL.md` that says release dates are not available through an API. Do you want this note?"),
  ]],
  ["mission skill update", "low-risk", [
    u("i have a feedback about mission-mode"),
    a("- **Your skill:** Your own `mission-mode` skill still suggests minimum row counts. Do you want me to update them to match the new guide? I recommend that I do this, because the skill writes the mission files.\n\nI added the PR row to `pr-index.md`."),
  ]],
  ["mission installed copy update", "low-risk", [
    u("lgtm pls merge"),
    a("It is safe to remove the local patch. Do you want me to do the update? I recommend these steps:\n1. Run `git checkout -- src/verify.ts` to remove the local patch.\n2. Run `git pull --ff-only`.\n3. Restart pi."),
  ]],
  ["todo link", "low-risk", [
    u("make the todo"),
    a("I did not add a link, because I did not find the plugin page. Do you want me to find the plugin and add its link to the todo?"),
  ]],
  ["auto-approve: preserve the approved PR-and-stop limit (A/B)", undefined, [
    u("Task ... Show me the plan before you change shared files."),
    a("Plan ... Please answer two questions:\n- Which option: A, B, or C? My default is C.\n- Do I open the PR and stop, or also merge it after the checks pass? My default is to open the PR and stop."),
    u("do it"),
    a("PR #273 is open."),
    u("so what now"),
    a("Only one step is left: merge PR #273.\n**Option A (my default):** I do these steps for you:\n1. Merge #273.\n2. Pull `main`.\n**Option B:** You review the PR first. Then tell me to do option A.\nAnswer \"A\" or \"B\"."),
  ]],
  ["clipboard: merge after PR option", "repeat", [
    u("Task: add a clipboard skill"),
    a("The push and the PR to acme/app are still open. Do you want me to push the branch and open the PR with `my-account`?"),
    u("idk if anyone else needs this skill"),
    a("1. Keep it local only.\n2. Push it to your personal folder.\n3. Make it a team skill.\n**My recommendation: option 2.** Do you want me to push it and open the PR with `my-account`?"),
    u("2"),
    a("I opened the PR: https://x/pull/275. The merge state is `CLEAN`.\nDo you approve the merge? If you say yes, I will merge the PR and delete the branch."),
  ]],
  // clarify-default.
  ["which goal menu with default", "clarify-default", [
    u("pick up this todo: Follow up a reviewer comment on PR 3579 (benchmark README)"),
    a("**Which goal do you want?**\n1. **Reply on PR 3579** about the gap that the query data shows. I will write the draft, and you post it. *(My recommended default.)*\n2. **Open a follow-up PR** that makes the README shorter.\n3. **Mark the todo done.**\n\nThe todo is marked as started, and its next step is \"waiting for your choice\"."),
  ]],
  ["what 'learn' means", "clarify-default", [
    u("a teammate made several PRs lately can you go through them all and learn"),
    a("I found 40 PRs from the teammate. Before I read them, I need to know what \"learn\" means for you. Choose one:\n\n1. **The review standard and code conventions.** **(Recommended default.)**\n2. **A map of the current work.**\n3. **Both 1 and 2.**\n\nMy default scope:\n- **Time range:** October only.\n\nDo you want me to use the default?"),
  ]],
  ["do you mean X or Y, with default", "clarify-default", [
    u("summarize the evals stuff"),
    a("Do you mean the unit evals or the browser evals? My default is the unit evals."),
  ]],
  // Must not trigger.
  ["work done, asks where to post", undefined, [
    u("do followup"),
    a("**2. Draft of the open questions.** File: `C:/tmp/followup/questions.md`.\n\n**Where do you want to post the questions?**\n- **A GitHub issue in `acme/app`.** *This is my default, because the code and the CODEOWNERS team are there.* I will post it only after your approval.\n- A chat message, which you paste yourself from the clipboard."),
  ]],
  ["user asked for options", undefined, [
    u("what are my options for the eval harness?"),
    a("1. Unit. **(Recommended)**\n2. Legacy.\nWhich option do you want?"),
  ]],
  ["user invited questions", undefined, [
    u("pls create a mission from it, ask me extra questions if needed to create mission file"),
    a("2. **Sources.** Which sources do you mean? Default: the team style guide.\nYou can answer \"use your defaults\"."),
  ]],
  ["meaning question, no default", undefined, [
    u("fix the thing"),
    a("I found no context for this. What do you mean by \"the thing\"? Please give me a file or a link."),
  ]],
  ["meaning question while plan approval is pending", undefined, [
    u("Fix X. Show me the plan before you change shared files."),
    a("Plan: 1. A. 2. B. Which option do you want? My default is A."),
  ]],
  ["plan approval after plan request", undefined, [
    u("Fix X. Show me the plan before you change shared files."),
    a("Here is the plan.\n1. Edit A.\n2. Test B.\nDo you approve the plan?"),
  ]],
  ["first merge question", undefined, [
    u("fix the bug and open a PR"),
    a("I opened PR #9. The checks pass. Do you approve the merge?"),
  ]],
  ["first delete question", undefined, [
    u("clean up old branches"),
    a("I found 4 stale branches. Do you want me to delete them?"),
  ]],
  ["clarification question", undefined, [
    u("so will you create PR to the initial repo"),
    a("I already did this. Do you mean a different repo, for example a team copy of the skill? If so, please give me the repo name."),
  ]],
  ["refused earlier merge, asks again later", undefined, [
    u("open a PR"),
    a("PR is open. Do you want me to merge it?"),
    u("no, wait for review"),
    a("Review is done. Do you approve the merge?"),
  ]],
  ["merge of a different PR", undefined, [
    u("ship the fixes"),
    a("PR #216 passed. Do you want me to merge #216 and install it?"), u("yes"),
    a("Done. PR #217 passed. Do you want me to merge #217 and install it?"),
  ]],
  ["statement offer", "low-risk", [
    u("read note.txt"),
    a("The first line is alpha. If you want one, I can copy the file to `C:/tmp/saved.txt`."),
  ]],
  ["no question", undefined, [u("do x"), a("Done. I changed 2 files.")]],
  ["plan gate after plan request, offer wording", undefined, [
    u("Fix X. Show me the plan before you change shared files."),
    a("1. Edit AGENTS.md.\n2. Add a hook.\nDo you want these changes?"),
  ]],
  ["low-risk offer after the plan was approved", "low-risk", [
    u("Fix X. Show me the plan before you change shared files."),
    a("Plan. Do you approve the plan?"), u("yes"),
    a("Done. Do you want me to save this to the scratchpad?"),
  ]],
  ["shared repo add", undefined, [
    u("write a guide"),
    a("Do you want me to add the guide to the team repository, so that the team can find it?"),
  ]],
  ["already nudged once", undefined, [
    u("x"), a("Do you want this note?"), { role: "custom", customType: "ask-guard", text: "..." },
    a("Keep the question: it writes a shared file. Do you want this note?"),
  ]],
];

let fail = 0;
for (const [name, want, msgs] of cases) {
  const got = classify(msgs)?.kind;
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: want ${want}, got ${got}`);
}
console.log(fail ? `${fail} FAILED` : `all ${cases.length} passed`);
if (fail) process.exit(1);
// Always run the exact-transcript, permission-boundary, and real Pi loop checks too.
const result = spawnSync(process.execPath, ["--test",
  fileURLToPath(new URL("./ask-guard-regression-test.mjs", import.meta.url)),
  fileURLToPath(new URL("./ask-guard-runtime-test.mjs", import.meta.url)),
], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
