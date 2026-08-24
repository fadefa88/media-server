const M = s => document.querySelector(s);
const meEsc = (s='') => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let activeMediaId = null;
let activeRecord = null;
let candidateCache = [];

document.addEventListener('click',e=>{
  const media=e.target.closest('[data-media]');
  if(media) activeMediaId=Number(media.dataset.media);
  const hero=e.target.closest('[data-hero-info]');
  if(hero) activeMediaId=Number(hero.dataset.heroInfo);
},true);

async function meApi(url,opts={}){const r=await fetch(url,opts);let body={};try{body=await r.json()}catch{}if(!r.ok)throw new Error(body.error||`HTTP ${r.status}`);return body}

async function openMetadataEditor(){
  if(!activeMediaId){M('#metadataEditorStatus').textContent='Apri prima un titolo dalla libreria.';return}
  try{
    activeRecord=await meApi(`/api/media/${activeMediaId}`);
    const media=activeRecord.media||{};
    M('#metadataEditorTitle').textContent=media.display_title||media.title||media.filename||'Modifica metadata';
    M('#metadataEditorFile').textContent=media.relative_path||media.filename||'';
    M('#metadataQuery').value=media.title||media.display_title||String(media.filename||'').replace(/\.[^.]+$/,'');
    M('#metadataCandidates').innerHTML='';
    M('#metadataEditorStatus').textContent='Scrivi il titolo corretto e cerca nei provider configurati.';
    if(!M('#metadataEditor').open)M('#metadataEditor').showModal();
  }catch(error){M('#metadataEditorStatus').textContent=error.message}
}

async function searchCandidates(event){
  event?.preventDefault();if(!activeMediaId)return;
  const q=M('#metadataQuery').value.trim();if(!q){M('#metadataEditorStatus').textContent='Inserisci un titolo.';return}
  M('#metadataEditorStatus').textContent='Ricerca metadata…';M('#metadataCandidates').innerHTML='';
  try{
    const data=await meApi(`/api/media/${activeMediaId}/metadata/candidates?q=${encodeURIComponent(q)}`);
    candidateCache=data.items||[];
    M('#metadataEditorStatus').textContent=candidateCache.length?`${candidateCache.length} risultati. Scegli quello corretto.`:'Nessun risultato trovato.';
    M('#metadataCandidates').innerHTML=candidateCache.length?candidateCache.map((c,i)=>candidateRow(c,i)).join(''):'<div class="metadataEditorEmpty">Prova un titolo alternativo o il titolo originale.</div>';
  }catch(error){M('#metadataEditorStatus').textContent=error.message}
}
function candidateRow(c,i){return `<div class="metadataCandidate">${c.poster_url?`<img src="${meEsc(c.poster_url)}" alt="" loading="lazy">`:'<div class="metadataCandidatePoster">NO ART</div>'}<div class="metadataCandidateCopy"><b>${meEsc(c.title||'Senza titolo')}</b><span>${meEsc([c.year,c.kind?.toUpperCase(),c.provider,`${Math.round(Number(c.confidence||0))}%`].filter(Boolean).join(' · '))}</span></div><button type="button" data-use-candidate="${i}">Usa questo</button></div>`}

async function applyCandidate(index){const candidate=candidateCache[Number(index)];if(!candidate||!activeMediaId)return;M('#metadataEditorStatus').textContent='Salvo il metadata corretto…';try{await meApi(`/api/media/${activeMediaId}/metadata/apply`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(candidate)});M('#metadataEditorStatus').textContent='Metadata corretto e bloccato. Aggiorno VELA…';setTimeout(()=>window.location.reload(),450)}catch(error){M('#metadataEditorStatus').textContent=error.message}}

M('#editMetadataBtn')?.addEventListener('click',openMetadataEditor);
M('#metadataEditorClose')?.addEventListener('click',()=>M('#metadataEditor').close());
M('#metadataSearchForm')?.addEventListener('submit',searchCandidates);
M('#metadataCandidates')?.addEventListener('click',e=>{const b=e.target.closest('[data-use-candidate]');if(b)applyCandidate(b.dataset.useCandidate)});
