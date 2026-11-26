import {balanceLines} from './offer-calculation.js?release=20261126_final';

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
 add(calculator,'h2','Calculator');add(calculator,'p','Original vehicle price: '+money(c.originalVehiclePence));add(calculator,'p','Vehicle discount: '+money(c.vehicleDiscountPence));const rows=[['Vehicle',content.vehicleVat?'VAT included':'Gross price',money(c.vehicle.grossPence),money(c.vehicle.vatPence)]];
 for(const line of c.lines.filter(x=>x.active)){const mode=line.type==='included'?'Included':line.type==='free'?'FREE':line.extraMode==='required'?'Mandatory':line.type==='optional'||line.type==='offered'?'Optional selected':'Charged';rows.push([line.title+(line.description?'\n'+line.description:''),mode+(line.savingsPence?'\nSaving '+money(line.savingsPence):''),['included','free'].includes(line.type)?mode:money(line.grossPence),line.vat?money(line.vatPence):'']);}
 const w=content.warranty;if(w?.months)rows.push([w.months+' Months Extended Warranty · '+(w.category||'Category awaiting review'),w.status==='confirmed'?'Confirmed':w.status==='review'?'Estimate':'Awaiting customer reconfirmation',c.warrantyAmount===0?'FREE':money(Math.round(c.warrantyAmount*100)),w.vat?money(Math.round(c.warrantyAmount*100)-Math.round(c.warrantyAmount*100/1.2)):'']);
 table(['Product','Treatment','Gross','VAT'],rows).className='financial';
 if(w?.months){add(calculator,'p',w.taxConfirmed?'Warranty tax treatment: '+w.taxTreatment+'. Provider: '+w.provider+'. Evidence: '+w.taxEvidence:'Warranty tax treatment requires provider evidence.','document-small');}
 const px=content.valuation;if(px){add(calculator,'h2','Part exchange');add(calculator,'p',(px.registration||'')+' · '+px.status);if(px.status==='accepted'){table(['Valuation','Settlement','Net allowance'],[[money(Math.round(px.value*100)),money(Math.round(px.settlement*100)),money(Math.round(px.net*100))]]);if(px.net<0)add(calculator,'p','Separate negative equity agreement: '+px.negativeEquityExplanation);}}
 add(calculator,'h2','Payment summary');table(['Description','Amount'],balanceLines(c).map(([label,pence])=>[label,money(pence)]));add(calculator,'p','Total savings: '+money(c.savingsPence));const total=add(calculator,'div',undefined,'document-total');add(total,'span',c.totalPence<0?'Amount overpaid':'Balance remaining');add(total,'strong',money(Math.abs(c.totalPence)));
 if(content.payments?.length){add(calculator,'h2','Recorded payments and refunds');table(['Date and record','Method and reference','Amount'],content.payments.map(x=>[stamp(x.receivedAt)+' UK\n'+x.kind,x.method+' · '+x.reference,money(x.amountPence)]));}
 if(final){const footer=add(root,'footer');add(footer,'p','Customer confirmed package '+final.confirmationRevision+'. Final agreement '+final.reference+'.');add(footer,'p','Agreement integrity reference: '+final.hash);}
 else add(root,'footer','Provisional offer. The saved agreement will be issued after the current package is confirmed and finalised.');
 return root;
}
export async function printOfferDocument(model){const root=prepareOfferDocument(model);await Promise.all([...root.querySelectorAll('img')].map(img=>Promise.race([img.decode().catch(()=>img.remove()),new Promise(resolve=>setTimeout(resolve,2500))])));window.print();return root}
