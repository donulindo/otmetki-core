import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MaterialDetail from '../../src/components/MaterialDetail';
import MaterialLibrary from '../../src/components/MaterialLibrary';
import type { Material, Subject } from '../../src/lib/types';

const subject:Subject={id:'fixture',name:'Учебный курс',shortName:'Курс',direction:'management',group:'TEST',semester:1,color:'#111'};
const document:Material={id:'source-fixture',ownerId:'fixture-owner',title:'Материал курса',subjectId:subject.id,kind:'lecture',topic:'Тема',filename:'program.pdf',mimeType:'application/pdf',size:2400,version:3,status:'limited',warnings:[],blocks:[],pageCount:1,sourceUrl:'https://example.org/program',createdAt:'2030-01-01',updatedAt:'2030-01-01',hash:'synthetic',duplicateOf:null,isExample:false};
const detail=(material:Material)=>renderToStaticMarkup(createElement(MaterialDetail,{material,onClose(){},onUpdate(){},onFeedback(){}}));
const library=(material:Material)=>renderToStaticMarkup(createElement(MaterialLibrary,{subjects:[subject],materials:[material],subjectId:'',onSubjectChange(){},onRefresh:async()=>{},onOpen(){},onFeedback(){}}));

test('downloaded document retains attribution and current-version original without claiming link-only',()=>{
 const html=detail(document);
 assert.ok(html.includes('Скачать оригинал'));
 assert.ok(html.includes('Открыть источник'));
 assert.ok(html.includes('/file?version=3&amp;download=1'));
 assert.ok(html.includes('>Оригинал<'));
 assert.ok(!html.includes('Сохранена ссылка'));
 assert.ok(!html.includes('Для работы с содержимым добавь файл'));
});
test('unavailable external resource never offers a nonexistent local file',()=>{
 const linked={...document,mimeType:'text/uri-list',size:0,hash:''};
 const html=detail(linked);
 assert.ok(html.includes('Сохранена ссылка'));
 assert.ok(html.includes('Открыть источник'));
 assert.ok(!html.includes('Скачать оригинал'));
 assert.ok(!library(linked).includes('/api/materials/source-fixture/file'));
});
test('library card exposes original even when extraction is limited and attribution exists',()=>{
 const html=library(document);
 assert.ok(html.includes('/api/materials/source-fixture/file'));
 assert.ok(html.includes('aria-label="Скачать Материал курса"'));
 assert.ok(!html.includes('Только ссылка'));
 assert.ok(!html.includes('Сохранённый источник'));
});
test('a structured text page with attribution never promises a missing original',()=>{const page={...document,mimeType:'text/plain',hasOriginal:false,blocks:[{id:'body',kind:'text' as const,text:'Structured source text'}]};const html=detail(page);assert.ok(html.includes('Открыть источник'));assert.ok(!html.includes('Скачать оригинал'));assert.ok(!library(page).includes('/api/materials/source-fixture/file'));});
