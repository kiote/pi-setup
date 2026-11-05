// Real Pi loader/session tests. Fake model output; no provider calls or user credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { piRoot } from './pi-root.mjs';
const sdkRoot = pathToFileURL(piRoot()).href + '/';
const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import(sdkRoot + 'dist/bundle/index.js');
const { createAssistantMessageEventStream } = await import(sdkRoot + 'node_modules/@earendil-works/pi-ai/dist/index.js');

for (const safe of [true, false]) {
 test(safe ? 'real Pi continues a low-risk offer and executes the local write' : 'real Pi preserves a first push approval request', {timeout:30000}, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ask-guard-runtime-'));
  const runtime = await ModelRuntime.create({ authPath: join(dir,'auth.json'), modelsPath:null, refreshOnCreate:false, allowModelNetwork:false });
  const model = runtime.getModels('openai').find(m=>m.api==='openai-completions') || runtime.getModels('openai')[0];
  assert.ok(model);
  await runtime.setRuntimeApiKey(model.provider,'fake-never-sent');
  const settingsManager = SettingsManager.inMemory({retry:{enabled:false}, compaction:{enabled:false}});
  const loader = new DefaultResourceLoader({cwd:dir,agentDir:join(dir,'agent'),settingsManager,
    noExtensions:true,additionalExtensionPaths:[fileURLToPath(new URL('../extensions/ask-guard.ts',import.meta.url))],
    noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors,[]);
  const manager = SessionManager.inMemory(dir);
  const {session} = await createAgentSession({cwd:dir,agentDir:join(dir,'agent'),modelRuntime:runtime,model,resourceLoader:loader,settingsManager,sessionManager:manager});
  const errors=[];
  await session.bindExtensions({mode:'json',onError:e=>errors.push(e)});
  t.after(async()=>{await session.abort();session.dispose();rmSync(dir,{recursive:true,force:true});});
  let requests=0, feedbackSeen=false;
  runtime.streamSimple=()=>{throw new Error('Network forbidden');};
  session.agent.streamFunction=(_model,context)=>{
    requests++;
    if(context.messages.some(m=>JSON.stringify(m).includes('ask-guard:'))) feedbackSeen=true;
    assert.ok(requests <= (safe?3:1));
    const tool=safe&&requests===2;
    const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),
      usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
      stopReason:tool?'toolUse':'stop', content:tool?[{type:'toolCall',id:'local-write',name:'write',arguments:{path:join(dir,'note.txt'),content:'checked'}}]:[{type:'text',text:requests===1?(safe?'**Approve this local update?**':'**Approve this push, with no merge?**'):'The local note is saved.'}]};
    const stream=createAssistantMessageEventStream();
    queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:message.stopReason,message});});
    return stream;
  };
  await session.prompt(safe?'Write note.txt locally. Do it without plan approval.':'Fix the failed checks on PR #4153 locally. Ask before a push.');
  assert.deepEqual(errors,[]);
  assert.equal(requests,safe?3:1);
  assert.equal(feedbackSeen,safe);
  assert.equal(existsSync(join(dir,'note.txt')),safe);
  if(safe) assert.equal(readFileSync(join(dir,'note.txt'),'utf8'),'checked');
 });
}
