import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundedContext,buildContext,contextTXT} from '../src/lib/context';
import type {Material,TextBlock} from '../src/lib/types';

function material(id:string,blocks:TextBlock[],changes:Partial<Material>={}):Material {
  return {id,ownerId:'test-owner',title:`Лекция ${id}`,subjectId:'management-math',kind:'lecture',topic:'',filename:`${id}.txt`,mimeType:'text/plain',size:0,version:1,status:'ready',warnings:[],blocks,pageCount:0,sourceUrl:null,createdAt:'2026-10-12T12:00:00Z',updatedAt:'2026-10-12T12:00:00Z',hash:id,duplicateOf:null,isExample:false,...changes};
}
const definition='Производная функции показывает скорость изменения её значения в данной точке.';
const block=(id:string,text:string,kind:TextBlock['kind']='text'):TextBlock=>({id,text,kind});

test('confirmed prose repetition keeps all immutable source references without changing originals',()=>{
  const first=material('first',[{...block('b1',definition),page:3}],{version:2});
  const second=material('second',[{...block('b2',definition.replaceAll(' ','\n')),slide:7}],{version:4});
  const before=JSON.stringify([first,second]);
  const context=buildContext([first,second]);
  assert.equal(context.blocks.length,1);assert.equal(context.duplicateCount,1);
  assert.deepEqual(context.blocks[0].sources.map(s=>[s.materialId,s.version,s.page,s.slide]),[['first',2,3,undefined],['second',4,undefined,7]]);
  assert.equal(context.blocks[0].text,definition);assert.equal(JSON.stringify([first,second]),before);
  const txt=contextTXT([first,second]);
  assert.equal(txt.split(definition).length-1,1);assert.ok(txt.includes('Лекция first · v2 · стр. 3'));assert.ok(txt.includes('Лекция second · v4 · слайд 7'));
});

test('changed signs, numbers and negations remain independent statements',()=>{
  const source='Условие решения: x ≠ 14; y ≤ −2,5. Не меняйте заданные значения.';
  const variants=[source,source.replace('≠','='),source.replace('14','15'),source.replace('Не меняйте','Меняйте')];
  const context=buildContext(variants.map((text,i)=>material(String(i),[block('condition',text,'formula')])));
  assert.equal(context.duplicateCount,0);assert.deepEqual(context.blocks.map(b=>b.text),variants);
});

test('same Russian statement under different mathematical or verbal conditions is not moved out of its scope',()=>{
  for(const [firstCondition,secondCondition] of [
    ['Если x > 0','Если x < 0'],
    ['При y = 14','При y = 15'],
    ['Для варианта 1','Для варианта 2'],
    ['Если работа письменная','Если работа устная'],
  ]) {
    const context=buildContext([
      material('a',[block('condition-a',firstCondition),block('body-a',definition)]),
      material('b',[block('condition-b',secondCondition),block('body-b',definition)]),
    ]);
    assert.equal(context.blocks.filter(b=>b.text===definition).length,2,`${firstCondition} / ${secondCondition}`);
    assert.equal(context.duplicateCount,0);
  }
});

test('same statements with the same qualifier still deduplicate',()=>{
  const context=buildContext([
    material('a',[block('condition-a','Если x > 0'),block('body-a',definition)]),
    material('b',[block('condition-b','Если x > 0'),block('body-b',definition)]),
  ]);
  assert.equal(context.blocks.filter(b=>b.text===definition).length,1);assert.equal(context.duplicateCount,1);
});

test('dedup retains a warning present only on a secondary source',()=>{
  const context=buildContext([
    material('a',[block('first',definition)]),
    material('b',[{...block('second',definition),warning:'Проверьте точность формулировки.'}]),
  ]);
  assert.equal(context.duplicateCount,1);assert.equal(context.blocks[0].warning,'Проверьте точность формулировки.');
  assert.ok(contextTXT([material('a',[block('first',definition)]),material('b',[{...block('second',definition),warning:'Проверьте точность формулировки.'}])]).includes('Пометка: Проверьте точность формулировки.'));
});

test('table row and cell layout is significant even with identical flattened text',()=>{
  const table='00001 | 00002\n00003 | 00004';
  const flattened='00001 | 00002 00003 | 00004';
  const context=buildContext([material('rows',[block('t1',table,'table')]),material('cells',[block('t2',flattened,'table')])]);
  assert.equal(context.duplicateCount,0);assert.deepEqual(context.blocks.map(b=>b.text),[table,flattened]);
  const sameRows=buildContext([material('unix',[block('t1',table,'table')]),material('windows',[block('t2',table.replaceAll('\n','\r\n'),'table')])]);
  assert.equal(sameRows.duplicateCount,1);assert.equal(sameRows.blocks[0].text,table);
});

test('multiline formulas and their alignment do not collapse into a different expression',()=>{
  const rows='a_{first} = x_{first}\na_{second} = x_{second}';
  const inline='a_{first} = x_{first} a_{second} = x_{second}';
  const aligned='a_{first} = x_{first}\ta_{second} = x_{second}';
  const context=buildContext([rows,inline,aligned].map((text,i)=>material(String(i),[block('f',text,'formula')])));
  assert.equal(context.duplicateCount,0);assert.deepEqual(context.blocks.map(b=>b.text),[rows,inline,aligned]);
});

test('other subjects and block kinds are not treated as interchangeable sources',()=>{
  const context=buildContext([
    material('prose',[block('text',definition)]),
    material('table',[block('table',definition,'table')]),
    material('other-course',[block('text',definition)],{subjectId:'economics-math'}),
  ]);
  assert.equal(context.duplicateCount,0);assert.equal(context.blocks.length,3);
});

test('only explicitly supplied ready materials enter context; empty and not-ready sources contribute no text',()=>{
  const selected=material('selected',[block('public',definition),block('empty',' \n\t ')]);
  const excluded=material('excluded',[block('excluded','Неподключённый источник не должен попасть в контекст.')]);
  const context=buildContext([selected]);
  assert.equal(context.blocks.length,1);assert.ok(!JSON.stringify(context).includes(excluded.id));assert.ok(!contextTXT([selected]).includes(excluded.blocks[0].text));
  assert.deepEqual(buildContext([]),{blocks:[],duplicateCount:0,warnings:[]});
  for(const status of ['queued','extracting','error'] as const){
    const source=material(status,[block('private','Не готовый текст')],{status});
    const unavailable=buildContext([source]);
    assert.equal(unavailable.blocks.length,0);assert.equal(unavailable.warnings.length,1);
    assert.ok(!contextTXT([source]).includes('текст готов'));assert.ok(!contextTXT([source]).includes('Не готовый текст'));
  }
  const partial=buildContext([material('partial',[block('readable',definition)],{status:'limited',warnings:['Формула пока неразборчива.']})]);
  assert.equal(partial.blocks[0].text,definition);assert.ok(partial.warnings.some(w=>w.includes('Формула пока неразборчива')));
});

test('bounded context paginates whole blocks and explicitly marks an oversized unread block',()=>{
  const context=buildContext([material('source',[block('one','Первое целое условие.'),block('two','Второе целое условие.'),block('large','x'.repeat(200))])]);
  const first=boundedContext(context.blocks,0,30);
  assert.deepEqual(first.blocks.map(b=>b.text),['Первое целое условие.']);assert.equal(first.nextOffset,1);
  const second=boundedContext(context.blocks,first.nextOffset!,30);
  assert.deepEqual(second.blocks.map(b=>b.text),['Второе целое условие.']);assert.equal(second.nextOffset,2);
  const last=boundedContext(context.blocks,second.nextOffset!,30);
  assert.equal(last.blocks.length,1);assert.ok(last.blocks[0].warning?.includes('не прочитан целиком'));assert.equal(last.nextOffset,null);assert.equal(last.totalBlocks,3);assert.equal(context.blocks[2].text.length,200);
  assert.deepEqual(boundedContext([],0,30),{blocks:[],nextOffset:null,totalBlocks:0});
});

test('a condition remains effective beyond two intervening paragraphs',()=>{
  const middle=[block('explanation','Промежуточное объяснение с несколькими обычными словами.'),block('step','Следующий шаг вычисления описывается отдельным абзацем.'),block('proof','Обоснование продолжается ещё в одном блоке материала.')];
  const context=buildContext([
    material('a',[block('condition','Если x > 0'),...middle,block('result',definition)]),
    material('b',[block('condition','Если x < 0'),...middle,block('result',definition)]),
  ]);
  assert.equal(context.blocks.filter(b=>b.text===definition).length,2);
  assert.equal(context.duplicateCount,0);
});
