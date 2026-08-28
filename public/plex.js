const LIBRARIES = ['Film','Cartoni','Marvel','OP2','Naruto','Serie','South Park'];
const DIRECT_SHOW_LIBRARIES = new Set(['OP2','Naruto','South Park']);
const DIRECT_SHOW_NAMES = { OP2:'One Piece', Naruto:'Naruto', 'South Park':'South Park' };
const P = s => document.querySelector(s);
const esc = (s='') => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plexState = { items:[], byLibrary:new Map(), activeLibrary:null, activeShowLibrary:null, activeSeries:null, activeSeason:null, sort:'title', loaded:false, viewToken:0 };
const showArtworkCache = new Map();

function splitPath(item){return String(item.relative_path||'').split(/[\\/]/).filter(Boolean)}
function rootOf(item){return splitPath(item)[0]||'Altro'}
function seriesFolder(item){const p=splitPath(item);return p[0]==='Serie'&&p.length>2?p[1]:null}
function titleOf(item){return item.display_title||item.title||item.filename||'Senza titolo'}
function artOf(item){return item.poster_url||item.backdrop_url||null}
function landscapeArt(item){return item.backdrop_url||item.poster_url||null}
function yearOf(item){return Number(item.release_year||0)||0}
function updatedOf(item){return Date.parse(item.updated_at||item.progress_updated_at||0)||0}
function durationText(sec){sec=Math.max(0,Number(sec||0));const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);return h?`${h}h ${m}m`:`${m} min`}
function episodeNumber(item){
  if(item.episode_number!=null)return Number(item.episode_number);
  const name=String(item.filename||'');
  const m=name.match(/\bS\d{1,3}[ ._-]*E(?:P)?[ ._-]?(\d{1,4})\b/i)||name.match(/\bE(?:P)?[ ._-]?(\d{1,4})\b/i)||name.match(/\b\d{1,3}x(\d{1,4})\b/i);
  return m?Number(m[1]):null;
}

const SEASON_RE=/^(?:season|stagione)[ ._-]*0*(\d{1,3})(?:\b|$)|^s[ ._-]*0*(\d{1,3})(?:\b|$)/i;
const SPECIAL_RE=/^(?:specials?|speciali)$/i;
const EXTRA_RE=/^(?:extras?|behind[ ._-]*the[ ._-]*scenes|deleted[ ._-]*scenes|featurettes|interviews|scenes|shorts|trailers|other)$/i;
function seasonFromPath(item){
  const p=splitPath(item);const start=DIRECT_SHOW_LIBRARIES.has(p[0])?1:2;const dirs=p.slice(start,-1);
  for(const dir of dirs){
    if(SPECIAL_RE.test(dir))return{key:'season:0',number:0,label:'Speciali',folder:dir,source:'folder'};
    const m=dir.match(SEASON_RE);if(m){const number=Number(m[1]||m[2]);return{key:`season:${number}`,number,label:`Stagione ${number}`,folder:dir,source:'folder'}}
    if(EXTRA_RE.test(dir))return{key:'extras',number:9998,label:'Extra',folder:dir,source:'folder'};
  }
  if(item.season_number!=null){const number=Number(item.season_number);return{key:`season:${number}`,number,label:number===0?'Speciali':`Stagione ${number}`,folder:null,source:'metadata'}}
  if(dirs.length){const folder=dirs[dirs.length-1];return{key:`folder:${folder}`,number:9997,label:folder,folder,source:'folder'}}
  return{key:'unseasoned',number:9999,label:'Senza stagione',folder:null,source:'fallback'};
}
function groupSeasons(items){
  const groups=new Map();
  for(const item of items){const season=seasonFromPath(item);if(!groups.has(season.key))groups.set(season.key,{...season,items:[]});groups.get(season.key).items.push(item)}
  return [...groups.values()].sort((a,b)=>a.number-b.number||a.label.localeCompare(b.label,'it',{numeric:true}));
}
function tmdbSeriesId(items){
  const counts=new Map();
  for(const item of items){const id=Number(item.tmdb_id);if(Number.isInteger(id)&&id>0)counts.set(id,(counts.get(id)||0)+1)}
  return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
}
async function showArtwork(items){
  const id=tmdbSeriesId(items);if(!id)return null;
  if(showArtworkCache.has(id))return showArtworkCache.get(id);
  const promise=getJson(`/api/tmdb/tv/${id}/seasons`).catch(()=>null);
  showArtworkCache.set(id,promise);return promise;
}
function artworkForSeason(season,payload,fallback){
  const match=payload?.seasons?.find(s=>Number(s.seasonNumber)===Number(season.number));
  return match?.posterUrl||fallback||null;
}
function seasonMeta(season,payload){return payload?.seasons?.find(s=>Number(s.seasonNumber)===Number(season.number))||null}

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
  const art=artOf(m),progress=Number(m.progress_percent||0);const meta=[m.release_year||null,m.media_kind==='tv'&&m.season_number!=null&&m.episode_number!=null?`S${String(m.season_number).padStart(2,'0')}E${String(m.episode_number).padStart(2,'0')}`:null].filter(Boolean).join(' · ');
  const badge=m.width>=3000?'4K':(m.hdr&&m.hdr!=='SDR'?'HDR':'');
  return `<button class="plexCard" data-media="${Number(m.id)}" title="${esc(titleOf(m))}"><div class="plexPoster">${art?`<img src="${esc(art)}" alt="" loading="lazy">`:`<div class="plexPosterFallback">${esc(titleOf(m))}</div>`}<span class="plexPosterShade"></span><span class="plexPlayBadge">▶</span>${badge?`<span class="plexBadge">${esc(badge)}</span>`:''}${progress>1&&!m.completed?`<span class="plexProgress"><i style="width:${Math.min(100,progress)}%"></i></span>`:''}</div><div class="plexCardTitle">${esc(titleOf(m))}</div><div class="plexCardMeta">${esc(meta||durationText(m.duration_seconds))}</div></button>`
}
function episodeCard(m,index){
  const art=landscapeArt(m),ep=episodeNumber(m),progress=Number(m.progress_percent||0);const title=m.episode_title||titleOf(m);const number=ep!=null?`Episodio ${ep}`:`Episodio ${index+1}`;
  return `<button class="plexEpisode" data-media="${Number(m.id)}"><div class="plexEpisodeArt">${art?`<img src="${esc(art)}" alt="" loading="lazy">`:`<div class="plexEpisodeFallback">${esc(number)}</div>`}<span class="plexEpisodeShade"></span><span class="plexEpisodePlay">▶</span>${m.completed?'<span class="plexWatched">✓</span>':''}${progress>1&&!m.completed?`<span class="plexProgress"><i style="width:${Math.min(100,progress)}%"></i></span>`:''}</div><div class="plexEpisodeText"><b>${esc(number)} · ${esc(title)}</b><span>${esc(durationText(m.duration_seconds))}${m.release_date?` · ${esc(String(m.release_date).slice(0,10))}`:''}</span></div></button>`;
}
function seasonCard(season,payload,fallback,activeKey){
  const art=artworkForSeason(season,payload,fallback),info=seasonMeta(season,payload);const unwatched=season.items.filter(x=>!x.completed).length;
  return `<button class="plexSeasonCard ${season.key===activeKey?'active':''}" data-season="${esc(season.key)}"><div class="plexSeasonPoster">${art?`<img src="${esc(art)}" alt="" loading="lazy">`:`<div class="plexPosterFallback">${esc(season.label)}</div>`}<span class="plexSeasonShade"></span><span class="plexSeasonHover">▶</span>${unwatched?`<span class="plexUnwatched">${unwatched}</span>`:'<span class="plexSeasonDone">✓</span>'}</div><div class="plexSeasonName">${esc(info?.name||season.label)}</div><div class="plexSeasonCount">${season.items.length} ${season.items.length===1?'episodio':'episodi'}${info?.airDate?` · ${esc(String(info.airDate).slice(0,4))}`:''}</div></button>`;
}
function sortItems(items){const out=[...items];if(plexState.sort==='recent')out.sort((a,b)=>updatedOf(b)-updatedOf(a));else if(plexState.sort==='year')out.sort((a,b)=>yearOf(b)-yearOf(a)||titleOf(a).localeCompare(titleOf(b),'it'));else out.sort((a,b)=>titleOf(a).localeCompare(titleOf(b),'it',{numeric:true}));return out}
function sortEpisodes(items){return [...items].sort((a,b)=>(episodeNumber(a)??99999)-(episodeNumber(b)??99999)||String(a.filename||'').localeCompare(String(b.filename||''),'it',{numeric:true}))}
function iconFor(name){return ({Film:'▣',Cartoni:'◉',Marvel:'◆',OP2:'☠',Naruto:'◎',Serie:'▤','South Park':'▥'})[name]||'□'}

function renderSidebar(){
  const host=P('#plexLibraries');
  host.innerHTML=LIBRARIES.map(name=>{const count=(plexState.byLibrary.get(name)||[]).length;return `<button class="plexNavButton ${plexState.activeLibrary===name?'active':''}" data-library="${esc(name)}"><span class="plexNavIcon">${iconFor(name)}</span><span>${esc(name)}</span><span class="plexNavCount">${count}</span></button>`}).join('');
  P('#plexHomeNav').classList.toggle('active',!plexState.activeLibrary);
}

function renderHome(){
  ++plexState.viewToken;plexState.activeLibrary=null;plexState.activeShowLibrary=null;plexState.activeSeries=null;plexState.activeSeason=null;renderSidebar();
  const cont=plexState.items.filter(x=>Number(x.progress_seconds||0)>30&&!x.completed).sort((a,b)=>Date.parse(b.progress_updated_at||0)-Date.parse(a.progress_updated_at||0)).slice(0,20);
  const libraryRows=LIBRARIES.map(name=>{const recent=[...(plexState.byLibrary.get(name)||[])].sort((a,b)=>updatedOf(b)-updatedOf(a)).slice(0,14);return recent.length?`<section class="plexSection"><div class="plexSectionHead"><h2 class="plexSectionTitle">Aggiunti di recente · ${esc(name)}</h2><button class="plexSeeAll" data-library="${esc(name)}">Vedi tutto</button></div><div class="plexHorizontal">${recent.map(posterCard).join('')}</div></section>`:''}).join('');
  P('#plexView').innerHTML=`<div class="plexPageHead"><h1 class="plexPageTitle">Home</h1><div class="plexHeadSpacer"></div></div>${cont.length?`<section class="plexSection"><div class="plexSectionHead"><h2 class="plexSectionTitle">Continua a guardare</h2></div><div class="plexHorizontal">${cont.map(posterCard).join('')}</div></section>`:''}${libraryRows}`;
}

function renderLibrary(name){
  ++plexState.viewToken;plexState.activeLibrary=name;plexState.activeShowLibrary=null;plexState.activeSeries=null;plexState.activeSeason=null;renderSidebar();const items=plexState.byLibrary.get(name)||[];
  if(name==='Serie')return renderSeriesIndex(items);
  if(DIRECT_SHOW_LIBRARIES.has(name)){void renderRootSeries(name,null);return}
  const sorted=sortItems(items);
  P('#plexView').innerHTML=`${libraryHead(name,items.length)}${sorted.length?`<div class="plexGrid">${sorted.map(posterCard).join('')}</div>`:`<div class="plexEmpty">Nessun media indicizzato in questa cartella.</div>`}`;
}
function libraryHead(name,count,crumb=''){
  const breadcrumb=crumb||`<span>›</span><span>${esc(name)}</span>`;
  return `<div class="plexPageHead"><div><div class="plexBreadcrumb"><button data-home-link>Home</button>${breadcrumb}</div><h1 class="plexPageTitle">${esc(name)}</h1></div><div class="plexHeadSpacer"></div><span class="plexCount">${count} elementi</span><select class="plexSelect" id="plexSort"><option value="title" ${plexState.sort==='title'?'selected':''}>Titolo</option><option value="recent" ${plexState.sort==='recent'?'selected':''}>Più recenti</option><option value="year" ${plexState.sort==='year'?'selected':''}>Anno</option></select></div>`
}

function renderSeriesIndex(items){
  const groups=new Map();for(const item of items){const folder=seriesFolder(item)||'Altro';if(!groups.has(folder))groups.set(folder,[]);groups.get(folder).push(item)}
  const list=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],'it',{numeric:true}));
  P('#plexView').innerHTML=`${libraryHead('Serie',items.length)}${list.length?`<div class="plexSeriesGrid">${list.map(([folder,media])=>seriesTile(folder,media)).join('')}</div>`:`<div class="plexEmpty">Nessuna sottocartella trovata sotto /Serie.</div>`}`;
}
function seriesTile(folder,media){
  const sample=media.find(x=>x.poster_url)||media.find(x=>artOf(x))||media[0],art=sample?.poster_url||artOf(sample);const seasons=groupSeasons(media);
  return `<button class="plexSeriesCard" data-series="${esc(folder)}"><div class="plexSeriesArt">${art?`<img src="${esc(art)}" alt="" loading="lazy">`:`<div class="plexPosterFallback">${esc(folder)}</div>`}<span class="plexPosterShade"></span><span class="plexPlayBadge">›</span></div><div class="plexCardTitle">${esc(folder)}</div><div class="plexCardMeta">${seasons.length} ${seasons.length===1?'stagione':'stagioni'} · ${media.length} episodi</div></button>`
}

async function renderShowPage({library,displayName,all,requestedSeason=null,pathLabel,breadcrumb}){
  const token=++plexState.viewToken;plexState.activeLibrary=library;plexState.activeShowLibrary=library;plexState.activeSeries=displayName;renderSidebar();
  const seasons=groupSeasons(all);if(!seasons.length){P('#plexView').innerHTML='<div class="plexEmpty">Nessun episodio.</div>';return}
  const requested=requestedSeason||plexState.activeSeason,active=seasons.find(s=>s.key===requested)||seasons[0];plexState.activeSeason=active.key;
  const sample=all.find(x=>x.poster_url)||all[0];
  P('#plexView').innerHTML='<div class="plexLoading"><span class="plexSpinner"></span>Carico la serie…</div>';
  const payload=await showArtwork(all);if(token!==plexState.viewToken)return;
  const backdrop=payload?.backdropUrl||all.find(x=>x.backdrop_url)?.backdrop_url||sample?.backdrop_url||null;
  const poster=payload?.posterUrl||sample?.poster_url||artOf(sample);const episodes=sortEpisodes(active.items);
  const meta=[`${seasons.length} ${seasons.length===1?'stagione':'stagioni'}`,`${all.length} episodi`,sample?.release_year||null].filter(Boolean).join(' · ');
  const seasonOptions=seasons.map(s=>`<option value="${esc(s.key)}" ${s.key===active.key?'selected':''}>${esc(s.label)} (${s.items.length})</option>`).join('');
  const activeInfo=seasonMeta(active,payload);const activeTitle=activeInfo?.name||active.label;
  const firstEpisode=episodes.find(x=>!x.completed)||episodes[0];
  P('#plexView').innerHTML=`
    <section class="plexShowHero">${backdrop?`<img class="plexShowBackdrop" src="${esc(backdrop)}" alt="">`:''}<div class="plexShowFade"></div>
      <div class="plexShowContent"><div class="plexShowPoster">${poster?`<img src="${esc(poster)}" alt="">`:`<div class="plexPosterFallback">${esc(displayName)}</div>`}</div>
        <div class="plexShowInfo"><div class="plexBreadcrumb">${breadcrumb}</div><h1>${esc(payload?.title||displayName)}</h1><div class="plexShowMeta">${esc(meta)}</div>
          <div class="plexShowActions">${firstEpisode?`<button class="plexPrimaryAction" data-media="${Number(firstEpisode.id)}">▶ Riproduci</button>`:''}<button class="plexSecondaryAction" data-show-more>•••</button></div>
        </div></div>
    </section>
    <section class="plexSeasonSection"><div class="plexSectionHead plexSeasonHead"><h2 class="plexSectionTitle">Stagioni</h2><span>${seasons.length}</span></div><div class="plexSeasonRail">${seasons.map(s=>seasonCard(s,payload,poster,active.key)).join('')}</div></section>
    <section class="plexEpisodeSection"><div class="plexSeasonToolbar"><div><label for="plexSeasonSelect">${esc(activeTitle)}</label><select class="plexSeasonSelect" id="plexSeasonSelect">${seasonOptions}</select></div><span>${episodes.length} ${episodes.length===1?'episodio':'episodi'}${active.folder?` · ${esc(active.folder)}`:''}</span></div>${activeInfo?.overview?`<p class="plexSeasonOverview">${esc(activeInfo.overview)}</p>`:''}<div class="plexEpisodes">${episodes.map(episodeCard).join('')}</div></section>
    <div class="plexPathHint">Struttura: ${pathLabel}</div>`;
}

function renderSeries(folder,requestedSeason=null){
  const all=(plexState.byLibrary.get('Serie')||[]).filter(x=>(seriesFolder(x)||'Altro')===folder);
  const breadcrumb=`<button data-home-link>Home</button><span>›</span><button data-library="Serie">Serie</button>`;
  return renderShowPage({library:'Serie',displayName:folder,all,requestedSeason,pathLabel:`/Serie/${esc(folder)}/`,breadcrumb});
}
function renderRootSeries(library,requestedSeason=null){
  const all=plexState.byLibrary.get(library)||[],displayName=DIRECT_SHOW_NAMES[library]||library;
  const breadcrumb=`<button data-home-link>Home</button><span>›</span><span>${esc(library)}</span>`;
  return renderShowPage({library,displayName,all,requestedSeason,pathLabel:`/${esc(library)}/`,breadcrumb});
}
function rerenderActiveShow(season){
  if(DIRECT_SHOW_LIBRARIES.has(plexState.activeShowLibrary))return renderRootSeries(plexState.activeShowLibrary,season);
  if(plexState.activeShowLibrary==='Serie'&&plexState.activeSeries)return renderSeries(plexState.activeSeries,season);
}

function bindPlex(){
  document.addEventListener('click',e=>{
    const lib=e.target.closest('[data-library]');if(lib){e.preventDefault();renderLibrary(lib.dataset.library);return}
    const series=e.target.closest('[data-series]');if(series){e.preventDefault();plexState.activeSeason=null;void renderSeries(series.dataset.series);return}
    const season=e.target.closest('[data-season]');if(season){e.preventDefault();void rerenderActiveShow(season.dataset.season);return}
    if(e.target.closest('[data-home-link]')){e.preventDefault();renderHome()}
  });
  P('#plexHomeNav').addEventListener('click',renderHome);
  P('#homeBtn').addEventListener('click',renderHome);
  P('#plexView').addEventListener('change',e=>{
    if(e.target.id==='plexSort'){plexState.sort=e.target.value;if(plexState.activeLibrary)renderLibrary(plexState.activeLibrary)}
    if(e.target.id==='plexSeasonSelect')void rerenderActiveShow(e.target.value);
  });
}

async function bootPlex(){
  try{P('#plexView').innerHTML='<div class="plexLoading"><span class="plexSpinner"></span>Carico la libreria…</div>';await loadLibrary();renderHome();bindPlex()}catch(error){P('#plexView').innerHTML=`<div class="plexEmpty">Errore caricamento libreria: ${esc(error.message)}</div>`}
}
bootPlex();
