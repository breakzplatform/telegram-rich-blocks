import { expect, test } from 'bun:test';
import { markdown, inline, parseInput } from '../src/markdown';

test('paragraphs, headings, mentions and hashtags', () => {
  expect(markdown('# Title\n\n## Small\n\nHi @someone #tag')).toEqual({blocks:[
    {type:'heading',size:1,text:'Title'}, {type:'heading',size:2,text:'Small'}, {type:'paragraph',text:'Hi @someone #tag'}]});
});
for (const [source,type] of [['**x**','bold'],['*x*','italic'],['_x_','italic'],['__x__','underline'],['~~x~~','strikethrough'],['||x||','spoiler'],['`x`','code']]) {
  test(`inline ${type}: ${source}`, () => expect(inline(source)).toEqual({type,text:'x'}));
}
test('nested formatting and links', () => {
  expect(inline('**a *b* c**')).toEqual({type:'bold',text:['a ',{type:'italic',text:'b'},' c']});
  expect(inline('[site](https://example.com)')).toEqual({type:'url',text:'site',url:'https://example.com'});
});
test('lists preserve numbering and one nested level', () => {
  const blocks=markdown('- first\n  - child\n- second\n\n3. third\n4. fourth').blocks;
  expect(blocks[0].items?.[0].blocks[1].type).toBe('list');
  expect(blocks[1].items?.map(item=>item.value)).toEqual([3,4]);
});
test('quotes have different API shapes', () => {
  expect(markdown('> one\n> two\n\n>! secret').blocks).toEqual([
    {type:'blockquote',blocks:[{type:'paragraph',text:'one\ntwo'}]},
    {type:'expandable_blockquote',text:'secret'}]);
});
test('code, divider, footer, details', () => {
  expect(markdown('```ts\na < b\n```\n\n---\n\n```footer\nbye\n```\n\n<details><summary>T</summary>body</details>').blocks).toEqual([
    {type:'pre',text:'a < b',language:'ts'},{type:'divider'},{type:'footer',text:'bye'},
    {type:'details',summary:'T',blocks:[{type:'paragraph',text:'body'}]}]);
});
test('compact table and required cell alignment', () => {
  const block=markdown('<!-- table:compact -->\n| A | B |\n| --- | ---: |\n| x | **y** |').blocks[0];
  expect(block.type).toBe('table'); expect(block.is_compact).toBe(true);
  expect(block.cells?.[0][0]).toEqual({text:'A',is_header:true,align:'left',valign:'top'});
  expect(block.cells?.[1][1].align).toBe('right');
});
test('buttons, map and URL media', () => {
  expect(markdown('```buttons\nOpen | https://example.com\n```').blocks[0]).toEqual({type:'buttons',buttons:[{text:'Open',url:'https://example.com'}]});
  expect(markdown('```map\n-8,-34,12\n```').blocks[0]).toEqual({type:'map',location:{latitude:-8,longitude:-34},zoom:12});
  expect(markdown('![photo](https://example.com/a.jpg)').blocks[0]).toEqual({type:'photo',photo:{type:'photo',media:'https://example.com/a.jpg'},caption:{text:'photo'}});
  expect(markdown('![file](https://example.com/a.pdf)').blocks[0].type).toBe('document');
});
for (const source of ['```map\n999,2\n```','```buttons\nBad | javascript:foo\n```','![x](file:///tmp/x)','<unsupported>x</unsupported>','```unclosed','**unclosed']) {
  test(`degrade ${source}`,()=>expect(markdown(source).blocks[0]).toEqual({type:'paragraph',text:source}));
}
test('JSON passthrough and light validation',()=>{
  const raw={blocks:[{type:'paragraph',text:'raw'}],is_rtl:true};
  expect(parseInput(JSON.stringify(raw))).toEqual(raw);
  expect(()=>parseInput({blocks:'bad'})).toThrow();
  expect(()=>parseInput({blocks:raw.blocks,markdown:'conflict'})).toThrow();
});
