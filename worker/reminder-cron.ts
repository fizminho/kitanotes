import { sendPushToUser } from "./push.ts";
import { cleanupExpiredRateLimits } from "./rate-limit.ts";
type DueReminder={id:string;workspace_id:string;event_id:string|null;note_id:string|null;title:string;due_at_utc:string};

export async function deliverDueReminders(db:D1Database,env?:{VAPID_PUBLIC_KEY?:string;VAPID_PRIVATE_KEY?:string;VAPID_SUBJECT?:string}):Promise<number>{
  const now=new Date().toISOString();
  await cleanupExpiredRateLimits(db);
  await db.prepare("UPDATE reminders SET status='cancelled',cancelled_at=?,updated_at=? WHERE status='pending' AND due_at_utc<=? AND ((event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM calendar_events e WHERE e.id=reminders.event_id AND e.deleted_at IS NULL)) OR (note_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.id=reminders.note_id AND n.deleted_at IS NULL)))")
    .bind(now,now,now).run();

  const due=await db.prepare("SELECT id,workspace_id,event_id,note_id,title,due_at_utc FROM reminders WHERE status='pending' AND due_at_utc<=? ORDER BY due_at_utc LIMIT 25")
    .bind(now).all<DueReminder>();

  let deliveredCount=0;
  for(const reminder of due.results){
    let stale=false;
    if(reminder.event_id){
      const event=await db.prepare("SELECT id FROM calendar_events WHERE id=? AND deleted_at IS NULL").bind(reminder.event_id).first<{id:string}>();
      if(!event) stale=true;
    }
    if(reminder.note_id){
      const note=await db.prepare("SELECT id FROM notes WHERE id=? AND deleted_at IS NULL").bind(reminder.note_id).first<{id:string}>();
      if(!note) stale=true;
    }
    if(stale){
      await db.prepare("UPDATE reminders SET status='cancelled',cancelled_at=?,updated_at=? WHERE id=? AND status='pending'").bind(now,now,reminder.id).run();
      continue;
    }
    const resourceType=reminder.event_id?"event":reminder.note_id?"note":"reminder";
    const resourceId=reminder.event_id??reminder.note_id??reminder.id;
    const insertNotification=db.prepare("INSERT OR IGNORE INTO notifications (id,user_id,workspace_id,notification_type,title,body,resource_type,resource_id,idempotency_key,created_at) SELECT lower(hex(randomblob(16))),wm.user_id,?,'reminder',?,?,?,?,'reminder:'||?||':'||wm.user_id,? FROM workspace_members wm WHERE wm.workspace_id=?")
      .bind(reminder.workspace_id,"Reminder: "+reminder.title,"Due "+reminder.due_at_utc,resourceType,resourceId,reminder.id,now,reminder.workspace_id);
    const markDelivered=db.prepare("UPDATE reminders SET status='delivered',delivered_at=?,updated_at=? WHERE id=? AND status='pending' AND due_at_utc<=?")
      .bind(now,now,reminder.id,now);
    const results=await db.batch([insertNotification,markDelivered]);
    const changed=Number((results[1] as {meta?:{changes?:number}})?.meta?.changes??0);
    if(changed>0){
      deliveredCount++;
      if(env){
        const members=await db.prepare("SELECT user_id FROM workspace_members WHERE workspace_id=?").bind(reminder.workspace_id).all<{user_id:string}>();
        await Promise.all(members.results.map(member=>sendPushToUser(db,env,member.user_id,{title:("Reminder: "+reminder.title).slice(0,80),body:"Due "+reminder.due_at_utc,url:"/",tag:"reminder-"+reminder.id},"reminder")));
      }
    }
  }
  return deliveredCount;
}
