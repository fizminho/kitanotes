import { useEffect, useMemo, useState } from "react";
import { Bell, CalendarDays, Check, ChevronDown, Command, LogIn, LogOut, Plus, Search, Sparkles, Users, X, Archive, Pencil } from "lucide-react";

type View = "notes" | "calendar" | "shared";
type SessionUser = { id: string; email: string; displayName: string | null; avatarUrl: string | null };
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
            <button className="icon-button" aria-label="Notifications"><Bell size={18} /></button>
            {user ? <span className="signed-in-label">{user.displayName ?? user.email}</span> : authStatus === "signed_out" ? <a className="signin-button" href="/auth/google"><LogIn size={15} /> Continue with Google</a> : <span className="setup-label">{authStatus === "loading" ? "Checking session…" : "Sign-in setup pending"}</span>}
            {user?.avatarUrl ? <img className="profile-avatar small" src={user.avatarUrl} alt="" /> : <div className="profile-avatar small">{user?.displayName?.slice(0, 1).toUpperCase() ?? "?"}</div>}
          </div>
        </header>
        <div className="content">
          {inviteNotice && <div className="invite-success-banner"><Check size={16}/>{inviteNotice}</div>}
          <div className="page-heading">
            <div><div className="eyebrow">YOUR SECOND BRAIN, TOGETHER</div><h1>{view === "notes" ? "Your notes" : view === "calendar" ? "Your calendar" : "Shared with me"}</h1><p>{view === "notes" ? "A calm place for everything worth remembering." : view === "calendar" ? "Keep the important dates close." : "Notes and spaces people have shared with you."}</p></div>
            {view === "notes" && user && <button className="primary-button" onClick={startNewNote}><Plus size={17} /> New note</button>}
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

          {view === "calendar" && <div className="placeholder-panel"><CalendarDays size={26} /><h2>Your calendar is next.</h2><p>Internal events and reminders will be added after notes and sharing are ready.</p></div>}
          {view === "shared" && <div className="placeholder-panel"><Users size={26} /><h2>Shared spaces are next.</h2><p>Invite collaborators by verified Google email when workspace invitations are implemented.</p></div>}

          <div className="ai-hint"><span className="ai-icon"><Sparkles size={17} /></span><div><strong>A little help from AI</strong><p>Turn a brain dump into tidy notes, tasks and reminders. Coming in a later step.</p></div><span className="coming-soon">COMING SOON</span></div>
        </div>
      </section>

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
