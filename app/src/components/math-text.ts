/** Adapt standard LaTeX delimiters for remark-math without rewriting stored text. */
export function normalizeMathDelimiters(text:string) {
  const chunks=text.split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`{1,2}[^`\n]*(?:`{1,2}|$))/g);
  return chunks.map((chunk,index)=>index%2===1?chunk:chunk
    .replace(/(?<!\\)\\\[/g,()=> '\n$$\n')
    .replace(/(?<!\\)\\\]/g,()=> '\n$$\n')
    .replace(/(?<!\\)\\\(/g,()=> '$')
    .replace(/(?<!\\)\\\)/g,()=> '$')).join('');
}
