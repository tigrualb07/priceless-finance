// The existing offer records store gross GBP. Keep those amounts authoritative.
export function moneyPence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const text = (typeof value === 'string' && /^[+-]?\d+(?:\.\d*)?$/.test(value.trim())) ? value.trim() : number.toFixed(8);
  const negative = text.startsWith('-'), unsigned = text.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  const pence = Number(whole) * 100 + Number((fraction + '00').slice(0, 2)) + (Number(fraction[2] || 0) >= 5 ? 1 : 0);
  return negative ? -pence : pence;
}
export const grossAmount = (net, vat = false) => {
  const pence = moneyPence(net);
  return (pence + (vat ? Math.round(pence / 5) : 0)) / 100;
};
export function priceBreakdown(gross, vat = false) {
  const grossPence = moneyPence(gross), netPence = vat ? Math.round(grossPence / 1.2) : grossPence;
  return {grossPence, netPence, vatPence: grossPence - netPence};
}
export const WARRANTY_MONTHS = [3, 6, 12, 24];
export const WARRANTY_PRICES = {standard: [181, 199, 498, 698], special: [271.5, 298.5, 747, 1047]};
export function warrantyAmount(w, months = w?.months) {
  const index = WARRANTY_MONTHS.indexOf(Number(months));
  if (index < 0) return 0;
  if (Number(w?.months) === Number(months) && w.status !== 'review') return moneyPence(w.price) / 100;
  return grossAmount(WARRANTY_PRICES[w?.category === 'special' ? 'special' : 'standard'][index], w?.vat === true);
}
export function calculateOffer({price, retailPrice, vehicleVat = false, items = [], selected = [], selectedIds, warranty, valuation, payments = [], depositRequested = 0}) {
  const chosen = new Set(selectedIds ?? selected), vehicle = priceBreakdown(price, vehicleVat);
  const originalVehiclePence = Math.max(vehicle.grossPence, moneyPence(retailPrice));
  let purchasePence = vehicle.grossPence, vatPence = vehicle.vatPence, savingsPence = originalVehiclePence - vehicle.grossPence;
  const lines = items.map((item, index) => {
    const optional = ['optional', 'offered'].includes(item.type);
    const active = !optional || item.extraMode === 'required' || (item.id ? chosen.has(item.id) : false) || chosen.has(index);
    const chargeable = item.type === 'charged' || optional;
    const line = priceBreakdown(chargeable ? item.price : 0, item.vat === true);
    const saving = Math.max(0, moneyPence(item.normalValue) - line.grossPence);
    if (active) { purchasePence += line.grossPence; vatPence += line.vatPence; savingsPence += saving; }
    return {...item, active, ...line, savingsPence: active ? saving : 0};
  });
  const amount = warrantyAmount(warranty), warrantyPrice = priceBreakdown(amount, warranty?.vat === true);
  purchasePence += warrantyPrice.grossPence; vatPence += warrantyPrice.vatPence;
  if (warranty?.months && warranty.status === 'confirmed') savingsPence += Math.max(0, moneyPence(warranty.retail) - warrantyPrice.grossPence);
  let pxAllowancePence = 0, negativeEquityPence = 0;
  const knownPX = valuation?.net !== null && valuation?.net !== undefined && valuation?.settlement !== null && valuation?.financeExists !== null && Number.isFinite(Number(valuation?.net));
  if (valuation?.status === 'accepted' && knownPX) {
    const net = moneyPence(valuation.net);
    if (net >= 0) pxAllowancePence = net;
    else if (valuation.negativeEquityReviewed === true && valuation.negativeEquityAgreed === true) negativeEquityPence = -net;
  }
  let depositsPence = 0, additionalPaymentsPence = 0, refundsPence = 0;
  for (const payment of payments) {
    if (payment.confirmed !== true) continue;
    const pence = payment.amountPence === undefined ? moneyPence(payment.amount) : payment.amountPence;
    if (!Number.isSafeInteger(pence) || pence <= 0) continue;
    if (payment.kind === 'deposit') depositsPence += pence;
    else if (payment.kind === 'payment') additionalPaymentsPence += pence;
    else if (payment.kind === 'refund') refundsPence += pence;
  }
  const receivedPence = depositsPence + additionalPaymentsPence - refundsPence;
  const totalPence = purchasePence - pxAllowancePence + negativeEquityPence - receivedPence;
  return {total: totalPence / 100, savings: savingsPence / 100, warrantyAmount: amount, lines,
    vehicle, originalVehiclePence, vehicleDiscountPence: originalVehiclePence - vehicle.grossPence,
    purchasePence, netPurchasePence: purchasePence - vatPence, vatPence, savingsPence,
    pxAllowancePence, negativeEquityPence, depositsPence, additionalPaymentsPence, refundsPence, receivedPence,
    depositRequestedPence: moneyPence(depositRequested), totalPence};
}

// Shared payment summary labels and amounts for the existing Admin, Link and print views.
export function balanceLines(c){
 const rows=[['Purchase total',c.purchasePence]];
 if(c.pxAllowancePence)rows.push(['Accepted part exchange allowance',-c.pxAllowancePence]);
 if(c.negativeEquityPence)rows.push(['Separately agreed negative equity',c.negativeEquityPence]);
 if(c.depositRequestedPence)rows.push(['Deposit requested (not deducted)',c.depositRequestedPence]);
 if(c.depositsPence)rows.push(['Deposits received',-c.depositsPence]);
 if(c.additionalPaymentsPence)rows.push(['Additional payments received',-c.additionalPaymentsPence]);
 if(c.refundsPence)rows.push(['Refunds paid',c.refundsPence]);
 return rows;
}
