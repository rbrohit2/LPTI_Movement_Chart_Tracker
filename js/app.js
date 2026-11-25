import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.mjs";

const $=s=>document.querySelector(s);
const state={rows:[],fileName:"",serviceDate:"",rawText:""};
const fields=["movementNo","serviceDate","guestGroupName","fileCode","pax","movementType","mode","serviceNumber","scheduledTime","pickup","dropoff","reportingTime","vehicle","transporter","assistanceRequired","remarks"];
const headers={movementNo:"S.No.",serviceDate:"Date",guestGroupName:"FIT / Group",fileCode:"File Code",pax:"Pax",movementType:"Type",mode:"Mode",serviceNumber:"Flight / Train",scheduledTime:"Scheduled",pickup:"Pickup",dropoff:"Drop",reportingTime:"Report / Pickup",vehicle:"Vehicle",transporter:"Transporter",assistanceRequired:"Assist?",remarks:"Remarks"};

$("#chooseBtn").onclick=()=>$("#pdfInput").click();
$("#dropZone").onclick=e=>{if(e.target.id!=="chooseBtn")$("#pdfInput").click()};
$("#dropZone").onkeydown=e=>{if(e.key==="Enter"||e.key===" ")$("#pdfInput").click()};
$("#pdfInput").onchange=e=>e.target.files[0]&&loadPdf(e.target.files[0]);
["dragenter","dragover"].forEach(n=>$("#dropZone").addEventListener(n,e=>{e.preventDefault();$("#dropZone").classList.add("drag")}));
["dragleave","drop"].forEach(n=>$("#dropZone").addEventListener(n,e=>{e.preventDefault();$("#dropZone").classList.remove("drag")}));
$("#dropZone").addEventListener("drop",e=>{const f=e.dataTransfer.files[0];if(f)loadPdf(f)});
$("#addRowBtn").onclick=()=>{state.rows.push(blankRow(state.rows.length+1));render()};
$("#saveBtn").onclick=saveLocal;
$("#exportBtn").onclick=exportCsv;
$("#resetBtn").onclick=resetAll;

function notify(text,error=false){const m=$("#message");m.textContent=text;m.className="message"+(error?" error":"")}
function progress(p,text){$("#progressWrap").classList.remove("hidden");$("#progressBar").style.width=p+"%";$("#progressText").textContent=text}
function blankRow(no=1){return{movementNo:no,serviceDate:state.serviceDate,guestGroupName:"",fileCode:"",pax:"",movementType:"",mode:"FLIGHT",serviceNumber:"",scheduledTime:"",pickup:"",dropoff:"",reportingTime:"",vehicle:"",transporter:"",assistanceRequired:"REVIEW",remarks:"",needsReview:true,userEdited:false}}

async function loadPdf(file){
  if(file.type!=="application/pdf"&&!file.name.toLowerCase().endsWith(".pdf")){notify("Please select a PDF file.",true);return}
  try{
    notify("Reading PDF…");progress(8,"Reading file");state.fileName=file.name;
    const bytes=await file.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
    const pages=[];let allText=[];
    for(let n=1;n<=pdf.numPages;n++){
      progress(10+Math.round((n/pdf.numPages)*55),`Extracting page ${n} of ${pdf.numPages}`);
      const page=await pdf.getPage(n);const content=await page.getTextContent();
      const viewport=page.getViewport({scale:1});
      const items=content.items.map(i=>{const t=pdfjsLib.Util.transform(viewport.transform,i.transform);return {text:(i.str||"").trim(),x:t[4],y:t[5],w:Math.abs(i.width),h:Math.abs(i.height),pageWidth:viewport.width,pageHeight:viewport.height}}).filter(i=>i.text);
      pages.push(items);allText.push(items.sort((a,b)=>Math.abs(a.y-b.y)>2?b.y-a.y:a.x-b.x).map(i=>i.text).join(" "));
    }
    state.rawText=allText.join("\n\n--- PAGE ---\n\n");$("#rawText").value=state.rawText;
    progress(72,"Detecting chart date");state.serviceDate=detectDate(state.rawText);
    progress(80,"Building movement rows");state.rows=parsePages(pages);
    if(!state.rows.length) state.rows=parseTextFallback(state.rawText);
    if(!state.rows.length){state.rows=[blankRow(1)];notify("The PDF text was read, but movement rows were not confidently detected. A blank editable row has been opened; use diagnostics to tune the parser.",true)}
    else notify(`${state.rows.length} movement row(s) extracted. Review highlighted rows before saving.`);
    progress(100,"Complete");setTimeout(()=>$("#progressWrap").classList.add("hidden"),700);
    $("#workspace").classList.remove("hidden");$("#fileMeta").textContent=`${file.name} · ${pdf.numPages} page(s) · review highlighted values before saving.`;render();
  }catch(err){console.error(err);notify("Could not read the PDF. Confirm it is not password-protected and try again.",true);$("#progressWrap").classList.add("hidden")}
}

function detectDate(text){
  const m=text.match(/\b(\d{1,2})[-\s](JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-\s](20\d{2})\b/i);
  if(!m)return new Date().toISOString().slice(0,10);
  const months={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
  const d=new Date(Date.UTC(+m[3],months[m[2].toUpperCase()],+m[1]));return d.toISOString().slice(0,10)
}

function parsePages(pages){
  const rows=[];
  for(const items of pages){
    if(!items.length) continue;
    const width=items[0].pageWidth, height=items[0].pageHeight;
    const header=findHeader(items,width,height);
    // Serial numbers live in the first narrow table column. Coordinates are normalized for page rotation.
    let serials=items.filter(i=>/^\d{1,2}$/.test(i.text)&&i.x < width*.055&&i.y>header.bodyTop&&i.y<header.footerTop)
      .sort((a,b)=>a.y-b.y);
    // Remove page/header numbers and duplicated text fragments.
    serials=serials.filter((v,i,a)=>!i||Math.abs(v.y-a[i-1].y)>3||v.text!==a[i-1].text);
    for(let n=0;n<serials.length;n++){
      const cur=serials[n], prev=serials[n-1], next=serials[n+1];
      const top=prev?(prev.y+cur.y)/2:header.bodyTop;
      const bottom=next?(cur.y+next.y)/2:header.footerTop;
      const band=items.filter(i=>i.y>=top&&i.y<bottom&&!(i.text===cur.text&&Math.abs(i.y-cur.y)<3));
      const row=interpretColumns(+cur.text,band,width,header);
      if(row&&row.fileCode) rows.push(row);
    }
  }
  const seen=new Set();
  return rows.filter(r=>{const k=`${r.movementNo}|${r.fileCode}|${r.serviceNumber}|${r.scheduledTime}`;if(seen.has(k))return false;seen.add(k);return true})
    .sort((a,b)=>a.movementNo-b.movementNo);
}

function findHeader(items,width,height){
  function labelX(re,fallback){const m=items.filter(i=>re.test(i.text)&&i.y<height*.24).sort((a,b)=>a.y-b.y);return m[0]?.x??fallback}
  const x={
    no:0,
    name:width*.045,
    arrival:labelX(/^Arrival$/i,width*.31),
    departure:labelX(/^Departure$/i,width*.41),
    pickup:labelX(/^Pickup$/i,width*.51),
    dropoff:labelX(/^Dropoff$/i,width*.60),
    assist:labelX(/Trnsfr/i,width*.68),
    vehicle:width*.725,
    transporter:width*.835,
    pickupTime:width*.925,
    remarks:width*.965,
    end:width
  };
  const duty=items.filter(i=>/Night Duty:/i.test(i.text)).map(i=>i.y);
  const footer=items.filter(i=>/Page\s*\d+\s*of\s*\d+/i.test(i.text)).map(i=>i.y);
  return {x,bodyTop:duty.length?Math.max(...duty)+8:height*.20,footerTop:footer.length?Math.min(...footer)-8:height*.95};
}

function clean(parts){return parts.sort((a,b)=>a.y-b.y||a.x-b.x).map(x=>x.text.trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').trim()}
function byRange(items,a,b){return items.filter(i=>i.x>=a&&i.x<b)}
function allTimes(text){return [...text.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g)].map(m=>`${m[1].padStart(2,'0')}:${m[2]}`)}
function serviceNo(text){const all=[...text.matchAll(/\b(?:[A-Z]{1,3}[- ]?\d{2,5}|\d{4,5})\b/g)].map(m=>m[0]);return all.find(v=>!/^20\d{2}$/.test(v))?.replace(/\s/g,'')||''}
function stripMovementMeta(text){return text.replace(/\b(?:[A-Z]{1,3}[- ]?\d{2,5}|\d{4,5})\b/g,'').replace(/\b(?:[01]?\d|2[0-3])[:.]([0-5]\d)\b/g,'').replace(/\s+/g,' ').trim()}

function interpretColumns(no,items,width,header){
  const x=header.x;
  const name=clean(byRange(items,x.name,x.arrival));
  const arr=clean(byRange(items,x.arrival,x.departure));
  const dep=clean(byRange(items,x.departure,x.pickup));
  const pickupCol=clean(byRange(items,x.pickup,x.dropoff));
  const dropCol=clean(byRange(items,x.dropoff,x.assist));
  const assistCol=clean(byRange(items,x.assist,x.vehicle));
  const vehicleCol=clean(byRange(items,x.vehicle,x.transporter));
  const transporterCol=clean(byRange(items,x.transporter,x.pickupTime));
  const pickupTimeCol=clean(byRange(items,x.pickupTime,x.remarks));
  const remarksCol=clean(byRange(items,x.remarks,x.end));
  const whole=clean(items);
  const fc=(name.match(/FC:\s*([A-Z0-9-]+)/i)||whole.match(/FC:\s*([A-Z0-9-]+)/i)||[])[1]||'';
  const pax=(name.match(/\)\s*X\s*(\d{1,3})/i)||name.match(/\bX\s*(\d{1,3})\s*PAX/i)||[])[1]||'';
  let guest=name.replace(/\(?FC:\s*[A-Z0-9-]+\)?/ig,'').replace(/\b[A-Z]{1,3}\s*\(\s*\)/g,'').replace(/\bX\s*\d{1,3}\b/ig,'').replace(/\bPAX\b/ig,'').replace(/\s+/g,' ').trim();
  // Remove short operator initials left directly before FC.
  guest=guest.replace(/\b[A-Z]{1,3}\s*$/,'').trim();
  const arrTimes=allTimes(arr),depTimes=allTimes(dep),reportTimes=allTimes(pickupTimeCol);
  const arrService=serviceNo(arr),depService=serviceNo(dep);
  const hasArr=!!arrService||arrTimes.length>0,hasDep=!!depService||depTimes.length>0;
  const movementType=hasArr&&!hasDep?'ARRIVAL':hasDep&&!hasArr?'DEPARTURE':hasArr&&hasDep?'TRANSFER':'';
  const serviceNumber=movementType==='DEPARTURE'?depService:(arrService||depService);
  const scheduledTime=movementType==='DEPARTURE'?(depTimes.at(-1)||''):(arrTimes.at(-1)||depTimes.at(-1)||'');
  const assistanceText=`${assistCol} ${remarksCol}`;
  const noAssist=/NO\s+(ESCORT|ASSIST)/i.test(assistanceText);
  const yesAssist=/ASSIST|ESCORT|CSR|REP\b/i.test(assistanceText);
  const errors=[];if(!movementType)errors.push('MOVEMENT_TYPE');if(!scheduledTime)errors.push('SCHEDULED_TIME');
  return {movementNo:no,serviceDate:state.serviceDate,guestGroupName:guest,fileCode:fc,pax,movementType,mode:/TRAIN|RAIL/i.test(whole)||/^\d{4,5}$/.test(serviceNumber)?'TRAIN':'FLIGHT',serviceNumber,scheduledTime,pickup:stripMovementMeta(pickupCol),dropoff:stripMovementMeta(dropCol),reportingTime:reportTimes.at(-1)||'',vehicle:vehicleCol,transporter:transporterCol,assistanceRequired:noAssist?'NO':yesAssist?'YES':'REVIEW',remarks:remarksCol||assistCol,needsReview:errors.length>0,userEdited:false,validationErrors:errors};
}
function parseTextFallback(text){
  const chunks=text.split(/(?=\b\d{1,3}\s+(?=[A-Z]))/g),rows=[];
  chunks.forEach((c,i)=>{const fc=(c.match(/\b[A-Z]{2,5}\d{6,10}\b/)||[])[0];if(!fc)return;const times=[...c.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g)].map(m=>`${m[1].padStart(2,"0")}:${m[2]}`);rows.push({...blankRow(rows.length+1),fileCode:fc,scheduledTime:times[0]||"",remarks:c.trim().slice(0,300)})});return rows
}

function render(){
  const tbody=$("#movementTable tbody");tbody.innerHTML="";
  state.rows.forEach((r,idx)=>{const tr=document.createElement("tr");tr.className=r.userEdited?"user-edited":r.needsReview?"needs-review":"";fields.forEach(f=>{const td=document.createElement("td");let el;
    if(f==="movementType"){el=select(["","ARRIVAL","DEPARTURE","TRANSFER","OTHER"],r[f])}
    else if(f==="mode"){el=select(["FLIGHT","TRAIN","ROAD","OTHER"],r[f])}
    else if(f==="assistanceRequired"){el=select(["REVIEW","YES","NO"],r[f])}
    else if(f==="remarks"){el=document.createElement("textarea");el.value=r[f]??""}
    else{el=document.createElement("input");el.value=r[f]??"";if(f==="serviceDate")el.type="date";if(["scheduledTime","reportingTime"].includes(f))el.type="time";if(["movementNo","pax"].includes(f))el.type="number"}
    el.title=headers[f];el.onchange=()=>{r[f]=el.value;r.userEdited=true;r.needsReview=validate(r).length>0;render()};td.appendChild(el);tr.appendChild(td)});
    const action=document.createElement("td"),del=document.createElement("button");del.className="icon-btn";del.title="Delete row";del.textContent="×";del.onclick=()=>{state.rows.splice(idx,1);render()};action.appendChild(del);tr.appendChild(action);tbody.appendChild(tr)});updateSummary()
}
function select(options,value){const s=document.createElement("select");options.forEach(o=>{const x=document.createElement("option");x.value=o;x.textContent=o||"Select";x.selected=o===value;s.appendChild(x)});return s}
function validate(r){const e=[];if(!r.serviceDate)e.push("date");if(!r.fileCode)e.push("file code");if(!r.movementType)e.push("type");if(!r.scheduledTime)e.push("time");return e}
function updateSummary(){$("#totalCount").textContent=state.rows.length;$("#arrivalCount").textContent=state.rows.filter(r=>r.movementType==="ARRIVAL").length;$("#departureCount").textContent=state.rows.filter(r=>r.movementType==="DEPARTURE").length;$("#reviewCount").textContent=state.rows.filter(r=>r.needsReview||validate(r).length).length}
function saveLocal(){localStorage.setItem("lptiMovementMvp",JSON.stringify({savedAt:new Date().toISOString(),...state}));notify(`${state.rows.length} movement row(s) saved in this browser.`)}
function exportCsv(){const q=v=>'"'+String(v??"").replaceAll('"','""')+'"';const csv=[fields.map(f=>q(headers[f])).join(","),...state.rows.map(r=>fields.map(f=>q(r[f])).join(","))].join("\r\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv"}));a.download=`movement-chart-${state.serviceDate||"export"}.csv`;a.click();URL.revokeObjectURL(a.href)}
function resetAll(){if(!confirm("Clear the current imported chart and unsaved edits?"))return;state.rows=[];state.rawText="";$("#workspace").classList.add("hidden");$("#message").classList.add("hidden");$("#pdfInput").value=""}

const saved=localStorage.getItem("lptiMovementMvp");if(saved){try{const x=JSON.parse(saved);Object.assign(state,x);if(state.rows?.length){$("#workspace").classList.remove("hidden");$("#rawText").value=state.rawText||"";notify(`Restored ${state.rows.length} locally saved movement row(s).`);render()}}catch{}}
