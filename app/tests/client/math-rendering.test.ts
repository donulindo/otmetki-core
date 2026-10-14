import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {normalizeMathDelimiters} from '../../src/components/math-text';

test('actual model LaTeX delimiters render with the installed Streamdown math plugin',async()=>{
  const text=String.raw`Условие \(x\ne 0\) сохраняется.\[f(2)=\frac{2^2-1}{2}=\frac{3}{2}=1{,}5.\]`;
  const adapted=normalizeMathDelimiters(text);
  assert.ok(adapted.includes(String.raw`$x\ne 0$`));
  assert.ok(adapted.includes(String.raw`\frac{3}{2}`));
  const [{Streamdown},{createMathPlugin}]=await Promise.all([import('streamdown'),import('@streamdown/math')]);
  const html=renderToStaticMarkup(createElement(Streamdown,{mode:'static',plugins:{math:createMathPlugin({singleDollarTextMath:true})},children:adapted}));
  assert.match(html,/class="katex/);
  assert.match(html,/<math/);
  assert.match(html,/katex-display/);
  assert.match(html,/<mo[^>]*>≠<\/mo>/,'the mathematical inequality must remain visible');
});

test('delimiter adaptation preserves code, literals, partial fences and mathematical content',()=>{
  const code='```tex\n'+String.raw`\[x\ne 14\]`+'\n```';
  const inline='`'+String.raw`\(x\)`+'`';
  const literal=String.raw`\\(не формула\\)`;
  assert.equal(normalizeMathDelimiters(code),code);
  assert.equal(normalizeMathDelimiters(inline),inline);
  assert.equal(normalizeMathDelimiters(literal),literal);
  const unfinished='```tex\n'+String.raw`\[x\ne 14`;
  assert.equal(normalizeMathDelimiters(unfinished),unfinished);
  assert.equal(normalizeMathDelimiters(String.raw`\(x \ne 14, y = -2\)`),String.raw`$x \ne 14, y = -2$`);
  assert.equal(normalizeMathDelimiters('Текст без формул. $20 и [ссылка].'),'Текст без формул. $20 и [ссылка].');
});
