import { useEffect, useMemo, useState } from "react";
import { Bell, CalendarDays, Check, ChevronDown, Command, LogIn, LogOut, Plus, Search, Sparkles, Users, X, Archive, Pencil } from "lucide-react";

type View = "notes" | "calendar" | "shared";
function localDateTime(value: Date): string { const pad=(n:number)=>String(n).padStart(2,"0"); return value.getFullYear()+"-"+pad(value.getMonth()+1)+"-"+pad(value.getDate())+"T"+pad(value.getHours())+":"+pad(value.getMinutes()); }
type SessionUser = { id: string; email: string; displayName: string | null; avatarUrl: string | null; personalWorkspaceId: string | null };
type Invitation = { id: string; email: string; role: "editor" | "viewer"; status: string; expiresAt: string };
type CalendarEvent = { id:string; workspaceId:string; title:string; description:string; startsAt:string; endsAt:string; timezone:string; allDay:boolean; version:number };
type Notification = { id:string; type:string; title:string; body:string; resourceType:string|null; resourceId:string|null; createdAt:string; readAt:string|null };
type AiDraft = {
  summary:string; timezone:string;
  note:{title:string;content:string};
  suggestedCategories:{name:string;reason:string}[];
  events:{title:string;description:string;startLocal:string;endLocal:string;reminderLocal:string|null;timezone:string}[];
  reminders:{title:string;dueLocal:string;timezone:string}[];
  tasks:{title:string;dueLocal:string|null}[];
  clarifyingQuestions:string[];
};
type AiStatus = {configured:boolean;consented:boolean;dailyLimit:number;dailyUsed:number;dailyRemaining:number};
type Note = {
  id: string; workspaceId: string; title: string; content: string; categoryId: string | null;
  categoryName: string | null; createdBy: string; version: number; createdAt: string; updatedAt: string; archivedAt: string | null;
};

export default function App() {
  const [view, setView] = useState<View>("notes");
  const [query, setQuery] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authStatus, setAuthStatus] = useState<"loading" | "signed_out" | "ready" | "unavailable">("loading");
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(() => new URLSearchParams(window.location.search).get("token"));
  const [inviteStatus, setInviteStatus] = useState<"idle" | "accepting" | "accepted" | "error">("idle");
  const [inviteError, setInviteError] = useState("");
  const [inviteNotice, setInviteNotice] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteCreateError, setInviteCreateError] = useState("");
  const [createdInvite, setCreatedInvite] = useState<{ invitationUrl: string; gmailComposeUrl: string } | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [inviteRefresh, setInviteRefresh] = useState(0);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [eventComposerOpen, setEventComposerOpen] = useState(false);
  const [eventTitle, setEventTitle] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventStart, setEventStart] = useState(() => localDateTime(new Date(Date.now()+3600000)));
  const [eventEnd, setEventEnd] = useState(() => localDateTime(new Date(Date.now()+7200000)));
  const [eventReminderAt, setEventReminderAt] = useState("");
  const [eventTimezone, setEventTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kuala_Lumpur");
  const [eventSaving, setEventSaving] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiConsentChecked, setAiConsentChecked] = useState(false);
  const [aiConsentSaving, setAiConsentSaving] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiWorking, setAiWorking] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [aiDraftTitle, setAiDraftTitle] = useState("");
  const [aiDraftContent, setAiDraftContent] = useState("");
  const [aiSavingNote, setAiSavingNote] = useState(false);
  const [aiCreatingItems, setAiCreatingItems] = useState(false);
  const [aiNoteSaved, setAiNoteSaved] = useState(false);
  const [aiItemsCreated, setAiItemsCreated] = useState(false);

  useEffect(() => {
    if (inviteToken) window.history.replaceState({}, "", "/");
  }, [inviteToken]);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/status", { credentials: "same-origin" })
      .then(async statusResponse => {
        if (!statusResponse.ok) throw new Error("Auth status unavailable");
        const status = await statusResponse.json() as { ready: boolean };
        if (!active) return;
        if (!status.ready) {
          setUser(null);
          setAuthStatus("unavailable");
          return;
        }
        const response = await fetch("/api/auth/me", { credentials: "same-origin" });
        if (!active) return;
        if (response.ok) {
          const result = await response.json() as { user: SessionUser };
          setUser(result.user);
          setAuthStatus("ready");
        } else if (response.status === 401) {
          setUser(null);
          setAuthStatus("signed_out");
        } else {
          setUser(null);
          setAuthStatus("unavailable");
        }
      })
      .catch(() => { if (active) setAuthStatus("unavailable"); })
      .finally(() => { if (active) setAuthStatus(current => current === "loading" ? "signed_out" : current); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) { setNotes([]); return; }
    let active = true;
    setNotesLoading(true);
    setNotesError("");
    fetch("/api/notes", { credentials: "same-origin" })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 503 ? "Database setup is not complete yet." : "Unable to load notes.");
        const result = await response.json() as { notes: Note[] };
        if (active) setNotes(result.notes);
      })
      .catch(error => { if (active) setNotesError(error instanceof Error ? error.message : "Unable to load notes."); })
      .finally(() => { if (active) setNotesLoading(false); });
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (!user) { setUnreadCount(0); return; }
    let active = true;
    fetch("/api/notifications?limit=1",{credentials:"same-origin"})
      .then(async response=>{if(!response.ok)return;const result=await response.json() as {unreadCount:number};if(active)setUnreadCount(result.unreadCount);})
      .catch(()=>undefined);
    return ()=>{active=false;};
  },[user]);

  useEffect(() => {
    if (!user) { setAiStatus(null); return; }
    let active = true;
    fetch("/api/ai/status",{credentials:"same-origin"})
      .then(async response=>{if(!response.ok)throw new Error("AI status unavailable");const result=await response.json() as AiStatus;if(active)setAiStatus(result);})
      .catch(()=>{if(active)setAiStatus(null);});
    return ()=>{active=false;};
  },[user]);

  useEffect(() => {
    if (!inviteOpen || !user?.personalWorkspaceId) return;
    let active = true;
    setInvitationsLoading(true);
    fetch("/api/invitations?workspaceId=" + encodeURIComponent(user.personalWorkspaceId), { credentials: "same-origin" })
      .then(async response => {
        if (!response.ok) throw new Error("Unable to load invitations.");
        const result = await response.json() as { invitations: Invitation[] };
        if (active) setInvitations(result.invitations);
      })
      .catch(error => { if (active) setInviteCreateError(error instanceof Error ? error.message : "Unable to load invitations."); })
      .finally(() => { if (active) setInvitationsLoading(false); });
    return () => { active = false; };
  }, [inviteOpen, user?.personalWorkspaceId, inviteRefresh]);

  useEffect(() => {
    if (view !== "calendar" || !user) return;
    let active = true;
    setEventsLoading(true);
    setEventsError("");
    const from = new Date(Date.now()-30*86400000).toISOString();
    const to = new Date(Date.now()+90*86400000).toISOString();
    fetch("/api/events?from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to),{credentials:"same-origin"})
      .then(async response => {
        if(!response.ok) throw new Error("Unable to load calendar events.");
        const result = await response.json() as {events:CalendarEvent[]};
        if(active) setEvents(result.events);
      })
      .catch(error => {if(active)setEventsError(error instanceof Error?error.message:"Unable to load calendar events.");})
      .finally(()=>{if(active)setEventsLoading(false);});
    return ()=>{active=false;};
  },[view,user]);

  useEffect(() => {
    if (!notificationsOpen || !user) return;
    let active = true;
    setNotificationsLoading(true);
    fetch("/api/notifications?limit=50",{credentials:"same-origin"})
      .then(async response=>{
        if(!response.ok) throw new Error("Unable to load notifications.");
        const result=await response.json() as {notifications:Notification[];unreadCount:number};
        if(active){setNotifications(result.notifications);setUnreadCount(result.unreadCount);}
      })
      .catch(error=>{if(active)setNotificationError(error instanceof Error?error.message:"Unable to load notifications.");})
      .finally(()=>{if(active)setNotificationsLoading(false);});
    return ()=>{active=false;};
  },[notificationsOpen,user]);

  const visibleNotes = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return notes;
    return notes.filter(note => (note.title + " " + note.content + " " + (note.categoryName ?? "")).toLowerCase().includes(value));
  }, [notes, query]);

  function startNewNote() {
    setEditingNote(null);
    setDraftTitle("");
    setDraftContent("");
    setComposerOpen(true);
  }

  function startEditNote(note: Note) {
    setEditingNote(note);
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setComposerOpen(true);
  }

  async function saveNote() {
    if (!draftTitle.trim() || saving) return;
    setSaving(true);
    setNotesError("");
    try {
      const response = await fetch(editingNote ? "/api/notes/" + encodeURIComponent(editingNote.id) : "/api/notes", {
        method: editingNote ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editingNote
          ? { title: draftTitle, content: draftContent, version: editingNote.version }
          : { title: draftTitle, content: draftContent })
      });
      const result = await response.json() as { note?: Note; error?: string };
      if (!response.ok || !result.note) throw new Error(result.error === "VERSION_CONFLICT" ? "This note changed elsewhere. Refresh and try again." : "Unable to save this note.");
      setNotes(current => editingNote
        ? current.map(note => note.id === result.note!.id ? result.note! : note)
        : [result.note!, ...current]);
      setComposerOpen(false);
      setEditingNote(null);
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : "Unable to save this note.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveNote(note: Note) {
    try {
      const response = await fetch("/api/notes/" + encodeURIComponent(note.id), {
        method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: note.version, archived: true })
      });
      if (!response.ok) throw new Error("Unable to archive this note.");
      setNotes(current => current.filter(item => item.id !== note.id));
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : "Unable to archive this note.");
    }
  }

  function startNewEvent() {
    setEventTitle("");
    setEventDescription("");
    setEventStart(localDateTime(new Date(Date.now()+3600000)));
    setEventEnd(localDateTime(new Date(Date.now()+7200000)));
    setEventReminderAt("");
    setEventsError("");
    setEventComposerOpen(true);
  }

  async function saveEvent() {
    if(!user?.personalWorkspaceId||!eventTitle.trim()||eventSaving)return;
    setEventSaving(true);setEventsError("");
    try {
      const response=await fetch("/api/events",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
        workspaceId:user.personalWorkspaceId,title:eventTitle,description:eventDescription,
        startsAt:new Date(eventStart).toISOString(),endsAt:new Date(eventEnd).toISOString(),timezone:eventTimezone
      })});
      const result=await response.json() as {event?:CalendarEvent};
      if(!response.ok||!result.event)throw new Error("Unable to save this event.");
      setEvents(current=>[...current,result.event!].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)));
      if(eventReminderAt){
        const reminderResponse=await fetch("/api/reminders",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
          workspaceId:user.personalWorkspaceId,eventId:result.event.id,title:eventTitle,dueAt:new Date(eventReminderAt).toISOString(),timezone:eventTimezone
        })});
        if(!reminderResponse.ok)setEventsError("Event saved, but its reminder could not be created.");
      }
      setEventComposerOpen(false);
    }catch(error){setEventsError(error instanceof Error?error.message:"Unable to save this event.");}
    finally{setEventSaving(false);}
  }

  async function deleteEvent(event:CalendarEvent) {
    try {
      const response=await fetch("/api/events/"+encodeURIComponent(event.id),{method:"DELETE",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({version:event.version})});
      if(!response.ok)throw new Error("Unable to delete this event.");
      setEvents(current=>current.filter(item=>item.id!==event.id));
    }catch(error){setEventsError(error instanceof Error?error.message:"Unable to delete this event.");}
  }

  async function markNotificationRead(notification:Notification) {
    if(notification.readAt)return;
    const response=await fetch("/api/notifications/"+encodeURIComponent(notification.id)+"/read",{method:"POST",credentials:"same-origin"});
    if(response.ok){
      const readAt=new Date().toISOString();
      setNotifications(current=>current.map(item=>item.id===notification.id?{...item,readAt}:item));
      setUnreadCount(count=>Math.max(0,count-1));
    }
  }

  async function markAllNotificationsRead() {
    const response=await fetch("/api/notifications/read-all",{method:"POST",credentials:"same-origin"});
    if(response.ok){
      const readAt=new Date().toISOString();
      setNotifications(current=>current.map(item=>({...item,readAt:item.readAt??readAt})));
      setUnreadCount(0);
    }
  }

  function openNotification(notification:Notification) {
    if(notification.resourceType==="event"||notification.type==="reminder")setView("calendar");
    else if(notification.resourceType==="note"||notification.type==="shared_note")setView("notes");
    void markNotificationRead(notification);
    setNotificationsOpen(false);
  }

  async function acceptInvite() {
    if (!inviteToken || !user || inviteStatus === "accepting") return;
    setInviteStatus("accepting");
    setInviteError("");
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: inviteToken })
      });
      const result = await response.json() as { accepted?: boolean; error?: string };
      if (!response.ok || !result.accepted) {
        const message = result.error === "INVITATION_EMAIL_MISMATCH"
          ? "This invitation was sent to a different Google email. Sign out and use the invited account."
          : result.error === "INVITATION_EXPIRED"
            ? "This invitation has expired. Ask the workspace owner to send a new one."
            : "This invitation is invalid or has already been used.";
        throw new Error(message);
      }
      setInviteStatus("accepted");
      setInviteNotice("Invitation accepted. The shared workspace is now available.");
      setInviteToken(null);
      const notesResponse = await fetch("/api/notes", { credentials: "same-origin" });
      if (notesResponse.ok) {
        const noteResult = await notesResponse.json() as { notes: Note[] };
        setNotes(noteResult.notes);
      }
    } catch (error) {
      setInviteStatus("error");
      setInviteError(error instanceof Error ? error.message : "Unable to accept invitation.");
    }
  }

  async function createInvite() {
    if (!user?.personalWorkspaceId || !inviteEmail.trim() || inviteSending) return;
    setInviteSending(true);
    setInviteCreateError("");
    setCreatedInvite(null);
    try {
      const response = await fetch("/api/invitations", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: user.personalWorkspaceId, email: inviteEmail, role: inviteRole })
      });
      const result = await response.json() as { invitationUrl?: string; gmailComposeUrl?: string; error?: string };
      if (!response.ok || !result.invitationUrl || !result.gmailComposeUrl) {
        const message = result.error === "ALREADY_A_MEMBER" ? "This person is already a workspace member."
          : result.error === "INVITATION_ALREADY_PENDING" ? "There is already a pending invitation for this email."
          : "Unable to create this invitation.";
        throw new Error(message);
      }
      setCreatedInvite({ invitationUrl: result.invitationUrl, gmailComposeUrl: result.gmailComposeUrl });
      setInviteRefresh(value => value + 1);
    } catch (error) {
      setInviteCreateError(error instanceof Error ? error.message : "Unable to create this invitation.");
    } finally {
      setInviteSending(false);
    }
  }

  async function revokeInvitation(invitationId: string) {
    try {
      const response = await fetch("/api/invitations/" + encodeURIComponent(invitationId), { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error("Unable to revoke invitation.");
      setInviteRefresh(value => value + 1);
      setCreatedInvite(null);
      setCopiedInvite(false);
    } catch (error) {
      setInviteCreateError(error instanceof Error ? error.message : "Unable to revoke invitation.");
    }
  }

  async function copyInviteLink() {
    if (!createdInvite) return;
    try {
      await navigator.clipboard.writeText(createdInvite.invitationUrl);
      setCopiedInvite(true);
    } catch {
      setInviteCreateError("Clipboard access is unavailable. Select and copy the invitation link manually.");
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    setUser(null);
    setNotes([]);
    setAuthStatus("signed_out");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="KitaNotes home">
          <span className="brand-mark"><Command size={19} /></span>
          <span>Kita<span className="brand-soft">Notes</span></span>
        </a>
        <button className="workspace-switch">
          <span className="workspace-avatar">K</span>
          <span className="workspace-copy"><strong>My workspace</strong><small>Personal space</small></span>
          <ChevronDown size={16} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          <button className={view === "notes" ? "nav-item active" : "nav-item"} onClick={() => setView("notes")}><Command size={17} /> Notes <span className="nav-count">{notes.length}</span></button>
          <button className={view === "calendar" ? "nav-item active" : "nav-item"} onClick={() => setView("calendar")}><CalendarDays size={17} /> Calendar</button>
          <button className={view === "shared" ? "nav-item active" : "nav-item"} onClick={() => setView("shared")}><Users size={17} /> Shared with me</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="upgrade-card"><Sparkles size={17} /><strong>Your ideas, organised.</strong><p>Capture a thought now. Give it structure later.</p></div>
          <div className="profile-row">
            {user?.avatarUrl ? <img className="profile-avatar" src={user.avatarUrl} alt="" /> : <div className="profile-avatar">{user?.displayName?.slice(0, 1).toUpperCase() ?? "?"}</div>}
            <div><strong>{user?.displayName ?? (authStatus === "unavailable" ? "Setup pending" : "Guest preview")}</strong><small>{user?.email ?? (authStatus === "unavailable" ? "Connect D1 and Google OAuth" : "Sign in to sync notes")}</small></div>
            {user && <button className="mini-icon" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={15} /></button>}
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">My workspace <span>/</span> {view === "notes" ? "Notes" : view === "calendar" ? "Calendar" : "Shared with me"}</div>
          <div className="top-actions">
            <button className="icon-button notification-trigger" aria-label="Notifications" onClick={()=>setNotificationsOpen(value=>!value)} disabled={!user}><Bell size={18}/>{unreadCount>0&&<span>{unreadCount>9?"9+":unreadCount}</span>}</button>
            {user ? <span className="signed-in-label">{user.displayName ?? user.email}</span> : authStatus === "signed_out" ? <a className="signin-button" href="/auth/google"><LogIn size={15} /> Continue with Google</a> : <span className="setup-label">{authStatus === "loading" ? "Checking session…" : "Sign-in setup pending"}</span>}
            {user?.avatarUrl ? <img className="profile-avatar small" src={user.avatarUrl} alt="" /> : <div className="profile-avatar small">{user?.displayName?.slice(0, 1).toUpperCase() ?? "?"}</div>}
          </div>
        </header>
        <div className="content">
          {notificationsOpen && <section className="notification-panel">
            <header><strong>Notifications</strong><button className="text-action" onClick={markAllNotificationsRead} disabled={unreadCount===0}>Mark all read</button></header>
            {notificationError&&<p className="invite-error">{notificationError}</p>}
            {notificationsLoading?<p>Loading…</p>:notifications.length===0?<p>You're all caught up.</p>:notifications.map(notification=><button className={notification.readAt?"notification-item":"notification-item unread"} key={notification.id} onClick={()=>openNotification(notification)}><strong>{notification.title}</strong><span>{notification.body}</span><small>{new Date(notification.createdAt).toLocaleString()}</small></button>)}
          </section>}
          {inviteToken && <section className="invite-panel">
            <div><span className="eyebrow">WORKSPACE INVITATION</span><h2>You've been invited.</h2>
              <p>Accept this invitation using the Google account whose email address received it.</p></div>
            {user ? <button className="primary-button" onClick={acceptInvite} disabled={inviteStatus === "accepting"}>{inviteStatus === "accepting" ? "Accepting…" : "Accept invitation"}</button>
              : authStatus === "signed_out" ? <a className="primary-button" href={"/auth/google?returnTo=" + encodeURIComponent("/invite/accept?token=" + inviteToken)}><LogIn size={16}/> Sign in to accept</a>
              : <span className="setup-label">{authStatus === "loading" ? "Checking sign-in…" : "Sign-in setup pending"}</span>}
            {inviteError && <p className="invite-error">{inviteError}</p>}
            {inviteError.includes("different Google email") && user && <button className="text-action" onClick={signOut}>Sign out</button>}
          </section>}
          {inviteNotice && <div className="invite-success-banner"><Check size={16}/>{inviteNotice}</div>}

          <div className="page-heading">
            <div><div className="eyebrow">YOUR SECOND BRAIN, TOGETHER</div><h1>{view === "notes" ? "Your notes" : view === "calendar" ? "Your calendar" : "Shared with me"}</h1><p>{view === "notes" ? "A calm place for everything worth remembering." : view === "calendar" ? "Keep the important dates close." : "Notes and spaces people have shared with you."}</p></div>
            {view === "calendar" && user && <button className="primary-button" onClick={startNewEvent}><Plus size={17}/> New event</button>}{view === "notes" && user && <div className="page-actions">{user.personalWorkspaceId && <button className="secondary-button" onClick={() => { setInviteOpen(true); setInviteCreateError(""); setCopiedInvite(false); }}><Users size={16} /> Invite</button>}<button className="primary-button" onClick={startNewNote}><Plus size={17} /> New note</button></div>}
          </div>

          {view === "notes" && <>
            <div className="toolbar">
              <label className="search-box"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your notes..." /></label>
              <span className="filter-button static-filter">Recently updated <ChevronDown size={15} /></span>
            </div>
            {notesError && <div className="inline-error">{notesError}</div>}
            {notesLoading ? <div className="loading-state">Loading your notes…</div> : visibleNotes.length > 0 ? <div className="notes-grid">
              {visibleNotes.map(note => <article className="note-card" key={note.id}>
                <div className="note-card-top">{note.categoryName && <span className="note-category">{note.categoryName}</span>}<span className="note-date">{new Date(note.updatedAt).toLocaleDateString()}</span></div>
                <h3>{note.title}</h3><p>{note.content || "No additional details."}</p>
                <div className="note-card-actions"><button onClick={() => startEditNote(note)}><Pencil size={14} /> Edit</button><button onClick={() => archiveNote(note)}><Archive size={14} /> Archive</button></div>
              </article>)}
            </div> : <div className="empty-state">
              <div className="empty-illustration"><div className="paper paper-back"></div><div className="paper paper-front"><span></span><span></span><span></span><i><Check size={17} /></i></div><div className="sparkle sparkle-one">✦</div><div className="sparkle sparkle-two">✧</div></div>
              <h2>{query ? "No notes found" : user ? "A fresh page." : authStatus === "unavailable" ? "Almost ready." : "Your notes start here."}</h2>
              <p>{query ? "Try another search term." : user ? "Your notes will find a home here. Start with one small thought." : authStatus === "unavailable" ? "The app needs its dedicated D1 database and Google sign-in configuration before accounts can be enabled." : "Sign in with Google to create and sync your notes."}</p>
              {user ? <button className="primary-button" onClick={startNewNote}><Plus size={17} /> Create your first note</button> : authStatus === "signed_out" ? <a className="primary-button" href="/auth/google"><LogIn size={16} /> Continue with Google</a> : null}
            </div>}
          </>}

          {view === "calendar" && <section className="calendar-section">
            {eventsError&&<div className="inline-error">{eventsError}</div>}
            {eventsLoading?<div className="loading-state">Loading your calendar…</div>:events.length===0?<div className="placeholder-panel"><CalendarDays size={26}/><h2>Your calendar is clear.</h2><p>Add an event and optionally attach a reminder. Event times are stored in UTC with your selected timezone.</p>{user&&<button className="primary-button" onClick={startNewEvent}><Plus size={16}/> Add an event</button>}</div>:<div className="event-list">{events.map(event=><article className="event-card" key={event.id}><div className="event-date-block"><strong>{new Date(event.startsAt).toLocaleDateString(undefined,{day:"2-digit",timeZone:event.timezone})}</strong><span>{new Date(event.startsAt).toLocaleDateString(undefined,{month:"short",timeZone:event.timezone})}</span></div><div className="event-copy"><h3>{event.title}</h3><p>{new Date(event.startsAt).toLocaleString(undefined,{timeZone:event.timezone})} · {event.timezone}</p>{event.description&&<small>{event.description}</small>}</div><button className="mini-icon" onClick={()=>deleteEvent(event)} aria-label="Delete event"><Archive size={15}/></button></article>)}</div>}
          </section>}
          {view === "shared" && <div className="placeholder-panel"><Users size={26} /><h2>Shared notes live in your notes list.</h2><p>Notes shared with you appear alongside your personal notes. Invitations are managed from your workspace.</p><button className="secondary-button" onClick={()=>setView("notes")}>View notes</button></div>}

          <div className="ai-hint"><span className="ai-icon"><Sparkles size={17} /></span><div><strong>A little help from AI</strong><p>Turn a brain dump into tidy notes, tasks and reminders. Coming in a later step.</p></div><span className="coming-soon">COMING SOON</span></div>
        </div>
      </section>

      {inviteOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setInviteOpen(false); }}>
        <section className="composer invite-composer" role="dialog" aria-modal="true" aria-labelledby="invite-title">
          <header><div><span className="eyebrow">SHARE YOUR WORKSPACE</span><h2 id="invite-title">Invite someone</h2></div><button className="icon-button" onClick={() => setInviteOpen(false)} aria-label="Close"><X size={19}/></button></header>
          {!createdInvite ? <>
            <label className="field-label">Google email address<input className="invite-input" type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="name@gmail.com" maxLength={254}/></label>
            <label className="field-label">Permission<select className="invite-input" value={inviteRole} onChange={event => setInviteRole(event.target.value as "editor" | "viewer")}><option value="viewer">Viewer · can read notes</option><option value="editor">Editor · can read and edit notes</option></select></label>
            {inviteCreateError && <p className="invite-error">{inviteCreateError}</p>}
            <footer><span>We'll create a secure link. You send it yourself using Gmail.</span><button className="primary-button" onClick={createInvite} disabled={!inviteEmail.trim() || inviteSending}>{inviteSending ? "Creating…" : "Create invitation"}</button></footer>
          </> : <>
            <p className="invite-result-copy">Invitation created. It expires in seven days. KitaNotes has not sent an email.</p>
            <label className="field-label">One-time invitation link<input className="invite-input" readOnly value={createdInvite.invitationUrl}/></label>
            {inviteCreateError && <p className="invite-error">{inviteCreateError}</p>}
            <footer><button className="secondary-button" onClick={copyInviteLink}>{copiedInvite ? "Copied" : "Copy link"}</button><a className="primary-button" href={createdInvite.gmailComposeUrl} target="_blank" rel="noopener noreferrer">Open Gmail draft</a></footer>
          </>}
          <div className="invite-list">
            <div className="invite-list-heading"><strong>Workspace invitations</strong><span>{invitations.length}</span></div>
            {invitationsLoading ? <p>Loading invitations…</p> : invitations.length === 0 ? <p>No invitations yet.</p> : invitations.map(invitation => <div className="invite-list-row" key={invitation.id}>
              <div><strong>{invitation.email}</strong><small>{invitation.role} · {invitation.status} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</small></div>
              {invitation.status === "pending" && <button className="text-action" onClick={() => revokeInvitation(invitation.id)}>Revoke</button>}
            </div>)}
            <p className="invite-list-note">A pending link is shown only once. If it was lost, revoke it here and create a fresh invitation.</p>
          </div>
        </section>
      </div>}

      {eventComposerOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setEventComposerOpen(false);}}>
        <section className="composer" role="dialog" aria-modal="true" aria-labelledby="event-title">
          <header><div><span className="eyebrow">INTERNAL CALENDAR</span><h2 id="event-title">New event</h2></div><button className="icon-button" onClick={()=>setEventComposerOpen(false)} aria-label="Close"><X size={19}/></button></header>
          <label className="field-label">Event title<input className="invite-input" value={eventTitle} onChange={e=>setEventTitle(e.target.value)} maxLength={200} placeholder="What is happening?"/></label>
          <label className="field-label">Details<textarea className="invite-input event-description" value={eventDescription} onChange={e=>setEventDescription(e.target.value)} maxLength={5000} rows={3} placeholder="Optional details"/></label>
          <div className="event-datetime-grid"><label className="field-label">Starts<input className="invite-input" type="datetime-local" value={eventStart} onChange={e=>setEventStart(e.target.value)}/></label><label className="field-label">Ends<input className="invite-input" type="datetime-local" value={eventEnd} onChange={e=>setEventEnd(e.target.value)}/></label></div>
          <label className="field-label">Timezone<input className="invite-input" value={eventTimezone} onChange={e=>setEventTimezone(e.target.value)} placeholder="Asia/Kuala_Lumpur"/></label>
          <label className="field-label">Reminder (optional)<input className="invite-input" type="datetime-local" value={eventReminderAt} onChange={e=>setEventReminderAt(e.target.value)}/></label>
          {eventsError&&<p className="invite-error">{eventsError}</p>}
          <footer><span>Reminder delivery appears in the in-app inbox, checked every five minutes.</span><button className="primary-button" onClick={saveEvent} disabled={!eventTitle.trim()||eventSaving}>{eventSaving?"Saving…":"Save event"}</button></footer>
        </section>
      </div>}

      {composerOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setComposerOpen(false); }}>
        <section className="composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
          <header><div><span className="eyebrow">PERSONAL NOTE</span><h2 id="composer-title">{editingNote ? "Edit note" : "New note"}</h2></div><button className="icon-button" onClick={() => setComposerOpen(false)} aria-label="Close"><X size={19} /></button></header>
          <input className="composer-title" value={draftTitle} onChange={event => setDraftTitle(event.target.value)} placeholder="Give your note a title" maxLength={200} autoFocus />
          <textarea value={draftContent} onChange={event => setDraftContent(event.target.value)} placeholder="Start writing… anything worth remembering." maxLength={50000} rows={9} />
          <footer><span>{editingNote ? "Changes use version checking to avoid overwriting newer edits." : "Saved to your personal workspace."}</span><button className="primary-button" onClick={saveNote} disabled={!draftTitle.trim() || saving}>{saving ? "Saving…" : editingNote ? "Save changes" : "Save note"}</button></footer>
        </section>
      </div>}
    </main>
  );
}
