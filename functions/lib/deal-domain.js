import {SCHEMA_VERSION, WARRANTY, STAGES, REVIEW_FIELDS, VEHICLE_GROUPS, calculate, warrantyQuote, warrantyCategory, packageContent, finalIssues, integer, clone} from '../../assets/deal-engine.js';

export class DealError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const assert = (condition, message, status = 400) => { if (!condition) throw new DealError(message, status); };
const text = (v, max = 160) => String(v ?? '').trim().slice(0, max);
const amount = (v, name) => { try { return integer(v, name); } catch (e) { throw new DealError(e.message); } };
const legacyPence = v => Math.max(0, Math.min(1_000_000_000, Math.round((Number(v) || 0) * 100)));
const legacyNet = (v, vat) => Math.round(legacyPence(v) / (vat ? 1.2 : 1));
export const id = () => crypto.randomUUID();
const protectedName = title => /\b(brake|tyre|tire|safety|roadworthiness|recall|legal preparation)\b/i.test(title);

export function customer(input) {
  assert(input && typeof input === 'object', 'Enter customer details');
  const c = {name: text(input.name, 100), phone: text(input.phone, 80), email: text(input.email, 180)};
  assert(c.name, 'Customer name is required');
  assert(!c.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email), 'Enter a valid email address');
  return c;
}
export function vehicle(input = {}, previous = {}) {
  const out = {...previous};
  for (const [, fields] of VEHICLE_GROUPS) for (const [key] of fields) {
    if (Object.hasOwn(input, key)) out[key] = text(input[key], ['description', 'photoUrls'].includes(key) ? 12000 : key === 'videoUrl' ? 2000 : 160);
  }
  out.registration = text(out.registration, 16).toUpperCase();
  for (const k of ['year', 'mileage', 'seats', 'doors', 'keys', 'previousKeepers']) if (out[k] !== undefined && out[k] !== '') {
    assert(/^\d+$/.test(String(out[k])), k + ' must be a whole number');
    assert(Number(out[k]) <= (k === 'mileage' ? 10_000_000 : k === 'year' ? new Date().getUTCFullYear() + 1 : 1000), 'Invalid ' + k);
  }
  if (out.engine) { out.engine = out.engine.toLowerCase().replace(/\s*l$/i, ''); if (/^[0-8](\.\d)?$/.test(out.engine)) out.engine = Number(out.engine).toFixed(1); assert(out.engine === 'electric' || /^([0-7]\.\d|8\.0)$/.test(out.engine), 'Select a valid engine'); }
  for (const url of String(out.photoUrls || '').split(/\r?\n/).filter(Boolean)) assert(/^https:\/\//i.test(url) && validURL(url), 'Photos must use HTTPS URLs');
  if (out.videoUrl) {
    assert(validURL(out.videoUrl), 'Invalid YouTube URL');
    assert(['youtu.be', 'youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(new URL(out.videoUrl).hostname), 'Use a YouTube video URL');
  }
  return out;
}
function validURL(value) { try { return new URL(value).protocol === 'https:'; } catch { return false; } }
function pricing(input) {
  const p = {originalNetPence: amount(input.originalNetPence, 'Original vehicle price'), offerNetPence: amount(input.offerNetPence, 'Personalised vehicle price'), vat: input.vat === true};
  assert(p.offerNetPence > 0, 'Vehicle price must be greater than zero');
  assert(p.originalNetPence >= p.offerNetPence, 'Original vehicle price cannot be lower than offer price');
  return p;
}
export function normaliseItems(inputs, previous = []) {
  assert(Array.isArray(inputs) && inputs.length <= 60, 'Maximum 60 items per offer');
  const ids = new Set(), known = new Map(previous.map(i => [i.id, i]));
  const items = inputs.map(input => {
    const itemId = input.id || id();
    assert(/^[a-zA-Z0-9_-]{8,150}$/.test(itemId) && !ids.has(itemId), 'Item IDs must be unique'); ids.add(itemId);
    const old = known.get(itemId), title = text(input.title, 130);
    assert(title, 'Product name is required');
    assert(['included', 'free', 'charged', 'optional'].includes(input.type), 'Invalid item type');
    const item = {id: itemId, title, description: text(input.description, 1000), category: text(input.category || 'Other', 80), originalNetPence: amount(input.originalNetPence ?? 0, 'Original retail price'), netPence: amount(input.netPence ?? 0, 'Offer price'), vat: input.vat === true, type: input.type, selectionControl: ['required', 'default', 'available'].includes(input.selectionControl) ? input.selectionControl : 'available', protected: old?.protected === true || input.protected === true};
    if (item.protected) { item.type = ['included', 'free'].includes(item.type) ? item.type : 'charged'; item.selectionControl = 'required'; }
    if (['included', 'free'].includes(item.type)) item.netPence = 0;
    assert(item.originalNetPence >= item.netPence, 'Original price cannot be lower than offer price');
    if (old && old.netPence === item.netPence && old.originalNetPence === item.originalNetPence && old.vat === item.vat && old.type === item.type) for (const key of ['legacyGrossPence', 'legacyOriginalGrossPence']) if (old[key] !== undefined) item[key] = old[key];
    return item;
  });
  assert(previous.filter(x => x.protected).every(x => ids.has(x.id)), 'Mandatory safety or legal preparation items cannot be removed');
  return items;
}
export function freshDeal({dealId, vehicleId, customer: c, vehicle: v, pricing: p, items = []}, now = new Date().toISOString()) {
  const d = {schemaVersion: SCHEMA_VERSION, id: dealId, vehicleId, customer: customer(c), vehicle: vehicle(v), pricing: pricing(p), items: normaliseItems(items), selectedIds: [], warranty: {months: 0, flags: [], prices: {}, vat: false, reviewed: false, providerVerified: false, providerEvidence: '', taxReviewed: false}, px: {status: 'none', details: null, valuation: null, history: []}, payments: [], depositRequestedPence: 0, preferredPaymentMethod: '', confirmation: null, reviews: {}, stage: 'Draft', technical: {published: false, revoked: false, expiresAt: null}, version: 1, packageVersion: 1, locked: false, migrationIssues: [], createdAt: now, updatedAt: now, lastMessage: {customer: 0, dealer: 0}, readMessages: {customer: 0, dealer: 0}, snapshots: []};
  d.selectedIds = d.items.filter(x => x.type === 'optional' && x.selectionControl === 'default').map(x => x.id);
  return d;
}
export function sourceVehicle(v = {}) {
  let extra = {}; try { extra = JSON.parse(v.extra_json || '{}'); } catch {}
  const merged = {...v, ...extra};
  return {title: merged.title || [v.make, v.model].filter(Boolean).join(' '), registration: v.registration || '', make: v.make || '', model: v.model || '', year: String(v.year || ''), mileage: String(v.mileage ?? ''), fuel: v.fuel_type || extra.fuel || '', gearbox: v.transmission || extra.gearbox || '', engine: String(v.engine_size || extra.engine || '').replace(/\s*l$/i, '').toLowerCase(), seats: String(extra.seats || ''), doors: String(extra.doors || ''), colour: v.colour || extra.colour || '', bodyType: v.body_type || extra.bodyType || '', serviceHistory: extra.serviceHistory || '', keys: String(extra.keys || ''), motExpiry: extra.motExpiry || '', roadTax: extra.roadTax || '', previousKeepers: String(extra.previousKeepers || ''), cambelt: extra.cambelt || extra.timingWork || '', lastService: extra.lastService || '', lastWork: extra.lastWork || '', photoUrls: [v.main_image_url, ...(Array.isArray(extra.photos) ? extra.photos : String(extra.photos || '').split(/\r?\n/))].filter(Boolean).join('\n'), videoUrl: v.youtube_url || extra.youtube || '', description: v.description || extra.description || ''};
}
export function migrateLegacy(row, v, events = []) {
  const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
  const old = parse(row.offer_json, {}), vat = old.vehicleVat === true;
  const previousVehicle = {...sourceVehicle(v), ...parse(row.vehicle_override || '{}', {})};
  const items = (old.items || []).map((x, i) => ({id: 'legacy_' + row.id + '_' + i, title: text(x.title || x.name || 'Legacy item', 130), description: text(x.description || x.notes, 1000), category: 'Legacy', type: x.type === 'offered' ? 'optional' : ['included', 'free', 'charged', 'optional'].includes(x.type) ? x.type : 'included', selectionControl: {required: 'required', default: 'default'}[x.extraMode] || 'available', originalNetPence: legacyNet(Math.max(Number(x.normalValue ?? x.originalPrice) || 0, Number(x.price) || 0), x.vat), netPence: legacyNet(x.price, x.vat), vat: x.vat === true, protected: !['optional', 'offered'].includes(x.type) && protectedName(x.title || '')}));
  const d = freshDeal({dealId: row.id, vehicleId: row.vehicle_id, customer: {name: row.customer_label || 'Customer', phone: row.customer_phone, email: row.customer_email}, vehicle: {}, pricing: {originalNetPence: legacyNet(Math.max(Number(v?.retail_price) || 0, Number(old.retailPrice) || 0, Number(old.price) || 0), vat), offerNetPence: legacyNet(old.price, vat), vat}, items});
  // Keep existing data verbatim even when it predates the new editor's validation.
  d.vehicle = previousVehicle;
  d.pricing.legacyOfferGrossPence = legacyPence(old.price);
  d.pricing.legacyOriginalGrossPence = legacyPence(Math.max(Number(v?.retail_price) || 0, Number(old.retailPrice) || 0, Number(old.price) || 0));
  for (const [i, item] of d.items.entries()) {
    item.legacyGrossPence = legacyPence(old.items[i].price);
    item.legacyOriginalGrossPence = legacyPence(Math.max(Number(old.items[i].normalValue ?? old.items[i].originalPrice) || 0, Number(old.items[i].price) || 0));
  }
  d.createdAt = row.created_at; d.updatedAt = row.updated_at;
  d.technical = {published: row.published !== 0, revoked: !!row.revoked, expiresAt: row.expires_at || null};
  const selected = parse(row.selected_json || '[]', []);
  d.selectedIds = selected.filter(i => Number.isInteger(i) && items[i]?.type === 'optional').map(i => items[i].id);
  if (selected.some(i => !Number.isInteger(i) || !items[i] || items[i].type !== 'optional')) d.migrationIssues.push('Legacy selection contains an invalid index. Original selection is preserved in the backup.');
  if (items.some((x, i) => items.findIndex(y => y.title === x.title) !== i)) d.migrationIssues.push('Duplicate legacy product names: confirm current selections against the saved customer history.');
  const latest = kind => [...events].reverse().find(x => kind.includes(x.kind));
  const payload = event => parse(event?.payload || '{}', {});
  const wr = latest(['warrantyRequest', 'warrantyReview', 'warrantyAccept']), w = payload(wr);
  if (WARRANTY.months.includes(w.months)) {
    d.warranty.months = w.months; d.warranty.flags = (w.flags || []).filter(x => WARRANTY.flags.includes(x)); d.warranty.vat = w.vat === true;
    if (w.engine) d.vehicle.engine = w.engine;
    if (w.status !== 'review' && Number.isFinite(w.price)) d.warranty.prices[w.months] = {originalNetPence: legacyNet(w.retail || w.price, w.vat), netPence: legacyNet(w.price, w.vat), free: w.price === 0};
    d.migrationIssues.push('Legacy warranty requires provider and tax verification.');
  }
  const warrantyItems = items.filter(x => /^Extended Warranty: /i.test(x.title) && d.selectedIds.includes(x.id));
  if (warrantyItems.length) d.migrationIssues.push('Legacy warranty sold as an item: review before selecting a separate extended warranty.');
  const pxEvent = latest(['partExchange']);
  if (pxEvent) {
    d.px.details = payload(pxEvent); d.px.status = 'requested';
    const valuationEvent = latest(['valuation']), val = payload(valuationEvent);
    if (val.pxId === pxEvent.id) {
      const financeExists = /^no$/i.test(d.px.details.finance || '') ? false : /^yes$/i.test(d.px.details.finance || '') ? true : null;
      d.px.valuation = {id: valuationEvent.id, version: 1, grossPence: legacyPence(val.value), financeExists, settlementPence: financeExists === false ? 0 : val.settlement == null || val.settlement === '' ? null : legacyPence(val.settlement), inspected: false, provisional: true, sourceChecksVerified: val.verified === true, negativeEquityReviewed: false, negativeEquityCustomerAgreed: false};
      d.px.history.push(clone(d.px.valuation));
      const decision = payload(latest(['valuationDecision']));
      if (decision.valuationId === valuationEvent.id && ['accepted', 'declined'].includes(decision.status)) d.px.status = decision.status;
      if (financeExists !== false && (!val.settlement || val.settlement === '0')) { d.px.valuation.settlementPence = null; d.px.status = 'pending'; d.migrationIssues.push('Legacy PX settlement is unverified. Confirm the lender settlement.'); }
    }
  }
  d.preferredPaymentMethod = payload(latest(['payment'])).method || '';
  d.lastMessage.customer = events.filter(x => x.kind === 'note' && x.actor === 'customer').length;
  d.lastMessage.dealer = events.filter(x => x.kind === 'note' && x.actor !== 'customer').length;
  d.stage = d.technical.published ? 'Offer Sent' : 'Draft';
  // An old lock remains enforced. Its historical snapshot is kept with migration review warnings.
  d.locked = !!row.locked;
  if (d.locked) { d.stage = 'Finalised & Locked'; d.snapshots = [{id: 'legacy_' + row.id, version: 1, createdAt: d.updatedAt, legacy: true}]; }
  return d;
}
const PUBLIC_FIELDS = {
  selection: ['selectedIds'], previewSelection: ['selectedIds'], confirm: [], warrantySelect: ['months'], warrantyRequest: ['months'],
  partExchange: ['details'], valuationDecision: ['valuationId', 'status'], withdrawPX: [], negativeEquityAgreement: ['valuationId', 'agreed'],
  payment: ['method'], note: ['message'], markRead: []
};
function pxDetails(input) {
  assert(input && typeof input === 'object', 'Enter PX details');
  const out = {};
  for (const k of ['registration', 'make', 'model', 'mileage', 'expected', 'keys', 'history', 'lastService', 'major', 'timing', 'timingWork', 'condition', 'finance', 'settlement']) out[k] = text(input[k], 1000);
  assert(out.registration && /^\d+$/.test(out.mileage), 'PX registration and mileage are required');
  assert(['yes', 'no', 'unknown'].includes(out.finance), 'State whether PX has outstanding finance');
  if (out.expected) assert(/^\d+(\.\d{1,2})?$/.test(out.expected), 'Invalid customer PX estimate');
  if (out.settlement) assert(/^\d+(\.\d{1,2})?$/.test(out.settlement), 'Invalid estimated settlement');
  return out;
}
export function mutate(previous, input, actor, now = new Date().toISOString()) {
  const d = clone(previous), action = input.action || 'confirm', isStaff = actor === 'dealer';
  assert(isStaff || Object.hasOwn(PUBLIC_FIELDS, action), 'Customer action is not permitted', 403);
  if (!isStaff) for (const key of Object.keys(input)) assert(['token', 'version', 'action', ...(PUBLIC_FIELDS[action] || [])].includes(key), 'Customer cannot change ' + key, 400);
  const permittedLocked = isStaff ? ['unlock', 'unpublish', 'publish', 'revoke', 'markRead', 'stage'] : ['markRead'];
  assert(!d.locked || permittedLocked.includes(action), 'This deal is finalised and locked', 423);
  assert(!d.technical.revoked || action === 'markRead', 'This link has been revoked', 410);
  const oldPackage = packageContent(d), oldQuote = warrantyQuote(d), oldConfirmation = clone(d.confirmation);
  let preserveWarrantyConfirmation = false, snapshot = false;
  switch (action) {
    case 'customer': d.customer = customer(input.customer || {name: input.name, phone: input.phone, email: input.email}); break;
    case 'vehicle': {
      const category = warrantyCategory(d), oldEngine = d.vehicle.engine, oldFuel = d.vehicle.fuel;
      d.vehicle = vehicle(input.vehicle, d.vehicle);
      if (category !== warrantyCategory(d)) d.warranty.prices = {};
      if (oldEngine !== d.vehicle.engine || oldFuel !== d.vehicle.fuel) { d.warranty.reviewed = false; d.warranty.providerVerified = false; d.warranty.taxReviewed = false; }
      break;
    }
    case 'pricing': d.pricing = pricing(input.pricing); break;
    case 'items': {
      const old = d.items; d.items = normaliseItems(input.items, old);
      d.selectedIds = d.items.filter(x => x.type === 'optional' && (old.some(y => y.id === x.id) ? d.selectedIds.includes(x.id) : x.selectionControl === 'default')).map(x => x.id);
      break;
    }
    case 'selection': case 'previewSelection': {
      const ids = input.selectedIds;
      assert(Array.isArray(ids) && ids.length <= 60 && new Set(ids).size === ids.length && ids.every(i => d.items.some(x => x.id === i && x.type === 'optional' && !x.protected)), 'Invalid optional item selection');
      d.selectedIds = [...ids]; break;
    }
    case 'warrantySelect': case 'warrantyRequest': {
      assert([0, ...WARRANTY.months].includes(input.months), 'Invalid warranty period');
      assert(!input.months || !d.items.some(x => /^Extended Warranty: /i.test(x.title) && (x.type !== 'optional' || d.selectedIds.includes(x.id))), 'Review the existing warranty item first');
      if (d.warranty.months !== input.months) { d.warranty.months = input.months; d.warranty.reviewed = false; d.reviews.warranty = false; }
      break;
    }
    case 'warrantyReview': {
      assert(WARRANTY.months.includes(input.months), 'Select a warranty period');
      const oldCategory = warrantyCategory(d), oldEngine = d.vehicle.engine;
      d.vehicle = vehicle({engine: input.engine}, d.vehicle); assert(d.vehicle.engine, 'Engine is required');
      assert(Array.isArray(input.flags) && input.flags.every(x => WARRANTY.flags.includes(x)), 'Invalid warranty vehicle category');
      d.warranty.flags = [...new Set(input.flags)]; d.warranty.vat = input.vat === true; d.warranty.months = input.months;
      if (oldCategory !== warrantyCategory(d)) d.warranty.prices = {};
      const prices = input.prices || {};
      for (const m of WARRANTY.months) if (prices[m]) {
        const p = prices[m];
        const originalNetPence = amount(p.originalNetPence, 'Warranty retail price'), netPence = amount(p.free ? 0 : p.netPence, 'Warranty price');
        assert(netPence <= originalNetPence, 'Warranty price cannot exceed retail price');
        d.warranty.prices[m] = {originalNetPence, netPence, free: p.free === true};
      }
      d.warranty.providerEvidence = text(input.providerEvidence, 1000);
      d.warranty.providerVerified = input.providerVerified === true && !!d.warranty.providerEvidence;
      d.warranty.taxReviewed = input.taxReviewed === true;
      d.warranty.reviewed = d.warranty.providerVerified && d.warranty.taxReviewed;
      d.reviews.warranty = d.warranty.reviewed;
      const quote = warrantyQuote(d);
      preserveWarrantyConfirmation = oldEngine === d.vehicle.engine && oldCategory === warrantyCategory(d) && oldQuote && oldQuote.months === quote.months && quote.grossPence <= oldQuote.grossPence;
      break;
    }
    case 'partExchange': {
      if (d.px.valuation) d.px.history.push({...clone(d.px.valuation), decision: d.px.status, supersededAt: now});
      d.px.details = pxDetails(input.details); d.px.status = 'requested'; d.px.valuation = null; break;
    }
    case 'valuation': {
      assert(d.px.details, 'Enter PX vehicle details first');
      assert([true, false, null].includes(input.financeExists), 'Confirm whether outstanding finance exists');
      const val = {id: id(), version: (d.px.valuation?.version || d.px.history.length || 0) + 1, grossPence: amount(input.grossPence, 'PX valuation'), financeExists: input.financeExists, settlementPence: input.financeExists === false ? 0 : input.settlementPence === null || input.settlementPence === undefined ? null : amount(input.settlementPence, 'Confirmed settlement'), inspected: input.inspected === true, provisional: input.inspected !== true, sourceChecksVerified: input.sourceChecksVerified === true, negativeEquityReviewed: input.negativeEquityReviewed === true, negativeEquityCustomerAgreed: false, createdAt: now};
      if (d.px.details.finance === 'yes') assert(val.financeExists !== false, 'PX has outstanding finance. Confirm settlement or leave it unknown');
      if (d.px.valuation) d.px.history.push({...clone(d.px.valuation), decision: d.px.status, supersededAt: now});
      d.px.valuation = val; d.px.status = 'pending'; d.reviews.px = false; break;
    }
    case 'valuationDecision': {
      assert(d.px.valuation?.id === input.valuationId, 'Valuation changed. Review the latest value', 409);
      assert(['accepted', 'declined'].includes(input.status), 'Invalid valuation decision');
      assert(input.status === 'declined' || calculate(d).pxNetPence !== null, 'Confirmed lender settlement is required before accepting');
      d.px.status = input.status; d.px.history.push({...clone(d.px.valuation), decision: input.status, decidedAt: now}); break;
    }
    case 'withdrawPX': d.px.status = 'withdrawn'; if (d.px.valuation) d.px.history.push({...clone(d.px.valuation), decision: 'withdrawn', decidedAt: now}); break;
    case 'negativeEquityAgreement':
      assert(!isStaff, 'Separate agreement must come from the customer', 403);
      assert(d.px.valuation?.id === input.valuationId && d.px.status === 'accepted' && d.px.valuation.negativeEquityReviewed && calculate(d).negativeEquityPence > 0, 'Negative equity must be reviewed against the latest accepted valuation');
      d.px.valuation.negativeEquityCustomerAgreed = input.agreed === true; break;
    case 'depositRequested': d.depositRequestedPence = amount(input.amountPence, 'Deposit requested'); d.reviews.payments = false; break;
    case 'paymentEntry': {
      assert(['deposit', 'payment', 'refund'].includes(input.kind), 'Invalid payment entry');
      const value = amount(input.amountPence, 'Payment amount'); assert(value > 0, 'Payment amount must be positive');
      assert(input.confirmed === true, 'Confirm receipt or refund before recording a payment');
      assert(input.method && text(input.reference, 160), 'Payment method and reference are required');
      assert(Number.isFinite(Date.parse(input.date)) && Date.parse(input.date) <= Date.now() + 86400000, 'Enter a valid payment date');
      if (input.kind === 'refund') assert(value <= calculate(d).totalReceivedPence, 'Refund cannot exceed net receipts');
      d.payments.push({id: id(), kind: input.kind, amountPence: value, date: input.date, method: text(input.method, 80), reference: text(input.reference, 160), confirmed: true, recordedAt: now}); d.reviews.payments = false; break;
    }
    case 'payment': assert(['cash', 'card', 'finance', 'bank'].includes(input.method), 'Invalid payment preference'); if (d.preferredPaymentMethod !== input.method) d.reviews.payments = false; d.preferredPaymentMethod = input.method; break;
    case 'note': {
      const message = text(input.message, 1200); assert(message, 'Enter a message');
      d.lastMessage[actor]++; break;
    }
    case 'markRead': d.readMessages[actor] = d.lastMessage[actor === 'dealer' ? 'customer' : 'dealer']; break;
    case 'publish': d.technical.published = true; if (d.stage === 'Draft') d.stage = 'Offer Sent'; break;
    case 'unpublish': d.technical.published = false; break;
    case 'revoke': d.technical.revoked = true; d.stage = 'Cancelled'; break;
    case 'extend': {
      const expiry = input.expiresAt;
      assert(expiry === null || Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) > Date.now() && Date.parse(expiry) <= Date.now() + 366 * 86400000, 'Expiry must be in the next 366 days');
      d.technical.expiresAt = expiry === null ? null : new Date(expiry).toISOString(); break;
    }
    case 'stage':
      assert(STAGES.includes(input.stage), 'Invalid deal status');
      assert(input.stage !== 'Finalised & Locked', 'Use Final Deal Review to lock');
      assert(!['Completed', 'Finalised & Locked'].includes(input.stage) || d.locked, 'Finalise before completing');
      assert(!d.locked || ['Completed', 'Finalised & Locked'].includes(input.stage), 'Unlock before changing negotiation stage', 423);
      assert(input.stage !== 'Customer Confirmed' || d.confirmation?.packageVersion === d.packageVersion, 'Latest customer confirmation required');
      d.stage = input.stage; break;
    case 'review':
      assert(input.reviews && Object.keys(input.reviews).every(k => Object.hasOwn(REVIEW_FIELDS, k)), 'Invalid review checks');
      for (const [key, value] of Object.entries(input.reviews)) d.reviews[key] = value === true;
      break;
    case 'resolveMigration': assert(input.reviewed === true, 'Confirm review of preserved legacy data'); d.migrationIssues = []; break;
    case 'confirm': assert(!isStaff, 'Only the customer can confirm their selection', 403); break;
    case 'lock': {
      const issues = finalIssues(d); assert(!issues.length, issues.join('. '), 409);
      d.locked = true; d.stage = 'Finalised & Locked'; snapshot = true; break;
    }
    case 'unlock': assert(text(input.reason, 500), 'Record the reason for unlocking'); d.locked = false; d.stage = 'Negotiation in Progress'; d.confirmation = null; d.reviews = {}; break;
    default: throw new DealError('Unknown action');
  }
  const packageChanged = oldPackage !== packageContent(d);
  if (packageChanged) {
    d.packageVersion++; d.confirmation = null; d.reviews = {...d.reviews, customer: false, vehicle: false, prices: false, vat: false, px: false};
    if (preserveWarrantyConfirmation && oldConfirmation?.packageVersion === previous.packageVersion) d.confirmation = {...oldConfirmation, packageVersion: d.packageVersion, carriedFrom: oldConfirmation.packageVersion, carryReason: 'Same warranty period at an unchanged or lower price', carriedAt: now};
    d.stage = d.confirmation ? 'Customer Confirmed' : isStaff ? 'Awaiting Customer Confirmation' : 'Negotiation in Progress';
  }
  d.version++; d.updatedAt = now;
  if (action === 'confirm') { d.confirmation = {packageVersion: d.packageVersion, offerVersion: d.version, at: now, actor: 'customer', totalPurchasePence: calculate(d).totalPurchasePence}; d.stage = 'Customer Confirmed'; }
  if (snapshot) d.snapshots.push({id: id(), version: d.version, packageVersion: d.packageVersion, createdAt: now});
  return {deal: d, action, snapshot, packageChanged, message: action === 'note' ? text(input.message, 1200) : null};
}

export function publicDeal(d) {
  const out = clone(d);
  delete out.reviews; delete out.migrationIssues; delete out.vehicleId;
  delete out.warranty.providerEvidence;
  // Customer needs the current PX proposal, not internal valuation or activity history.
  out.px.history = [];
  out.payments = out.payments.map(({id, kind, amountPence, date, method, confirmed}) => ({id, kind, amountPence, date, method, confirmed}));
  return out;
}
