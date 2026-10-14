import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UIMessage, UIMessageChunk } from 'ai';
import { createPreviewChat } from '../../src/components/chat-client';

const start: UIMessageChunk[]=[
  {type:'start',messageId:'answer',messageMetadata:{model:'gpt-6.1-sol',effort:'medium',contextSources:[{id:'lecture',version:2}]}},
  {type:'text-start',id:'text'},
  {type:'text-delta',id:'text',delta:'Hello '},
];
const completed: UIMessageChunk[]=[...start,
  {type:'text-delta',id:'text',delta:'world'},
  {type:'text-end',id:'text'},
  {type:'source-document',sourceId:'lecture',mediaType:'text/plain',title:'Лекция · v2'},
  {type:'finish',messageMetadata:{model:'gpt-6.1-sol',effort:'medium',contextSources:[{id:'lecture',version:2}],status:'completed'}},
];
function response(chunks:UIMessageChunk[],disconnect=false){
  let index=0;const encoder=new TextEncoder();
  const stream=new ReadableStream<Uint8Array>({async pull(controller){
    if(index<chunks.length){controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunks[index++])}\n\n`));return;}
    if(disconnect){await new Promise(resolve=>setTimeout(resolve,25));controller.error(new TypeError('network failed'));}
    else {controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();}
  }});
  return new Response(stream,{headers:{'Content-Type':'text/event-stream','x-vercel-ai-ui-message-stream':'v1'}});
}
function texts(messages:UIMessage[]){return messages.filter(message=>message.role==='assistant').flatMap(message=>message.parts.filter(part=>part.type==='text').map(part=>part.text));}

test('the real preview chat transport replaces partial text when the server replays a response',async()=>{
  const calls:{url:string;method:string}[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
    calls.push({url:String(input),method:init?.method??'GET'});
    return init?.method==='POST'?response(start,true):response(completed);
  };
  const chat=createPreviewChat({id:'resume-test',messages:[],fetcher});
  await chat.sendMessage({text:'Question'});
  assert.deepEqual(texts(chat.messages),['Hello ']);
  await chat.resumeStream();
  assert.deepEqual(texts(chat.messages),['Hello world']);
  assert.equal(chat.messages.filter(message=>message.role==='assistant').length,1);
  assert.equal(chat.messages.filter(message=>message.role==='user').length,1);
  const answer=chat.messages.find(message=>message.role==='assistant')!;
  assert.equal(answer.parts.filter(part=>part.type==='source-document').length,1);
  assert.deepEqual((answer.metadata as {contextSources:unknown}).contextSources,[{id:'lecture',version:2}]);
  assert.equal(calls.filter(call=>call.method==='POST').length,1,'resuming must not submit another model request');
  assert.equal(calls[1].url,'/api/chat/resume-test/stream');
});

test('reattaching from persisted partial history also avoids duplicate text and preserves earlier turns',async()=>{
  const history:UIMessage[]=[{id:'previous',role:'assistant',parts:[{type:'text',text:'Earlier answer'}]},{id:'user',role:'user',parts:[{type:'text',text:'Question'}]},{id:'answer',role:'assistant',parts:[{type:'text',text:'Hello ',state:'streaming'}]}];
  let requests=0;
  const chat=createPreviewChat({id:'reload-test',messages:history,fetcher:async()=>{requests++;return response(completed);}});
  await chat.resumeStream();
  assert.deepEqual(texts(chat.messages),['Earlier answer','Hello world']);
  assert.equal(chat.messages.filter(message=>message.id==='answer').length,1);
  assert.equal(requests,1);
});
