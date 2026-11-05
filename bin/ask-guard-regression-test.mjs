// Local regression tests: synthetic transcripts plus permission-boundary tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import extension, { classify, findQuestion, note } from '../extensions/ask-guard.ts';
const u = text => ({ role: 'user', text });
const a = text => ({ role: 'assistant', text });
const guard = {role:'custom',customType:'ask-guard',text:'Prior guard note'};
for (const fixture of JSON.parse(readFileSync(new URL('./ask-guard-fixtures.json',import.meta.url)))) {
 test(`source transcript ${fixture.name}`, () => assert.equal(classify(fixture.messages)?.kind ?? null,fixture.expected));
}
const cases = [
 ['bold imperative local approval','low-risk',[u('fix the local skill'),a('**Approve this local update?**')]],
 ['without plan approval','low-risk',[u('Do it without plan approval. Stop and ask before a push or merge.'),a('Do you want this note?')]],
 ['no plan approval','low-risk',[u('No plan approval is needed.'),a('Do you want me to run the tests?')]],
 ['read-only PR status','low-risk',[u('check my PR'),a('Do you want me to check the status of PR #12?')]],
 ['read-only repo search','low-risk',[u('find the definition'),a('Do you want me to search the repository?')]],
 ['read then push needs approval',undefined,[u('check my PR'),a('Do you want me to check PR #12 and push a fix?')]],
 ['explicit plan gate',undefined,[u('Show me the plan first.'),a('**Approve this plan?**')]],
 ['first push is not low risk',undefined,[u('Can you fix the failed checks on PR #4153?'),a('**Approve this push, with no merge?**')]],
 ['approved push asked again','repeat',[u('fix PR #4153'),a('Push the fix to PR #4153?'),u('yes, no merge'),a('**Approve this push, with no merge?**')]],
 ['direct push request','repeat',[u('Push the fix to PR #4153. Do not merge.'),a('Approve this push to PR #4153?')]],
 ['local-only reply grants no push',undefined,[u('fix X'),a('Do you want me to push PR #12?'),u('yes, but local only'),a('Approve this push to PR #12?')]],
 ['selected local option grants no push',undefined,[u('fix X'),a('1. Keep the fix local.\n2. Push PR #12.\nChoose 1 or 2.'),u('1'),a('Approve this push to PR #12?')]],
 ['note approval grants no push',undefined,[u('fix X'),a('PR #12 is ready to push. Do you want this note?'),u('yes'),a('Approve this push to PR #12?')]],
 ['later wait stops push',undefined,[u('fix X'),a('Do you want me to push PR #12?'),u('yes'),u('Please wait for review.'),a('Approve this push to PR #12?')]],
 ['no merge means no merge',undefined,[u('fix PR #12'),a('Do you want me to push the fix to PR #12?'),u('yes, no merge'),a('Do you approve the merge of PR #12?')]],
 ['PR only means no merge',undefined,[u('open PR #12'),a('Do you want me to push and open PR #12?'),u('yes, PR only'),a('Do you approve the merge of PR #12?')]],
 ['approved plan says stop',undefined,[u('fix X'),a('I will push PR #12 and stop. Do you approve the plan?'),u('yes'),a('Do you approve the merge of PR #12?')]],
 ['later revocation',undefined,[u('fix PR #12'),a('Do you want me to push and merge PR #12?'),u('yes'),u('Wait. Do not merge.'),a('Do you approve the merge of PR #12?')]],
 ['different repo same number',undefined,[u('fix X'),a('Do you approve the merge of https://github.com/one/repo/pull/12?'),u('yes'),a('Do you approve the merge of https://github.com/two/repo/pull/12?')]],
 ['same approved PR merge','repeat',[u('fix PR #12'),a('Do you want me to push and open PR #12?'),u('yes'),a('Do you approve the merge of PR #12?')]],
 ['do not infer approval from status',undefined,[u('status PR #12'),a('It is green.'),u('so what now'),a('Do you approve the merge of PR #12?')]],
 ['second low-risk offer is checked','low-risk',[u('save a note'),a('Do you want this note?'),guard,a('Shall I save it locally?')]],
 ['two nudges stop repetition',undefined,[u('save a note'),a('Do you want this note?'),guard,a('Shall I save it locally?'),guard,a('Do you want this note?')]],
 ['real risk after first nudge',undefined,[u('save a note'),a('Do you want this note?'),guard,a('This writes a shared file. Do you want me to publish it?')]],
];
for(const [name,want,msgs] of cases) test(name,()=>assert.equal(classify(msgs)?.kind,want));
test('imperative formatting is detected even for protected high-risk questions',()=>assert.ok(findQuestion('**Approve this push, with no merge?**')));
test('repeat note preserves scope rather than granting merge authority',()=>{
 const text=note({kind:'repeat',question:'Approve this push, with no merge?'});
 assert.doesNotMatch(text,/Merge when the checks pass/);
 assert.match(text,/no.merge|limits|scope/i);
});
test('real boundary callback continues after a passing final reply, preserving prior entries',async()=>{
 const callbacks=new Map();
 extension({on:(name,fn)=>callbacks.set(name,fn)});
 const handler=callbacks.get('agent_before_settle');
 assert.ok(handler);
 const prior={type:'custom',customType:'other',data:{keep:true}};
 const event={outcome:'completed',entries:[prior],context:{canContinue:false,contextMessages:[
  {role:'user',content:'Do it without plan approval.'},
  {role:'assistant',content:[{type:'text',text:'**Approve this local update?**'}]}
 ]}};
 const result=await handler(event,{cwd:'C:/tmp/ask-guard-retro',ui:{notify(){}}});
 assert.equal(result?.continue,true);
 assert.equal(result.entries[0],prior);
 assert.equal(result.entries[1].customType,'ask-guard');
 const ignored=await handler({...event,outcome:'aborted'},{cwd:'C:/tmp'});
 assert.equal(ignored,undefined);
});
