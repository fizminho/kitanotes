import { useEffect, useMemo, useState } from "react";
import { Bell, CalendarDays, Check, ChevronDown, Command, LogIn, LogOut, Plus, Search, Sparkles, Users, X, Archive, Pencil } from "lucide-react";

type View = "notes" | "calendar" | "shared";
type InstallPromptEvent = Event & { prompt:()=>Promise<void>; userChoice:Promise<{outcome:"accepted"|"dismissed";platform:string}> };
function localDateTime(value: Date): string { const pad=(n:number)=>String(n).padStart(2,"0"); return value.getFullYear()+"-"+pad(value.getMonth()+1)+"-"+pad(value.getDate())+"T"+pad(value.getHours())+":"+pad(value.getMinutes()); }
function dateKey(value:Date):string { return value.getFullYear()+"-"+String(value.getMonth()+1).padStart(2,"0")+"-"+String(value.getDate()).padStart(2,"0"); }
function dateTimeInputFor(value:string,timezone:string):string {
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value));
 const part=(type:string)=>parts.find(item=>item.type===type)?.value??"00";
 return part("year")+"-"+part("month")+"-"+part("day")+"T"+part("hour")+":"+part("minute");
}
function zonedDateTimeToIso(value:string,timezone:string):string {
 const m=value.match(/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})$/); if(!m)throw new Error("Enter a valid event date and time.");
 const target=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]); let guess=target;
 for(let i=0;i<3;i++){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess));const p=(t:string)=>Number(parts.find(x=>x.type===t)?.value??0);const represented=Date.UTC(p("year"),p("month")-1,p("day"),p("hour"),p("minute"),p("second"));const next=guess+target-represented;if(next===guess)break;guess=next;}return new Date(guess).toISOString();
}
type SessionUser = { id: string; email: string; displayName: string | null; avatarUrl: string | null; personalWorkspaceId: string | null };
type Invitation = { id: string; email: string; role: "editor" | "viewer"; status: string; expiresAt: string };
type Category = {id:string;workspaceId:string;name:string;color:string|null;sortOrder:number};
type CalendarEvent = { id:string; workspaceId:string; title:string; description:string; startsAt:string; endsAt:string; timezone:string; allDay:boolean; linkedNoteId:string|null; version:number };
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
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState("");
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
  const [calendarMode,setCalendarMode]=useState<"month"|"week">("month");
  const [calendarCursor,setCalendarCursor]=useState(()=>new Date());
  const [editingEvent,setEditingEvent]=useState<CalendarEvent|null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [eventComposerOpen, setEventComposerOpen] = useState(false);
  const [eventTitle, setEventTitle] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventStart, setEventStart] = useState(() => localDateTime(new Date(Date.now()+3600000)));
  const [eventEnd, setEventEnd] = useState(() => localDateTime(new Date(Date.now()+7200000)));
  const [eventReminderAt, setEventReminderAt] = useState("");
  const [eventLinkedNoteId, setEventLinkedNoteId] = useState("");
  const [eventTimezone, setEventTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kuala_Lumpur");
  const [eventSaving, setEventSaving] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [installPrompt,setInstallPrompt]=useState<InstallPromptEvent|null>(null);
  const [installHelpOpen,setInstallHelpOpen]=useState(false);
  const [isInstalled,setIsInstalled]=useState(false);
  const [pushSupported,setPushSupported]=useState(false);
  const [pushSubscribed,setPushSubscribed]=useState(false);
  const [pushBusy,setPushBusy]=useState(false);
  const [pushError,setPushError]=useState("");
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
  const [aiCategoriesCreated, setAiCategoriesCreated] = useState(false);
  const [aiCreatedItems, setAiCreatedItems] = useState<string[]>([]);

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
    if (!user?.personalWorkspaceId) { setCategories([]); return; }
    let active=true;
    fetch("/api/categories?workspaceId="+encodeURIComponent(user.personalWorkspaceId),{credentials:"same-origin"})
      .then(async response=>{if(!response.ok)throw new Error("Unable to load categories.");const result=await response.json() as {categories:Category[]};if(active)setCategories(result.categories);})
      .catch(()=>undefined);
    return ()=>{active=false;};
  },[user?.personalWorkspaceId]);

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
    const rangeStart=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1);
    const rangeEnd=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);
    if(calendarMode==="week"){rangeStart.setDate(calendarCursor.getDate()-((calendarCursor.getDay()+6)%7));rangeEnd.setTime(rangeStart.getTime());rangeEnd.setDate(rangeStart.getDate()+7);}
    else{rangeStart.setDate(rangeStart.getDate()-((rangeStart.getDay()+6)%7));rangeEnd.setTime(rangeStart.getTime());rangeEnd.setDate(rangeStart.getDate()+42);}
    const from = new Date(rangeStart.getTime()-86400000).toISOString();
    const to = new Date(rangeEnd.getTime()+86400000).toISOString();
    fetch("/api/events?from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to),{credentials:"same-origin"})
      .then(async response => {
        if(!response.ok) throw new Error("Unable to load calendar events.");
        const result = await response.json() as {events:CalendarEvent[]};
        if(active) setEvents(result.events);
      })
      .catch(error => {if(active)setEventsError(error instanceof Error?error.message:"Unable to load calendar events.");})
      .finally(()=>{if(active)setEventsLoading(false);});
    return ()=>{active=false;};
  },[view,user,calendarMode,calendarCursor]);

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

  useEffect(()=>{
    const standalone=window.matchMedia("(display-mode: standalone)").matches||Boolean((navigator as Navigator & {standalone?:boolean}).standalone);
    setIsInstalled(standalone);
    const handler=(event:Event)=>{event.preventDefault();setInstallPrompt(event as InstallPromptEvent);};
    window.addEventListener("beforeinstallprompt",handler);
    window.addEventListener("appinstalled",()=>{setIsInstalled(true);setInstallPrompt(null);setInstallHelpOpen(false);});
    return ()=>window.removeEventListener("beforeinstallprompt",handler);
  },[]);

  useEffect(()=>{
    const supported="serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;
    setPushSupported(supported);
    if(!supported||!user)return;
    let active=true;
    navigator.serviceWorker.ready.then(registration=>registration.pushManager.getSubscription()).then(subscription=>{
      if(active)setPushSubscribed(Boolean(subscription));
    }).catch(()=>{if(active)setPushSubscribed(false);});
    return ()=>{active=false;};
  },[user]);

  async function installApp(){
    if(installPrompt){
      await installPrompt.prompt();
      const choice=await installPrompt.userChoice;
      if(choice.outcome==="accepted")setIsInstalled(true);
      setInstallPrompt(null);
    }else setInstallHelpOpen(value=>!value);
  }

  function decodeVapidKey(value:string):Uint8Array{
    const padded=value.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((value.length+3)%4);
    const raw=window.atob(padded);
    return Uint8Array.from(raw,char=>char.charCodeAt(0));
  }

  async function enablePush(){
    if(!user||pushBusy||!pushSupported)return;
    setPushBusy(true);setPushError("");
    try{
      const permission=Notification.permission==="default"?await Notification.requestPermission():Notification.permission;
      if(permission!=="granted")throw new Error(permission==="denied"?"Notifications are blocked in browser settings.":"Notification permission was not granted.");
      const keyResponse=await fetch("/api/push/public-key",{credentials:"same-origin"});
      const keyResult=await keyResponse.json() as {enabled:boolean;publicKey:string|null};
      if(!keyResponse.ok||!keyResult.enabled||!keyResult.publicKey)throw new Error("Push notifications are not configured on the KitaNotes server yet.");
      const registration=await navigator.serviceWorker.ready;
      const subscription=await registration.pushManager.getSubscription()??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeVapidKey(keyResult.publicKey)});
      const response=await fetch("/api/push/subscriptions",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(subscription.toJSON())});
      if(!response.ok)throw new Error("Unable to save this device's push subscription.");
      setPushSubscribed(true);
    }catch(error){setPushError(error instanceof Error?error.message:"Unable to enable push notifications.");}
    finally{setPushBusy(false);}
  }

  async function disablePush(){
    if(pushBusy)return;setPushBusy(true);setPushError("");
    try{
      const registration=await navigator.serviceWorker.ready;
      const subscription=await registration.pushManager.getSubscription();
      if(subscription){
        const response=await fetch("/api/push/subscriptions",{method:"DELETE",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({endpoint:subscription.endpoint})});
        if(!response.ok)throw new Error("Unable to remove this device from push notifications.");
        await subscription.unsubscribe();
      }
      setPushSubscribed(false);
    }catch(error){setPushError(error instanceof Error?error.message:"Unable to disable push notifications.");}
    finally{setPushBusy(false);}
  }

  async function testPush(){
    if(pushBusy)return;setPushBusy(true);setPushError("");
    try{const response=await fetch("/api/push/test",{method:"POST",credentials:"same-origin"});if(!response.ok)throw new Error("Unable to send a test notification.");}
    catch(error){setPushError(error instanceof Error?error.message:"Unable to send a test notification.");}
    finally{setPushBusy(false);}
  }

  const visibleNotes = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return notes;
    return notes.filter(note => (note.title + " " + note.content + " " + (note.categoryName ?? "")).toLowerCase().includes(value));
  }, [notes, query]);

  function startNewNote() {
    setEditingNote(null);
    setDraftTitle("");
    setDraftContent("");
    setSelectedCategoryId("");
    setComposerOpen(true);
  }

  function startEditNote(note: Note) {
    setEditingNote(note);
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setSelectedCategoryId(note.categoryId ?? "");
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
          ? { title: draftTitle, content: draftContent, categoryId: selectedCategoryId || null, version: editingNote.version }
          : { title: draftTitle, content: draftContent, categoryId: selectedCategoryId || null, workspaceId: user?.personalWorkspaceId })
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

  async function createCategory() {
    if(!user?.personalWorkspaceId||!categoryName.trim()||categorySaving)return;
    setCategorySaving(true);setCategoryError("");
    try{
      const response=await fetch("/api/categories",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
        workspaceId:user.personalWorkspaceId,name:categoryName,color:"#766bd0",sortOrder:categories.length
      })});
      const result=await response.json() as {category?:Category;error?:string};
      if(!response.ok||!result.category)throw new Error(result.error==="CATEGORY_ALREADY_EXISTS"?"A category with that name already exists.":"Unable to create category.");
      setCategories(current=>[...current,result.category!].sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name)));
      setCategoryName("");
    }catch(error){setCategoryError(error instanceof Error?error.message:"Unable to create category.");}
    finally{setCategorySaving(false);}
  }

  async function createAiCategories() {
    if(!aiDraft||!user?.personalWorkspaceId||aiCategoriesCreated)return;
    setCategorySaving(true);setAiError("");
    try{
      for(const suggestion of aiDraft.suggestedCategories){
        if(categories.some(category=>category.name.toLowerCase()===suggestion.name.toLowerCase()))continue;
        const response=await fetch("/api/categories",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
          workspaceId:user.personalWorkspaceId,name:suggestion.name,color:"#766bd0",sortOrder:categories.length
        })});
        if(!response.ok&&response.status!==409)throw new Error("Unable to create category: "+suggestion.name);
      }
      const response=await fetch("/api/categories?workspaceId="+encodeURIComponent(user.personalWorkspaceId),{credentials:"same-origin"});
      if(response.ok){
        const result=await response.json() as {categories:Category[]};
        setCategories(result.categories);
        const first=aiDraft.suggestedCategories.map(item=>result.categories.find(category=>category.name.toLowerCase()===item.name.toLowerCase())).find(Boolean);
        if(first)setSelectedCategoryId(first.id);
      }
      setAiCategoriesCreated(true);
    }catch(error){setAiError(error instanceof Error?error.message:"Unable to create suggested categories.");}
    finally{setCategorySaving(false);}
  }

  async function enableAi() {
    if(!aiConsentChecked||aiConsentSaving)return;
    setAiConsentSaving(true);setAiError("");
    try{
      const response=await fetch("/api/ai/consent",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({accepted:true})});
      if(!response.ok)throw new Error("Unable to save AI consent.");
      setAiStatus(current=>current?{...current,consented:true}:null);setAiConsentChecked(false);
    }catch(error){setAiError(error instanceof Error?error.message:"Unable to save AI consent.");}
    finally{setAiConsentSaving(false);}
  }

  async function revokeAiConsent() {
    const response=await fetch("/api/ai/consent",{method:"DELETE",credentials:"same-origin"});
    if(response.ok){setAiStatus(current=>current?{...current,consented:false}:null);setAiConsentChecked(false);setAiInput("");setAiDraft(null);}
  }

  async function organizeWithAi() {
    if(!aiInput.trim()||aiWorking||!aiStatus?.consented)return;
    setAiWorking(true);setAiError("");setAiDraft(null);setAiNoteSaved(false);setAiItemsCreated(false);setAiCategoriesCreated(false);setAiCreatedItems([]);
    try{
      const response=await fetch("/api/ai/organize",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
        text:aiInput,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"Asia/Kuala_Lumpur",workspaceId:user?.personalWorkspaceId
      })});
      const result=await response.json() as {draft?:AiDraft;usage?:{dailyLimit:number;dailyUsed:number;dailyRemaining:number};error?:string};
      if(!response.ok||!result.draft){
        const message=result.error==="AI_FREE_QUOTA_EXHAUSTED"||result.error==="AI_DAILY_FREE_LIMIT_REACHED"?"The free AI limit is reached. Try again after the quota resets."
          :result.error==="AI_NOT_CONFIGURED"?"Gemini is not configured yet."
          :result.error==="AI_CONSENT_REQUIRED"?"Please review and accept the AI privacy notice first."
          :result.error==="AI_INVALID_MODEL_RESPONSE"?"Gemini returned an invalid draft. Please retry with clearer text."
          :"AI is temporarily unavailable. Your original text has not been changed.";
        throw new Error(message);
      }
      setAiDraft(result.draft);setAiDraftTitle(result.draft.note.title);setAiDraftContent(result.draft.note.content);setSelectedCategoryId(categories.find(category=>result.draft!.suggestedCategories.some(item=>item.name.toLowerCase()===category.name.toLowerCase()))?.id??"");
      if(result.usage&&aiStatus)setAiStatus({...aiStatus,dailyUsed:result.usage.dailyUsed,dailyRemaining:result.usage.dailyRemaining});
    }catch(error){setAiError(error instanceof Error?error.message:"Unable to organise this text.");}
    finally{setAiWorking(false);}
  }

  async function saveAiNote() {
    if(!aiDraft||!user?.personalWorkspaceId||aiSavingNote||aiNoteSaved)return;
    setAiSavingNote(true);setAiError("");
    try{
      const response=await fetch("/api/notes",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
        workspaceId:user.personalWorkspaceId,title:aiDraftTitle,content:aiDraftContent,categoryId:selectedCategoryId||null
      })});
      const result=await response.json() as {note?:Note};
      if(!response.ok||!result.note)throw new Error("Unable to save the note draft.");
      setNotes(current=>[result.note!,...current]);setAiNoteSaved(true);
    }catch(error){setAiError(error instanceof Error?error.message:"Unable to save the note draft.");}
    finally{setAiSavingNote(false);}
  }

  async function createAiItems() {
    if(!aiDraft||!user?.personalWorkspaceId||aiCreatingItems||aiItemsCreated)return;
    setAiCreatingItems(true);setAiError("");
    const completed=new Set(aiCreatedItems);
    try{
      for(let index=0;index<aiDraft.events.length;index++){
        const event=aiDraft.events[index];
        const eventKey="event:"+index;
        let eventId:string|undefined;
        if(!completed.has(eventKey)){
          const response=await fetch("/api/events",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
            workspaceId:user.personalWorkspaceId,title:event.title,description:event.description,
            startsAt:new Date(event.startLocal).toISOString(),endsAt:new Date(event.endLocal).toISOString(),timezone:event.timezone
          })});
          const result=await response.json() as {event?:CalendarEvent};
          if(!response.ok||!result.event)throw new Error("Unable to create event: "+event.title);
          eventId=result.event.id;completed.add(eventKey);setEvents(current=>[...current,result.event!].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)));setAiCreatedItems([...completed]);
        }else{
          eventId=events.find(item=>item.title===event.title&&item.startsAt===new Date(event.startLocal).toISOString())?.id;
        }
        if(event.reminderLocal&&!completed.has("event-reminder:"+index)&&eventId){
          const reminderResponse=await fetch("/api/reminders",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
            workspaceId:user.personalWorkspaceId,eventId,title:event.title,dueAt:new Date(event.reminderLocal).toISOString(),timezone:event.timezone
          })});
          if(!reminderResponse.ok)throw new Error("Event created, but its reminder could not be saved.");
          completed.add("event-reminder:"+index);setAiCreatedItems([...completed]);
        }
      }
      const standalone=[...aiDraft.reminders.map(item=>({title:item.title,dueLocal:item.dueLocal,timezone:item.timezone,key:"reminder:"+item.title+":"+item.dueLocal})),...aiDraft.tasks.filter(item=>item.dueLocal).map(item=>({title:item.title,dueLocal:item.dueLocal!,timezone:aiDraft.timezone,key:"task:"+item.title+":"+item.dueLocal}))];
      for(const reminder of standalone){
        if(completed.has(reminder.key))continue;
        const response=await fetch("/api/reminders",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
          workspaceId:user.personalWorkspaceId,title:reminder.title,dueAt:new Date(reminder.dueLocal).toISOString(),timezone:reminder.timezone
        })});
        if(!response.ok)throw new Error("Unable to create reminder: "+reminder.title);
        completed.add(reminder.key);setAiCreatedItems([...completed]);
      }
      setAiItemsCreated(true);
    }catch(error){setAiError(error instanceof Error?error.message:"Unable to create suggested events or reminders.");}
    finally{setAiCreatingItems(false);}
  }


  function startNewEvent() {
    setEditingEvent(null);
    setEventTitle("");
    setEventDescription("");
    setEventStart(localDateTime(new Date(Date.now()+3600000)));
    setEventEnd(localDateTime(new Date(Date.now()+7200000)));
    setEventReminderAt("");
    setEventLinkedNoteId("");
    setEventsError("");
    setEventComposerOpen(true);
  }

  function startEditEvent(item:CalendarEvent) {
    setEditingEvent(item);setEventTitle(item.title);setEventDescription(item.description??"");setEventTimezone(item.timezone);
    setEventStart(dateTimeInputFor(item.startsAt,item.timezone));setEventEnd(dateTimeInputFor(item.endsAt,item.timezone));
    setEventReminderAt("");setEventLinkedNoteId(item.linkedNoteId??"");setEventsError("");setEventComposerOpen(true);
  }

  async function saveEvent() {
    if(!user?.personalWorkspaceId||!eventTitle.trim()||eventSaving)return;
    setEventSaving(true);setEventsError("");
    try {
      const payload={title:eventTitle,description:eventDescription,startsAt:zonedDateTimeToIso(eventStart,eventTimezone),endsAt:zonedDateTimeToIso(eventEnd,eventTimezone),timezone:eventTimezone,linkedNoteId:eventLinkedNoteId||null};
      const response=await fetch(editingEvent?"/api/events/"+encodeURIComponent(editingEvent.id):"/api/events",{method:editingEvent?"PATCH":"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(editingEvent?{...payload,version:editingEvent.version}:{...payload,workspaceId:user.personalWorkspaceId})});
      const result=await response.json() as {event?:CalendarEvent};
      if(!response.ok||!result.event)throw new Error(response.status===409?"This event changed elsewhere. Close and reopen it before saving.":"Unable to save this event.");
      setEvents(current=>editingEvent?current.map(item=>item.id===result.event!.id?result.event!:item).sort((a,b)=>a.startsAt.localeCompare(b.startsAt)):[...current,result.event!].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)));
      if(eventReminderAt&&!editingEvent){
        const reminderResponse=await fetch("/api/reminders",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
          workspaceId:user.personalWorkspaceId,eventId:result.event.id,title:eventTitle,dueAt:new Date(eventReminderAt).toISOString(),timezone:eventTimezone
        })});
        if(!reminderResponse.ok)setEventsError("Event saved, but its reminder could not be created.");
      }
      setEventComposerOpen(false);setEditingEvent(null);
    }catch(error){setEventsError(error instanceof Error?error.message:"Unable to save this event.");}
    finally{setEventSaving(false);}
  }

  const calendarDays=useMemo(()=>{const start=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1);if(calendarMode==="week")start.setDate(calendarCursor.getDate()-((calendarCursor.getDay()+6)%7));else start.setDate(start.getDate()-((start.getDay()+6)%7));return Array.from({length:calendarMode==="week"?7:42},(_,i)=>{const day=new Date(start);day.setDate(start.getDate()+i);return day;});},[calendarCursor,calendarMode]);
  const calendarHeading=calendarMode==="week"?calendarDays[0].toLocaleDateString(undefined,{month:"short",day:"numeric"})+" – "+calendarDays[6].toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):calendarCursor.toLocaleDateString(undefined,{month:"long",year:"numeric"});
  function moveCalendar(amount:number){setCalendarCursor(current=>{const next=new Date(current);if(calendarMode==="week")next.setDate(next.getDate()+amount*7);else next.setMonth(next.getMonth()+amount);return next;});}
  function eventsForDay(day:Date){return events.filter(item=>dateKey(new Date(item.startsAt))===dateKey(day));}

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
            {!isInstalled&&<button className="install-app-button" onClick={installApp}>Install app</button>}
            <button className="icon-button notification-trigger" aria-label="Notifications" onClick={()=>setNotificationsOpen(value=>!value)} disabled={!user}><Bell size={18}/>{unreadCount>0&&<span>{unreadCount>9?"9+":unreadCount}</span>}</button>
            {user ? <span className="signed-in-label">{user.displayName ?? user.email}</span> : authStatus === "signed_out" ? <a className="signin-button" href="/auth/google"><LogIn size={15} /> Continue with Google</a> : <span className="setup-label">{authStatus === "loading" ? "Checking session…" : "Sign-in setup pending"}</span>}
            {user?.avatarUrl ? <img className="profile-avatar small" src={user.avatarUrl} alt="" /> : <div className="profile-avatar small">{user?.displayName?.slice(0, 1).toUpperCase() ?? "?"}</div>}
          </div>
        </header>
        <div className="content">
          {installHelpOpen&&<section className="install-help"><button className="mini-icon" onClick={()=>setInstallHelpOpen(false)} aria-label="Close install instructions"><X size={15}/></button><strong>Install KitaNotes</strong><p><b>iPhone / iPad:</b> Open this page in Safari, tap Share, then choose Add to Home Screen.</p><p><b>Android:</b> Open the browser menu and choose Install app or Add to Home screen.</p></section>}
          {notificationsOpen && <section className="notification-panel">
            <header><strong>Notifications</strong><div className="notification-actions">{pushSupported&&user&&<button className="text-action" onClick={pushSubscribed?disablePush:enablePush} disabled={pushBusy}>{pushBusy?"Working…":pushSubscribed?"Disable push":"Enable push"}</button>}{pushSubscribed&&<button className="text-action" onClick={testPush} disabled={pushBusy}>Test</button>}<button className="text-action" onClick={markAllNotificationsRead} disabled={unreadCount===0}>Mark all read</button></div></header>
            {pushError&&<p className="invite-error">{pushError}</p>}
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
            {view === "calendar" && user && <button className="primary-button" onClick={startNewEvent}><Plus size={17}/> New event</button>}{view === "notes" && user && <div className="page-actions">{user.personalWorkspaceId && <button className="secondary-button" onClick={() => { setInviteOpen(true); setInviteCreateError(""); setCopiedInvite(false); }}><Users size={16} /> Invite</button>}<button className="secondary-button" onClick={()=>setCategoryModalOpen(true)}>Categories</button><button className="secondary-button" onClick={()=>{setAiModalOpen(true);setAiError("");}}><Sparkles size={16}/> Organize with AI</button><button className="primary-button" onClick={startNewNote}><Plus size={17} /> New note</button></div>}
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
            <div className="calendar-toolbar"><div className="calendar-navigation"><button className="secondary-button" onClick={()=>setCalendarCursor(new Date())}>Today</button><button className="calendar-arrow" onClick={()=>moveCalendar(-1)} aria-label="Previous period">‹</button><button className="calendar-arrow" onClick={()=>moveCalendar(1)} aria-label="Next period">›</button><h2>{calendarHeading}</h2></div><div className="calendar-mode"><button className={calendarMode==="month"?"active":""} onClick={()=>setCalendarMode("month")}>Month</button><button className={calendarMode==="week"?"active":""} onClick={()=>setCalendarMode("week")}>Week</button></div></div>
            {eventsLoading?<div className="loading-state">Loading your calendar…</div>:<div className={calendarMode==="month"?"calendar-grid month-grid":"calendar-grid week-grid"}>{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day=><div className="calendar-weekday" key={day}>{day}</div>)}{calendarDays.map(day=><div className={"calendar-day"+(day.getMonth()!==calendarCursor.getMonth()&&calendarMode==="month"?" outside":"")+(dateKey(day)===dateKey(new Date())?" today":"")} key={dateKey(day)}><div className="calendar-day-heading"><span>{day.getDate()}</span>{calendarMode==="week"&&<small>{day.toLocaleDateString(undefined,{month:"short"})}</small>}</div><div className="calendar-day-events">{eventsForDay(day).map(item=><button className="calendar-event-chip" key={item.id} onClick={()=>startEditEvent(item)} title={item.title}><span>{new Date(item.startsAt).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</span>{item.title}</button>)}</div>{calendarMode==="week"&&eventsForDay(day).length===0&&<span className="calendar-empty-day">No events</span>}</div>)}</div>}
            {!eventsLoading&&events.length===0&&<div className="calendar-empty-note">Nothing scheduled in this period. Add an event to start filling the calendar.</div>}
            <div className="calendar-agenda"><h3>Upcoming in this view</h3>{events.filter(item=>new Date(item.endsAt)>=new Date(calendarDays[0].getTime()-86400000)&&new Date(item.startsAt)<new Date(calendarDays[calendarDays.length-1].getTime()+2*86400000)).map(item=><article className="event-card" key={item.id}><div className="event-date-block"><strong>{new Date(item.startsAt).toLocaleDateString(undefined,{day:"2-digit",timeZone:item.timezone})}</strong><span>{new Date(item.startsAt).toLocaleDateString(undefined,{month:"short",timeZone:item.timezone})}</span></div><div className="event-copy"><h3>{item.title}</h3><p>{new Date(item.startsAt).toLocaleString(undefined,{timeZone:item.timezone})} · {item.timezone}</p>{item.description&&<small>{item.description}</small>}</div><button className="mini-icon" onClick={()=>startEditEvent(item)} aria-label="Edit event"><Pencil size={15}/></button><button className="mini-icon" onClick={()=>deleteEvent(item)} aria-label="Delete event"><Archive size={15}/></button></article>)}</div>
          </section>}
          {view === "shared" && <div className="placeholder-panel"><Users size={26} /><h2>Shared notes live in your notes list.</h2><p>Notes shared with you appear alongside your personal notes. Invitations are managed from your workspace.</p><button className="secondary-button" onClick={()=>setView("notes")}>View notes</button></div>}

          <button className="ai-hint" onClick={()=>{setAiModalOpen(true);setAiError("");}} disabled={!user}><span className="ai-icon"><Sparkles size={17}/></span><div><strong>AI organiser</strong><p>Turn a brain dump into a note, events and reminders.</p></div><span className="coming-soon">{aiStatus?.configured?"OPEN":"SETUP"}</span></button>
        </div>
      </section>

      {categoryModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setCategoryModalOpen(false);}}>
        <section className="composer" role="dialog" aria-modal="true" aria-labelledby="category-title">
          <header><div><span className="eyebrow">ORGANISE YOUR NOTES</span><h2 id="category-title">Categories</h2></div><button className="icon-button" onClick={()=>setCategoryModalOpen(false)} aria-label="Close"><X size={19}/></button></header>
          <label className="field-label">New category<input className="invite-input" value={categoryName} onChange={event=>setCategoryName(event.target.value)} maxLength={50} placeholder="e.g. Family, Work, Ideas"/></label>
          {categoryError&&<p className="invite-error">{categoryError}</p>}
          <footer><span>{categories.length} categories in your workspace</span><button className="primary-button" onClick={createCategory} disabled={!categoryName.trim()||categorySaving}>{categorySaving?"Saving…":"Create category"}</button></footer>
          <div className="category-list">{categories.map(category=><div key={category.id}><span className="category-dot" style={{background:category.color||"#8c88a7"}}/><strong>{category.name}</strong></div>)}</div>
        </section>
      </div>}
\n      {aiModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setAiModalOpen(false);}}>
        <section className="composer ai-composer" role="dialog" aria-modal="true" aria-labelledby="ai-title">
          <header><div><span className="eyebrow">GEMINI FREE TIER</span><h2 id="ai-title">Organize with AI</h2></div><button className="icon-button" onClick={()=>setAiModalOpen(false)} aria-label="Close"><X size={19}/></button></header>
          {!aiStatus?<p className="ai-privacy-copy">Checking AI configuration…</p>:!aiStatus.configured?<div className="ai-privacy-card"><strong>AI is not configured yet.</strong><p>Add the Gemini API key as a Cloudflare Worker Secret. No text will be sent until the key and your consent are both present.</p></div>:!aiStatus.consented?<div className="ai-privacy-card">
            <strong>Before enabling AI, please review this privacy notice.</strong>
            <p>Your pasted text will be sent to Google Gemini. Google states that content submitted through its free tier may be used to improve its products. Read the <a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">Gemini pricing and data terms</a> and the <a href="https://github.com/fizminho/kitanotes/blob/main/docs/AI_PRIVACY.md" target="_blank" rel="noreferrer">KitaNotes AI privacy policy</a>. Do not paste passwords, banking details, sensitive personal data or anything you do not want shared with Google.</p>
            <p>KitaNotes uses only allowlisted free-tier text models, never falls back to a paid model, and stops when the local daily limit or provider quota is reached. Keep the Google Cloud project unlinked from Cloud Billing to maintain the RM0 target.</p>
            <p>AI results are drafts. KitaNotes will not save a note, create an event or add a reminder until you confirm each action.</p>
            <label className="ai-consent-check"><input type="checkbox" checked={aiConsentChecked} onChange={event=>setAiConsentChecked(event.target.checked)}/> I understand and consent to sending the text I submit to Google Gemini under these terms.</label>
            {aiError&&<p className="invite-error">{aiError}</p>}
            <footer><span>Consent can be revoked at any time.</span><button className="primary-button" onClick={enableAi} disabled={!aiConsentChecked||aiConsentSaving}>{aiConsentSaving?"Saving…":"Agree and enable AI"}</button></footer>
          </div>:!aiDraft?<div>
            <p className="ai-privacy-copy">Paste unstructured text. Gemini will suggest a clean note, categories, events, reminders and tasks. Review everything before saving.</p>
            <textarea className="ai-input" value={aiInput} onChange={event=>setAiInput(event.target.value)} maxLength={16000} rows={9} placeholder="Example: Meeting with Sarah next Tuesday at 10am. Prepare the proposal beforehand and remind me 30 minutes before…"/>
            <div className="ai-usage-row"><span>{aiInput.length.toLocaleString()} / 16,000 characters</span><span>{aiStatus.dailyRemaining} free requests left today</span></div>
            {aiError&&<p className="invite-error">{aiError}</p>}
            <footer><button className="text-action" onClick={revokeAiConsent}>Revoke AI consent</button><button className="primary-button" onClick={organizeWithAi} disabled={!aiInput.trim()||aiWorking||aiStatus.dailyRemaining===0}>{aiWorking?"Organizing…":"Organize text"}</button></footer>
          </div>:<div className="ai-draft">
            <div className="ai-draft-banner"><Sparkles size={15}/> Draft only. Nothing has been saved yet.</div>
            <p className="ai-privacy-copy">{aiDraft.summary}</p>
            <label className="field-label">Note title<input className="invite-input" value={aiDraftTitle} onChange={event=>setAiDraftTitle(event.target.value)} maxLength={200}/></label>
            <label className="field-label">Note content<textarea className="ai-input" value={aiDraftContent} onChange={event=>setAiDraftContent(event.target.value)} rows={6} maxLength={50000}/></label>
            {aiDraft.suggestedCategories.length>0&&<div className="ai-draft-section"><strong>Suggested categories</strong>{aiDraft.suggestedCategories.map(category=><div key={category.name}><b>{category.name}</b><small>{category.reason}</small></div>)}<button className="secondary-button" onClick={createAiCategories} disabled={categorySaving||aiCategoriesCreated}>{categorySaving?"Creating…":aiCategoriesCreated?"Categories added":"Add suggested categories"}</button></div>}
            <label className="field-label">Save note in category<select className="invite-input" value={selectedCategoryId} onChange={event=>setSelectedCategoryId(event.target.value)}><option value="">Uncategorised</option>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            {aiDraft.events.length>0&&<div className="ai-draft-section"><strong>Events</strong>{aiDraft.events.map((event,index)=><div key={index}><b>{event.title}</b><small>{event.startLocal} to {event.endLocal} ({event.timezone}){event.reminderLocal?" · reminder "+event.reminderLocal:""}</small></div>)}</div>}
            {aiDraft.reminders.length>0&&<div className="ai-draft-section"><strong>Reminders</strong>{aiDraft.reminders.map((item,index)=><div key={index}><b>{item.title}</b><small>{item.dueLocal} ({item.timezone})</small></div>)}</div>}
            {aiDraft.tasks.length>0&&<div className="ai-draft-section"><strong>Tasks</strong>{aiDraft.tasks.map((item,index)=><div key={index}><b>{item.title}</b><small>{item.dueLocal||"No due date supplied"}</small></div>)}</div>}
            {aiDraft.clarifyingQuestions.length>0&&<div className="ai-questions"><strong>Needs clarification</strong>{aiDraft.clarifyingQuestions.map((question,index)=><p key={index}>{question}</p>)}</div>}
            {aiError&&<p className="invite-error">{aiError}</p>}
            {aiNoteSaved&&<p className="ai-saved">Note saved to your workspace.</p>}
            {aiItemsCreated&&<p className="ai-saved">Suggested events and reminders created.</p>}
            <footer><button className="text-action" onClick={()=>{setAiDraft(null);setAiError("");}}>Start over</button><button className="secondary-button" onClick={createAiItems} disabled={aiCreatingItems||aiItemsCreated||(!aiDraft.events.length&&!aiDraft.reminders.length&&!aiDraft.tasks.some(task=>task.dueLocal))}>{aiCreatingItems?"Creating…":aiItemsCreated?"Items created":"Create events & reminders"}</button><button className="primary-button" onClick={saveAiNote} disabled={aiSavingNote||aiNoteSaved||!aiDraftTitle.trim()}>{aiSavingNote?"Saving…":aiNoteSaved?"Note saved":"Save note"}</button></footer>
            <button className="text-action ai-revoke" onClick={revokeAiConsent}>Revoke AI consent</button>
          </div>}
        </section>
      </div>}

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
          <header><div><span className="eyebrow">INTERNAL CALENDAR</span><h2 id="event-title">{editingEvent?"Edit event":"New event"}</h2></div><button className="icon-button" onClick={()=>setEventComposerOpen(false)} aria-label="Close"><X size={19}/></button></header>
          <label className="field-label">Event title<input className="invite-input" value={eventTitle} onChange={e=>setEventTitle(e.target.value)} maxLength={200} placeholder="What is happening?"/></label>
          <label className="field-label">Details<textarea className="invite-input event-description" value={eventDescription} onChange={e=>setEventDescription(e.target.value)} maxLength={5000} rows={3} placeholder="Optional details"/></label>
          <div className="event-datetime-grid"><label className="field-label">Starts<input className="invite-input" type="datetime-local" value={eventStart} onChange={e=>setEventStart(e.target.value)}/></label><label className="field-label">Ends<input className="invite-input" type="datetime-local" value={eventEnd} onChange={e=>setEventEnd(e.target.value)}/></label></div>
          <label className="field-label">Timezone<input className="invite-input" value={eventTimezone} onChange={e=>setEventTimezone(e.target.value)} placeholder="Asia/Kuala_Lumpur"/></label>
          <label className="field-label">Link to note (optional)<select className="invite-input" value={eventLinkedNoteId} onChange={e=>setEventLinkedNoteId(e.target.value)}><option value="">No linked note</option>{notes.filter(note=>note.workspaceId===user?.personalWorkspaceId).map(note=><option key={note.id} value={note.id}>{note.title}</option>)}</select></label>\n          <label className="field-label">Reminder (optional)<input className="invite-input" type="datetime-local" value={eventReminderAt} onChange={e=>setEventReminderAt(e.target.value)}/></label>
          {eventsError&&<p className="invite-error">{eventsError}</p>}
          <footer><span>{editingEvent?"Changes use version checking. Existing reminders are retained.":"Reminder delivery appears in the in-app inbox, checked every five minutes."}</span><button className="primary-button" onClick={saveEvent} disabled={!eventTitle.trim()||eventSaving}>{eventSaving?"Saving…":editingEvent?"Save changes":"Save event"}</button></footer>
        </section>
      </div>}

      {composerOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setComposerOpen(false); }}>
        <section className="composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
          <header><div><span className="eyebrow">PERSONAL NOTE</span><h2 id="composer-title">{editingNote ? "Edit note" : "New note"}</h2></div><button className="icon-button" onClick={() => setComposerOpen(false)} aria-label="Close"><X size={19} /></button></header>
          <input className="composer-title" value={draftTitle} onChange={event => setDraftTitle(event.target.value)} placeholder="Give your note a title" maxLength={200} autoFocus />
          <textarea value={draftContent} onChange={event => setDraftContent(event.target.value)} placeholder="Start writing… anything worth remembering." maxLength={50000} rows={9} />
          <label className="field-label">Category<select className="invite-input" value={selectedCategoryId} onChange={event=>setSelectedCategoryId(event.target.value)}><option value="">Uncategorised</option>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <footer><span>{editingNote ? "Changes use version checking to avoid overwriting newer edits." : "Saved to your personal workspace."}</span><button className="primary-button" onClick={saveNote} disabled={!draftTitle.trim() || saving}>{saving ? "Saving…" : editingNote ? "Save changes" : "Save note"}</button></footer>
        </section>
      </div>}
    </main>
  );
}
