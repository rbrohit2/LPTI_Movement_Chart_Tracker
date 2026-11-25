import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.min.mjs";
import { parseMovementPages } from "./parser.js";
import { initCsrSection, initMarketSection, loadCsrs, loadMarkets } from "./csr.js";
import { allocateAll } from "./allocation.js";
import { buildRoster, ensurePins } from "./roster.js";
import { rpc } from "./supabase.js";
import { initUnassigned } from "./unassigned.js";
pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.mjs";

const $=s=>document.querySelector(s);
const state={rows:[],fileName:"",serviceDate:"",rawText:""};
const fields=["movementNo","serviceDate","guestGroupName","fh","fileCode","pax","movementType","mode","serviceNumber","scheduledTime","pickup","dropoff","reportingTime","vehicle","transporter","reportAt","assistanceRequired","remarks","csr"];
const headers={movementNo:"S.No.",serviceDate:"Date",guestGroupName:"FIT / Group",fh:"FH",fileCode:"File Code",pax:"Pax",movementType:"Type",mode:"Mode",serviceNumber:"Flight / Train",scheduledTime:"Scheduled",pickup:"Pickup",dropoff:"Drop",reportingTime:"Report / Pickup",vehicle:"Vehicle",transporter:"Transporter",reportAt:"Report At",assistanceRequired:"Reviewed?",remarks:"Remarks",csr:"CSR"};

$("#chooseBtn").onclick=()=>$("#pdfInput").click();
$("#dropZone").onclick=e=>{if(e.target.id!=="chooseBtn")$("#pdfInput").click()};
$("#dropZone").onkeydown=e=>{if(e.key==="Enter"||e.key===" ")$("#pdfInput").click()};
$("#pdfInput").onchange=e=>e.target.files[0]&&loadPdf(e.target.files[0]);
["dragenter","dragover"].forEach(n=>$("#dropZone").addEventListener(n,e=>{e.preventDefault();$("#dropZone").classList.add("drag")}));
["dragleave","drop"].forEach(n=>$("#dropZone").addEventListener(n,e=>{e.preventDefault();$("#dropZone").classList.remove("drag")}));
$("#dropZone").addEventListener("drop",e=>{const f=e.dataTransfer.files[0];if(f)loadPdf(f)});
$("#addRowBtn").onclick=()=>{state.rows.push(blankRow(state.rows.length+1));render()};
$("#allocateBtn").onclick=()=>{
  if(!state.rows.length){notify("Import a chart before allocating CSRs.",true);return}
  const csrs=loadCsrs(localStorage),markets=loadMarkets(localStorage);
  const out=allocateAll(state.rows,csrs,markets);
  for(const a of out){const r=state.rows.find(x=>x.movementNo===a.movementNo);if(!r)continue;
    const c=csrs.find(x=>x.id===a.csrId);r.csr=c?`${c.csrCode} · ${a.status}`:a.status;r.csrReason=a.reason;r.userEdited=false}
  const n=out.filter(a=>a.csrId).length;
  notify(`${n} of ${out.length} movement(s) allocated. Review any "Next best" or "Unassigned" rows.`,n<out.length);render();
};
$("#publishBtn").onclick=publishRoster;
initUnassigned(document,()=>state.serviceDate);
async function publishRoster(){
  if(!state.rows.length){notify("Import a chart and allocate CSRs before publishing.",true);return}
  const csrs=loadCsrs(localStorage),markets=loadMarkets(localStorage);
  if(!csrs.length){notify("Add CSRs before publishing.",true);return}
  const passcode=prompt("Operator passcode:");
  if(!passcode)return;
  const assignments=allocateAll(state.rows,csrs,markets);
  const pins=ensurePins(localStorage,csrs);
  const payload=buildRoster(state.rows,assignments,csrs,markets,pins,state.serviceDate);
  if(!payload.rows.length){notify("No movements need a CSR, nothing to publish.",true);return}
  notify("Publishing…");
  try{
    const count=await rpc("publish_roster",{p_pass:passcode,p_date:state.serviceDate,p_csrs:payload.csrs,p_rows:payload.rows});
    const pinText=csrs.map(c=>`${c.name} ${pins[c.csrCode]}`).join(" · ");
    notify(`Published ${count} booking(s) for ${state.serviceDate}. Share publish.html with CSRs. PINs: ${pinText}`);
    render();
  }catch(e){notify(`Publish failed: ${e.message}`,true)}
}
$("#saveBtn").onclick=saveLocal;
$("#exportBtn").onclick=exportCsv;
$("#resetBtn").onclick=resetAll;

function notify(text,error=false){const m=$("#message");m.textContent=text;m.className="message"+(error?" error":"")}
function progress(p,text){$("#progressWrap").classList.remove("hidden");$("#progressBar").style.width=p+"%";$("#progressText").textContent=text}
function blankRow(no=1){return{movementNo:no,serviceDate:state.serviceDate,guestGroupName:"",fh:"",fileCode:"",pax:"",movementType:"",mode:"FLIGHT",serviceNumber:"",scheduledTime:"",pickup:"",dropoff:"",reportingTime:"",vehicle:"",transporter:"",reportAt:"",assistanceRequired:"REVIEW",remarks:"",csr:"",needsReview:true,userEdited:false}}

async function loadPdf(file){
  if(file.type!=="application/pdf"&&!file.name.toLowerCase().endsWith(".pdf")){notify("Please select a PDF file.",true);return}
  try{
    notify("Reading PDF…");progress(8,"Reading file");state.fileName=file.name;
    const bytes=await file.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
    const pages=[];let allText=[];let pageWidth=0;
    for(let n=1;n<=pdf.numPages;n++){
      progress(10+Math.round((n/pdf.numPages)*55),`Extracting page ${n} of ${pdf.numPages}`);
      const page=await pdf.getPage(n);const content=await page.getTextContent();
      const viewport=page.getViewport({scale:1});pageWidth=viewport.width;
      // Coordinates are normalised by the viewport transform so the 90° stored rotation is handled.
      const items=content.items.map(i=>{const t=pdfjsLib.Util.transform(viewport.transform,i.transform);return {text:(i.str||"").trim(),x:t[4],y:t[5]}}).filter(i=>i.text);
      pages.push(items.map(i=>({s:i.text,x:i.x,y:i.y})));allText.push(items.slice().sort((a,b)=>a.y-b.y||a.x-b.x).map(i=>i.text).join(" "));
    }
    state.rawText=allText.join("\n\n--- PAGE ---\n\n");$("#rawText").value=state.rawText;
    progress(72,"Detecting chart date");state.serviceDate=detectDate(state.rawText);
    progress(80,"Building movement rows");
    const parsed=parseMovementPages(pages,state.serviceDate,{pageWidth});
    state.rows=parsed.rows;state.diagnostics=parsed.diagnostics;
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

function renderHeader(){
  const tr=$("#movementTable thead tr");tr.innerHTML="";
  fields.forEach(f=>{const th=document.createElement("th");th.textContent=headers[f];tr.appendChild(th)});
  tr.appendChild(document.createElement("th"));
}
function render(){
  renderHeader();
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

initCsrSection(document,localStorage);
initMarketSection(document,localStorage);
const saved=localStorage.getItem("lptiMovementMvp");if(saved){try{const x=JSON.parse(saved);Object.assign(state,x);if(state.rows?.length){$("#workspace").classList.remove("hidden");$("#rawText").value=state.rawText||"";notify(`Restored ${state.rows.length} locally saved movement row(s).`);render()}}catch{}}
