const $ = s => document.querySelector(s);
const state = { health:null, home:null, heroIndex:0, heroTimer:null, record:null, active:null, lastProgressSave:0, metadataTimer:null, searchTimer:null };

async function api(url, opts={}) {
  const r = await fetch(url, opts);
  let body = {};
  try { body = await r.json(); } catch {}
  if (!r.ok) throw new Error(body.error || r.statusText || `HTTP ${r.status}`);
  return body;
}
const esc = (s='') => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => { n=Math.max(0,Number(n||0)); const h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=Math.floor(n%60); return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}` };
const mbps = n => n ? `${(Number(n)/1e6).toFixed(1)} Mbps` : '—';
const quality = m => m.width>=3000?'4K':m.height?`${m.height}p`:'HD';
function toast(text, ms=2600){const e=$('#toast');e.textContent=text;e.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>e.hidden=true,ms)}
function artStyle(url){return url?`background-image:url('${String(url).replaceAll("'","%27")}')`:''}
function badges(m){const out=[];if(m.width>=3000)out.push('4K');else if(m.height)out.push(`${m.height}p`);if(m.hdr&&m.hdr!=='SDR')out.push(m.hdr==='Dolby Vision'?'DV':'HDR');if(m.video_codec)out.push(m.video_codec.toUpperCase());if(m.bit_depth>=10)out.push(`${m.bit_depth} BIT`);return out.slice(0,3)}
function card(m){const art=m.poster_url||m.backdrop_url;return `<button class="mediaCard" data-media="${m.id}" aria-label="${esc(m.display_title)}"><div class="${art?'mediaArt':'mediaFallback'}" style="${artStyle(art)}"></div><div class="cardShade"></div><div class="cardCopy"><b>${esc(m.display_title)}</b><small>${esc(String(m.display_subtitle||m.release_year||''))}</small><div class="badgeRow">${badges(m).map(x=>`<span class="badge">${esc(x)}</span>`).join('')}</div></div>${m.progress_percent>1&&!m.completed?`<div class="progressLine"><i style="width:${m.progress_percent}%"></i></div>`:''}</button>`}

async function boot(){
  try{
    const [health,home]=await Promise.all([api('/api/health'),api('/api/home')]);
    state.health=health;state.home=home;
    $('#serverState').textContent=`VELA ${health.version}`;$('#serverDetail').textContent='online · Client First';
    const total=home.metadata?.total??'—';$('#libraryCount').textContent=total;$('#tmdbMini').textContent=health.tmdbConfigured?'on':'setup';
    renderHero(0);renderRails();bindStatic();
  }catch(e){$('#serverDetail').textContent='offline';toast(e.message,5000)}
}

function renderHero(index=0){
  const candidates=state.home?.heroCandidates?.length?state.home.heroCandidates:[state.home?.hero].filter(Boolean);if(!candidates.length){$('#heroContent').innerHTML='<div class="kicker">VELA PRIVATE CINEMA</div><h1>La tua libreria.<br>Finalmente tua.</h1><p>Scansiona i media e collega TMDB per trasformare VELA nel tuo cinema personale.</p>';return}
  state.heroIndex=((index%candidates.length)+candidates.length)%candidates.length;const m=candidates[state.heroIndex];
  $('#heroBackdrop').style.backgroundImage=m.backdrop_url?`url('${m.backdrop_url}')`:'';
  $('#ambient').style.background=m.backdrop_url?`linear-gradient(rgba(7,9,14,.86),rgba(7,9,14,.97)),url('${m.backdrop_url}') center/cover fixed`:'radial-gradient(circle at 20% 10%,#162a36,#07090e 40%)';
  const meta=[m.release_year,quality(m),m.hdr&&m.hdr!=='SDR'?m.hdr:null,m.vote_average?`★ ${Number(m.vote_average).toFixed(1)}`:null].filter(Boolean);
  $('#heroContent').innerHTML=`<div class="kicker">${m.media_kind==='tv'?'VELA SERIES':'VELA FEATURE'}</div><h1>${esc(m.title||m.display_title)}</h1><div class="heroMeta">${meta.map(x=>`<span class="chip">${esc(x)}</span>`).join('')}</div><p>${esc(m.overview||'Qualità originale. Il client decodifica, VELA orchestra.')}</p><div class="heroActions"><button class="cta" data-hero-play="${m.id}">▶ ${m.progress_percent>1?'Riprendi':'Riproduci'}</button><button class="ghost" data-hero-info="${m.id}">Dettagli</button></div>`;
  $('#heroDots').innerHTML=candidates.map((_,i)=>`<button class="${i===state.heroIndex?'active':''}" data-hero-dot="${i}"></button>`).join('');
  clearInterval(state.heroTimer);if(candidates.length>1)state.heroTimer=setInterval(()=>renderHero(state.heroIndex+1),14000);
}
function renderRails(){
  $('#rails').innerHTML=(state.home?.rails||[]).filter(r=>r.items?.length).map(r=>`<section class="rail" id="rail-${r.id}"><div class="railHead"><div><small>${esc(r.eyebrow)}</small><h2>${esc(r.title)}</h2></div><div class="railArrows"><button data-scroll="${r.id}" data-dir="-1">‹</button><button data-scroll="${r.id}" data-dir="1">›</button></div></div><div class="railTrack" data-track="${r.id}">${r.items.map(card).join('')}</div></section>`).join('');
}
async function reloadHome(){state.home=await api('/api/home');$('#libraryCount').textContent=state.home.metadata?.total??'—';renderHero(state.heroIndex);renderRails()}

function bindStatic(){
  $('#systemBtn').onclick=openSystem;$('#metadataQuick').onclick=openSystem;$('#systemClose').onclick=()=>$('#systemSheet').close();
  $('#detailClose').onclick=closeDetail;$('#playerClose').onclick=closePlayer;$('#pulseBtn').onclick=()=>$('#pulsePanel').hidden=false;$('#pulseClose').onclick=()=>$('#pulsePanel').hidden=true;
  $('#homeBtn').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});$('#closeSearch').onclick=closeSearch;
  document.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>document.querySelector(`#rail-${b.dataset.jump}`)?.scrollIntoView({behavior:'smooth'}));
  document.querySelectorAll('[data-scan]').forEach(b=>b.onclick=()=>startScan(Number(b.dataset.scan)));
  $('#enrich25').onclick=()=>startMetadata(25);$('#enrich100').onclick=()=>startMetadata(100);$('#enrichAll').onclick=()=>startMetadata(0);
  $('#searchInput').addEventListener('input',onSearch);$('#searchInput').addEventListener('focus',()=>{if($('#searchInput').value.trim())onSearch()});
  document.addEventListener('click',async e=>{
    const card=e.target.closest('[data-media]');if(card)return openMedia(Number(card.dataset.media));
    const play=e.target.closest('[data-hero-play]');if(play){const id=Number(play.dataset.heroPlay);await openMedia(id,false);return playMedia(id,state.record?.media?.progress_seconds||0)}
    const info=e.target.closest('[data-hero-info]');if(info)return openMedia(Number(info.dataset.heroInfo));
    const dot=e.target.closest('[data-hero-dot]');if(dot)return renderHero(Number(dot.dataset.heroDot));
    const scroll=e.target.closest('[data-scroll]');if(scroll){const t=document.querySelector(`[data-track="${scroll.dataset.scroll}"]`);t?.scrollBy({left:Number(scroll.dataset.dir)*Math.max(300,t.clientWidth*.75),behavior:'smooth'})}
  });
  setupPlayerControls();
}

function onSearch(){clearTimeout(state.searchTimer);state.searchTimer=setTimeout(async()=>{const q=$('#searchInput').value.trim();if(!q)return closeSearch();try{const d=await api(`/api/search?q=${encodeURIComponent(q)}`);$('#searchResults').innerHTML=d.items.length?d.items.map(card).join(''):'<p>Nessun risultato.</p>';$('#searchOverlay').hidden=false}catch(e){toast(e.message)}},180)}
function closeSearch(){$('#searchOverlay').hidden=true}

async function openMedia(id,show=true){
  try{const d=await api(`/api/media/${id}`);state.record=d;const m=d.media;
    $('#detailBackdrop').style.backgroundImage=m.backdrop_url?`url('${m.backdrop_url}')`:'';$('#detailPoster').style.backgroundImage=m.poster_url?`url('${m.poster_url}')`:'';
    $('#detailKicker').textContent=m.media_kind==='tv'?'SERIE · EPISODIO':'VELA CINEMA';$('#detailTitle').textContent=m.display_title||m.filename;
    $('#detailMeta').innerHTML=[m.title&&m.episode_title?m.title:null,m.release_year,fmt(m.duration_seconds),quality(m),m.hdr&&m.hdr!=='SDR'?m.hdr:null,m.vote_average?`★ ${Number(m.vote_average).toFixed(1)}`:null].filter(Boolean).map(x=>`<span class="chip">${esc(x)}</span>`).join('');
    $('#detailOverview').textContent=m.overview||'Metadata TMDB non ancora disponibile. Il file è già pronto per VELA Client First.';
    $('#techGrid').innerHTML=[['Video',`${m.video_codec||'—'} ${m.video_profile||''}`],['Risoluzione',m.width&&m.height?`${m.width}×${m.height}`:'—'],['Bitrate',mbps(m.bitrate_bps)],['HDR',m.hdr||'SDR']].map(([a,b])=>`<div><span>${a}</span><b>${esc(b)}</b></div>`).join('');
    const aud=d.streams.filter(s=>s.codec_type==='audio'),subs=d.streams.filter(s=>s.codec_type==='subtitle');
    $('#audioSelect').innerHTML='<option value="">Auto · migliore</option>'+aud.map(s=>`<option value="${s.stream_index}">${esc((s.language||'und').toUpperCase())} · ${esc((s.codec_name||'audio').toUpperCase())}${s.title?` · ${esc(s.title)}`:''}</option>`).join('');
    $('#subtitleSelect').innerHTML='<option value="">Off</option>'+subs.map(s=>`<option value="${s.stream_index}">${esc((s.language||'und').toUpperCase())} · ${esc((s.codec_name||'sub').toUpperCase())}${s.title?` · ${esc(s.title)}`:''}</option>`).join('');
    $('#playLabel').textContent=m.progress_seconds>30&&!m.completed?`Riprendi da ${fmt(m.progress_seconds)}`:'Riproduci';
    $('#playBtn').onclick=()=>playMedia(id,m.progress_seconds||0);$('#decisionBtn').onclick=showInsight;$('#refreshMetaBtn').onclick=refreshOneMetadata;
    $('#audioSelect').onchange=()=>{if(state.active?.mediaId===id)restartAt(currentGlobal())};$('#subtitleSelect').onchange=()=>{if(state.active?.mediaId===id)restartAt(currentGlobal())};
    $('#speedSelect').onchange=()=>{$('#player').playbackRate=Number($('#speedSelect').value)};
    $('#insight').hidden=true;if(show&&!$('#detail').open)$('#detail').showModal();return d;
  }catch(e){toast(e.message,4500)}
}
function closeDetail(){if($('#detail').open)$('#detail').close()}
function clientCaps(){const v=document.createElement('video'),supports=t=>Boolean(v.canPlayType(t));const videoCodecs=['h264'];if(supports('video/mp4; codecs="hvc1"'))videoCodecs.push('hevc');const audioCodecs=['aac'];if(supports('audio/mp4; codecs="ac-3"'))audioCodecs.push('ac3');if(supports('audio/mp4; codecs="ec-3"'))audioCodecs.push('eac3');return{videoCodecs,audioCodecs,containers:['mp4','mov','hls','fmp4'],subtitleFormats:['vtt','webvtt'],maxWidth:4096,maxHeight:2160,networkMbps:100,audioLanguages:['ita','it','eng','en'],subtitleLanguages:['ita','it','eng','en']}}
function playbackBody(startSeconds=0){const a=$('#audioSelect').value,s=$('#subtitleSelect').value;return{client:clientCaps(),forceOriginal:true,startSeconds,audioStreamIndex:a===''?null:Number(a),subtitleStreamIndex:s===''?null:Number(s),subtitlesEnabled:s!==''}}
async function showInsight(){if(!state.record)return;try{const x=await api(`/api/media/${state.record.media.id}/decision`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(playbackBody(currentGlobal()))});const d=x.decision;const el=$('#insight');el.innerHTML=`<b>${esc(d.mode)}</b> · ${esc(d.target||'Originale')}<br>${esc(d.reason||'')}<br><small>Video ${esc(d.videoAction)} · Audio ${esc(d.audioAction)} · CPU ${esc(d.cpuImpact)}</small>`;el.hidden=false}catch(e){toast(e.message)}}
async function refreshOneMetadata(){if(!state.record)return;try{toast('Aggiorno metadata TMDB…');await api(`/api/media/${state.record.media.id}/metadata`,{method:'POST'});await openMedia(state.record.media.id,false);await reloadHome();toast('Metadata aggiornati')}catch(e){toast(e.message,4500)}}

async function playMedia(id,startSeconds=0){
  try{
    if(!state.record||Number(state.record.media.id)!==Number(id))await openMedia(id,false);const record=state.record;
    await stopSession();
    const x=await api(`/api/media/${id}/playback`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(playbackBody(startSeconds))});
    const p=$('#player');state.active={mediaId:id,sessionId:x.sessionId||null,type:x.type,base:Number(x.startSeconds||0),decision:x.decision,record};
    $('#playerLayer').hidden=false;$('#playerBackdrop').style.backgroundImage=record.media.backdrop_url?`url('${record.media.backdrop_url}')`:'';$('#playerTitle').textContent=record.media.display_title;$('#playerSeries').textContent=record.media.title&&record.media.episode_title?record.media.title:'VELA PRIVATE CINEMA';
    p.pause();p.innerHTML='';p.removeAttribute('src');p.load();
    if(x.type==='HLS'&&!p.canPlayType('application/vnd.apple.mpegurl'))throw new Error('Questo browser non riproduce HLS nativamente. Usa Safari/iPhone per il remux VELA.');
    p.src=x.url;p.playbackRate=Number($('#speedSelect').value||1);attachSubtitle(record,x);p.load();
    await new Promise(resolve=>p.addEventListener('loadedmetadata',resolve,{once:true}));
    if(x.type==='DIRECT'&&startSeconds>0){try{p.currentTime=Number(startSeconds)}catch{}}
    updatePulse(x.decision);setupTimeline();await p.play();closeDetail();
  }catch(e){toast(e.message,5500)}
}
function attachSubtitle(record,playback){const p=$('#player'),idx=$('#subtitleSelect').value;if(idx==='')return;const track=document.createElement('track');track.kind='subtitles';track.label='VELA';track.srclang='it';track.default=true;const offset=playback.type==='HLS'?Number(playback.startSeconds||0):0;track.src=`/api/media/${record.media.id}/subtitle/${idx}.vtt?offset=${offset}`;p.appendChild(track)}
function currentGlobal(){const p=$('#player');if(!state.active)return 0;return state.active.type==='HLS'?Number(state.active.base||0)+Number(p.currentTime||0):Number(p.currentTime||0)}
async function restartAt(seconds){if(!state.active)return;const id=state.active.mediaId;await saveCurrentProgress();await playMedia(id,Math.max(0,seconds))}
async function stopSession(){if(state.active?.sessionId){const id=state.active.sessionId;try{await fetch(`/api/playback/${id}`,{method:'DELETE'})}catch{}}state.active=null}
async function closePlayer(){await saveCurrentProgress();$('#player').pause();await stopSession();$('#playerLayer').hidden=true;$('#pulsePanel').hidden=true;await reloadHome().catch(()=>{})}
async function saveCurrentProgress(force=false){if(!state.active)return;const now=Date.now();if(!force&&now-state.lastProgressSave<10000)return;state.lastProgressSave=now;const pos=currentGlobal(),dur=Number(state.active.record.media.duration_seconds||0);try{await api(`/api/media/${state.active.mediaId}/progress`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({positionSeconds:pos,durationSeconds:dur,completed:dur>0&&pos>=dur-45})})}catch{}}
function setupTimeline(){const dur=Number(state.active?.record?.media?.duration_seconds||0);$('#timeline').max=Math.max(1,Math.floor(dur));$('#timeTotal').textContent=fmt(dur);updateTime()}
function updateTime(){if(!state.active)return;const pos=currentGlobal(),dur=Number(state.active.record.media.duration_seconds||0);$('#timeNow').textContent=fmt(pos);$('#timeTotal').textContent=fmt(dur);$('#timeline').value=Math.min(Number($('#timeline').max),pos);saveCurrentProgress()}
function updatePulse(d={}){$('#pulseDecision').textContent=d.reason||'VELA mantiene il video originale ogni volta che il client può decodificarlo.';$('#pulseVideo').textContent=`${d.videoAction||'COPY'} · ${state.record?.media?.video_codec?.toUpperCase()||'VIDEO'}`;$('#pulseAudio').textContent=d.audioAction||'COPY';$('#pulseCpu').textContent=d.cpuImpact||'MINIMAL';$('#pulseQuality').textContent=d.qualityPreserved?'ORIGINALE':(d.target||'AUTO')}
function setupPlayerControls(){const p=$('#player');p.addEventListener('timeupdate',updateTime);p.addEventListener('play',()=>$('#togglePlay').textContent='Ⅱ');p.addEventListener('pause',()=>$('#togglePlay').textContent='▶');p.addEventListener('ended',async()=>{await saveCurrentProgress(true)});$('#togglePlay').onclick=()=>p.paused?p.play():p.pause();$('#back10').onclick=()=>restartAt(currentGlobal()-10);$('#forward30').onclick=()=>restartAt(currentGlobal()+30);$('#timeline').addEventListener('change',()=>restartAt(Number($('#timeline').value)));$('#pipBtn').onclick=async()=>{try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else if(p.requestPictureInPicture)await p.requestPictureInPicture()}catch{}};$('#airplayBtn').onclick=()=>p.webkitShowPlaybackTargetPicker?.();$('#fullscreenBtn').onclick=()=>$('#playerLayer').requestFullscreen?.();$('#playerAudio').onclick=()=>{if(!$('#detail').open)$('#detail').showModal();setTimeout(()=>$('#audioSelect').focus(),80)};$('#playerSub').onclick=()=>{if(!$('#detail').open)$('#detail').showModal();setTimeout(()=>$('#subtitleSelect').focus(),80)}}

async function openSystem(){if(!$('#systemSheet').open)$('#systemSheet').showModal();await refreshSystem()}
async function refreshSystem(){try{const m=await api('/api/metadata/status');renderMetadata(m);const s=await api('/api/scan/status');$('#scanStatus').textContent=JSON.stringify(s,null,2)}catch(e){toast(e.message)}}
function renderMetadata(m){$('#systemCards').innerHTML=[['Titoli',m.total],['TMDB',m.ready],['Da abbinare',m.pending],['Miss/Errori',Number(m.missed||0)+Number(m.errors||0)]].map(([a,b])=>`<div><span>${a}</span><b>${b??'—'}</b></div>`).join('');const s=m.state||{},total=s.total||0,pct=total?Math.round((s.processed||0)/total*100):m.total?Math.round((m.ready||0)/m.total*100):0;$('#metadataStatusText').textContent=m.configured?(s.running?'TMDB in lavorazione':'TMDB collegato'):'TMDB da configurare';$('#metadataPct').textContent=`${pct}%`;$('#metadataBar').style.width=`${pct}%`;$('#metadataCurrent').textContent=s.current||s.lastError||`${m.ready||0} metadata pronti`;$('#tmdbMini').textContent=m.configured?'on':'setup'}
async function startMetadata(limit){try{await api('/api/metadata/enrich',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({limit})});pollMetadata()}catch(e){toast(e.message,5000)}}
async function pollMetadata(){clearTimeout(state.metadataTimer);try{const m=await api('/api/metadata/status');renderMetadata(m);if(m.state?.running)state.metadataTimer=setTimeout(pollMetadata,900);else{await reloadHome();toast('TMDB aggiornato')}}catch(e){toast(e.message)}}
async function startScan(limit){try{await api('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({limit})});pollScan()}catch(e){toast(e.message)}}
async function pollScan(){try{const s=await api('/api/scan/status');$('#scanStatus').textContent=JSON.stringify(s,null,2);if(s.running)setTimeout(pollScan,900);else{await reloadHome();toast('Scansione completata')}}catch(e){toast(e.message)}}

window.addEventListener('beforeunload',()=>{if(state.active){const pos=currentGlobal(),dur=Number(state.active.record.media.duration_seconds||0);navigator.sendBeacon?.(`/api/media/${state.active.mediaId}/progress`,new Blob([JSON.stringify({positionSeconds:pos,durationSeconds:dur})],{type:'application/json'}))}});
boot();
