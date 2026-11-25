import {WARRANTY, calculate, warrantyQuote} from './deal-engine.js';
import {$, h, btn, line, tick, money, ukDate, notice, Store, sectionUpdate, disclosure, createLayout, updateHeader, renderCustomer, renderVehicle, renderNotes, renderCalculation, renderPayments, renderPX, pxEditor, priceLabel, printOffer, clone} from './deal-ui.js';

const token = new URLSearchParams(location.search).get('token');
let refs;
const store = new Store({token, onChange: render, onUnavailable: e => { $('workspace').hidden = true; notice(e.message + '. Please contact Priceless for an updated offer.', true); }});
async function action(name, values = {}, preview) {
  if (store.busy) { notice('Your previous choice is being saved.'); return; }
  if (preview) {
    const draft = clone(store.data.deal); preview(draft); const c = calculate(draft);
    sectionUpdate(refs.calculation, c, () => renderCalculation(draft, c)); $('mobileAmount').textContent = money(c.outstandingPence);
  }
  try { const promise = store.save(name, values); render(store.data); await promise; }
  catch (e) { notice(e.message, true); await store.load().catch(() => {}); }
  finally { render(store.data); }
}
const writable = () => !store.data.deal.locked && !store.busy;
function productChoices(d, category) {
  const root = h('div'), c = store.data.calculation;
  const items = c.lines.filter(x => category ? x.category === category : !['Drive Away Insurance', 'Door to Door Delivery'].includes(x.category));
  for (const x of items) {
    if (x.type === 'optional' && !x.protected) {
      const check = h('input', {type: 'checkbox', checked: d.selectedIds.includes(x.id), disabled: !writable(), 'aria-label': x.title, dataset: {itemId: x.id}, onchange: () => { const selectedIds = check.checked ? [...new Set([...store.data.deal.selectedIds, x.id])] : store.data.deal.selectedIds.filter(i => i !== x.id); action('selection', {selectedIds}, draft => draft.selectedIds = selectedIds); }});
      root.append(h('label', {class: 'choice'}, h('span', {}, h('strong', {}, x.title), priceLabel(x, x.type), x.description && h('small', {}, x.description)), check));
    } else root.append(h('div', {class: 'item'}, line(x.title, priceLabel(x, x.type)), x.description && h('small', {}, x.description), x.protected && h('small', {}, 'Required for safety or compliance')));
  }
  return root;
}
function renderWarranty(d) {
  const root = h('div', {}, h('p', {class: 'muted'}, 'Choose one period, or untick your selection to continue without extended warranty.'));
  for (const m of WARRANTY.months) {
    const q = warrantyQuote(d, m), check = h('input', {type: 'checkbox', checked: d.warranty.months === m, disabled: !writable(), 'aria-label': m + ' Months Extended Warranty', onchange: () => { const months = check.checked ? m : 0; action('warrantySelect', {months}, draft => { draft.warranty.months = months; draft.warranty.reviewed = false; }); }});
    root.append(h('label', {class: 'choice'}, h('span', {}, h('strong', {}, m + ' Months Extended Warranty'), priceLabel(q), h('small', {}, d.warranty.providerVerified ? 'Subject to policy terms and vehicle eligibility.' : 'Estimated tariff, subject to Priceless review.')), check));
  }
  return disclosure('warranty', 'Extended Warranty', root, !!d.warranty.months);
}
function renderPXControls(d, c) {
  const root = renderPX(d, c), p = d.px, v = p.valuation;
  root.append(btn(p.details ? 'Edit My PX Vehicle' : 'Request a Part Exchange Valuation', () => pxEditor(store, (...args) => store.save(...args)), 'secondary', !writable()));
  if (v && !['withdrawn', 'requested'].includes(p.status)) {
    const buttons = h('div', {class: 'actions'});
    for (const [status, label] of [['accepted', 'Accept Valuation'], ['declined', 'Decline Valuation']]) buttons.append(btn(label, () => action('valuationDecision', {valuationId: v.id, status}), status === 'declined' ? 'secondary' : '', !writable() || p.status === status || status === 'accepted' && c.pxNetPence === null));
    root.append(buttons);
  }
  if (p.details && p.status !== 'withdrawn') root.append(h('p', {}, btn('Withdraw Part Exchange', () => action('withdrawPX'), 'secondary', !writable())));
  if (v && p.status === 'accepted' && c.negativeEquityPence > 0) {
    const consent = tick('I separately agree to add the reviewed negative equity of ' + money(c.negativeEquityPence) + ' to this deal.', 'negativeEquityAgreement', v.negativeEquityCustomerAgreed, {disabled: !writable() || !v.negativeEquityReviewed});
    consent.node.onchange = () => action('negativeEquityAgreement', {valuationId: v.id, agreed: consent.node.checked});
    root.append(consent.label);
    if (!v.negativeEquityReviewed) root.append(h('small', {}, 'Priceless must review this amount before you can give separate agreement.'));
  }
  return root;
}
function renderPreference(d) {
  const choices = h('div', {class: 'payment-actions'});
  for (const [method, label] of [['cash', 'Cash'], ['card', 'Card Payment'], ['bank', 'Bank Transfer'], ['finance', 'Finance']]) {
    const b = btn(label, () => action('payment', {method}), 'secondary', !writable()); b.setAttribute('aria-pressed', String(d.preferredPaymentMethod === method)); choices.append(b);
  }
  return h('div', {}, h('h3', {}, 'Preferred Payment Method'), choices, h('small', {}, 'Your preference does not initiate a payment.'), d.preferredPaymentMethod === 'finance' && h('p', {}, 'Finance is subject to status, affordability and lender approval. Minimum finance £4,000. ', h('a', {href: '/apply/'}, 'Continue to Finance Application')));
}
function render(data) {
  const d = data.deal, c = data.calculation; updateHeader(refs, store);
  sectionUpdate(refs.customer, d.customer, () => renderCustomer(d));
  renderNotes(refs.notes, data.notes, d, false);
  sectionUpdate(refs.vehicle, d.vehicle, () => renderVehicle(d));
  sectionUpdate(refs.calculation, [c, d.version], () => renderCalculation(d, c));
  sectionUpdate(refs.products, [d.items, d.selectedIds, d.locked, store.busy], () => [h('h3', {}, 'Your Benefits & Personalised Extras'), productChoices(d)]);
  sectionUpdate(refs.warranty, [d.warranty, d.vehicle.engine, d.vehicle.fuel, d.locked, store.busy], () => renderWarranty(d));
  const hasCategory = category => d.items.some(x => x.category === category);
  sectionUpdate(refs.insurance, [d.items, d.selectedIds, d.locked, store.busy], () => hasCategory('Drive Away Insurance') ? [h('h3', {}, 'Drive Away Insurance'), productChoices(d, 'Drive Away Insurance')] : []);
  sectionUpdate(refs.delivery, [d.items, d.selectedIds, d.locked, store.busy], () => [h('h3', {}, 'Door to Door Delivery'), hasCategory('Door to Door Delivery') ? productChoices(d, 'Door to Door Delivery') : h('p', {class: 'muted'}, 'Ask Priceless for a delivery quote. Send your delivery postcode through Messages.')]);
  sectionUpdate(refs.px, [d.px, d.locked, store.busy], () => renderPXControls(d, c));
  sectionUpdate(refs.payments, [d.payments, d.depositRequestedPence], () => renderPayments(d, c));
  sectionUpdate(refs.preference, [d.preferredPaymentMethod, d.locked, store.busy], () => renderPreference(d));
  const confirmed = d.confirmation?.packageVersion === d.packageVersion;
  sectionUpdate(refs.confirmation, [d.confirmation, d.packageVersion, d.locked, store.busy], () => [h('h3', {}, 'Your Package Confirmation'), h('p', {class: confirmed ? 'notice' : 'muted'}, d.locked ? 'Your final offer has been saved and locked by Priceless.' : confirmed ? 'Package ' + d.packageVersion + ' confirmed · ' + ukDate(d.confirmation.at) : 'Review the current package and confirm your selection for Priceless to check.'), btn(d.locked ? 'Offer Finalised' : 'Confirm My Selection', () => action('confirm'), '', !writable()), h('small', {}, 'No payment is processed by this page. Warranty and PX remain subject to the stated checks.')]);
}
try {
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw Error('This private offer is unavailable');
  refs = createLayout(store, {onPrint: () => printOffer(store)});
  await store.load(); store.start();
} catch (e) { $('workspace').hidden = true; $('loading').hidden = true; notice(e.message + '. Please contact Priceless for an updated offer.', true); }
