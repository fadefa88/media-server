const LIBRARIES = ['Film','Cartoni','Marvel','OP2','Naruto','Serie','South Park'];
const DIRECT_SHOW_LIBRARIES = new Set(['OP2','Naruto','South Park']);
const DIRECT_SHOW_NAMES = { OP2:'One Piece', Naruto:'Naruto', 'South Park':'South Park' };
const P = s => document.querySelector(s);
const esc = (s='') => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plexState = {
  items:[], byLibrary:new Map(), activeLibrary:null, activeShowLibrary:null, activeSeries:null, activeSeason:null,
  sort:'title', direction:'asc', filter:'all', view:'grid', tab:'browse', loaded:false, viewToken:0,
  route:{type:'home'}, history:[], search:'', density:'comfortable'
};
const showArtworkCache = new Map();

function splitPath(item){return String(item.relative_path||'').split(/[\\/]/).filter(Boolean)}
function rootOf(item){return splitPath(item)[0]||'Altro'}
function seriesFolder(item){const p=splitPath(item);return p[0]==='Serie'&&p.length>2?p[1]:null}
function titleOf(item){return item.display_title||item.title||item.filename||'Senza titolo'}
function artOf(item){return item.poster_url||item.backdrop_url||null}
function landscapeArt(item){return item.backdrop_url||item.poster_url||null}
function yearOf(item){return Number(item.release_year||0)||0}
function ratingOf(item){return Number(item.vote_average||0)||0}
function updatedOf(item){return Date.parse(item.updated_at||item.progress_updated_at||0)||0}
function durationText(sec){sec=Math.max(0,Number(sec||0));const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);return h?`${h}h ${m}m`:`${m} min`}
function isHdr(item){return Boolean(item.hdr&&String(item.hdr).toUpperCase()!=='SDR')}
function is4k(item){return Number(item.width||0)>=3000}
function mediaMeta(item){return [item.release_year||null,item.media_kind==='tv'&&item.season_number!=null&&item.episode_number!=null?`S${String(item.season_number).padStart(2,'0')}E${String(item.episode_number).padStart(2,'0')}`:null].filter(Boolean).join(' · ')}
function episodeNumber(item){
  if(item.episode_number!=null)return Number(item.episode_number);
  const name=String(item.filename||'');
  const m=name.match(/\bS\d{1,3}[ ._-]*E(?:P)?[ ._-]?(\d{1,4})\b/i)||name.match(/\bE(?:P)?[ ._-]?(\d{1,4})\b/i)||name.match(/\b\d{1,3}x(\d{1,4})\b/i);
  return m?Number(m[1]):null;
}
function showKey(item){
  const root=rootOf(item);
  if(root==='Serie')return `Serie:${seriesFolder(item)||item.title||'Altro'}`;
  if(DIRECT_SHOW_LIBRARIES.has(root))return `${root}:${DIRECT_SHOW_NAMES[root]||root}`;
  return null;
}
function genresOf(item){
  const value=item.genres;
  if(Array.isArray(value))return value.filter(Boolean).map(String);
  if(value&&typeof value==='object')return Object.values(value).filter(Boolean).map(String);
  if(typeof value==='string'){
    try{const parsed=JSON.parse(value);if(Array.isArray(parsed))return parsed.filter(Boolean).map(String)}catch{}
    return value.split(/[,|]/).map(x=>x.trim()).filter(Boolean);
  }
  return [];
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
function artworkForSeason(season,payload,fallback){const match=payload?.seasons?.find(s=>Number(s.seasonNumber)===Number(season.number));return match?.posterUrl||fallback||null}
function seasonMeta(season,payload){return payload?.seasons?.find(s=>Number(s.seasonNumber)===Number(season.number))||null}

async function getJson(url){const r=await fetch(url);if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}
async function loadLibrary(){
  if(plexState.loaded)return;
  const page=500;let offset=0,total=Infinity;const items=[];
  while(offset<total){const d=await getJson(`/api/media?limit=${page}&offset=${offset}`);total=Number(d.count||0);items.push(...(d.items||[]));if(!(d.items||[]).length)break;offset+=page}
  plexState.items=items.filter(x=>x.status==='OK');
  plexState.byLibrary.clear();for(const name of LIBRARIES)plexState.byLibrary.set(name,[]);
  for(const item of plexState.items){const root=rootOf(item);if(!plexState.byLibrary.has(root))plexState.byLibrary.set(root,[]);plexState.byLibrary.get(root).push(item)}
  window.LDFPlexMediaIndex=Object.fromEntries(plexState.items.map(item=>[Number(item.id),{id:Number(item.id),title:titleOf(item),subtitle:item.display_subtitle||mediaMeta(item),art:landscapeArt(item),poster:artOf(item),duration:Number(item.duration_seconds||0)}]));
  plexState.loaded=true;
}

function setPlaybackContext(items){window.LDFPlexPlaybackContextIds=(items||[]).map(x=>Number(typeof x==='object'?x.id:x)).filter(Number.isFinite)}
function capturePlaybackContext(target){
  const card=target.closest?.('[data-media]');if(!card)return;
  const group=card.closest('.plexHorizontal,.plexGrid,.plexList,.plexEpisodes,.plexCategoryItems');
  if(group)setPlaybackContext([...group.querySelectorAll('[data-media]')].map(x=>Number(x.dataset.media)));
}

function statusBadge(m){
  if(m.completed)return '<span class="plexStateMark watched" title="Visto"><i class="fa-solid fa-check"></i></span>';
  if(m.in_watchlist)return '<span class="plexStateMark watchlist" title="Da vedere"><i class="fa-solid fa-bookmark"></i></span>';
  return '';
}
function resolutionBadge(m){if(is4k(m)&&isHdr(m))return '4K HDR';if(is4k(m))return '4K';if(isHdr(m))return String(m.hdr||'HDR').replace('Dolby Vision','DV');return ''}
function posterCard(m){
  const art=artOf(m),progress=Number(m.progress_percent||0),meta=mediaMeta(m),badge=resolutionBadge(m);
  return `<article class="plexCardWrap"><button class="plexCard" data-media="${Number(m.id)}" title="${esc(titleOf(m))}"><div class="plexPoster">${art?`<img src="${esc(art)}" alt="" loading="lazy">`:`<div class="plexPosterFallback">${esc(titleOf(m))}</div>`}<span class="plexPosterShade"></span><span class="plexHoverActions"><span class="plexPlayBadge" data-quick-play="${Number(m.id)}" aria-label="Riproduci"><i class="fa-solid fa-play"></i></span><span class="plexMoreBadge" data-card-menu="${Number(m.id)}" aria-label="Altre azioni"><i class="fa-solid fa-ellipsis"></i></span></span>${badge?`<span class="plexBadge">${esc(badge)}</span>`:''}${statusBadge(m)}${progress>1&&!m.completed?`<span class="plexProgress"><i style="width:${Math.min(100,progress)}%"></i></span>`:''}</div><div class="plexCardTitle">${esc(titleOf(m))}</div><div class="plexCardMeta">${esc(meta||durationText(m.duration_seconds))}</div></button></article>`
}
function listRow(m){
  const art=artOf(m),progress=Number(m.progress_percent||0),genres=genresOf(m).slice(0,2).join(', ');
  return `<button class="plexListRow" data-media="${Number(m.id)}"><div class="plexListThumb">${art?`<img src="${esc(art)}" alt="" loading="lazy">`:''}<span class="plexListPlay" data-quick-play="${Number(m.id)}"><i class="fa-solid fa-play"></i></span></div><div class="plexListTitle"><b>${esc(titleOf(m))}</b><span>${esc(m.original_title&&m.original_title!==m.title?m.original_title:'')}</span></div><span>${esc(String(m.release_year||'—'))}</span><span>${esc(genres||'—')}</span><span>${esc(durationText(m.duration_seconds))}</span><span>${progress>1&&!m.completed?`${Math.round(progress)}%`:m.completed?'Visto':'Non visto'}</span><span class="plexListMore" data-card-menu="${Number(m.id)}"><i class="fa-solid fa-ellipsis"></i></span></button>`;
}
function episodeCard(m,index){
  const art=landscapeArt(m),ep=episodeNumber(m),progress=Number(m.progress_percent||0);const title=m.episode_title||titleOf(m);const number=ep!=null?`Episodio ${ep}`:`Episodio ${index+1}`;
  return `<button class="plexEpisode" data-media="${Number(m.id)}"><div class="plexEpisodeArt">${art?`<img src="${esc(art)}" alt="" loading="lazy">`:`<div class="plexEpisodeFallback">${esc(number)}</div>`}<span class="plexEpisodeShade"></span><span class="plexEpisodePlay" data-quick-play="${Number(m.id)}"><i class="fa-solid fa-play"></i></span>${m.completed?'<span class="plexWatched"><i class="fa-solid fa-check"></i></span>':''}${progress>1&&!m.completed?`<span class="plexProgress"><i style="width:${Math.min(100,progress)}%"></i></span>`:''}</div><div class="plexEpisodeText"><b>${esc(number)} · ${esc(title)}</b><span>${esc(durationText(m.duration_seconds))}${m.release_date?` · ${esc(String(m.release_date).slice(0,10))}`:''}</span>${m.overview?`<p>${esc(m.overview)}</p>`:''}</div></button>`;
}
function seasonCard(season,payload,fallback,activeKey){
  const art=artworkForSeason(season,payload,fallback),info=seasonMeta(season,payload);const unwatched=season.items.filter(x=>!x.completed).length;
  return `<button class="plexSeasonCard ${season.key===activeKey?'active':''}" data-season="${esc(season.key)}"><div class="plexSeasonPoster">${art?`<img src="${esc(art)}" alt="" loading="lazy">`:`<div class="plexPosterFallback">${esc(season.label)}</div>`}<span class="plexSeasonShade"></span><span class="plexSeasonHover"><i class="fa-solid fa-play"></i></span>${unwatched?`<span class="plexUnwatched">${unwatched}</span>`:'<span class="plexSeasonDone"><i class="fa-solid fa-check"></i></span>'}</div><div class="plexSeasonName">${esc(info?.name||season.label)}</div><div class="plexSeasonCount">${season.items.length} ${season.items.length===1?'episodio':'episodi'}${info?.airDate?` · ${esc(String(info.airDate).slice(0,4))}`:''}</div></button>`;
}

function filterItems(items){
  const f=plexState.filter;
  if(f==='unplayed')return items.filter(x=>!x.completed&&Number(x.progress_seconds||0)<30);
  if(f==='progress')return items.filter(x=>!x.completed&&Number(x.progress_seconds||0)>=30);
  if(f==='played')return items.filter(x=>x.completed);
  if(f==='4k')return items.filter(is4k);
  if(f==='hdr')return items.filter(isHdr);
  if(f==='watchlist')return items.filter(x=>x.in_watchlist);
  return items;
}
function sortItems(items){
  const out=[...items];
  const factor=plexState.direction==='desc'?-1:1;
  const cmp=plexState.sort==='recent'?(a,b)=>updatedOf(a)-updatedOf(b):
    plexState.sort==='year'?(a,b)=>yearOf(a)-yearOf(b)||titleOf(a).localeCompare(titleOf(b),'it'):
    plexState.sort==='rating'?(a,b)=>ratingOf(a)-ratingOf(b):
    plexState.sort==='duration'?(a,b)=>Number(a.duration_seconds||0)-Number(b.duration_seconds||0):
    (a,b)=>titleOf(a).localeCompare(titleOf(b),'it',{numeric:true});
  out.sort((a,b)=>factor*cmp(a,b));return out;
}
function sortEpisodes(items){return [...items].sort((a,b)=>(episodeNumber(a)??99999)-(episodeNumber(b)??99999)||String(a.filename||'').localeCompare(String(b.filename||''),'it',{numeric:true}))}
function iconFor(name){return ({Film:'fa-clapperboard',Cartoni:'fa-child-reaching',Marvel:'fa-bolt',OP2:'fa-skull-crossbones',Naruto:'fa-circle-dot',Serie:'fa-tv','South Park':'fa-snowflake'})[name]||'fa-folder'}

function pushRoute(route){
  const current=JSON.stringify(plexState.route),next=JSON.stringify(route);if(current!==next)plexState.history.push(structuredClone(plexState.route));
  plexState.route=route;renderRoute(route,false);
}
function goBack(){const prev=plexState.history.pop();if(prev){plexState.route=prev;renderRoute(prev,false)}else{plexState.route={type:'home'};renderHome(false)}}
function renderRoute(route=plexState.route,push=false){
  if(push)return pushRoute(route);
  if(route.type==='home')return renderHome(false);
  if(route.type==='library')return renderLibrary(route.name,false);
  if(route.type==='series')return renderSeries(route.folder,route.season,false);
  if(route.type==='rootSeries')return renderRootSeries(route.library,route.season,false);
  if(route.type==='categories')return renderCategories(route.name,false);
  renderHome(false);
}

function renderSidebar(){
  const host=P('#plexLibraries');
  host.innerHTML=LIBRARIES.map(name=>{const count=(plexState.byLibrary.get(name)||[]).length;return `<button class="plexNavButton ${plexState.activeLibrary===name?'active':''}" data-library="${esc(name)}"><span class="plexNavIcon"><i class="fa-solid ${iconFor(name)}"></i></span><span>${esc(name)}</span><span class="plexNavCount">${count}</span><span class="plexNavMore" data-library-more="${esc(name)}"><i class="fa-solid fa-ellipsis"></i></span></button>`}).join('');
  P('#plexHomeNav')?.classList.toggle('active',plexState.route.type==='home');
}
function section(title,items,{wide=false,seeAll=null}={}){
  if(!items.length)return '';
  return `<section class="plexSection"><div class="plexSectionHead"><h2 class="plexSectionTitle">${esc(title)}</h2>${seeAll?`<button class="plexSeeAll" data-library="${esc(seeAll)}">Vedi tutto <i class="fa-solid fa-chevron-right"></i></button>`:''}</div><div class="plexHorizontal ${wide?'wide':''}">${items.map(posterCard).join('')}</div></section>`;
}
function onDeckItems(){
  const groups=new Map();
  for(const item of plexState.items){const key=showKey(item);if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item)}
  const result=[];
  for(const items of groups.values()){
    const sorted=[...items].sort((a,b)=>Number(a.season_number||0)-Number(b.season_number||0)||(episodeNumber(a)??99999)-(episodeNumber(b)??99999));
    const touched=sorted.filter(x=>x.completed||Number(x.progress_seconds||0)>30);
    if(!touched.length)continue;
    const last=touched[touched.length-1],idx=sorted.indexOf(last);const next=sorted.slice(idx+1).find(x=>!x.completed)||(!last.completed?last:null);if(next)result.push(next);
  }
  return result.sort((a,b)=>Date.parse(b.progress_updated_at||0)-Date.parse(a.progress_updated_at||0)).slice(0,20);
}
function renderHome(updateRoute=true){
  ++plexState.viewToken;if(updateRoute)plexState.route={type:'home'};plexState.activeLibrary=null;plexState.activeShowLibrary=null;plexState.activeSeries=null;plexState.activeSeason=null;renderSidebar();
  const cont=plexState.items.filter(x=>Number(x.progress_seconds||0)>30&&!x.completed).sort((a,b)=>Date.parse(b.progress_updated_at||0)-Date.parse(a.progress_updated_at||0)).slice(0,20);
  const deck=onDeckItems();
  const recent=[...plexState.items].sort((a,b)=>updatedOf(b)-updatedOf(a)).slice(0,20);
  const released=[...plexState.items].filter(x=>yearOf(x)>0).sort((a,b)=>yearOf(b)-yearOf(a)||ratingOf(b)-ratingOf(a)).slice(0,20);
  const start=[...plexState.items].filter(x=>!x.completed&&Number(x.progress_seconds||0)<30).sort((a,b)=>ratingOf(b)-ratingOf(a)||updatedOf(b)-updatedOf(a)).slice(0,20);
  const rated=[...plexState.items].filter(x=>ratingOf(x)>0).sort((a,b)=>ratingOf(b)-ratingOf(a)).slice(0,20);
  const fourK=plexState.items.filter(is4k).sort((a,b)=>ratingOf(b)-ratingOf(a)).slice(0,20);
  const hdr=plexState.items.filter(isHdr).sort((a,b)=>ratingOf(b)-ratingOf(a)).slice(0,20);
  const libraryRows=LIBRARIES.map(name=>{const recentLib=[...(plexState.byLibrary.get(name)||[])].sort((a,b)=>updatedOf(b)-updatedOf(a)).slice(0,16);return section(`Aggiunti di recente · ${name}`,recentLib,{seeAll:name})}).join('');
  P('#plexView').innerHTML=`<div class="plexHomeTop"><h1>Home</h1><p>LDF Media Server</p></div>${section('Continua a guardare',cont,{wide:true})}${section('In primo piano',deck)}${section('Aggiunti di recente',recent)}${section('Usciti di recente',released)}${section('Inizia a guardare',start)}${section('Più apprezzati',rated)}${section('Ultra HD 4K',fourK)}${section('HDR & Dolby Vision',hdr)}${libraryRows}`;
  setPlaybackContext(cont.length?cont:recent);
}

function libraryTabs(name,active='browse'){
  return `<nav class="plexLibraryTabs" aria-label="Sezioni libreria"><button class="${active==='recommended'?'active':''}" data-library-tab="recommended" data-library-name="${esc(name)}">Consigliati</button><button class="${active==='browse'?'active':''}" data-library-tab="browse" data-library-name="${esc(name)}">Libreria</button><button class="${active==='categories'?'active':''}" data-library-tab="categories" data-library-name="${esc(name)}">Categorie</button></nav>`;
}
function filterToolbar(name,count){
  return `<div class="plexLibraryToolbar"><div class="plexToolbarLeft"><select class="plexSelect" id="plexFilter" aria-label="Filtro"><option value="all" ${plexState.filter==='all'?'selected':''}>Tutti</option><option value="unplayed" ${plexState.filter==='unplayed'?'selected':''}>Non visti</option><option value="progress" ${plexState.filter==='progress'?'selected':''}>In corso</option><option value="played" ${plexState.filter==='played'?'selected':''}>Visti</option><option value="4k" ${plexState.filter==='4k'?'selected':''}>4K</option><option value="hdr" ${plexState.filter==='hdr'?'selected':''}>HDR</option></select><span class="plexCount">${count} elementi</span></div><div class="plexToolbarRight"><select class="plexSelect" id="plexSort"><option value="title" ${plexState.sort==='title'?'selected':''}>Titolo</option><option value="recent" ${plexState.sort==='recent'?'selected':''}>Data aggiunta</option><option value="year" ${plexState.sort==='year'?'selected':''}>Anno</option><option value="rating" ${plexState.sort==='rating'?'selected':''}>Valutazione</option><option value="duration" ${plexState.sort==='duration'?'selected':''}>Durata</option></select><button class="plexIconButton" id="plexDirection" title="Inverti ordine"><i class="fa-solid fa-arrow-${plexState.direction==='asc'?'down-a-z':'up-a-z'}"></i></button><button class="plexIconButton ${plexState.view==='grid'?'active':''}" data-view="grid" title="Griglia"><i class="fa-solid fa-grip"></i></button><button class="plexIconButton ${plexState.view==='list'?'active':''}" data-view="list" title="Elenco"><i class="fa-solid fa-list"></i></button></div></div>`;
}
function libraryHead(name,crumb=''){
  const breadcrumb=crumb||`<span>›</span><span>${esc(name)}</span>`;
  return `<div class="plexLibraryHeader"><div class="plexBreadcrumb"><button data-home-link>Home</button>${breadcrumb}</div><div class="plexLibraryTitleRow"><h1 class="plexPageTitle">${esc(name)}</h1><button class="plexTitleMore" data-library-more="${esc(name)}"><i class="fa-solid fa-ellipsis"></i></button></div>${libraryTabs(name,plexState.tab)}</div>`;
}
function renderRecommended(name,items){
  const recent=[...items].sort((a,b)=>updatedOf(b)-updatedOf(a)).slice(0,18);
  const rated=[...items].filter(x=>ratingOf(x)>0).sort((a,b)=>ratingOf(b)-ratingOf(a)).slice(0,18);
  const unwatched=items.filter(x=>!x.completed).sort((a,b)=>ratingOf(b)-ratingOf(a)).slice(0,18);
  const genres=new Map();for(const item of items)for(const g of genresOf(item)){if(!genres.has(g))genres.set(g,[]);genres.get(g).push(item)}
  const genreRows=[...genres.entries()].filter(([,arr])=>arr.length>=3).sort((a,b)=>b[1].length-a[1].length).slice(0,4).map(([g,arr])=>section(`Più in ${g}`,arr.sort((a,b)=>ratingOf(b)-ratingOf(a)).slice(0,18))).join('');
  P('#plexView').innerHTML=`${libraryHead(name)}<div class="plexRecommended">${section('Aggiunti di recente',recent)}${section('Da iniziare',unwatched)}${section('Più apprezzati',rated)}${genreRows}</div>`;
  setPlaybackContext(recent);
}
function renderLibrary(name,updateRoute=true){
  ++plexState.viewToken;if(updateRoute)plexState.route={type:'library',name};plexState.activeLibrary=name;plexState.activeShowLibrary=null;plexState.activeSeries=null;plexState.activeSeason=null;renderSidebar();const items=plexState.byLibrary.get(name)||[];
  if(name==='Serie'&&plexState.tab==='browse')return renderSeriesIndex(items);
  if(DIRECT_SHOW_LIBRARIES.has(name)&&plexState.tab==='browse')return renderRootSeries(name,null,false);
  if(plexState.tab==='recommended')return renderRecommended(name,items);
  if(plexState.tab==='categories')return renderCategories(name,false);
  const visible=sortItems(filterItems(items));setPlaybackContext(visible);
  const body=plexState.view==='list'?`<div class="plexList"><div class="plexListHeader"><span></span><span>Titolo</span><span>Anno</span><span>Genere</span><span>Durata</span><span>Stato</span><span></span></div>${visible.map(listRow).join('')}</div>`:`<div class="plexGrid">${visible.map(posterCard).join('')}</div>`;
  P('#plexView').innerHTML=`${libraryHead(name)}${filterToolbar(name,visible.length)}${visible.length?body:`<div class="plexEmpty"><i class="fa-regular fa-folder-open"></i><b>Nessun elemento</b><span>Modifica i filtri o aggiorna la libreria.</span></div>`}`;
}
function renderCategories(name,updateRoute=true){
  if(updateRoute)plexState.route={type:'categories',name};plexState.activeLibrary=name;renderSidebar();const items=plexState.byLibrary.get(name)||[];
  const groups=new Map();for(const item of items)for(const genre of genresOf(item)){if(!groups.has(genre))groups.set(genre,[]);groups.get(genre).push(item)}
  const cards=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],'it')).map(([genre,media])=>`<section class="plexCategory"><div class="plexCategoryHead"><h2>${esc(genre)}</h2><span>${media.length}</span></div><div class="plexCategoryItems">${media.slice(0,12).map(posterCard).join('')}</div></section>`).join('');
  P('#plexView').innerHTML=`${libraryHead(name)}${cards||'<div class="plexEmpty"><i class="fa-solid fa-tags"></i><b>Nessuna categoria disponibile</b><span>I generi verranno mostrati quando presenti nei metadata.</span></div>'}`;
}

function renderSeriesIndex(items){
  const groups=new Map();for(const item of items){const folder=seriesFolder(item)||'Altro';if(!groups.has(folder))groups.set(folder,[]);groups.get(folder).push(item)}
  const list=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],'it',{numeric:true}));
  P('#plexView').innerHTML=`${libraryHead('Serie')}${filterToolbar('Serie',items.length)}${list.length?`<div class="plexSeriesGrid">${list.map(([folder,media])=>seriesTile(folder,media)).join('')}</div>`:`<div class="plexEmpty">Nessuna sottocartella trovata sotto /Serie.</div>`}`;
}
function seriesTile(folder,media){
  const sample=media.find(x=>x.poster_url)||media.find(x=>artOf(x))||media[0],art=sample?.poster_url||artOf(sample);const seasons=groupSeasons(media),unwatched=media.filter(x=>!x.completed).length;
  return `<button class="plexSeriesCard" data-series="${esc(folder)}"><div class="plexSeriesArt">${art?`<img src="${esc(art)}" alt="" loading="lazy">`:`<div class="plexPosterFallback">${esc(folder)}</div>`}<span class="plexPosterShade"></span><span class="plexPlayBadge"><i class="fa-solid fa-play"></i></span>${unwatched?`<span class="plexUnwatched">${unwatched}</span>`:''}</div><div class="plexCardTitle">${esc(folder)}</div><div class="plexCardMeta">${seasons.length} ${seasons.length===1?'stagione':'stagioni'} · ${media.length} episodi</div></button>`
}

async function renderShowPage({library,displayName,all,requestedSeason=null,pathLabel,breadcrumb,updateRoute=true,route}){
  const token=++plexState.viewToken;if(updateRoute&&route)plexState.route=route;plexState.activeLibrary=library;plexState.activeShowLibrary=library;plexState.activeSeries=displayName;renderSidebar();
  const seasons=groupSeasons(all);if(!seasons.length){P('#plexView').innerHTML='<div class="plexEmpty">Nessun episodio.</div>';return}
  const requested=requestedSeason||plexState.activeSeason,active=seasons.find(s=>s.key===requested)||seasons[0];plexState.activeSeason=active.key;
  const sample=all.find(x=>x.poster_url)||all[0];
  P('#plexView').innerHTML='<div class="plexLoading"><span class="plexSpinner"></span>Carico la serie…</div>';
  const payload=await showArtwork(all);if(token!==plexState.viewToken)return;
  const backdrop=payload?.backdropUrl||all.find(x=>x.backdrop_url)?.backdrop_url||sample?.backdrop_url||null;
  const poster=payload?.posterUrl||sample?.poster_url||artOf(sample),episodes=sortEpisodes(active.items);setPlaybackContext(episodes);
  const meta=[sample?.release_year||null,`${seasons.length} ${seasons.length===1?'stagione':'stagioni'}`,`${all.length} episodi`,ratingOf(sample)?`★ ${ratingOf(sample).toFixed(1)}`:null].filter(Boolean).join(' · ');
  const seasonOptions=seasons.map(s=>`<option value="${esc(s.key)}" ${s.key===active.key?'selected':''}>${esc(s.label)} (${s.items.length})</option>`).join('');
  const activeInfo=seasonMeta(active,payload),activeTitle=activeInfo?.name||active.label,firstEpisode=episodes.find(x=>Number(x.progress_seconds||0)>30&&!x.completed)||episodes.find(x=>!x.completed)||episodes[0];
  P('#plexView').innerHTML=`<section class="plexShowHero">${backdrop?`<img class="plexShowBackdrop" src="${esc(backdrop)}" alt="">`:''}<div class="plexShowFade"></div><div class="plexShowContent"><div class="plexShowPoster">${poster?`<img src="${esc(poster)}" alt="">`:`<div class="plexPosterFallback">${esc(displayName)}</div>`}</div><div class="plexShowInfo"><div class="plexBreadcrumb">${breadcrumb}</div><h1>${esc(payload?.title||displayName)}</h1><div class="plexShowMeta">${esc(meta)}</div>${sample?.overview?`<p class="plexShowOverview">${esc(sample.overview)}</p>`:''}<div class="plexShowActions">${firstEpisode?`<button class="plexPrimaryAction" data-quick-play="${Number(firstEpisode.id)}"><i class="fa-solid fa-play"></i> ${Number(firstEpisode.progress_seconds||0)>30?'Riprendi':'Riproduci'}</button>`:''}<button class="plexSecondaryAction" data-show-more title="Altre azioni"><i class="fa-solid fa-ellipsis"></i></button></div></div></div></section><section class="plexSeasonSection"><div class="plexSectionHead plexSeasonHead"><h2 class="plexSectionTitle">Stagioni</h2><span>${seasons.length}</span></div><div class="plexSeasonRail">${seasons.map(s=>seasonCard(s,payload,poster,active.key)).join('')}</div></section><section class="plexEpisodeSection"><div class="plexSeasonToolbar"><div><label for="plexSeasonSelect">${esc(activeTitle)}</label><select class="plexSeasonSelect" id="plexSeasonSelect">${seasonOptions}</select></div><span>${episodes.length} ${episodes.length===1?'episodio':'episodi'}${active.folder?` · ${esc(active.folder)}`:''}</span></div>${activeInfo?.overview?`<p class="plexSeasonOverview">${esc(activeInfo.overview)}</p>`:''}<div class="plexEpisodes">${episodes.map(episodeCard).join('')}</div></section><div class="plexPathHint">${pathLabel}</div>`;
}
function renderSeries(folder,requestedSeason=null,updateRoute=true){
  const all=(plexState.byLibrary.get('Serie')||[]).filter(x=>(seriesFolder(x)||'Altro')===folder),breadcrumb=`<button data-home-link>Home</button><span>›</span><button data-library="Serie">Serie</button>`;
  return renderShowPage({library:'Serie',displayName:folder,all,requestedSeason,pathLabel:`/Serie/${esc(folder)}/`,breadcrumb,updateRoute,route:{type:'series',folder,season:requestedSeason}});
}
function renderRootSeries(library,requestedSeason=null,updateRoute=true){
  const all=plexState.byLibrary.get(library)||[],displayName=DIRECT_SHOW_NAMES[library]||library,breadcrumb=`<button data-home-link>Home</button><span>›</span><span>${esc(library)}</span>`;
  return renderShowPage({library,displayName,all,requestedSeason,pathLabel:`/${esc(library)}/`,breadcrumb,updateRoute,route:{type:'rootSeries',library,season:requestedSeason}});
}
function rerenderActiveShow(season){
  if(DIRECT_SHOW_LIBRARIES.has(plexState.activeShowLibrary))return renderRootSeries(plexState.activeShowLibrary,season,false);
  if(plexState.activeShowLibrary==='Serie'&&plexState.activeSeries)return renderSeries(plexState.activeSeries,season,false);
}

function showCardMenu(id,anchor){
  document.querySelector('.plexContextMenu')?.remove();const m=plexState.items.find(x=>Number(x.id)===Number(id));if(!m)return;
  const menu=document.createElement('div');menu.className='plexContextMenu';menu.innerHTML=`<button data-menu-play="${id}"><i class="fa-solid fa-play"></i> Riproduci</button><button data-menu-detail="${id}"><i class="fa-solid fa-circle-info"></i> Dettagli</button><button data-menu-watch="${id}"><i class="fa-${m.in_watchlist?'solid':'regular'} fa-bookmark"></i> ${m.in_watchlist?'Rimuovi da Da vedere':'Aggiungi a Da vedere'}</button><button data-menu-watched="${id}"><i class="fa-solid fa-check"></i> ${m.completed?'Segna come non visto':'Segna come visto'}</button>`;
  document.body.appendChild(menu);const r=anchor.getBoundingClientRect();menu.style.left=`${Math.min(innerWidth-220,Math.max(8,r.right-200))}px`;menu.style.top=`${Math.min(innerHeight-180,r.bottom+6)}px`;setTimeout(()=>document.addEventListener('click',ev=>{if(!ev.target.closest?.('.plexContextMenu'))menu.remove()},{once:true}),0);
}
async function patchState(id,patch){
  const r=await fetch(`/api/media/${id}/state`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});if(!r.ok)throw new Error(`HTTP ${r.status}`);const next=await r.json();const m=plexState.items.find(x=>Number(x.id)===Number(id));if(m){m.in_watchlist=next.in_watchlist;m.completed=next.watched}renderRoute();
}

function bindPlex(){
  document.addEventListener('pointerdown',e=>capturePlaybackContext(e.target),true);
  document.addEventListener('click',async e=>{
    const quick=e.target.closest('[data-quick-play]');if(quick){e.preventDefault();e.stopPropagation();const id=Number(quick.dataset.quickPlay);window.LDFPlayer?.play?.(id);return}
    const menu=e.target.closest('[data-card-menu]');if(menu){e.preventDefault();e.stopPropagation();showCardMenu(Number(menu.dataset.cardMenu),menu);return}
    const menuPlay=e.target.closest('[data-menu-play]');if(menuPlay){e.preventDefault();window.LDFPlayer?.play?.(Number(menuPlay.dataset.menuPlay));return}
    const menuDetail=e.target.closest('[data-menu-detail]');if(menuDetail){e.preventDefault();window.LDFPlayer?.open?.(Number(menuDetail.dataset.menuDetail));return}
    const menuWatch=e.target.closest('[data-menu-watch]');if(menuWatch){e.preventDefault();const id=Number(menuWatch.dataset.menuWatch),m=plexState.items.find(x=>Number(x.id)===id);try{await patchState(id,{watchlist:!m?.in_watchlist})}catch{}return}
    const menuWatched=e.target.closest('[data-menu-watched]');if(menuWatched){e.preventDefault();const id=Number(menuWatched.dataset.menuWatched),m=plexState.items.find(x=>Number(x.id)===id);try{await patchState(id,{watched:!m?.completed})}catch{}return}
    const lib=e.target.closest('[data-library]');if(lib&&!e.target.closest('[data-library-more]')){e.preventDefault();plexState.tab='browse';pushRoute({type:'library',name:lib.dataset.library});return}
    const tab=e.target.closest('[data-library-tab]');if(tab){e.preventDefault();plexState.tab=tab.dataset.libraryTab;const name=tab.dataset.libraryName;if(plexState.tab==='categories')pushRoute({type:'categories',name});else pushRoute({type:'library',name});return}
    const series=e.target.closest('[data-series]');if(series){e.preventDefault();plexState.activeSeason=null;pushRoute({type:'series',folder:series.dataset.series,season:null});return}
    const season=e.target.closest('[data-season]');if(season){e.preventDefault();void rerenderActiveShow(season.dataset.season);return}
    const view=e.target.closest('[data-view]');if(view){plexState.view=view.dataset.view;renderRoute();return}
    if(e.target.closest('[data-home-link]')){e.preventDefault();pushRoute({type:'home'});return}
    const libMore=e.target.closest('[data-library-more]');if(libMore){e.preventDefault();e.stopPropagation();const name=libMore.dataset.libraryMore;const fake={getBoundingClientRect:()=>libMore.getBoundingClientRect()};showLibraryMenu(name,fake);return}
  });
  P('#plexHomeNav')?.addEventListener('click',()=>pushRoute({type:'home'}));
  P('#homeBtn')?.addEventListener('click',()=>pushRoute({type:'home'}));
  P('#backBtn')?.addEventListener('click',goBack);
  P('#plexView')?.addEventListener('change',e=>{
    if(e.target.id==='plexSort'){plexState.sort=e.target.value;renderRoute()}
    if(e.target.id==='plexFilter'){plexState.filter=e.target.value;renderRoute()}
    if(e.target.id==='plexSeasonSelect')void rerenderActiveShow(e.target.value);
  });
  P('#plexView')?.addEventListener('click',e=>{if(e.target.closest('#plexDirection')){plexState.direction=plexState.direction==='asc'?'desc':'asc';renderRoute()}});
}
async function triggerLibraryScan(name,button){
  if(button){button.disabled=true;button.querySelector('i')?.classList.add('fa-spin')}
  try{
    const r=await fetch('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({library:name})});
    const body=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(body.error||`HTTP ${r.status}`);
    if(button)button.innerHTML='<i class="fa-solid fa-check"></i> Scansione avviata';
  }catch(error){
    if(button){button.disabled=false;button.querySelector('i')?.classList.remove('fa-spin')}
    console.error(error);
  }
}
function showLibraryMenu(name,anchor){
  document.querySelector('.plexContextMenu')?.remove();
  const menu=document.createElement('div');menu.className='plexContextMenu';
  menu.innerHTML=`<button data-library-scan="${esc(name)}"><i class="fa-solid fa-rotate"></i> Scansiona libreria</button><button data-library="${esc(name)}"><i class="fa-solid fa-table-cells-large"></i> Apri libreria</button><button data-library-tab="recommended" data-library-name="${esc(name)}"><i class="fa-solid fa-star"></i> Consigliati</button>`;
  document.body.appendChild(menu);const r=anchor.getBoundingClientRect();
  menu.style.left=`${Math.min(innerWidth-220,Math.max(8,r.right-200))}px`;menu.style.top=`${Math.min(innerHeight-180,r.bottom+6)}px`;
  menu.querySelector('[data-library-scan]')?.addEventListener('click',e=>{e.stopPropagation();void triggerLibraryScan(name,e.currentTarget)});
  setTimeout(()=>document.addEventListener('click',ev=>{if(!ev.target.closest?.('.plexContextMenu'))menu.remove()},{once:true}),0);
}

async function bootPlex(){
  try{P('#plexView').innerHTML='<div class="plexLoading"><span class="plexSpinner"></span>Carico la libreria…</div>';await loadLibrary();renderHome();bindPlex()}catch(error){P('#plexView').innerHTML=`<div class="plexEmpty">Errore caricamento libreria: ${esc(error.message)}</div>`}
}
bootPlex();
