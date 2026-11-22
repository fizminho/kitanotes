import { useState } from "react";
import { Bell, CalendarDays, Check, ChevronDown, Command, Plus, Search, Sparkles, Users } from "lucide-react";
type View = "notes" | "calendar" | "shared";
export default function App() {
 const [view,setView]=useState<View>("notes"); const [query,setQuery]=useState("");
 return <main className="app-shell"><aside className="sidebar">
  <a className="brand" href="/"><span className="brand-mark"><Command size={19}/></span><span>Kita<span className="brand-soft">Notes</span></span></a>
  <button className="workspace-switch"><span className="workspace-avatar">K</span><span className="workspace-copy"><strong>My workspace</strong><small>Personal space</small></span><ChevronDown size={16}/></button>
  <div className="nav-label">WORKSPACE</div><nav className="nav-list" aria-label="Main navigation">
   <button className={view==="notes"?"nav-item active":"nav-item"} onClick={()=>setView("notes")}><Command size={17}/>Notes<span className="nav-count">0</span></button>
   <button className={view==="calendar"?"nav-item active":"nav-item"} onClick={()=>setView("calendar")}><CalendarDays size={17}/>Calendar</button>
   <button className={view==="shared"?"nav-item active":"nav-item"} onClick={()=>setView("shared")}><Users size={17}/>Shared with me</button>
  </nav><div className="sidebar-bottom"><div className="upgrade-card"><Sparkles size={17}/><strong>Your ideas, organised.</strong><p>Capture a thought now. Give it structure later.</p></div><div className="profile-row"><div className="profile-avatar">?</div><div><strong>Guest preview</strong><small>Sign-in coming next</small></div><ChevronDown size={15}/></div></div>
 </aside><section className="main-panel"><header className="topbar"><div className="breadcrumb">My workspace <span>/</span> {view==="notes"?"Notes":view==="calendar"?"Calendar":"Shared with me"}</div><div className="top-actions"><button className="icon-button" aria-label="Notifications"><Bell size={18}/></button><div className="profile-avatar small">?</div></div></header>
  <div className="content"><div className="page-heading"><div><div className="eyebrow">YOUR SECOND BRAIN, TOGETHER</div><h1>{view==="notes"?"Your notes":view==="calendar"?"Your calendar":"Shared with me"}</h1><p>{view==="notes"?"A calm place for everything worth remembering.":view==="calendar"?"Keep the important dates close.":"Notes and spaces people have shared with you."}</p></div><button className="primary-button" onClick={()=>setView("notes")}><Plus size={17}/>New note</button></div>
   <div className="toolbar"><label className="search-box"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search your notes..."/></label><button className="filter-button">Recently updated <ChevronDown size={15}/></button></div>
   <div className="empty-state"><div className="empty-illustration"><div className="paper paper-back"></div><div className="paper paper-front"><span></span><span></span><span></span><i><Check size={17}/></i></div><div className="sparkle sparkle-one">✦</div><div className="sparkle sparkle-two">✧</div></div><h2>{query?"No notes found":view==="notes"?"A fresh page.":view==="calendar"?"Your calendar is clear.":"Nothing shared yet."}</h2><p>{query?"Try another search term.":"Your notes, plans and shared ideas will find a home here."}</p><button className="primary-button" onClick={()=>setView("notes")}><Plus size={17}/>Create your first note</button></div>
   <div className="ai-hint"><span className="ai-icon"><Sparkles size={17}/></span><div><strong>A little help from AI</strong><p>Turn a brain dump into tidy notes, tasks and reminders. Coming in a later step.</p></div><span className="coming-soon">COMING SOON</span></div>
  </div></section></main>;
}
