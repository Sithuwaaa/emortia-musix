/* Shared site-lookup engine. Each tool defines window.LOOKUP_CONFIG before loading this. */
(function(){
const C = window.LOOKUP_CONFIG;
let COLS=[], ROWS=[], IDX={}, savedAt='';
const $=id=>document.getElementById(id);
const view=$('view'), q=$('q'), hint=$('hint'), pill=$('pill');

/* theme */
const THEME_KEY='office_tool_theme';
function applyTheme(t){document.documentElement.dataset.theme=t;$('themeBtn').textContent=t==='dark'?'☀':'☾';try{localStorage.setItem(THEME_KEY,t)}catch(e){}}
applyTheme(localStorage.getItem(THEME_KEY)||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
$('themeBtn').onclick=()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');

/* toast */
let tt;function toast(m){const t=$('toast');t.textContent=m;t.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('show'),1800)}

/* IndexedDB */
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open(C.idbName,1);r.onupgradeneeded=()=>r.result.createObjectStore(C.idbStore);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function idbGet(k){try{const db=await idb();return await new Promise((res)=>{const t=db.transaction(C.idbStore).objectStore(C.idbStore).get(k);t.onsuccess=()=>res(t.result);t.onerror=()=>res(null)})}catch(e){return null}}
async function idbSet(k,v){try{const db=await idb();return await new Promise((res)=>{const t=db.transaction(C.idbStore,'readwrite').objectStore(C.idbStore).put(v,k);t.onsuccess=()=>res(1);t.onerror=()=>res(0)})}catch(e){return 0}}

/* helpers */
const ci=name=>COLS.indexOf(name);
const fieldVal=(r,name)=>{const i=ci(name);return i>=0?(r[i]||''):''};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function hl(s,term){s=esc(s);const parts=term.trim().split(/\s+/).filter(Boolean);for(const p of parts){const re=new RegExp('('+p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig');s=s.replace(re,'<mark>$1</mark>')}return s}
const blank=v=>!v||v==='Unknown'||v==='Undefined'||v==='0';

function buildIndex(){
  IDX={byId:{}};
  const sidx=(C.searchCols||[]).map(ci).filter(i=>i>=0);
  ROWS.forEach(r=>{r.__blob=sidx.map(i=>r[i]).join('  ').toLowerCase()});
  const idc=ci(C.idCol);
  ROWS.forEach(r=>{if(r[idc])IDX.byId[String(r[idc]).toLowerCase()]=r});
}
async function loadData(){
  const stored=await idbGet('dataset');
  let ds=stored;
  if(!ds){ds=await (await fetch(C.dataUrl)).json();ds.savedAt=''}
  COLS=ds.cols; ROWS=ds.rows.map(r=>r.slice()); savedAt=ds.savedAt||'';
  buildIndex();
  pill.innerHTML='<b>'+ROWS.length.toLocaleString()+'</b> '+C.unit+(savedAt?' · updated '+savedAt:'');
  route();
}
function search(term){
  term=term.trim().toLowerCase(); if(!term) return [];
  const out=[], seen=new Set();
  if(IDX.byId[term]){out.push(IDX.byId[term]);seen.add(IDX.byId[term])}
  const parts=term.split(/\s+/);
  for(const r of ROWS){ if(seen.has(r))continue; if(parts.every(p=>r.__blob.includes(p))){out.push(r);if(out.length>=60)break} }
  return out;
}
function route(){
  const term=q.value; $('clr').style.display=term?'block':'none';
  if(!term.trim()){renderHome();return}
  const res=search(term);
  hint.textContent=res.length?(res.length>=60?'showing first 60 matches':res.length+' match'+(res.length===1?'':'es')):'';
  if(res.length===1){renderDetail(res[0]);return}
  if(!res.length){view.innerHTML='<div class="empty"><div class="big">🔍</div>No '+C.unitSingular+' matches “'+esc(term)+'”.</div>';return}
  renderList(res,term);
}
function renderHome(){
  hint.textContent='';
  view.innerHTML='<div class="empty"><div class="big">'+C.homeIcon+'</div>'+C.homeText(ROWS.length)+'</div>';
}
function renderList(res,term){
  const idc=ci(C.idCol), nc=ci(C.nameCol), mc=ci(C.metaCol);
  view.innerHTML='<div class="results">'+res.map((r,i)=>
    '<div class="rrow" data-i="'+i+'"><span class="id">'+hl(String(r[idc]||'—'),term)+
    '</span><span class="nm">'+hl(String(r[nc]||''),term)+'</span><span class="meta">'+esc(String(r[mc]||''))+'</span></div>'
  ).join('')+'</div>';
  [...view.querySelectorAll('.rrow')].forEach(el=>el.onclick=()=>renderDetail(res[+el.dataset.i]));
}
function renderDetail(r){
  const id=fieldVal(r,C.idCol), nm=fieldVal(r,C.nameCol);
  const lat=C.latCol?fieldVal(r,C.latCol):'', lng=C.lngCol?fieldVal(r,C.lngCol):'', tel=C.telCol?fieldVal(r,C.telCol):'';
  let h='<div class="detail"><div class="dhead"><div class="top"><span class="id">'+esc(id||'—')+'</span>';
  const badges=C.badges?C.badges(r,fieldVal):[];
  for(const b of badges) if(b&&b.text) h+='<span class="badge '+(b.kind||'info')+'">'+esc(b.text)+'</span>';
  h+='</div>';
  if(nm) h+='<div class="nm">'+esc(nm)+'</div>';
  const sub=(C.subBits?C.subBits(r,fieldVal):[]).filter(Boolean);
  if(sub.length) h+='<div class="sub">'+esc(sub.join('  ·  '))+'</div>';
  h+='<div class="actions">';
  if(lat&&lng&&!blank(lat)&&!blank(lng)) h+='<a class="act primary" target="_blank" rel="noopener" href="https://www.google.com/maps?q='+encodeURIComponent(lat+','+lng)+'">📍 Open in Maps</a>';
  if(tel&&!blank(tel)) h+='<a class="act" href="tel:'+esc(String(tel).replace(/[^0-9+]/g,''))+'">📞 Call</a>';
  h+='<button class="act" id="copyBtn">⧉ Copy details</button></div></div><div class="groups">';
  for(const g of C.groups){
    const cells=g.f.map(name=>{
      const i=ci(name); if(i<0) return '';
      const v=String(r[i]||'').trim();
      const label=(C.labels&&C.labels[name])||name;
      const isMono=(C.mono||[]).includes(name), isFull=(C.full||[]).includes(name);
      let vhtml;
      if(blank(v)&&v==='') vhtml='<span class="v dim">—</span>';
      else if(name===C.telCol&&!blank(v)) vhtml='<span class="v mono"><a href="tel:'+esc(v.replace(/[^0-9+]/g,''))+'">'+esc(v)+'</a></span>';
      else vhtml='<span class="v '+(isMono?'mono':'')+(v==='Unknown'||v==='Undefined'?' dim':'')+'">'+esc(v||'—')+'</span>';
      return '<div class="f'+(isFull?' full':'')+'"><div class="k">'+esc(label)+'</div>'+vhtml+'</div>';
    }).join('');
    h+='<div class="group"><h3>'+esc(g.h)+'</h3><div class="fields">'+cells+'</div></div>';
  }
  h+='</div></div>'; view.innerHTML=h;
  $('copyBtn').onclick=()=>{
    const lines=COLS.map((c,i)=>(((C.labels&&C.labels[c])||c)+': '+(r[i]||'—'))).join('\n');
    navigator.clipboard&&navigator.clipboard.writeText(lines).then(()=>toast('Details copied')).catch(()=>{});
  };
}

/* refresh from xlsx */
$('file').addEventListener('change', async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  toast('Reading '+f.name+'…');
  try{
    const buf=await f.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array'});
    const ws=wb.Sheets[C.sheetName]||wb.Sheets[wb.SheetNames[0]];
    if(!ws) throw new Error('sheet not found');
    const arr=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
    const cols=arr[0].map(c=>String(c).trim());
    const rows=[];
    for(let i=1;i<arr.length;i++){
      const r=arr[i].map(v=>(v==null?'':String(v)).trim());
      if(!r.some(v=>v&&v!=='Unknown'&&v!=='0'&&v!=='Undefined'&&v!=='Deny')) continue;
      rows.push(r);
    }
    await idbSet('dataset',{cols,rows,savedAt:new Date().toISOString().slice(0,10)});
    toast('Updated · '+rows.length.toLocaleString()+' '+C.unit);
    await loadData();
  }catch(err){console.error(err);toast('Could not read that file')}
});

/* events */
let dq; q.addEventListener('input',()=>{clearTimeout(dq);dq=setTimeout(route,120)});
$('clr').onclick=()=>{q.value='';q.focus();route()};
addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus()}});

/* footer — the data-editing links show only in owner mode (see _lib/owner.js) */
const editLinks = window.IS_OWNER
  ? '<br><a href="#" id="refresh">Update data from Excel…</a> · <a href="#" id="reset" style="color:var(--muted)">reset to bundled</a>'
  : '';
document.querySelector('main').insertAdjacentHTML('beforeend',
  '<footer>Runs entirely on your device · '+C.source+editLinks+'</footer>');
if(window.IS_OWNER){
  $('refresh').onclick=e=>{e.preventDefault();$('file').click()};
  $('reset').onclick=async e=>{e.preventDefault();await idbSet('dataset',null);location.reload()};
}

loadData();
})();
