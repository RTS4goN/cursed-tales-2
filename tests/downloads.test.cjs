const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {openPage} = require('./access.test.cjs');
const root = path.resolve(__dirname, '..');
const privateDir = process.env.CT2_PRIVATE_DIR || path.resolve(root, '../Служебное/Тиры');
const privatePresent = fs.existsSync(path.join(privateDir, 'Ключи доступа.json'));
const read = name => JSON.parse(fs.readFileSync(path.join(privateDir, name), 'utf8'));

test('Every button in every real backer tier', {skip: !privatePresent}, async t => {
 const keys=read('Ключи доступа.json'), catalogs=read('Каталоги тиров.json');
 const archives=read('Архивы для тестов.json'), source=read('source-catalog.json'), legacy=read('download-contract.json');
 const controls=[];
 for(const tier of ['core','full','complete']){
  const allowed=tier==='complete'?null:new Set(read('allowed-'+tier+'.json').map(x=>JSON.stringify(x)));
  const dom=await openPage('#access='+tier+'.'+keys[tier],async url=>{
   assert.equal(url.split('?')[0],'access/'+tier+'.bin');
   return {ok:true,arrayBuffer:async()=>fs.readFileSync(path.join(root,'access',tier+'.bin'))};
  });
  const w=dom.window, doc=w.document, catalog=catalogs[tier];
  assert.equal(doc.body.dataset.accessState,'ready');
  assert.equal(w.CATALOG.tier,tier);assert.equal(doc.querySelector('#tier-label').textContent,catalog.tierLabel);
  assert.ok(doc.querySelector('#access-gate').hidden);assert.equal(doc.querySelector('#collection').hidden,false);
  // app.js adds public lore to its own runtime copy.
  assert.deepEqual(JSON.parse(JSON.stringify(w.CATALOG.items.map(i=>i.files))),catalog.items.map(i=>i.files));
  function assertEnglishUI(){
   assert.equal(doc.documentElement.lang,'en');
   assert.doesNotMatch(doc.body.textContent,/[А-Яа-яЁё]/u,'All interface text must be English');
   for(const el of doc.querySelectorAll('[aria-label],[title],[alt]')){
    for(const attr of ['aria-label','title','alt'])assert.doesNotMatch(el.getAttribute(attr)||'',/[А-Яа-яЁё]/u,attr+' must be English');
   }
  }
  await t.test(tier+': English library',assertEnglishUI);
  function checkLink(el,p,control){
   assert.ok(el,control+': missing control');
   if(p?.path){
    assert.equal(el.getAttribute('href'),p.path,control);assert.equal(el.getAttribute('aria-disabled'),null);
    const proof=archives[p.archiveName];assert.equal(proof?.status,'ok',control+': unverified ZIP');
    assert.equal(proof.url,p.path);assert.equal(el.dataset.archive,p.archiveName);
    if(allowed)for(const m of proof.members)assert.ok(allowed.has(JSON.stringify([m.name,m.bytes,m.crc])),control+': higher-tier member '+m.name);
    if(p.partial)assert.ok(el.classList.contains('download-partial'));
   }else{
    assert.equal(el.getAttribute('href'),null,control);assert.equal(el.getAttribute('aria-disabled'),'true');
    assert.ok(el.classList.contains('download-unavailable'),control+': red frame');
   }
   controls.push({tier,control,status:p?.path?p.partial?'partial':'ready':'unavailable',archive:p?.archiveName||null});
  }
  await t.test(tier+': whole tier',()=>checkLink(doc.querySelector('#download-all'),catalog.all,'collection'));
  await t.test(tier+': new render packs and Wynne bust',()=>{
   for(const id of ['adeline-key','march-hare']){
    const item=catalog.items.find(i=>i.id===id);
    assert.equal(item.gallery.length,4);
    assert.equal(item.previewNote,'');
    assert.equal(item.files.filter(f=>f.type==='render'&&f.name.endsWith('.png')).length,4);
    assert.equal(item.files.filter(f=>f.type==='render'&&f.name.endsWith('.mp4')).length,1);
    for(const g of item.gallery)assert.ok(fs.existsSync(path.join(root,g.src)));
   }
   const wynne=catalog.items.find(i=>i.id==='wynne-madigan');
   assert.equal(wynne.bust,tier==='complete');
   assert.equal(wynne.files.filter(f=>f.type==='stl'&&f.relative.startsWith('STL/Бюст/')).length,tier==='complete'?4:0);
   assert.equal(wynne.files.some(f=>f.name==='WynneBust.chitubox'),tier==='complete');
  });
  await t.test(tier+': collection completeness is disclosed',()=>{
   if(!catalog.all.path)return;
   const members=archives[catalog.all.archiveName].members;
   const missing=catalog.items.flatMap(i=>i.files.map(f=>({i,f}))).filter(({i,f})=>{
    const original=source.items.find(x=>x.id===i.id);
    const prefix=f.shared?'Общие файлы Chibi/':'Персонажи/'+original.name+'/';
    return !members.some(m=>m.name===prefix+f.relative&&m.bytes===f.bytes&&m.crc===legacy.items[i.id].files[f.key].crc);
   });
   assert.equal(Boolean(catalog.all.partial),missing.length>0);
   if(missing.length)assert.ok(catalog.all.unavailableReason);
  });
  await t.test(tier+': existing Wynne figure remains downloadable',()=>{
   const wynne=catalog.items.find(i=>i.id==='wynne-madigan');
   assert.ok(wynne.model.path,'Existing figure archive must remain linked when a bust is added');
   assert.ok(wynne.chitubox.path || tier==='core');
   if(tier==='complete'){
    assert.equal(wynne.model.scope,'figure');
    const bustFiles=wynne.files.filter(f=>f.relative.startsWith('STL/Бюст/'));
    assert.equal(Boolean(wynne.bustModel.path),bustFiles.every(f=>f.path));
   }
  });
  await t.test(tier+': entitlement boundaries',()=>{
   if(tier!=='complete'){
    assert.equal(doc.querySelectorAll('#busts .card,#diorama .card').length,0);
    assert.equal(doc.querySelectorAll('.tier-locked').length,2);assert.ok(!catalog.items.some(i=>i.id==='diorama'));
    for(const i of catalog.items){
     assert.equal(i.bust,false);
     for(const f of i.files){
      assert.ok(!f.relative.startsWith('STL/Бюст/')&&!f.relative.startsWith('Рендеры/Бюст/'));
      if(f.type==='chitubox'){assert.doesNotMatch(f.name,/bust/i);assert.notEqual(i.id,'briar-vess');}
      if(tier==='core'){
       assert.doesNotMatch(f.relative,/nsfw|nude/i);
       if(['briar-vess','bloodhood','wolfsbane','wynne-madigan'].includes(i.id))assert.notEqual(f.type,'chitubox');
      }
     }
     if(tier==='core')assert.ok(i.gallery.every(g=>g.label!=='NSFW'));
    }
    assert.ok(catalog.items.find(i=>i.id==='march-hare').files.some(f=>f.name==='bust.stl'),'Perrine torso must remain');
   }
   for(const id of ['adeline-key','march-hare','madame-corvin','the-beast'])assert.ok(catalog.items.some(i=>i.id===id),'Shared unlock missing: '+id);
   for(const id of ['chibi-cat','chibi-rabbit','chibi-goat'])assert.equal(catalog.items.some(i=>i.id===id),tier!=='core','Pet entitlement: '+id);
   if(tier==='core'){
    assert.equal(doc.querySelector('#chibi'),null,'Core must not render the pets section');
    assert.ok(!JSON.stringify(catalog).includes('chibi-'),'No pet IDs, assets or download links in Core');
    assert.ok(catalog.items.every(i=>i.files.every(f=>!f.shared&&!/chibi/i.test(f.relative))));
    assert.match(catalog.all.archiveName,/^ct2-core-collection-no-pets-\d{8}\.zip$/);
   }else assert.equal(doc.querySelectorAll('#chibi .card').length,3);

  });
  for(const item of catalog.items){
   const original=source.items.find(i=>i.id===item.id);
   const card=doc.querySelector(`.card[data-character="${item.id}"][data-view="figure"]`);assert.ok(card);
   for(const [n,kind] of ['model','renders'].entries())await t.test(`${tier}/${item.id}/card/${kind}`,()=>checkLink(card.querySelectorAll('.card-downloads a')[n],item[kind],item.id+'/card/'+kind));
   for(const kind of ['model','renders','chitubox','bustRenders','bustModel'])await t.test(`${tier}/${item.id}/package-contents/${kind}`,()=>{
    const p=item[kind];if(!p?.path)return;
    const required=item.files.filter(f=>(kind==='model'||kind==='bustModel')?['stl','chitubox'].includes(f.type)&&!f.shared:kind==='chitubox'?f.type==='chitubox':f.type==='render'&&(kind==='bustRenders'?f.relative.startsWith('Рендеры/Бюст/'):!f.relative.startsWith('Рендеры/Бюст/')));
    for(const f of required.filter(f=>p.scope!=='figure'||!(f.relative.startsWith('STL/Бюст/')||(f.type==='chitubox'&&/bust/i.test(f.name))))){
     const prefix=f.shared?'Общие файлы Chibi/':'Персонажи/'+original.name+'/';
     assert.ok(archives[p.archiveName].members.some(m=>[f.relative,prefix+f.relative].includes(m.name)&&m.bytes===f.bytes&&m.crc===legacy.items[item.id].files[f.key].crc),kind+': package misses '+f.relative);
    }
   });
   for(const view of ['figure','bust']){
    const c=doc.querySelector(`.card[data-character="${item.id}"][data-view="${view}"]`);if(!c)continue;
    c.querySelector('.cover').click();assert.equal(doc.querySelector('#gallery').open,true);
    assert.equal(doc.querySelector('#gallery').dataset.character,item.id);assert.equal(doc.querySelector('#gallery').dataset.view,view);
    if(tier==='core')assert.ok(doc.querySelector('#gallery-variants').hidden);
    const kinds=view==='bust'?[item.bustModel===undefined?'model':'bustModel','bustRenders']:['model','renders',...(item.chitubox?['chitubox']:[])];
    for(const [n,kind] of kinds.entries())await t.test(`${tier}/${item.id}/${view}/${kind}`,()=>checkLink(doc.querySelectorAll('#character-downloads a')[n],view==='bust'&&kind==='model'&&!item.bust?null:item[kind],item.id+'/'+view+'/'+kind));
    const files=item.files.filter(f=>view!=='bust'||(f.type==='render'?f.relative.startsWith('Рендеры/Бюст/'):/bust/i.test(f.relative)));
    assert.equal(doc.querySelectorAll('#character-file-list a').length,files.length);
    for(const f of files)await t.test(`${tier}/${item.id}/${view}/${f.relative}`,()=>{
     const el=[...doc.querySelectorAll('#character-file-list a')].find(e=>e.dataset.fileKey===f.key);checkLink(el,f,item.id+'/'+view+'/'+f.relative);
     if(f.path){
      const m=archives[f.archiveName].members.find(m=>m.name===f.archiveMember);assert.ok(m);assert.equal(m.bytes,f.bytes);
      assert.equal(m.crc,legacy.items[item.id].files[f.key].crc);
      const prefix=f.shared?'Общие файлы Chibi/':'Персонажи/'+original.name+'/';assert.ok([f.relative,prefix+f.relative].includes(m.name));
     }
    });
    await t.test(`${tier}/${item.id}/${view}/English gallery`,assertEnglishUI);
    const nsfw=doc.querySelector('[data-variant="NSFW"]');
    if(!doc.querySelector('#gallery-variants').hidden){nsfw.click();assertEnglishUI();doc.querySelector('[data-variant="SFW"]').click();}
    doc.querySelector('#close-gallery').click();assert.equal(doc.querySelector('#gallery').open,false);
   }
  }
  await t.test(tier+': navigation preserves access key',()=>{
   const hash=w.location.hash;doc.querySelector('footer a[href="#collection"]').click();assert.equal(w.location.hash,hash);
  });
  for(const other of Object.keys(keys).filter(k=>k!==tier)){
   assert.ok(!doc.documentElement.outerHTML.includes(keys[other]));assert.ok(!JSON.stringify(catalog).includes(keys[other]));
  }
  dom.window.close();
 }
 const totals={};for(const c of controls){totals[c.tier]||={};totals[c.tier][c.status]=(totals[c.tier][c.status]||0)+1;}
 fs.writeFileSync(path.join(privateDir,'Проверка кнопок тиров.json'),JSON.stringify({totals,controls},null,2));
 assert.ok(controls.length>900);
});
