export type PushKind = "reminder" | "shared_note" | "shared_note_update" | "event" | "workspace" | "test";
export type PushMessageInput = {
 kind:PushKind; subtype?:string; actor?:string|null; actorId?:string|null; workspace?:string|null;
 itemTitle?:string|null; when?:string|Date|null; role?:"editor"|"viewer"|"owner"|string|null;
 workspaceId?:string|null; resourceType?:"note"|"event"|"reminder"|"workspace"|string|null; resourceId?:string|null;
 notificationId?:string|null; url?:string; tag?:string; important?:boolean;
};

export function safePushMessage(kind:PushKind):{title:string;body:string}{
 switch(kind){
  case "reminder":return{title:"Reminder due",body:"A reminder is due. Open KitaNotes to review it."};
  case "shared_note":return{title:"New shared note",body:"Someone added a note in a shared workspace. Open KitaNotes to view it."};
  case "shared_note_update":return{title:"Shared note changed",body:"A shared note was updated or removed. Open KitaNotes to review it."};
  case "event":return{title:"Calendar activity",body:"A calendar event was created, changed or cancelled. Open KitaNotes to review it."};
  case "workspace":return{title:"Workspace activity",body:"Your workspace membership or permissions changed. Open KitaNotes to review it."};
  default:return{title:"KitaNotes",body:"Push notifications are connected on this device."};
 }
}
function clean(value:string):string{
 return value.replace(/<[^>]*>/g," ").replace(/[\r\n\t]+/g," ").replace(/[\u0000-\u001f\u007f-\u009f]/g," ").replace(/!\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/[*_~>#\[\]]/g,"").replace(/`/g,"").replace(/\s+/g," ").trim();
}
export function truncatePushText(value:string,max:number):string{
 const chars=Array.from(clean(value));
 if(chars.length<=max)return chars.join("");
 const limit=Math.max(1,max-1),slice=chars.slice(0,limit).join("");
 const boundary=slice.lastIndexOf(" ");
 return (boundary>Math.floor(limit*.55)?slice.slice(0,boundary):slice.trimEnd())+"…";
}
export function formatPushWhen(value:string|Date|null|undefined,timeZone="Asia/Kuala_Lumpur"):string|null{
 if(!value)return null;
 const date=value instanceof Date?value:new Date(value);
 if(Number.isNaN(date.getTime()))return null;
 try{
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone,weekday:"short",day:"numeric",month:"short",hour:"numeric",minute:"2-digit",hour12:true}).formatToParts(date);
  const part=(type:string)=>parts.find(item=>item.type===type)?.value??"";
  return part("weekday")+" "+part("day")+" "+part("month")+", "+part("hour")+":"+part("minute")+" "+part("dayPeriod").toUpperCase();
 }catch{return null;}
}
function detailed(message:PushMessageInput,timeZone:string):{title:string;body:string}|null{
 const actor=message.actor?clean(message.actor):"";
 const ws=message.workspace?clean(message.workspace):"";
 const item=clean(message.itemTitle??"")||"Untitled note";
 const when=formatPushWhen(message.when,timeZone);
 switch(message.kind){
  case "shared_note":
  case "shared_note_update":{
   if(!actor||!ws)return null;
   const action=message.subtype;
   const verb=action==="created"?"added":action==="archived"?"archived":action==="deleted"?"deleted":action==="restored"?"restored":"edited";
   return{title:actor+" "+verb+" a note",body:item+" · "+ws};
  }
  case "event":{
   if(!actor||!when)return null;
   if(message.subtype==="created"){if(!ws)return null;return{title:"New event: "+item,body:when+" · added by "+actor+" · "+ws};}
   if(message.subtype==="moved")return{title:"Event moved: "+item,body:"Now "+when+" · "+actor};
   if(message.subtype==="cancelled")return{title:"Event cancelled: "+item,body:"Was "+when+" · "+actor};
   return{title:"Event updated: "+item,body:when+" · "+actor};
  }
  case "reminder":{
   if(!ws||!message.itemTitle)return null;
   return{title:"Reminder: "+clean(message.itemTitle),body:when?"Due "+when:"Due now · "+ws};
  }
  case "workspace":{
   if(!ws&&message.subtype!=="removed"&&message.subtype!=="deleted")return null;
   if(message.subtype==="invitation_accepted"&&actor)return{title:actor+" joined "+ws,body:"They can now access shared notes."};
   if(message.subtype==="role_changed"&&message.role)return{title:"Your role changed in "+ws,body:"You are now "+(message.role==="editor"?"Editor":"Viewer")+"."};
   if(message.subtype==="member_removed")return{title:"Removed from "+ws,body:"You no longer have access to this workspace."};
   if(message.subtype==="member_left"&&actor)return{title:actor+" left "+ws,body:"Their access has been removed."};
   if(message.subtype==="ownership_transferred")return{title:"You are now the owner of "+ws,body:"You can manage members and settings."};
   if(message.subtype==="invitation_received"&&actor)return{title:actor+" invited you to "+ws,body:"Tap to accept or decline."};
   if(message.subtype==="private"||message.subtype==="deleted")return{title:ws+" is no longer shared",body:"You no longer have access."};
   return null;
  }
  default:return null;
 }
}
export function buildPushContent(message:PushMessageInput,previewMode:"detailed"|"generic"="generic",timeZone="Asia/Kuala_Lumpur"):{title:string;body:string}{
 const fallback=safePushMessage(message.kind);
 if(previewMode==="generic")return fallback;
 const value=detailed(message,timeZone);
 if(!value||!clean(value.title)||!clean(value.body))return fallback;
 return{title:truncatePushText(value.title,60)||fallback.title,body:truncatePushText(value.body,120)||fallback.body};
}
export function validPushUrl(value:unknown):value is string{
 return typeof value==="string"&&value.startsWith("/")&&!value.startsWith("//")&&!value.includes(String.fromCharCode(92))&&!/[\r\n\u0000-\u001f]/.test(value);
}
export function validPushTag(value:unknown):value is string{
 return typeof value==="string"&&value.length>0&&value.length<=64&&/^[a-z0-9:_-]+$/.test(value);
}
export function defaultPushUrl(message:PushMessageInput):string{
 const ws=message.workspaceId?encodeURIComponent(message.workspaceId):"";
 if(message.kind==="workspace"&&message.subtype==="member_removed"||message.kind==="workspace"&&message.subtype==="private"||message.kind==="workspace"&&message.subtype==="deleted")return"/";
 const params=new URLSearchParams();
 if(ws)params.set("workspaceId",message.workspaceId!);
 if(message.resourceType==="note"&&message.resourceId)params.set("noteId",message.resourceId);
 else if(message.resourceType==="event"&&message.resourceId)params.set("eventId",message.resourceId);
 else if(message.resourceType==="reminder"&&message.resourceId)params.set("reminderId",message.resourceId);
 else if(message.kind==="reminder"&&message.resourceId)params.set("reminderId",message.resourceId);
 return"/"+(params.size?"?"+params.toString():"");
}
export function defaultPushTag(message:PushMessageInput,userId:string):string{
 const prefix=message.resourceType==="note"?"note":message.resourceType==="event"?"event":message.resourceType==="reminder"?"reminder":"workspace";
 const id=message.resourceId??message.workspaceId??userId;
 return(prefix+":"+id).toLowerCase().replace(/[^a-z0-9:_-]/g,"-").slice(0,64);
}
