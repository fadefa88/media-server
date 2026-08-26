const Q=s=>document.querySelector(s);
const esc=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let activeMediaId=null;
let watchlistView=false;
let scanBusy=false;

async function api(url,opts={}){
  const r=await fetch(url,opts);let body={};try{body=await r.json()}catch{}
  if(r.status===401){location.href='/login.html';throw new Error('Sessione scaduta')}
  if(!r.ok)throw new Error(body.error||r.statusText||`HTTP ${r.status}`);return body;
}
function toast(text,ms=2600){const e=Q('#toast');if(!e)return;e.textContent=text;e.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>e.hidden=true,ms)}

function visibleLabels(){
  const series=Q('#playerSeries');if(series&&/VELA PRIVATE CINEMA/i.test(series.textContent||''))series.textContent='LDF Media Server';
  const kicker=Q('#detailKicker');if(kicker&&/VELA CINEMA/i.test(kicker.textContent||''))kicker.textContent='LDF MEDIA SERVER';
  const server=Q('#serverState');if(server&&/^VELA\b/i.test(server.textContent||''))server.textContent=(server.textContent||'').replace(/^VELA/i,'LDF Media Server');
  const overview=Q('#detailOverview');if(overview&&/VELA/i.test(overview.textContent||''))overview.textContent=(overview.textContent||'').replace(/VELA/g,'LDF Media Server');
}

async function logout(){
  try{await fetch('/api/auth/logout',{method:'POST'})}finally{location.href='/login.html'}
}

async function refreshState(){
  if(!activeMediaId)return;
  try{
    const s=await api(`/api/media/${activeMediaId}/state`);
    const watch=Q('#watchlistBtn'),seen=Q('#watchedBtn');
    if(watch){watch.classList.toggle('active',Boolean(s.in_watchlist));watch.innerHTML=s.in_watchlist?'<i class="fa-solid fa-bookmark"></i> Da vedere':'<i class="fa-regular fa-bookmark"></i> Da vedere'}
    if(seen){seen.classList.toggle('active',Boolean(s.watched));seen.innerHTML='<i class="fa-solid fa-check"></i> Già visto'}
  }catch{}
}

function removeFromContinueWatching(id){
  for(const section of document.querySelectorAll('#plexView .plexSection')){
    const title=section.querySelector('.plexSectionTitle');
    if(!title||title.textContent.trim()!=='Continua a guardare')continue;
    section.querySelector(`[data-media="${Number(id)}"]`)?.remove();
    if(!section.querySelector('[data-media]'))section.remove();
    break;
  }
}

async function toggleMediaState(kind){
  if(!activeMediaId)return;
  const current=await api(`/api/media/${activeMediaId}/state`);
  const patch=kind==='watchlist'?{watchlist:!current.in_watchlist}:{watched:!current.watched};
  const next=await api(`/api/media/${activeMediaId}/state`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});
  await refreshState();
  toast(kind==='watchlist'?(next.in_watchlist?'Aggiunto a Da vedere':'Rimosso da Da vedere'):(next.watched?'Contrassegnato come già visto':'Contrassegnato come non visto'));
  updateVisibleMediaBadge(activeMediaId,next);
  if(kind==='watched'&&next.watched)removeFromContinueWatching(activeMediaId);
  if(watchlistView)void renderWatchlist();
}

function updateVisibleMediaBadge(id,state){
  for(const card of document.querySelectorAll(`[data-media="${Number(id)}"]`)){
    const art=card.querySelector('.plexPoster,.plexEpisodeArt');if(!art)continue;
    art.querySelector('.ldfStateBadge')?.remove();
    if(state.watched||state.in_watchlist){const b=document.createElement('span');b.className='ldfStateBadge';b.textContent=state.watched?'✓':'🔖';art.appendChild(b)}
  }
}

function activeLibrary(){return Q('#plexLibraries .plexNavButton.active[data-library]')?.dataset.library||null}
function scanButtonMarkup(library){return `<button class="plexScanButton" data-ldf-scan="${esc(library)}"><i class="fa-solid fa-rotate"></i><span>Scansiona ${esc(library)}</span></button>`}
function installScanButton(){
  const lib=activeLibrary();if(!lib)return;
  const head=Q('#plexView .plexPageHead');
  if(head&&!head.querySelector('[data-ldf-scan]')){const holder=document.createElement('div');holder.innerHTML=scanButtonMarkup(lib);head.insertBefore(holder.firstElementChild,head.querySelector('.plexCount')||head.lastElementChild)}
  const actions=Q('#plexView .plexShowActions');
  if(actions&&!actions.querySelector('[data-ldf-scan]')){const holder=document.createElement('div');holder.innerHTML=scanButtonMarkup(lib);actions.appendChild(holder.firstElementChild)}
}

async function triggerScan(library,button){
  if(scanBusy)return;scanBusy=true;button?.classList.add('running');if(button)button.disabled=true;
  try{
    const before=await api('/api/scan/status').catch(()=>({finishedAt:null}));
    await api('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({library})});
    toast(`Scansione ${library} avviata`);
    const oldFinished=before.finishedAt||null;
    const deadline=Date.now()+30*60*1000;
    while(Date.now()<deadline){
      await new Promise(r=>setTimeout(r,1000));
      const s=await api('/api/scan/status');
      if(!s.running&&s.finishedAt&&s.finishedAt!==oldFinished){
        const detail=`${Number(s.valid||0)} nuovi/modificati · ${Number(s.skipped||0)} invariati · ${Number(s.removed||0)} rimossi`;
        toast(`Scansione completata: ${detail}`,5000);setTimeout(()=>location.reload(),900);return;
      }
    }
    throw new Error('Timeout scansione');
  }catch(e){toast(e.message,5000)}finally{scanBusy=false;button?.classList.remove('running');if(button)button.disabled=false}
}

function posterCard(m){
  const title=m.display_title||m.title||m.filename||'Senza titolo';const art=m.poster_url||m.backdrop_url||null;const meta=m.release_year||'';
  const badge=m.completed?'✓':m.in_watchlist?'🔖':'';
  return `<button class="plexCard" data-media="${Number(m.id)}"><div class="plexPoster">${art?`<img src="${esc(art)}" alt="" loading="lazy">`:`<div class="plexPosterFallback">${esc(title)}</div>`}<span class="plexPosterShade"></span><span class="plexPlayBadge">▶</span>${badge?`<span class="ldfStateBadge">${badge}</span>`:''}</div><div class="plexCardTitle">${esc(title)}</div><div class="plexCardMeta">${esc(String(meta))}</div></button>`
}

async function renderWatchlist(){
  watchlistView=true;Q('#plexHomeNav')?.classList.remove('active');document.querySelectorAll('#plexLibraries .plexNavButton').forEach(x=>x.classList.remove('active'));Q('#watchlistNav')?.classList.add('active');
  const host=Q('#plexView');host.innerHTML='<div class="plexLoading"><span class="plexSpinner"></span>Carico Da vedere…</div>';
  try{
    const page=500;let offset=0,total=Infinity;const items=[];
    while(offset<total){const d=await api(`/api/media?watchlist=1&limit=${page}&offset=${offset}`);total=Number(d.count||0);items.push(...(d.items||[]));if(!(d.items||[]).length)break;offset+=page}
    host.innerHTML=`<div class="ldfWatchlistHead"><h1>Da vedere</h1><span>${items.length} elementi</span></div>${items.length?`<div class="plexGrid">${items.filter(x=>x.status==='OK').map(posterCard).join('')}</div>`:'<div class="plexEmpty">Nessun titolo nella lista Da vedere.</div>'}`;
  }catch(e){host.innerHTML=`<div class="plexEmpty">${esc(e.message)}</div>`}
}

function leaveWatchlist(){watchlistView=false;Q('#watchlistNav')?.classList.remove('active')}

function bind(){
  Q('#profileBtn')?.addEventListener('click',logout);
  Q('#watchlistBtn')?.addEventListener('click',()=>toggleMediaState('watchlist'));
  Q('#watchedBtn')?.addEventListener('click',()=>toggleMediaState('watched'));
  Q('#watchlistNav')?.addEventListener('click',e=>{e.preventDefault();void renderWatchlist()});
  Q('#plexHomeNav')?.addEventListener('click',leaveWatchlist);
  document.addEventListener('click',e=>{
    const media=e.target.closest?.('[data-media]');if(media){activeMediaId=Number(media.dataset.media);setTimeout(()=>{visibleLabels();void refreshState()},80)}
    const lib=e.target.closest?.('[data-library]');if(lib)leaveWatchlist();
    const scan=e.target.closest?.('[data-ldf-scan]');if(scan){e.preventDefault();e.stopImmediatePropagation();void triggerScan(scan.dataset.ldfScan,scan)}
  },true);
  const observer=new MutationObserver(()=>{visibleLabels();installScanButton()});
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['open','class']});
  visibleLabels();installScanButton();
}

bind();
