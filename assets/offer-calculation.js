// Shared calculation for existing gross GBP offer records. No database changes.
export function warrantyAmount(w, months=w?.months) {
 if(!months)return 0;
 if(w?.months===months && w.status!=='review')return Number(w.price)||0;
 return Math.round((([3,6,12,24].indexOf(months)<0?0:(w?.category==='special'?[27150,29850,74700,104700]:[18100,19900,49800,69800])[[3,6,12,24].indexOf(months)]))*(w?.vat?1.2:1))/100;
}
export function calculateOffer({price,retailPrice,items=[],selected=[],warranty,valuation}) {
 const p=n=>Math.round((Number(n)||0)*100), ids=new Set(selected);
 let total=p(price), savings=Math.max(0,p(retailPrice)-total);
 items.forEach((x,i)=>{const optional=['optional','offered'].includes(x.type);if(x.type==='charged'||optional&&ids.has(i)){total+=p(x.price);savings+=Math.max(0,p(x.normalValue)-p(x.price));}else if(x.type==='free'){savings+=Math.max(0,p(x.normalValue));}});
 const amount=warrantyAmount(warranty);
 total+=p(amount);
 if(warranty?.months&&warranty.status==='confirmed')savings+=Math.max(0,p(warranty.retail)-p(amount));
 if(valuation?.status==='accepted')total-=p(valuation.net);
 return {total:total/100,savings:savings/100,warrantyAmount:amount};
}
