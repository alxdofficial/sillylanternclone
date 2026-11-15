import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const fixture = 'PRIVATE_TEST_VALUE';
const app = fileURLToPath(new URL('../server.mjs',import.meta.url));

test('server diagnostics identify upstream errors without recording request or provider text', async () => {
  const directory = await mkdtemp(join(tmpdir(),'story-studio-diagnostics-'));
  const listener = createServer();
  listener.listen(0,'127.0.0.1');
  await once(listener,'listening');
  const {port} = listener.address();
  await new Promise(resolve => listener.close(resolve));

  const mock = join(directory,'openrouter.mjs');
  await writeFile(mock,`
    globalThis.fetch = async () => new Response(${JSON.stringify(fixture)}, {status:401});
  `);
  const child = spawn(process.execPath,['--import',mock,app],{
    env:{...process.env, PORT:String(port), STORY_STUDIO_DATA:directory, STORY_STUDIO_LOG_DIR:join(directory,'logs')},
    stdio:['ignore','pipe','ignore']
  });
  const done = once(child,'exit');
  try {
    await Promise.race([
      once(child.stdout,'data',{signal:AbortSignal.timeout(5000)}),
      done.then(() => { throw Error('Server exited before listening.'); })
    ]);
    const origin = `http://127.0.0.1:${port}`;
    const headers = {origin,'content-type':'application/json'};
    const invalid = await fetch(origin+'/api/state',{method:'PUT',headers,body:fixture});
    assert.equal(invalid.status,400);
    const response = await fetch(origin+'/api/generate',{
      method:'POST',headers,body:JSON.stringify({
        project:{id:fixture,title:fixture,character:'',persona:'',lore:'',notes:'',messages:[]},
        instruction:fixture, key:fixture, provider:'openrouter',model:'custom/'+fixture
      })
    });
    assert.equal(response.status,500);
    assert.match((await response.json()).error,/OpenRouter returned 401/);

    const path = join(directory,'logs','server.log');
    let contents;
    for (let check=0; check<20; check++) {
      contents = await readFile(path,'utf8');
      if (contents.includes('OPENROUTER_HTTP_ERROR')) break;
      await delay(25);
    }
    const events = contents.trim().split('\n').map(line=>JSON.parse(line));
    assert.ok(events.some(event=>event.event==='started' && event.port===port));
    assert.ok(events.some(event=>event.code==='INVALID_JSON' && event.status===400));
    const failure = events.find(event=>event.code==='OPENROUTER_HTTP_ERROR');
    assert.equal(failure?.upstreamStatus,401);
    assert.equal(failure.model,'custom');
    assert.equal(failure.requestId,response.headers.get('x-story-studio-request-id'));
    assert.doesNotMatch(contents,new RegExp(fixture));
  } finally {
    child.kill();
    await done;
    await rm(directory,{recursive:true,force:true});
  }
});
