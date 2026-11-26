type PollTask=(signal:AbortSignal)=>Promise<void>;
type PollEntry={key:string;intervalMs:number;task:PollTask;refs:number;failures:number;timer:number|null;controller:AbortController|null;inFlight:boolean};
const entries=new Map<string,PollEntry>();
let lastSuccessfulSyncAt:string|null=null;
type SyncStatus="up-to-date"|"syncing"|"paused";
function emitStatus(){if(typeof window==="undefined")return;const status:SyncStatus=!canPoll()||[...entries.values()].some(entry=>entry.failures>=2)?"paused":[...entries.values()].some(entry=>entry.inFlight)?"syncing":"up-to-date";window.dispatchEvent(new CustomEvent("kitanotes:sync-status",{detail:{status,updatedAt:lastSuccessfulSyncAt}}));}
let listenersInstalled=false;
export function pollDelay(intervalMs:number,failures:number,random=Math.random()):number{
  const backedOff=Math.min(60000,intervalMs*Math.pow(2,Math.max(0,failures)));
  return Math.round(backedOff*(0.9+Math.max(0,Math.min(1,random))*0.2));
}
function canPoll(){return typeof document!=="undefined"&&typeof navigator!=="undefined"&&document.visibilityState==="visible"&&navigator.onLine;}
function clearTimer(entry:PollEntry){if(entry.timer!==null){window.clearTimeout(entry.timer);entry.timer=null;}}
function pause(entry:PollEntry){clearTimer(entry);entry.controller?.abort();}
function schedule(entry:PollEntry,immediate=false){
  if(entries.get(entry.key)!==entry||!canPoll()||entry.inFlight)return;
  clearTimer(entry);
  const delay=immediate?0:pollDelay(entry.intervalMs,entry.failures);
  entry.timer=window.setTimeout(()=>{entry.timer=null;void execute(entry);},delay);
}
async function execute(entry:PollEntry){
  if(entries.get(entry.key)!==entry||entry.inFlight||!canPoll())return;
  entry.inFlight=true;const controller=new AbortController();entry.controller=controller;emitStatus();
  try{await entry.task(controller.signal);if(!controller.signal.aborted){entry.failures=0;lastSuccessfulSyncAt=new Date().toISOString();}}
  catch(error){if(!(error instanceof DOMException&&error.name==="AbortError"))entry.failures=Math.min(8,entry.failures+1);}
  finally{entry.inFlight=false;if(entry.controller===controller)entry.controller=null;emitStatus();schedule(entry);}
}
function installListeners(){
  if(listenersInstalled||typeof document==="undefined"||typeof window==="undefined")return;
  listenersInstalled=true;
  const pauseAll=()=>{for(const entry of entries.values())pause(entry);emitStatus();};
  const resumeAll=()=>{if(canPoll())for(const entry of entries.values())schedule(entry,true);emitStatus();};
  document.addEventListener("visibilitychange",()=>{if(canPoll())resumeAll();else pauseAll();});
  window.addEventListener("online",resumeAll);
  window.addEventListener("offline",pauseAll);
}
export function refreshPolls(prefix:string){for(const entry of entries.values())if(entry.key.startsWith(prefix)){entry.failures=0;schedule(entry,true);}}
export function subscribePoll(key:string,intervalMs:number,task:PollTask):()=>void{
  installListeners();
  let entry=entries.get(key);
  if(!entry){entry={key,intervalMs,task,refs:0,failures:0,timer:null,controller:null,inFlight:false};entries.set(key,entry);}
  entry.refs++;
  if(entry.refs===1)schedule(entry,true);
  return()=>{
    const current=entries.get(key);if(current!==entry)return;
    current.refs=Math.max(0,current.refs-1);
    if(current.refs===0){pause(current);entries.delete(key);}
  };
}
