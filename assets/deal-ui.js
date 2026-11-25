import {calculate, money, decimal, VEHICLE_GROUPS, clone} from './deal-engine.js';

export {money, decimal, clone};
export const $ = id => document.getElementById(id);
export const add = (node, ...children) => node.append(...children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false));
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'text') node.textContent = value;
    else if (value !== undefined && value !== null) { if (key in node) node[key] = value; else node.setAttribute(key, String(value)); }
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
export const btn = (label, fn, cls = '', disabled = false) => h('button', {type: 'button', class: cls, disabled, onclick: fn}, label);
export const line = (label, value, cls = '') => h('div', {class: 'line ' + cls}, h('span', {}, label), h('strong', {}, value));
export const field = (label, input, cls = '') => h('label', {class: 'field ' + cls}, label, input);
export const input = (name, value = '', type = 'text', extra = {}) => h('input', {name, value: value ?? '', type, ...extra});
export function select(name, options, value = '') {
  const node = h('select', {name});
  for (const option of options) {
    const [v, label] = Array.isArray(option) ? option : [option, option];
    node.append(h('option', {value: v}, label));
  }
  if (value && ![...node.options].some(x => x.value === String(value))) node.append(h('option', {value}, value));
  node.value = value; return node;
}
export function tick(label, name, checked = false, extra = {}) {
  const node = input(name, '', 'checkbox', {checked, ...extra});
  return {node, label: h('label', {class: 'review-check'}, node, label)};
}
export function vatSwitch(name, checked = false, label = 'Add VAT (20%)') {
  const node = input(name, '', 'checkbox', {checked, role: 'switch'});
  return {node, label: h('label', {class: 'switch'}, h('span', {}, label), node, h('i', {'aria-hidden': 'true'}))};
}
export const engines = () => [['', 'Select engine'], ...Array.from({length: 77}, (_, i) => { const value = ((i + 4) / 10).toFixed(1); return [value, value + ' L']; }), ['electric', 'Electric']];
export function ukDate(value) {
  if (!value) return 'No expiry';
  const iso = /^\d{4}-\d{2}-\d{2} \d/.test(value) ? value.replace(' ', 'T') + 'Z' : value;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short'}).format(d) + ' UK' : String(value);
}
export function ukInputISO(value) {
  const target = Date.parse(value + 'Z');
  if (!Number.isFinite(target)) throw Error('Enter a valid UK expiry date and time');
  let result = target;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(result)).map(p => [p.type, p.value]));
    const shown = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
    const diff = target - shown; if (!diff) return new Date(result).toISOString(); result += diff;
  }
  throw Error('This UK local time is unavailable. Choose another time.');
}
export function notice(text, error = false) { $('notice').className = 'notice' + (error ? ' error' : ''); $('notice').textContent = text || ''; }
export class Store {
  constructor({admin = false, id, token, onChange, onUnavailable}) { Object.assign(this, {admin, id, token, onChange, onUnavailable}); this.data = null; this.busy = false; this.timer = null; this.readTimer = null; }
  get endpoint() { return '/api/private-offers?' + (this.admin ? 'id=' + encodeURIComponent(this.id) : 'token=' + encodeURIComponent(this.token)); }
  async request(url, method = 'GET', body) {
    const r = await fetch(url, {method, credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer', ...(body ? {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)} : {})});
    let d; try { d = await r.json(); } catch { throw Error('Session unavailable. Sign in again to continue.'); }
    if (!r.ok) { const error = Error(d.error || 'Request failed'); error.status = r.status; throw error; } return d;
  }
  receive(data) {
    if (this.data && data.deal.version < this.data.deal.version) return;
    this.data = data; this.onChange?.(data);
    const actor = this.admin ? 'dealer' : 'customer', other = this.admin ? 'customer' : 'dealer';
    if (!this.busy && !document.hidden && !$('editor').open && data.deal.lastMessage[other] > data.deal.readMessages[actor]) {
      clearTimeout(this.readTimer);
      this.readTimer = setTimeout(() => { if (!this.busy && !$('editor').open) this.save('markRead', {}, {silent: true}).catch(() => {}); }, 700);
    }
  }
  async load() {
    const data = await this.request(this.endpoint); this.receive(data); return data;
  }
  async save(action, values = {}, {version = this.data?.deal.version, silent = false} = {}) {
    if (this.busy) throw Error('A change is being saved. Please try again in a moment.');
    this.busy = true;
    try {
      const data = await this.request('/api/private-offers', this.admin ? 'PATCH' : 'PUT', {...(this.admin ? {id: this.id} : {token: this.token}), version, action, ...values});
      this.receive(data); if (!silent) notice('Saved successfully.'); return data;
    } catch (e) {
      if (e.status === 409 || e.status === 428) { await this.load().catch(() => {}); notice(e.message + '. Your draft is still open.', true); }
      throw e;
    } finally { this.busy = false; }
  }
  start() {
    this.stop(); this.timer = setInterval(async () => {
      if (this.busy || document.hidden) return;
      try { await this.load(); } catch (e) { if ([403, 404, 410].includes(e.status)) this.onUnavailable?.(e); else notice('Connection interrupted. Your current draft is preserved.', true); }
    }, 4000);
  }
  stop() { clearInterval(this.timer); clearTimeout(this.readTimer); }
}
let modalDraft = null;
export function editor(store, title, build, save) {
  const version = store.data?.deal.version;
  $('editorTitle').textContent = title; $('editorError').textContent = ''; $('editorFields').replaceChildren(); $('editorFields').oninput = null; $('editorFields').onchange = null;
  const controls = build($('editorFields'));
  modalDraft = {store, version};
  $('editorForm').onsubmit = async event => {
    event.preventDefault(); if (!$('editorForm').reportValidity()) return;
    $('saveEditor').disabled = true; $('editorError').textContent = '';
    try { await save(controls, version); $('editor').close(); $('editorError').textContent = ''; modalDraft = null; }
    catch (e) { $('editorError').textContent = e.message; }
    finally { $('saveEditor').disabled = false; }
  };
  $('editor').showModal();
}
function closeEditor() { $('editor').close(); modalDraft = null; }
$('closeEditor').onclick = closeEditor; $('cancelEditor').onclick = closeEditor;
window.addEventListener('beforeunload', e => { if ($('editor').open || document.querySelector('.composer textarea')?.value) { e.preventDefault(); e.returnValue = ''; } });
export function sectionUpdate(node, value, render) {
  const signature = JSON.stringify(value); if (node.dataset.signature === signature) return;
  const open = new Map([...node.querySelectorAll('details[data-key]')].map(d => [d.dataset.key, d.open]));
  const scroll = window.scrollY;
  node.replaceChildren(...[render()].flat()); node.dataset.signature = signature;
  for (const d of node.querySelectorAll('details[data-key]')) if (open.has(d.dataset.key)) d.open = open.get(d.dataset.key);
  if (Math.abs(window.scrollY - scroll) > 2) window.scrollTo({top: scroll, behavior: 'instant'});
}
export function disclosure(key, title, content, open = false) { return h('details', {open, dataset: {key}}, h('summary', {}, title), content); }
export function createLayout(store, {admin = false, onBack, onPrint} = {}) {
  const title = h('h1'), status = h('div'), sync = h('div', {class: 'sync-indicator'});
  const actions = h('div', {class: 'actions'}, admin && btn('Back to Customer Deals', onBack, 'secondary'), btn('Print Offer / Save PDF', onPrint, 'secondary'));
  const top = h('div', {class: 'toolbar'}, h('div', {}, title, status, sync), actions);
  const refs = {};
  const makeSection = key => refs[key] = h('section', {dataset: {section: key}});
  const customerCard = h('article', {class: 'pane', id: 'customerCard'}, h('h2', {}, 'Customer Card'), makeSection('customer'), admin && makeSection('technical'), makeSection('notes'));
  const composer = h('div', {class: 'composer'}), text = h('textarea', {rows: 3, maxlength: 1200, placeholder: 'Write a message…', 'aria-label': 'Message to ' + (admin ? 'customer' : 'Priceless')});
  const send = btn('Send Message', async () => { const message = text.value.trim(); if (!message) return; send.disabled = true; try { await store.save('note', {message}); text.value = ''; } catch (e) { notice(e.message, true); } finally { send.disabled = false; } });
  composer.append(text, send); add(customerCard, composer, admin && makeSection('activity'));
  const vehicleCard = h('article', {class: 'pane', id: 'vehicleCard'}, h('h2', {}, 'Vehicle Card'), makeSection('vehicle'));
  const calculatorCard = h('article', {class: 'pane calc', id: 'calculatorCard'}, h('h2', {}, 'Calculator Card'), makeSection('calculation'), makeSection('products'), makeSection('warranty'), makeSection('insurance'), makeSection('delivery'), makeSection('px'), makeSection('payments'), makeSection('preference'), makeSection('confirmation'), admin && makeSection('review'));
  const workspace = h('div', {class: 'workspace'}, customerCard, vehicleCard, calculatorCard);
  const mobile = h('div', {class: 'mobile-total'}, h('span', {}, 'Outstanding balance'), h('strong', {id: 'mobileAmount'}));
  $('workspace').replaceChildren(top, workspace, mobile); $('workspace').hidden = false; $('loading').hidden = true;
  return {...refs, title, status, sync, actions, composer: text, send, mobile};
}
export function updateHeader(refs, store) {
  const d = store.data.deal;
  refs.title.textContent = store.admin ? d.customer.name + ' · ' + (d.vehicle.title || [d.vehicle.make, d.vehicle.model].filter(Boolean).join(' ')) : 'Welcome, ' + d.customer.name.split(' ')[0] + '!';
  refs.status.replaceChildren(h('span', {class: 'status'}, d.stage), h('span', {class: 'muted'}, ' · ' + (d.technical.expiresAt ? 'Expires ' + ukDate(d.technical.expiresAt) : 'No expiry')));
  refs.sync.textContent = 'Offer ' + d.id.slice(0, 8).toUpperCase() + ' · Version ' + d.version + ' · Package ' + d.packageVersion + ' · Updated ' + ukDate(d.updatedAt);
  refs.composer.disabled = refs.send.disabled = d.locked || d.technical.revoked;
  $('mobileAmount').textContent = money(store.data.calculation.outstandingPence);
  if (modalDraft?.store === store && modalDraft.version !== d.version) $('editorError').textContent = 'This offer has changed since you opened this editor. Your draft is preserved. Close and reopen it to review the latest values before saving.';
}
export function renderCustomer(d, heading = true) {
  return h('div', {}, heading && h('h3', {}, 'Customer Information'), ...Object.entries({Name: d.customer.name, Phone: d.customer.phone, Email: d.customer.email}).filter(([, v]) => v).map(([k, v]) => line(k, v)));
}
export function renderVehicle(d) {
  const v = d.vehicle, groups = [];
  if (v.registration) groups.push(h('div', {class: 'plate'}, h('small', {}, 'UK'), v.registration));
  if (v.title) groups.push(h('h3', {}, v.title));
  for (const [name, fields] of VEHICLE_GROUPS) {
    if (['Photos & Video', 'Vehicle Description'].includes(name)) continue;
    const content = h('div', {class: 'vehicle-details'});
    for (const [key, label] of fields) {
      if (key === 'registration' || key === 'title' || v[key] == null || String(v[key]).trim() === '') continue;
      let value = String(v[key]); if (key === 'mileage') value = Number(value).toLocaleString('en-GB') + ' miles'; if (key === 'engine' && value !== 'electric') value += ' L';
      content.append(h('div', {class: 'vehicle-field'}, h('small', {}, label), h('strong', {}, value)));
    }
    if (content.children.length) groups.push(name === 'Car Info' ? content : disclosure('vehicle-' + name, name, content));
  }
  const gallery = h('div', {class: 'gallery'});
  for (const url of String(v.photoUrls || '').split(/\r?\n/).map(s => s.trim()).filter(s => /^https:\/\//i.test(s)).slice(0, 40)) gallery.append(h('img', {src: url, alt: 'Vehicle photo', loading: 'lazy', referrerPolicy: 'no-referrer'}));
  if (v.videoUrl) {
    try { const u = new URL(v.videoUrl), videoId = u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v') || u.pathname.split('/').at(-1); if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(u.hostname) && /^[\w-]{11}$/.test(videoId || '')) gallery.prepend(h('iframe', {src: 'https://www.youtube-nocookie.com/embed/' + videoId, title: 'Vehicle video', loading: 'lazy', allowFullscreen: true, referrerPolicy: 'strict-origin-when-cross-origin'})); } catch {}
  }
  if (gallery.children.length) groups.push(disclosure('vehicle-media', 'Photos & Video', gallery));
  if (v.description) groups.push(disclosure('vehicle-description', 'Vehicle Description', h('p', {style: 'white-space:pre-wrap'}, v.description)));
  return h('div', {}, groups);
}
export function renderNotes(root, notes, d, admin) {
  const actor = admin ? 'dealer' : 'customer', other = admin ? 'customer' : 'dealer', unread = Math.max(0, d.lastMessage[other] - d.readMessages[actor]);
  sectionUpdate(root, {notes, unread}, () => [h('h3', {}, 'Messages', unread ? ' · ' + unread + ' unread' : ''), h('div', {class: 'notes'}, notes.length ? notes.map(n => h('div', {class: 'bubble ' + n.actor}, h('strong', {}, n.actor === 'dealer' ? 'Priceless Auto Services' : admin ? 'Customer' : 'You'), h('p', {}, n.message), h('small', {}, ukDate(n.createdAt)))) : h('p', {class: 'empty'}, 'No messages yet.'))]);
}
export function priceLabel(x, type) {
  const saving = x.discountPence ?? x.savingsPence;
  return h('span', {class: 'price-label'}, x.originalGrossPence > x.grossPence && h('span', {class: 'old'}, money(x.originalGrossPence)), h('strong', {}, type === 'included' ? 'INCLUDED' : x.grossPence === 0 ? 'FREE' : money(x.grossPence)), saving > 0 && h('small', {class: 'saving'}, 'Save ' + money(saving)), x.vatPence > 0 && h('small', {}, money(x.netPence) + ' + ' + money(x.vatPence) + ' VAT'));
}
export function renderCalculation(d, c) {
  const root = h('div', {}, h('h3', {}, 'Your Personalised Package'), line('Original vehicle price', h('span', {class: 'old'}, money(c.originalVehicleGrossPence))), c.vehicleDiscountPence > 0 && line('Vehicle discount', money(c.vehicleDiscountPence)), line('Personalised vehicle price', money(c.vehicle.grossPence)));
  if (c.vehicle.vatPence) add(root, h('small', {}, money(c.vehicle.netPence) + ' + ' + money(c.vehicle.vatPence) + ' VAT'));
  for (const x of c.lines.filter(x => x.active)) add(root, line(x.title, priceLabel(x, x.type)));
  if (c.warranty) add(root, line(c.warranty.title, priceLabel(c.warranty)), c.warranty.estimated && h('p', {class: 'warning'}, 'Estimated warranty price. Subject to vehicle eligibility and Priceless review.'));
  add(root, line('Net purchase price', money(c.subtotalNetPence), 'totals-divider'), line('VAT', money(c.vatPence)), line('Total Purchase Price', money(c.totalPurchasePence)));
  if (c.pxAllowancePence) add(root, line('Accepted net PX allowance', '− ' + money(c.pxAllowancePence)));
  if (c.negativeEquityPence) add(root, line('Negative equity' + (c.negativeEquityAppliedPence ? ' separately agreed' : ' pending separate agreement'), money(c.negativeEquityPence)), !c.negativeEquityAppliedPence && h('small', {}, 'Not added to the amount due until reviewed and separately agreed.'));
  if (c.depositsReceivedPence) add(root, line('Deposits received', '− ' + money(c.depositsReceivedPence)));
  if (c.additionalPaymentsPence) add(root, line('Additional payments received', '− ' + money(c.additionalPaymentsPence)));
  if (c.refundsPence) add(root, line('Refunds paid', money(c.refundsPence)));
  add(root, h('div', {class: 'savings-box'}, 'YOUR TOTAL SAVINGS ' + money(c.savingsPence)), h('div', {class: 'total-box'}, h('span', {}, c.outstandingPence < 0 ? 'CREDIT BALANCE' : (c.estimated ? 'ESTIMATED ' : '') + 'OUTSTANDING BALANCE'), h('strong', {dataset: {testid: 'outstanding'}, 'data-testid': 'outstanding'}, money(c.outstandingPence)), h('small', {}, 'Deposit requested is deducted only after receipt is confirmed.')));
  return root;
}
export function renderPayments(d, c, internal = false) {
  const root = h('div', {}, h('h3', {}, 'Deposit & Payment Summary'), line('Deposit requested', money(d.depositRequestedPence)), line('Total received after refunds', money(c.totalReceivedPence)));
  for (const entry of d.payments) add(root, h('div', {class: 'payment-entry'}, h('strong', {}, ({deposit: 'Deposit received', payment: 'Additional payment', refund: 'Refund paid'})[entry.kind] + ' · ' + money(entry.amountPence)), h('small', {}, ukDate(entry.date) + ' · ' + entry.method + (internal ? ' · ' + entry.reference : ''))));
  return root;
}
export function renderPX(d, c) {
  const root = h('div', {}, h('h3', {}, 'Part Exchange'));
  if (!d.px.details || d.px.status === 'none') { add(root, h('p', {class: 'empty'}, 'Part exchange can form part of your personalised deal.')); return root; }
  const p = d.px, v = p.valuation;
  add(root, line('Vehicle', p.details.registration), line('Status', p.status));
  const detail = h('div');
  for (const [key, label] of Object.entries({make: 'Make', model: 'Model', mileage: 'Mileage', expected: 'Customer estimate', condition: 'Condition', history: 'Service History', keys: 'Number of Keys', lastService: 'Last Service', major: 'Major Repairs', timing: 'Timing System', timingWork: 'Timing Work', finance: 'Outstanding Finance', settlement: 'Customer estimated settlement'})) if (p.details[key]) detail.append(line(label, p.details[key]));
  add(root, disclosure('px-details', 'PX Vehicle Details', detail));
  if (v) {
    add(root, line(v.inspected ? 'Final valuation after inspection' : 'Provisional vehicle valuation', money(v.grossPence)), line('Confirmed finance settlement', v.financeExists === false ? money(0) : v.settlementPence === null ? 'Unknown' : money(v.settlementPence)), line('Net PX allowance', c.pxNetPence === null ? 'Awaiting confirmed settlement' : money(c.pxNetPence)));
    if (v.sourceChecksVerified) add(root, h('small', {}, 'Checked against three specialist valuation sources, including HPI.'));
    if (!v.inspected) add(root, h('p', {class: 'muted'}, 'Provisional until physical inspection and confirmation of condition, mileage, history and settlement.'));
    if (c.negativeEquityPence) add(root, h('p', {class: 'warning'}, 'Negative equity ' + money(c.negativeEquityPence) + '. Separate review and customer agreement are required.'));
  }
  return root;
}
export function pxEditor(store, save) {
  const d = store.data.deal;
  editor(store, 'Part Exchange Details', root => {
    const values = d.px.details || {}, controls = {}, grid = h('div', {class: 'grid'});
    const fields = {registration: 'Registration *', make: 'Make', model: 'Model', mileage: 'Mileage *', expected: 'Customer price estimate (£)', keys: 'Number of Keys', history: 'Service History', lastService: 'Last Service', major: 'Major Repairs', timing: 'Cambelt / Timing Chain', timingWork: 'Timing Work', condition: 'Condition', finance: 'Outstanding Finance *', settlement: 'Customer estimated settlement (£)'};
    for (const [key, label] of Object.entries(fields)) {
      const node = key === 'finance' ? select(key, [['unknown', 'Unknown'], ['no', 'No'], ['yes', 'Yes']], values[key] || 'unknown') : input(key, values[key] || '', ['mileage', 'expected', 'settlement'].includes(key) ? 'number' : 'text', {required: ['registration', 'mileage'].includes(key), min: 0, step: key === 'mileage' ? '1' : '0.01'});
      controls[key] = node; grid.append(field(label, node));
    }
    add(root, grid, h('small', {}, 'A customer estimate is not a confirmed lender settlement.'));
    return controls;
  }, async (controls, version) => { const details = Object.fromEntries(Object.entries(controls).map(([key, node]) => [key, node.value])); await save('partExchange', {details}, {version}); });
}
export function renderPrint(data) {
  const source = data.snapshot || {deal: data.deal, calculation: data.calculation}, d = source.deal, c = source.calculation;
  const root = $('printDocument'); root.replaceChildren();
  add(root, h('div', {class: 'document-brand'}, h('img', {src: '/assets/Priceless%20Auto%20Services%20Logo%20%281%29.png', alt: 'Priceless Auto Services'}), h('strong', {}, 'Priceless Auto Services Ltd')), h('h1', {class: 'print-document-title'}, d.locked ? 'Finalised Offer' : 'Provisional Offer'), h('div', {class: 'document-meta'}, 'Reference ' + d.id.slice(0, 8).toUpperCase() + ' · Offer version ' + d.version + ' · Package version ' + d.packageVersion, h('br'), 'Date ' + ukDate(d.locked ? d.updatedAt : data.deal.updatedAt) + ' · Expiry ' + ukDate(d.technical.expiresAt), h('br'), 'Status: ' + d.stage));
  const customerInfo = renderCustomer(d); customerInfo.classList.add('print-customer');
  add(root, h('section', {class: 'print-section'}, customerInfo), h('section', {class: 'print-section'}, h('h3', {}, 'Vehicle Details'), h('div', {class: 'print-vehicle-grid'}, ...VEHICLE_GROUPS.filter(([name]) => !['Photos & Video', 'Vehicle Description'].includes(name)).flatMap(([, fields]) => fields.filter(([key]) => d.vehicle[key] !== undefined && d.vehicle[key] !== '').map(([key, label]) => line(label, d.vehicle[key]))))));
  const included = c.lines.filter(x => x.active && ['included', 'free'].includes(x.type)), selected = c.lines.filter(x => x.active && !['included', 'free'].includes(x.type));
  if (included.length) add(root, h('section', {class: 'print-section'}, h('h2', {}, 'Included Benefits'), ...included.map(x => line(x.title, priceLabel(x, x.type)))));
  if (selected.length) add(root, h('section', {class: 'print-section'}, h('h2', {}, 'Selected Additional Items'), ...selected.map(x => line(x.title, priceLabel(x, x.type)))));
  if (c.warranty) add(root, h('section', {class: 'print-section'}, h('h2', {}, 'Extended Warranty'), line(c.warranty.title, priceLabel(c.warranty)), c.warranty.estimated && h('small', {}, 'Estimated. Subject to review.')));
  if (d.px.details) {
    if (['withdrawn', 'declined'].includes(d.px.status)) add(root, h('section', {class: 'print-section'}, h('h2', {}, 'Part Exchange'), line('Vehicle', d.px.details.registration), line('Status', d.px.status), h('p', {}, 'No PX allowance is applied to this offer.')));
    else { const px = renderPX(d, c); px.classList.add('print-section'); add(root, px); }
  }
  const payments = renderPayments(d, c); payments.classList.add('print-section');
  add(root, payments, h('section', {class: 'print-section print-lines'}, h('h2', {}, 'Purchase Summary'), line('Original vehicle price', money(c.originalVehicleGrossPence)), line('Vehicle discount', money(c.vehicleDiscountPence)), line('Personalised vehicle price', money(c.vehicle.grossPence)), line('Net purchase price', money(c.subtotalNetPence)), line('VAT', money(c.vatPence)), line('Total Purchase Price', money(c.totalPurchasePence)), line('Accepted net PX allowance', money(c.pxAllowancePence)), line('Separately agreed negative equity', money(c.negativeEquityAppliedPence)), line('Payments received after refunds', money(c.totalReceivedPence)), line('Total Savings', money(c.savingsPence)), line('Outstanding Balance', money(c.outstandingPence), 'print-total'), h('p', {class: 'document-meta'}, d.locked ? 'This document reproduces the saved final offer snapshot. No online payment has been processed.' : 'Provisional offer, subject to eligibility, inspection and final agreement. No online payment has been processed.')));
  for (const detail of root.querySelectorAll('details')) detail.open = true;
}
export function printOffer(store) { renderPrint(store.data); window.print(); }
