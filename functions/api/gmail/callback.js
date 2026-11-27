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

const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
const enc=new TextEncoder(),dec=new TextDecoder();
const b64=a=>btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const un64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
const key=async e=>crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode(e.GMAIL_CLIENT_SECRET)), 'AES-GCM',false,['encrypt','decrypt']);
async function seal(e,t){const iv=crypto.getRandomValues(new Uint8Array(12));return b64(iv)+'.'+b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(e),enc.encode(t))))}
async function open(e,t){const [iv,data]=t.split('.');return dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(iv)},await key(e),un64(data)))}
async function exchange(e,params){const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({...params,client_id:e.GMAIL_CLIENT_ID,client_secret:e.GMAIL_CLIENT_SECRET})});if(!r.ok)throw Error('Google authorization failed. Reconnect Gmail.');return r.json()}
async function setup(e){await e.DB.prepare('CREATE TABLE IF NOT EXISTS gmail_connection (id INTEGER PRIMARY KEY, secret TEXT NOT NULL)').run()}
const redirect='https://pricelessfinance.co.uk/api/gmail/callback';
const sender='sales@pricelessautoservices.com';
export async function onRequestGet({request,env:e}){
 if(!await staff(request,e))return reply({error:'Staff authentication required'},403);
 try{const u=new URL(request.url),cookie=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)pf_gmail_state=([^;]+)/)?.[1];if(!cookie||!u.searchParams.get('state')||!u.searchParams.get('code'))return reply({error:'Authorization missing or cancelled'},400);
 const state=JSON.parse(await open(e,cookie));if(state.state!==u.searchParams.get('state')||state.exp<Date.now())return reply({error:'Authorization expired'},400);
 const t=await exchange(e,{code:u.searchParams.get('code'),grant_type:'authorization_code',redirect_uri:redirect,code_verifier:state.verifier});
 const profile=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+t.access_token}});const identity=await profile.json();if(!profile.ok||identity.email!=='pricelesscarsales1@gmail.com'||identity.email_verified!==true||!t.refresh_token)return reply({error:'Authorize the Priceless Gmail account only'},403);
 await setup(e);await e.DB.prepare('INSERT OR REPLACE INTO gmail_connection(id,secret) VALUES(1,?)').bind(await seal(e,t.refresh_token)).run();
 return new Response(null,{status:303,headers:{Location:'/admin/offers/?deal='+encodeURIComponent(state.deal),'Set-Cookie':'pf_gmail_state=; Path=/api/gmail/callback; Max-Age=0; Secure; HttpOnly; SameSite=Lax','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 }catch{return reply({error:'Gmail authorization failed. Please reconnect.'},400)}
}
export async function onRequestPost({request,env:e}){
 if(!await staff(request,e))return reply({error:'Staff authentication required'},403);
 if(request.headers.get('Origin')!=='https://pricelessfinance.co.uk')return reply({error:'Invalid origin'},403);
 try{if(!e.GMAIL_CLIENT_ID||!e.GMAIL_CLIENT_SECRET||e.GMAIL_REDIRECT_URI!==redirect)return reply({error:'Gmail configuration missing'},503);
 const d=await request.json();if(!/^[a-f0-9-]{36}$/.test(d.id||''))return reply({error:'Invalid deal'},400);
 const row=await e.DB.prepare('SELECT * FROM private_offers WHERE id=?').bind(d.id).first();
 if(!row||!row.published||row.revoked||!row.share_token||Date.parse(row.expires_at)<=Date.now())return reply({error:'Publish an active customer link first'},400);
 const email=String(row.customer_email||'').trim();if(!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email))return reply({error:'Save a valid customer email first'},400);
 await setup(e);const saved=await e.DB.prepare('SELECT secret FROM gmail_connection WHERE id=1').first();
 if(!saved||d.action==='connect'){
 const state=random(),verifier=random(),challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(verifier))));
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:e.GMAIL_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:'openid email https://www.googleapis.com/auth/gmail.send',access_type:'offline',prompt:'consent',login_hint:'pricelesscarsales1@gmail.com',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
 const cookie=await seal(e,JSON.stringify({state,verifier,deal:d.id,exp:Date.now()+600000}));
 return new Response(JSON.stringify({authorize:url.href}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':'pf_gmail_state='+cookie+'; Path=/api/gmail/callback; Max-Age=600; Secure; HttpOnly; SameSite=Lax'}});
 }
 const link='https://pricelessfinance.co.uk/offer/?token='+row.share_token;
 const body='Hi '+row.customer_label+',\r\n\r\nYour personalised vehicle offer is ready. Please use your private link below to view your offer.\r\n\r\n'+link+'\r\n\r\nKind regards,\r\nPriceless Auto Services Ltd';
 if(d.action!=='send')return reply({email,body});
 if(d.email!==email||d.body!==body)return reply({error:'Offer or recipient changed. Preview again.'},409);
 let t;try{t=await exchange(e,{refresh_token:await open(e,saved.secret),grant_type:'refresh_token'})}catch{return reply({error:'Gmail authorization expired. Reconnect Gmail.',reconnect:true},401)}
 const mime='From: Priceless Auto Services Ltd <'+sender+'>\r\nTo: '+email+'\r\nReply-To: '+sender+'\r\nSubject: Your personalised Priceless vehicle offer\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+btoa(String.fromCharCode(...enc.encode(body)));
 const sent=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+t.access_token,'Content-Type':'application/json'},body:JSON.stringify({raw:b64(enc.encode(mime))})});
 if(!sent.ok)return reply({error:'Gmail did not confirm sending. Check Gmail before retrying.'},502);
 return reply({sent:true});
 }catch{return reply({error:'Gmail operation failed. Check Gmail before retrying.'},500)}
}
