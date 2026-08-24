import {
  LIBRARIES,DIRECT_SHOWS,ui,saveStore,splitPath,rootOf,titleOf,artOf,landscapeOf,
  watched,progress,inProgress,quality,fmtDuration,genresOf,episodeNo,seriesFolder,
  representative,uniqueBy,mediaMeta,groupSeasons,showEntries,genreMap,api,loadLibrary,
  libItems,applyPrefs,savePrefs,sortItems,filterItems
} from './pf-data.js';

const $=s=>document.querySelector(s);
const esc=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={home:'⌂',watchlist:'☆',playlist:'☷',Film:'▣',Cartoni:'◉',Marvel:'◆',OP2:'☠',Naruto:'◎',Serie:'▤','South Park':'▥'};
let contextEl=null;

function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,2600)}
function watchedBadge(m){if(watched(m))return'<span class="pfWatched">✓</span>';if(inProgress(m))return`<span class="pfProgress"><i style="width:${progress(m)}%"></i></span>`;return''}
function pageHead(title,sub=''){return`<header class="pfPageHead"><div><h1>${esc(title)}</h1>${sub?`<p>${esc(sub)}</p>`:''}</div></header>`}
function labelFilter(){return({all:'Tutti',unplayed:'Non visti',progress:'In corso',played:'Visti','4k':'4K',hdr:'HDR'})[ui.filter]||'Tutti'}
function labelSort(){return({title:'Titolo',year:'Anno',added:'Data aggiunta',rating:'Valutazione',duration:'Durata',resolution:'Risoluzione'})[ui.sort]||'Titolo'}

function topbar(){
  const host=$('.topActions');
  if(!$('#pfActivityBtn')){
    const activity=document.createElement('button');
    activity.id='pfActivityBtn';activity.className='round pfTopIcon';activity.textContent='◌';activity.title='Attività';
    const queue=document.createElement('button');
    queue.id='pfQueueBtn';queue.className='round pfTopIcon';queue.textContent='☰';queue.title='Coda';
    host.insertBefore(activity,$('#systemBtn'));host.insertBefore(queue,$('#systemBtn'));
  }
}

function sidebar(){
  const side=$('.plexSidebar');
  side.innerHTML=`
    <section class="pfSideTop">
      <button class="pfSideItem ${ui.scope==='home'?'active':''}" data-nav="home"><span>${icons.home}</span>Home</button>
      <button class="pfSideItem ${ui.scope==='watchlist'?'active':''}" data-nav="watchlist"><span>${icons.watchlist}</span>Watchlist${ui.persist.watchlist.length?`<em>${ui.persist.watchlist.length}</em>`:''}</button>
      <button class="pfSideItem ${ui.scope==='playlists'?'active':''}" data-nav="playlists"><span>${icons.playlist}</span>Playlist</button>
    </section>
    <div class="pfSideLabel">Il tuo VELA</div>
    <nav>${LIBRARIES.map(name=>`
      <div class="pfLibWrap">
        <button class="pfSideItem ${(ui.library===name&&(ui.scope==='library'||ui.scope==='show'))?'active':''}" data-library="${esc(name)}">
          <span>${icons[name]}</span>${esc(name)}<em>${libItems(name).length}</em>
        </button>
        <button class="pfLibMore" data-library-more="${esc(name)}">•••</button>
      </div>`).join('')}</nav>
    <div class="pfSideLabel">Server</div>
    <button class="pfSideItem" data-open-system><span>◉</span>VELA Server<small>online</small></button>`;
}

function posterCard(m,{compact=false}={}){
  const selected=ui.selected.has(Number(m.id));
  const art=artOf(m);
  return`<article class="pfCard ${selected?'selected':''}" style="--w:${ui.poster}px">
    <button class="pfSelect ${selected?'on':''}" data-select-id="${m.id}">${selected?'✓':''}</button>
    <button class="pfPosterButton" data-media="${m.id}">
      <span class="pfPoster">${art?`<img src="${esc(art)}" loading="lazy" alt="">`:`<span class="pfFallback">${esc(titleOf(m))}</span>`}
        ${watchedBadge(m)}<span class="pfHoverShade"></span><span class="pfPlay">▶</span>${m.width>=3000?'<span class="pfQuality">4K</span>':''}
      </span>
      <span class="pfTitle">${esc(titleOf(m))}</span>${compact?'':`<span class="pfMeta">${esc(mediaMeta(m))}</span>`}
    </button>
    <button class="pfMore" data-more-id="${m.id}">•••</button>
  </article>`;
}
function listRow(m){
  const selected=ui.selected.has(Number(m.id));
  return`<div class="pfListRow ${selected?'selected':''}">
    <button class="pfSelect inline ${selected?'on':''}" data-select-id="${m.id}">${selected?'✓':''}</button>
    <button class="pfListPlay" data-media="${m.id}">▶</button>
    <button class="pfListMain" data-media="${m.id}"><b>${esc(titleOf(m))}</b><span>${esc(mediaMeta(m))}</span></button>
    <span>${esc(genresOf(m).slice(0,2).join(', '))}</span><span>${quality(m)}</span><span>${fmtDuration(m.duration_seconds)}</span>
    ${watched(m)?'<span class="pfCheck">✓</span>':'<span></span>'}<button class="pfMore inlineMore" data-more-id="${m.id}">•••</button>
  </div>`;
}
function summaryCard(m){
  const art=artOf(m);
  return`<article class="pfSummary">
    <button class="pfSummaryPoster" data-media="${m.id}">${art?`<img src="${esc(art)}" loading="lazy" alt="">`:'<span></span>'}</button>
    <div><button class="pfSummaryTitle" data-media="${m.id}">${esc(titleOf(m))}</button><div class="pfSummaryMeta">${esc([m.release_year,quality(m),fmtDuration(m.duration_seconds),genresOf(m).slice(0,3).join(' · ')].filter(Boolean).join(' · '))}</div><p>${esc(m.overview||'Nessuna descrizione disponibile.')}</p></div>
    <button class="pfMore" data-more-id="${m.id}">•••</button>
  </article>`;
}
function renderItems(items){
  if(!items.length)return'<div class="pfEmpty">Nessun elemento corrisponde ai filtri.</div>';
  if(ui.view==='list')return`<div class="pfList"><div class="pfListHead"><span></span><span></span><span>Titolo</span><span>Genere</span><span>Qualità</span><span>Durata</span><span></span><span></span></div>${items.map(listRow).join('')}</div>`;
  if(ui.view==='summary')return`<div class="pfSummaryGrid">${items.map(summaryCard).join('')}</div>`;
  return`<div class="pfGrid" style="--poster:${ui.poster}px">${items.map(posterCard).join('')}</div>`;
}
function rail(items){return`<div class="pfRail">${items.map(m=>posterCard(m,{compact:true})).join('')}</div>`}
function section(title,items,more=''){if(!items.length)return'';return`<section class="pfSection"><div class="pfSectionHead"><h2>${esc(title)}</h2>${more}</div>${rail(items)}</section>`}

function tabs(){
  if(!ui.library||DIRECT_SHOWS.has(ui.library))return'';
  const t=[['recommended','Consigliati'],['library','Libreria'],['collections','Raccolte'],['categories','Categorie']];
  return`<nav class="pfTabs">${t.map(([k,l])=>`<button class="${ui.tab===k?'active':''}" data-tab="${k}">${l}</button>`).join('')}</nav>`;
}
function toolbar(count){
  const types=ui.library==='Serie'?[['shows','Serie TV'],['seasons','Stagioni'],['episodes','Episodi'],['folders','Cartelle']]:[['items','Film'],['folders','Cartelle']];
  const typeLabel=types.find(x=>x[0]===ui.type)?.[1]||'Elementi';
  return`<div class="pfToolbar"><div class="pfToolLeft">
    <button class="pfDropdown" data-filter-menu>${labelFilter()}⌄</button>
    <button class="pfDropdown" data-type-menu>${typeLabel}⌄</button>
    <button class="pfDropdown" data-sort-menu>${labelSort()} ${ui.desc?'↓':'↑'}</button>
    <button class="pfIconBtn" data-play-all title="Aggiungi tutto alla coda">▶</button><button class="pfIconBtn" data-shuffle title="Aggiungi casuale alla coda">⤨</button><span class="pfCount">${count} elementi</span>
  </div><div class="pfToolRight"><label class="pfPosterSlider"><span>▦</span><input data-poster-size type="range" min="105" max="215" value="${ui.poster}"><span>▦</span></label>
    <div class="pfViewToggle"><button class="${ui.view==='grid'?'active':''}" data-view="grid">▦</button><button class="${ui.view==='list'?'active':''}" data-view="list">☷</button><button class="${ui.view==='summary'?'active':''}" data-view="summary">▤</button></div>
  </div></div>`;
}

function renderHome(){
  ui.scope='home';ui.library=null;ui.selected.clear();sidebar();
  const cont=ui.items.filter(inProgress).sort((a,b)=>Date.parse(b.progress_updated_at||0)-Date.parse(a.progress_updated_at||0)).slice(0,18);
  const recent=[...ui.items].sort((a,b)=>(Date.parse(b.updated_at||0)||0)-(Date.parse(a.updated_at||0)||0)).slice(0,18);
  const start=ui.items.filter(m=>!watched(m)&&!inProgress(m)).sort((a,b)=>Number(b.vote_average||0)-Number(a.vote_average||0)).slice(0,18);
  const libRows=LIBRARIES.map(name=>section(`Aggiunti di recente · ${name}`,[...libItems(name)].sort((a,b)=>(Date.parse(b.updated_at||0)||0)-(Date.parse(a.updated_at||0)||0)).slice(0,14),`<button class="pfSeeAll" data-library="${esc(name)}">Vedi tutto</button>`)).join('');
  $('#plexView').innerHTML=`${pageHead('Home')}${section('Continua a guardare',cont)}${section('Aggiunti di recente',recent)}${section('Inizia a guardare',start)}${libRows}`;
}

function openLibrary(name){
  ui.library=name;ui.folder=[];ui.series=null;ui.season=null;ui.selected.clear();applyPrefs(name);
  if(DIRECT_SHOWS.has(name)){ui.scope='show';sidebar();renderDirectShow(name);return}
  ui.scope='library';sidebar();renderLibrary();
}
function renderLibrary(){
  if(ui.tab==='recommended'){renderRecommended();return}
  if(ui.tab==='collections'){renderCollections();return}
  if(ui.tab==='categories'){renderCategories();return}
  if(ui.type==='folders'){renderFolders();return}
  const all=libItems(ui.library);
  let body='';let count=0;
  if(ui.library==='Serie'&&ui.type==='shows'){
    let entries=showEntries(all);
    if(ui.advanced.genre)entries=entries.filter(([,eps])=>eps.some(m=>genresOf(m).includes(ui.advanced.genre)));
    if(ui.advanced.year)entries=entries.filter(([,eps])=>eps.some(m=>String(m.release_year||'')===String(ui.advanced.year)));
    count=entries.length;body=renderShows(entries);
  }else if(ui.library==='Serie'&&ui.type==='seasons'){
    const rows=[];for(const [show,eps] of showEntries(all))for(const season of groupSeasons(eps)){const m=representative(season.items);rows.push({...m,display_title:`${show} · ${season.label}`})}
    const visible=filterItems(rows);count=visible.length;body=renderItems(visible);
  }else{
    const visible=filterItems(all);count=visible.length;body=renderItems(visible);
  }
  $('#plexView').innerHTML=`${pageHead(ui.library)}${tabs()}${toolbar(count)}${body}`;bindPosterSlider();
}
function renderRecommended(){
  const items=libItems(ui.library);const recent=[...items].sort((a,b)=>(Date.parse(b.updated_at||0)||0)-(Date.parse(a.updated_at||0)||0)).slice(0,18);
  const cont=items.filter(inProgress).slice(0,18);const best=items.filter(m=>!watched(m)).sort((a,b)=>Number(b.vote_average||0)-Number(a.vote_average||0)).slice(0,18);
  const genreRows=[...genreMap(items).entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,3).map(([g,v])=>section(`Più in ${g}`,uniqueForLibrary(v).slice(0,18))).join('');
  $('#plexView').innerHTML=`${pageHead(ui.library)}${tabs()}${section('Continua a guardare',uniqueForLibrary(cont))}${section('Aggiunti di recente',uniqueForLibrary(recent))}${section('Da vedere',uniqueForLibrary(best))}${genreRows}`;
}
function uniqueForLibrary(items){
  if(ui.library!=='Serie')return items;
  return uniqueBy(items,m=>seriesFolder(m)||m.tmdb_id||m.id).map(m=>{const s=seriesFolder(m);return s?{...m,display_title:s}:m});
}
function renderShows(entries){
  if(!entries.length)return'<div class="pfEmpty">Nessuna serie.</div>';
  return`<div class="pfGrid" style="--poster:${ui.poster}px">${entries.map(([name,eps])=>{const m=representative(eps),art=artOf(m),unseen=eps.filter(x=>!watched(x)).length;return`<article class="pfCard"><button class="pfPosterButton" data-open-show="${esc(name)}"><span class="pfPoster">${art?`<img src="${esc(art)}" loading="lazy" alt="">`:`<span class="pfFallback">${esc(name)}</span>`}${unseen?`<span class="pfUnwatched">${unseen}</span>`:''}<span class="pfHoverShade"></span><span class="pfPlay">›</span></span><span class="pfTitle">${esc(name)}</span><span class="pfMeta">${eps.length} episodi</span></button><button class="pfMore" data-series-more="${esc(name)}">•••</button></article>`}).join('')}</div>`;
}

function renderCategories(){
  const rows=[...genreMap(libItems(ui.library)).entries()].sort((a,b)=>a[0].localeCompare(b[0],'it'));
  $('#plexView').innerHTML=`${pageHead(ui.library)}${tabs()}<div class="pfCategoryGrid">${rows.map(([g,v])=>`<button class="pfCategory" data-category="${esc(g)}"><span>${esc(g)}</span><em>${ui.library==='Serie'?uniqueBy(v,m=>seriesFolder(m)||m.tmdb_id||m.id).length:v.length}</em></button>`).join('')}</div>`;
}
function openCategory(genre){ui.tab='library';ui.type=ui.library==='Serie'?'shows':'items';ui.filter='all';ui.advanced.genre=genre;savePrefs();renderLibrary()}

function libraryCollections(){return Object.entries(ui.persist.collections).filter(([,c])=>c.library===ui.library)}
function renderCollections(){
  const list=libraryCollections();
  $('#plexView').innerHTML=`${pageHead(ui.library)}${tabs()}<div class="pfCollectionHead"><h2>Raccolte</h2><button class="pfPrimary" data-new-collection>+ Nuova raccolta</button></div>${list.length?`<div class="pfCollectionGrid">${list.map(([id,c])=>collectionTile(id,c)).join('')}</div>`:'<div class="pfEmpty">Nessuna raccolta.</div>'}`;
}
function collectionTile(id,c){
  const items=c.ids.map(id=>ui.items.find(m=>Number(m.id)===Number(id))).filter(Boolean),arts=items.map(artOf).filter(Boolean).slice(0,4);
  return`<button class="pfCollectionTile" data-collection="${id}"><span class="pfMosaic">${[0,1,2,3].map(i=>arts[i]?`<img src="${esc(arts[i])}" alt="">`:'<i></i>').join('')}</span><b>${esc(c.name)}</b><small>${items.length} elementi</small></button>`;
}
function openCollection(id){
  const c=ui.persist.collections[id];if(!c)return;ui.scope='collection';sidebar();
  const items=c.ids.map(x=>ui.items.find(m=>Number(m.id)===Number(x))).filter(Boolean);
  $('#plexView').innerHTML=`${pageHead(c.name,`${items.length} elementi · Raccolta`)}<div class="pfCollectionAction"><button data-back-library>‹ ${esc(c.library)}</button><button data-delete-collection="${id}">Elimina raccolta</button></div>${renderItems(items)}`;
}

function renderFolders(){
  const base=[ui.library,...ui.folder];const items=libItems(ui.library).filter(m=>base.every((s,i)=>splitPath(m)[i]===s));const folders=new Map(),files=[];
  for(const m of items){const p=splitPath(m);if(p.length>base.length+1){const child=p[base.length];if(!folders.has(child))folders.set(child,[]);folders.get(child).push(m)}else files.push(m)}
  const crumbs=base.map((x,i)=>`<button data-folder-depth="${i-1}">${esc(x)}</button>`).join('<span>›</span>');
  $('#plexView').innerHTML=`${pageHead(ui.library)}${tabs()}${toolbar(items.length)}<div class="pfFolderCrumbs">${crumbs}</div><div class="pfFolderGrid">${[...folders.entries()].sort((a,b)=>a[0].localeCompare(b[0],'it',{numeric:true})).map(([n,v])=>folderTile(n,v)).join('')}</div>${files.length?renderItems(filterItems(files)):''}`;bindPosterSlider();
}
function folderTile(name,items){const art=items.map(artOf).find(Boolean);return`<button class="pfFolderTile" data-folder="${esc(name)}"><span class="pfFolderIcon">${art?`<img src="${esc(art)}" alt="">`:'▰'}</span><b>${esc(name)}</b><small>${items.length} elementi</small></button>`}

function renderWatchlist(){
  ui.scope='watchlist';ui.library=null;sidebar();const ids=new Set(ui.persist.watchlist.map(Number));const items=sortItems(ui.items.filter(m=>ids.has(Number(m.id))));
  $('#plexView').innerHTML=`${pageHead('Watchlist',`${items.length} elementi`)}${simpleToolbar(items.length)}${renderItems(items)}`;bindPosterSlider();
}
function simpleToolbar(count){return`<div class="pfToolbar"><div class="pfToolLeft"><button class="pfDropdown" data-filter-menu>${labelFilter()}⌄</button><button class="pfDropdown" data-sort-menu>${labelSort()} ${ui.desc?'↓':'↑'}</button><span class="pfCount">${count} elementi</span></div><div class="pfToolRight"><label class="pfPosterSlider"><span>▦</span><input data-poster-size type="range" min="105" max="215" value="${ui.poster}"><span>▦</span></label><div class="pfViewToggle"><button class="${ui.view==='grid'?'active':''}" data-view="grid">▦</button><button class="${ui.view==='list'?'active':''}" data-view="list">☷</button><button class="${ui.view==='summary'?'active':''}" data-view="summary">▤</button></div></div></div>`}
function renderPlaylists(){
  ui.scope='playlists';ui.library=null;sidebar();const rows=Object.entries(ui.persist.playlists);
  $('#plexView').innerHTML=`${pageHead('Playlist')}<div class="pfCollectionHead"><h2>Le tue playlist</h2><button class="pfPrimary" data-new-playlist>+ Nuova playlist</button></div>${rows.length?`<div class="pfPlaylistGrid">${rows.map(([id,p])=>`<button class="pfPlaylistTile" data-playlist="${id}"><span>☷</span><b>${esc(p.name)}</b><small>${p.ids.length} elementi</small></button>`).join('')}</div>`:'<div class="pfEmpty">Nessuna playlist.</div>'}`;
}
function openPlaylist(id){
  const p=ui.persist.playlists[id];if(!p)return;ui.scope='playlist';sidebar();const items=p.ids.map(x=>ui.items.find(m=>Number(m.id)===Number(x))).filter(Boolean);
  $('#plexView').innerHTML=`${pageHead(p.name,`${items.length} elementi · Playlist`)}<div class="pfCollectionAction"><button data-nav="playlists">‹ Playlist</button><button data-queue-list="${esc(items.map(x=>x.id).join(','))}">Aggiungi alla coda</button><button data-delete-playlist="${id}">Elimina</button></div>${renderItems(items)}`;
}

async function openShow(name){ui.scope='show';ui.library='Serie';ui.series=name;ui.season=null;sidebar();const all=libItems('Serie').filter(m=>(seriesFolder(m)||'Altro')===name);await renderShow(name,all,'Serie')}
async function renderDirectShow(name){ui.scope='show';ui.library=name;ui.series=name;sidebar();await renderShow(name,libItems(name),name)}
async function renderShow(name,all,library){
  const seasons=groupSeasons(all);if(!seasons.length){$('#plexView').innerHTML='<div class="pfEmpty">Nessun episodio.</div>';return}
  const active=seasons.find(s=>s.key===ui.season)||seasons[0];ui.season=active.key;
  const sample=representative(all),back=all.find(x=>x.backdrop_url)?.backdrop_url||sample?.backdrop_url,poster=sample?.poster_url||artOf(sample),tmdb=all.find(x=>x.tmdb_id)?.tmdb_id;
  let seasonMeta=new Map();if(tmdb){try{let data=ui.seasonArt.get(tmdb);if(!data){data=await api(`/api/tmdb/tv/${tmdb}/seasons`);ui.seasonArt.set(tmdb,data)}seasonMeta=new Map((data.seasons||[]).map(s=>[Number(s.season_number),s]))}catch{}}
  const episodes=[...active.items].sort((a,b)=>(episodeNo(a)??99999)-(episodeNo(b)??99999)||String(a.filename||'').localeCompare(String(b.filename||''),'it',{numeric:true}));
  const unseen=all.filter(m=>!watched(m)).length;
  $('#plexView').innerHTML=`<section class="pfShowHero">${back?`<img class="pfShowBackdrop" src="${esc(back)}" alt="">`:''}<div class="pfShowShade"></div><div class="pfShowContent"><div class="pfShowPoster">${poster?`<img src="${esc(poster)}" alt="">`:'<span></span>'}</div><div class="pfShowInfo"><div class="pfBreadcrumb"><button data-nav="home">Home</button><span>›</span>${library==='Serie'?'<button data-library="Serie">Serie</button>':`<span>${esc(library)}</span>`}</div><h1>${esc(name)}</h1><div class="pfShowMeta">${esc([sample?.release_year,`${seasons.length} stagioni`,`${all.length} episodi`,sample?.vote_average?`★ ${Number(sample.vote_average).toFixed(1)}`:null].filter(Boolean).join(' · '))}</div><p>${esc(sample?.overview||'')}</p><div class="pfShowActions"><button class="pfPrimary" data-media="${episodes[0]?.id||sample?.id}">▶ ${all.some(inProgress)?'Riprendi':'Riproduci'}</button><button class="pfRoundAction" data-show-watched>${unseen?'✓':'↶'}</button><button class="pfRoundAction" data-show-more>•••</button></div></div></div></section>
  <section class="pfSeasonSection"><div class="pfSeasonHead"><h2>Stagioni</h2><span>${unseen?`${unseen} non visti`:'Tutto visto'}</span></div><div class="pfSeasonRail">${seasons.map(s=>seasonCard(s,seasonMeta.get(s.number),s.key===active.key)).join('')}</div></section>
  <section class="pfEpisodesSection"><div class="pfEpisodeHead"><div><h2>${esc(active.label)}</h2><span>${episodes.length} episodi${active.folder?` · ${esc(active.folder)}`:''}</span></div><select class="pfSeasonSelect" data-season-select>${seasons.map(s=>`<option value="${esc(s.key)}" ${s.key===active.key?'selected':''}>${esc(s.label)}</option>`).join('')}</select></div><div class="pfEpisodeGrid">${episodes.map(episodeCard).join('')}</div></section>`;
}
function seasonCard(s,meta,active){const sample=representative(s.items),poster=meta?.poster_url||sample?.poster_url,unseen=s.items.filter(m=>!watched(m)).length;return`<button class="pfSeasonCard ${active?'active':''}" data-season="${esc(s.key)}"><span class="pfSeasonPoster">${poster?`<img src="${esc(poster)}" loading="lazy" alt="">`:`<span class="pfFallback">${esc(s.label)}</span>`}${unseen?`<i>${unseen}</i>`:'<i class="done">✓</i>'}</span><b>${esc(meta?.name||s.label)}</b><small>${s.items.length} episodi</small></button>`}
function episodeCard(m){const art=landscapeOf(m),ep=episodeNo(m),num=ep!=null?`Episodio ${ep}`:'Episodio';return`<article class="pfEpisode"><button class="pfEpisodeButton" data-media="${m.id}"><span class="pfEpisodeArt">${art?`<img src="${esc(art)}" loading="lazy" alt="">`:`<span>${esc(num)}</span>`}${watchedBadge(m)}<i class="pfEpisodePlay">▶</i></span><b>${esc(`${num} · ${m.episode_title||titleOf(m)}`)}</b><small>${esc([fmtDuration(m.duration_seconds),m.release_date?String(m.release_date).slice(0,10):null].filter(Boolean).join(' · '))}</small><p>${esc(m.overview||'')}</p></button><button class="pfMore" data-more-id="${m.id}">•••</button></article>`}

function bindPosterSlider(){const el=$('[data-poster-size]');if(!el)return;el.oninput=()=>{ui.poster=Number(el.value);$('.pfGrid')?.style.setProperty('--poster',`${ui.poster}px`);savePrefs()}}
function closeContext(){contextEl?.remove();contextEl=null}
function showMenu(anchor,rows){closeContext();const r=anchor.getBoundingClientRect();const el=document.createElement('div');el.className='pfContext';el.style.left=`${Math.min(r.left,innerWidth-245)}px`;el.style.top=`${Math.min(r.bottom+4,innerHeight-340)}px`;el.innerHTML=rows.map(x=>x.sep?'<hr>':`<button data-menu-action="${esc(x.action)}">${esc(x.label)}</button>`).join('');document.body.appendChild(el);contextEl=el;return el}
function itemMenu(anchor,id){ui.lastMediaId=Number(id);const m=ui.items.find(x=>Number(x.id)===Number(id)),inWatch=ui.persist.watchlist.map(Number).includes(Number(id));showMenu(anchor,[{action:'open',label:'Apri dettagli'},{action:'queue',label:'Aggiungi alla coda'},{action:'watchlist',label:inWatch?'Rimuovi dalla Watchlist':'Aggiungi alla Watchlist'},{action:'playlist',label:'Aggiungi a playlist…'},{action:'collection',label:'Aggiungi a raccolta…'},{sep:true},{action:'watched',label:watched(m)?'Segna come non visto':'Segna come visto'},{action:'refresh',label:'Aggiorna metadata'},{action:'fix',label:'Correggi abbinamento…'},{action:'info',label:'Informazioni file'}])}
function filterMenu(btn){showMenu(btn,[['all','Tutti'],['unplayed','Non visti'],['progress','In corso'],['played','Visti'],['4k','4K'],['hdr','HDR'],['advanced','Filtro avanzato…']].map(([v,l])=>({action:`filter:${v}`,label:l})))}
function typeMenu(btn){const rows=ui.library==='Serie'?[['shows','Serie TV'],['seasons','Stagioni'],['episodes','Episodi'],['folders','Cartelle']]:[['items','Film'],['folders','Cartelle']];showMenu(btn,rows.map(([v,l])=>({action:`type:${v}`,label:l})))}
function sortMenu(btn){showMenu(btn,[['title','Titolo'],['year','Anno'],['added','Data aggiunta'],['rating','Valutazione'],['duration','Durata'],['resolution','Risoluzione']].map(([v,l])=>({action:`sort:${v}`,label:l})).concat([{sep:true},{action:'sortdir',label:ui.desc?'Ordine crescente':'Ordine decrescente'}]))}

function ask(title,label){return new Promise(resolve=>{const wrap=document.createElement('div');wrap.className='pfModalWrap';wrap.innerHTML=`<div class="pfModal"><h2>${esc(title)}</h2><label>${esc(label)}<input autofocus></label><div><button data-cancel>Annulla</button><button class="pfPrimary" data-ok>Salva</button></div></div>`;document.body.appendChild(wrap);const input=wrap.querySelector('input'),done=v=>{wrap.remove();resolve(v)};wrap.querySelector('[data-cancel]').onclick=()=>done(null);wrap.querySelector('[data-ok]').onclick=()=>done(input.value.trim());input.onkeydown=e=>{if(e.key==='Enter')done(input.value.trim());if(e.key==='Escape')done(null)};setTimeout(()=>input.focus(),20)})}
function choose(title,rows,createLabel){return new Promise(resolve=>{const wrap=document.createElement('div');wrap.className='pfModalWrap';wrap.innerHTML=`<div class="pfModal pfChooser"><h2>${esc(title)}</h2><div class="pfChoiceList">${rows.map(r=>`<button data-choice="${esc(r.id)}"><b>${esc(r.name)}</b><small>${r.count} elementi</small></button>`).join('')}${createLabel?`<button data-choice="__new"><b>＋ ${esc(createLabel)}</b></button>`:''}</div><div><button data-cancel>Chiudi</button></div></div>`;document.body.appendChild(wrap);wrap.onclick=e=>{const b=e.target.closest('[data-choice]');if(b){wrap.remove();resolve(b.dataset.choice)}if(e.target.closest('[data-cancel]')){wrap.remove();resolve(null)}}})}
async function newCollection(){const name=await ask('Nuova raccolta','Nome raccolta');if(!name)return;ui.persist.collections[`c${Date.now()}`]={name,library:ui.library,ids:[],createdAt:Date.now()};saveStore();renderCollections()}
async function newPlaylist(){const name=await ask('Nuova playlist','Nome playlist');if(!name)return;ui.persist.playlists[`p${Date.now()}`]={name,ids:[],createdAt:Date.now()};saveStore();renderPlaylists()}
async function addToPlaylist(id){const rows=Object.entries(ui.persist.playlists).map(([pid,p])=>({id:pid,name:p.name,count:p.ids.length}));let choice=await choose('Aggiungi a playlist',rows,'Nuova playlist');if(choice==='__new'){const name=await ask('Nuova playlist','Nome playlist');if(!name)return;choice=`p${Date.now()}`;ui.persist.playlists[choice]={name,ids:[],createdAt:Date.now()}}if(choice){const p=ui.persist.playlists[choice];if(!p.ids.map(Number).includes(Number(id)))p.ids.push(Number(id));saveStore();toast('Playlist aggiornata')}}
async function addToCollection(id){const item=ui.items.find(m=>Number(m.id)===Number(id)),library=rootOf(item),rows=Object.entries(ui.persist.collections).filter(([,c])=>c.library===library).map(([cid,c])=>({id:cid,name:c.name,count:c.ids.length}));let choice=await choose('Aggiungi a raccolta',rows,'Nuova raccolta');if(choice==='__new'){const name=await ask('Nuova raccolta','Nome raccolta');if(!name)return;choice=`c${Date.now()}`;ui.persist.collections[choice]={name,library,ids:[],createdAt:Date.now()}}if(choice){const c=ui.persist.collections[choice];if(!c.ids.map(Number).includes(Number(id)))c.ids.push(Number(id));saveStore();toast('Raccolta aggiornata')}}
function advancedFilter(){const items=libItems(ui.library),genres=[...genreMap(items).keys()].sort(),years=[...new Set(items.map(m=>m.release_year).filter(Boolean))].sort((a,b)=>b-a);const wrap=document.createElement('div');wrap.className='pfModalWrap';wrap.innerHTML=`<div class="pfModal"><h2>Filtro avanzato</h2><label>Genere<select data-g><option value="">Qualsiasi</option>${genres.map(g=>`<option ${ui.advanced.genre===g?'selected':''}>${esc(g)}</option>`).join('')}</select></label><label>Anno<select data-y><option value="">Qualsiasi</option>${years.map(y=>`<option ${String(ui.advanced.year)===String(y)?'selected':''}>${y}</option>`).join('')}</select></label><label>Qualità<select data-q><option value="">Qualsiasi</option><option>4K</option><option>HD</option><option>SD</option></select></label><div><button data-reset>Reimposta</button><button data-cancel>Annulla</button><button class="pfPrimary" data-apply>Applica</button></div></div>`;document.body.appendChild(wrap);wrap.onclick=e=>{if(e.target.closest('[data-cancel]'))wrap.remove();if(e.target.closest('[data-reset]')){ui.advanced={genre:'',year:'',quality:''};wrap.remove();renderLibrary()}if(e.target.closest('[data-apply]')){ui.advanced={genre:wrap.querySelector('[data-g]').value,year:wrap.querySelector('[data-y]').value,quality:wrap.querySelector('[data-q]').value};wrap.remove();renderLibrary()}}}

function toggleWatchlist(id){const set=new Set(ui.persist.watchlist.map(Number));set.has(Number(id))?set.delete(Number(id)):set.add(Number(id));ui.persist.watchlist=[...set];saveStore();toast(set.has(Number(id))?'Aggiunto alla Watchlist':'Rimosso dalla Watchlist');rerender()}
async function setWatched(id,value,{quiet=false}={}){const m=ui.items.find(x=>Number(x.id)===Number(id));if(!m)return;await api(`/api/media/${id}/progress`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({positionSeconds:value?Number(m.duration_seconds||1):0,durationSeconds:Number(m.duration_seconds||0),completed:value})});m.completed=value;m.progress_seconds=value?Number(m.duration_seconds||1):0;m.progress_percent=value?100:0;if(!quiet)toast(value?'Segnato come visto':'Segnato come non visto')}
async function refreshMetadata(id){try{toast('Aggiorno metadata…');await api(`/api/media/${id}/metadata`,{method:'POST'});toast('Metadata aggiornati');location.reload()}catch(e){toast(e.message)}}
function addQueue(ids){for(const id of ids.map(Number))if(!ui.persist.queue.map(Number).includes(id))ui.persist.queue.push(id);saveStore();toast('Coda aggiornata');renderQueue()}
function renderQueue(){let d=$('#pfQueueDrawer');if(!d){d=document.createElement('aside');d.id='pfQueueDrawer';d.className='pfDrawer';document.body.appendChild(d)}const items=ui.persist.queue.map(id=>ui.items.find(m=>Number(m.id)===Number(id))).filter(Boolean);d.innerHTML=`<header><div><small>Coda di riproduzione</small><h2>In coda</h2></div><button data-close-drawer>×</button></header>${items.length?`<div class="pfQueueList">${items.map((m,i)=>`<div><span>${i+1}</span><button data-media="${m.id}">${artOf(m)?`<img src="${esc(artOf(m))}" alt="">`:''}<b>${esc(titleOf(m))}</b><small>${esc(mediaMeta(m))}</small></button><button data-remove-queue="${m.id}">×</button></div>`).join('')}</div><footer><button data-clear-queue>Svuota coda</button></footer>`:'<div class="pfEmpty">La coda è vuota.</div>'}`;d.classList.add('open')}
function activity(){let p=$('#pfActivity');if(p){p.remove();return}p=document.createElement('div');p.id='pfActivity';p.className='pfActivity';p.innerHTML=`<h3>Attività</h3><div><span class="pfLiveDot"></span><b>VELA Server</b><small>Online · ${ui.items.length} elementi</small></div><div><span>◉</span><b>Client First</b><small>DIRECT · REMUX · AUDIO_TRANSCODE</small></div>`;document.body.appendChild(p)}

function toggleSelect(id){id=Number(id);ui.selected.has(id)?ui.selected.delete(id):ui.selected.add(id);renderSelection();rerender(false)}
function renderSelection(){let b=$('#pfSelectionBar');if(!ui.selected.size){b?.remove();return}if(!b){b=document.createElement('div');b.id='pfSelectionBar';b.className='pfSelectionBar';document.body.appendChild(b)}b.innerHTML=`<button data-clear-selection>×</button><b>${ui.selected.size} selezionati</b><button data-selected-watch>☆ Watchlist</button><button data-selected-queue>☰ Coda</button><button data-selected-watched>✓ Visti</button><button data-selected-unwatched>○ Non visti</button><button data-selected-refresh>↻ Metadata</button>`}
function currentItems(){if(ui.scope==='watchlist'){const ids=new Set(ui.persist.watchlist.map(Number));return filterItems(ui.items.filter(m=>ids.has(Number(m.id))))}if(ui.library)return filterItems(libItems(ui.library));return ui.items}
function rerender(keepScroll=true){const y=scrollY;if(ui.scope==='home')renderHome();else if(ui.scope==='library')renderLibrary();else if(ui.scope==='watchlist')renderWatchlist();else if(ui.scope==='playlists')renderPlaylists();else if(ui.scope==='show'){ui.library==='Serie'?openShow(ui.series):renderDirectShow(ui.library)}if(keepScroll)requestAnimationFrame(()=>scrollTo(0,y));renderSelection()}

function openDetails(id,after){ui.lastMediaId=Number(id);const ghost=document.createElement('button');ghost.dataset.media=String(id);ghost.hidden=true;document.body.appendChild(ghost);ghost.click();ghost.remove();if(after)setTimeout(after,300)}
function related(m){const gs=new Set(genresOf(m));return ui.items.filter(x=>x.id!==m.id&&rootOf(x)===rootOf(m)&&genresOf(x).some(g=>gs.has(g))).sort((a,b)=>Number(b.vote_average||0)-Number(a.vote_average||0)).slice(0,8)}
function augmentDetail(){const d=$('#detail'),m=ui.items.find(x=>Number(x.id)===Number(ui.lastMediaId));if(!d.open||!m)return;let q=d.querySelector('.pfDetailQuick');if(!q){q=document.createElement('div');q.className='pfDetailQuick';d.querySelector('.detailActions')?.appendChild(q)}q.innerHTML=`<button data-detail-watched>${watched(m)?'✓ Visto':'○ Segna visto'}</button><button data-detail-watchlist>${ui.persist.watchlist.map(Number).includes(Number(m.id))?'★ In Watchlist':'☆ Watchlist'}</button><button data-detail-more>•••</button>`;let extra=d.querySelector('.pfDetailExtra');if(!extra){extra=document.createElement('section');extra.className='pfDetailExtra';d.querySelector('.detailCopy')?.appendChild(extra)}const rel=related(m);extra.innerHTML=`${genresOf(m).length?`<div class="pfGenreLine">${genresOf(m).map(g=>`<button data-detail-genre="${esc(g)}">${esc(g)}</button>`).join('')}</div>`:''}${rel.length?`<div class="pfDetailRelated"><h3>Correlati</h3>${rail(rel)}</div>`:''}`}
function observeDetail(){const d=$('#detail');new MutationObserver(()=>{if(d.open)setTimeout(augmentDetail,0)}).observe(d,{attributes:true,attributeFilter:['open']})}

function captureSpecial(e){const select=e.target.closest?.('[data-select-id]');if(select){e.preventDefault();e.stopPropagation();toggleSelect(select.dataset.selectId);return}const more=e.target.closest?.('[data-more-id]');if(more){e.preventDefault();e.stopPropagation();itemMenu(more,more.dataset.moreId);return}const media=e.target.closest?.('[data-media]');if(media)ui.lastMediaId=Number(media.dataset.media)}
document.addEventListener('click',captureSpecial,true);

document.addEventListener('click',async e=>{
  const t=e.target;
  if(contextEl&&!t.closest('.pfContext')&&!t.closest('[data-filter-menu]')&&!t.closest('[data-type-menu]')&&!t.closest('[data-sort-menu]'))closeContext();
  const nav=t.closest('[data-nav]');if(nav){if(nav.dataset.nav==='home')renderHome();if(nav.dataset.nav==='watchlist')renderWatchlist();if(nav.dataset.nav==='playlists')renderPlaylists();return}
  const lib=t.closest('[data-library]');if(lib){openLibrary(lib.dataset.library);return}
  const tab=t.closest('[data-tab]');if(tab){ui.tab=tab.dataset.tab;savePrefs();renderLibrary();return}
  const show=t.closest('[data-open-show]');if(show){await openShow(show.dataset.openShow);return}
  const season=t.closest('[data-season]');if(season){ui.season=season.dataset.season;ui.library==='Serie'?await openShow(ui.series):await renderDirectShow(ui.library);return}
  const folder=t.closest('[data-folder]');if(folder){ui.folder.push(folder.dataset.folder);renderFolders();return}
  const depth=t.closest('[data-folder-depth]');if(depth){ui.folder=ui.folder.slice(0,Number(depth.dataset.folderDepth)+1);renderFolders();return}
  const cat=t.closest('[data-category]');if(cat){openCategory(cat.dataset.category);return}
  const col=t.closest('[data-collection]');if(col){openCollection(col.dataset.collection);return}
  const pl=t.closest('[data-playlist]');if(pl){openPlaylist(pl.dataset.playlist);return}
  if(t.closest('[data-new-collection]')){await newCollection();return}if(t.closest('[data-new-playlist]')){await newPlaylist();return}
  if(t.closest('[data-back-library]')){openLibrary(ui.library);return}
  const dc=t.closest('[data-delete-collection]');if(dc){delete ui.persist.collections[dc.dataset.deleteCollection];saveStore();openLibrary(ui.library);return}
  const dp=t.closest('[data-delete-playlist]');if(dp){delete ui.persist.playlists[dp.dataset.deletePlaylist];saveStore();renderPlaylists();return}
  const view=t.closest('[data-view]');if(view){ui.view=view.dataset.view;savePrefs();rerender();return}
  if(t.closest('[data-filter-menu]')){filterMenu(t.closest('[data-filter-menu]'));return}if(t.closest('[data-type-menu]')){typeMenu(t.closest('[data-type-menu]'));return}if(t.closest('[data-sort-menu]')){sortMenu(t.closest('[data-sort-menu]'));return}
  const ma=t.closest('[data-menu-action]');if(ma){const action=ma.dataset.menuAction;closeContext();if(action.startsWith('filter:')){const v=action.split(':')[1];if(v==='advanced'){advancedFilter();return}ui.filter=v;savePrefs();rerender();return}if(action.startsWith('type:')){ui.type=action.split(':')[1];savePrefs();renderLibrary();return}if(action.startsWith('sort:')){ui.sort=action.split(':')[1];savePrefs();rerender();return}if(action==='sortdir'){ui.desc=!ui.desc;savePrefs();rerender();return}const id=ui.lastMediaId,m=ui.items.find(x=>Number(x.id)===Number(id));if(action==='open'||action==='info'){openDetails(id);return}if(action==='queue'){addQueue([id]);return}if(action==='watchlist'){toggleWatchlist(id);return}if(action==='playlist'){await addToPlaylist(id);return}if(action==='collection'){await addToCollection(id);return}if(action==='watched'){await setWatched(id,!watched(m));rerender();return}if(action==='refresh'){await refreshMetadata(id);return}if(action==='fix'){openDetails(id,()=>$('#editMetadataBtn')?.click());return}}
  if(t.closest('[data-play-all]')){addQueue(currentItems().map(m=>m.id));return}if(t.closest('[data-shuffle]')){addQueue([...currentItems()].sort(()=>Math.random()-.5).map(m=>m.id));return}
  if(t.closest('#pfQueueBtn')){renderQueue();return}if(t.closest('#pfActivityBtn')){activity();return}
  if(t.closest('[data-close-drawer]')){$('#pfQueueDrawer')?.classList.remove('open');return}if(t.closest('[data-clear-queue]')){ui.persist.queue=[];saveStore();renderQueue();return}
  const rq=t.closest('[data-remove-queue]');if(rq){ui.persist.queue=ui.persist.queue.filter(id=>Number(id)!==Number(rq.dataset.removeQueue));saveStore();renderQueue();return}
  const ql=t.closest('[data-queue-list]');if(ql){addQueue(ql.dataset.queueList.split(',').filter(Boolean));return}
  const lm=t.closest('[data-library-more]');if(lm){showMenu(lm,[{action:`libscan:${lm.dataset.libraryMore}`,label:'Scansiona file libreria'},{action:`librec:${lm.dataset.libraryMore}`,label:'Vai a Consigliati'},{action:`libfolders:${lm.dataset.libraryMore}`,label:'Sfoglia cartelle'}]);return}
  if(ma?.dataset.menuAction?.startsWith('libscan:'))return;
  if(t.closest('[data-open-system]')){$('#systemBtn')?.click();return}
  if(t.closest('[data-detail-watchlist]')){toggleWatchlist(ui.lastMediaId);augmentDetail();return}
  if(t.closest('[data-detail-watched]')){const m=ui.items.find(x=>Number(x.id)===Number(ui.lastMediaId));await setWatched(m.id,!watched(m));augmentDetail();return}
  if(t.closest('[data-detail-more]')){itemMenu(t.closest('[data-detail-more]'),ui.lastMediaId);return}
  const dg=t.closest('[data-detail-genre]');if(dg){const m=ui.items.find(x=>Number(x.id)===Number(ui.lastMediaId));$('#detail')?.close();openLibrary(rootOf(m));ui.tab='library';ui.advanced.genre=dg.dataset.detailGenre;renderLibrary();return}
  if(t.closest('[data-clear-selection]')){ui.selected.clear();rerender();return}
  if(t.closest('[data-selected-watch]')){for(const id of ui.selected)if(!ui.persist.watchlist.map(Number).includes(id))ui.persist.watchlist.push(id);saveStore();ui.selected.clear();rerender();return}
  if(t.closest('[data-selected-queue]')){addQueue([...ui.selected]);return}
  if(t.closest('[data-selected-watched]')){for(const id of ui.selected)await setWatched(id,true,{quiet:true});ui.selected.clear();toast('Elementi segnati come visti');rerender();return}
  if(t.closest('[data-selected-unwatched]')){for(const id of ui.selected)await setWatched(id,false,{quiet:true});ui.selected.clear();toast('Elementi segnati come non visti');rerender();return}
  if(t.closest('[data-selected-refresh]')){for(const id of ui.selected)await api(`/api/media/${id}/metadata`,{method:'POST'});toast('Metadata aggiornati');location.reload();return}
  if(t.closest('[data-show-watched]')){const all=ui.library==='Serie'?libItems('Serie').filter(m=>seriesFolder(m)===ui.series):libItems(ui.library);const makeWatched=all.some(m=>!watched(m));for(const m of all)await setWatched(m.id,makeWatched,{quiet:true});toast(makeWatched?'Serie segnata come vista':'Serie segnata come non vista');ui.library==='Serie'?await openShow(ui.series):await renderDirectShow(ui.library);return}
  if(t.closest('[data-show-more]')){showMenu(t.closest('[data-show-more]'),[{action:'queueShow',label:'Aggiungi serie alla coda'},{action:'refreshShow',label:'Aggiorna metadata episodi'}]);return}
});

document.addEventListener('click',async e=>{
  const action=e.target.closest('[data-menu-action]')?.dataset.menuAction;if(!action)return;
  if(action.startsWith('libscan:')){closeContext();try{await api('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:'{"limit":0}'});toast('Scansione avviata')}catch(err){toast(err.message)}return}
  if(action.startsWith('librec:')){const lib=action.slice(7);closeContext();openLibrary(lib);ui.tab='recommended';renderLibrary();return}
  if(action.startsWith('libfolders:')){const lib=action.slice(11);closeContext();openLibrary(lib);if(DIRECT_SHOWS.has(lib))return;ui.tab='library';ui.type='folders';renderLibrary();return}
  if(action==='queueShow'){closeContext();const items=ui.library==='Serie'?libItems('Serie').filter(m=>seriesFolder(m)===ui.series):libItems(ui.library);addQueue(items.map(m=>m.id));return}
  if(action==='refreshShow'){closeContext();const items=ui.library==='Serie'?libItems('Serie').filter(m=>seriesFolder(m)===ui.series):libItems(ui.library);toast('Aggiorno metadata serie…');for(const m of items)await api(`/api/media/${m.id}/metadata`,{method:'POST'});location.reload()}
});

document.addEventListener('change',async e=>{if(e.target.matches('[data-season-select]')){ui.season=e.target.value;ui.library==='Serie'?await openShow(ui.series):await renderDirectShow(ui.library)}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeContext();$('#pfQueueDrawer')?.classList.remove('open');$('#pfActivity')?.remove()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#searchInput')?.focus()}});
$('#homeBtn')?.addEventListener('click',e=>{e.preventDefault();renderHome()},true);
$('#profileBtn')?.addEventListener('click',e=>{e.preventDefault();showMenu(e.currentTarget,[{action:'profileHome',label:'Profilo Home'},{action:'profileSettings',label:'Impostazioni VELA'}])},true);

document.addEventListener('click',e=>{const action=e.target.closest('[data-menu-action]')?.dataset.menuAction;if(action==='profileSettings'){closeContext();$('#systemBtn')?.click()}if(action==='profileHome'){closeContext();toast('Profilo Home')}});

async function boot(){try{topbar();await loadLibrary();sidebar();renderHome();observeDetail();renderSelection()}catch(e){$('#plexView').innerHTML=`<div class="pfEmpty">Errore caricamento libreria: ${esc(e.message)}</div>`}}
boot();
