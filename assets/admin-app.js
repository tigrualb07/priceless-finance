(()=>{'use strict';
const $=id=>document.getElementById(id),KEY='priceless_vehicle_drafts_v1';
const fields=['title','registration','make','model','year','mileage','price','previousPrice','offerPrice','offerExpiry','doors','colour','bodyType','engine','seats','featured','fuel','gearbox','status','youtube','photo','photos','description','offer','vatStatus','priceIncludesVat','motExpiry','roadTax','keys','serviceHistory','dealItems'];
let records=[],editing=null,online=false;let dealItems=[];
const node=(tag,cls,txt)=>{let e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e};
const money=n=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(n)||0);
const safeUrl=x=>{try{let u=new URL(x);return u.protocol==='https:'?u.href:''}catch{return ''}};
const vid=x=>{try{let u=new URL(x);let id=u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')||(u.pathname.startsWith('/shorts/')?u.pathname.split('/')[2]:'');return /^(www\.)?(youtube\.com|youtu\.be)$/.test(u.hostname)&&/^[\w-]{11}$/.test(id)?id:''}catch{return ''}};
function message(s,bad=false){let el=$('connectionMessage');el.textContent=s;el.style.color=bad?'#9a3021':'#315b34'}
function normal(r){return {...r,status:({Draft:'draft','Ready for review':'ready',Reserved:'reserved',Sold:'sold',Published:'published'})[r.status]||r.status||'draft'}}
function label(s){return ({draft:'Draft',ready:'Ready for review',published:'Published',reserved:'Reserved',sold:'Sold'})[s]||s}
async function api(method='GET',body=null,query='?scope=admin'){let res=await fetch('/api/vehicles'+query,{method,credentials:'same-origin',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});let data=await res.json();if(!res.ok)throw Error(data.error||'Request failed');return data}
async function refresh(){try{let d=await api();records=d.vehicles||[];online=true;message('Connected to shared Cloudflare D1 database. Changes are saved for all authorised staff.');}catch(e){online=false;records=[];message('Shared database unavailable: '+e.message+'. Publishing and saving are disabled.',true)}render()}
function switchTab(t){document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));document.querySelectorAll('.workspace-pane').forEach(p=>p.classList.toggle('active',p.id==='pane-'+t));$('vehicleWorkspace').style.display=t==='vehicles'?'block':'none';if(t==='offers')renderOffers()}
function render(){let q=$('search').value.toLowerCase();$('count').textContent=records.length;$('videos').textContent=records.filter(x=>vid(x.youtube)).length;$('ready').textContent=records.filter(x=>x.status==='ready').length;let list=$('list');list.replaceChildren();for(let r of records.filter(x=>[x.title,x.make,x.model,x.registration].some(y=>String(y||'').toLowerCase().includes(q)))){let card=node('article','card'),thumb=node('div','thumb');if(safeUrl(r.photo)){let img=node('img');img.src=safeUrl(r.photo);img.alt='Vehicle';img.onerror=()=>{thumb.textContent='🚘'};thumb.append(img)}else thumb.textContent='🚘';card.append(thumb);let b=node('div','card-body');b.append(node('h3','',r.title||[r.make,r.model].join(' ')),node('p','muted',[r.year,r.make,r.model].filter(Boolean).join(' ')),node('p','',r.price?money(r.price):'Price on enquiry'),node('span','tag',label(r.status)));let a=node('div','card-actions');for(let [name,fn,cls] of [['Edit',()=>open(r.id),'btn dark'],['Duplicate',()=>duplicate(r),'btn outline'],['Preview',()=>{open(r.id);preview()},'btn outline'],[r.status==='published'?'Unpublish':'Publish',()=>setStatus(r,r.status==='published'?'draft':'published'),'btn outline'],['Delete',()=>remove(r),'btn danger']]){let btn=node('button',cls,name);btn.onclick=fn;a.append(btn)}b.append(a);card.append(b);list.append(card)}if(!list.children.length)list.append(node('div','empty',online?'No vehicles found.':'Connect the database to manage vehicles.'))}
const presets=[
['12 Months MOT if less than 6 months remaining','included'],
['12 Months AA Breakdown Cover','included'],
['3 Months In-House Engine & Gearbox Warranty','included'],
['Full Service if required','included'],
['Full Valet before collection','included'],
['206-Point AA Standard PDI Inspection','included'],
['HPI Clear & DVSA Checked','included'],
['Fair Part Exchange Valuation','included'],
['Nationwide Home Delivery','optional'],
['5-Day Temporary Driveaway Insurance','optional'],
['Personalised Video Walkaround on request','included'],
['Finance options, HP & PCP subject to eligibility','included'],
['Extended Warranty 3 Months','optional'],
['Extended Warranty 6 Months','optional'],
['Extended Warranty 12 Months','optional'],
['Extended Warranty 24 Months','optional']
];
function dealRow(item={}){const row=node('div','deal-item');row.style.cssText='display:grid;grid-template-columns:minmax(180px,2fr) minmax(120px,1fr) minmax(100px,1fr) auto;gap:9px;margin:10px 0;align-items:end';const field=(label,el)=>{const w=node('label');w.style.cssText='font-size:12px;font-weight:700;display:grid;gap:5px';w.append(document.createTextNode(label),el);return w};const name=node('input');name.placeholder='Benefit name';name.maxLength=160;name.value=item.name||'';const type=node('select');for(const [v,t] of [['included','Included in deal'],['free','FREE promotional'],['charged','Staff-added charge'],['optional','Customer optional']]){let o=node('option','',t);o.value=v;type.append(o)}type.value=item.type||'included';const price=node('input');price.type='number';price.min='0';price.step='.01';price.placeholder='£';price.value=item.price??0;const remove=node('button','btn outline','Remove');remove.type='button';remove.onclick=()=>row.remove();const description=node('textarea');description.placeholder='Conditions, coverage, duration or custom details';description.value=item.description||'';description.rows=2;description.style.cssText='grid-column:1/-1;width:100%';row.append(field('Benefit',name),field('Offer type',type),field('Price (£)',price),remove,description);row._get=()=>({name:name.value.trim(),type:type.value,price:Math.max(0,Number(price.value)||0),description:description.value.trim()});$('dealBuilderRows').append(row)}
function collectDeals(){return [...$('dealBuilderRows').children].map(x=>x._get()).filter(x=>x.name)}
function loadDeals(value){$('dealBuilderRows').replaceChildren();let items=[];try{items=Array.isArray(value)?value:JSON.parse(value||'[]')}catch{}if(!Array.isArray(items))items=[];for(const item of items)dealRow(item)}
$('addDealBenefit').onclick=()=>dealRow();
function open(id){switchTab('vehicles');editing=id||null;let r=records.find(x=>x.id===id)||{};loadDeals(r.dealItems);for(let f of fields.filter(f=>f!=='dealItems')){if(f==='featured')$(f).checked=!!r[f];else if(f==='status')$(f).value=label(r[f]||'draft');else $(f).value=r[f]??(f==='priceIncludesVat'?'true':'')}$('editorTitle').textContent=id?'Edit Vehicle':'Add Vehicle';$('editor').classList.add('active');$('preview').classList.remove('active');$('editor').scrollIntoView({behavior:'smooth'})}
function values(){let r={};for(let f of fields.filter(f=>f!=='dealItems'))r[f]=f==='featured'?$(f).checked:$(f).value.trim();r.dealItems=collectDeals();return normal(r)}
function close(){$('editor').classList.remove('active');editing=null}
async function save(r){if(!online){alert('Database is not connected. Changes cannot be saved.');return false}try{let result=await api('POST',r,'');await refresh();return result}catch(e){alert('Save failed: '+e.message);return false}}
async function setStatus(r,s){if(s==='published'&&!confirm('Publish this vehicle to the public showroom? Personalised offers will remain private.'))return;if(s==='draft'&&!confirm('Remove this vehicle from the public showroom?'))return;await save({...r,status:s})}
async function duplicate(r){let copy={...r,id:'vehicle_'+crypto.randomUUID(),title:(r.title||r.model)+' Copy',status:'draft'};await save(copy)}
async function remove(r){if(!confirm('Permanently delete this vehicle from the shared database?'))return;try{await api('DELETE',null,'?id='+encodeURIComponent(r.id));await refresh()}catch(e){alert(e.message)}}
function preview(){let r=values(),p=$('preview');p.replaceChildren();p.append(node('h2','',r.title),node('p','',[r.year,r.make,r.model,r.price?money(r.price):''].filter(Boolean).join(' | ')));let id=vid(r.youtube);if(id){let i=node('iframe');i.src='https://www.youtube-nocookie.com/embed/'+id;i.allowFullscreen=true;p.append(i)}else if(safeUrl(r.photo)){let i=node('img');i.src=safeUrl(r.photo);p.append(i)}p.append(node('p','',r.description));p.classList.add('active')}
function renderOffers(){let out=$('offersList');out.replaceChildren();out.append(node('p','muted','Personalised customer offers remain private and are not shown on the public showroom.'));for(let r of records.filter(x=>x.offerPrice||x.offer)){let box=node('div','work-tile');box.append(node('h3','',r.title),node('p','',r.offerPrice?money(r.offerPrice):'Offer notes'));let b=node('button','btn dark mini-btn','Edit');b.onclick=()=>open(r.id);box.append(b);out.append(box)}}
$('vehicleForm').onsubmit=async e=>{e.preventDefault();let r=values();if(r.youtube&&!vid(r.youtube))return alert('Invalid YouTube URL');if(r.photo&&!safeUrl(r.photo))return alert('Photo URL must use HTTPS');r.id=editing||'vehicle_'+crypto.randomUUID();if(await save(r))close()};
$('new').onclick=()=>open(null);$('cancel').onclick=close;$('previewBtn').onclick=preview;$('search').oninput=render;
for(let b of document.querySelectorAll('[data-tab]'))b.onclick=()=>switchTab(b.dataset.tab);
for(let b of document.querySelectorAll('[data-go]'))b.onclick=()=>switchTab(b.dataset.go);
function exportData(){let a=node('a');let u=URL.createObjectURL(new Blob([JSON.stringify({format:'priceless-finance-drafts-v1',vehicles:records},null,2)],{type:'application/json'}));a.href=u;a.download='priceless-vehicles-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
$('export').onclick=exportData;$('settingsExport').onclick=exportData;
$('importBtn').onclick=()=>$('importFile').click();$('settingsImport').onclick=()=>$('importFile').click();
$('importFile').onchange=async e=>{let f=e.target.files[0];if(!f)return;try{let d=JSON.parse(await f.text());if(!Array.isArray(d.vehicles)||d.vehicles.length>500)throw Error('Invalid backup');if(!confirm('Import '+d.vehicles.length+' vehicles into the shared database?'))return;for(let v of d.vehicles){let clean={};for(let k of fields)clean[k]=v[k];clean.id=v.id;clean=normal(clean);await api('POST',clean,'')}await refresh();alert('Import completed')}catch(err){alert('Import stopped: '+err.message)}finally{e.target.value=''}};
let old=[];try{old=JSON.parse(localStorage.getItem(KEY)||'[]')}catch{}
if(old.length){let b=node('button','btn outline','Import '+old.length+' local drafts into shared database');b.onclick=async()=>{if(!online)return alert('Connect the database first');if(!confirm('Import local browser drafts to shared database?'))return;let ok=0;for(let v of old){try{await api('POST',normal(v),'');ok++}catch(e){alert('Import stopped: '+e.message);break}}await refresh();alert(ok+' drafts imported. Local backup retained.')};$('connectionMessage').after(b)}
switchTab('vehicles');refresh();
})();