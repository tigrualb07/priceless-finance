import {DatabaseSync} from 'node:sqlite';
import * as api from '../functions/api/private-offers.js';

let identity;
async function staffIdentity() {
  if (identity) return identity;
  const keys = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256'}, true, ['sign','verify']);
  const jwk = {...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'synthetic-test-only'};
  const encode = object => Buffer.from(JSON.stringify(object)).toString('base64url');
  const prefix = encode({alg: 'RS256', kid: jwk.kid}) + '.' + encode({iss: 'https://original-tests.cloudflareaccess.com', aud: ['synthetic-staff'], email: 'staff@example.invalid', exp: Math.floor(Date.now()/1000)+3600});
  const signed = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(prefix));
  identity = {jwt: prefix + '.' + Buffer.from(signed).toString('base64url'), jwk};
  return identity;
}
export async function fixture() {
  const identity = await staffIdentity(), database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE vehicles(id TEXT PRIMARY KEY,registration TEXT,make TEXT,model TEXT,year INTEGER,mileage INTEGER,fuel_type TEXT,transmission TEXT,body_type TEXT,colour TEXT,engine_size TEXT,description TEXT,retail_price REAL,offer_price REAL,youtube_url TEXT,main_image_url TEXT,status TEXT DEFAULT 'draft',featured INTEGER DEFAULT 0,extra_json TEXT DEFAULT '{}',title TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  class Statement {
    constructor(sql, values = []) { this.sql=sql; this.values=values; }
    bind(...values) { return new Statement(this.sql, values); }
    async run() { const r=database.prepare(this.sql).run(...this.values); return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}; }
    async all() { return {success:true,results:database.prepare(this.sql).all(...this.values)}; }
    async first() { return database.prepare(this.sql).get(...this.values) || null; }
  }
  const DB = {prepare: sql => new Statement(sql), batch: async statements => {database.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());database.exec('COMMIT');return out;}catch(error){database.exec('ROLLBACK');throw error;}}};
  const env={DB,ACCESS_TEAM_DOMAIN:'original-tests.cloudflareaccess.com',ACCESS_AUD:'synthetic-staff'};
  const request=async(method,body,staff=true,query='')=>{
    if(body&&['PATCH','PUT','DELETE'].includes(method)&&body.revision===undefined){const r=database.prepare('SELECT revision FROM private_offers WHERE id=?').get(body.id||id);body={...body,revision:r?.revision};}
    const previous=globalThis.fetch;
    globalThis.fetch=async url=>{if(String(url)!=='https://original-tests.cloudflareaccess.com/cdn-cgi/access/certs')throw Error('Unexpected test network request');return Response.json({keys:[identity.jwk]});};
    try {
      const headers={...(staff?{'Cf-Access-Jwt-Assertion':identity.jwt}:{}),...(body?{'content-type':'application/json'}:{})};
      const response=await api['onRequest'+method[0]+method.slice(1).toLowerCase()]({request:new Request('https://example.invalid/api/private-offers'+query,{method,headers,...(body?{body:JSON.stringify(body)}:{})}),env});
      return {status:response.status,data:await response.json()};
    } finally {globalThis.fetch=previous;}
  };
  const created=await request('POST',{action:'createCustomer',customer:'SYNTHETIC TEST CUSTOMER',registration:'TEST001',make:'Example',model:'Original test',mileage:25000,price:10000,vehicleVat:false});
  if(created.status!==201&&created.status!==200)throw Error(JSON.stringify(created));
  const id=created.data.id, token=new URL(created.data.url).searchParams.get('token');
  return {id,token,database,env,request,row:()=>{const row=database.prepare('SELECT * FROM private_offers WHERE id=?').get(id);return {...row,offer_json:JSON.parse(row.offer_json),selected:JSON.parse(row.selected_json)};},patch:(action,more={})=>request('PATCH',{id,action,...more}),public:()=>request('GET',undefined,false,'?token='+token),close:()=>database.close()};
}
