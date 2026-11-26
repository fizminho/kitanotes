import { sendPushToUser } from "./push.ts";
import { cleanupExpiredRateLimits } from "./rate-limit.ts";
type DueReminder={id:string;workspace_id:string;event_id:string|null;note_id:string|null;title:string;due_at_utc:string;timezone:string;active_event_id:string|null;active_note_id:string|null};

export function formatReminderDueAt(dueAtUtc:string,timeZone="Asia/Kuala_Lumpur"):string {
  const date=new Date(dueAtUtc);
  if(Number.isNaN(date.getTime()))return "at the scheduled time";
  let zone=timeZone;
  try{new Intl.DateTimeFormat("en-US",{timeZone:zone}).format(date);}catch{zone="Asia/Kuala_Lumpur";}
  const dateLabel=new Intl.DateTimeFormat("en-GB",{timeZone:zone,weekday:"short",day:"numeric",month:"short",year:"numeric"}).format(date);
  const timeLabel=new Intl.DateTimeFormat("en-US",{timeZone:zone,hour:"numeric",minute:"2-digit",hourCycle:"h12"}).format(date);
  const zoneLabel=zone==="Asia/Kuala_Lumpur"?"MYT":new Intl.DateTimeFormat("en-US",{timeZone:zone,timeZoneName:"short"}).formatToParts(date).find(part=>part.type==="timeZoneName")?.value??zone;
  return dateLabel+", "+timeLabel+" "+zoneLabel;
}

export async function deliverDueReminders(db:D1Database,env?:{VAPID_PUBLIC_KEY?:string;VAPID_PRIVATE_KEY?:string;VAPID_SUBJECT?:string}):Promise<number>{
  const now=new Date().toISOString();
  await cleanupExpiredRateLimits(db);
  await db.prepare("UPDATE reminders SET status='cancelled',cancelled_at=?,updated_at=? WHERE status='pending' AND due_at_utc<=? AND ((event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM calendar_events e WHERE e.id=reminders.event_id AND e.deleted_at IS NULL)) OR (note_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.id=reminders.note_id AND n.deleted_at IS NULL)))")
    .bind(now,now,now).run();

  // Resolve linked-resource validity in the same indexed query instead of issuing
  // up to two additional D1 reads for every due reminder.
  const due=await db.prepare("SELECT r.id,r.workspace_id,r.event_id,r.note_id,r.title,r.due_at_utc,r.timezone,e.id AS active_event_id,n.id AS active_note_id FROM reminders r LEFT JOIN calendar_events e ON e.id=r.event_id AND e.deleted_at IS NULL LEFT JOIN notes n ON n.id=r.note_id AND n.deleted_at IS NULL WHERE r.status='pending' AND r.due_at_utc<=? ORDER BY r.due_at_utc LIMIT 25")
    .bind(now).all<DueReminder>();

  let deliveredCount=0;
  const workspaceMembers=new Map<string,string[]>();
  for(const reminder of due.results){
    const stale=(reminder.event_id!==null&&reminder.active_event_id===null)||(reminder.note_id!==null&&reminder.active_note_id===null);
    if(stale){
      await db.prepare("UPDATE reminders SET status='cancelled',cancelled_at=?,updated_at=? WHERE id=? AND status='pending'").bind(now,now,reminder.id).run();
      continue;
    }
    const resourceType=reminder.event_id?"event":reminder.note_id?"note":"reminder";
    const resourceId=reminder.event_id??reminder.note_id??reminder.id;
    const dueLabel=formatReminderDueAt(reminder.due_at_utc,reminder.timezone);
    const insertNotification=db.prepare("INSERT OR IGNORE INTO notifications (id,user_id,workspace_id,notification_type,title,body,resource_type,resource_id,idempotency_key,created_at) SELECT lower(hex(randomblob(16))),wm.user_id,?,'reminder',?,?,?,?,'reminder:'||?||':'||wm.user_id,? FROM workspace_members wm WHERE wm.workspace_id=?")
      .bind(reminder.workspace_id,"Reminder: "+reminder.title,"Due: "+dueLabel,resourceType,resourceId,reminder.id,now,reminder.workspace_id);
    const markDelivered=db.prepare("UPDATE reminders SET status='delivered',delivered_at=?,updated_at=? WHERE id=? AND status='pending' AND due_at_utc<=?")
      .bind(now,now,reminder.id,now);
    const results=await db.batch([insertNotification,markDelivered]);
    const changed=Number((results[1] as {meta?:{changes?:number}})?.meta?.changes??0);
    if(changed>0){
      deliveredCount++;
      if(env){
        let members=workspaceMembers.get(reminder.workspace_id);
        if(!members){
          const result=await db.prepare("SELECT user_id FROM workspace_members WHERE workspace_id=?").bind(reminder.workspace_id).all<{user_id:string}>();
          members=result.results.map(member=>member.user_id);
          workspaceMembers.set(reminder.workspace_id,members);
        }
        await Promise.all(members.map(userId=>sendPushToUser(db,env,userId,{title:("Reminder: "+reminder.title).slice(0,80),body:"Due: "+dueLabel,url:"/?workspaceId="+encodeURIComponent(reminder.workspace_id)+(reminder.event_id?"&eventId="+encodeURIComponent(reminder.event_id):reminder.note_id?"&noteId="+encodeURIComponent(reminder.note_id):""),tag:"reminder-"+reminder.id},"reminder",{workspaceId:reminder.workspace_id,important:true})));
      }
    }
  }
  return deliveredCount;
}
