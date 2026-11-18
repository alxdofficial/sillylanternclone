import assert from 'node:assert/strict';
import test from 'node:test';
import { artworkImageModel, generateArtwork, requestArtworkImage } from '../artwork-generation.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+fuoQAAAAASUVORK5CYII=';
const dataUrl = 'data:image/png;base64,' + png;
const imageResult = () => ({image:Buffer.from(png,'base64'),mime:'image/png'});
const subject = (kind,name) => ({kind,name});
function submit(params) {
  return {role:'assistant',tool_calls:[{id:'plan',type:'function',
    function:{name:'submit_artwork_plan',arguments:JSON.stringify(params)}}]};
}

test('scene artwork creates missing references first and reuses saved subject images in plan order',async()=>{
  const generated = [], calls = [], filesRead = [];
  const result = await generateArtwork({
    kind:'comic',passage:'Lina raised the lamp and reached the glasshouse.',
    style:'Ink linework with muted washes',
    canon:{title:'Evening Signal',lore:'The glasshouse overlooks the sea.',cast:[{name:'Lina',description:'Wool coat and red scarf.'}]},
    availableRefs:[
      {id:'lina-before',subject:subject('character','Lina'),loadDataUrl() { assert.fail('Only the latest matching image should load'); }},
      {id:'lina-saved',subject:subject('character','lina'),async loadDataUrl() { filesRead.push('lina-saved'); return dataUrl; }},
      {id:'pier-unused',subject:subject('location','Pier'),loadDataUrl() { assert.fail('An unused reference should not load'); }}
    ],
    async complete({messages,tools}) {
      assert.equal(tools[0].function.name,'submit_artwork_plan');
      assert.match(messages[0].content,/safe-for-work/u);
      const user = JSON.parse(messages[1].content);
      assert.equal(user.canon.world,'The glasshouse overlooks the sea.');
      assert.deepEqual(user.existingReferences,[subject('character','lina'),subject('location','Pier')]);
      assert.doesNotMatch(messages[1].content,/base64|lina-saved/u);
      return submit({label:'A light in the glasshouse',prompt:'Three panels show Lina approach the glasshouse and lift the lamp.',subjects:[
        {...subject('location','Glasshouse'),description:'A Victorian glass greenhouse overlooking the sea.'},
        {...subject('character','Lina'),description:'An adult with a wool coat and a red scarf.'},
        {...subject('object','Lamp'),description:'A compact brass lantern with a curved handle.'}
      ]});
    },
    async generateImage(request) { calls.push(request); return imageResult(); },
    onImage(item) { generated.push(item.id); }
  });
  assert.deepEqual(calls.map(call=>call.kind),['reference','reference','comic']);
  assert.deepEqual(calls.map(call=>call.references.length),[0,0,3]);
  assert.match(calls[2].prompt,/1\. Glasshouse; 2\. lina; 3\. Lamp/u);
  assert.match(calls[2].prompt,/clear gutters/u);
  assert.match(calls[2].prompt,/Leave out nudity, sexual imagery, graphic injury, and gore\./u);
  assert.deepEqual(result.map(item=>item.id),generated);
  assert.deepEqual(result.map(item=>item.kind),['reference','reference','comic']);
  assert.deepEqual(result[2].references,[result[0].id,'lina-saved',result[1].id]);
  assert.deepEqual(filesRead,['lina-saved']);
  assert.deepEqual(result[0].subject,subject('location','Glasshouse'));
  assert.ok(result.every(item=>item.image instanceof Uint8Array && item.mime === 'image/png'));
});

test('a reference art request validates its subject and rejects a malformed plan before charging for an image',async()=>{
  let plannerCalls = 0, imageCalls = 0;
  const options = {
    kind:'reference',subject:subject('object','Brass lantern'),canon:{title:'Evening Signal'},
    async complete({messages}) {
      plannerCalls++;
      assert.deepEqual(JSON.parse(messages[1].content).subject,subject('object','Brass lantern'));
      if (plannerCalls === 1) return submit({label:'Lantern',prompt:'Brass lantern on a neutral background.',subjects:[],extra:'unexpected'});
      assert.match(messages.at(-1).content,/schema/u);
      return submit({label:'Lantern',prompt:'Brass lantern on a neutral background.',subjects:[]});
    },
    async generateImage(request) { imageCalls++; assert.deepEqual(request.references,[]); return imageResult(); }
  };
  await assert.rejects(generateArtwork({...options,subject:{kind:'unknown',name:'Lantern'}}),{diagnosticCode:'ARTWORK_INVALID_REQUEST'});
  assert.equal(plannerCalls,0);
  const [reference] = await generateArtwork(options);
  assert.equal(plannerCalls,2);
  assert.equal(imageCalls,1);
  assert.deepEqual(reference.subject,options.subject);
});

test('an unknown character plan cannot trigger a paid call',async()=>{
  await assert.rejects(generateArtwork({
    kind:'illustration',passage:'The sea darkened.',canon:{cast:[{name:'Lina',description:'Red scarf.'}]},
    complete:async()=>submit({label:'Evening sea',prompt:'An editorial illustration of the evening sea.',subjects:[
      {...subject('character','Invented Person'),description:'A figure with a plain grey coat.'}
    ]}),
    generateImage() { assert.fail('Image generation must wait for a validated plan'); }
  }),{diagnosticCode:'ARTWORK_PLAN_FAILED'});
});

test('image requests pin the OpenRouter model and provider, accept only data references, and track returned usage',async()=>{
  const usage = [];
  const image = await requestArtworkImage({
    key:'fake-test-key',kind:'illustration',prompt:'A lantern near the glasshouse.',references:[dataUrl],
    onUsage(record) { usage.push(record); },
    async fetchImage(url,options) {
      assert.equal(url,'https://openrouter.ai/api/v1/images');
      assert.equal(options.redirect,'error');
      assert.equal(options.headers.authorization,'Bearer fake-test-key');
      const payload = JSON.parse(options.body);
      assert.equal(payload.model,artworkImageModel);
      assert.equal(payload.resolution,'1K');
      assert.equal(payload.output_format,'jpeg');
      assert.deepEqual(payload.provider,{only:['black-forest-labs'],allow_fallbacks:false,data_collection:'deny'});
      assert.deepEqual(payload.input_references,[{type:'image_url',image_url:{url:dataUrl}}]);
      return Response.json({data:[{b64_json:png,media_type:'image/png'}],usage:{cost:0.009}});
    }
  });
  assert.deepEqual(image,imageResult());
  assert.deepEqual(usage,[{provider:'openrouter',model:artworkImageModel,result:{model:undefined,usage:{cost:0.009}}}]);
  await assert.rejects(requestArtworkImage({
    key:'fake-test-key',kind:'illustration',prompt:'A lantern.',references:['https://example.invalid/example.png'],
    fetchImage() { assert.fail('External images must never be sent to OpenRouter'); }
  }),{diagnosticCode:'ARTWORK_INVALID_REFERENCE'});
});

test('malformed image output, oversized responses and provider rejection get safe errors',async()=>{
  const options = {key:'fake-test-key',kind:'reference',prompt:'A brass lantern.'};
  await assert.rejects(requestArtworkImage({...options,fetchImage:async()=>Response.json({
    data:[{b64_json:png,media_type:'image/svg+xml'}]
  })}),{diagnosticCode:'ARTWORK_INVALID_IMAGE'});
  await assert.rejects(requestArtworkImage({...options,fetchImage:async()=>new Response('x',{
    headers:{'content-length':'99999999'}
  })}),{diagnosticCode:'ARTWORK_IMAGE_TOO_LARGE'});
  await assert.rejects(requestArtworkImage({...options,fetchImage:async()=>new Response('internal test data',{status:403})}),
    {diagnosticCode:'ARTWORK_IMAGE_HTTP_ERROR',message:'OpenRouter returned 403. Check your OpenRouter image permissions.'});
});
