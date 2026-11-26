import {balanceLines,provisionalPX,renderPXSummary} from './offer-calculation.js?release=20261126_contribution';

export const OFFER_PRINT_CSS=`
#offerDocument{display:none}
@page{size:A4 landscape;margin:8mm}
@media print{
html,body{height:auto!important;overflow:visible!important;background:white!important}
body>*:not(#offerDocument){display:none!important}
#offerDocument{display:block!important;color:#193425;font:8.5pt/1.2 Arial,sans-serif;print-color-adjust:exact;-webkit-print-color-adjust:exact}
#offerDocument *{box-sizing:border-box}
#offerDocument header{display:flex!important;justify-content:space-between;background:white!important;color:#193425!important;padding:0 0 3mm;border-bottom:2px solid #8fbf70}
#offerDocument header img{max-width:43mm;max-height:13mm;object-fit:contain}
#offerDocument h1{font-size:16pt;margin:0 0 1mm}
#offerDocument h2{font-size:11pt;margin:2mm 0}
#offerDocument p{margin:1mm 0;white-space:pre-wrap;overflow-wrap:anywhere}
#offerDocument table{width:100%;border-collapse:collapse;font-size:8pt}
#offerDocument th,#offerDocument td{padding:1mm .7mm;border-bottom:1px solid #d7e4d7;text-align:left;vertical-align:top}
#offerDocument td:last-child,#offerDocument th:last-child{text-align:right}
#offerDocument .financial td:nth-last-child(-n+2),#offerDocument .financial th:nth-last-child(-n+2){white-space:nowrap}
#offerDocument tr{break-inside:avoid}
#offerDocument .financial td:not(:first-child),#offerDocument .financial th:not(:first-child){white-space:nowrap;text-align:right}
#offerDocument .price-breakdown td:last-child{white-space:nowrap}
#offerDocument .price-highlight{font-weight:bold;background:#eef5eb}
#offerDocument .saving{font-weight:bold;color:#32623c}
#offerDocument .benefit{padding:1.5mm 0;border-bottom:1px solid #d7e4d7}
#offerDocument .benefit span{display:block}
#offerDocument .price-breakdown td{padding:.65mm .7mm}
#offerDocument .document-grid{display:grid;grid-template-columns:24% 29% 1fr;gap:3mm;align-items:start;margin-top:3mm}
#offerDocument .document-grid>section{border:1px solid #d7e4d7;border-radius:2mm;padding:2.5mm;min-width:0}
#offerDocument .vehicle-photo{width:100%;height:35mm;object-fit:contain}
#offerDocument .document-total{font-size:13pt;font-weight:bold;background:#193425;color:white;padding:2.5mm;border-radius:1.5mm;display:flex;justify-content:space-between;gap:2mm;break-inside:avoid}
#offerDocument .document-small{font-size:7pt;color:#52685a}
#offerDocument footer{font-size:7pt;overflow-wrap:anywhere;border-top:1px solid #d7e4d7;margin-top:3mm;padding-top:1mm}
}`;
const money=pence=>Number(pence/100).toLocaleString('en-GB',{style:'currency',currency:'GBP'});
const stamp=value=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Europe/London'}):'';
export function prepareOfferDocument(model,doc=document){
 let root=doc.getElementById('offerDocument');if(!root){root=doc.createElement('article');root.id='offerDocument';doc.body.append(root)}root.replaceChildren();
 if(!doc.getElementById('offerDocumentStyles')){const style=doc.createElement('style');style.id='offerDocumentStyles';style.textContent=OFFER_PRINT_CSS;doc.head.append(style)}
 const final=model.finalAgreement,content=final?.content||model.content,c=content.calculation;
 const el=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=String(text);return node};
 const add=(root,tag,text,cls)=>{const n=el(tag,text);if(cls)n.className=cls;root.append(n);return n};
 const header=add(root,'header'),branding=add(header,'div'),logo=add(branding,'img');logo.src='/assets/Priceless%20Auto%20Services%20Logo.png';logo.alt='Priceless Auto Services';logo.onerror=()=>logo.remove();add(branding,'p','PRICELESS AUTO SERVICES LTD');add(branding,'p','pricelessfinance.co.uk','document-small');const title=add(header,'div');add(title,'h1',final?'FINAL AGREED OFFER':'PROVISIONAL OFFER');add(title,'p',final?'Reference '+final.reference:'Subject to customer confirmation');add(title,'p',final?'Locked '+stamp(final.lockedAt)+' UK':'Prepared '+stamp(model.preparedAt||new Date().toISOString())+' UK','document-small');
 const grid=add(root,'div',undefined,'document-grid'),customer=add(grid,'section');add(customer,'h2','Customer');for(const value of [content.customer.name,content.customer.phone,content.customer.email])if(value)add(customer,'p',value);const vehicle=add(grid,'section');add(vehicle,'h2','Vehicle');const v=content.vehicle;add(vehicle,'p',v.title||[v.make,v.model].filter(Boolean).join(' '));add(vehicle,'p',v.registration||'');
 const photo=String(v.photoUrls||'').split(/\r?\n/).map(x=>x.trim()).find(x=>/^https:\/\//.test(x));if(photo){const img=add(vehicle,'img',undefined,'vehicle-photo');img.src=photo;img.alt='Vehicle photo';img.onerror=()=>img.remove();}const specs=[['Make',v.make],['Model',v.model],['Year',v.year],['Mileage',v.mileage],['Fuel',v.fuel],['Transmission',v.gearbox],['Engine',v.engine],['Seats',v.seats],['Doors',v.doors],['Colour',v.colour],['Body type',v.bodyType],['Service history',v.serviceHistory],['Keys',v.keys],['MOT expiry',v.motExpiry],['Road tax',v.roadTax],['Previous keepers',v.previousKeepers],['Timing system',v.cambelt],['Last service',v.lastService],['Last work',v.lastWork]];
 const calculator=add(grid,'section');const table=(headers,rows,parent=calculator)=>{const t=add(parent,'table'),head=add(t,'thead'),hr=add(head,'tr');for(const h of headers)add(hr,'th',h);const body=add(t,'tbody');for(const values of rows){const tr=add(body,'tr');for(const value of values)add(tr,'td',value)}return t};
 table(['Specification','Details'],specs.filter(([,value])=>value!==null&&value!==undefined&&String(value).trim()!==''),vehicle);
 if(v.description){add(vehicle,'h2','Vehicle description');add(vehicle,'p',v.description)}
 add(calculator,'h2','Vehicle Price Breakdown');
 const vat=content.vehicleVat===true, originalNet=vat?Math.round(c.originalVehiclePence/1.2):c.originalVehiclePence;
 const priceRows=[['Original Screen Price',money(c.originalVehiclePence)]];
 if(vat)priceRows.push(['Net screen price',money(originalNet)],['VAT (20%)',money(c.originalVehiclePence-originalNet)]);
 priceRows.push(['Vehicle Discount',money(c.vehicleDiscountPence)]);
 if(vat&&c.vehicleDiscountPence)priceRows.push(['Net discount',money(originalNet-c.vehicle.netPence)],['VAT reduction',money(c.originalVehiclePence-originalNet-c.vehicle.vatPence)]);
 priceRows.push(['Personalised Vehicle Price',money(c.vehicle.grossPence)]);
 if(vat)priceRows.push(['Net vehicle price',money(c.vehicle.netPence)],['VAT (20%)',money(c.vehicle.vatPence)]);
 const breakdown=table(['Description','Amount'],priceRows);breakdown.className='price-breakdown';for(const tr of breakdown.tBodies[0].rows){if(['Original Screen Price','Personalised Vehicle Price','Vehicle Discount'].includes(tr.cells[0].textContent))tr.className=tr.cells[0].textContent==='Vehicle Discount'?'saving':'price-highlight';}
 const benefits=c.lines.filter(x=>x.active&&['included','free'].includes(x.type));
 if(benefits.length){add(customer,'h2','Included Benefits');for(const line of benefits){const p=add(customer,'p',undefined,'benefit');add(p,'strong',line.title+' · '+(line.type==='free'?'FREE':'Included'));if(line.description)add(p,'span',line.description,'document-small');if(line.savingsPence)add(p,'span','Saving '+money(line.savingsPence),'document-small');}}
 add(calculator,'h2','Package Calculator');const rows=[];
 for(const line of c.lines.filter(x=>x.active&&!['included','free'].includes(x.type))){rows.push([line.title+(line.description?'\n'+line.description:'')+(line.savingsPence?'\nSaving '+money(line.savingsPence):''),money(line.netPence),line.vat?money(line.vatPence):'—',line.grossPence===0?'FREE':money(line.grossPence)]);}
 const w=content.warranty;if(w?.months){const gross=Math.round(c.warrantyAmount*100),net=w.vat?Math.round(gross/1.2):gross;rows.push([w.months+' Months Extended Warranty · '+(w.category||'Category awaiting review')+'\n'+(w.status==='confirmed'?'Confirmed':w.status==='review'?'Estimate':'Awaiting customer reconfirmation'),money(net),w.vat?money(gross-net):'—',gross===0?'FREE':money(gross)]);}
 if(rows.length)table(['Product','Net','VAT','Total'],rows).className='financial';
 add(calculator,'p','Additional products: '+money(c.purchasePence-c.vehicle.grossPence));
 if(w?.months){add(calculator,'p',w.taxConfirmed?'Warranty tax treatment: '+w.taxTreatment+'. Provider: '+w.provider+'. Evidence: '+w.taxEvidence:'Warranty tax treatment requires provider evidence.','document-small');}
 const px=content.valuation;const scenario=provisionalPX(c,px);if(px)renderPXSummary(vehicle,px,n=>money(Math.round(n*100)));if(scenario){add(calculator,'p','Current balance before provisional PX: '+money(c.totalPence));add(calculator,'p','Provisional PX adjustment: '+money(scenario.adjustment));add(calculator,'p','Subject to acceptance and final verification.');}
 add(calculator,'h2','Payment summary');table(['Description','Amount'],balanceLines(c).map(([label,pence])=>[label,money(pence)]));add(calculator,'h2','YOUR TOTAL SAVINGS: '+money(c.savingsPence));const total=add(calculator,'div',undefined,'document-total');add(total,'span',scenario?'Estimated balance including provisional PX':c.totalPence<0?'Amount overpaid':'Balance remaining');add(total,'strong',money(scenario?scenario.totalPence:Math.abs(c.totalPence)));
 if(content.payments?.length){add(calculator,'h2','Recorded payments and refunds');table(['Date and record','Method and reference','Amount'],content.payments.map(x=>[stamp(x.receivedAt)+' UK\n'+x.kind,x.method+' · '+x.reference,money(x.amountPence)]));}
 if(final){const footer=add(root,'footer');add(footer,'p','Customer confirmed package '+final.confirmationRevision+'. Final agreement '+final.reference+'.');add(footer,'p','Agreement integrity reference: '+final.hash);}
 else add(root,'footer','Provisional offer. The saved agreement will be issued after the current package is confirmed and finalised.');
 return root;
}
export async function printOfferDocument(model,source='admin'){const root=prepareOfferDocument(model);await Promise.all([...root.querySelectorAll('img')].map(img=>Promise.race([img.decode().catch(()=>img.remove()),new Promise(resolve=>setTimeout(resolve,2500))])));const content=model.finalAgreement?.content||model.content;const clean=value=>String(value||'').replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim();const name=clean(content.customer?.name)||'Customer';const reg=clean(content.vehicle?.registration).toUpperCase()||'Registration unknown';const originalTitle=document.title;const restore=()=>{document.title=originalTitle};window.addEventListener('afterprint',restore,{once:true});document.title=['Offer',source==='customer'?'Priceless Auto Services':'',name,reg].filter(Boolean).join(' ');try{window.print()}catch(error){window.removeEventListener('afterprint',restore);restore();throw error}return root}
