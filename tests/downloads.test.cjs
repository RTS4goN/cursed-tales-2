const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const contract=require('./download-contract.json');
const archiveIndex=require('./archive-index.json');
const source=require('./source-catalog.json');
function setup(){
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{runScripts:'outside-only',url:'https://rts4gon.github.io/cursed-tales-2/'});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false};
 for(const name of ['catalog.js','campaign.js','app.js'])dom.window.eval(fs.readFileSync(path.join(root,name),'utf8'));
 return dom;
}
const dom=setup(),w=dom.window,doc=w.document;
const itemById=Object.fromEntries(source.items.map(x=>[x.id,x]));
const rows=[];
function checkLink(el,p,key){
 assert.ok(el,'Missing control: '+key);
 const available=!!p?.path;
 if(available){
  assert.equal(el.getAttribute('href'),p.path,key+' target');
  assert.equal(el.getAttribute('aria-disabled'),null,key+' enabled');
  assert.equal(el.dataset.archive,p.archiveName,key+' archive');
  const proof=archiveIndex[p.archiveName];assert.ok(proof,key+' unverified archive');
  assert.equal(proof.status,'ok');assert.equal(proof.url,p.path);assert.equal(proof.filename,p.archiveName);
  if(p.fallback)assert.match(el.textContent,/общий ZIP/);
  if(p.partial)assert.ok(el.classList.contains('download-partial'));
 }else{
  assert.equal(el.getAttribute('href'),null,key+' disabled link');
  assert.equal(el.getAttribute('aria-disabled'),'true');
  assert.ok(el.classList.contains('download-unavailable'),key+' red frame');
 }
 rows.push({control:key,status:available?(p.partial?'partial':'ready'):'unavailable',archive:p?.archiveName||null,url:p?.path||null});
}
test('Every missing download has a red frame CSS rule',()=>{
 const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
 assert.match(css,/\.download-unavailable\[aria-disabled=true\][^{]*\{[^}]*border:2px solid #ff5266!important/);
});
test('Download entire collection',()=>checkLink(doc.querySelector('#download-all'),contract.all,'collection'));
for(const item of source.items){
 const card=doc.querySelector(`.card[data-character="${item.id}"][data-view="figure"]`);
 test(item.id+' card opens correct gallery',()=>{card.querySelector('.cover').click();assert.equal(doc.querySelector('#gallery').dataset.character,item.id);assert.equal(doc.querySelector('#gallery').open,true);doc.querySelector('#close-gallery').click();assert.equal(doc.querySelector('#gallery').open,false)});
 for(const [n,kind] of ['model','renders'].entries())test(item.id+' card '+kind,()=>checkLink(card.querySelectorAll('.card-downloads a')[n],contract.items[item.id].packages[kind],item.id+'/card/'+kind));
 for(const view of ['figure','bust']){
  const c=doc.querySelector(`.card[data-character="${item.id}"][data-view="${view}"]`);if(!c)continue;
  const buttonKinds=view==='bust'?['model','bustRenders']:['model','renders',...(item.chitubox?['chitubox']:[])];
  for(const [n,kind] of buttonKinds.entries())test(item.id+'/'+view+' gallery '+kind,()=>{
   c.querySelector('.cover').click();assert.equal(doc.querySelector('#gallery').dataset.view,view);
   const p=view==='bust'&&kind==='model'&&!item.bust?null:contract.items[item.id].packages[kind];
   checkLink(doc.querySelectorAll('#character-downloads a')[n],p,item.id+'/'+view+'/'+kind);
   doc.querySelector('#close-gallery').click();
  });
  const files=item.files.filter(f=>view!=='bust'||((f.type==='stl'||f.type==='chitubox')?/bust/i.test(f.relative):f.type==='render'?f.relative.startsWith('Рендеры/Бюст/'):true));
  for(const f of files)test(item.id+'/'+view+' file '+f.relative,()=>{
   c.querySelector('.cover').click();
   const el=[...doc.querySelectorAll('#character-file-list a')].find(e=>e.dataset.fileKey===f.key);
   const p=contract.items[item.id].files[f.key];checkLink(el,p,item.id+'/'+view+'/'+f.relative);
   if(p.path){
    const proof=archiveIndex[p.archiveName];
    const member=proof.members.find(m=>m.name===p.member);assert.ok(member,'File absent from remote ZIP');
    assert.equal(member.bytes,f.bytes);assert.equal(member.crc,p.crc,'ZIP member CRC differs from local source');
    const prefix=f.shared?'Общие файлы Chibi/':'Персонажи/'+item.name+'/';
    assert.ok([f.relative,prefix+f.relative].includes(member.name),'Wrong character or relative file');
    assert.match(el.textContent,/ZIP/);assert.match(el.getAttribute('aria-label'),/Скачать архив/);
   }
   doc.querySelector('#close-gallery').click();
  });
 }
}
test('Each complete package contains all required character files',()=>{
 for(const item of source.items){
  const ci=contract.items[item.id];
  for(const [kind,p] of Object.entries(ci.packages)){
   if(!p?.path)continue;
   const required=item.files.filter(f=>kind==='model'?['stl','chitubox'].includes(f.type)&&!f.shared:kind==='chitubox'?f.type==='chitubox':f.type==='render'&&(kind==='bustRenders'?f.relative.startsWith('Рендеры/Бюст/'):!f.relative.startsWith('Рендеры/Бюст/')));
   for(const f of required){const proof=ci.files[f.key],prefix=f.shared?'Общие файлы Chibi/':'Персонажи/'+item.name+'/';assert.ok(archiveIndex[p.archiveName].members.some(m=>[f.relative,prefix+f.relative].includes(m.name)&&m.bytes===f.bytes&&m.crc===proof.crc),item.id+'/'+kind+' does not contain '+f.relative)}
  }
 }
});
test('Write per-control audit report',()=>{
 const totals={};for(const row of rows)totals[row.status]=(totals[row.status]||0)+1;
 const report={testedAt:new Date().toISOString(),totals,controls:rows};
 fs.writeFileSync(path.join(root,'tests','download-audit.json'),JSON.stringify(report,null,2));
 assert.ok(rows.length>350);dom.window.close();
});
