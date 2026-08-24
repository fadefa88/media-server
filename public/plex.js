const LIBRARIES = ['Film','Cartoni','Marvel','OP2','Naruto','Serie','South Park'];
const P = s => document.querySelector(s);
const esc = (s='') => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plexState = { items:[], byLibrary:new Map(), activeLibrary:null, activeSeries:null, sort:'title', loaded:false };

function splitPath(item){return String(item.relative_path||'').split(/[\\/]/).filter(Boolean)}
function rootOf(item){return splitPath(item)[0]||'Altro'}
function seriesFolder(item){const p=splitPath(item);return p[0]==='Serie'&&p.length>2?p[1]:null}
function seasonFolder(item){const p=splitPath(item);if(p[0]!=='Serie'||p.length<4)return null;return p[2]||null}
function titleOf(item){return item.display_title||item.title||item.filename||'Senza titolo'}
function artOf(item){return item.poster_url||item.backdrop_url||null}
function yearOf(item){return Number(item.release_year||0)||0}
function updatedOf(item){return Date.parse(item.updated_at||item.progress_updated_at||0)||0}
function durationText(sec){sec=Math.max(0,Number(sec||0));const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);return h?`${h}h ${m}m`:`${m} min`}

async function getJson(url){const r=await fetch(url);if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}
async function loadLibrary(){
  if(plexState.loaded)return;
  const page=500;let offset=0,total=Infinity;const items=[];
  while(offset<total){const d=await getJson(`/api/media?limit=${page}&offset=${offset}`);total=Number(d.count||0);items.push(...(d.items||[]));if(!(d.items||[]).length)break;offset+=page}
  plexState.items=items.filter(x=>x.status==='OK');
  plexState.byLibrary.clear();for(const name of LIBRARIES)plexState.byLibrary.set(name,[]);
  for(const item of plexState.items){const root=rootOf(item);if(!plexState.byLibrary.has(root))plexState.byLibrary.set(root,[]);plexState.byLibrary.get(root).push(item)}
  plexState.loaded=true;
}

function posterCard(m){
  const art=artOf(m);const progress=Number(m.progress_percent||0);const meta=[m.release_year||null,m.media_kind==='tv'&&m.season_number!=null&&m.episode_number!=null?`S${String(m.season_number).padStart(2,'0')}E${String(m.episode_number).padStart(2,'0')}`:null].filter(Boolean).join(' · ');
  const badge=m.width>=3000?'4K':(m.hdr&&m.hdr!=='SDR'?'HDR':'');
  return `<button class="plexCard" data-media="${Number(m.id)}" title="${esc(titleOf(m))}"><div class="plexPoster">${art?`<img src="${esc(art)}" alt="" loading="lazy">`:`<div class="plexPosterFallback">${esc(titleOf(m))}</div>`}<span class="plexPosterShade"></span><span class="plexPlayBadge">▶</span>${badge?`<span class="plexBadge">${esc(badge)}</span>`:''}${progress>1&&!m.completed?`<span class="plexProgress"><i style="width:${Math.min(100,progress)}%"></i></span>`:''}</div><div class="plexCardTitle">${esc(titleOf(m))}</div><div class="plexCardMeta">${esc(meta||durationText(m.duration_seconds))}</div></button>`
}
function sortItems(items){const out=[...items];if(plexState.sort==='recent')out.sort((a,b)=>updatedOf(b)-updatedOf(a));else if(plexState.sort==='year')out.sort((a,b)=>yearOf(b)-yearOf(a)||titleOf(a).localeCompare(titleOf(b),'it'));else out.sort((a,b)=>titleOf(a).localeCompare(titleOf(b),'it',{numeric:true}));return out}
function iconFor(name){return ({Film:'▣',Cartoni:'◉',Marvel:'◆',OP2:'☠',Naruto:'◎',Serie:'▤','South Park':'▥'})[name]||'□'}

function renderSidebar(){
  const host=P('#plexLibraries');
  host.innerHTML=LIBRARIES.map(name=>{const count=(plexState.byLibrary.get(name)||[]).length;return `<button class="plexNavButton ${plexState.activeLibrary===name?'active':''}" data-library="${esc(name)}"><span class="plexNavIcon">${iconFor(name)}</span><span>${esc(name)}</span><span class="plexNavCount">${count}</span></button>`}).join('');
  P('#plexHomeNav').classList.toggle('active',!plexState.activeLibrary);
}

function renderHome(){
  plexState.activeLibrary=null;plexState.activeSeries=null;renderSidebar();
  const cont=plexState.items.filter(x=>Number(x.progress_seconds||0)>30&&!x.completed).sort((a,b)=>Date.parse(b.progress_updated_at||0)-Date.parse(a.progress_updated_at||0)).slice(0,20);
  const recent=[...plexState.items].sort((a,b)=>updatedOf(b)-updatedOf(a)).slice(0,24);
  const libSummary=LIBRARIES.map(name=>({name,items:plexState.byLibrary.get(name)||[]}));
  P('#plexView').innerHTML=`<div class="plexPageHead"><h1 class="plexPageTitle">Home</h1><div class="plexHeadSpacer"></div><span style="color:#777;font-size:12px">${plexState.items.length} elementi</span></div>${cont.length?`<section class="plexSection"><div class="plexSectionHead"><h2 class="plexSectionTitle">Continua a guardare</h2></div><div class="plexHorizontal">${cont.map(posterCard).join('')}</div></section>`:''}<section class="plexSection"><div class="plexSectionHead"><h2 class="plexSectionTitle">Librerie</h2></div><div class="plexSeriesGrid">${libSummary.map(({name,items})=>libraryTile(name,items)).join('')}</div></section><section class="plexSection"><div class="plexSectionHead"><h2 class="plexSectionTitle">Aggiunti di recente</h2></div><div class="plexHorizontal">${recent.map(posterCard).join('')}</div></section>`;
}
function libraryTile(name,items){const sample=items.find(x=>artOf(x))||items[0];const art=sample&&artOf(sample);return `<button class="plexSeriesCard" data-library="${esc(name)}"><div class="plexSeriesArt">${art?`<img src="${esc(art)}" alt="" loading="lazy">`:`<div class="plexPosterFallback">${esc(name)}</div>`}<div class="plexSeriesOverlay">${items.length} elementi</div></div><div class="plexCardTitle">${esc(name)}</div><div class="plexCardMeta">Libreria</div></button>`}

function renderLibrary(name){
  plexState.activeLibrary=name;plexState.activeSeries=null;renderSidebar();const items=plexState.byLibrary.get(name)||[];
  if(name==='Serie')return renderSeriesIndex(items);
  const sorted=sortItems(items);
  P('#plexView').innerHTML=`${libraryHead(name,items.length)}${sorted.length?`<div class="plexGrid">${sorted.map(posterCard).join('')}</div>`:`<div class="plexEmpty">Nessun media indicizzato in questa cartella.</div>`}`;
}
function libraryHead(name,count,crumb=''){
  const breadcrumb=crumb||`<span>›</span><span>${esc(name)}</span>`;
  return `<div class="plexPageHead"><div><div class="plexBreadcrumb"><button data-home-link>Home</button>${breadcrumb}</div><h1 class="plexPageTitle" style="margin-top:5px">${esc(name)}</h1></div><div class="plexHeadSpacer"></div><span style="color:#777;font-size:12px">${count} elementi</span><select class="plexSelect" id="plexSort"><option value="title" ${plexState.sort==='title'?'selected':''}>Titolo</option><option value="recent" ${plexState.sort==='recent'?'selected':''}>Più recenti</option><option value="year" ${plexState.sort==='year'?'selected':''}>Anno</option></select></div>`
}

function renderSeriesIndex(items){
  const groups=new Map();for(const item of items){const folder=seriesFolder(item)||'Altro';if(!groups.has(folder))groups.set(folder,[]);groups.get(folder).push(item)}
  const list=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],'it',{numeric:true}));
  P('#plexView').innerHTML=`${libraryHead('Serie',items.length)}${list.length?`<div class="plexSeriesGrid">${list.map(([folder,media])=>seriesTile(folder,media)).join('')}</div>`:`<div class="plexEmpty">Nessuna sottocartella trovata sotto /Serie.</div>`}`;
}
function seriesTile(folder,media){const sample=media.find(x=>artOf(x))||media[0];const art=sample&&artOf(sample);const seasons=new Set(media.map(seasonFolder).filter(Boolean));return `<button class="plexSeriesCard" data-series="${esc(folder)}"><div class="plexSeriesArt">${art?`<img src="${esc(art)}" alt="" loading="lazy">`:`<div class="plexPosterFallback">${esc(folder)}</div>`}<div class="plexSeriesOverlay">${media.length} episodi${seasons.size?` · ${seasons.size} stagioni`:''}</div></div><div class="plexCardTitle">${esc(folder)}</div><div class="plexCardMeta">Serie TV</div></button>`}

function renderSeries(folder){
  plexState.activeLibrary='Serie';plexState.activeSeries=folder;renderSidebar();const all=(plexState.byLibrary.get('Serie')||[]).filter(x=>(seriesFolder(x)||'Altro')===folder);const bySeason=new Map();for(const item of sortItems(all)){const season=seasonFolder(item)||seasonLabel(item);if(!bySeason.has(season))bySeason.set(season,[]);bySeason.get(season).push(item)}
  const seasonEntries=[...bySeason.entries()].sort((a,b)=>seasonSort(a[0])-seasonSort(b[0])||String(a[0]).localeCompare(String(b[0]),'it',{numeric:true}));
  const breadcrumb=`<span>›</span><button data-library="Serie">Serie</button><span>›</span><span>${esc(folder)}</span>`;
  P('#plexView').innerHTML=`${libraryHead(folder,all.length,breadcrumb)}${seasonEntries.map(([season,media])=>`<section class="plexSeason"><h3>${esc(season)}</h3><div class="plexGrid">${media.map(posterCard).join('')}</div></section>`).join('')}`;
}
function seasonLabel(item){return item.season_number!=null?`Stagione ${item.season_number}`:'Senza stagione'}
function seasonSort(v){const m=String(v).match(/\d+/);return m?Number(m[0]):9999}

function bindPlex(){
  document.addEventListener('click',e=>{
    const lib=e.target.closest('[data-library]');if(lib){e.preventDefault();renderLibrary(lib.dataset.library);return}
    const series=e.target.closest('[data-series]');if(series){e.preventDefault();renderSeries(series.dataset.series);return}
    if(e.target.closest('[data-home-link]')){e.preventDefault();renderHome()}
  });
  P('#plexHomeNav').addEventListener('click',renderHome);
  P('#homeBtn').addEventListener('click',renderHome);
  P('#plexView').addEventListener('change',e=>{if(e.target.id==='plexSort'){plexState.sort=e.target.value;if(plexState.activeSeries)renderSeries(plexState.activeSeries);else if(plexState.activeLibrary)renderLibrary(plexState.activeLibrary)}});
}

async function bootPlex(){
  try{P('#plexView').innerHTML='<div class="plexLoading"><span class="plexSpinner"></span>Carico la libreria…</div>';await loadLibrary();renderHome();bindPlex()}catch(error){P('#plexView').innerHTML=`<div class="plexEmpty">Errore caricamento libreria: ${esc(error.message)}</div>`}
}
bootPlex();
