const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../outputs/GameForge_Flow_v0.4');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const ui = vm.runInNewContext(source.slice(source.indexOf('// BEGIN VISION UI'), source.indexOf('// END VISION UI')) + '\n({selectionLineRect,selectionMenuPlacement,createVisionSelection})');
const rect = (left,top,right,bottom) => ({left,top,right,bottom,width:right-left,height:bottom-top});
const bounds = rect(300,200,1400,900), size = {width:260,height:48};

test('formatted fragments including trailing punctuation anchor at the start of the selected line', () => {
  const line = ui.selectionLineRect([rect(340,300,800,324),rect(800,300,920,324),rect(920,300,926,324)]);
  assert.equal(line.left,340); assert.equal(line.right,926); assert.equal(line.bottom,324);
  const wrapped = ui.selectionLineRect([rect(340,300,1300,324),rect(340,330,550,354)]);
  assert.equal(wrapped.top,330); assert.equal(wrapped.left,340); assert.equal(wrapped.right,550);
  assert.equal(ui.selectionLineRect([]),null);
});
test('contextual action opens below, flips above near the footer, and clamps to the editor', () => {
  let p = ui.selectionMenuPlacement(rect(340,300,900,324),bounds,size);
  assert.equal(p.left,340); assert.equal(p.top,338); assert.equal(p.side,'below');
  p = ui.selectionMenuPlacement(rect(1250,840,1390,864),bounds,size);
  assert.equal(p.left,1132); assert.equal(p.top,778); assert.equal(p.side,'above');
  assert.ok(p.notch>=18 && p.notch<=size.width-18);
  p = ui.selectionMenuPlacement(rect(0,205,500,228),bounds,size);
  assert.equal(p.left,308);
});
test('offscreen selections never leave an orphaned popup; small viewports stay within bounds', () => {
  for (const anchor of [rect(320,100,600,150),rect(320,910,600,950),rect(0,300,100,330),rect(1500,300,1600,330)]) assert.equal(ui.selectionMenuPlacement(anchor,bounds,size),null);
  const mobile = rect(16,330,374,650);
  const p = ui.selectionMenuPlacement(rect(18,610,350,635),mobile,{width:270,height:48});
  assert.ok(p.left>=mobile.left+8); assert.ok(p.left+270<=mobile.right-8); assert.ok(p.top+48<=mobile.bottom-8);
});

function fixture() {
  function node() {
    const listeners = new Map(), classes = new Set();
    return {
      style:{setProperty(k,v){this[k]=v;}},dataset:{},offsetWidth:260,offsetHeight:48,
      classList:{add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)},
      addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},
      emit(type,extra={}){const e={type,target:this,key:'',preventDefault(){this.prevented=true;},...extra};for(const fn of listeners.get(type)||[])fn(e);return e;},
      contains(target){return target===this || target===this.child;},
      focus(){doc.activeElement=this;},getBoundingClientRect:()=>bounds,
      querySelector(){return this.child;}
    };
  }
  const doc = node(), visual = node(), markdown = node(), menu = node(), button = node();
  menu.child=button;menu.classList.add('hidden');
  const win = node();win.innerWidth=1440;win.innerHeight=960;
  win.requestAnimationFrame = fn => fn();
  let selected='O jogador descobre uma verdade.', captured='', enabled=true;
  let anchor=rect(340,300,700,324);
  win.getSelection=()=>({rangeCount:1,anchorNode:visual,focusNode:visual,getRangeAt:()=>({getClientRects:()=>[anchor]})});
  doc.defaultView=win;doc.activeElement=visual;visual.ownerDocument=markdown.ownerDocument=doc;
  const controller=ui.createVisionSelection({visual,markdown,menu,getMode:()=> 'live',isActive:()=>enabled,capture:()=>{captured=selected;return selected;},clear:()=>{captured='';}});
  return {doc,visual,markdown,menu,button,win,controller,
    get captured(){return captured;}, set selected(value){selected=value;},set anchor(value){anchor=value;},set enabled(value){enabled=value;},
    visible:()=>!menu.classList.contains('hidden')};
}
test('mouse drag reveals only after release and captures exactly the selected text', () => {
  const f=fixture();f.visual.emit('pointerdown');f.doc.emit('selectionchange');assert.equal(f.visible(),false);
  f.doc.emit('pointerup');assert.equal(f.visible(),true);assert.equal(f.captured,'O jogador descobre uma verdade.');
  assert.equal(f.menu.style.left,'340px');assert.equal(f.menu.dataset.side,'below');
  assert.equal(f.menu.emit('pointerdown').prevented,true,'click keeps browser selection alive');
});
test('deselect, outside click, typing and leaving Vision clear stale contextual selections', () => {
  for(const action of ['outside','typing','stage','deselect']){
    const f=fixture();f.controller.reveal();assert.equal(f.visible(),true);
    if(action==='outside')f.doc.emit('pointerdown',{target:{}});
    if(action==='typing')f.visual.emit('input');
    if(action==='stage'){f.enabled=false;f.controller.refresh();}
    if(action==='deselect'){f.selected='';f.doc.emit('selectionchange');}
    assert.equal(f.visible(),false,action);assert.equal(f.captured,'',action);
    f.doc.emit('selectionchange');assert.equal(f.visible(),false,action+' remains dismissed');
  }
});
test('keyboard selection, contextual shortcut and focus navigation do not discard the selection', () => {
  const f=fixture();f.visual.emit('keyup',{key:'ArrowRight',shiftKey:true});assert.equal(f.visible(),true);
  assert.equal(f.visual.emit('keydown',{key:'Tab',shiftKey:false}).prevented,true);assert.equal(f.doc.activeElement,f.button);
  f.doc.emit('selectionchange');assert.equal(f.visible(),true);assert.ok(f.captured);
  f.menu.emit('keydown',{key:'Tab',shiftKey:true});assert.equal(f.doc.activeElement,f.visual);
  f.controller.hide();f.visual.emit('keyup',{key:'Escape'});assert.equal(f.visible(),false);
  f.visual.emit('keyup',{key:'a',ctrlKey:true});assert.equal(f.visible(),true);
  f.controller.hide();assert.equal(f.visual.emit('contextmenu',{button:0}).prevented,true);assert.equal(f.doc.activeElement,f.button);
});
test('scrolling away hides the action and scrolling back restores it without a stale position', () => {
  const f=fixture();f.controller.reveal();f.anchor=rect(340,920,700,945);f.visual.emit('scroll');assert.equal(f.visible(),false);
  f.anchor=rect(340,400,700,424);f.visual.emit('scroll');assert.equal(f.visible(),true);assert.equal(f.menu.style.top,'438px');
});
test('modal dismissal cannot reopen a popup from delayed selection events', () => {
  const f=fixture();f.controller.reveal();f.controller.hide();f.enabled=false;f.doc.emit('selectionchange');
  assert.equal(f.visible(),false);assert.equal(f.captured,'');
  f.enabled=true;f.doc.emit('selectionchange');assert.equal(f.visible(),false);
});
test('approved layout has one accessible status, one contextual send, no persistent metadata rail', () => {
  assert.equal((html.match(/id="docStatusSelect"/g)||[]).length,1);
  assert.equal((html.match(/id="sendSelectionBtn"/g)||[]).length,1);
  assert.doesNotMatch(html,/vision-meta-rail|docMetaVersion|docMetaUpdated|docMetaAuthor|docMetaReference|vision-send-panel/);
  assert.match(html,/id="docStatus"[\s\S]*?id="docStatusSelect"[\s\S]*?value="deprecated"/);
  assert.match(html,/vision-selection-menu hidden/);assert.match(html,/aria-label="Título do documento"/);
  assert.match(css,/left:calc\(var\(--doc-node-x\) \+ \.5px\)/);assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(source,/Título editado[\s\S]*?renderDocumentList\(\)/);
  assert.doesNotMatch(source,/updateVisionMeta/);
});
