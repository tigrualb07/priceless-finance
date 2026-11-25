import {WARRANTY, STAGES, REVIEW_FIELDS, VEHICLE_GROUPS, calculate, warrantyQuote, warrantyCategory, pence} from './deal-engine.js';
import {$, h, btn, line, field, input, select, tick, vatSwitch, engines, money, decimal, ukDate, ukInputISO, notice, Store, editor, sectionUpdate, disclosure, createLayout, updateHeader, renderCustomer, renderVehicle, renderNotes, renderCalculation, renderPayments, renderPX, pxEditor, priceLabel, printOffer, clone} from './deal-ui.js';

let store, refs, listTimer, listData = [], cursor = null;
const params = new URLSearchParams(location.search), vehicleFilter = params.get('vehicle');
const safe = fn => async (...args) => { try { await fn(...args); } catch (e) { notice(e.message, true); } };
const unlocked = () => !store.data.deal.locked && !store.data.deal.technical.revoked;
const save = (...args) => store.save(...args);
const titlebar = (title, action) => h('div', {class: 'split'}, h('h3', {}, title), action);
function amountInput(name, value, extra = {}) { return input(name, decimal(value), 'number', {min: 0, step: '0.01', required: true, ...extra}); }

async function showList(append = false) {
  store?.stop(); clearInterval(listTimer); $('workspace').hidden = true; $('listing').hidden = false; $('loading').hidden = true;
  const api = new Store({admin: true});
  const data = await api.request('/api/private-offers' + (append && cursor ? '?cursor=' + cursor : ''));
  listData = append ? [...listData, ...data.offers] : data.offers; cursor = data.nextCursor;
  const cards = h('div', {class: 'deals'});
  for (const entry of listData.filter(o => !o.revoked && (!vehicleFilter || o.vehicle_id === vehicleFilter))) {
    const d = entry.deal, c = entry.calculation, unread = Math.max(0, d.lastMessage.customer - d.readMessages.dealer);
    const card = h('article', {class: 'deal-card', tabIndex: 0, role: 'button', onclick: safe(() => open(d.id)), onkeydown: e => { if (e.key === 'Enter') safe(() => open(d.id))(); }}, h('span', {class: 'status'}, d.stage), h('h3', {}, d.customer.name), h('p', {}, [d.vehicle.registration, d.vehicle.make, d.vehicle.model].filter(Boolean).join(' · ')), h('div', {class: 'amount'}, money(c.outstandingPence)), h('p', {class: 'muted'}, d.technical.published ? 'Customer link published' : 'Customer link unpublished'), unread > 0 && h('strong', {class: 'saving'}, unread + ' unread message' + (unread === 1 ? '' : 's')));
    cards.append(card);
  }
  $('listing').replaceChildren(h('div', {class: 'toolbar'}, h('div', {}, h('h1', {}, 'Customer Deals'), h('p', {class: 'muted'}, 'One customer. One vehicle. One private negotiation.')), h('div', {class: 'actions'}, btn('Export Deal Backup', safe(exportBackup), 'secondary'), btn('+ New Customer Deal', createCustomer))), cards.children.length ? cards : h('div', {class: 'panel'}, 'No customer deals yet.'), cursor ? btn('Load More Deals', safe(() => showList(true)), 'secondary') : h('span'));
  if (!append) listTimer = setInterval(() => { if (!$('editor').open && !document.hidden && !$('listing').hidden) showList().catch(() => {}); }, 12000);
}
async function exportBackup() {
  const data = await new Store({admin: true}).request('/api/private-offers?export=backup');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
  const a = h('a', {href: url, download: 'priceless-deals-backup-' + new Date().toISOString().slice(0, 10) + '.json'}); a.click(); URL.revokeObjectURL(url);
}
function createCustomer() {
  const api = new Store({admin: true});
  editor(api, 'Create New Customer Deal', root => {
    const controls = {}, grid = h('div', {class: 'grid'});
    for (const [key, label, type, required] of [['name', 'Full Name *', 'text', true], ['phone', 'Phone Number', 'tel', false], ['email', 'Email Address', 'email', false], ['registration', 'Registration *', 'text', true], ['make', 'Make *', 'text', true], ['model', 'Model *', 'text', true], ['mileage', 'Mileage', 'number', false]]) {
      controls[key] = input(key, '', type, {required, min: 0, step: '1'}); grid.append(field(label, controls[key]));
    }
    controls.price = amountInput('price', 0, {min: '0.01'}); controls.vat = vatSwitch('vehicleVat');
    const preview = h('div', {class: 'preview'}), update = () => { try { const net = pence(controls.price.value); const total = net + (controls.vat.node.checked ? Math.round(net / 5) : 0); preview.replaceChildren(line('Vehicle total', money(total))); } catch { preview.textContent = 'Enter a valid vehicle price'; } };
    controls.price.oninput = controls.vat.node.onchange = update; update();
    root.append(grid, field('Vehicle price (£) *', controls.price), controls.vat.label, preview, h('small', {}, 'Add the remaining vehicle details and your personalised package after creation.'));
    return controls;
  }, async c => {
    const price = pence(c.price.value);
    const result = await api.request('/api/private-offers', 'POST', {action: 'createCustomer', customer: {name: c.name.value, phone: c.phone.value, email: c.email.value}, vehicle: {registration: c.registration.value, make: c.make.value, model: c.model.value, mileage: c.mileage.value}, pricing: {originalNetPence: price, offerNetPence: price, vat: c.vat.node.checked}});
    await open(result.id);
  });
}
async function open(id) {
  clearInterval(listTimer); store?.stop(); $('listing').hidden = true;
  history.replaceState(null, '', '/admin/offers/?deal=' + encodeURIComponent(id));
  store = new Store({admin: true, id, onChange: render, onUnavailable: e => notice(e.message + '. Sign in again to continue.', true)});
  refs = createLayout(store, {admin: true, onBack: safe(async () => { history.replaceState(null, '', '/admin/offers/'); await showList(); }), onPrint: () => printOffer(store)});
  await store.load(); store.start();
}
function editCustomer() {
  editor(store, 'Customer Information', root => {
    const d = store.data.deal.customer, c = {};
    for (const [key, label, type] of [['name', 'Full Name *', 'text'], ['phone', 'Phone Number', 'tel'], ['email', 'Email Address', 'email']]) { c[key] = input(key, d[key], type, {required: key === 'name'}); root.append(field(label, c[key])); } return c;
  }, (c, version) => save('customer', {customer: Object.fromEntries(Object.entries(c).map(([key, node]) => [key, node.value]))}, {version}));
}
function editVehicle() {
  editor(store, 'Vehicle Information', root => {
    const c = {}, v = store.data.deal.vehicle;
    for (const [group, fields] of VEHICLE_GROUPS) {
      const grid = h('div', {class: 'grid'}); root.append(h('h3', {}, group), grid);
      for (const [key, label] of fields) {
        let node;
        if (key === 'engine') node = select(key, engines(), v[key]);
        else if (key === 'fuel') node = select(key, ['', 'Petrol', 'Diesel', 'Hybrid', 'Electric', 'LPG'], v[key]);
        else if (key === 'gearbox') node = select(key, ['', 'Manual', 'Automatic'], v[key]);
        else if (['description', 'photoUrls'].includes(key)) node = h('textarea', {name: key, value: v[key] || '', rows: 5});
        else node = input(key, v[key] || '', ['mileage', 'year', 'seats', 'doors', 'keys', 'previousKeepers'].includes(key) ? 'number' : key === 'motExpiry' ? 'date' : key === 'videoUrl' ? 'url' : 'text', {min: 0});
        c[key] = node; grid.append(field(label, node, ['description', 'photoUrls', 'videoUrl'].includes(key) ? 'wide' : ''));
      }
    } return c;
  }, (c, version) => save('vehicle', {vehicle: Object.fromEntries(Object.entries(c).map(([key, node]) => [key, node.value]))}, {version}));
}
function editPricing() {
  editor(store, 'Vehicle Price & VAT', root => {
    const p = store.data.deal.pricing, original = amountInput('original', p.originalNetPence), offer = amountInput('offer', p.offerNetPence), vat = vatSwitch('vat', p.vat), preview = h('div', {class: 'preview'});
    const update = () => { try { const d = clone(store.data.deal); d.pricing = {originalNetPence: pence(original.value), offerNetPence: pence(offer.value), vat: vat.node.checked}; const c = calculate(d); preview.replaceChildren(line('Vehicle discount', money(c.vehicleDiscountPence)), line('Net vehicle price', money(c.vehicle.netPence)), line('VAT', money(c.vehicle.vatPence)), line('Final customer price', money(c.vehicle.grossPence))); } catch { preview.textContent = 'Enter valid prices'; } };
    original.oninput = offer.oninput = vat.node.onchange = update; update();
    root.append(field('Original vehicle price (£)', original), field('Personalised vehicle price (£)', offer), vat.label, preview); return {original, offer, vat};
  }, (c, version) => save('pricing', {pricing: {originalNetPence: pence(c.original.value), offerNetPence: pence(c.offer.value), vat: c.vat.node.checked}}, {version}));
}
function editItem(existing, category = 'Other') {
  const baseItems = clone(store.data.deal.items);
  editor(store, existing ? 'Edit Product or Service' : 'Add Product or Service', root => {
    const x = existing || {id: crypto.randomUUID(), title: '', description: '', category, originalNetPence: 0, netPence: 0, type: 'optional', selectionControl: 'available', vat: false, protected: false};
    const c = {id: x.id, title: input('title', x.title, 'text', {required: true, maxlength: 130}), description: h('textarea', {name: 'description', value: x.description, rows: 3}), category: select('category', ['Other', 'Included Benefit', 'Preparation', 'Drive Away Insurance', 'Door to Door Delivery'], x.category), original: amountInput('original', x.originalNetPence), offer: amountInput('offer', x.netPence), type: select('type', [['included', 'INCLUDED'], ['free', 'FREE'], ['charged', 'Mandatory charged item'], ['optional', 'Optional item']], x.type), control: select('selectionControl', [['default', 'Selected by default'], ['available', 'Not selected by default']], x.selectionControl === 'required' ? 'available' : x.selectionControl), vat: vatSwitch('vat', x.vat), protected: tick('Required for safety, compliance or legal preparation', 'protected', x.protected, {disabled: x.protected})};
    const preview = h('div', {class: 'preview'});
    const read = () => ({id: c.id, title: c.title.value, description: c.description.value, category: c.category.value, originalNetPence: pence(c.original.value), netPence: ['free', 'included'].includes(c.type.value) ? 0 : pence(c.offer.value), type: c.type.value, selectionControl: c.type.value === 'charged' ? 'required' : c.control.value, vat: c.vat.node.checked, protected: c.protected.node.checked});
    const update = () => {
      c.control.disabled = c.type.value !== 'optional'; c.offer.disabled = ['included', 'free'].includes(c.type.value);
      try { const item = read(), d = clone(store.data.deal); d.items = [item]; d.selectedIds = [item.id]; const price = calculate(d).lines[0]; const discount = Math.max(0, item.originalNetPence - item.netPence); preview.replaceChildren(line('Discount amount', money(discount)), line('Discount percentage', (item.originalNetPence ? discount * 100 / item.originalNetPence : 0).toFixed(2) + '%'), line('Net + VAT', money(price.netPence) + ' + ' + money(price.vatPence)), line('Final customer price', money(price.grossPence))); } catch { preview.textContent = 'Enter valid prices'; }
    };
    root.append(field('Product name *', c.title), field('Description', c.description), field('Item category', c.category), h('div', {class: 'grid'}, field('Original retail price (£)', c.original), field('Priceless offer price (£)', c.offer)), field('Item type', c.type), field('Customer selection control', c.control), c.vat.label, c.protected.label, preview);
    root.oninput = update; root.onchange = update; update(); c.read = read; return c;
  }, (c, version) => { const item = c.read(); const items = baseItems.some(x => x.id === item.id) ? baseItems.map(x => x.id === item.id ? item : x) : [...baseItems, item]; return save('items', {items}, {version}); });
}
function editWarranty() {
  editor(store, 'Extended Warranty Review', root => {
    const d = store.data.deal, w = d.warranty, c = {engine: select('engine', engines(), d.vehicle.engine), months: select('months', WARRANTY.months.map(m => [m, m + ' Months']), w.months || 3), vat: vatSwitch('warrantyVat', w.vat), flags: [], prices: {}, provider: tick('Provider eligibility and tariff verified against dealer documentation', 'providerVerified', w.providerVerified), tax: tick('Warranty tax treatment verified', 'taxReviewed', w.taxReviewed), evidence: input('providerEvidence', w.providerEvidence || '', 'text', {maxlength: 1000})};
    root.append(h('p', {class: 'warning'}, WARRANTY.evidence), h('div', {class: 'grid'}, field('Engine', c.engine), field('Warranty period', c.months)));
    for (const flag of WARRANTY.flags) { const x = tick(flag, flag, w.flags.includes(flag)); c.flags.push([flag, x.node]); root.append(x.label); }
    const tariff = h('div'), preview = h('div', {class: 'preview'});
    for (const m of WARRANTY.months) {
      const q = warrantyQuote(d, m), free = tick('FREE', 'free' + m, w.prices[m]?.free || false), original = amountInput('original' + m, q.originalNetPence), offer = amountInput('offer' + m, q.netPence);
      c.prices[m] = {original, offer, free};
      tariff.append(h('div', {class: 'tariff-row'}, h('h3', {}, m + ' Months'), h('div', {class: 'grid'}, field('Standard retail price (£)', original), field('Priceless price (£)', offer)), free.label));
    }
    const category = () => { const draft = clone(d); draft.vehicle.engine = c.engine.value; draft.warranty.flags = c.flags.filter(([, node]) => node.checked).map(([flag]) => flag); return warrantyCategory(draft); };
    const resetRates = () => { const cat = category(); for (const [i, m] of WARRANTY.months.entries()) { c.prices[m].original.value = c.prices[m].offer.value = decimal(WARRANTY[cat][i]); c.prices[m].free.node.checked = false; } update(); };
    const update = () => { try { const p = c.prices[c.months.value], net = p.free.node.checked ? 0 : pence(p.offer.value); preview.replaceChildren(line('Category estimate', category() === 'special' ? 'Special' : 'Standard'), line('Final customer price', money(net + (c.vat.node.checked ? Math.round(net / 5) : 0)))); for (const p of Object.values(c.prices)) p.offer.disabled = p.free.node.checked; } catch { preview.textContent = 'Enter valid warranty prices'; } };
    c.engine.onchange = resetRates; for (const [, node] of c.flags) node.onchange = resetRates;
    root.append(tariff, c.vat.label, field('Dealer document or provider confirmation reference', c.evidence), c.provider.label, c.tax.label, preview);
    root.oninput = update; update(); return c;
  }, (c, version) => save('warrantyReview', {engine: c.engine.value, flags: c.flags.filter(([, node]) => node.checked).map(([name]) => name), months: Number(c.months.value), vat: c.vat.node.checked, prices: Object.fromEntries(Object.entries(c.prices).map(([m, p]) => [m, {originalNetPence: pence(p.original.value), netPence: p.free.node.checked ? 0 : pence(p.offer.value), free: p.free.node.checked}])), providerEvidence: c.evidence.value, providerVerified: c.provider.node.checked, taxReviewed: c.tax.node.checked}, {version}));
}
function valuationEditor() {
  editor(store, 'Part Exchange Valuation', root => {
    const v = store.data.deal.px.valuation || {}, c = {gross: amountInput('gross', v.grossPence || 0), finance: select('finance', [['unknown', 'Unknown'], ['no', 'No outstanding finance'], ['yes', 'Outstanding finance exists']], v.financeExists === true ? 'yes' : v.financeExists === false ? 'no' : 'unknown'), settlement: input('settlement', v.settlementPence == null ? '' : decimal(v.settlementPence), 'number', {min: 0, step: '0.01'}), inspected: tick('Physical inspection completed: final valuation', 'inspected', v.inspected), sources: tick('Checked three specialist valuation sources, including HPI', 'sources', v.sourceChecksVerified), negative: tick('Negative equity reviewed and discussed separately', 'negative', v.negativeEquityReviewed)};
    const preview = h('div', {class: 'preview'}), update = () => { try { const gross = pence(c.gross.value), settlement = c.finance.value === 'no' ? 0 : c.settlement.value === '' ? null : pence(c.settlement.value); preview.textContent = settlement === null ? 'Net allowance awaits confirmed lender settlement.' : 'Net PX allowance: ' + money(gross - settlement); c.settlement.disabled = c.finance.value === 'no'; } catch { preview.textContent = 'Enter valid amounts'; } };
    root.append(field('Gross vehicle valuation (£)', c.gross), field('Outstanding finance', c.finance), field('Confirmed lender settlement (£), leave blank if unknown', c.settlement), c.inspected.label, c.sources.label, c.negative.label, preview, h('small', {}, 'Every revised valuation cancels the earlier customer acceptance. Negative equity is added only after separate customer agreement.'));
    root.oninput = root.onchange = update; update(); return c;
  }, (c, version) => save('valuation', {grossPence: pence(c.gross.value), financeExists: c.finance.value === 'yes' ? true : c.finance.value === 'no' ? false : null, settlementPence: c.finance.value === 'no' ? 0 : c.settlement.value === '' ? null : pence(c.settlement.value), inspected: c.inspected.node.checked, sourceChecksVerified: c.sources.node.checked, negativeEquityReviewed: c.negative.node.checked}, {version}));
}
function paymentEditor() {
  editor(store, 'Record Payment or Refund', root => {
    const c = {kind: select('kind', [['deposit', 'Deposit received'], ['payment', 'Additional payment received'], ['refund', 'Refund paid']], 'deposit'), amount: amountInput('amount', 0, {min: '0.01'}), date: input('date', new Date().toISOString().slice(0, 10), 'date', {required: true}), method: select('method', ['Bank Transfer', 'Card', 'Cash', 'Finance'], 'Bank Transfer'), reference: input('reference', '', 'text', {required: true, maxlength: 160}), confirmed: tick('I confirm this receipt or refund has actually occurred', 'confirmed', false, {required: true})};
    root.append(field('Entry type', c.kind), field('Amount (£)', c.amount), field('Payment date', c.date), field('Payment method', c.method), field('Payment reference', c.reference), c.confirmed.label, h('small', {}, 'This records an existing transaction. It does not process a payment.')); return c;
  }, (c, version) => save('paymentEntry', {kind: c.kind.value, amountPence: pence(c.amount.value), date: c.date.value + 'T12:00:00.000Z', method: c.method.value, reference: c.reference.value, confirmed: c.confirmed.node.checked}, {version}));
}
function depositEditor() { editor(store, 'Deposit Requested', root => { const node = amountInput('deposit', store.data.deal.depositRequestedPence); root.append(field('Deposit requested (£)', node)); return node; }, (node, version) => save('depositRequested', {amountPence: pence(node.value)}, {version})); }
function expiryEditor() {
  editor(store, 'Link Expiry', root => { const node = input('expiry', '', 'datetime-local', {required: true}); root.append(field('Custom expiry, UK local time', node)); return node; }, (node, version) => save('extend', {expiresAt: ukInputISO(node.value)}, {version}));
}
function unlockEditor() {
  editor(store, 'Unlock Deal', root => { const node = h('textarea', {name: 'reason', rows: 3, required: true, maxlength: 500}); root.append(field('Reason for reopening this deal', node), h('p', {class: 'muted'}, 'The previous final snapshot remains saved. The revised package will require customer confirmation.')); return node; }, (node, version) => save('unlock', {reason: node.value}, {version}));
}
function renderTechnical(d, data) {
  const stage = select('stage', STAGES.filter(s => s !== 'Finalised & Locked'), d.stage);
  stage.disabled = d.technical.revoked;
  stage.onchange = safe(() => save('stage', {stage: stage.value}));
  const expiry = h('div', {class: 'expiry-buttons'});
  for (const days of [1, 3, 7, 30]) expiry.append(btn(days + (days === 1 ? ' Day' : ' Days'), safe(() => save('extend', {expiresAt: new Date(Date.now() + days * 86400000).toISOString()})), 'secondary', !unlocked()));
  expiry.append(btn('Custom Expiry', expiryEditor, 'secondary', !unlocked()), btn('No Expiry', safe(() => save('extend', {expiresAt: null})), 'secondary', !unlocked()));
  const copy = btn('Copy Link', safe(async () => { await navigator.clipboard.writeText(data.privateUrl); notice('Customer link copied.'); }), 'secondary', !data.privateUrl);
  return h('div', {}, h('h3', {}, 'Private Link Share'), line('Link status', d.technical.revoked ? 'Revoked' : d.technical.expiresAt && Date.parse(d.technical.expiresAt) <= Date.now() ? 'Expired' : d.technical.published ? 'Published' : 'Unpublished'), h('div', {class: 'linkbox'}, data.privateUrl || 'Use the original saved secure link. The stored hash cannot recover it.'), h('div', {class: 'actions'}, copy, data.privateUrl && h('a', {href: data.privateUrl, target: '_blank', rel: 'noopener noreferrer', class: 'button secondary'}, 'Open Customer Link')), h('h3', {}, 'Link Expiry'), h('p', {}, ukDate(d.technical.expiresAt)), expiry, h('p', {}, btn(d.technical.published ? 'Unpublish Link' : 'Publish Customer Link', safe(() => save(d.technical.published ? 'unpublish' : 'publish')), '', d.technical.revoked)), field('Deal Status', stage), h('small', {}, 'Commercial status and link availability are recorded separately.'), h('p', {}, btn('Archive / Revoke Deal', safe(() => save('revoke')), 'danger', d.technical.revoked)));
}
function productCards(d, category) {
  const c = store.data.calculation;
  const lines = c.lines.filter(x => category ? x.category === category : !['Drive Away Insurance', 'Door to Door Delivery'].includes(x.category));
  const root = h('div');
  for (const x of lines) {
    const actions = h('div', {class: 'actions'}, btn('Edit', () => editItem(d.items.find(i => i.id === x.id)), 'secondary', !unlocked()));
    const index = d.items.findIndex(i => i.id === x.id);
    for (const [offset, label] of [[-1, 'Move Up'], [1, 'Move Down']]) if (index + offset >= 0 && index + offset < d.items.length) actions.append(btn(label, safe(() => { const items = clone(store.data.deal.items), i = items.findIndex(item => item.id === x.id); [items[i], items[i + offset]] = [items[i + offset], items[i]]; return save('items', {items}); }), 'secondary', !unlocked()));
    if (!x.protected) actions.append(btn('Remove', safe(() => save('items', {items: store.data.deal.items.filter(i => i.id !== x.id)})), 'danger', !unlocked()));
    root.append(h('div', {class: 'item', dataset: {itemId: x.id}}, line(x.title, priceLabel(x, x.type)), h('small', {}, x.type === 'optional' ? (x.active ? 'Selected by customer' : 'Not selected') : x.protected ? 'Required for safety or compliance' : x.type.toUpperCase()), x.description && h('p', {}, x.description), actions));
  }
  if (!lines.length) root.append(h('p', {class: 'empty'}, 'No items added.'));
  root.append(btn('+ Add Product or Service', () => editItem(null, category || 'Other'), 'secondary', !unlocked()));
  return root;
}
const standardBenefits = [['12 Months MOT', 'included', true], ['Pre Delivery Inspection (PDI)', 'included', true], ['Service (Oil & Filter)', 'included', false], ['Service (Oil, Oil Filter & Air Filter)', 'included', false], ['Full Service', 'included', false], ['Full Valet', 'included', false], ['12 Months AA Breakdown Cover', 'free', false], ['3 Months In House Warranty', 'included', false]];
function renderStandard(d) {
  const root = h('div');
  for (const [title, type, required] of standardBenefits) {
    const exists = d.items.find(x => x.standardKey === title || x.title === title);
    const check = tick(title, title, !!exists, {disabled: !unlocked() || exists?.protected});
    check.node.onchange = safe(() => { const items = clone(store.data.deal.items); if (check.node.checked) items.push({id: crypto.randomUUID(), title, type, category: 'Included Benefit', description: title === '3 Months In House Warranty' ? 'Engine and gearbox cover only, subject to warranty terms.' : '', originalNetPence: 0, netPence: 0, vat: false, selectionControl: 'required', protected: required}); else items.splice(items.findIndex(x => x.id === exists.id), 1); return save('items', {items}); });
    root.append(check.label);
  }
  return disclosure('standard-benefits', 'Quick Add Included Benefits', root);
}
function changedValues(before, after, prefix = '', out = []) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (['version', 'updatedAt', 'snapshots', 'lastMessage', 'readMessages'].includes(key)) continue;
    const a = before?.[key], b = after?.[key], name = prefix + key;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (a && b && !Array.isArray(a) && !Array.isArray(b) && typeof a === 'object' && typeof b === 'object') changedValues(a, b, name + '.', out);
    else out.push(name + ': ' + JSON.stringify(a ?? null) + ' → ' + JSON.stringify(b ?? null));
  } return out;
}
function renderActivity(data) {
  const root = h('div');
  for (const e of data.activity || []) root.append(h('div', {class: 'activity-entry'}, h('strong', {}, e.kind + ' · v' + e.version), h('small', {}, ' · ' + (e.staff || e.actor) + ' · ' + ukDate(e.createdAt)), e.detail.message && h('p', {}, e.detail.message), disclosure('event-' + e.id, 'View before and after values', h('div', {class: 'activity-values'}, changedValues(e.before, e.after).slice(0, 80).join('\n') || 'Activity recorded.'))));
  if (data.legacyActivity?.length) root.append(disclosure('legacy-activity', 'Preserved Previous Activity', data.legacyActivity.map(e => h('div', {class: 'activity-entry'}, h('strong', {}, e.kind + ' · ' + e.actor), h('small', {}, ' · ' + ukDate(e.created_at)), h('div', {class: 'activity-values'}, JSON.stringify(JSON.parse(e.payload), null, 2))))));
  return disclosure('activity', 'Customer Activity & Internal History', root);
}
function renderReview(d, data) {
  const root = h('div', {}, h('h3', {}, 'Final Deal Review'));
  if (d.migrationIssues.length) root.append(h('div', {class: 'warning'}, ...d.migrationIssues.map(x => h('p', {}, x)), btn('Confirm Legacy Data Reviewed', safe(() => save('resolveMigration', {reviewed: true})), 'secondary', !unlocked())));
  for (const [key, label] of Object.entries(REVIEW_FIELDS)) {
    if (key === 'warranty' && !d.warranty.months || key === 'px' && (!d.px.details || ['withdrawn', 'declined'].includes(d.px.status))) continue;
    const x = tick(label, key, d.reviews[key], {disabled: !unlocked()}); x.node.onchange = safe(() => save('review', {reviews: {[key]: x.node.checked}})); root.append(x.label);
  }
  if (d.locked) root.append(h('p', {class: 'status'}, 'Final snapshot saved · version ' + d.snapshots.at(-1)?.version), btn('Unlock for Renegotiation', unlockEditor, 'secondary', d.technical.revoked));
  else root.append(h('div', {class: data.finalIssues.length ? 'warning' : 'notice'}, data.finalIssues.length ? data.finalIssues.map(x => h('p', {}, x)) : 'All checks complete. Latest package confirmed.'), btn('Finalise & Lock', safe(() => save('lock')), '', data.finalIssues.length > 0));
  if (d.snapshots.length) root.append(disclosure('snapshots', 'Saved Final Versions', d.snapshots.map(s => h('p', {}, 'Version ' + s.version + ' · ' + ukDate(s.createdAt) + (s.legacy ? ' · Preserved legacy final offer' : '')))));
  return root;
}
function render(data) {
  const d = data.deal, c = data.calculation; updateHeader(refs, store);
  sectionUpdate(refs.customer, [d.customer, d.locked], () => [titlebar('Customer Information', btn('Edit', editCustomer, 'secondary', !unlocked())), renderCustomer(d, false)]);
  sectionUpdate(refs.technical, [d.technical, d.stage, d.locked, data.privateUrl], () => renderTechnical(d, data));
  renderNotes(refs.notes, data.notes, d, true);
  sectionUpdate(refs.activity, data.activity, () => renderActivity(data));
  sectionUpdate(refs.vehicle, [d.vehicle, d.locked], () => [titlebar('Car Info', btn('Edit Vehicle', editVehicle, 'secondary', !unlocked())), renderVehicle(d)]);
  sectionUpdate(refs.calculation, [c, d.locked], () => [btn('Edit Vehicle Price', editPricing, 'secondary', !unlocked()), renderCalculation(d, c)]);
  sectionUpdate(refs.products, [d.items, d.selectedIds, d.locked], () => [h('h3', {}, 'Products, Services & Benefits'), renderStandard(d), productCards(d)]);
  sectionUpdate(refs.warranty, [d.warranty, d.vehicle.engine, d.vehicle.fuel, d.locked], () => [h('h3', {}, 'Extended Warranty'), d.warranty.months ? h('p', {class: d.warranty.reviewed ? 'notice' : 'warning'}, d.warranty.reviewed ? 'Warranty reviewed · ' + d.warranty.months + ' months' : 'Warranty Review Required · ' + d.warranty.months + ' months selected') : h('p', {class: 'empty'}, 'No extended warranty selected.'), btn('Configure / Review Warranty', editWarranty, 'secondary', !unlocked()), d.warranty.months ? btn('Remove Warranty', safe(() => save('warrantySelect', {months: 0})), 'secondary', !unlocked()) : h('span')]);
  sectionUpdate(refs.insurance, [d.items, d.selectedIds, d.locked], () => [h('h3', {}, 'Drive Away Insurance'), productCards(d, 'Drive Away Insurance')]);
  sectionUpdate(refs.delivery, [d.items, d.selectedIds, d.locked], () => [h('h3', {}, 'Door to Door Delivery'), productCards(d, 'Door to Door Delivery')]);
  sectionUpdate(refs.px, [d.px, d.locked], () => [renderPX(d, c), h('div', {class: 'actions'}, btn(d.px.details ? 'Edit PX Vehicle' : '+ Add PX Vehicle', () => pxEditor(store, save), 'secondary', !unlocked()), d.px.details && btn('Set / Revise Valuation', valuationEditor, 'secondary', !unlocked()), d.px.details && btn('Withdraw PX', safe(() => save('withdrawPX')), 'secondary', !unlocked())), d.px.history.length ? disclosure('px-history', 'Valuation History', d.px.history.map(v => h('p', {}, 'Revision ' + v.version + ' · Gross ' + money(v.grossPence) + ' · Settlement ' + (v.settlementPence === null ? 'Unknown' : money(v.settlementPence)) + ' · ' + (v.decision || 'Superseded')))) : h('span')]);
  sectionUpdate(refs.payments, [d.payments, d.depositRequestedPence, d.locked], () => [renderPayments(d, c, true), h('div', {class: 'actions'}, btn('Set Deposit Requested', depositEditor, 'secondary', !unlocked()), btn('Record Payment / Refund', paymentEditor, 'secondary', !unlocked()))]);
  sectionUpdate(refs.preference, d.preferredPaymentMethod, () => [h('h3', {}, 'Preferred Payment Method'), h('p', {}, d.preferredPaymentMethod || 'Customer has not selected a payment method.')]);
  sectionUpdate(refs.confirmation, [d.confirmation, d.packageVersion], () => [h('h3', {}, 'Customer Confirmation'), h('p', {class: d.confirmation?.packageVersion === d.packageVersion ? 'notice' : 'warning'}, d.confirmation?.packageVersion === d.packageVersion ? 'Customer confirmed package ' + d.packageVersion + ' · ' + ukDate(d.confirmation.at) + (d.confirmation.carryReason ? ' · ' + d.confirmation.carryReason : '') : 'Latest package awaits Confirm My Selection.')]);
  sectionUpdate(refs.review, [d.reviews, d.locked, d.snapshots, d.migrationIssues, data.finalIssues], () => renderReview(d, data));
}
try { if (params.get('deal')) await open(params.get('deal')); else { await showList(); if (params.has('new')) createCustomer(); } } catch (e) { $('loading').hidden = true; notice(e.message + '. Sign in through Staff Administration to continue.', true); }
