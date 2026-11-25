/* Shared by the Pages API, the staff workspace and the customer offer. Money is integer pence. */
export const SCHEMA_VERSION = 2;
export const WARRANTY = Object.freeze({
  months: Object.freeze([3, 6, 12, 24]),
  standard: Object.freeze([18100, 19900, 49800, 69800]),
  special: Object.freeze([27150, 29850, 74700, 104700]),
  flags: Object.freeze(['4x4 / AWD', 'Commercial Vehicle', 'Luxury Vehicle', 'Performance Vehicle', 'Taxi / Private Hire', 'Electric / Hybrid']),
  rulesVerified: false,
  evidence: 'Dealer specific tariff and tax treatment require documentary verification. Public Momentum dealer plans do not confirm these tariffs or the 2.5 L surcharge rule.'
});
export const STAGES = Object.freeze(['Draft', 'Offer Sent', 'Negotiation in Progress', 'Awaiting Customer Confirmation', 'Customer Confirmed', 'Finalised & Locked', 'Completed', 'Cancelled']);
export const REVIEW_FIELDS = Object.freeze({customer: 'Customer details verified', vehicle: 'Vehicle details verified', prices: 'Package prices verified', vat: 'VAT treatment verified', warranty: 'Extended Warranty reviewed', px: 'Part Exchange reviewed', payments: 'Payment arrangements agreed'});
export const VEHICLE_GROUPS = Object.freeze([
  ['Car Info', [['registration', 'Registration'], ['make', 'Make'], ['model', 'Model'], ['year', 'Year'], ['mileage', 'Mileage'], ['fuel', 'Fuel Type'], ['gearbox', 'Transmission'], ['engine', 'Engine'], ['seats', 'Seats']]],
  ['Additional Vehicle Details', [['title', 'Presentation Title'], ['colour', 'Colour'], ['bodyType', 'Body Type'], ['doors', 'Doors']]],
  ['History & Condition', [['serviceHistory', 'Service History'], ['keys', 'Number of Keys'], ['motExpiry', 'MOT Expiry'], ['roadTax', 'Road Tax'], ['previousKeepers', 'Previous Keepers'], ['cambelt', 'Cambelt / Timing Chain'], ['lastService', 'Last Service'], ['lastWork', 'Last Work Completed']]],
  ['Photos & Video', [['photoUrls', 'Photo Gallery'], ['videoUrl', 'YouTube Video']]],
  ['Vehicle Description', [['description', 'Vehicle Description']]]
]);
const MAX_MONEY = 1_000_000_000;
export function pence(value, label = 'Amount') {
  const s = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(label + ' must have at most two decimal places');
  const [whole, decimal = ''] = s.split('.');
  return integer(Number(whole) * 100 + Number(decimal.padEnd(2, '0')), label);
}
export function integer(value, label = 'Amount') {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY) throw new Error(label + ' is invalid');
  return value;
}
export const money = value => (Number(value || 0) / 100).toLocaleString('en-GB', {style: 'currency', currency: 'GBP'});
export const decimal = value => (Number(value || 0) / 100).toFixed(2);
export const clone = value => JSON.parse(JSON.stringify(value));
export function linePrice(netPence, vat) {
  const net = integer(netPence), tax = vat === true ? Math.round(net / 5) : 0;
  return {netPence: net, vatPence: tax, grossPence: net + tax};
}
function legacyGrossPrice(grossPence, vat) {
  const gross = integer(grossPence), net = vat ? Math.round(gross * 5 / 6) : gross;
  return {netPence: net, vatPence: gross - net, grossPence: gross};
}
export function warrantyCategory(deal) {
  const engine = String(deal.vehicle?.engine || '').trim().toLowerCase();
  return engine === 'electric' || Number(engine.replace(/\s*l$/i, '')) > 2.5 || (deal.warranty?.flags || []).length || /hybrid|electric/i.test(deal.vehicle?.fuel || '') ? 'special' : 'standard';
}
export function warrantyQuote(deal, months = deal.warranty?.months) {
  const w = deal.warranty || {}, index = WARRANTY.months.indexOf(months);
  if (index < 0) return null;
  const category = warrantyCategory(deal), override = w.prices?.[months] || {};
  const originalNetPence = override.originalNetPence ?? WARRANTY[category][index];
  const netPence = override.free ? 0 : override.netPence ?? originalNetPence;
  const price = linePrice(netPence, w.vat), original = linePrice(originalNetPence, w.vat);
  return {id: 'extended-warranty', title: months + ' Months Extended Warranty', months, category, ...price, originalGrossPence: original.grossPence, originalNetPence, savingsPence: Math.max(0, original.grossPence - price.grossPence), estimated: !w.reviewed || !w.providerVerified};
}
export function calculate(deal) {
  const p = deal.pricing || {}, vehicle = p.legacyOfferGrossPence === undefined ? linePrice(p.offerNetPence || 0, p.vat) : legacyGrossPrice(p.legacyOfferGrossPence, p.vat), original = p.legacyOriginalGrossPence === undefined ? linePrice(p.originalNetPence || 0, p.vat) : legacyGrossPrice(p.legacyOriginalGrossPence, p.vat);
  const selected = new Set(deal.selectedIds || []);
  const lines = (deal.items || []).map(item => {
    const active = item.type !== 'optional' || item.protected || selected.has(item.id);
    const price = ['included', 'free'].includes(item.type) ? linePrice(0, item.vat) : item.legacyGrossPence === undefined ? linePrice(item.netPence, item.vat) : legacyGrossPrice(item.legacyGrossPence, item.vat);
    const retail = item.legacyOriginalGrossPence === undefined ? linePrice(item.originalNetPence, item.vat) : legacyGrossPrice(item.legacyOriginalGrossPence, item.vat);
    return {...item, ...price, active, originalGrossPence: retail.grossPence, discountPence: Math.max(0, retail.grossPence - price.grossPence), savingsPence: active ? Math.max(0, retail.grossPence - price.grossPence) : 0};
  });
  const warranty = warrantyQuote(deal), active = lines.filter(x => x.active);
  const subtotalNetPence = vehicle.netPence + active.reduce((n, x) => n + x.netPence, 0) + (warranty?.netPence || 0);
  const vatPence = vehicle.vatPence + active.reduce((n, x) => n + x.vatPence, 0) + (warranty?.vatPence || 0);
  const totalPurchasePence = subtotalNetPence + vatPence;
  const px = deal.px || {}, v = px.valuation;
  const settlementKnown = v && (v.financeExists === false || v.financeExists === true && Number.isSafeInteger(v.settlementPence));
  const pxNetPence = settlementKnown ? v.grossPence - (v.financeExists === false ? 0 : v.settlementPence) : null;
  const negativeEquityPence = pxNetPence === null ? 0 : Math.max(0, -pxNetPence);
  const accepted = px.status === 'accepted' && settlementKnown;
  const pxAllowancePence = accepted ? Math.max(0, pxNetPence) : 0;
  const negativeEquityAppliedPence = accepted && v.negativeEquityReviewed === true && v.negativeEquityCustomerAgreed === true ? negativeEquityPence : 0;
  const receipts = (deal.payments || []).filter(x => x.confirmed === true);
  const depositsReceivedPence = receipts.filter(x => x.kind === 'deposit').reduce((n, x) => n + x.amountPence, 0);
  const additionalPaymentsPence = receipts.filter(x => x.kind === 'payment').reduce((n, x) => n + x.amountPence, 0);
  const refundsPence = receipts.filter(x => x.kind === 'refund').reduce((n, x) => n + x.amountPence, 0);
  const totalReceivedPence = depositsReceivedPence + additionalPaymentsPence - refundsPence;
  const totalAfterPXPence = totalPurchasePence - pxAllowancePence + negativeEquityAppliedPence;
  return {vehicle, originalVehicleGrossPence: original.grossPence, vehicleDiscountPence: Math.max(0, original.grossPence - vehicle.grossPence), lines, warranty, subtotalNetPence, vatPence, totalPurchasePence, pxNetPence, pxAllowancePence, negativeEquityPence, negativeEquityAppliedPence, depositsReceivedPence, additionalPaymentsPence, refundsPence, totalReceivedPence, totalAfterPXPence, outstandingPence: totalAfterPXPence - totalReceivedPence, savingsPence: Math.max(0, original.grossPence - vehicle.grossPence) + active.reduce((n, x) => n + x.savingsPence, 0) + (warranty?.savingsPence || 0), estimated: !!warranty?.estimated || !!(v && !settlementKnown) || !!(negativeEquityPence && !negativeEquityAppliedPence)};
}
export function packageContent(d) {
  return JSON.stringify({customer: d.customer, vehicle: d.vehicle, pricing: d.pricing, items: [...d.items].sort((a, b) => a.id.localeCompare(b.id)), selectedIds: [...d.selectedIds].sort(), warranty: {months: d.warranty.months, flags: d.warranty.flags, vat: d.warranty.vat, prices: d.warranty.prices}, px: d.px});
}
export function finalIssues(d) {
  const issues = [], c = calculate(d), r = d.reviews || {};
  for (const [key, label] of Object.entries(REVIEW_FIELDS)) {
    if (key === 'warranty' && !d.warranty.months || key === 'px' && (!d.px.details || d.px.status === 'withdrawn' || d.px.status === 'declined')) continue;
    if (!r[key]) issues.push(label);
  }
  if (!d.customer.name || !d.vehicle.registration || !d.vehicle.make || !d.vehicle.model) issues.push('Complete customer and vehicle details');
  if (d.confirmation?.packageVersion !== d.packageVersion) issues.push('Latest package must be confirmed by the customer');
  if (d.warranty.months && (!d.warranty.reviewed || !d.warranty.providerVerified || !d.warranty.taxReviewed)) issues.push('Warranty Review Required');
  if (d.px.details && !['withdrawn', 'declined'].includes(d.px.status)) {
    if (d.px.status !== 'accepted' || c.pxNetPence === null) issues.push('Part Exchange valuation and settlement must be agreed');
    if (!d.px.valuation?.inspected) issues.push('Part Exchange physical inspection required');
    if (c.negativeEquityPence && !c.negativeEquityAppliedPence) issues.push('Separate negative equity review and customer agreement required');
  }
  if (d.migrationIssues?.length) issues.push('Review legacy migration warnings');
  if (!d.technical.published || d.technical.revoked || d.technical.expiresAt && Date.parse(d.technical.expiresAt) <= Date.now()) issues.push('Customer link must be active');
  return issues;
}
