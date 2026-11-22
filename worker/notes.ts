import { getCurrentUser, type AuthEnv } from "./auth.ts";
import { sendPushToUser } from "./push.ts";

type Db = NonNullable<AuthEnv["DB"]>;
type Role = "owner" | "editor" | "viewer";
type NoteRow = {
  id: string; workspace_id: string; title: string; content: string; category_id: string | null;
  category_name?: string | null; created_by_user_id: string; created_by_name?:string|null; created_by_email?:string|null; updated_by_user_id?:string|null; updated_by_name?:string|null; updated_by_email?:string|null; version: number;
  created_at: string; updated_at: string; archived_at: string | null;
};
type CategoryRow = {
  id: string; workspace_id: string; name: string; color: string | null;
  sort_order: number; created_at: string; updated_at: string;
};
const MAX_BODY_BYTES = 64 * 1024;
const MAX_NOTE_CONTENT_CHARS = 50_000;

function pushDescription(value:string):string { return value.replace(/<[^>]*>/g," ").replace(/\\s+/g," ").trim().slice(0,150) || "No description was added."; }

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }});
}
function isSameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin;
}
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder().decode(bytes);
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
function textValue(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length > 0 && result.length <= max ? result : null;
}
function nullableText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return textValue(value, max) ?? undefined;
}
function changes(result: unknown): number {
  return Number((result as { meta?: { changes?: number } })?.meta?.changes ?? 0);
}
async function roleFor(db: Db, workspaceId: string, userId: string): Promise<Role | null> {
  const row = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?")
    .bind(workspaceId, userId).first<{ role: Role }>();
  return row?.role ?? null;
}
async function personalWorkspace(db: Db, userId: string): Promise<string | null> {
  const row = await db.prepare("SELECT id FROM workspaces WHERE owner_user_id=? AND visibility='private' ORDER BY created_at ASC LIMIT 1")
    .bind(userId).first<{ id: string }>();
  return row?.id ?? null;
}
async function workspaceForWrite(db: Db, userId: string, requested: unknown): Promise<{ id: string; role: Role } | null> {
  const workspaceId = requested === undefined || requested === null || requested === ""
    ? await personalWorkspace(db, userId)
    : (typeof requested === "string" && requested.length <= 64 ? requested : null);
  if (!workspaceId) return null;
  const role = await roleFor(db, workspaceId, userId);
  return role && (role === "owner" || role === "editor") ? { id: workspaceId, role } : null;
}
async function categoryBelongsToWorkspace(db: Db, categoryId: string | null, workspaceId: string): Promise<boolean> {
  if (!categoryId) return true;
  const row = await db.prepare("SELECT id FROM categories WHERE id=? AND workspace_id=? AND archived_at IS NULL")
    .bind(categoryId, workspaceId).first<{ id: string }>();
  return Boolean(row);
}
function noteDto(row: NoteRow) {
  return {
    id: row.id, workspaceId: row.workspace_id, title: row.title, content: row.content,
    categoryId: row.category_id, categoryName: row.category_name ?? null,
    createdBy: row.created_by_user_id, createdByName:row.created_by_name??null, createdByEmail:row.created_by_email??null,
    updatedBy:row.updated_by_user_id??null, updatedByName:row.updated_by_name??null, updatedByEmail:row.updated_by_email??null, version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: row.archived_at
  };
}
async function handleNotes(request: Request, env: AuthEnv & {VAPID_PUBLIC_KEY?:string;VAPID_PRIVATE_KEY?:string;VAPID_SUBJECT?:string}, url: URL, userId: string, ctx?:ExecutionContext): Promise<Response | null> {
  const db = env.DB!;
  const path = url.pathname;
  if (path === "/api/notes" && request.method === "GET") {
    const workspaceId = url.searchParams.get("workspaceId");
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const archiveFilter = url.searchParams.get("archived") === "1" ? "n.archived_at IS NOT NULL" : "n.archived_at IS NULL";
    if (workspaceId && !(await roleFor(db, workspaceId, userId))) return json({ error: "NOT_FOUND" }, 404);
    const pattern = "%" + query.replace(/[\\%_]/g, "\\$&") + "%";
    const result = workspaceId
      ? await db.prepare("SELECT n.*,c.name AS category_name,cu.display_name AS created_by_name,cu.email AS created_by_email,uu.display_name AS updated_by_name,uu.email AS updated_by_email FROM notes n LEFT JOIN categories c ON c.id=n.category_id LEFT JOIN users cu ON cu.id=n.created_by_user_id LEFT JOIN users uu ON uu.id=n.updated_by_user_id WHERE n.workspace_id=? AND n.deleted_at IS NULL AND " + archiveFilter + " AND (?='' OR n.title LIKE ? ESCAPE '\\' OR n.content LIKE ? ESCAPE '\\') ORDER BY n.updated_at DESC LIMIT ?")
          .bind(workspaceId, query, pattern, pattern, limit).all<NoteRow>()
      : await db.prepare("SELECT n.*,c.name AS category_name,cu.display_name AS created_by_name,cu.email AS created_by_email,uu.display_name AS updated_by_name,uu.email AS updated_by_email FROM notes n JOIN workspace_members wm ON wm.workspace_id=n.workspace_id LEFT JOIN categories c ON c.id=n.category_id LEFT JOIN users cu ON cu.id=n.created_by_user_id LEFT JOIN users uu ON uu.id=n.updated_by_user_id WHERE wm.user_id=? AND n.deleted_at IS NULL AND " + archiveFilter + " AND (?='' OR n.title LIKE ? ESCAPE '\\' OR n.content LIKE ? ESCAPE '\\') ORDER BY n.updated_at DESC LIMIT ?")
          .bind(userId, query, pattern, pattern, limit).all<NoteRow>();
    return json({ notes: result.results.map(noteDto) });
  }
  if (path === "/api/notes" && request.method === "POST") {
    if (!isSameOrigin(request)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
    const body = await readJsonBody(request);
    if (!body) return json({ error: "INVALID_JSON_BODY" }, 400);
    const title = textValue(body.title, 200);
    const content = typeof body.content === "string" && body.content.length <= MAX_NOTE_CONTENT_CHARS ? body.content : null;
    if (!title || content === null) return json({ error: "INVALID_NOTE" }, 400);
    const workspace = await workspaceForWrite(db, userId, body.workspaceId);
    if (!workspace) return json({ error: "WORKSPACE_FORBIDDEN" }, 403);
    const categoryId = nullableText(body.categoryId, 64);
    if (categoryId === undefined || !(await categoryBelongsToWorkspace(db, categoryId, workspace.id))) return json({ error: "INVALID_CATEGORY" }, 400);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO notes (id,workspace_id,title,content,category_id,created_by_user_id,updated_by_user_id,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)")
      .bind(id, workspace.id, title, content, categoryId, userId, userId, now, now).run();
    await db.prepare("INSERT INTO activity_events (id,workspace_id,actor_user_id,event_type,target_type,target_id,metadata_json,created_at) VALUES (?,?,?,'note.created','note',?,'{}',?)").bind(crypto.randomUUID(),workspace.id,userId,id,now).run();
    const row = await db.prepare("SELECT n.*,c.name AS category_name,cu.display_name AS created_by_name,cu.email AS created_by_email,uu.display_name AS updated_by_name,uu.email AS updated_by_email FROM notes n LEFT JOIN categories c ON c.id=n.category_id LEFT JOIN users cu ON cu.id=n.created_by_user_id LEFT JOIN users uu ON uu.id=n.updated_by_user_id WHERE n.id=?")
      .bind(id).first<NoteRow>();
    const recipients=await db.prepare("SELECT user_id FROM workspace_members WHERE workspace_id=? AND user_id<>?").bind(workspace.id,userId).all<{user_id:string}>();
    const pushTask=Promise.all(recipients.results.map(recipient=>sendPushToUser(db,env,recipient.user_id,{title:("New note: "+title).slice(0,80),body:pushDescription(content),url:"/",tag:"shared-note-"+id},"shared_note")));
    if(ctx)ctx.waitUntil(pushTask);else await pushTask;
    return json({ note: row ? noteDto(row) : null }, 201);
  }
  const match = path.match(/^\/api\/notes\/([^/]+)$/);
  if (!match) return null;
  const noteId = decodeURIComponent(match[1]);
  const row = await db.prepare("SELECT n.*,c.name AS category_name,cu.display_name AS created_by_name,cu.email AS created_by_email,uu.display_name AS updated_by_name,uu.email AS updated_by_email FROM notes n LEFT JOIN categories c ON c.id=n.category_id LEFT JOIN users cu ON cu.id=n.created_by_user_id LEFT JOIN users uu ON uu.id=n.updated_by_user_id WHERE n.id=? AND n.deleted_at IS NULL")
    .bind(noteId).first<NoteRow>();
  if (!row || !(await roleFor(db, row.workspace_id, userId))) return json({ error: "NOT_FOUND" }, 404);
  if (request.method === "GET") return json({ note: noteDto(row) });
  if (request.method === "PATCH") {
    if (!isSameOrigin(request)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
    const role = await roleFor(db, row.workspace_id, userId);
    if (role !== "owner" && role !== "editor") return json({ error: "FORBIDDEN" }, 403);
    const body = await readJsonBody(request);
    if (!body) return json({ error: "INVALID_JSON_BODY" }, 400);
    const title = body.title === undefined ? row.title : textValue(body.title, 200);
    const content = body.content === undefined ? row.content : (typeof body.content === "string" && body.content.length <= MAX_NOTE_CONTENT_CHARS ? body.content : null);
    const categoryId = body.categoryId === undefined ? row.category_id : nullableText(body.categoryId, 64);
    const version = Number(body.version);
    const archivedAt = body.archived === undefined ? row.archived_at : (typeof body.archived === "boolean" ? (body.archived ? new Date().toISOString() : null) : undefined);
    if (!title || content === null || categoryId === undefined || archivedAt === undefined || !Number.isInteger(version) || version !== row.version) return json({ error: "INVALID_OR_STALE_NOTE", currentVersion: row.version }, 409);
    if (!(await categoryBelongsToWorkspace(db, categoryId, row.workspace_id))) return json({ error: "INVALID_CATEGORY" }, 400);
    const now = new Date().toISOString();
    const result = await db.prepare("UPDATE notes SET title=?,content=?,category_id=?,archived_at=?,updated_by_user_id=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND deleted_at IS NULL")
      .bind(title, content, categoryId, archivedAt, userId, now, noteId, row.workspace_id, version).run();
    if (changes(result) !== 1) return json({ error: "VERSION_CONFLICT" }, 409);
    await db.prepare("INSERT INTO activity_events (id,workspace_id,actor_user_id,event_type,target_type,target_id,metadata_json,created_at) VALUES (?,?,?,'note.updated','note',?,'{}',?)").bind(crypto.randomUUID(),row.workspace_id,userId,noteId,now).run();
    const recipients=await db.prepare("SELECT user_id FROM workspace_members WHERE workspace_id=? AND user_id<>?").bind(row.workspace_id,userId).all<{user_id:string}>();
    const actor=await db.prepare("SELECT display_name FROM users WHERE id=?").bind(userId).first<{display_name:string|null}>();
     const pushTask=Promise.all(recipients.results.map(recipient=>sendPushToUser(db,env,recipient.user_id,{title:("Updated: "+title).slice(0,80),body:pushDescription(content),url:"/",tag:"shared-note-update-"+noteId},"shared_note_update")));
    if(ctx)ctx.waitUntil(pushTask);else await pushTask;
    const updated = await db.prepare("SELECT n.*,c.name AS category_name,cu.display_name AS created_by_name,cu.email AS created_by_email,uu.display_name AS updated_by_name,uu.email AS updated_by_email FROM notes n LEFT JOIN categories c ON c.id=n.category_id LEFT JOIN users cu ON cu.id=n.created_by_user_id LEFT JOIN users uu ON uu.id=n.updated_by_user_id WHERE n.id=?")
      .bind(noteId).first<NoteRow>();
    return json({ note: updated ? noteDto(updated) : null });
  }
  if (request.method === "DELETE") {
    if (!isSameOrigin(request)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
    const role = await roleFor(db, row.workspace_id, userId);
    if (role !== "owner" && role !== "editor") return json({ error: "FORBIDDEN" }, 403);
    const now = new Date().toISOString();
    const result = await db.prepare("UPDATE notes SET deleted_at=?,updated_at=?,updated_by_user_id=?,version=version+1 WHERE id=? AND workspace_id=? AND deleted_at IS NULL")
      .bind(now, now, userId, noteId, row.workspace_id).run();
    if(changes(result)===1){
      await db.prepare("INSERT INTO activity_events (id,workspace_id,actor_user_id,event_type,target_type,target_id,metadata_json,created_at) VALUES (?,?,?,'note.deleted','note',?,'{}',?)").bind(crypto.randomUUID(),row.workspace_id,userId,noteId,now).run();
      const recipients=await db.prepare("SELECT user_id FROM workspace_members WHERE workspace_id=? AND user_id<>?").bind(row.workspace_id,userId).all<{user_id:string}>();
      const pushTask=Promise.all(recipients.results.map(recipient=>sendPushToUser(db,env,recipient.user_id,{title:("Deleted: "+row.title).slice(0,80),body:"This shared note was deleted. "+pushDescription(row.content),url:"/",tag:"shared-note-deleted-"+noteId},"shared_note_update")));
      if(ctx)ctx.waitUntil(pushTask);else await pushTask;
      return json({ok:true});
    }
    return json({error:"NOT_FOUND"},404);
  }
  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}
async function handleCategories(request: Request, env: AuthEnv, url: URL, userId: string): Promise<Response | null> {
  const db = env.DB!;
  const path = url.pathname;
  if (path === "/api/categories" && request.method === "GET") {
    const workspaceId = url.searchParams.get("workspaceId");
    if (workspaceId && !(await roleFor(db, workspaceId, userId))) return json({ error: "NOT_FOUND" }, 404);
    const result = workspaceId
      ? await db.prepare("SELECT c.* FROM categories c WHERE c.workspace_id=? AND c.archived_at IS NULL ORDER BY c.sort_order,c.name")
          .bind(workspaceId).all<CategoryRow>()
      : await db.prepare("SELECT c.* FROM categories c JOIN workspace_members wm ON wm.workspace_id=c.workspace_id WHERE wm.user_id=? AND c.archived_at IS NULL ORDER BY c.sort_order,c.name")
          .bind(userId).all<CategoryRow>();
    return json({ categories: result.results.map(c => ({ id:c.id,workspaceId:c.workspace_id,name:c.name,color:c.color,sortOrder:c.sort_order,createdAt:c.created_at,updatedAt:c.updated_at })) });
  }
  if (path === "/api/categories" && request.method === "POST") {
    if (!isSameOrigin(request)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
    const body = await readJsonBody(request);
    if (!body) return json({ error: "INVALID_JSON_BODY" }, 400);
    const name = textValue(body.name, 50);
    if (!name) return json({ error: "INVALID_CATEGORY" }, 400);
    const workspace = await workspaceForWrite(db, userId, body.workspaceId);
    if (!workspace) return json({ error: "WORKSPACE_FORBIDDEN" }, 403);
    const color = body.color === undefined || body.color === null ? null : (typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : undefined);
    if (color === undefined) return json({ error: "INVALID_COLOR" }, 400);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    try {
      await db.prepare("INSERT INTO categories (id,workspace_id,name,color,sort_order,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(id,workspace.id,name,color,typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder) ? body.sortOrder : 0,userId,now,now).run();
    } catch {
      return json({ error: "CATEGORY_ALREADY_EXISTS" }, 409);
    }
    return json({ category: { id,workspaceId:workspace.id,name,color,sortOrder:Number.isInteger(body.sortOrder)?body.sortOrder:0,createdAt:now,updatedAt:now } }, 201);
  }
  const match = path.match(/^\/api\/categories\/([^/]+)$/);
  if (!match) return null;
  const categoryId = decodeURIComponent(match[1]);
  const category = await db.prepare("SELECT * FROM categories WHERE id=? AND archived_at IS NULL")
    .bind(categoryId).first<CategoryRow>();
  if (!category || !(await roleFor(db, category.workspace_id, userId))) return json({ error: "NOT_FOUND" }, 404);
  const role = await roleFor(db, category.workspace_id, userId);
  if (request.method === "PATCH") {
    if (!isSameOrigin(request)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
    if (role !== "owner" && role !== "editor") return json({ error: "FORBIDDEN" }, 403);
    const body = await readJsonBody(request);
    if (!body) return json({ error: "INVALID_JSON_BODY" }, 400);
    const name = body.name === undefined ? category.name : textValue(body.name,50);
    const color = body.color === undefined ? category.color : (body.color === null ? null : (typeof body.color==="string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : undefined));
    const sortOrder = body.sortOrder === undefined ? category.sort_order : (typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder) ? body.sortOrder : undefined);
    if (!name || color === undefined || sortOrder === undefined) return json({ error: "INVALID_CATEGORY" }, 400);
    const now = new Date().toISOString();
    try {
      await db.prepare("UPDATE categories SET name=?,color=?,sort_order=?,updated_at=? WHERE id=? AND workspace_id=?")
        .bind(name,color,sortOrder,now,categoryId,category.workspace_id).run();
    } catch {
      return json({ error: "CATEGORY_ALREADY_EXISTS" }, 409);
    }
    return json({ category: { id:categoryId,workspaceId:category.workspace_id,name,color,sortOrder,createdAt:category.created_at,updatedAt:now } });
  }
  if (request.method === "DELETE") {
    if (!isSameOrigin(request)) return json({ error: "CSRF_ORIGIN_REJECTED" }, 403);
    if (role !== "owner" && role !== "editor") return json({ error: "FORBIDDEN" }, 403);
    const now = new Date().toISOString();
    await db.prepare("UPDATE categories SET archived_at=?,updated_at=? WHERE id=? AND workspace_id=?")
      .bind(now,now,categoryId,category.workspace_id).run();
    return json({ ok:true });
  }
  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}

export async function handleNotesRequest(request: Request, env: AuthEnv & {VAPID_PUBLIC_KEY?:string;VAPID_PRIVATE_KEY?:string;VAPID_SUBJECT?:string}, ctx?:ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/notes") && !url.pathname.startsWith("/api/categories")) return null;
  if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: "UNAUTHENTICATED" }, 401);
  return url.pathname.startsWith("/api/notes")
    ? handleNotes(request, env, url, user.id, ctx)
    : handleCategories(request, env, url, user.id);
}
