import {calculateOffer,moneyPence,grossAmount} from '../../assets/offer-calculation.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store, private","x-robots-tag":"noindex, nofollow","referrer-policy":"no-referrer","x-content-type-options":"nosniff"}});
async function staff(request,env){
 const cookie=request.headers.get("Cookie")||"";
 const accessCookie=cookie.split(";").map(x=>x.trim()).find(x=>x.startsWith("CF_Authorization="));
 const token=request.headers.get("Cf-Access-Jwt-Assertion")||(accessCookie?decodeURIComponent(accessCookie.slice("CF_Authorization=".length)):"");
 if(!token||!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)return false;
 try{
 const parts=token.split(".");if(parts.length!==3)return false;
 const decode=s=>JSON.parse(atob(s.replace(/-/g,"+").replace(/_/g,"/")));
 const header=decode(parts[0]),payload=decode(parts[1]);
 if(header.alg!=="RS256"||!header.kid||payload.aud!==env.ACCESS_AUD&&!(Array.isArray(payload.aud)&&payload.aud.includes(env.ACCESS_AUD)))return false;
 const domain=String(env.ACCESS_TEAM_DOMAIN).replace(/^https?:\/\//,"").replace(/\/$/,"");
 if(!/^[a-z0-9.-]+\.cloudflareaccess\.com$/i.test(domain))return false;
 if(payload.iss!=="https://"+domain||!payload.exp||payload.exp<=Date.now()/1000)return false;
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

async function setup(db){await db.prepare("CREATE TABLE IF NOT EXISTS private_offers (id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL, customer_label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, offer_json TEXT NOT NULL, expires_at TEXT, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();await db.prepare("CREATE TABLE IF NOT EXISTS private_offer_events (id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();try{await db.prepare("ALTER TABLE private_offers ADD COLUMN locked INTEGER NOT NULL DEFAULT 0").run()}catch{};try{await db.prepare("ALTER TABLE private_offers ADD COLUMN selected_json TEXT NOT NULL DEFAULT '[]'").run()}catch{};await db.prepare("CREATE TABLE IF NOT EXISTS private_offer_selections (id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, selection_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run()}
const migrate=async db=>{for(const [col,definition] of [["customer_phone","TEXT NOT NULL DEFAULT ''"],["customer_email","TEXT NOT NULL DEFAULT ''"],["published","INTEGER NOT NULL DEFAULT 1"],["vehicle_override","TEXT NOT NULL DEFAULT '{}'"],["share_token","TEXT"],["revision","INTEGER NOT NULL DEFAULT 0"],["package_revision","INTEGER NOT NULL DEFAULT 0"]]){try{await db.prepare("ALTER TABLE private_offers ADD COLUMN "+col+" "+definition).run()}catch{}}};
async function pxState(db,id){const e=await db.prepare("SELECT id,payload FROM private_offer_events WHERE offer_id=? AND kind='partExchange' ORDER BY rowid DESC LIMIT 1").bind(id).first();const v=await db.prepare("SELECT id,payload FROM private_offer_events WHERE offer_id=? AND kind='valuation' ORDER BY rowid DESC LIMIT 1").bind(id).first();if(!e||!v)return null;const x=JSON.parse(v.payload);if(x.pxId!==e.id)return null;const a=await db.prepare("SELECT payload FROM private_offer_events WHERE offer_id=? AND kind='valuationDecision' ORDER BY rowid DESC LIMIT 1").bind(id).first();const decision=a?JSON.parse(a.payload):{};return {...x,id:v.id,status:decision.valuationId===v.id?decision.status:'pending'}}
const warrantyPrices={standard:[181,199,498,698],special:[271.5,298.5,747,1047]};const warrantyMonths=[3,6,12,24];async function warrantyState(db,id){const e=await db.prepare("SELECT id,kind,payload FROM private_offer_events WHERE offer_id=? AND kind IN ('warrantyRequest','warrantyReview','warrantyAccept') ORDER BY rowid DESC LIMIT 1").bind(id).first();if(!e)return null;return {...JSON.parse(e.payload),id:e.id}}const allowedDays=new Set([1,7,30]);
export async function onRequestGet({request,env}){if(!env.DB)return json({error:"Database unavailable"},503);const u=new URL(request.url);try{await setup(env.DB);await migrate(env.DB);if(u.searchParams.has('token')){const t=u.searchParams.get('token');if(!/^[a-f0-9]{64}$/.test(t||''))return json({error:"Offer unavailable"},404);let row=await env.DB.prepare("SELECT id,vehicle_id,customer_label,offer_json,expires_at,revoked,locked,selected_json,updated_at,published,vehicle_override,revision,package_revision FROM private_offers WHERE token_hash=?").bind(await digest(t)).first();if(!row||row.revoked||!row.published||row.expires_at&&Date.parse(row.expires_at)<=Date.now())return json({error:"This private offer is no longer available"},410);row=await productIdentity(env.DB,row);const v=await env.DB.prepare("SELECT * FROM vehicles WHERE id=?").bind(row.vehicle_id).first();if(!v)return json({error:"Offer unavailable"},404);const d=JSON.parse(row.offer_json);const override=JSON.parse(row.vehicle_override||'{}');return json({vehicle:{registration:v.registration,title:v.title,make:v.make,model:v.model,year:v.year,mileage:v.mileage,fuel:v.fuel_type,gearbox:v.transmission,description:v.description,youtube:v.youtube_url,photo:v.main_image_url,...override},offer:{customerName:row.customer_label,price:d.price,retailPrice:Math.max(Number(d.price)||0,Number(v.retail_price)||0),vehicleVat:d.vehicleVat===true,items:d.items||[],selectedIds:d.selectedIds||[],dealStatus:d.dealStatus||'new',migrationIssue:row.migrationIssue||null,expiresAt:row.expires_at,locked:!!row.locked,selected:JSON.parse(row.selected_json||"[]"),revision:row.revision,packageRevision:row.package_revision,valuation:await pxState(env.DB,row.id),warranty:await warrantyState(env.DB,row.id),preferences:(await env.DB.prepare("SELECT kind,payload FROM private_offer_events WHERE offer_id=? AND kind IN ('payment','partExchange') ORDER BY created_at DESC,rowid DESC LIMIT 100").bind(row.id).all()).results||[],notes:(await env.DB.prepare("SELECT actor,payload,created_at FROM private_offer_events WHERE offer_id=? AND kind='note' ORDER BY rowid ASC").bind(row.id).all()).results||[]}})}
if(!await staff(request,env))return json({error:"Staff authentication required"},403);
const rows=await env.DB.prepare("SELECT id,vehicle_id,customer_label,customer_phone,customer_email,vehicle_override,published,share_token,offer_json,expires_at,revoked,locked,selected_json,created_at,updated_at,revision,package_revision FROM private_offers ORDER BY created_at DESC LIMIT 200").all();for(let i=0;i<(rows.results||[]).length;i++)rows.results[i]=await productIdentity(env.DB,rows.results[i]);const submissions=await env.DB.prepare("SELECT id,offer_id,selection_json,created_at FROM private_offer_selections ORDER BY created_at DESC LIMIT 500").all();const focused=u.searchParams.get('offer'),before=Number(u.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(focused&&!/^[a-f0-9-]{36}$/.test(focused))return json({error:'Invalid offer'},400);const events=focused?await env.DB.prepare("SELECT rowid AS sequence,* FROM private_offer_events WHERE offer_id=? AND rowid<? ORDER BY rowid DESC LIMIT 201").bind(focused,Number.isSafeInteger(before)?before:Number.MAX_SAFE_INTEGER).all():await env.DB.prepare("SELECT rowid AS sequence,* FROM private_offer_events ORDER BY rowid DESC LIMIT 1000").all();const eventCursor=focused&&events.results.length>200?events.results[199].sequence:null;if(eventCursor)events.results=events.results.slice(0,200);return json({eventCursor,offers:(rows.results||[]).map(({share_token,...x})=>({...x,private_url:share_token?new URL("/offer/?token="+share_token,request.url).href:null,offer_json:JSON.parse(x.offer_json),selected:JSON.parse(x.selected_json||"[]"),vehicle_override:JSON.parse(x.vehicle_override||"{}")})),events:events.results||[],submissions:(submissions.results||[]).map(x=>({...x,selection:JSON.parse(x.selection_json)}))});
}catch{return json({error:"Unable to retrieve offers"},500)}}
export async function onRequestPost({request,env}){if(!await staff(request,env))return json({error:"Staff authentication required"},403);if(!env.DB)return json({error:"Database unavailable"},503);try{await setup(env.DB);await migrate(env.DB);const d=await request.json();
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
const id=crypto.randomUUID(),t=token();await env.DB.prepare("INSERT INTO private_offers(id,vehicle_id,customer_label,token_hash,offer_json,expires_at,share_token) VALUES(?,?,?,?,?,?,?)").bind(id,v.id,customer,await digest(t),JSON.stringify({price,items:cleaned,selectedIds:cleaned.filter(x=>x.extraMode==='default').map(x=>x.id),productIdentityVersion:1}),expires?expires.toISOString():null,t).run();return json({ok:true,id,url:new URL('/offer/?token='+t,request.url).href,expiresAt:expires?.toISOString()||null})}catch(e){return json({error:e.status?e.message:"Could not create offer"},e.status||500)}}
export async function onRequestCustomerMessage({request,env}){return json({error:"Unavailable"},404)}
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
async function publicRow(db,t){if(!/^[a-f0-9]{64}$/.test(t||''))failure('Invalid offer link');const found=await db.prepare('SELECT * FROM private_offers WHERE token_hash=?').bind(await digest(t)).first();if(!found||found.revoked||!found.published||found.expires_at&&Date.parse(found.expires_at)<=Date.now())failure('Offer expired or withdrawn',410);if(found.locked)failure('This offer is finalised and locked',423);return productIdentity(db,found)}
export async function onRequestPut({request,env}){
 if(!env.DB)return json({error:'Database unavailable'},503);
 try{
  await setup(env.DB);await migrate(env.DB);const d=await request.json(),row=await publicRow(env.DB,d.token);checkRevision(row,d);const db=env.DB,data=JSON.parse(row.offer_json);let payload={},financial=false,selection=null,kind=d.action,fields={},next=data;
  if(d.action==='warrantyRequest'||d.action==='warrantyAccept'){
   const w=await warrantyState(db,row.id);financial=true;
   if(d.action==='warrantyRequest'){if(![0,...warrantyMonths].includes(d.months))failure('Invalid warranty period');payload={months:d.months,status:d.months?'review':'none',category:w?.category||null,engine:w?.engine||'',flags:w?.flags||[],vat:!!w?.vat};}
   else{if(!w||w.id!==d.reviewId||w.status!=='acceptance')failure('Warranty offer changed',409);payload={...w,status:'confirmed'};}
  }else if(d.action==='valuationDecision'){
   const v=await pxState(db,row.id);if(!v||v.id!==d.valuationId||!['accepted','declined'].includes(d.status))failure('Valuation changed. Review your offer.',409);payload={valuationId:v.id,status:d.status};financial=true;
  }else if(d.action==='partExchange'){payload=pxDetails(d.details);financial=true;
  }else if(d.action==='payment'){if(!['cash','card','finance'].includes(d.method))failure('Invalid payment preference');payload={method:d.method};
  }else if(d.action==='note'){const message=String(d.message||'').trim().slice(0,1200);if(!message)failure('Enter a message');payload={message};
  }else if(!d.action||d.action==='previewSelection'||d.action==='confirm'){
   const indices=Array.isArray(d.selectedIds)?d.selectedIds.map(id=>data.items.findIndex(x=>x.id===id)):d.selected;
   if(!Array.isArray(indices)||indices.length>60||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=data.items.length||!['optional','offered'].includes(data.items[i].type)))failure('Invalid selection');
   if(indices.filter(i=>data.items[i].title.startsWith('Extended Warranty: ')).length>1)failure('Select only one extended warranty');
   const ids=selectionIds(data,indices),previous=data.selectedIds||[],selected=indices.map(i=>({...data.items[i]}));financial=JSON.stringify(ids)!==JSON.stringify(previous);next={...data,selectedIds:ids};fields.selected_json=JSON.stringify(indices);
   const valuation=await pxState(db,row.id),w=await warrantyState(db,row.id);const {total}=calculateOffer({price:data.price,items:data.items,selectedIds:ids,warranty:w,valuation});
   payload={selected,total,added:ids.filter(id=>!previous.includes(id)).map(id=>data.items.find(x=>x.id===id)?.title),removed:previous.filter(id=>!ids.includes(id)).map(id=>data.items.find(x=>x.id===id)?.title).filter(Boolean)};
   kind=d.action==='previewSelection'?'extraSelection':'selection';if(kind==='selection'){selection={id:crypto.randomUUID(),data:{selected,selectedIds:ids,vehiclePrice:data.price,total,packageRevision:row.package_revision+(financial?1:0)}};next.confirmedPackageRevision=selection.data.packageRevision;}
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
  let fields={},data=old,payload={},financial=false;
  if(d.action==='edit'){
   const price=Number(d.price);if(!Number.isFinite(price)||price<=0||price>10000000)failure('Invalid price');const items=normaliseProducts(d.items,old.items||[]),ids=productSelection(old,items);data={...old,price:moneyPence(price)/100,items,selectedIds:ids,vehicleVat:typeof d.vehicleVat==='boolean'?d.vehicleVat:old.vehicleVat===true};fields.selected_json=JSON.stringify(items.flatMap((x,i)=>ids.includes(x.id)?[i]:[]));payload={before:old,after:data};financial=true;
  }else if(d.action==='customer'){
   const name=String(d.name||'').trim().slice(0,100),phone=String(d.phone||'').trim().slice(0,60),email=String(d.email||'').trim().slice(0,180);if(!name||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))failure('Invalid customer details');fields={customer_label:name,customer_phone:phone,customer_email:email};payload={before:{name:row.customer_label,phone:row.customer_phone,email:row.customer_email},after:{name,phone,email}};financial=true;
  }else if(d.action==='vehicle'){
   const allowed=['title','registration','make','model','year','mileage','fuel','gearbox','description','engine','seats','doors','colour','bodyType','serviceHistory','keys','motExpiry','roadTax','previousKeepers','cambelt','lastService','lastWork','videoUrl','photoUrls'];const vehicle=JSON.parse(row.vehicle_override||'{}'),before={...vehicle};for(const key of allowed)if(d.vehicle&&Object.hasOwn(d.vehicle,key))vehicle[key]=String(d.vehicle[key]??'').slice(0,['description','photoUrls'].includes(key)?12000:key==='videoUrl'?2000:160);fields.vehicle_override=JSON.stringify(vehicle);payload={before,after:vehicle};financial=true;
  }else if(d.action==='warrantyReview'){
   const w=await warrantyState(db,row.id);if(!w||w.id!==d.requestId||!w.months)failure('Warranty request changed',409);const engine=String(d.engine||''),flags=Array.isArray(d.flags)?d.flags:[],months=Number(d.months),i=warrantyMonths.indexOf(months);if(!/^(electric|[0-8]\.[0-9])$/.test(engine)||i<0)failure('Select engine and warranty period');const special=engine==='electric'||Number(engine)>2.5||flags.length>0,retail=warrantyPrices[special?'special':'standard'][i],price=Number(d.price),vat=d.vat===true;if(!Number.isFinite(price)||price<0||price>retail)failure('Invalid warranty price');payload={months,engine,flags,category:special?'special':'standard',retail:grossAmount(retail,vat),price:grossAmount(price,vat),vat,status:months===w.months&&price*(vat?1.2:1)<=(w.status==='review'?warrantyPrices[w.category==='special'?'special':'standard'][i]*(w.vat?1.2:1):w.price)?'confirmed':'acceptance'};financial=true;
  }else if(d.action==='partExchange'){payload=pxDetails(d.details);financial=true;
  }else if(d.action==='valuation'){
   const e=await db.prepare("SELECT id,payload FROM private_offer_events WHERE offer_id=? AND kind='partExchange' ORDER BY rowid DESC LIMIT 1").bind(row.id).first(),value=Number(d.value),settlement=Number(d.settlement);if(!e||e.id!==d.pxId||!Number.isFinite(value)||!Number.isFinite(settlement)||value<0||settlement<0||value>10000000||settlement>10000000||d.verified!==true)failure('Confirm current PX details, valuation and settlement');payload={pxId:e.id,registration:JSON.parse(e.payload).registration,value,settlement,net:moneyPence(value-settlement)/100,verified:true};financial=true;
  }else if(d.action==='publish'||d.action==='unpublish'){fields.published=d.action==='publish'?1:0;
  }else if(d.action==='revoke'){fields.revoked=1;
  }else if(d.action==='restore'){fields={revoked:0,published:0};payload={restored:true};
  }else if(d.action==='commercialStatus'){if(!['new','in_discussion','awaiting_customer','confirmed','completed','cancelled'].includes(d.status))failure('Invalid commercial status');data={...old,dealStatus:d.status};payload={before:old.dealStatus||'new',status:d.status};
  }else if(d.action==='extend'){
   let expires=null;if(d.expiresAt!==null){const date=new Date(d.expiresAt);if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now()||date.getTime()>Date.now()+366*86400000)failure('Invalid expiry');expires=date.toISOString();}fields.expires_at=expires;payload={before:row.expires_at,expiresAt:expires};
  }else if(d.action==='note'){const message=String(d.message||'').trim().slice(0,1200);if(!message)failure('Enter a message');payload={message};
  }else if(d.action==='lock'||d.action==='unlock'){
   if(d.action==='lock'){if(old.confirmedPackageRevision!==row.package_revision)failure('Customer must confirm the latest package before finalising',409);const w=await warrantyState(db,row.id);if(w?.months&&w.status!=='confirmed')failure('Warranty review and customer acceptance required',409);}fields.locked=d.action==='lock'?1:0;
  }else failure('Unknown action');
  return json(await saveMutation(db,row,{fields,data,kind:d.action,payload,financial}));
 }catch(e){return json({error:e.status?e.message:'Update failed'},e.status||500)}
}
export async function onRequestDelete({request,env}){
 if(!await staff(request,env))return json({error:'Staff authentication required'},403);if(!env.DB)return json({error:'Database unavailable'},503);
 try{await setup(env.DB);await migrate(env.DB);const d=await request.json();if(!/^[a-f0-9-]{36}$/.test(d.id||''))failure('Invalid offer');const row=await offerRow(env.DB,d.id);if(d.revision!==undefined)checkRevision(row,d);return json(await saveMutation(env.DB,row,{fields:{revoked:1},kind:'revoke'}));}catch(e){return json({error:e.status?e.message:'Unable to withdraw offer'},e.status||500)}
}

export async function onRequestOptions(){return new Response(null,{status:204})}
