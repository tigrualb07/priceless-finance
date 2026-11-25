import {calculate, finalIssues, clone} from '../../assets/deal-engine.js';
import {DealError, assert, id, freshDeal, migrateLegacy, sourceVehicle, mutate, publicDeal} from '../lib/deal-domain.js';

const headers = {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, private', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff'};
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers});
const safeParse = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
export const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
const certCache = new Map();
async function staff(request, env) {
  try {
    const cookie = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith('CF_Authorization='));
    const token = request.headers.get('Cf-Access-Jwt-Assertion') || (cookie ? decodeURIComponent(cookie.slice(17)) : '');
    if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
    const parts = token.split('.'); if (parts.length !== 3) return null;
    const decode = s => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));
    const header = decode(parts[0]), payload = decode(parts[1]);
    const domain = String(env.ACCESS_TEAM_DOMAIN).replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!/^[a-z0-9.-]+\.cloudflareaccess\.com$/i.test(domain) || header.alg !== 'RS256' || !header.kid) return null;
    if (payload.iss !== 'https://' + domain || !payload.exp || payload.exp <= Date.now() / 1000 || payload.nbf && payload.nbf > Date.now() / 1000 + 30) return null;
    if (payload.aud !== env.ACCESS_AUD && !(Array.isArray(payload.aud) && payload.aud.includes(env.ACCESS_AUD))) return null;
    let certs = certCache.get(domain);
    if (!certs || certs.expires < Date.now() || !certs.keys.some(k => k.kid === header.kid)) {
      const r = await fetch('https://' + domain + '/cdn-cgi/access/certs'); if (!r.ok) return null;
      const jwks = await r.json(); certs = {keys: jwks.keys || [], expires: Date.now() + 300000}; certCache.set(domain, certs);
    }
    const jwk = certs.keys.find(k => k.kid === header.kid && k.kty === 'RSA'); if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
    const signature = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(parts[0] + '.' + parts[1]))) return null;
    return {subject: String(payload.email || payload.sub || 'Authenticated staff').slice(0, 180)};
  } catch { return null; }
}
export async function setup(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS private_offers (id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL, customer_label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, offer_json TEXT NOT NULL, expires_at TEXT, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  const existing = new Set(((await db.prepare('PRAGMA table_info(private_offers)').all()).results || []).map(x => x.name));
  for (const [column, definition] of [['locked', 'INTEGER NOT NULL DEFAULT 0'], ['selected_json', "TEXT NOT NULL DEFAULT '[]'"], ['customer_phone', "TEXT NOT NULL DEFAULT ''"], ['customer_email', "TEXT NOT NULL DEFAULT ''"], ['published', 'INTEGER NOT NULL DEFAULT 1'], ['vehicle_override', "TEXT NOT NULL DEFAULT '{}'"], ['share_token', 'TEXT']]) {
    if (!existing.has(column)) { try { await db.prepare('ALTER TABLE private_offers ADD COLUMN ' + column + ' ' + definition).run(); } catch (e) { const columns = (await db.prepare('PRAGMA table_info(private_offers)').all()).results || []; if (!columns.some(x => x.name === column)) throw e; } }
  }
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS private_offer_events (id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS private_offer_selections (id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, selection_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS private_offer_v2 (id TEXT PRIMARY KEY, version INTEGER NOT NULL, mutation_id TEXT NOT NULL, state_json TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS private_offer_v2_events (id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, version INTEGER NOT NULL, actor TEXT NOT NULL, staff_subject TEXT, kind TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, detail_json TEXT NOT NULL, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS private_offer_v2_snapshots (id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS private_offer_v2_backups (offer_id TEXT PRIMARY KEY, legacy_json TEXT NOT NULL, events_json TEXT NOT NULL, selections_json TEXT NOT NULL, vehicle_json TEXT NOT NULL, created_at TEXT NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS private_offer_events_offer_idx ON private_offer_events(offer_id, kind)'),
    db.prepare('CREATE INDEX IF NOT EXISTS private_offer_v2_events_offer_idx ON private_offer_v2_events(offer_id, version)'),
    db.prepare('CREATE INDEX IF NOT EXISTS private_offer_v2_snapshots_offer_idx ON private_offer_v2_snapshots(offer_id, version)')
  ]);
}
async function loadDeal(db, row) {
  if (row.v2_state) return JSON.parse(row.v2_state);
  let saved = await db.prepare('SELECT state_json FROM private_offer_v2 WHERE id=?').bind(row.id).first();
  if (saved) return JSON.parse(saved.state_json);
  const v = await db.prepare('SELECT * FROM vehicles WHERE id=?').bind(row.vehicle_id).first(); assert(v, 'Vehicle unavailable', 404);
  const events = (await db.prepare('SELECT * FROM private_offer_events WHERE offer_id=? ORDER BY rowid ASC').bind(row.id).all()).results || [];
  const selections = (await db.prepare('SELECT * FROM private_offer_selections WHERE offer_id=? ORDER BY rowid ASC').bind(row.id).all()).results || [];
  const d = migrateLegacy(row, v, events), now = new Date().toISOString();
  const statements = [
    db.prepare('INSERT OR IGNORE INTO private_offer_v2_backups(offer_id,legacy_json,events_json,selections_json,vehicle_json,created_at) VALUES(?,?,?,?,?,?)').bind(row.id, JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'v2_state'))), JSON.stringify(events), JSON.stringify(selections), JSON.stringify(v), now),
    db.prepare('INSERT OR IGNORE INTO private_offer_v2(id,version,mutation_id,state_json) VALUES(?,?,?,?)').bind(row.id, 1, id(), JSON.stringify(d))
  ];
  if (d.locked) {
    const snap = {deal: clone(d), calculation: calculate(d), legacy: true};
    statements.push(db.prepare('INSERT OR IGNORE INTO private_offer_v2_snapshots(id,offer_id,version,snapshot_json,created_at) VALUES(?,?,?,?,?)').bind(d.snapshots[0].id, row.id, 1, JSON.stringify(snap), now));
  }
  await db.batch(statements);
  saved = await db.prepare('SELECT state_json FROM private_offer_v2 WHERE id=?').bind(row.id).first();
  return JSON.parse(saved.state_json);
}
const active = d => !d.technical.revoked && d.technical.published && (!d.technical.expiresAt || Date.parse(d.technical.expiresAt) > Date.now());
async function tokenRow(db, value) {
  assert(/^[a-f0-9]{64}$/.test(value || ''), 'Offer unavailable', 404);
  const row = await db.prepare('SELECT o.*,v.state_json AS v2_state FROM private_offers o LEFT JOIN private_offer_v2 v ON v.id=o.id WHERE o.token_hash=?').bind(await digest(value)).first(); assert(row, 'Offer unavailable', 404);
  return row;
}
async function detail(db, row, d, isStaff, request) {
  const notes = (await db.prepare("SELECT id,actor,payload,created_at FROM private_offer_events WHERE offer_id=? AND kind='note' ORDER BY rowid DESC LIMIT 200").bind(d.id).all()).results || [];
  let snapshot = null;
  if (d.locked && d.snapshots.length) {
    const s = await db.prepare('SELECT snapshot_json FROM private_offer_v2_snapshots WHERE id=? AND offer_id=?').bind(d.snapshots.at(-1).id, d.id).first();
    if (s) { snapshot = JSON.parse(s.snapshot_json); if (!isStaff) snapshot.deal = publicDeal(snapshot.deal); }
  }
  const result = {deal: isStaff ? d : publicDeal(d), calculation: calculate(d), notes: notes.reverse().map(n => ({id: n.id, actor: n.actor, message: safeParse(n.payload).message || '', createdAt: n.created_at})), snapshot};
  if (isStaff) {
    result.privateUrl = row.share_token ? new URL('/offer/?token=' + row.share_token, request.url).href : null;
    result.finalIssues = finalIssues(d);
    result.activity = ((await db.prepare('SELECT id,version,actor,staff_subject,kind,before_json,after_json,detail_json,created_at FROM private_offer_v2_events WHERE offer_id=? ORDER BY version DESC LIMIT 200').bind(d.id).all()).results || []).map(e => ({id: e.id, version: e.version, actor: e.actor, staff: e.staff_subject, kind: e.kind, before: safeParse(e.before_json, null), after: safeParse(e.after_json), detail: safeParse(e.detail_json), createdAt: e.created_at}));
    result.legacyActivity = (await db.prepare('SELECT id,actor,kind,payload,created_at FROM private_offer_events WHERE offer_id=? ORDER BY rowid DESC LIMIT 200').bind(d.id).all()).results || [];
  }
  return result;
}
function compatibility(d, row, request) {
  const c = calculate(d);
  return {id: d.id, vehicle_id: d.vehicleId, customer_label: d.customer.name, customer_phone: d.customer.phone, customer_email: d.customer.email, published: d.technical.published ? 1 : 0, revoked: d.technical.revoked ? 1 : 0, locked: d.locked ? 1 : 0, expires_at: d.technical.expiresAt, created_at: d.createdAt, updated_at: d.updatedAt, vehicle_override: d.vehicle, selected: d.items.flatMap((x, i) => d.selectedIds.includes(x.id) ? [i] : []), offer_json: {price: c.vehicle.grossPence / 100, vehicleVat: d.pricing.vat, items: c.lines.map(x => ({...x, price: x.grossPence / 100, normalValue: x.originalGrossPence / 100, extraMode: x.selectionControl === 'available' ? null : x.selectionControl}))}, private_url: row.share_token ? new URL('/offer/?token=' + row.share_token, request.url).href : null, deal: d, calculation: c};
}
async function get({request, env}) {
  assert(env.DB, 'Database unavailable', 503);
  const url = new URL(request.url), isPublic = url.searchParams.has('token');
  if (isPublic) assert(/^[a-f0-9]{64}$/.test(url.searchParams.get('token') || ''), 'Offer unavailable', 404);
  const identity = isPublic ? null : await staff(request, env); assert(isPublic || identity, 'Staff authentication required', 403);
  await setup(env.DB);
  if (isPublic) {
    const row = await tokenRow(env.DB, url.searchParams.get('token')), d = await loadDeal(env.DB, row);
    assert(active(d), 'This private offer is no longer available', 410);
    return json(await detail(env.DB, row, d, false, request));
  }
  if (url.searchParams.has('id')) {
    const row = await env.DB.prepare('SELECT o.*,v.state_json AS v2_state FROM private_offers o LEFT JOIN private_offer_v2 v ON v.id=o.id WHERE o.id=?').bind(url.searchParams.get('id')).first(); assert(row, 'Offer not found', 404);
    return json(await detail(env.DB, row, await loadDeal(env.DB, row), true, request));
  }
  if (url.searchParams.get('export') === 'backup') {
    const exportData = {};
    for (const table of ['private_offers', 'private_offer_events', 'private_offer_selections', 'private_offer_v2', 'private_offer_v2_events', 'private_offer_v2_snapshots', 'private_offer_v2_backups']) exportData[table] = (await env.DB.prepare('SELECT * FROM ' + table).all()).results || [];
    return json({schemaVersion: 2, exportedAt: new Date().toISOString(), tables: exportData});
  }
  const offset = Math.max(0, Math.min(100000, Number.parseInt(url.searchParams.get('cursor') || '0', 10) || 0));
  const rows = (await env.DB.prepare('SELECT o.*,v.state_json AS v2_state FROM private_offers o LEFT JOIN private_offer_v2 v ON v.id=o.id ORDER BY o.created_at DESC,o.id DESC LIMIT 101 OFFSET ?').bind(offset).all()).results || [];
  const offers = []; let migrations = 0;
  for (const row of rows.slice(0, 100)) {
    // Bound the first migration pass to stay within the D1 free plan query budget.
    if (!row.v2_state && migrations++ >= 4) break;
    offers.push(compatibility(await loadDeal(env.DB, row), row, request));
  }
  return json({offers, nextCursor: rows.length > offers.length ? String(offset + offers.length) : null});
}
async function body(request) {
  const origin = request.headers.get('Origin');
  assert(!origin || origin === new URL(request.url).origin, 'Cross origin requests are not permitted', 403);
  assert(request.headers.get('Sec-Fetch-Site') !== 'cross-site', 'Cross site requests are not permitted', 403);
  assert((request.headers.get('content-type') || '').includes('application/json'), 'JSON is required', 415);
  const raw = await request.text(); assert(raw.length <= 250000, 'Request is too large', 413);
  let data; try { data = JSON.parse(raw); } catch { throw new DealError('Invalid JSON'); }
  assert(data && typeof data === 'object' && !Array.isArray(data), 'Invalid request'); return data;
}
async function create({request, env}) {
  const identity = await staff(request, env); assert(identity, 'Staff authentication required', 403); assert(env.DB, 'Database unavailable', 503);
  const input = await body(request); await setup(env.DB);
  const dealId = id(), t = randomToken(), now = new Date().toISOString();
  let vehicleId = input.vehicleId, v, p, items;
  const c = input.customer && typeof input.customer === 'object' ? input.customer : {name: input.customer, phone: input.phone, email: input.email};
  const statements = [];
  if (input.action === 'createCustomer' || input.action === 'create') {
    vehicleId = 'vehicle_' + id(); v = input.vehicle || {registration: input.registration, make: input.make, model: input.model, mileage: input.mileage};
    p = input.pricing;
    if (!p) { const net = Math.round(Number(input.price) * 100); p = {originalNetPence: net, offerNetPence: net, vat: input.vehicleVat === true}; }
    items = input.items || [];
    const temp = freshDeal({dealId, vehicleId, customer: c, vehicle: v, pricing: p, items});
    assert(temp.vehicle.registration && temp.vehicle.make && temp.vehicle.model, 'Registration, make and model are required');
    const gross = calculate(temp).vehicle.grossPence / 100;
    statements.push(env.DB.prepare('INSERT INTO vehicles(id,registration,make,model,mileage,retail_price,status,title,extra_json) VALUES(?,?,?,?,?,?,?,?,?)').bind(vehicleId, temp.vehicle.registration, temp.vehicle.make, temp.vehicle.model, Number(temp.vehicle.mileage) || 0, gross, 'draft', temp.vehicle.make + ' ' + temp.vehicle.model, JSON.stringify({customerDealOnly: true})));
  } else {
    const row = await env.DB.prepare('SELECT * FROM vehicles WHERE id=?').bind(String(vehicleId || '')).first(); assert(row, 'Vehicle not found', 404);
    v = sourceVehicle(row); const extra = safeParse(row.extra_json || '{}');
    const price = Number(input.price ?? extra.offerPrice ?? row.offer_price ?? row.retail_price);
    p = input.pricing || {originalNetPence: Math.round(Math.max(Number(row.retail_price) || price, price) * 100), offerNetPence: Math.round(price * 100), vat: false};
    items = (input.items || extra.dealItems || []).map(x => ({id: id(), title: x.title || x.name, description: x.description || '', type: x.type === 'offered' ? 'optional' : x.type || 'included', category: 'Other', originalNetPence: Math.round(Math.max(Number(x.normalValue ?? x.originalPrice) || 0, Number(x.price) || 0) * 100), netPence: Math.round(Number(x.price) * 100) || 0, vat: false, selectionControl: 'available'}));
  }
  const d = freshDeal({dealId, vehicleId, customer: c, vehicle: v, pricing: p, items}, now);
  if (input.action !== 'createCustomer' && input.action !== 'create') {
    const days = Number(input.days);
    assert([-1, 0, 1, 3, 7, 30].includes(days), 'Invalid expiry option');
    d.technical.expiresAt = days === -1 ? null : days === 0 ? new Date(input.expiresAt).toISOString() : new Date(Date.now() + days * 86400000).toISOString();
    assert(!d.technical.expiresAt || Date.parse(d.technical.expiresAt) > Date.now(), 'Expiry must be in the future');
    d.technical.published = true; d.stage = 'Offer Sent';
  }
  const compat = compatibility(d, {}, request);
  statements.push(
    env.DB.prepare('INSERT INTO private_offers(id,vehicle_id,customer_label,customer_phone,customer_email,token_hash,offer_json,expires_at,published,share_token,vehicle_override,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(d.id, vehicleId, d.customer.name, d.customer.phone, d.customer.email, await digest(t), JSON.stringify(compat.offer_json), d.technical.expiresAt, d.technical.published ? 1 : 0, t, JSON.stringify(d.vehicle), now, now),
    env.DB.prepare('INSERT INTO private_offer_v2(id,version,mutation_id,state_json) VALUES(?,?,?,?)').bind(d.id, 1, id(), JSON.stringify(d)),
    env.DB.prepare('INSERT INTO private_offer_v2_events(id,offer_id,version,actor,staff_subject,kind,before_json,after_json,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id(), d.id, 1, 'dealer', identity.subject, 'create', null, JSON.stringify(d), '{}', now)
  );
  await env.DB.batch(statements);
  return json({ok: true, id: d.id, vehicleId, url: new URL('/offer/?token=' + t, request.url).href, deal: d, calculation: calculate(d)}, 201);
}
async function update(context, isPublic = false, revoke = false) {
  const {request, env} = context, identity = isPublic ? null : await staff(request, env);
  assert(isPublic || identity, 'Staff authentication required', 403); assert(env.DB, 'Database unavailable', 503);
  const input = await body(request); await setup(env.DB);
  const row = isPublic ? await tokenRow(env.DB, input.token) : await env.DB.prepare('SELECT o.*,v.state_json AS v2_state FROM private_offers o LEFT JOIN private_offer_v2 v ON v.id=o.id WHERE o.id=?').bind(String(input.id || '')).first(); assert(row, 'Offer not found', 404);
  const previous = await loadDeal(env.DB, row); if (isPublic) assert(active(previous), 'This private offer is no longer available', 410);
  if (revoke) input.action = 'revoke';
  // The existing vehicle admin has idempotent publish/revoke controls without an editor version.
  if (!isPublic && input.version === undefined && ['publish', 'unpublish', 'revoke'].includes(input.action)) input.version = previous.version;
  assert(Number.isSafeInteger(input.version), 'Refresh this offer before saving. An offer version is required', 428);
  assert(input.version === previous.version, 'This offer changed. Review the latest values before saving', 409);
  const result = mutate(previous, input, isPublic ? 'customer' : 'dealer');
  const d = result.deal, mutationId = id(), state = JSON.stringify(d), eventId = id(), c = calculate(d), compat = compatibility(d, row, request);
  const statements = [
    env.DB.prepare('UPDATE private_offer_v2 SET state_json=?,version=?,mutation_id=? WHERE id=? AND version=?').bind(state, d.version, mutationId, d.id, previous.version),
    env.DB.prepare('INSERT INTO private_offer_v2_events(id,offer_id,version,actor,staff_subject,kind,before_json,after_json,detail_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM private_offer_v2 WHERE id=? AND mutation_id=?)').bind(eventId, d.id, d.version, isPublic ? 'customer' : 'dealer', identity?.subject || null, result.action, JSON.stringify(previous), state, JSON.stringify({packageChanged: result.packageChanged, message: result.message}), d.updatedAt, d.id, mutationId),
    env.DB.prepare('UPDATE private_offers SET customer_label=?,customer_phone=?,customer_email=?,offer_json=?,vehicle_override=?,selected_json=?,expires_at=?,revoked=?,published=?,locked=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM private_offer_v2 WHERE id=? AND mutation_id=?)').bind(d.customer.name, d.customer.phone, d.customer.email, JSON.stringify(compat.offer_json), JSON.stringify(d.vehicle), JSON.stringify(compat.selected), d.technical.expiresAt, d.technical.revoked ? 1 : 0, d.technical.published ? 1 : 0, d.locked ? 1 : 0, d.updatedAt, d.id, d.id, mutationId)
  ];
  if (result.message) statements.push(env.DB.prepare("INSERT INTO private_offer_events(id,offer_id,actor,kind,payload,created_at) SELECT ?,?,?,'note',?,? WHERE EXISTS(SELECT 1 FROM private_offer_v2 WHERE id=? AND mutation_id=?)").bind(eventId, d.id, isPublic ? 'customer' : 'dealer', JSON.stringify({message: result.message}), d.updatedAt, d.id, mutationId));
  if (result.action === 'confirm') statements.push(env.DB.prepare('INSERT INTO private_offer_selections(id,offer_id,selection_json,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM private_offer_v2 WHERE id=? AND mutation_id=?)').bind(eventId, d.id, JSON.stringify({packageVersion: d.packageVersion, offerVersion: d.version, selected: c.lines.filter(x => x.active).map(x => ({id: x.id, title: x.title, price: x.grossPence / 100})), vehiclePrice: c.vehicle.grossPence / 100, total: c.outstandingPence / 100}), d.updatedAt, d.id, mutationId));
  if (result.snapshot) {
    const s = d.snapshots.at(-1);
    statements.push(env.DB.prepare('INSERT INTO private_offer_v2_snapshots(id,offer_id,version,snapshot_json,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM private_offer_v2 WHERE id=? AND mutation_id=?)').bind(s.id, d.id, d.version, JSON.stringify({deal: d, calculation: c}), d.updatedAt, d.id, mutationId));
  }
  const saved = await env.DB.batch(statements);
  assert(saved[0].meta?.changes === 1, 'Another change arrived while saving. Review the latest offer', 409);
  return json({ok: true, ...await detail(env.DB, row, d, !isPublic, request)});
}
async function guarded(fn, context) {
  try { return await fn(context); } catch (e) { return json({error: e instanceof DealError ? e.message : 'The request could not be completed. Please try again.'}, e instanceof DealError ? e.status : 500); }
}
export const onRequestGet = context => guarded(get, context);
export const onRequestPost = context => guarded(create, context);
export const onRequestPatch = context => guarded(c => update(c), context);
export const onRequestPut = context => guarded(c => update(c, true), context);
export const onRequestDelete = context => guarded(c => update(c, false, true), context);
export const onRequestOptions = () => new Response(null, {status: 204, headers});
