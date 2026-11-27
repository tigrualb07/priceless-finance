import {calculateOffer,moneyPence,grossAmount} from '../../assets/offer-calculation.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store, private","x-robots-tag":"noindex, nofollow","referrer-policy":"no-referrer","x-content-type-options":"nosniff"}});
async function staff(request,env){
 const cookie=request.headers.get("Cookie")||"";
 const accessCookie=cookie.split(";").map(x=>x.trim()).find(x=>x.startsWith("CF_Authorization="));
 let token=request.headers.get("Cf-Access-Jwt-Assertion")||"";if(!token&&accessCookie){try{token=decodeURIComponent(accessCookie.slice("CF_Authorization=".length))}catch{return false}}
 if(!token||!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)return false;
 try{
 const parts=token.split(".");if(parts.length!==3)return false;
 const decode=s=>JSON.parse(atob(s.replace(/-/g,"+").replace(/_/g,"/")));
 const header=decode(parts[0]),payload=decode(parts[1]);
 if(header.alg!=="RS256"||!header.kid||payload.aud!==env.ACCESS_AUD&&!(Array.isArray(payload.aud)&&payload.aud.includes(env.ACCESS_AUD)))return false;
 const domain=String(env.ACCESS_TEAM_DOMAIN).replace(/^https?:\/\//,"").replace(/\/$/,"");
 if(!/^[a-z0-9.-]+\.cloudflareaccess\.com$/i.test(domain))return false;
 if(payload.iss!=="https://"+domain||!Number.isFinite(payload.exp)||payload.exp<=Date.now()/1000||payload.nbf&&payload.nbf>Date.now()/1000)return false;
 const response=await fetch("https://"+domain+"/cdn-cgi/access/certs");
 if(!response.ok)return false;
 const jwks=await response.json(),jwk=jwks.keys?.find(k=>k.kid===header.kid&&k.kty==="RSA");if(!jwk)return false;
 const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
 const sig=Uint8Array.from(atob(parts[2].replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
 return await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,sig,new TextEncoder().encode(parts[0]+"."+parts[1]));
 }catch{return false}
}

const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const digest=async t=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t))),b=>b.toString(16).padStart(2,'0')).join('');

function invalidProduct(message){const error=new Error(message);error.status=400;throw error}
function normaliseProducts(items,previous=[]){
 if(!Array.isArray(items)||items.length>60)invalidProduct('Invalid product list');
 const seen=new Set();
 const products=items.map(item=>{
  if(!item||typeof item!=='object')invalidProduct('Invalid product');
  if(previous.length&&!item.id)throw Object.assign(new Error('Product identities changed. Reload before saving.'),{status:409});
  const title=String(item.title||item.name||'').trim();
  if(!title||title.length>130)invalidProduct('Enter a product name of up to 130 characters');
  const type=item.type==='offered'?'optional':item.type||'included';
  if(!['included','free','charged','optional'].includes(type))invalidProduct('Invalid product type');
  const price=Number(item.price??0),normal=Number(item.normalValue??0);
  if(!Number.isFinite(price)||!Number.isFinite(normal)||price<0||normal<0||price>10000000||normal>10000000)invalidProduct('Product prices must be valid nonnegative amounts');
  if(normal>0&&moneyPence(price)>moneyPence(normal))invalidProduct('Offer price cannot exceed original price');
  if(['included','free'].includes(type)&&price!==0)invalidProduct('Included and FREE products must have a zero charge');
  const id=item.id===undefined?crypto.randomUUID():String(item.id);
  if(id&&(!/^[a-zA-Z0-9_-]{8,100}$/.test(id)||seen.has(id)))invalidProduct('Product identifiers must be unique');
  if(id)seen.add(id);
  return {...(id?{id}:{}),title,type,price:moneyPence(price)/100,normalValue:moneyPence(normal)/100,vat:item.vat===true,extraMode:type==='optional'&&['required','default','available'].includes(item.extraMode)?item.extraMode:null,description:String(item.description||'').slice(0,2000),protected:item.protected===true};
 });
 for(const original of previous.filter(item=>item.protected&&item.id)){
  const next=products.find(item=>item.id===original.id);
  if(!next||!next.protected||next.type!==original.type||next.extraMode!==original.extraMode)invalidProduct('Required safety or legal preparation cannot be removed');
 }
 return products;
}

// Backfill by the original array position only. Never infer identity from a title.
async function productIdentity(db,row){
 const data=JSON.parse(row.offer_json),items=data.items||[],oldSelection=JSON.parse(row.selected_json||'[]');
 if(data.productIdentityVersion===1)return row;
 const ids=items.map(x=>x.id).filter(Boolean);
 const issue=new Set(ids).size!==ids.length||!Array.isArray(oldSelection)||oldSelection.some(i=>!Number.isInteger(i)||i<0||i>=items.length||!['optional','offered'].includes(items[i].type));
 if(issue)return {...row,migrationIssue:'Existing product selections require manual review. No identity has been guessed.'};
 const next={...data,items:items.map(x=>({...x,id:x.id||crypto.randomUUID()})),selectedIds:[],productIdentityVersion:1};
 next.selectedIds=oldSelection.map(i=>next.items[i].id);
 const saved=JSON.stringify(next),backupId=crypto.randomUUID();
 await db.batch([
  db.prepare("INSERT INTO private_offer_events(id,offer_id,actor,kind,payload) SELECT ?,id,'system','productIdentityBackup',? FROM private_offers WHERE id=? AND offer_json=? AND selected_json=?").bind(backupId,JSON.stringify({offer_json:row.offer_json,selected_json:row.selected_json}),row.id,row.offer_json,row.selected_json||'[]'),
  db.prepare("UPDATE private_offers SET offer_json=? WHERE id=? AND offer_json=? AND selected_json=?").bind(saved,row.id,row.offer_json,row.selected_json||'[]')
 ]);
 return {...row,...await db.prepare('SELECT offer_json,selected_json FROM private_offers WHERE id=?').bind(row.id).first()};
}
function selectionIds(data,indices){return (indices||[]).map(i=>data.items[i]?.id).filter(Boolean)}
function productSelection(data,items){
 const selected=new Set(data.selectedIds||[]),before=new Map((data.items||[]).map(x=>[x.id,x]));
 return items.filter(x=>['optional','offered'].includes(x.type)&&(selected.has(x.id)||!before.has(x.id)&&x.extraMode==='default')).map(x=>x.id);
}

async function setup(db){const objects=await db.prepare("SELECT name FROM sqlite_master WHERE name IN ('private_offers','private_offer_events','private_offer_selections','private_offer_final_no_update','private_offer_final_no_delete')").all();if(objects.results?.length===5)return;await db.prepare("CREATE TABLE IF NOT EXISTS private_offers (id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL, customer_label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, offer_json TEXT NOT NULL, expires_at TEXT, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();await db.prepare("CREATE TABLE IF NOT EXISTS private_offer_events (id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();try{await db.prepare("ALTER TABLE private_offers ADD COLUMN locked INTEGER NOT NULL DEFAULT 0").run()}catch{};try{await db.prepare("ALTER TABLE private_offers ADD COLUMN selected_json TEXT NOT NULL DEFAULT '[]'").run()}catch{};await db.prepare("CREATE TABLE IF NOT EXISTS private_offer_selections (id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, selection_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();await db.prepare("CREATE TRIGGER IF NOT EXISTS private_offer_final_no_update BEFORE UPDATE ON private_offer_selections WHEN json_extract(OLD.selection_json,'$.kind')='finalAgreement' BEGIN SELECT RAISE(ABORT,'Final agreements are permanent'); END").run();await db.prepare("CREATE TRIGGER IF NOT EXISTS private_offer_final_no_delete BEFORE DELETE ON private_offer_selections WHEN json_extract(OLD.selection_json,'$.kind')='finalAgreement' BEGIN SELECT RAISE(ABORT,'Final agreements are permanent'); END").run()}
const migrate=async db=>{const columns=await db.prepare("PRAGMA table_info(private_offers)").all();const present=new Set(columns.results.map(x=>x.name));for(const [col,definition] of [["customer_phone","TEXT NOT NULL DEFAULT ''"],["customer_email","TEXT NOT NULL DEFAULT ''"],["published","INTEGER NOT NULL DEFAULT 1"],["vehicle_override","TEXT NOT NULL DEFAULT '{}'"],["share_token","TEXT"],["revision","INTEGER NOT NULL DEFAULT 0"],["package_revision","INTEGER NOT NULL DEFAULT 0"]]){if(present.has(col))continue;try{await db.prepare("ALTER TABLE private_offers ADD COLUMN "+col+" "+definition).run()}catch{}}};
async function pxState(db,id){const e=await db.prepare("SELECT rowid AS sequence,id,payload FROM private_offer_events WHERE offer_id=? AND kind='partExchange' ORDER BY rowid DESC LIMIT 1").bind(id).first();if(!e)return null;const withdrawn=await db.prepare("SELECT payload FROM private_offer_events WHERE offer_id=? AND kind='partExchangeWithdraw' AND rowid>? ORDER BY rowid DESC LIMIT 1").bind(id,e.sequence).first();const v=await db.prepare("SELECT id,payload FROM private_offer_events WHERE offer_id=? AND kind='valuation' ORDER BY rowid DESC LIMIT 1").bind(id).first();if(withdrawn)return {pxId:e.id,registration:JSON.parse(e.payload).registration,id:v?.id||e.id,status:'withdrawn',value:null,settlement:null,net:null,financeExists:null};if(!v)return null;const x=JSON.parse(v.payload);if(x.pxId!==e.id)return null;const a=await db.prepare("SELECT payload FROM private_offer_events WHERE offer_id=? AND kind='valuationDecision' ORDER BY rowid DESC LIMIT 1").bind(id).first(),decision=a?JSON.parse(a.payload):{};return {...x,id:v.id,status:decision.valuationId===v.id?decision.status:'pending',negativeEquityAgreed:decision.valuationId===v.id&&decision.negativeEquityAgreed===true};}
const warrantyPrices={standard:[181,199,498,698],special:[271.5,298.5,747,1047]};const warrantyMonths=[3,6,12,24];async function warrantyState(db,id){const e=await db.prepare("SELECT rowid AS sequence,id,kind,payload FROM private_offer_events WHERE offer_id=? AND kind IN ('warrantyRequest','warrantyReview','warrantyAccept') ORDER BY rowid DESC LIMIT 1").bind(id).first();if(!e)return null;const w={...JSON.parse(e.payload),id:e.id};const changed=await db.prepare("SELECT payload FROM private_offer_events WHERE offer_id=? AND kind='vehicle' AND rowid>? AND COALESCE(json_extract(payload,'$.before.engine'),'')!=COALESCE(json_extract(payload,'$.after.engine'),'') ORDER BY rowid DESC LIMIT 1").bind(id,e.sequence).first();if(changed&&w.months){const engine=JSON.parse(changed.payload).after.engine;return {...w,engine,status:'review',eligibilityChanged:true,taxConfirmed:false,category:engine==='electric'||Number(engine)>2.5||(w.flags||[]).length?'special':'standard'};}return w}
function vehicleData(v,override={}){let extra={};try{extra=JSON.parse(v.extra_json||'{}')}catch{}const result={registration:v.registration,title:v.title,make:v.make,model:v.model,year:v.year,mileage:v.mileage,fuel:v.fuel_type,gearbox:v.transmission,description:v.description,youtube:v.youtube_url,photo:v.main_image_url,engine:v.engine_size,colour:v.colour,bodyType:v.body_type};for(const k of ['seats','doors','serviceHistory','keys','motExpiry','roadTax','previousKeepers','lastService','lastWork','photoUrls'])if(extra[k]!=null)result[k]=extra[k];if(extra.photos)result.photoUrls=Array.isArray(extra.photos)?extra.photos.join('\n'):extra.photos;if(extra.timingWork)result.cambelt=extra.timingWork;return {...result,...override}}
function validateVehicle(data){
 for(const k of ['year','mileage','seats','doors','keys','previousKeepers'])if(data[k]!==undefined&&data[k]!==''){const n=Number(data[k]);if(!Number.isInteger(n)||n<0||k==='year'&&(n<1950||n>new Date().getUTCFullYear()+1))failure('Enter a valid '+k);}
 if(data.engine&&!/^(electric|[0-8]\.[0-9])$/.test(data.engine))failure('Select a valid engine');
 const secure=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password}catch{return false}};
 if(data.photoUrls&&data.photoUrls.split(/\r?\n/).some(x=>x.trim()&&!secure(x.trim())))failure('Each photo must use a valid HTTPS URL');
 if(data.videoUrl){if(/^https:\/\/pricelessfinance\.co\.uk\/api\/private-offers\?media=[a-f0-9-]{36}%2F[a-f0-9-]{36}$/i.test(data.videoUrl))return;let u;try{u=new URL(data.videoUrl)}catch{failure('Enter a valid YouTube URL')}const host=u.hostname.toLowerCase(),id=host==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')||u.pathname.split('/').pop();if(!secure(data.videoUrl)||!['youtu.be','youtube.com','www.youtube.com','m.youtube.com'].includes(host)||!/^[\w-]{11}$/.test(id||''))failure('Enter a valid YouTube video URL');}
}
async function offerUpdates(db,id){
 const events=(await db.prepare("SELECT id,kind,payload,created_at FROM private_offer_events WHERE offer_id=? AND actor='dealer' AND kind IN ('edit','valuation','warrantyReview','warrantyRequest','depositRequest','paymentRecord','note','vehicle') ORDER BY rowid DESC LIMIT 100").bind(id).all()).results||[];
 const reads=(await db.prepare("SELECT payload FROM private_offer_events WHERE offer_id=? AND actor='customer' AND kind='offerUpdateViewed'").bind(id).all()).results||[];
 const seen=new Set(reads.flatMap(x=>{try{return [JSON.parse(x.payload).updateId]}catch{return []}})),out=[],keys=new Set();
 const money=n=>Number(n||0).toLocaleString('en-GB',{style:'currency',currency:'GBP'});
 for(const e of events){let p;try{p=JSON.parse(e.payload)}catch{continue}const add=(key,title,detail,target)=>{if(keys.has(key))return;keys.add(key);const id=e.id+':'+key;out.push({id,title,detail,target,viewed:seen.has(id),createdAt:e.created_at})};
 if(e.kind==='edit'){const a=p.before||{},b=p.after||{};if(a.price!==b.price||a.vehicleVat!==b.vehicleVat)add('price','Vehicle price updated',money(a.price)+' → '+money(b.price),'base');const before=new Map((a.items||[]).map(x=>[x.id,x])),after=new Map((b.items||[]).map(x=>[x.id,x]));for(const [id,x] of after){if(!id)continue;const old=before.get(id);if(!old||['title','price','normalValue','vat','type','description','extraMode'].some(k=>old[k]!==x[k]))add('item-'+id,x.title+(old?' updated':' added'),x.type==='included'?'Included':x.type==='free'?'FREE':money(x.price),'item-'+id)}for(const [id,x] of before)if(id&&!after.has(id))add('item-'+id,x.title+' removed','Review your updated package','items')}
 else if(e.kind==='vehicle'){const a=p.before||{},b=p.after||{};if(a.videoUrl!==b.videoUrl&&b.videoUrl)add('video','Your video tour is available','Watch your personalised vehicle video','media');if(a.photoUrls!==b.photoUrls)add('photos','Vehicle photos updated','View your vehicle gallery','media');}
 else if(e.kind==='valuation')add('px','Your Part Exchange valuation is ready',money(p.value),'valuationBox');
 else if(e.kind.startsWith('warranty'))add('warranty','Your warranty plan has been updated',p.months?p.months+' months':'Review warranty options','warrantyPlans');
 else if(e.kind==='depositRequest')add('deposit','Deposit request updated',money(p.amount),'paymentBalance');
 else if(e.kind==='paymentRecord')add('payment-'+e.id,'Payment record updated','Review your payment summary','paymentBalance');
 else if(e.kind==='note')add('note-'+e.id,'New message from Priceless','Read your message','messagesSection');
 }return out.slice(0,100);
}

const allowedDays=new Set([1,7,30]);

async function mediaUpload(request,env,u){
 if(!env.MEDIA_BUCKET)return json({error:'Media storage unavailable'},503);
 const id=u.searchParams.get('deal');if(!/^[a-f0-9-]{36}$/.test(id||''))return json({error:'Invalid deal'},400);
 const row=await env.DB.prepare('SELECT locked,revoked FROM private_offers WHERE id=?').bind(id).first();if(!row||row.locked||row.revoked)return json({error:'Deal unavailable or locked'},423);
 const type=request.headers.get('content-type')||'',limit=type==='video/mp4'||type==='video/webm'?80*1024*1024:12*1024*1024;
 if(!['image/jpeg','image/png','image/webp','video/mp4','video/webm'].includes(type))return json({error:'Use JPG, PNG, WEBP, MP4 or WEBM'},415);
 const length=Number(request.headers.get('content-length'));if(length>limit)return json({error:'File too large'},413);
 const bytes=await request.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>limit)return json({error:'File too large or empty'},413);
 const b=new Uint8Array(bytes),ascii=(a,z)=>String.fromCharCode(...b.slice(a,z));
 const valid=type==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:type==='image/png'?b[0]===137&&ascii(1,4)==='PNG':type==='image/webp'?ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP':type==='video/mp4'?ascii(4,8)==='ftyp':b[0]===26&&b[1]===69&&b[2]===223&&b[3]===163;
 if(!valid)return json({error:'File content does not match its format'},415);
 const key=id+'/'+crypto.randomUUID();await env.MEDIA_BUCKET.put(key,bytes,{httpMetadata:{contentType:type}});return json({url:'https://pricelessfinance.co.uk/api/private-offers?media='+encodeURIComponent(key)});
}
async function mediaRead(request,env,u){
 const key=u.searchParams.get('media');if(!/^[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(key||'')||!env.MEDIA_BUCKET)return json({error:'Media unavailable'},404);
 const id=key.split('/')[0],row=await env.DB.prepare('SELECT * FROM private_offers WHERE id=?').bind(id).first();if(!row)return json({error:'Media unavailable'},404);
 if(!await staff(request,env)){const t=u.searchParams.get('token');if(!/^[a-f0-9]{64}$/.test(t||'')||await digest(t)!==row.token_hash||row.revoked||!row.published||row.expires_at&&Date.parse(row.expires_at)<=Date.now())return json({error:'Media unavailable'},404);
 const final=await finalAgreement(env.DB,row),v=final?.content?.vehicle||JSON.parse(row.vehicle_override||'{}');const urls=[...String(v.photoUrls||'').split(/\r?\n/),v.videoUrl];if(!urls.some(x=>{try{return new URL(x).searchParams.get('media')===key}catch{return false}}))return json({error:'Media unavailable'},404);}
 const range=request.headers.get('range');const obj=await env.MEDIA_BUCKET.get(key,range?{range:request.headers}:{});if(!obj)return json({error:'Media unavailable'},404);
 const h=new Headers({'content-type':obj.httpMetadata?.contentType||'application/octet-stream','cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','accept-ranges':'bytes'});let status=200;if(range&&obj.range&&Number.isFinite(obj.range.offset)&&Number.isFinite(obj.range.length)){status=206;h.set('content-range','bytes '+obj.range.offset+'-'+(obj.range.offset+obj.range.length-1)+'/'+obj.size);h.set('content-length',String(obj.range.length))}else h.set('content-length',String(obj.size));return new Response(obj.body,{status,headers:h});
}

export async function onRequestGet({request,env}){if(!env.DB)return json({error:"Database unavailable"},503);const u=new URL(request.url);try{if(u.searchParams.has('media'))return await mediaRead(request,env,u);await setup(env.DB);await migrate(env.DB);if(u.searchParams.has('token')){const t=u.searchParams.get('token');if(!/^[a-f0-9]{64}$/.test(t||''))return json({error:"Offer unavailable"},404);let row=await env.DB.prepare("SELECT id,vehicle_id,customer_label,offer_json,expires_at,revoked,locked,selected_json,updated_at,published,vehicle_override,revision,package_revision FROM private_offers WHERE token_hash=?").bind(await digest(t)).first();if(!row||row.revoked||!row.published||row.expires_at&&Date.parse(row.expires_at)<=Date.now())return json({error:"This private offer is no longer available"},410);row=await productIdentity(env.DB,row);const v=await env.DB.prepare("SELECT * FROM vehicles WHERE id=?").bind(row.vehicle_id).first();if(!v)return json({error:"Offer unavailable"},404);const d=JSON.parse(row.offer_json);const override=JSON.parse(row.vehicle_override||'{}'),amounts=await offerAmounts(env.DB,row),final=await finalAgreement(env.DB,row),frozen=final?.content;return json({vehicle:frozen?.vehicle||vehicleData(v,override),offer:{updates:await offerUpdates(env.DB,row.id),...amounts,...(frozen?{calculation:frozen.calculation,payments:frozen.payments,warranty:frozen.warranty,valuation:frozen.valuation}:{}),finalAgreement:final,confirmedPackageRevision:d.confirmedPackageRevision??null,requiresConfirmation:d.confirmedPackageRevision!==row.package_revision,depositRequested:d.depositRequested||0,customerName:row.customer_label,price:d.price,retailPrice:frozen?.retailPrice??Math.max(Number(d.price)||0,Number(v.retail_price)||0),vehicleVat:d.vehicleVat===true,items:d.items||[],selectedIds:d.selectedIds||[],dealStatus:d.dealStatus||'new',migrationIssue:row.migrationIssue||null,expiresAt:row.expires_at,locked:!!row.locked,selected:JSON.parse(row.selected_json||"[]"),revision:row.revision,packageRevision:row.package_revision,valuation:frozen?.valuation??amounts.valuation,warranty:frozen?.warranty??amounts.warranty,preferences:(await env.DB.prepare("SELECT id,kind,payload FROM private_offer_events WHERE offer_id=? AND kind IN ('payment','partExchange') ORDER BY created_at DESC,rowid DESC LIMIT 100").bind(row.id).all()).results||[],notes:(await env.DB.prepare("SELECT actor,payload,created_at FROM private_offer_events WHERE offer_id=? AND kind='note' ORDER BY rowid ASC").bind(row.id).all()).results||[]}})}
if(!await staff(request,env))return json({error:"Staff authentication required"},403);
const rows=await env.DB.prepare("SELECT id,vehicle_id,customer_label,customer_phone,customer_email,vehicle_override,published,share_token,offer_json,expires_at,revoked,locked,selected_json,created_at,updated_at,revision,package_revision FROM private_offers ORDER BY created_at DESC LIMIT 200").all();const focused=u.searchParams.get('offer');for(let i=0;i<(rows.results||[]).length;i++){rows.results[i]=await productIdentity(env.DB,rows.results[i]);if(rows.results[i].id===focused){const source=await env.DB.prepare('SELECT * FROM vehicles WHERE id=?').bind(rows.results[i].vehicle_id).first();rows.results[i].vehicleDetails=vehicleData(source,JSON.parse(rows.results[i].vehicle_override||'{}'));Object.assign(rows.results[i],await offerAmounts(env.DB,rows.results[i]));rows.results[i].detailsLoaded=true;rows.results[i].finalAgreement=await finalAgreement(env.DB,rows.results[i]);const frozen=rows.results[i].finalAgreement?.content;if(frozen)Object.assign(rows.results[i],{calculation:frozen.calculation,payments:frozen.payments,warranty:frozen.warranty,valuation:frozen.valuation});}}const submissions=await env.DB.prepare("SELECT id,offer_id,selection_json,created_at FROM private_offer_selections ORDER BY created_at DESC LIMIT 500").all();const before=Number(u.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(focused&&!/^[a-f0-9-]{36}$/.test(focused))return json({error:'Invalid offer'},400);const events=focused?await env.DB.prepare("SELECT rowid AS sequence,* FROM private_offer_events WHERE offer_id=? AND rowid<? ORDER BY rowid DESC LIMIT 201").bind(focused,Number.isSafeInteger(before)?before:Number.MAX_SAFE_INTEGER).all():await env.DB.prepare("SELECT rowid AS sequence,* FROM private_offer_events ORDER BY rowid DESC LIMIT 1000").all();const eventCursor=focused&&events.results.length>200?events.results[199].sequence:null;if(eventCursor)events.results=events.results.slice(0,200);return json({eventCursor,offers:(rows.results||[]).map(({share_token,...x})=>({...x,private_url:share_token?new URL("/offer/?token="+share_token,request.url).href:null,offer_json:JSON.parse(x.offer_json),selected:JSON.parse(x.selected_json||"[]"),vehicle_override:JSON.parse(x.vehicle_override||"{}")})),events:events.results||[],submissions:(submissions.results||[]).map(x=>({...x,selection:JSON.parse(x.selection_json)}))});
}catch{return json({error:"Unable to retrieve offers"},500)}}
export async function onRequestPost({request,env}){if(!await staff(request,env))return json({error:"Staff authentication required"},403);if(!env.DB)return json({error:"Database unavailable"},503);try{const u=new URL(request.url);if(u.searchParams.has('uploadMedia'))return await mediaUpload(request,env,u);await setup(env.DB);await migrate(env.DB);const d=await request.json();
if(d.action==='createCustomer'){
 const customer=String(d.customer||'').trim().slice(0,100),phone=String(d.phone||'').trim().slice(0,80),email=String(d.email||'').trim().slice(0,180);
 const registration=String(d.registration||'').trim().toUpperCase().slice(0,16),make=String(d.make||'').trim().slice(0,50),model=String(d.model||'').trim().slice(0,80),mileage=Number(d.mileage),netPrice=Number(d.price),vehicleVat=d.vehicleVat===true,price=grossAmount(netPrice,vehicleVat);
 if(!customer||!registration||!make||!model||!Number.isFinite(mileage)||mileage<0||!Number.isFinite(price)||price<=0||price>10000000||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"Complete customer name, valid email if supplied, registration, make, model, mileage and price"},400);
 const id=crypto.randomUUID(),vehicleId='vehicle_'+crypto.randomUUID(),t=token(),hash=await digest(t);
 try{
 await env.DB.batch([
 env.DB.prepare("INSERT INTO vehicles (id,registration,make,model,mileage,retail_price,status,title,extra_json) VALUES (?,?,?,?,?,?,?,?,?)").bind(vehicleId,registration,make,model,mileage,price,'draft',make+' '+model,JSON.stringify({customerDealOnly:true})),
 env.DB.prepare("INSERT INTO private_offers(id,vehicle_id,customer_label,customer_phone,customer_email,token_hash,offer_json,expires_at,published,share_token) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id,vehicleId,customer,phone,email,hash,JSON.stringify({price,vehicleVat,items:[],selectedIds:[],productIdentityVersion:1}),null,0,t)
 ]);
 return json({ok:true,id,vehicleId,url:new URL('/offer/?token='+t,request.url).href});
 }catch(e){return json({error:"Could not create customer deal",detail:String(e.message||e).slice(0,160)},500)}
}
const v=await env.DB.prepare("SELECT id,retail_price,offer_price,extra_json FROM vehicles WHERE id=?").bind(String(d.vehicleId||'')).first();if(!v)return json({error:"Vehicle not found"},404);const customer=String(d.customer||'').trim().slice(0,100);if(!customer)return json({error:"Enter a customer reference"},400);const days=Number(d.days);if(!allowedDays.has(days)&&days!==0&&days!==-1)return json({error:"Invalid expiry option"},400);let expires=days===-1?null:days===0?new Date(d.expiresAt):new Date(Date.now()+days*86400000);if(expires&&(!Number.isFinite(expires.getTime())||expires.getTime()<=Date.now()||expires.getTime()>Date.now()+366*86400000))return json({error:"Expiry must be in the next 366 days"},400);
const extras=JSON.parse(v.extra_json||'{}');const defaultPrice=Number(extras.offerPrice)||Number(v.offer_price)||Number(v.retail_price);const price=Number(d.price??defaultPrice);if(!Number.isFinite(price)||price<=0||price>10000000)return json({error:"Invalid offer price"},400);const items=Array.isArray(d.items)?d.items:extras.dealItems||[];if(!Array.isArray(items)||items.length>60)return json({error:"Invalid benefits"},400);const cleaned=normaliseProducts(items);
const id=crypto.randomUUID(),t=token();await env.DB.prepare("INSERT INTO private_offers(id,vehicle_id,customer_label,token_hash,offer_json,expires_at,share_token,selected_json) VALUES(?,?,?,?,?,?,?,?)").bind(id,v.id,customer,await digest(t),JSON.stringify({price,items:cleaned,selectedIds:cleaned.filter(x=>x.extraMode==='default').map(x=>x.id),productIdentityVersion:1}),expires?expires.toISOString():null,t,JSON.stringify(cleaned.flatMap((x,i)=>x.extraMode==='default'?[i]:[]))).run();return json({ok:true,id,url:new URL('/offer/?token='+t,request.url).href,expiresAt:expires?.toISOString()||null})}catch(e){return json({error:e.status?e.message:"Could not create offer"},e.status||500)}}
export async function onRequestCustomerMessage({request,env}){return json({error:"Unavailable"},404)}
async function paymentState(db,id){const rows=await db.prepare("SELECT id,payload,created_at FROM private_offer_events WHERE offer_id=? AND kind='paymentRecord' ORDER BY rowid ASC").bind(id).all();return (rows.results||[]).map(e=>({...JSON.parse(e.payload),id:e.id,createdAt:e.created_at}))}
async function offerAmounts(db,row,data=JSON.parse(row.offer_json)){
 const v=await db.prepare('SELECT * FROM vehicles WHERE id=?').bind(row.vehicle_id).first(),payments=await paymentState(db,row.id),warranty=await warrantyState(db,row.id),valuation=await pxState(db,row.id);
 return {payments,warranty,valuation,calculation:calculateOffer({price:data.price,retailPrice:v?.retail_price,vehicleVat:data.vehicleVat===true,items:data.items||[],selectedIds:data.selectedIds||[],warranty,valuation,payments,depositRequested:data.depositRequested||0})};
}
async function agreementSnapshot(db,row,data=JSON.parse(row.offer_json),packageRevision=row.package_revision){const source=await db.prepare('SELECT * FROM vehicles WHERE id=?').bind(row.vehicle_id).first(),amounts=await offerAmounts(db,row,data);const content={customer:{name:row.customer_label,phone:row.customer_phone||'',email:row.customer_email||''},vehicle:vehicleData(source,JSON.parse(row.vehicle_override||'{}')),price:data.price,retailPrice:Math.max(data.price,Number(source.retail_price)||0),vehicleVat:data.vehicleVat===true,items:data.items||[],selectedIds:data.selectedIds||[],depositRequested:data.depositRequested||0,...amounts};return {packageRevision,content,hash:await digest(JSON.stringify(content))}}
async function finalAgreement(db,row){const id=JSON.parse(row.offer_json).finalAgreementId;if(!id||!row.locked)return null;const e=await db.prepare('SELECT selection_json FROM private_offer_selections WHERE id=? AND offer_id=?').bind(id,row.id).first();return e?JSON.parse(e.selection_json):null}
async function finalChecks(db,row,data,checks){
 if(!checks||['vehicleChecked','productsChecked','taxChecked','paymentsChecked','pxChecked','customerConfirmed'].some(k=>checks[k]!==true))failure('Complete every finalisation check',400);
 if(!row.published||row.expires_at&&Date.parse(row.expires_at)<=Date.now())failure('Publish an active customer link before finalising',409);
 const snapshot=await agreementSnapshot(db,row,data),v=snapshot.content.vehicle;
 if(!snapshot.content.customer.name||!snapshot.content.customer.phone&&!snapshot.content.customer.email)failure('Complete customer name and contact details',409);
 for(const k of ['title','registration','make','model','year','mileage','fuel','gearbox','engine'])if(v[k]===null||v[k]===undefined||String(v[k]).trim()==='')failure('Complete the vehicle '+k+' before finalising',409);
 validateVehicle(v);normaliseProducts(data.items||[],data.items||[]);
 if(data.confirmedPackageRevision!==row.package_revision||data.confirmedHash!==snapshot.hash)failure('Customer must confirm this exact latest package before finalising',409);
 const w=snapshot.content.warranty;if(w?.months&&(w.status!=='confirmed'||!w.taxConfirmed||!w.eligibilityConfirmed))failure('Complete warranty eligibility, provider tax evidence and customer reconfirmation',409);
 if((data.items||[]).some(x=>data.selectedIds?.includes(x.id)&&x.title.startsWith('Extended Warranty: ')))failure('Review the existing legacy warranty through the evidenced warranty review before finalising',409);
 const px=snapshot.content.valuation,request=await db.prepare("SELECT id FROM private_offer_events WHERE offer_id=? AND kind='partExchange' ORDER BY rowid DESC LIMIT 1").bind(row.id).first();
 if(request&&(!px||!['accepted','declined','withdrawn'].includes(px.status)))failure('The customer must accept, decline or withdraw the part exchange',409);
 if(px?.status==='accepted'&&(!checks.pxChecked||px.net===null||px.settlement===null||px.financeExists===null||px.net<0&&!px.negativeEquityAgreed))failure('Complete part exchange inspection, settlement and any separate negative equity agreement',409);
 return snapshot;
}
function failure(message,status=400){throw Object.assign(new Error(message),{status})}
async function offerRow(db,id){let row=await db.prepare('SELECT * FROM private_offers WHERE id=?').bind(id).first();if(!row)failure('Offer not found',404);return productIdentity(db,row)}
function checkRevision(row,d){if(!Number.isSafeInteger(d.revision)||d.revision!==row.revision)failure('This offer changed. Your draft is still available. Review the latest saved offer before saving again.',409);if(row.migrationIssue)failure(row.migrationIssue,409)}
// The conditional update and its audit entries are one D1 transaction.
async function saveMutation(db,row,{fields={},data=JSON.parse(row.offer_json),actor='dealer',kind,payload={},financial=false,selection=null}){
 const mutation=crypto.randomUUID(),revision=row.revision+1,packageRevision=row.package_revision+(financial?1:0);
 const saved={...data,lastMutationId:mutation};
 const updates={...fields,offer_json:JSON.stringify(saved),revision,package_revision:packageRevision,updated_at:new Date().toISOString()};
 const values=Object.values(updates),keys=Object.keys(updates),eventPayload={...payload,revision,packageRevision};
 const statements=[db.prepare('UPDATE private_offers SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=? AND revision=?').bind(...values,row.id,row.revision),db.prepare("INSERT INTO private_offer_events(id,offer_id,actor,kind,payload) SELECT ?,id,?,?,? FROM private_offers WHERE id=? AND json_extract(offer_json,'$.lastMutationId')=?").bind(mutation,actor,kind,JSON.stringify(eventPayload),row.id,mutation)];
 if(selection)statements.push(db.prepare("INSERT INTO private_offer_selections(id,offer_id,selection_json) SELECT ?,id,? FROM private_offers WHERE id=? AND json_extract(offer_json,'$.lastMutationId')=?").bind(selection.id,JSON.stringify(selection.data),row.id,mutation));
 const results=await db.batch(statements);if(!results[0].meta?.changes)failure('Another change was saved first. Your draft has been preserved. Review the latest offer.',409);
 return {ok:true,revision,packageRevision};
}
function pxDetails(x={}){
 if(!String(x.registration||'').trim()||String(x.mileage??'').trim()===''||String(x.expected??'').trim()===''||!Number.isFinite(Number(x.mileage))||!Number.isFinite(Number(x.expected))||Number(x.mileage)<0||Number(x.expected)<0)failure('Registration, mileage and expected value required');
 const payload={};for(const key of ['registration','mileage','expected','make','model','keys','history','lastService','major','timing','timingWork','condition','finance','settlement'])payload[key]=String(x[key]??'').slice(0,1000);return payload;
}
async function publicRow(db,t,allowLocked=false){if(!/^[a-f0-9]{64}$/.test(t||''))failure('Invalid offer link');const found=await db.prepare('SELECT * FROM private_offers WHERE token_hash=?').bind(await digest(t)).first();if(!found||found.revoked||!found.published||found.expires_at&&Date.parse(found.expires_at)<=Date.now())failure('Offer expired or withdrawn',410);if(found.locked&&!allowLocked)failure('This offer is finalised and locked',423);return productIdentity(db,found)}
export async function onRequestPut({request,env}){
 if(!env.DB)return json({error:'Database unavailable'},503);
 try{
  await setup(env.DB);await migrate(env.DB);const d=await request.json();if(d.action==='viewOfferUpdate'){const row=await publicRow(env.DB,d.token,true),updates=await offerUpdates(env.DB,row.id),u=updates.find(x=>x.id===d.updateId);if(!u)failure('Update unavailable',404);if(!u.viewed)await env.DB.prepare("INSERT OR IGNORE INTO private_offer_events(id,offer_id,actor,kind,payload) VALUES(?,?,'customer','offerUpdateViewed',?)").bind('view:'+row.id+':'+u.id,row.id,JSON.stringify({updateId:u.id,title:u.title})).run();return json({revision:row.revision,packageRevision:row.package_revision});}const row=await publicRow(env.DB,d.token);checkRevision(row,d);const db=env.DB,data=JSON.parse(row.offer_json);let payload={},financial=false,selection=null,kind=d.action,fields={},next=data;
  if(d.action==='warrantyRequest'||d.action==='warrantyAccept'){
   const w=await warrantyState(db,row.id);financial=true;
   if(d.action==='warrantyRequest'){if(![0,...warrantyMonths].includes(d.months))failure('Invalid warranty period');if(d.months&&(data.items||[]).some(x=>data.selectedIds?.includes(x.id)&&x.title.startsWith('Extended Warranty: ')))failure('Review the existing warranty selection before choosing another period',409);payload={months:d.months,status:d.months?'review':'none',category:w?.category||null,engine:w?.engine||'',flags:w?.flags||[],vat:false,taxConfirmed:false,taxTreatment:'unconfirmed'};}
   else{if(!w||w.id!==d.reviewId||w.status!=='acceptance')failure('Warranty offer changed',409);if(!w.taxConfirmed)failure('Warranty tax treatment still requires provider evidence',409);payload={...w,status:'confirmed'};}
  }else if(d.action==='valuationDecision'){
   const v=await pxState(db,row.id);if(!v||v.id!==d.valuationId||!['accepted','declined','withdrawn'].includes(d.status)||v.status==='withdrawn')failure('Valuation changed. Review your offer.',409);if(d.status==='accepted'&&(v.net===null||v.settlement===null||v.financeExists===null))failure('A valuation and known settlement are required before accepting',409);if(d.status==='accepted'&&v.net<0&&d.negativeEquityAgreed!==true)failure('Negative equity needs a separate reviewed agreement',409);payload={valuationId:v.id,status:d.status,negativeEquityAgreed:d.status==='accepted'&&v.net<0&&d.negativeEquityAgreed===true,acceptedNet:v.net,acceptedSettlement:v.settlement,acceptedValue:v.value};financial=true;
  }else if(d.action==='pxWithdraw'){const e=await db.prepare("SELECT id FROM private_offer_events WHERE offer_id=? AND kind='partExchange' ORDER BY rowid DESC LIMIT 1").bind(row.id).first();if(!e||d.pxId&&d.pxId!==e.id)failure('Part exchange details changed',409);payload={pxId:e.id};kind='partExchangeWithdraw';financial=true;
  }else if(d.action==='partExchange'){payload=pxDetails(d.details);financial=true;
  }else if(d.action==='payment'){if(!['cash','card','finance'].includes(d.method))failure('Invalid payment preference');payload={method:d.method};
  }else if(d.action==='note'){const message=String(d.message||'').trim().slice(0,1200);if(!message)failure('Enter a message');payload={message};
  }else if(!d.action||d.action==='previewSelection'||d.action==='confirm'){
   const indices=Array.isArray(d.selectedIds)?d.selectedIds.map(id=>data.items.findIndex(x=>x.id===id)):d.selected;
   if(!Array.isArray(indices)||indices.length>60||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=data.items.length||!['optional','offered'].includes(data.items[i].type)))failure('Invalid selection');
   if(indices.filter(i=>data.items[i].title.startsWith('Extended Warranty: ')).length>1)failure('Select only one extended warranty');if(indices.some(i=>data.items[i].title.startsWith('Extended Warranty: '))&&(await warrantyState(db,row.id))?.months)failure('Choose one warranty through the warranty review before confirming',409);
   const ids=selectionIds(data,indices),previous=data.selectedIds||[],selected=indices.map(i=>({...data.items[i]}));financial=JSON.stringify(ids)!==JSON.stringify(previous);next={...data,selectedIds:ids};fields.selected_json=JSON.stringify(indices);
   const {calculation:{total}}=await offerAmounts(db,row,next);
   payload={selected,total,added:ids.filter(id=>!previous.includes(id)).map(id=>data.items.find(x=>x.id===id)?.title),removed:previous.filter(id=>!ids.includes(id)).map(id=>data.items.find(x=>x.id===id)?.title).filter(Boolean)};
   kind=d.action==='previewSelection'?'extraSelection':'selection';if(kind==='selection'){if(d.packageRevision!==row.package_revision)failure('Review the latest package before confirming',409);const snapshot=await agreementSnapshot(db,row,next,row.package_revision+(financial?1:0));selection={id:crypto.randomUUID(),data:{kind:'customerConfirmation',selected,selectedIds:ids,vehiclePrice:data.price,total,...snapshot,confirmedAt:new Date().toISOString()}};next.confirmedPackageRevision=selection.data.packageRevision;next.confirmedHash=snapshot.hash;}
  }else failure('Unknown customer action');
  const result=await saveMutation(db,row,{fields,data:next,actor:'customer',kind,payload,financial,selection});return json({...result,...(selection?{reference:selection.id.slice(0,8).toUpperCase(),total:selection.data.total}:{})});
 }catch(e){return json({error:e.status?e.message:'Unable to save your request'},e.status||500)}
}
export async function onRequestCustomerNote(){return json({error:'Unavailable'},404)}
export async function onRequestPatch({request,env}){
 if(!await staff(request,env))return json({error:'Staff authentication required'},403);if(!env.DB)return json({error:'Database unavailable'},503);
 try{
  await setup(env.DB);await migrate(env.DB);const d=await request.json();if(!/^[a-f0-9-]{36}$/.test(d.id||''))failure('Invalid offer');const db=env.DB,row=await offerRow(db,d.id),old=JSON.parse(row.offer_json);
  if(!['publish','unpublish','revoke','restore'].includes(d.action)||d.revision!==undefined)checkRevision(row,d);
  if(row.revoked&&!['revoke','restore'].includes(d.action))failure('Offer withdrawn',410);
  if(row.locked&&!['unlock','publish','unpublish','revoke','restore'].includes(d.action))failure('Deal locked. An authorised member of staff must unlock it first.',423);
  let fields={},data=old,payload={},financial=false,selection=null;
  if(d.action==='edit'){
   const price=Number(d.price);if(!Number.isFinite(price)||price<=0||price>10000000)failure('Invalid price');const items=normaliseProducts(d.items,old.items||[]),ids=productSelection(old,items);data={...old,price:moneyPence(price)/100,items,selectedIds:ids,vehicleVat:typeof d.vehicleVat==='boolean'?d.vehicleVat:old.vehicleVat===true};fields.selected_json=JSON.stringify(items.flatMap((x,i)=>ids.includes(x.id)?[i]:[]));payload={before:old,after:data};financial=true;
  }else if(d.action==='customer'){
   const name=String(d.name||'').trim().slice(0,100),phone=String(d.phone||'').trim().slice(0,60),email=String(d.email||'').trim().slice(0,180);if(!name||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))failure('Invalid customer details');fields={customer_label:name,customer_phone:phone,customer_email:email};payload={before:{name:row.customer_label,phone:row.customer_phone,email:row.customer_email},after:{name,phone,email}};financial=true;
  }else if(d.action==='vehicle'){
   const allowed=['title','registration','make','model','year','mileage','fuel','gearbox','description','engine','seats','doors','colour','bodyType','serviceHistory','keys','motExpiry','roadTax','previousKeepers','cambelt','lastService','lastWork','videoUrl','photoUrls'];const vehicle=JSON.parse(row.vehicle_override||'{}'),before={...vehicle};for(const key of allowed)if(d.vehicle&&Object.hasOwn(d.vehicle,key))vehicle[key]=String(d.vehicle[key]??'').slice(0,['description','photoUrls'].includes(key)?12000:key==='videoUrl'?2000:160);validateVehicle(vehicle);if(d.vehicle&&Object.keys(d.vehicle).some(k=>!allowed.includes(k)))failure('Price and other commercial values must use the Calculator');fields.vehicle_override=JSON.stringify(vehicle);payload={before,after:vehicle};financial=true;
  }else if(d.action==='warrantyRequest'){const months=Number(d.months);if(![0,...warrantyMonths].includes(months))failure('Invalid warranty period');if(months&&(old.items||[]).some(x=>old.selectedIds?.includes(x.id)&&x.title.startsWith('Extended Warranty: ')))failure('Review the selected legacy warranty first',409);const vehicle=JSON.parse(row.vehicle_override||'{}');payload={months,status:months?'review':'none',engine:vehicle.engine||'',flags:[],vat:false,taxTreatment:'unconfirmed',taxConfirmed:false};financial=true;
  }else if(d.action==='warrantyReview'){
   const w=await warrantyState(db,row.id);if(!w||w.id!==d.requestId||!w.months)failure('Warranty request changed',409);const engine=String(d.engine||''),allowedFlags=['4x4 / AWD','Commercial Vehicle','Luxury Vehicle','Performance Vehicle','Taxi / Private Hire','Electric / Hybrid'],flags=Array.isArray(d.flags)?[...new Set(d.flags)]:[],months=Number(d.months),i=warrantyMonths.indexOf(months);if(!/^(electric|[0-8]\.[0-9])$/.test(engine)||engine!=='electric'&&(Number(engine)<0.4||Number(engine)>8)||i<0||flags.some(x=>!allowedFlags.includes(x)))failure('Select engine and warranty period');const vehicle=JSON.parse(row.vehicle_override||'{}');if(vehicle.engine&&vehicle.engine!==engine)failure('Save the correct engine in Vehicle before reviewing warranty');if(!vehicle.engine)fields.vehicle_override=JSON.stringify({...vehicle,engine});
   const special=engine==='electric'||Number(engine)>2.5||flags.length>0,retail=warrantyPrices[special?'special':'standard'][i],price=Number(d.price),taxTreatment=d.taxTreatment||'unconfirmed',taxEvidence=String(d.taxEvidence||'').trim().slice(0,1200),provider=String(d.provider||'').trim().slice(0,160);
   if(!['unconfirmed','vat20','iptIncluded','noVat'].includes(taxTreatment))failure('Invalid warranty tax treatment');const taxConfirmed=taxTreatment!=='unconfirmed'&&d.taxConfirmed===true&&taxEvidence.length>=8&&provider.length>1;
   if((taxTreatment!=='unconfirmed'||d.vat===true)&&!taxConfirmed)failure('Record the provider and tax evidence before confirming VAT or IPT');const vat=taxConfirmed&&taxTreatment==='vat20';if(!Number.isFinite(price)||price<0||price>retail)failure('Invalid warranty price');payload={months,engine,flags,category:special?'special':'standard',retail:grossAmount(retail,vat),price:grossAmount(price,vat),vat,taxTreatment,taxEvidence,provider,taxConfirmed,eligibilityConfirmed:d.eligibilityConfirmed===true,status:'acceptance'};if(!payload.eligibilityConfirmed)failure('Confirm warranty eligibility against the provider terms');financial=true;
  }else if(d.action==='partExchange'){payload=pxDetails(d.details);financial=true;
  }else if(d.action==='pxWithdraw'){const e=await db.prepare("SELECT id FROM private_offer_events WHERE offer_id=? AND kind='partExchange' ORDER BY rowid DESC LIMIT 1").bind(row.id).first();if(!e||d.pxId&&e.id!==d.pxId)failure('Part exchange details changed',409);payload={pxId:e.id};financial=true;
  }else if(d.action==='valuation'){
   const e=await db.prepare("SELECT id,payload FROM private_offer_events WHERE offer_id=? AND kind='partExchange' ORDER BY rowid DESC LIMIT 1").bind(row.id).first();if(!e||e.id!==d.pxId)failure('Part exchange details changed',409);const request=JSON.parse(e.payload),value=Number(d.value),finance=String(request.finance||'').trim().toLowerCase(),financeExists=finance==='no'?false:finance==='yes'?true:null;
   const known=financeExists===false||financeExists===true&&d.settlement!==null&&d.settlement!==undefined&&String(d.settlement).trim()!=='';const settlement=financeExists===false?0:known?Number(d.settlement):null;
   if(d.value===null||String(d.value??'').trim()===''||!Number.isFinite(value)||value<0||value>10000000||settlement!==null&&(!Number.isFinite(settlement)||settlement<0||settlement>10000000))failure('Enter a valid valuation and known settlement, or leave settlement unknown');
   const evidence=String(d.evidence||'').trim().slice(0,2000),verified=d.verified===true;if(verified&&evidence.length<8)failure('Record the evidence supporting the valuation and settlement');
   const net=known?moneyPence(value-settlement)/100:null,negativeEquityReviewed=net<0&&d.negativeEquityReviewed===true,negativeEquityExplanation=String(d.negativeEquityExplanation||'').trim().slice(0,1200);if(negativeEquityReviewed&&negativeEquityExplanation.length<8)failure('Record the separate negative equity explanation');
   payload={pxId:e.id,registration:request.registration,value:moneyPence(value)/100,settlement,financeExists,net,verified,evidence,inspectionConfirmed:d.inspectionConfirmed===true,negativeEquityReviewed,negativeEquityExplanation};financial=true;
  }else if(d.action==='publish'||d.action==='unpublish'){fields.published=d.action==='publish'?1:0;
  }else if(d.action==='revoke'){fields.revoked=1;
  }else if(d.action==='restore'){fields={revoked:0,published:0};payload={restored:true};
  }else if(d.action==='commercialStatus'){if(!['new','in_discussion','awaiting_customer','confirmed','completed','cancelled'].includes(d.status))failure('Invalid commercial status');data={...old,dealStatus:d.status};payload={before:old.dealStatus||'new',status:d.status};
  }else if(d.action==='extend'){
   let expires=null;if(d.expiresAt!==null){const date=new Date(d.expiresAt);if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now()||date.getTime()>Date.now()+366*86400000)failure('Invalid expiry');expires=date.toISOString();}fields.expires_at=expires;payload={before:row.expires_at,expiresAt:expires};
  }else if(d.action==='depositRequest'){const amount=Number(d.amount);if(!Number.isFinite(amount)||amount<0||amount>10000000)failure('Enter a valid requested deposit');data={...old,depositRequested:moneyPence(amount)/100};payload={before:old.depositRequested||0,amount:data.depositRequested};financial=true;
  }else if(d.action==='paymentRecord'){
   if(!['deposit','payment','refund'].includes(d.kind)||d.confirmed!==true||!['cash','card','bank','other'].includes(d.method)||!String(d.reference||'').trim())failure('Confirm an actual received payment or paid refund with its method and reference');const amount=Number(d.amount),amountPence=moneyPence(amount);if(!Number.isFinite(amount)||amountPence<=0||amountPence>1000000000||!/^[a-f0-9-]{36}$/.test(d.receiptId||''))failure('Enter a valid payment amount and record reference');
   const existing=await db.prepare("SELECT payload FROM private_offer_events WHERE offer_id=? AND kind='paymentRecord' AND json_extract(payload,'$.receiptId')=?").bind(row.id,d.receiptId).first();if(existing){const x=JSON.parse(existing.payload);if(x.amountPence===amountPence&&x.kind===d.kind)return json({ok:true,revision:row.revision,packageRevision:row.package_revision,duplicate:true});failure('This payment record reference has already been used',409);}
   const receivedAt=d.receivedAt?new Date(d.receivedAt):new Date();if(!Number.isFinite(receivedAt.getTime())||receivedAt.getTime()>Date.now()+60000)failure('Payment date cannot be in the future');const amounts=await offerAmounts(db,row);if(d.kind==='refund'&&amountPence>amounts.calculation.receivedPence)failure('Refund cannot exceed confirmed payments received');payload={receiptId:d.receiptId,kind:d.kind,amountPence,amount:amountPence/100,confirmed:true,method:d.method,reference:String(d.reference).trim().slice(0,200),receivedAt:receivedAt.toISOString()};financial=true;
  }else if(d.action==='note'){const message=String(d.message||'').trim().slice(0,1200);if(!message)failure('Enter a message');payload={message};
  }else if(d.action==='lock'){
   const snapshot=await finalChecks(db,row,old,d.checks),id=crypto.randomUUID(),lockedAt=new Date().toISOString();selection={id,data:{kind:'finalAgreement',reference:id.slice(0,8).toUpperCase(),...snapshot,lockedAt,checks:d.checks,confirmationRevision:old.confirmedPackageRevision}};data={...old,finalAgreementId:id,dealStatus:'completed'};fields.locked=1;payload={reference:selection.data.reference,hash:snapshot.hash,checks:d.checks};
  }else if(d.action==='unlock'){
   const reason=String(d.reason||'').trim().slice(0,1200);if(reason.length<8)failure('Record a clear reason for unlocking the final agreement');if(!row.locked)failure('This offer is already unlocked',409);data={...old,lastFinalAgreementId:old.finalAgreementId,finalAgreementId:null,dealStatus:'in_discussion'};fields.locked=0;payload={reason,previousFinalAgreementId:old.finalAgreementId};financial=true;
  }else failure('Unknown action');
  return json(await saveMutation(db,row,{fields,data,kind:d.action==='pxWithdraw'?'partExchangeWithdraw':d.action,payload,financial,selection}));
 }catch(e){return json({error:e.status?e.message:'Update failed'},e.status||500)}
}
export async function onRequestDelete({request,env}){
 if(!await staff(request,env))return json({error:'Staff authentication required'},403);if(!env.DB)return json({error:'Database unavailable'},503);
 try{await setup(env.DB);await migrate(env.DB);const d=await request.json();if(!/^[a-f0-9-]{36}$/.test(d.id||''))failure('Invalid offer');const row=await offerRow(env.DB,d.id);if(d.revision!==undefined)checkRevision(row,d);return json(await saveMutation(env.DB,row,{fields:{revoked:1},kind:'revoke'}));}catch(e){return json({error:e.status?e.message:'Unable to withdraw offer'},e.status||500)}
}

export async function onRequestOptions(){return new Response(null,{status:204})}
