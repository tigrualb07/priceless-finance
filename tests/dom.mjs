/* Component and synchronisation checks without network access or a browser rendering engine. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import * as api from '../functions/api/private-offers.js';
import {published, item, pxFixture} from './fixture.js';
import {calculate, money} from '../assets/deal-engine.js';

const require = process.env.V2_TEST_RUNTIME ? createRequire(path.join(process.env.V2_TEST_RUNTIME, 'package.json')) : createRequire(import.meta.url);
const {JSDOM} = require('jsdom'), root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const f = await published(), a = item({title: 'Same Name'}), b = item({title: 'Same Name', netPence: 10000}), free = item({title: 'Free Valet', type: 'free', netPence: 0});
await f.send('items', {items: [a, b, free]});
async function ui(admin) {
  const route = admin ? '/admin/offers/?deal=' + f.id : '/offer/?token=' + f.token;
  const html = await readFile(path.join(root, admin ? 'admin/offers/index.html' : 'offer/index.html'), 'utf8');
  const dom = new JSDOM(html, {url: 'https://ui.example.invalid' + route, pretendToBeVisual: true}), w = dom.window, intervals = new Map(), timeouts = new Set(); let timerId = 0, pending = 0;
  w.scrollTo = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  const context = vm.createContext({document: w.document, window: w, location: w.location, history: w.history, navigator: w.navigator, Node: w.Node, URL, URLSearchParams, Intl, Date, console, crypto, Blob, FormData: w.FormData, setInterval: fn => { const id = ++timerId; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id), setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timeouts.add(id); return id; }, clearTimeout, fetch: async (url, options = {}) => {
    pending++;
    try {
      const method = options.method || 'GET';
      const req = new Request(new URL(url, w.location.href), {method, headers: {...(options.headers || {}), ...(admin ? {'Cf-Access-Jwt-Assertion': f.identity.jwt} : {})}, ...(options.body ? {body: options.body} : {})});
      return await api['onRequest' + method[0] + method.slice(1).toLowerCase()]({request: req, env: f.env});
    } finally { pending--; }
  }});
  const modules = new Map();
  async function module(file) {
    if (modules.has(file)) return modules.get(file);
    const source = new vm.SourceTextModule(await readFile(file, 'utf8'), {context, identifier: file}); modules.set(file, source);
    await source.link(specifier => module(path.resolve(path.dirname(file), specifier))); return source;
  }
  await (await module(path.join(root, admin ? 'assets/deal-admin.js' : 'assets/deal-customer.js'))).evaluate();
  const idle = async () => { for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 5)); if (!pending) return; } throw Error('Component request did not complete'); };
  return {dom, w, doc: w.document, idle, renderPrint: modules.get(path.join(root, 'assets/deal-ui.js')).namespace.renderPrint, poll: async () => { for (const fn of [...intervals.values()]) await fn(); await idle(); }, cleanup: () => { for (const id of timeouts) clearTimeout(id); intervals.clear(); w.close(); }, button: (text, parent = w.document) => { const button = [...parent.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(button, 'Missing button: ' + text); return button; }, set: (name, value) => { const node = w.document.querySelector('#editorFields [name="' + name + '"]'); assert.ok(node, 'Missing editor field ' + name); if (node.type === 'checkbox') node.checked = value; else node.value = value; node.dispatchEvent(new w.Event('input', {bubbles: true})); node.dispatchEvent(new w.Event('change', {bubbles: true})); return node; }, submit: async () => { w.document.querySelector('#editorForm').dispatchEvent(new w.Event('submit', {bubbles: true, cancelable: true})); await idle(); assert.equal(w.document.querySelector('#editorError').textContent, '', 'Editor save failed'); assert.equal(w.document.querySelector('#editor').open, false); }};
}
const admin = await ui(true), customer = await ui(false);
const parity = () => { const expected = money(calculate(f.state()).outstandingPence); for (const view of [admin, customer]) assert.equal(view.doc.querySelector('[data-testid=outstanding]').textContent, expected); };
const toggle = async id => { customer.doc.querySelector('input[data-item-id="' + id + '"]').click(); await customer.idle(); await admin.poll(); parity(); };
try {
  parity(); assert.equal(customer.doc.querySelector('#vehicleCard').textContent.includes('Personalised vehicle price'), false);
  assert.equal(/\bfalse\b/.test(customer.doc.body.textContent), false, 'Boolean leaked into visible markup');
  assert.equal(customer.doc.querySelector('details[data-key=warranty]').open, false);
  await toggle(b.id); assert.deepEqual(f.state().selectedIds, [b.id]);
  for (let i = 0; i < 3; i++) { await toggle(b.id); await toggle(b.id); }
  process.stdout.write('PASS DOM selections, duplicate names, repeated toggles and calculator parity\n');

  admin.button('Edit Vehicle Price').click(); admin.set('original', '14000'); admin.set('offer', '11000'); admin.set('vat', true); await admin.submit(); await customer.poll(); parity();
  assert.equal(f.state().pricing.offerNetPence, 1100000); assert.equal(f.state().pricing.vat, true);
  process.stdout.write('PASS DOM vehicle price editor, VAT preview and saved values\n');

  const selectedCard = admin.doc.querySelector('[data-item-id="' + b.id + '"]'); admin.button('Edit', selectedCard).click(); admin.set('title', 'Renamed Extra'); admin.set('offer', '90'); await admin.submit(); await customer.poll(); parity();
  assert.deepEqual(f.state().selectedIds, [b.id]); assert.equal(customer.doc.querySelector('input[data-item-id="' + b.id + '"]').checked, true);
  process.stdout.write('PASS DOM selected item rename and price edit preserve identity\n');

  const draft = customer.doc.querySelector('.composer textarea'); draft.value = 'Draft survives sync';
  customer.doc.querySelector('details[data-key=warranty]').open = true;
  f.deal = f.state(); await f.send('vehicle', {vehicle: {colour: 'Blue'}}); await admin.poll(); await customer.poll();
  assert.equal(draft.value, 'Draft survives sync'); assert.equal(customer.doc.querySelector('details[data-key=warranty]').open, true);
  const check = customer.doc.querySelector('[aria-label="3 Months Extended Warranty"]'); check.click(); await customer.idle(); await admin.poll(); parity();
  assert.equal(f.state().warranty.months, 3); assert.equal(customer.doc.querySelector('details[data-key=warranty]').open, true);
  process.stdout.write('PASS DOM warranty selection, disclosure preservation and unsent message preservation\n');

  admin.button('Edit Vehicle').click(); admin.set('colour', 'Draft colour'); f.deal = f.state(); await f.send('note', {message: 'Concurrent customer message'}, 'customer'); await admin.poll();
  assert.equal(admin.doc.querySelector('#editorFields [name=colour]').value, 'Draft colour'); assert.match(admin.doc.querySelector('#editorError').textContent, /changed/);
  admin.doc.querySelector('#editorForm').dispatchEvent(new admin.w.Event('submit', {bubbles: true, cancelable: true})); await admin.idle();
  assert.match(admin.doc.querySelector('#editorError').textContent, /changed/); assert.equal(f.state().vehicle.colour, 'Blue'); assert.equal(admin.doc.querySelector('#editor').open, true);
  admin.button('Cancel', admin.doc.querySelector('#editor')).click();
  process.stdout.write('PASS DOM concurrent editor conflict preserves draft and rejects stale save\n');

  await customer.poll(); customer.button('Send Message').click(); await customer.idle(); await admin.poll(); assert.equal(draft.value, ''); assert.ok(admin.doc.body.textContent.includes('Draft survives sync'));
  admin.doc.querySelector('.composer textarea').value = 'Staff reply'; admin.button('Send Message').click(); await admin.idle(); await customer.poll(); assert.ok(customer.doc.body.textContent.includes('Staff reply'));
  process.stdout.write('PASS DOM bidirectional messages and successful-save draft clearing\n');

  f.deal = f.state(); await f.send('unpublish'); await customer.poll();
  assert.equal(customer.doc.querySelector('#workspace').hidden, true);
  assert.match(customer.doc.querySelector('#notice').textContent, /no longer available/);
  const initiallyUnavailable = await ui(false);
  try {
    assert.equal(initiallyUnavailable.doc.querySelector('#workspace').hidden, true);
    f.deal = f.state(); await f.send('publish'); await customer.poll(); await initiallyUnavailable.poll(); await admin.poll();
    for (const view of [customer, initiallyUnavailable]) {
      assert.equal(view.doc.querySelector('#workspace').hidden, false, 'Republished offer should recover without reloading');
      assert.equal(view.doc.querySelector('#notice').textContent, '', 'Availability error should clear after recovery');
    }
    parity();
  } finally { initiallyUnavailable.cleanup(); }
  process.stdout.write('PASS DOM unpublish and republish recover existing and initially unavailable customer pages\n');

  admin.button('Set Deposit Requested').click(); admin.set('deposit', '200'); const before = calculate(f.state()).outstandingPence; await admin.submit(); await customer.poll(); parity(); assert.equal(calculate(f.state()).outstandingPence, before);
  admin.button('Record Payment / Refund').click(); admin.set('amount', '200'); admin.set('reference', 'SYNTHETIC'); admin.set('confirmed', true); await admin.submit(); await customer.poll(); parity(); assert.equal(calculate(f.state()).outstandingPence, before - 20000);
  process.stdout.write('PASS DOM requested deposit and confirmed payment ledger\n');

  customer.w.print = () => {}; customer.button('Print Offer / Save PDF').click(); const printed = customer.doc.querySelector('#printDocument').textContent;
  assert.ok(printed.includes('Provisional Offer')); assert.ok(printed.includes('Renamed Extra')); assert.ok(!printed.includes('Same Name')); assert.ok(printed.includes('VAT')); assert.ok(printed.includes('Outstanding Balance'));
  process.stdout.write('PASS DOM provisional print content excludes deselected products\n');

  f.deal = f.state();
  const reviewed = await f.send('warrantyReview', {months: 3, engine: '2.0', flags: [], vat: false, prices: {}, providerVerified: true, providerEvidence: 'Synthetic local test provider document', taxReviewed: true}); assert.equal(reviewed.status, 200);
  await customer.poll(); customer.button('Confirm My Selection').click(); await customer.idle(); await admin.poll();
  for (const node of [...admin.doc.querySelectorAll('[data-section=review] input[type=checkbox]')]) if (!node.checked) { const name = node.name; admin.doc.querySelector('[data-section=review] input[name="' + name + '"]').click(); await admin.idle(); }
  const finalise = admin.button('Finalise & Lock'); assert.equal(finalise.disabled, false, 'All reviewed and confirmed checks should allow finalising'); finalise.click(); await admin.idle(); await customer.poll(); parity(); assert.equal(f.state().locked, true);
  assert.equal(customer.button('Offer Finalised').disabled, true); assert.equal(customer.doc.querySelector('input[data-item-id="' + b.id + '"]').disabled, true);
  customer.button('Print Offer / Save PDF').click(); const finalText = customer.doc.querySelector('#printDocument').textContent; assert.ok(finalText.includes('Finalised Offer')); assert.ok(!finalText.includes('Same Name')); assert.ok(finalText.includes('Payments received after refunds'));
  process.stdout.write('PASS DOM final review, locked controls and snapshot-based final document content\n');

  const px = await pxFixture({finance: 'yes', settlement: 150000});
  await px.send('valuationDecision', {valuationId: px.deal.px.valuation.id, status: 'accepted'}, 'customer');
  let printData = {deal: px.state(), calculation: calculate(px.state())};
  customer.renderPrint(printData); admin.renderPrint(printData);
  const customerPrint = customer.doc.querySelector('#printDocument');
  assert.equal(customerPrint.textContent, admin.doc.querySelector('#printDocument').textContent);
  assert.ok(customerPrint.textContent.includes('Accepted net PX allowance£1,500.00'));
  assert.ok([...customerPrint.querySelectorAll('details')].every(node => node.open), 'PX vehicle details must be expanded in the printed document');
  await px.send('withdrawPX', {}, 'customer'); printData = {deal: px.state(), calculation: calculate(px.state())};
  customer.renderPrint(printData);
  assert.ok(customerPrint.textContent.includes('No PX allowance is applied to this offer.'));
  assert.ok(customerPrint.textContent.includes('Accepted net PX allowance£0.00'));
  assert.ok(!customerPrint.textContent.includes('£3,000.00'), 'Withdrawn valuation must not look like an active allowance');
  process.stdout.write('PASS DOM printed PX details, identical Admin and customer documents, and withdrawn allowance clarity\n');
} finally { admin.cleanup(); customer.cleanup(); }
