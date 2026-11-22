function zonedLocalToUtc(value:string,timezone:string):string|null {
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if(!match)return null;
  const target=Date.UTC(+match[1],+match[2]-1,+match[3],+match[4],+match[5]);
  let guess=target;
  try {
    for(let i=0;i<3;i++){
      const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess));
      const part=(key:string)=>Number(parts.find(item=>item.type===key)?.value??0);
      const represented=Date.UTC(part("year"),part("month")-1,part("day"),part("hour"),part("minute"),part("second"));
      const next=guess+target-represented;
      if(next===guess)break;
      guess=next;
    }
    return new Date(guess).toISOString();
  } catch { return null; }
}
function dateTimeInputForZone(value:Date,timezone:string):string {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(value);
  const part=(key:string)=>parts.find(item=>item.type===key)?.value??"00";
  return part("year")+"-"+part("month")+"-"+part("day")+"T"+part("hour")+":"+part("minute");
}
export function defaultReminderDateTime(eventStartLocal:string,timezone="Asia/Kuala_Lumpur",now=new Date()):string {
  const match=eventStartLocal.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if(!match)return "";
  const previousDay=new Date(Date.UTC(+match[1],+match[2]-1,+match[3]-1,+match[4],+match[5]));
  const pad=(value:number)=>String(value).padStart(2,"0");
  const dueLocal=previousDay.getUTCFullYear()+"-"+pad(previousDay.getUTCMonth()+1)+"-"+pad(previousDay.getUTCDate())+"T"+pad(previousDay.getUTCHours())+":"+pad(previousDay.getUTCMinutes());
  let zone=timezone;
  try{new Intl.DateTimeFormat("en-US",{timeZone:zone}).format(now);}catch{zone="Asia/Kuala_Lumpur";}
  const dueUtc=zonedLocalToUtc(dueLocal,zone);
  if(!dueUtc||new Date(dueUtc).getTime()<=now.getTime())return dateTimeInputForZone(new Date(now.getTime()+5*60_000),zone);
  return dueLocal;
}
