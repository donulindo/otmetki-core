import {PRODUCT_NAME} from './brand';
import {Document,Packer,Paragraph,TextRun,HeadingLevel,AlignmentType} from 'docx';
import type {UIMessage} from 'ai';
export function messageText(message:UIMessage) {return message.parts.filter(part=>part.type==='text').map(part=>part.text).join('\n');}
function inline(text:string) {return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(part=>new TextRun({text:part.startsWith('**')?part.slice(2,-2):part,bold:part.startsWith('**')}));}
export async function exportWord(title:string,messages:UIMessage[]) {
  const children:Paragraph[]=[new Paragraph({text:title,heading:HeadingLevel.TITLE}),new Paragraph({text:PRODUCT_NAME+' · Личная учебная беседа',spacing:{after:240}})];
  for(const message of messages) {
    const text=messageText(message);if(!text)continue;
    const partial=message.role==='assistant'&&((message.metadata||{}) as Record<string,unknown>).status!=='completed';
    children.push(new Paragraph({text:message.role==='user'?'Твой вопрос':partial?'Ответ помощника · черновик':'Ответ помощника',heading:HeadingLevel.HEADING_2,spacing:{before:240}}));
    for(const line of text.split('\n')) {
      const heading=/^(#{1,3})\s+(.+)$/.exec(line);
      if(heading)children.push(new Paragraph({children:inline(heading[2]),heading:heading[1].length===1?HeadingLevel.HEADING_1:HeadingLevel.HEADING_2}));
      else children.push(new Paragraph({children:inline(line.replace(/^[-*]\s+/,'• ')),spacing:{after:100,line:300}}));
    }
    const sources=message.parts.filter(part=>part.type==='source-document');
    if(sources.length) {children.push(new Paragraph({text:'Источники',heading:HeadingLevel.HEADING_3}));for(const source of sources)children.push(new Paragraph({text:source.title,spacing:{after:80}}));}
  }
  return Packer.toBuffer(new Document({creator:PRODUCT_NAME,title,styles:{default:{document:{run:{font:'Calibri',size:22},paragraph:{alignment:AlignmentType.LEFT}}}},sections:[{properties:{page:{margin:{top:1134,bottom:1134,left:1134,right:1134}}},children}]}));
}
