import type {Material, TextBlock} from './types';
import {createHash} from 'node:crypto';

export interface SourceRef {materialId: string; title: string; version: number; blockId: string; page?: number; slide?: number;}
export interface ContextBlock {text: string; kind: TextBlock['kind']; sources: SourceRef[]; warning?: string;}
export function normalizeText(text: string, kind: TextBlock['kind'] = 'text') {
  const normalized = text.normalize('NFC').replace(/\r\n?/gu, '\n');
  // Rows, alignment and spacing may carry meaning in tables and formulas.
  // Be conservative: equivalent prose wrapping is safe, structured reflow is not.
  return kind === 'table' || kind === 'formula'
    ? normalized.trim()
    : normalized.replace(/\s+/gu, ' ').trim();
}
function conditionalScopes(blocks: TextBlock[]) {
  let chain='';
  return blocks.map(block=>{
    // Without a section-boundary parser, retain every earlier qualifier.
    if(/(?:^|[^\p{L}\p{N}_])(?:услови\p{L}*|при|если|вариант\p{L}*|для|if|when|case|condition\p{L}*)(?=$|[^\p{L}\p{N}_])/iu.test(block.text))
      chain=createHash('sha256').update(JSON.stringify([chain,block.kind,normalizeText(block.text,block.kind)])).digest('hex');
    return chain;
  });
}
/** Exact repetitions only. Changes in signs, numbers or applicability remain independent blocks. */
export function buildContext(materials: Material[]): {blocks: ContextBlock[]; duplicateCount: number; warnings: string[]} {
  const unique = new Map<string,ContextBlock>(); let duplicateCount = 0;
  const warnings: string[] = [];
  for (const material of materials) {
    if (material.status === 'error' || material.status === 'queued' || material.status === 'extracting') {
      warnings.push(`${material.title}: текст ещё не готов.`); continue;
    }
    for (const warning of material.warnings) warnings.push(`${material.title}: ${warning}`);
    const scopes=conditionalScopes(material.blocks);
    material.blocks.forEach((block,index) => {
      const normalized = normalizeText(block.text, block.kind);
      if (!normalized) return;
      const source: SourceRef = {materialId: material.id, title: material.title, version: material.version, blockId: block.id, page: block.page, slide: block.slide};
      const key = JSON.stringify([material.subjectId,block.kind,normalized,scopes[index], normalized.length < 24 ? `${material.id}:${index}` : '']);
      const known = unique.get(key);
      if (known) {
        known.sources.push(source);
        if (block.warning) known.warning = [...new Set([known.warning, block.warning].filter(Boolean))].join('; ');
        duplicateCount++;
      }
      else unique.set(key,{text: block.text,kind: block.kind,sources:[source],warning:block.warning});
    });
  }
  return {blocks:[...unique.values()],duplicateCount,warnings:[...new Set(warnings)]};
}
export function contextTXT(materials: Material[]) {
  const context = buildContext(materials);
  const statuses: Record<Material['status'], string> = {ready:'текст готов',limited:'есть ограничения',queued:'в очереди',extracting:'получаем текст',error:'ошибка обработки'};
  let text = 'ОТМЕТКИ · ВЫБРАННЫЕ УЧЕБНЫЕ МАТЕРИАЛЫ\n\n';
  text += materials.map(m=>`${m.title} · версия ${m.version} · ${statuses[m.status]}`).join('\n')+'\n\n';
  if (context.warnings.length) text += 'ОГРАНИЧЕНИЯ\n'+context.warnings.map(w=>'- '+w).join('\n')+'\n\n';
  text += `Убрано подтверждённых повторов: ${context.duplicateCount}. Оригиналы сохранены.\n\n`;
  for (const block of context.blocks) {
    text += 'Источники: '+block.sources.map(s=>`${s.title} · v${s.version}${s.page ? ' · стр. '+s.page : ''}${s.slide ? ' · слайд '+s.slide : ''} · блок ${s.blockId}`).join('; ')+'\n';
    if (block.warning) text += 'Пометка: '+block.warning+'\n';
    text += block.text+'\n\n';
  }
  return text;
}
export function boundedContext(blocks: ContextBlock[], offset = 0, maxChars = 40000) {
  const selected: ContextBlock[] = []; let chars = 0, index = offset;
  while (index < blocks.length) {
    const block = blocks[index];
    if (selected.length && chars + block.text.length > maxChars) break;
    if (block.text.length > maxChars) {
      // Do not silently clip a condition or formula. Agent must open the original material.
      selected.push({...block, text:'[Фрагмент слишком велик для одной порции. Открой исходный материал.]', warning:'Текст этого фрагмента не прочитан целиком.'});index++;break;
    }
    selected.push(block);chars += block.text.length;index++;
  }
  return {blocks:selected,nextOffset:index < blocks.length ? index : null,totalBlocks:blocks.length};
}
