const ROOTS = ['Film','Cartoni','Marvel','One Piece','Naruto','Serie TV','South Park'];
const $s = selector => document.querySelector(selector);
const escs = (value='') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const spacesState = { media: [], byRoot: new Map(), loaded: false, activeRoot: null, activeFolder: 'all', sort: 'title' };

function rootOf(media) {
  const first = String(media.relative_path || '').split(/[\\/]/).filter(Boolean)[0] || 'Altro';
  return ROOTS.find(root => root.toLowerCase() === first.toLowerCase()) || first;
}
function subfolderOf(media, root) {
  const parts = String(media.relative_path || '').split(/[\\/]/).filter(Boolean);
  if (!parts.length || parts[0].toLowerCase() !== root.toLowerCase() || parts.length < 3) return null;
  const candidate = parts[1];
  if (!candidate || /^(s\d+|season\s*\d+|stagione\s*\d+)$/i.test(candidate)) return null;
  return candidate;
}
async function apiSpaces(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function loadAllMedia() {
  if (spacesState.loaded) return spacesState.media;
  const pageSize = 500;
  let offset = 0, total = Infinity;
  const items = [];
  while (offset < total) {
    const data = await apiSpaces(`/api/media?limit=${pageSize}&offset=${offset}`);
    total = Number(data.count || 0);
    items.push(...(data.items || []));
    offset += pageSize;
    if (!(data.items || []).length) break;
  }
  spacesState.media = items.filter(item => item.status === 'OK');
  spacesState.byRoot.clear();
  for (const root of ROOTS) spacesState.byRoot.set(root, []);
  for (const item of spacesState.media) {
    const root = rootOf(item);
    if (!spacesState.byRoot.has(root)) spacesState.byRoot.set(root, []);
    spacesState.byRoot.get(root).push(item);
  }
  spacesState.loaded = true;
  return spacesState.media;
}
function art(media) { return media?.backdrop_url || media?.poster_url || ''; }
function spaceStats(items) {
  return {
    total: items.length,
    ready: items.filter(x => x.metadata_status === 'READY').length,
    fourK: items.filter(x => Number(x.width || 0) >= 3000).length,
    hdr: items.filter(x => x.hdr && x.hdr !== 'SDR').length,
    tv: items.filter(x => x.media_kind === 'tv').length
  };
}
function sampleArt(items, count=3) {
  const usable = items.filter(item => art(item));
  const picks = [];
  if (!usable.length) return picks;
  const step = Math.max(1, Math.floor(usable.length / count));
  for (let i=0; i<usable.length && picks.length<count; i+=step) picks.push(usable[i]);
  return picks;
}
function portalMarkup(root, items, index) {
  const stats = spaceStats(items);
  const backgrounds = sampleArt(items,3).map((item,i) => `<span class="spaceFrame frame${i+1}" style="background-image:url('${String(art(item)).replaceAll("'","%27")}')"></span>`).join('');
  return `<button class="spacePortal space-${index+1}" type="button" data-space="${escs(root)}" aria-label="Apri ${escs(root)}">
    <span class="spaceArtwork">${backgrounds}<span class="spaceNoise"></span></span>
    <span class="spaceIndex">0${index+1}</span>
    <span class="spaceCopy"><small>${stats.tv > stats.total/2 ? 'SERIE / EPISODI' : 'COLLEZIONE'}</small><strong>${escs(root)}</strong><span>${stats.total} media</span></span>
    <span class="spaceTelemetry">${stats.fourK ? `<i>${stats.fourK} · 4K</i>` : ''}${stats.hdr ? `<i>${stats.hdr} · HDR</i>` : ''}<i>${stats.ready}/${stats.total} · META</i></span>
    <span class="spaceEnter">↗</span>
  </button>`;
}
function continueMarkup(items) {
  const active = items.filter(item => Number(item.progress_percent || 0) > 1 && !item.completed).sort((a,b) => new Date(b.progress_updated_at || 0) - new Date(a.progress_updated_at || 0)).slice(0,5);
  if (!active.length) return '';
  return `<section class="flightPath"><div class="flightIntro"><small>FLIGHT PATH</small><h2>Riprendi da dove eri rimasto</h2><p>VELA tiene aperta la rotta sui titoli che stai guardando.</p></div><div class="flightItems">${active.map((m,i) => `<button type="button" class="flightItem" data-media="${m.id}"><span class="flightNo">${String(i+1).padStart(2,'0')}</span><span class="flightArt" style="background-image:url('${String(art(m)).replaceAll("'","%27")}')"></span><span class="flightCopy"><b>${escs(m.display_title || m.filename)}</b><small>${escs(rootOf(m))} · ${Math.round(Number(m.progress_percent||0))}%</small><i><em style="width:${Math.max(2,Math.min(100,Number(m.progress_percent||0)))}%"></em></i></span><span class="flightArrow">→</span></button>`).join('')}</div></section>`;
}
function renderSpaces() {
  const host = $s('#spacesHost');
  if (!host) return;
  const knownRoots = ROOTS.filter(root => spacesState.byRoot.get(root)?.length);
  host.innerHTML = `${continueMarkup(spacesState.media)}<section class="spacesIntro"><div><small>VELA / SPACES</small><h2>La libreria segue il tuo archivio.</h2></div><p>Niente categorie artificiali: questi ambienti corrispondono direttamente alle cartelle reali del tuo storage.</p></section><section class="spacesGrid">${knownRoots.map((root,index) => portalMarkup(root, spacesState.byRoot.get(root), index)).join('')}</section><section class="signalStrip"><span>STORAGE MAP</span><b>${knownRoots.length} spazi</b><i></i><span>MEDIA ONLINE</span><b>${spacesState.media.length}</b><i></i><span>CLIENT FIRST</span><b>ACTIVE</b></section>`;
  document.body.classList.add('spacesReady');
}
function cardMarkup(m) {
  const image = m.poster_url || m.backdrop_url;
  const quality = Number(m.width || 0) >= 3000 ? '4K' : (m.height ? `${m.height}p` : 'HD');
  const sub = [m.release_year, quality, m.hdr && m.hdr !== 'SDR' ? m.hdr : null].filter(Boolean).join(' · ');
  return `<button class="spaceMedia" type="button" data-media="${m.id}"><span class="spaceMediaArt ${image ? '' : 'fallback'}" ${image ? `style="background-image:url('${String(image).replaceAll("'","%27")}')"` : ''}></span><span class="spaceMediaShade"></span><span class="spaceMediaCopy"><b>${escs(m.display_title || m.filename)}</b><small>${escs(sub || rootOf(m))}</small></span>${Number(m.progress_percent || 0) > 1 && !m.completed ? `<span class="spaceProgress"><i style="width:${Number(m.progress_percent)}%"></i></span>` : ''}</button>`;
}
function collectionItems() {
  let items = [...(spacesState.byRoot.get(spacesState.activeRoot) || [])];
  if (spacesState.activeFolder !== 'all') items = items.filter(item => subfolderOf(item, spacesState.activeRoot) === spacesState.activeFolder);
  if (spacesState.sort === 'recent') items.sort((a,b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  else if (spacesState.sort === 'year') items.sort((a,b) => Number(b.release_year||0) - Number(a.release_year||0) || String(a.display_title||'').localeCompare(String(b.display_title||''),'it'));
  else items.sort((a,b) => String(a.display_title||a.filename||'').localeCompare(String(b.display_title||b.filename||''),'it',{numeric:true}));
  return items;
}
function renderCollection() {
  const dialog = $s('#spaceDialog');
  if (!dialog || !spacesState.activeRoot) return;
  const root = spacesState.activeRoot;
  const all = spacesState.byRoot.get(root) || [];
  const folders = [...new Set(all.map(item => subfolderOf(item,root)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it',{numeric:true}));
  const items = collectionItems();
  const hero = all.find(item => item.backdrop_url) || all.find(item => item.poster_url) || all[0];
  $s('#spaceDialogBackdrop').style.backgroundImage = art(hero) ? `url('${art(hero)}')` : '';
  $s('#spaceDialogIndex').textContent = `VELA SPACE · ${String(ROOTS.indexOf(root)+1).padStart(2,'0')}`;
  $s('#spaceDialogTitle').textContent = root;
  $s('#spaceDialogCount').textContent = `${items.length} media`;
  $s('#spaceFolderNav').innerHTML = `<button type="button" class="${spacesState.activeFolder==='all'?'active':''}" data-folder="all">Tutto <span>${all.length}</span></button>` + folders.map(folder => `<button type="button" class="${spacesState.activeFolder===folder?'active':''}" data-folder="${escs(folder)}">${escs(folder)} <span>${all.filter(item=>subfolderOf(item,root)===folder).length}</span></button>`).join('');
  $s('#spaceMediaGrid').innerHTML = items.map(cardMarkup).join('') || '<p class="spaceEmpty">Nessun media in questo livello.</p>';
  $s('#spaceSort').value = spacesState.sort;
}
function openSpace(root) {
  spacesState.activeRoot = root;
  spacesState.activeFolder = 'all';
  spacesState.sort = 'title';
  renderCollection();
  const dialog = $s('#spaceDialog');
  if (dialog && !dialog.open) dialog.showModal();
}
function closeSpace() { const dialog = $s('#spaceDialog'); if (dialog?.open) dialog.close(); }
function bindSpaces() {
  document.addEventListener('click', event => {
    const portal = event.target.closest('[data-space]');
    if (portal) { event.preventDefault(); openSpace(portal.dataset.space); return; }
    const folder = event.target.closest('#spaceFolderNav [data-folder]');
    if (folder) { spacesState.activeFolder = folder.dataset.folder; renderCollection(); }
  });
  $s('#spaceDialogClose')?.addEventListener('click', closeSpace);
  $s('#spaceSort')?.addEventListener('change', event => { spacesState.sort = event.target.value; renderCollection(); });
  $s('#spaceDialog')?.addEventListener('click', event => { if (event.target === $s('#spaceDialog')) closeSpace(); });
}
async function initSpaces() {
  const host = $s('#spacesHost');
  if (!host) return;
  host.innerHTML = '<div class="spacesLoading"><i></i><span>Sto ricostruendo la mappa della libreria…</span></div>';
  try { await loadAllMedia(); renderSpaces(); }
  catch (error) { host.innerHTML = `<div class="spacesLoading error"><span>Impossibile caricare VELA Spaces · ${escs(error.message)}</span></div>`; }
  bindSpaces();
}
initSpaces();
