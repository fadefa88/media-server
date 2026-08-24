export const LIBRARIES=['Film','Cartoni','Marvel','OP2','Naruto','Serie','South Park'];
export const DIRECT_SHOWS=new Set(['OP2','Naruto','South Park']);
export const STORE='vela.plex.ui.v2';
export const ui={items:[],byLibrary:new Map(),loaded:false,scope:'home',library:null,tab:'recommended',view:'grid',type:'items',filter:'all',sort:'title',desc:false,poster:150,folder:[],series:null,season:null,selected:new Set(),seasonArt:new Map(),lastMediaId:null,advanced:{genre:'',year:'',quality:''},persist:readStore()};

export function readStore(){try{return{watchlist:[],playlists:{},collections:{},prefs:{},queue:[],...JSON.parse(localStorage.getItem(STORE)||'{}')}}catch{return{watchlist:[],playlists:{},collections:{},prefs:{},queue:[]}}}
export function saveStore(){localStorage.setItem(STORE,JSON.stringify(ui.persist))}
export function splitPath(m){return String(m.relative_path||'').split(/[\\/]/).filter(Boolean)}
export function rootOf(m){return splitPath(m)[0]||'Altro'}
export function titleOf(m){return m.display_title||m.title||m.filename||'Senza titolo'}
export function artOf(m){return m.poster_url||m.backdrop_url||null}
export function landscapeOf(m){return m.backdrop_url||m.poster_url||null}
export function watched(m){return Boolean(m.completed)}
export function progress(m){return Math.max(0,Math.min(100,Number(m.progress_percent||0)))}
export function inProgress(m){return progress(m)>1&&!watched(m)}
export function quality(m){return m.width>=3000?'4K':m.height?`${m.height}p`:'HD'}
export function fmtDuration(sec){sec=Math.max(0,Number(sec||0));const h=Math.floor(sec/3600),min=Math.floor(sec%3600/60);return h?`${h} h ${min} min`:`${min} min`}
export function genresOf(m){let g=m.genres;if(typeof g==='string'){try{g=JSON.parse(g)}catch{g=[]}}return Array.isArray(g)?g.map(x=>typeof x==='string'?x:x?.name).filter(Boolean):[]}
export function episodeNo(m){if(m.episode_number!=null)return Number(m.episode_number);const s=String(m.filename||'');const x=s.match(/\bS\d{1,3}[ ._-]*E(?:P)?[ ._-]?(\d{1,4})\b/i)||s.match(/\bE(?:P)?[ ._-]?(\d{1,4})\b/i)||s.match(/\b\d{1,3}x(\d{1,4})\b/i);return x?Number(x[1]):null}
export function seriesFolder(m){const p=splitPath(m);return p[0]==='Serie'&&p.length>2?p[1]:null}
export function representative(list){return list.find(x=>x.poster_url)||list.find(x=>artOf(x))||list[0]}
export function uniqueBy(items,keyFn){const seen=new Set();return items.filter(x=>{const k=keyFn(x);if(seen.has(k))return false;seen.add(k);return true})}
export function mediaMeta(m){const bits=[];if(m.release_year)bits.push(m.release_year);if(m.media_kind==='tv'&&m.season_number!=null&&m.episode_number!=null)bits.push(`S${String(m.season_number).padStart(2,'0')}E${String(m.episode_number).padStart(2,'0')}`);if(!bits.length&&m.duration_seconds)bits.push(fmtDuration(m.duration_seconds));return bits.join(' · ')}

const SEASON_RE=/^(?:season|stagione)[ ._-]*0*(\d{1,3})(?:\b|$)|^s[ ._-]*0*(\d{1,3})(?:\b|$)/i;
const SPECIAL_RE=/^(?:specials?|speciali)$/i;
const EXTRA_RE=/^(?:extras?|behind[ ._-]*the[ ._-]*scenes|deleted[ ._-]*scenes|featurettes|interviews|shorts|trailers|other)$/i;
export function seasonFromPath(m){const p=splitPath(m),start=DIRECT_SHOWS.has(p[0])?1:2,dirs=p.slice(start,-1);for(const d of dirs){if(SPECIAL_RE.test(d))return{key:'season:0',number:0,label:'Speciali',folder:d};const z=d.match(SEASON_RE);if(z){const n=Number(z[1]||z[2]);return{key:`season:${n}`,number:n,label:`Stagione ${n}`,folder:d}}if(EXTRA_RE.test(d))return{key:'extras',number:9998,label:'Extra',folder:d}}if(m.season_number!=null){const n=Number(m.season_number);return{key:`season:${n}`,number:n,label:n===0?'Speciali':`Stagione ${n}`,folder:null}}if(dirs.length){const d=dirs.at(-1);return{key:`folder:${d}`,number:9997,label:d,folder:d}}return{key:'unseasoned',number:9999,label:'Senza stagione',folder:null}}
export function groupSeasons(items){const map=new Map();for(const m of items){const s=seasonFromPath(m);if(!map.has(s.key))map.set(s.key,{...s,items:[]});map.get(s.key).items.push(m)}return[...map.values()].sort((a,b)=>a.number-b.number||a.label.localeCompare(b.label,'it',{numeric:true}))}
export function showEntries(items){const map=new Map();for(const m of items){const name=seriesFolder(m)||m.title||'Altro';if(!map.has(name))map.set(name,[]);map.get(name).push(m)}return[...map.entries()].sort((a,b)=>a[0].localeCompare(b[0],'it',{numeric:true}))}
export function genreMap(items){const map=new Map();for(const m of items)for(const g of genresOf(m)){if(!map.has(g))map.set(g,[]);map.get(g).push(m)}return map}

export async function api(url,opts={}){const r=await fetch(url,opts);let body={};try{body=await r.json()}catch{}if(!r.ok)throw new Error(body.error||`HTTP ${r.status}`);return body}
export async function loadLibrary(){if(ui.loaded)return;let offset=0,total=Infinity;const all=[];while(offset<total){const d=await api(`/api/media?limit=500&offset=${offset}`);total=Number(d.count||0);all.push(...(d.items||[]));if(!(d.items||[]).length)break;offset+=500}ui.items=all.filter(x=>x.status==='OK');for(const n of LIBRARIES)ui.byLibrary.set(n,[]);for(const m of ui.items){const r=rootOf(m);if(!ui.byLibrary.has(r))ui.byLibrary.set(r,[]);ui.byLibrary.get(r).push(m)}ui.loaded=true}
export function libItems(name){return ui.byLibrary.get(name)||[]}
export function libraryPrefs(name){return ui.persist.prefs[name]||{tab:'recommended',view:'grid',type:name==='Serie'?'shows':'items',filter:'all',sort:'title',desc:false,poster:150}}
export function applyPrefs(name){Object.assign(ui,libraryPrefs(name));ui.advanced={genre:'',year:'',quality:''}}
export function savePrefs(){if(!ui.library)return;ui.persist.prefs[ui.library]={tab:ui.tab,view:ui.view,type:ui.type,filter:ui.filter,sort:ui.sort,desc:ui.desc,poster:ui.poster};saveStore()}
export function sortItems(items){const out=[...items],dir=ui.desc?-1:1;out.sort((a,b)=>{let x,y;switch(ui.sort){case'year':x=Number(a.release_year||0);y=Number(b.release_year||0);break;case'added':x=Date.parse(a.updated_at||0)||0;y=Date.parse(b.updated_at||0)||0;break;case'rating':x=Number(a.vote_average||0);y=Number(b.vote_average||0);break;case'duration':x=Number(a.duration_seconds||0);y=Number(b.duration_seconds||0);break;case'resolution':x=Number(a.width||0);y=Number(b.width||0);break;default:return dir*titleOf(a).localeCompare(titleOf(b),'it',{numeric:true})}return dir*(x-y)||titleOf(a).localeCompare(titleOf(b),'it',{numeric:true})});return out}
export function filterItems(items){let out=[...items];if(ui.filter==='unplayed')out=out.filter(x=>!watched(x)&&!inProgress(x));if(ui.filter==='progress')out=out.filter(inProgress);if(ui.filter==='played')out=out.filter(watched);if(ui.filter==='4k')out=out.filter(x=>x.width>=3000);if(ui.filter==='hdr')out=out.filter(x=>x.hdr&&x.hdr!=='SDR');if(ui.advanced.genre)out=out.filter(x=>genresOf(x).includes(ui.advanced.genre));if(ui.advanced.year)out=out.filter(x=>String(x.release_year||'')===String(ui.advanced.year));if(ui.advanced.quality==='4K')out=out.filter(x=>x.width>=3000);if(ui.advanced.quality==='HD')out=out.filter(x=>x.width<3000&&x.height>=720);if(ui.advanced.quality==='SD')out=out.filter(x=>x.height&&x.height<720);return sortItems(out)}
