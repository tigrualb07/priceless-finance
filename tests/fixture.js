import {DatabaseSync} from 'node:sqlite';
import * as api from '../functions/api/private-offers.js';

export class D1Database {
  constructor(filename = ':memory:') {
    this.sqlite = new DatabaseSync(filename);
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS vehicles (id TEXT PRIMARY KEY, registration TEXT, make TEXT, model TEXT, year INTEGER, mileage INTEGER, fuel_type TEXT, transmission TEXT, body_type TEXT, colour TEXT, engine_size TEXT, description TEXT, retail_price REAL, offer_price REAL, youtube_url TEXT, main_image_url TEXT, status TEXT DEFAULT 'draft', featured INTEGER DEFAULT 0, extra_json TEXT DEFAULT '{}', title TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  }
  prepare(sql) {
    const stmt = () => this.sqlite.prepare(sql), database = this;
    const wrap = values => ({
      bind: (...next) => wrap(next),
      first: async () => stmt().get(...values) || null,
      all: async () => ({results: stmt().all(...values)}),
      run: async () => { const result = stmt().run(...values); return {success: true, meta: {changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid)}}; },
      _sync: () => { const result = stmt().run(...values); return {success: true, meta: {changes: Number(result.changes)}}; },
      _database: database
    });
    return wrap([]);
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(s => s._sync()); this.sqlite.exec('COMMIT'); return results; }
    catch (e) { this.sqlite.exec('ROLLBACK'); throw e; }
  }
}
let authentication;
const nativeFetch = globalThis.fetch;
async function auth() {
  if (authentication) return authentication;
  const keys = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey), kid = crypto.randomUUID();
  Object.assign(publicKey, {kid, alg: 'RS256', use: 'sig'});
  const domain = 'priceless-test.cloudflareaccess.com', aud = 'test-audience';
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const sign = async (overrides = {}, header = {}) => {
    const message = b64({alg: 'RS256', kid, ...header}) + '.' + b64({iss: 'https://' + domain, aud: [aud], exp: Math.floor(Date.now() / 1000) + 3600, nbf: Math.floor(Date.now() / 1000) - 30, email: 'staff@example.invalid', sub: 'test-staff', ...overrides});
    const signature = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(message))).toString('base64url');
    return message + '.' + signature;
  };
  globalThis.fetch = async (url, options) => String(url) === 'https://' + domain + '/cdn-cgi/access/certs' ? new Response(JSON.stringify({keys: [publicKey]}), {headers: {'content-type': 'application/json'}}) : nativeFetch(url, options);
  authentication = {jwt: await sign(), domain, aud, sign}; return authentication;
}
export async function fixture({create = true, filename} = {}) {
  const identity = await auth(), DB = new D1Database(filename), env = {DB, ACCESS_TEAM_DOMAIN: identity.domain, ACCESS_AUD: identity.aud};
  await api.setup(DB);
  const f = {DB, env, identity, deal: null, token: null, id: null};
  f.call = async (method, value, {staff = true, query = '', headers = {}} = {}) => {
    const request = new Request('https://deals.example.invalid/api/private-offers' + query, {method, headers: {'content-type': 'application/json', ...(staff ? {'Cf-Access-Jwt-Assertion': identity.jwt} : {}), ...headers}, ...(value === undefined ? {} : {body: JSON.stringify(value)})});
    const response = await api['onRequest' + method[0] + method.slice(1).toLowerCase()]({request, env});
    const data = await response.json(); if (data.deal) f.deal = data.deal; return {status: response.status, data, response};
  };
  f.send = (action, values = {}, actor = 'dealer', version) => f.call(actor === 'customer' ? 'PUT' : 'PATCH', {action, version: version ?? f.deal.version, ...(actor === 'customer' ? {token: f.token} : {id: f.id}), ...values}, {staff: actor !== 'customer'});
  f.get = (publicView = false) => f.call('GET', undefined, {staff: !publicView, query: publicView ? '?token=' + f.token : '?id=' + f.id});
  f.state = () => JSON.parse(DB.sqlite.prepare('SELECT state_json FROM private_offer_v2 WHERE id=?').get(f.id).state_json);
  if (create) {
    const result = await f.call('POST', {action: 'createCustomer', customer: {name: 'V2 Test Customer', email: 'customer@example.invalid'}, vehicle: {registration: 'TEST001', make: 'Example', model: 'Demo', mileage: '25000', engine: '2.0', fuel: 'Petrol'}, pricing: {originalNetPence: 1_200_000, offerNetPence: 1_000_000, vat: false}});
    if (result.status !== 201) throw Error('Fixture creation failed: ' + JSON.stringify(result.data));
    f.id = result.data.id; f.token = new URL(result.data.url).searchParams.get('token');
  }
  return f;
}
export const item = (overrides = {}) => ({id: crypto.randomUUID(), title: 'Test Product', description: 'Test description', category: 'Other', type: 'optional', selectionControl: 'available', originalNetPence: 20000, netPence: 15000, vat: false, protected: false, ...overrides});
export async function published() { const f = await fixture(); await f.send('publish'); return f; }
export async function pxFixture({finance = 'no', gross = 300000, settlement = 0, inspected = true, negative = false} = {}) {
  const f = await published(); await f.send('partExchange', {details: {registration: 'PXTEST', mileage: '50000', expected: '3000', finance}}, 'customer');
  await f.send('valuation', {grossPence: gross, financeExists: finance === 'yes' ? true : finance === 'no' ? false : null, settlementPence: settlement, inspected, negativeEquityReviewed: negative, sourceChecksVerified: false});
  return f;
}
