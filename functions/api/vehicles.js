const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
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
const allowed=["title","registration","make","model","year","mileage","price","previousPrice","offerPrice","offerExpiry","doors","colour","bodyType","engine","seats","featured","fuel","gearbox","status","youtube","photo","photos","description","offer"];
async function schema(db){const rows=await db.prepare("PRAGMA table_info(vehicles)").all();const names=new Set((rows.results||[]).map(x=>x.name));for(const [name,type] of [["title","TEXT"],["extra_json","TEXT"]])if(!names.has(name))await db.prepare("ALTER TABLE vehicles ADD COLUMN "+name+" "+type).run()}
const columns={title:"model",registration:"registration",make:"make",model:"model",year:"year",mileage:"mileage",price:"retail_price",fuel:"fuel_type",gearbox:"transmission",status:"status",colour:"colour",bodyType:"body_type",engine:"engine_size",youtube:"youtube_url",photo:"main_image_url",description:"description",featured:"featured"};
const toRow=x=>{let y={...x};for(let [a,b] of Object.entries(columns)){if(x[b]!==undefined)y[a]=x[b]}if(x.extra_json){try{Object.assign(y,JSON.parse(x.extra_json))}catch{}}y.id=x.id;return y};
export async function onRequestGet({request,env}){
 if(!env.DB)return json({error:"Database not configured"},503);
 const url=new URL(request.url),isAdmin=url.searchParams.get("scope")==="admin";
 if(isAdmin&&!(await staff(request,env)))return json({error:"Staff API authentication is not configured or is invalid"},403);
 try{
 await schema(env.DB);
 const sql=isAdmin?"SELECT * FROM vehicles ORDER BY updated_at DESC LIMIT 500":"SELECT * FROM vehicles WHERE status='published' ORDER BY featured DESC,updated_at DESC LIMIT 100";
 const result=await env.DB.prepare(sql).all();
 return json({vehicles:(result.results||[]).map(x=>{const v=toRow(x);if(isAdmin)return v;return {id:v.id,title:v.title,make:v.make,model:v.model,year:v.year,mileage:v.mileage,price:v.price,fuel:v.fuel,gearbox:v.gearbox,description:v.description,photo:v.photo,youtube:v.youtube,featured:v.featured,status:v.status}})});
 }catch(e){return json({error:"Database query failed",detail:String(e.message||e).slice(0,140)},500)}
}
export async function onRequestPost({request,env}){
 if(!(await staff(request,env)))return json({error:"Staff authentication required. Configure ACCESS_TEAM_DOMAIN and ACCESS_AUD."},403);
 if(!env.DB)return json({error:"Database not configured"},503);
 let data;try{data=await request.json()}catch{return json({error:"Invalid JSON"},400)}
 if(!data||typeof data!=="object")return json({error:"Invalid record"},400);
 const id=typeof data.id==="string"&&/^vehicle_[a-zA-Z0-9_-]{4,90}$/.test(data.id)?data.id:"vehicle_"+crypto.randomUUID();
 const title=String(data.title||"").trim().slice(0,130),make=String(data.make||"").trim().slice(0,50),model=String(data.model||"").trim().slice(0,80);
 if(!title||!make||!model)return json({error:"Title, make and model are required"},400);
 const status=["draft","ready","published","reserved","sold"].includes(data.status)?data.status:"draft";
 const url=v=>{if(!v)return "";try{const u=new URL(v);return u.protocol==="https:"?u.href:""}catch{return ""}};
 if(data.photo&&!url(data.photo))return json({error:"Photo must be an HTTPS URL"},400);
 const extra={};for(const k of allowed)if(!(k in columns))extra[k]=typeof data[k]==="string"?data[k].slice(0,12000):data[k]??null;
 const vals=[id,String(data.registration||"").slice(0,16),make,model,Number(data.year)||null,Number(data.mileage)||null,String(data.fuel||"").slice(0,40),String(data.gearbox||"").slice(0,40),String(data.bodyType||"").slice(0,40),String(data.colour||"").slice(0,45),String(data.engine||"").slice(0,60),String(data.description||"").slice(0,12000),Number(data.price)||null,Number(data.offerPrice)||null,String(data.youtube||"").slice(0,300),url(data.photo),status,data.featured?1:0,JSON.stringify(extra),title];
 try{
 await schema(env.DB);
 await env.DB.prepare(`INSERT INTO vehicles (id,registration,make,model,year,mileage,fuel_type,transmission,body_type,colour,engine_size,description,retail_price,offer_price,youtube_url,main_image_url,status,featured,extra_json,title) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET registration=excluded.registration,make=excluded.make,model=excluded.model,year=excluded.year,mileage=excluded.mileage,fuel_type=excluded.fuel_type,transmission=excluded.transmission,body_type=excluded.body_type,colour=excluded.colour,engine_size=excluded.engine_size,description=excluded.description,retail_price=excluded.retail_price,offer_price=excluded.offer_price,youtube_url=excluded.youtube_url,main_image_url=excluded.main_image_url,status=excluded.status,featured=excluded.featured,extra_json=excluded.extra_json,title=excluded.title,updated_at=CURRENT_TIMESTAMP`).bind(...vals).run();
 return json({ok:true,id,status});
 }catch(e){return json({error:"Database write failed",detail:String(e.message||e).slice(0,160)},500)}
}
export async function onRequestDelete({request,env}){
 if(!(await staff(request,env)))return json({error:"Staff authentication required"},403);
 const id=new URL(request.url).searchParams.get("id");
 if(!id||!/^vehicle_[a-zA-Z0-9_-]{4,90}$/.test(id))return json({error:"Invalid vehicle ID"},400);
 try{await env.DB.prepare("DELETE FROM vehicles WHERE id=?").bind(id).run();return json({ok:true})}catch{return json({error:"Delete failed"},500)}
}
