export async function purgeExpiredTrash(db:D1Database,now=new Date()):Promise<number>{
  const cutoff=new Date(now.getTime()-30*86400000).toISOString();let total=0;
  for(let batch=0;batch<10;batch++){
    const result=await db.prepare("DELETE FROM notes WHERE id IN (SELECT id FROM notes WHERE deleted_at IS NOT NULL AND deleted_at<=? ORDER BY deleted_at LIMIT 100)").bind(cutoff).run();
    const changed=Number((result as {meta?:{changes?:number}}).meta?.changes??0);total+=changed;if(changed<100)break;
  }
  return total;
}
