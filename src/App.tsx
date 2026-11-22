import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, CalendarDays, Check, ChevronDown, Command, LogIn, LogOut, Plus, Search, Sparkles, Users, X, Archive, Pencil, Trash2, RotateCcw, Moon, Sun, Tag } from "lucide-react";

type ActivityItem = { id:string; type:string; actor:string; target:string|null; metadata:Record<string,unknown>; createdAt:string };
type ManageTab = "people" | "invite" | "activity" | "settings" | "leave";
type SortMode = "updated" | "oldest" | "title";
type Toast = { id:number; text:string; tone:"ok"|"error" };
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
 const m=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/); if(!m)throw new Error("Enter a valid event date and time.");
 const target=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]); let guess=target;
 for(let i=0;i<3;i++){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess));const p=(t:string)=>Number(parts.find(x=>x.type===t)?.value??0);const represented=Date.UTC(p("year"),p("month")-1,p("day"),p("hour"),p("minute"),p("second"));const next=guess+target-represented;if(next===guess)break;guess=next;}return new Date(guess).toISOString();
}
type SessionUser = { id: string; email: string; displayName: string | null; avatarUrl: string | null; personalWorkspaceId: string | null };
type Invitation = { id: string; email: string; role: "editor" | "viewer"; status: string; expiresAt: string };
type WorkspaceMember = {userId:string;email:string;displayName:string|null;role:"owner"|"editor"|"viewer";joinedAt:string};
type Workspace = {id:string;name:string;type:"shared";visibility:"private"|"shared";role:"owner"|"editor"|"viewer"};
type Category = {id:string;workspaceId:string;name:string;color:string|null;sortOrder:number};
type CalendarEvent = { id:string; source?:"google_calendar"|"kitanotes"; workspaceId:string; title:string; description:string; startsAt:string; endsAt:string; timezone:string; allDay:boolean; linkedNoteId:string|null; createdBy:string; createdByName:string|null; createdByEmail:string|null; updatedBy:string|null; updatedByName:string|null; updatedByEmail:string|null; createdAt:string; updatedAt:string; version:number };
type Notification = { id:string; type:string; title:string; body:string; resourceType:string|null; resourceId:string|null; createdAt:string; readAt:string|null };
type GoogleCalendarStatus = {connected:boolean;lastSyncAt:string|null;direction:"google_to_kitanotes";readOnly:boolean};
type NotificationPreferences = {pushEnabled:boolean;reminderPushEnabled:boolean;sharedNotePushEnabled:boolean;quietHoursStart:string|null;quietHoursEnd:string|null;timezone:string};
type AiDraft = {
  summary:string; timezone:string;
  note:{title:string;content:string};
  suggestedCategories:{name:string;reason:string}[];
  categorySuggestion:{name:string;reason:string;createNew:boolean}|null;
  events:{title:string;description:string;startLocal:string;endLocal:string;reminderLocal:string|null;timezone:string}[];
  reminders:{title:string;dueLocal:string;timezone:string}[];
  tasks:{title:string;dueLocal:string|null}[];
  clarifyingQuestions:string[];
};
type AiStatus = {configured:boolean;dailyLimit:number;dailyUsed:number;dailyRemaining:number};
type WorkspaceAiDraft = {name:string;categories:Array<{name:string;description:string}>};
type Note = {
  id: string; workspaceId: string; title: string; content: string; categoryId: string | null;
  categoryName: string | null; createdBy: string; createdByName:string|null; createdByEmail:string|null; updatedBy:string|null; updatedByName:string|null; updatedByEmail:string|null; version: number; createdAt: string; updatedAt: string; archivedAt: string | null;
};

export default function App() {
  const [view, setView] = useState<View>("notes");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [manageTab, setManageTab] = useState<ManageTab>("people");
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [showArchived, setShowArchived] = useState(false);
  const [theme, setTheme] = useState<"light"|"dark">(() => { try { const saved = localStorage.getItem("kitanotes-theme"); if (saved === "dark" || saved === "light") return saved; } catch { /* ignore */ } return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"; });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const pushToast = useCallback((text:string, tone:"ok"|"error"="ok") => {
    const id = Date.now() + Math.random();
    setToasts(current => [...current.slice(-3), { id, text, tone }]);
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), 3500);
  }, []);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [workspaces,setWorkspaces]=useState<Workspace[]>([]);
  const [activeWorkspaceId,setActiveWorkspaceId]=useState("");
  const [workspaceModalOpen,setWorkspaceModalOpen]=useState(false);
  const [workspaceName,setWorkspaceName]=useState("");
  const [workspacePurpose,setWorkspacePurpose]=useState("");
  const [workspaceAiBusy,setWorkspaceAiBusy]=useState(false);
  const [workspaceSaving,setWorkspaceSaving]=useState(false);
  const [workspaceAiDraft,setWorkspaceAiDraft]=useState<WorkspaceAiDraft|null>(null);
  const [workspaceAiError,setWorkspaceAiError]=useState("");
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
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteCreateError, setInviteCreateError] = useState("");
  const [createdInvite, setCreatedInvite] = useState<{ invitationUrl: string; gmailComposeUrl: string|null } | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [workspaceMembers,setWorkspaceMembers]=useState<WorkspaceMember[]>([]);
  const [workspaceActionBusy,setWorkspaceActionBusy]=useState(false);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [inviteRefresh, setInviteRefresh] = useState(0);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [googleCalendarStatus,setGoogleCalendarStatus]=useState<GoogleCalendarStatus>({connected:false,lastSyncAt:null,direction:"google_to_kitanotes",readOnly:true});
  const [googleCalendarBusy,setGoogleCalendarBusy]=useState(false);
  const [googleCalendarError,setGoogleCalendarError]=useState("");
  const [calendarRefresh,setCalendarRefresh]=useState(0);
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
  const [notificationPrefs,setNotificationPrefs]=useState<NotificationPreferences>({pushEnabled:true,reminderPushEnabled:true,sharedNotePushEnabled:true,quietHoursStart:null,quietHoursEnd:null,timezone:"Asia/Kuala_Lumpur"});
  const [notificationPrefsLoading,setNotificationPrefsLoading]=useState(false);
  const [notificationPrefsSaving,setNotificationPrefsSaving]=useState(false);
  const [notificationPrefsError,setNotificationPrefsError]=useState("");
  const [notificationPrefsSaved,setNotificationPrefsSaved]=useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [ocrFile,setOcrFile] = useState<File|null>(null);
  const [ocrWorking,setOcrWorking] = useState(false);
  const [ocrText,setOcrText] = useState("");
  const [ocrPreviewUrl,setOcrPreviewUrl] = useState("");
  const [aiWorking, setAiWorking] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [aiDraftTitle, setAiDraftTitle] = useState("");
  const [aiDraftContent, setAiDraftContent] = useState("");
  const [aiSavingNote, setAiSavingNote] = useState(false);
  const [aiCreatingItems, setAiCreatingItems] = useState(false);
  const [aiNoteSaved, setAiNoteSaved] = useState(false);
  const [aiItemsCreated, setAiItemsCreated] = useState(false);
  const [aiCreatedItems, setAiCreatedItems] = useState<string[]>([]);

  useEffect(()=>{
    if(!ocrFile){setOcrPreviewUrl("");return;}
    const url=URL.createObjectURL(ocrFile);setOcrPreviewUrl(url);
    return ()=>URL.revokeObjectURL(url);
  },[ocrFile]);

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

  function createPersonalWorkspace() {
    if(workspaceModalOpen)return;
    setWorkspaceName("");setWorkspacePurpose("");setWorkspaceAiDraft(null);setWorkspaceAiError("");setWorkspaceModalOpen(true);
  }

  async function generateWorkspaceWithAi() {
    if(!workspacePurpose.trim()||workspaceAiBusy)return;
    if(!aiStatus?.configured){setWorkspaceAiError("AI is not configured on the server yet. You can still create a workspace manually.");return;}
    setWorkspaceAiBusy(true);setWorkspaceAiError("");
    try{
      const response=await fetch("/api/ai/workspace",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({purpose:workspacePurpose.trim()})});
      const result=await response.json() as {draft?:WorkspaceAiDraft;usage?:{dailyUsed:number;dailyRemaining:number};error?:string};
      if(!response.ok||!result.draft){
        const message=result.error==="AI_NOT_CONFIGURED"?"AI is not configured on the server yet."
          :result.error==="AI_DAILY_FREE_LIMIT_REACHED"||result.error==="AI_FREE_QUOTA_EXHAUSTED"?"AI is temporarily unavailable due to usage limits. Try again later."
          :result.error==="WORKSPACE_LIMIT_REACHED"?"You have reached the 30 shared workspace limit."
          :"AI could not prepare this workspace. You can retry or create it manually.";
        throw new Error(message);
      }
      setWorkspaceAiDraft(result.draft);setWorkspaceName(result.draft.name);
      if(result.usage&&aiStatus)setAiStatus({...aiStatus,dailyUsed:result.usage.dailyUsed,dailyRemaining:result.usage.dailyRemaining});
    }catch(error){setWorkspaceAiError(error instanceof Error?error.message:"Unable to prepare a workspace with AI.");}
    finally{setWorkspaceAiBusy(false);}
  }

  async function saveNewWorkspace() {
    const name=workspaceName.trim();
    if(!name||workspaceSaving)return;
    setWorkspaceSaving(true);setWorkspaceAiError("");
    try{
      const response=await fetch("/api/workspaces",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({name})});
      const result=await response.json() as {workspace?:Workspace;error?:string};
      if(!response.ok||!result.workspace)throw new Error(result.error==="WORKSPACE_LIMIT_REACHED"?"You have reached the 30 shared workspace limit.":result.error==="INVALID_WORKSPACE_NAME"?"Workspace names must be between 1 and 60 characters.":"Unable to create workspace.");
      const created=result.workspace;
      setWorkspaces(current=>[...current,created]);setActiveWorkspaceId(created.id);setSelectedCategoryId("");setView("notes");
      let categoriesAdded=0;
      if(workspaceAiDraft?.categories.length){
        for(const [index,category] of workspaceAiDraft.categories.entries()){
          try{
            const categoryResponse=await fetch("/api/categories",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId:created.id,name:category.name,color:"#766bd0",sortOrder:index})});
            if(categoryResponse.ok||categoryResponse.status===409)categoriesAdded++;else break;
          }catch{break;}
        }
      }
      setWorkspaceModalOpen(false);setWorkspaceAiDraft(null);setWorkspacePurpose("");setWorkspaceName("");
      if(workspaceAiDraft?.categories.length&&categoriesAdded!==workspaceAiDraft.categories.length)pushToast("Workspace created. Some suggested categories could not be added.","error");
      else pushToast(workspaceAiDraft?"Workspace and AI categories created":"Workspace created");
    }catch(error){setWorkspaceAiError(error instanceof Error?error.message:"Unable to create workspace.");}
    finally{setWorkspaceSaving(false);}
  }

  useEffect(()=>{
    if(!user){setWorkspaces([]);setActiveWorkspaceId("");return;}
    let active=true;
    fetch("/api/workspaces",{credentials:"same-origin"}).then(async response=>{
      if(!response.ok)throw new Error("Unable to load workspaces.");
      const result=await response.json() as {workspaces:Workspace[]};
      if(!active)return;
      setWorkspaces(result.workspaces);
      setActiveWorkspaceId(current=>result.workspaces.some(item=>item.id===current)?current:(result.workspaces.find(item=>item.id===user.personalWorkspaceId)?.id??result.workspaces[0]?.id??""));
    }).catch(()=>{if(active)setWorkspaces([]);});
    return()=>{active=false;};
  },[user]);

  useEffect(() => {
    if (!user || !activeWorkspaceId) { setNotes([]); return; }
    let active = true;
    setNotesLoading(true);
    setNotesError("");
    fetch("/api/notes?limit=100&workspaceId=" + encodeURIComponent(activeWorkspaceId) + (showArchived ? "&archived=1" : ""), { credentials: "same-origin" })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 503 ? "Database setup is not complete yet." : "Unable to load notes.");
        const result = await response.json() as { notes: Note[] };
        if (active) setNotes(result.notes);
      })
      .catch(error => { if (active) setNotesError(error instanceof Error ? error.message : "Unable to load notes."); })
      .finally(() => { if (active) setNotesLoading(false); });
    return () => { active = false; };
  }, [user, activeWorkspaceId, showArchived]);

  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem("kitanotes-theme", theme); } catch { /* ignore */ } }, [theme]);
  useEffect(() => { setCategoryFilter(""); }, [activeWorkspaceId]);

  useEffect(() => {
    if (!user) { setUnreadCount(0); return; }
    let active = true;
    fetch("/api/notifications?limit=1",{credentials:"same-origin"})
      .then(async response=>{if(!response.ok)return;const result=await response.json() as {unreadCount:number};if(active)setUnreadCount(result.unreadCount);})
      .catch(()=>undefined);
    return ()=>{active=false;};
  },[user]);

  useEffect(() => {
    if (!activeWorkspaceId) { setCategories([]); return; }
    let active=true;
    fetch("/api/categories?workspaceId="+encodeURIComponent(activeWorkspaceId),{credentials:"same-origin"})
      .then(async response=>{if(!response.ok)throw new Error("Unable to load categories.");const result=await response.json() as {categories:Category[]};if(active)setCategories(result.categories);})
      .catch(()=>undefined);
    return ()=>{active=false;};
  },[activeWorkspaceId]);

  useEffect(() => {
    if (!user) { setAiStatus(null); return; }
    let active = true;
    fetch("/api/ai/status",{credentials:"same-origin"})
      .then(async response=>{if(!response.ok)throw new Error("AI status unavailable");const result=await response.json() as AiStatus;if(active)setAiStatus(result);})
      .catch(()=>{if(active)setAiStatus(null);});
    return ()=>{active=false;};
  },[user]);

  useEffect(() => {
    if (!inviteOpen || !activeWorkspaceId) return;
    let active = true;
    const owner = workspaces.find(item => item.id === activeWorkspaceId)?.role === "owner";
    setInvitationsLoading(true);
    const id = encodeURIComponent(activeWorkspaceId);
    Promise.all([
      fetch("/api/workspaces/" + id + "/members", { credentials: "same-origin" }),
      owner ? fetch("/api/invitations?workspaceId=" + id, { credentials: "same-origin" }) : Promise.resolve(null),
      fetch("/api/workspaces/" + id + "/activity", { credentials: "same-origin" })
    ]).then(async ([memberResponse, inviteResponse, activityResponse]) => {
      if (!memberResponse.ok) throw new Error("Unable to load workspace members.");
      const memberResult = await memberResponse.json() as { members: WorkspaceMember[] };
      if (inviteResponse && !inviteResponse.ok) throw new Error("Unable to load invitations.");
      const inviteResult = inviteResponse ? await inviteResponse.json() as { invitations: Invitation[] } : { invitations: [] };
      const activityResult = activityResponse.ok ? await activityResponse.json() as { activity: ActivityItem[] } : { activity: [] };
      if (!active) return;
      setWorkspaceMembers(memberResult.members); setInvitations(inviteResult.invitations); setActivity(activityResult.activity);
    }).catch(error => { if (active) setInviteCreateError(error instanceof Error ? error.message : "Unable to load sharing details."); })
      .finally(() => { if (active) setInvitationsLoading(false); });
    return () => { active = false; };
  }, [inviteOpen, activeWorkspaceId, inviteRefresh, workspaces]);

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
  },[view,user,calendarMode,calendarCursor,calendarRefresh]);

  useEffect(()=>{
    if(view!=="calendar"||!user||!activeWorkspaceId)return;
    let active=true;
    fetch("/api/google-calendar/status?workspaceId="+encodeURIComponent(activeWorkspaceId),{credentials:"same-origin"})
      .then(async response=>{if(!response.ok)throw new Error("Unable to check Google Calendar connection.");const result=await response.json() as GoogleCalendarStatus;if(active)setGoogleCalendarStatus(result);})
      .catch(error=>{if(active)setGoogleCalendarError(error instanceof Error?error.message:"Google Calendar status unavailable.");});
    return ()=>{active=false;};
  },[view,user,activeWorkspaceId]);

  useEffect(()=>{
    const result=new URLSearchParams(window.location.search).get("googleCalendar");
    if(!result)return;
    const messages:Record<string,string>={connected:"Google Calendar connected. You can import events now.",signin_required:"Please sign in again to connect Google Calendar.",refresh_token_missing:"Google did not return offline access. Please connect again and approve access.",workspace_error:"You no longer have permission to connect this workspace.",error:"Google Calendar connection did not complete.",state_error:"The Google Calendar connection request expired. Please try again.",token_error:"Google could not complete the calendar connection.",scope_error:"Google Calendar read permission was not granted."};
    pushToast(messages[result]??"Google Calendar connection status: "+result,result==="connected"?"ok":"error");
    window.history.replaceState({}, "", window.location.pathname+window.location.hash);
  },[pushToast]);

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
    if(!user){setNotificationPrefs({pushEnabled:true,reminderPushEnabled:true,sharedNotePushEnabled:true,quietHoursStart:null,quietHoursEnd:null,timezone:"Asia/Kuala_Lumpur"});return;}
    let active=true;setNotificationPrefsLoading(true);
    fetch("/api/notifications/preferences",{credentials:"same-origin"}).then(async response=>{
      if(!response.ok)throw new Error("Unable to load notification preferences.");
      const result=await response.json() as {preferences:NotificationPreferences};
      if(active)setNotificationPrefs(result.preferences);
    }).catch(error=>{if(active)setNotificationPrefsError(error instanceof Error?error.message:"Unable to load notification preferences.");})
      .finally(()=>{if(active)setNotificationPrefsLoading(false);});
    return()=>{active=false;};
  },[user]);

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

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (event.key === "Escape") { setComposerOpen(false); setAiModalOpen(false); setInviteOpen(false); setEventComposerOpen(false); setCategoryModalOpen(false); setNotificationsOpen(false); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setView("notes"); window.setTimeout(() => searchRef.current?.focus(), 0); return; }
      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && user && event.key === "/") { event.preventDefault(); setView("notes"); window.setTimeout(() => searchRef.current?.focus(), 0); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [user]);

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

  async function saveNotificationPreferences(){
    if(notificationPrefsSaving)return;
    setNotificationPrefsSaving(true);setNotificationPrefsError("");setNotificationPrefsSaved(false);
    try{
      const response=await fetch("/api/notifications/preferences",{method:"PUT",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(notificationPrefs)});
      const result=await response.json() as {preferences?:NotificationPreferences;error?:string};
      if(!response.ok||!result.preferences)throw new Error(result.error==="INVALID_NOTIFICATION_PREFERENCES"?"Check the quiet-hours times and timezone.":"Unable to save notification preferences.");
      setNotificationPrefs(result.preferences);setNotificationPrefsSaved(true);
    }catch(error){setNotificationPrefsError(error instanceof Error?error.message:"Unable to save notification preferences.");}
    finally{setNotificationPrefsSaving(false);}
  }

  const visibleNotes = useMemo(() => {
    const value = query.trim().toLowerCase();
    const filtered = notes.filter(note => (!categoryFilter || (categoryFilter === "__none" ? !note.categoryId : note.categoryId === categoryFilter))
      && (!value || (note.title + " " + note.content + " " + (note.categoryName ?? "")).toLowerCase().includes(value)));
    return [...filtered].sort((a, b) => sortMode === "title" ? a.title.localeCompare(b.title) : sortMode === "oldest" ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt));
  }, [notes, query, categoryFilter, sortMode]);
  const sharedWorkspaces = useMemo(() => workspaces.filter(item => item.visibility === "shared"), [workspaces]);
  const activeWorkspace = workspaces.find(item => item.id === activeWorkspaceId);
  const canWrite = activeWorkspace ? activeWorkspace.role !== "viewer" : true;

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
          : { title: draftTitle, content: draftContent, categoryId: selectedCategoryId || null, workspaceId: activeWorkspaceId })
      });
      const result = await response.json() as { note?: Note; error?: string };
      if (!response.ok || !result.note) throw new Error(result.error === "VERSION_CONFLICT" ? "This note changed elsewhere. Refresh and try again." : "Unable to save this note.");
      setNotes(current => editingNote
        ? current.map(note => note.id === result.note!.id ? result.note! : note)
        : [result.note!, ...current]);
      setComposerOpen(false);
      setEditingNote(null);
      pushToast(editingNote ? "Note updated" : "Note saved");
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : "Unable to save this note.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveNote(note: Note, archived = true) {
    try {
      const response = await fetch("/api/notes/" + encodeURIComponent(note.id), {
        method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: note.version, archived })
      });
      if (!response.ok) throw new Error(archived ? "Unable to archive this note." : "Unable to restore this note.");
      setNotes(current => current.filter(item => item.id !== note.id));
      pushToast(archived ? "Note archived" : "Note restored");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Unable to update this note.", "error");
    }
  }

  async function deleteNote(note: Note) {
    if (!window.confirm("Delete \u201c" + note.title + "\u201d? This cannot be undone from the app.")) return;
    try {
      const response = await fetch("/api/notes/" + encodeURIComponent(note.id), {
        method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: note.version })
      });
      if (!response.ok) throw new Error("Unable to delete this note.");
      setNotes(current => current.filter(item => item.id !== note.id));
      pushToast("Note deleted");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Unable to delete this note.", "error");
    }
  }

  async function createCategory() {
    if(!activeWorkspaceId||!categoryName.trim()||categorySaving)return;
    setCategorySaving(true);setCategoryError("");
    try{
      const response=await fetch("/api/categories",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
        workspaceId:activeWorkspaceId,name:categoryName,color:"#766bd0",sortOrder:categories.length
      })});
      const result=await response.json() as {category?:Category;error?:string};
      if(!response.ok||!result.category)throw new Error(result.error==="CATEGORY_ALREADY_EXISTS"?"A category with that name already exists.":"Unable to create category.");
      setCategories(current=>[...current,result.category!].sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name)));
      setCategoryName("");
    }catch(error){setCategoryError(error instanceof Error?error.message:"Unable to create category.");}
    finally{setCategorySaving(false);}
  }

  async function prepareImageForOcr(file:File):Promise<File> {
    if(!("createImageBitmap" in window))return file;
    const bitmap=await createImageBitmap(file);
    try{
      const scale=Math.min(1,2200/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const context=canvas.getContext("2d");if(!context)return file;
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",0.88));
      if(!blob)return file;
      return new File([blob],file.name.replace(/\.[^.]+$/,"")+".jpg",{type:"image/jpeg",lastModified:Date.now()});
    }finally{bitmap.close();}
  }

  async function scanImageWithAi() {
    if(!ocrFile||ocrWorking)return;
    setOcrWorking(true);setAiError("");setOcrText("");
    try{
      const prepared=await prepareImageForOcr(ocrFile);
      if(prepared.size>2*1024*1024)throw new Error("This image is still larger than 2 MB after preparation. Please choose a smaller image.");
      const response=await fetch("/api/ai/ocr",{method:"POST",credentials:"same-origin",headers:{"content-type":prepared.type},body:prepared});
      const result=await response.json() as {text?:string;error?:string};
      if(!response.ok||typeof result.text!=="string"){
        const message=result.error==="OCR_FREE_QUOTA_EXHAUSTED"||result.error==="OCR_DAILY_FREE_LIMIT_REACHED"?"The free OCR limit is reached. Try again after the quota resets."
          :result.error==="AI_NOT_CONFIGURED"?"AI is not configured yet."
          :result.error==="UNSUPPORTED_IMAGE_TYPE"||result.error==="IMAGE_SIGNATURE_MISMATCH"?"Use a genuine JPEG, PNG or WebP image."
          :"Image processing is temporarily unavailable. Your image has not been saved.";
        throw new Error(message);
      }
      setOcrText(result.text);
    }catch(error){setAiError(error instanceof Error?error.message:"Unable to read this image.");}
    finally{setOcrWorking(false);}
  }

  async function organizeWithAi(textOverride?:string) {
    const sourceText=(textOverride??aiInput).trim();
    if(!sourceText||aiWorking||!aiStatus?.configured)return;
    setAiWorking(true);setAiError("");setAiDraft(null);setAiNoteSaved(false);setAiItemsCreated(false);setAiCreatedItems([]);
    try{
      const response=await fetch("/api/ai/organize",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
        text:sourceText,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"Asia/Kuala_Lumpur",workspaceId:activeWorkspaceId
      })});
      const result=await response.json() as {draft?:AiDraft;usage?:{dailyLimit:number;dailyUsed:number;dailyRemaining:number};error?:string};
      if(!response.ok||!result.draft){
        const message=result.error==="AI_FREE_QUOTA_EXHAUSTED"||result.error==="AI_DAILY_FREE_LIMIT_REACHED"?"The free AI limit is reached. Try again after the quota resets."
          :result.error==="AI_NOT_CONFIGURED"?"AI is not configured yet."
          :result.error==="AI_INVALID_MODEL_RESPONSE"?"The AI service returned an invalid draft. Please retry with clearer text."
          :"AI is temporarily unavailable. Your original text has not been changed.";
        throw new Error(message);
      }
      setAiDraft(result.draft);setAiDraftTitle(result.draft.note.title);setAiDraftContent(result.draft.note.content);
      const recommendation=result.draft.categorySuggestion;
      const existingCategory=recommendation?categories.find(category=>category.name.toLowerCase()===recommendation.name.toLowerCase()):undefined;
      setSelectedCategoryId(existingCategory?.id??(recommendation?.createNew?"__ai_new_category__":""));
      if(result.usage&&aiStatus)setAiStatus({...aiStatus,dailyUsed:result.usage.dailyUsed,dailyRemaining:result.usage.dailyRemaining});
    }catch(error){setAiError(error instanceof Error?error.message:"Unable to organise this text.");}
    finally{setAiWorking(false);}
  }

  async function saveAiNote() {
    if(!aiDraft||!activeWorkspaceId||aiSavingNote)return;
    setAiSavingNote(true);setAiError("");
    try{
      let categoryId=selectedCategoryId||null;
      if(!aiNoteSaved&&categoryId==="__ai_new_category__"&&aiDraft.categorySuggestion){
        const categoryResponse=await fetch("/api/categories",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId:activeWorkspaceId,name:aiDraft.categorySuggestion.name,color:"#766bd0",sortOrder:categories.length})});
        const categoryResult=await categoryResponse.json() as {category?:Category};
        if(categoryResponse.status===409){
          const refresh=await fetch("/api/categories?workspaceId="+encodeURIComponent(activeWorkspaceId),{credentials:"same-origin"});
          const list=await refresh.json() as {categories:Category[]};
          const existing=list.categories.find(item=>item.name.toLowerCase()===aiDraft.categorySuggestion!.name.toLowerCase());
          if(!existing)throw new Error("The suggested category already exists but could not be loaded.");
          categoryId=existing.id;setCategories(list.categories);
        }else if(!categoryResponse.ok||!categoryResult.category)throw new Error("Unable to create the suggested category.");
        else{categoryId=categoryResult.category.id;setCategories(current=>[...current,categoryResult.category!]);}
        setSelectedCategoryId(categoryId??"");
      }
      if(!aiNoteSaved){
        const response=await fetch("/api/notes",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
          workspaceId:activeWorkspaceId,title:aiDraftTitle,content:aiDraftContent,categoryId
        })});
        const result=await response.json() as {note?:Note};
        if(!response.ok||!result.note)throw new Error("Unable to save the note.");
        setNotes(current=>[result.note!,...current]);setAiNoteSaved(true);
      }
      const hasCalendarItems=Boolean(aiDraft.events.length||aiDraft.reminders.length||aiDraft.tasks.some(task=>task.dueLocal));
      if(hasCalendarItems&&!aiItemsCreated){
        const itemsSaved=await createAiItems();
        if(!itemsSaved)return;
      }
      setAiModalOpen(false);setAiDraft(null);setAiInput("");setOcrFile(null);setOcrText("");
      pushToast(hasCalendarItems?"Note and calendar items saved":"Note saved");
    }catch(error){setAiError(error instanceof Error?error.message:"Unable to save this note.");}
    finally{setAiSavingNote(false);}
  }

  async function createAiItems():Promise<boolean> {
    if(!aiDraft||!activeWorkspaceId)return false;
    if(aiItemsCreated)return true;
    if(aiCreatingItems)return false;
    setAiCreatingItems(true);setAiError("");
    const completed=new Set(aiCreatedItems);
    try{
      for(let index=0;index<aiDraft.events.length;index++){
        const event=aiDraft.events[index];
        const eventKey="event:"+index;
        let eventId:string|undefined;
        if(!completed.has(eventKey)){
          const response=await fetch("/api/events",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
            workspaceId:activeWorkspaceId,title:event.title,description:event.description,
            startsAt:zonedDateTimeToIso(event.startLocal,event.timezone),endsAt:zonedDateTimeToIso(event.endLocal,event.timezone),timezone:event.timezone
          })});
          const result=await response.json() as {event?:CalendarEvent};
          if(!response.ok||!result.event)throw new Error("Unable to create event: "+event.title);
          eventId=result.event.id;completed.add(eventKey);setEvents(current=>[...current,result.event!].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)));setAiCreatedItems([...completed]);
        }else{
          eventId=events.find(item=>item.title===event.title&&item.startsAt===zonedDateTimeToIso(event.startLocal,event.timezone))?.id;
        }
        if(event.reminderLocal&&!completed.has("event-reminder:"+index)&&eventId){
          const reminderResponse=await fetch("/api/reminders",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
            workspaceId:activeWorkspaceId,eventId,title:event.title,dueAt:zonedDateTimeToIso(event.reminderLocal,event.timezone),timezone:event.timezone
          })});
          if(!reminderResponse.ok)throw new Error("Event created, but its reminder could not be saved.");
          completed.add("event-reminder:"+index);setAiCreatedItems([...completed]);
        }
      }
      const standalone=[...aiDraft.reminders.map(item=>({title:item.title,dueLocal:item.dueLocal,timezone:item.timezone,key:"reminder:"+item.title+":"+item.dueLocal})),...aiDraft.tasks.filter(item=>item.dueLocal).map(item=>({title:item.title,dueLocal:item.dueLocal!,timezone:aiDraft.timezone,key:"task:"+item.title+":"+item.dueLocal}))];
      for(const reminder of standalone){
        if(completed.has(reminder.key))continue;
        const response=await fetch("/api/reminders",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
          workspaceId:activeWorkspaceId,title:reminder.title,dueAt:zonedDateTimeToIso(reminder.dueLocal,reminder.timezone),timezone:reminder.timezone
        })});
        if(!response.ok)throw new Error("Unable to create reminder: "+reminder.title);
        completed.add(reminder.key);setAiCreatedItems([...completed]);
      }
      setAiItemsCreated(true);setCalendarRefresh(value=>value+1);return true;
    }catch(error){setAiError(error instanceof Error?error.message:"Unable to create suggested events or reminders.");return false;}
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
    if(!activeWorkspaceId||!eventTitle.trim()||eventSaving)return;
    setEventSaving(true);setEventsError("");
    try {
      const payload={title:eventTitle,description:eventDescription,startsAt:zonedDateTimeToIso(eventStart,eventTimezone),endsAt:zonedDateTimeToIso(eventEnd,eventTimezone),timezone:eventTimezone,linkedNoteId:eventLinkedNoteId||null};
      const response=await fetch(editingEvent?"/api/events/"+encodeURIComponent(editingEvent.id):"/api/events",{method:editingEvent?"PATCH":"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(editingEvent?{...payload,version:editingEvent.version}:{...payload,workspaceId:activeWorkspaceId})});
      const result=await response.json() as {event?:CalendarEvent};
      if(!response.ok||!result.event)throw new Error(response.status===409?"This event changed elsewhere. Close and reopen it before saving.":"Unable to save this event.");
      setEvents(current=>editingEvent?current.map(item=>item.id===result.event!.id?result.event!:item).sort((a,b)=>a.startsAt.localeCompare(b.startsAt)):[...current,result.event!].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)));
      if(eventReminderAt&&!editingEvent){
        const reminderResponse=await fetch("/api/reminders",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
          workspaceId:activeWorkspaceId,eventId:result.event.id,title:eventTitle,dueAt:new Date(eventReminderAt).toISOString(),timezone:eventTimezone
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

  function connectGoogleCalendar(){
    if(!activeWorkspaceId)return;
    if(activeWorkspace?.visibility==="shared"&&!window.confirm("Google Calendar events will be imported into this shared workspace and visible to all its members. Continue?"))return;
    window.location.href="/auth/google/calendar/connect?workspaceId="+encodeURIComponent(activeWorkspaceId);
  }
  async function syncGoogleCalendar(){
    if(!activeWorkspaceId||googleCalendarBusy)return;
    setGoogleCalendarBusy(true);setGoogleCalendarError("");
    try{
      const response=await fetch("/api/google-calendar/sync",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId:activeWorkspaceId})});
      const result=await response.json() as {error?:string;imported?:number;updated?:number;deleted?:number;skipped?:number;lastSyncAt?:string};
      if(!response.ok)throw new Error(result.error==="GOOGLE_TOKEN_REFRESH_FAILED"?"Google Calendar access expired. Reconnect to continue.":result.error==="GOOGLE_CALENDAR_NOT_CONNECTED"?"Connect Google Calendar first.":"Google Calendar sync failed. Please try again.");
      setGoogleCalendarStatus({connected:true,lastSyncAt:result.lastSyncAt??null,direction:"google_to_kitanotes",readOnly:true});
      setCalendarRefresh(value=>value+1);
      pushToast("Imported "+(result.imported??0)+", updated "+(result.updated??0)+", removed "+(result.deleted??0)+" Google Calendar events.");
    }catch(error){setGoogleCalendarError(error instanceof Error?error.message:"Google Calendar sync failed.");}
    finally{setGoogleCalendarBusy(false);}
  }
  async function disconnectGoogleCalendar(){
    if(!activeWorkspaceId||googleCalendarBusy||!window.confirm("Disconnect Google Calendar from this workspace? Imported events will stay in KitaNotes."))return;
    setGoogleCalendarBusy(true);setGoogleCalendarError("");
    try{
      const response=await fetch("/api/google-calendar/disconnect",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId:activeWorkspaceId})});
      if(!response.ok)throw new Error("Unable to disconnect Google Calendar.");
      setGoogleCalendarStatus({connected:false,lastSyncAt:null,direction:"google_to_kitanotes",readOnly:true});
      pushToast("Google Calendar disconnected. Imported events remain in KitaNotes.");
    }catch(error){setGoogleCalendarError(error instanceof Error?error.message:"Unable to disconnect Google Calendar.");}
    finally{setGoogleCalendarBusy(false);}
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
    if(notification.resourceType==="workspace"&&notification.resourceId&&workspaces.some(item=>item.id===notification.resourceId)){setActiveWorkspaceId(notification.resourceId);setShowArchived(false);setView("notes");void markNotificationRead(notification);setNotificationsOpen(false);return;}
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
      const result = await response.json() as { accepted?: boolean; workspaceId?: string; role?: "editor" | "viewer"; error?: string };
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
      const workspaceResponse = await fetch("/api/workspaces", { credentials: "same-origin" });
      if (workspaceResponse.ok) {
        const workspaceResult = await workspaceResponse.json() as { workspaces: Workspace[] };
        setWorkspaces(workspaceResult.workspaces);
        if (result.workspaceId && workspaceResult.workspaces.some(item => item.id === result.workspaceId)) setActiveWorkspaceId(result.workspaceId);
      }
    } catch (error) {
      setInviteStatus("error");
      setInviteError(error instanceof Error ? error.message : "Unable to accept invitation.");
    }
  }

  async function createInvite() {
    if (!activeWorkspaceId || inviteSending) return;
    setInviteSending(true);
    setInviteCreateError("");
    setCreatedInvite(null);
    try {
      const response = await fetch("/api/invitations", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: activeWorkspaceId, openLink:true, role: inviteRole })
      });
      const result = await response.json() as { invitationUrl?: string; gmailComposeUrl?: string|null; error?: string };
      if (!response.ok || !result.invitationUrl) {
        const message = result.error === "ALREADY_A_MEMBER" ? "This person is already a workspace member."
          : result.error === "INVITATION_ALREADY_PENDING" ? "There is already a pending invitation for this email."
          : "Unable to create this invitation.";
        throw new Error(message);
      }
      setCreatedInvite({ invitationUrl: result.invitationUrl, gmailComposeUrl: result.gmailComposeUrl??null });
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

  async function updateWorkspaceMemberRole(member:WorkspaceMember,role:"editor"|"viewer") {
    if(!activeWorkspaceId||workspaceActionBusy||member.role==="owner"||member.role===role)return;
    setWorkspaceActionBusy(true);setInviteCreateError("");
    try{
      const response=await fetch("/api/workspaces/"+encodeURIComponent(activeWorkspaceId)+"/members/"+encodeURIComponent(member.userId),{method:"PATCH",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({role})});
      if(!response.ok)throw new Error("Unable to update member permission.");
      setInviteRefresh(value=>value+1);
    }catch(error){setInviteCreateError(error instanceof Error?error.message:"Unable to update member permission.");}
    finally{setWorkspaceActionBusy(false);}
  }

  async function removeWorkspaceMember(member:WorkspaceMember) {
    if(!activeWorkspaceId||workspaceActionBusy||member.role==="owner")return;
    if(!window.confirm("Remove "+member.email+" from this workspace? They will immediately lose access, but their own personal workspaces will remain untouched."))return;
    setWorkspaceActionBusy(true);setInviteCreateError("");
    try{
      const response=await fetch("/api/workspaces/"+encodeURIComponent(activeWorkspaceId)+"/members/"+encodeURIComponent(member.userId),{method:"DELETE",credentials:"same-origin"});
      const result=await response.json() as {error?:string};
      if(!response.ok)throw new Error(result.error==="MEMBER_NOT_FOUND"?"This member is no longer in the workspace.":"Unable to remove member.");
      setInviteRefresh(value=>value+1);
    }catch(error){setInviteCreateError(error instanceof Error?error.message:"Unable to remove member.");}
    finally{setWorkspaceActionBusy(false);}
  }

  async function makeWorkspaceShared() {
    if(!activeWorkspaceId||workspaceActionBusy)return;
    if(!window.confirm("Allow invited members to access this workspace again? Existing members will not be restored automatically."))return;
    setWorkspaceActionBusy(true);setInviteCreateError("");
    try{
      const response=await fetch("/api/workspaces/"+encodeURIComponent(activeWorkspaceId),{method:"PATCH",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({action:"make_shared"})});
      if(!response.ok)throw new Error("Unable to make workspace shared.");
      await refreshWorkspaces(activeWorkspaceId);
      setInviteNotice("This workspace can now be shared. Invite members to grant access.");
    }catch(error){setInviteCreateError(error instanceof Error?error.message:"Unable to make workspace shared.");}
    finally{setWorkspaceActionBusy(false);}
  }

  async function makeWorkspacePrivate() {
    if(!activeWorkspaceId||workspaceActionBusy)return;
    if(!window.confirm("Remove all other members? They will immediately lose access. Pending invitations will be revoked. Notes and categories will be kept."))return;
    setWorkspaceActionBusy(true);setInviteCreateError("");
    try{
      const response=await fetch("/api/workspaces/"+encodeURIComponent(activeWorkspaceId),{method:"PATCH",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({action:"make_private"})});
      if(!response.ok)throw new Error("Unable to make workspace private.");
            setWorkspaceMembers(current=>current.filter(member=>member.role==="owner"));
      setInvitations(current=>current.map(item=>item.status==="pending"?{...item,status:"revoked"}:item));
      await refreshWorkspaces(activeWorkspaceId);
      setInviteOpen(false);
      setInviteNotice("This space is now private. Other members lost access, pending invitations were revoked, and notes were kept.");
    }catch(error){setInviteCreateError(error instanceof Error?error.message:"Unable to make workspace private.");}
    finally{setWorkspaceActionBusy(false);}
  }

  async function refreshWorkspaces(preferId?: string) {
    const response = await fetch("/api/workspaces", { credentials: "same-origin" });
    if (!response.ok) return;
    const result = await response.json() as { workspaces: Workspace[] };
    setWorkspaces(result.workspaces);
    setActiveWorkspaceId(current => preferId && result.workspaces.some(item => item.id === preferId) ? preferId : (result.workspaces.some(item => item.id === current) ? current : (result.workspaces.find(item => item.id === user?.personalWorkspaceId)?.id ?? result.workspaces[0]?.id ?? "")));
  }

  function openManage(tab: ManageTab = "people") {
    setManageTab(tab); setInviteCreateError(""); setCopiedInvite(false); setCreatedInvite(null); setInviteOpen(true);
  }

  async function transferOwnership(member: WorkspaceMember) {
    if (!activeWorkspace || workspaceActionBusy || member.role === "owner") return;
    if (!window.confirm("Make " + (member.displayName || member.email) + " the owner of \u201c" + activeWorkspace.name + "\u201d? You will become an editor and lose owner controls.")) return;
    setWorkspaceActionBusy(true);
    try {
      const response = await fetch("/api/workspaces/" + encodeURIComponent(activeWorkspace.id), { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "transfer_ownership", userId: member.userId }) });
      if (!response.ok) throw new Error("Unable to transfer ownership.");
      await refreshWorkspaces(activeWorkspace.id);
      setInviteOpen(false);
      pushToast("Ownership transferred");
    } catch (error) { pushToast(error instanceof Error ? error.message : "Unable to transfer ownership.", "error"); }
    finally { setWorkspaceActionBusy(false); }
  }

  async function regenerateInvite(invitation: Invitation) {
    if (!activeWorkspaceId || inviteSending) return;
    setInviteSending(true); setInviteCreateError(""); setCreatedInvite(null);
    try {
      if (invitation.status === "pending") {
        const revoked = await fetch("/api/invitations/" + encodeURIComponent(invitation.id), { method: "DELETE", credentials: "same-origin" });
        if (!revoked.ok) throw new Error("Unable to replace this invitation.");
      }
      const response = await fetch("/api/invitations", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: activeWorkspaceId, openLink:true, role: invitation.role }) });
      const result = await response.json() as { invitationUrl?: string; gmailComposeUrl?: string|null };
      if (!response.ok || !result.invitationUrl) throw new Error("Unable to create a new invitation link.");
      setCreatedInvite({ invitationUrl: result.invitationUrl, gmailComposeUrl: result.gmailComposeUrl??null });
      setManageTab("invite"); setInviteRefresh(value => value + 1);
    } catch (error) { setInviteCreateError(error instanceof Error ? error.message : "Unable to create a new invitation link."); }
    finally { setInviteSending(false); }
  }

  function describeActivity(item: ActivityItem): string {
    const role = typeof item.metadata.role === "string" ? item.metadata.role : "";
    switch (item.type) {
      case "invitation.created": return item.actor + " invited " + (item.target ?? "someone") + (role ? " as " + role : "");
      case "invitation.revoked": return item.actor + " revoked an invitation";
      case "member.joined": return item.actor + " joined" + (role ? " as " + role : "");
      case "member.left": return item.actor + " left the space";
      case "member.removed": return item.actor + " removed " + (item.target ?? "a member");
      case "member.role_changed": return item.actor + " changed " + (item.target ?? "a member") + " to " + String(item.metadata.to ?? "a new role");
      case "workspace.members_cleared": return item.actor + " removed all other members";
      case "workspace.ownership_transferred": return item.actor + " made " + (item.target ?? "a member") + " the owner";
      default: return item.actor + " · " + item.type;
    }
  }

  async function renameWorkspace() {
    if (!activeWorkspace || workspaceActionBusy) return;
    const name = window.prompt("Rename this space", activeWorkspace.name)?.trim();
    if (!name || name === activeWorkspace.name) return;
    setWorkspaceActionBusy(true);
    try {
      const response = await fetch("/api/workspaces/" + encodeURIComponent(activeWorkspace.id), { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      if (!response.ok) throw new Error("Unable to rename this space.");
      setWorkspaces(current => current.map(item => item.id === activeWorkspace.id ? { ...item, name } : item));
      pushToast("Space renamed");
    } catch (error) { pushToast(error instanceof Error ? error.message : "Unable to rename this space.", "error"); }
    finally { setWorkspaceActionBusy(false); }
  }

  async function leaveWorkspace() {
    if (!activeWorkspace || !user || workspaceActionBusy || activeWorkspace.role === "owner") return;
    if (!window.confirm("Leave \u201c" + activeWorkspace.name + "\u201d? You will lose access until the owner invites you again.")) return;
    setWorkspaceActionBusy(true);
    try {
      const response = await fetch("/api/workspaces/" + encodeURIComponent(activeWorkspace.id) + "/members/" + encodeURIComponent(user.id), { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error("Unable to leave this space.");
      setActiveWorkspaceId(user.personalWorkspaceId ?? "");
      await refreshWorkspaces(user.personalWorkspaceId ?? undefined);
      pushToast("You left the space");
    } catch (error) { pushToast(error instanceof Error ? error.message : "Unable to leave this space.", "error"); }
    finally { setWorkspaceActionBusy(false); }
  }

  async function deleteWorkspace() {
    if (!activeWorkspace || !user || workspaceActionBusy || activeWorkspace.role !== "owner" || activeWorkspace.type !== "shared") return;
    if (!window.confirm("Permanently delete \u201c" + activeWorkspace.name + "\u201d with all its notes, categories, events and members? This cannot be undone.")) return;
    setWorkspaceActionBusy(true);
    try {
      const response = await fetch("/api/workspaces/" + encodeURIComponent(activeWorkspace.id), { method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("Unable to delete this space.");
      setInviteOpen(false);
      await refreshWorkspaces(user.personalWorkspaceId ?? undefined);
      pushToast("Space deleted");
    } catch (error) { pushToast(error instanceof Error ? error.message : "Unable to delete this space.", "error"); }
    finally { setWorkspaceActionBusy(false); }
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
          <img className="brand-logo" src="/icons/mark-96.png" alt="" width="34" height="34" />
          <span className="brand-text"><span>Kita<span className="brand-soft">Notes</span></span><small className="brand-by">by Binalah.com</small></span>
        </a>
        <label className="workspace-switch" aria-label="Choose workspace">
          <span className="workspace-avatar">K</span>
          <span className="workspace-copy"><strong>{workspaces.find(item=>item.id===activeWorkspaceId)?.name??"My workspace"}</strong><small>{workspaces.find(item=>item.id===activeWorkspaceId)?.visibility==="shared"?"Shared space":"Private workspace"}</small></span>
          <select aria-label="Switch workspace" value={activeWorkspaceId} onChange={event=>{setActiveWorkspaceId(event.target.value);setSelectedCategoryId("");setComposerOpen(false);setEditingNote(null);}}>
            {workspaces.map(workspace=><option key={workspace.id} value={workspace.id}>{workspace.name}{workspace.visibility==="shared"?" · Shared":" · Private"}</option>)}
          </select>
          <ChevronDown size={16} />
        </label>
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
          <label className="mobile-workspace-switch"><span>Workspace</span><select aria-label="Switch workspace" value={activeWorkspaceId} onChange={event=>{setActiveWorkspaceId(event.target.value);setSelectedCategoryId("");setComposerOpen(false);setEditingNote(null);}}>{workspaces.map(workspace=><option key={workspace.id} value={workspace.id}>{workspace.name}{workspace.visibility==="shared"?" · Shared":" · Private"}</option>)}</select></label>
          <div className="breadcrumb">{workspaces.find(item=>item.id===activeWorkspaceId)?.name??"My workspace"} <span>/</span> {view === "notes" ? "Notes" : view === "calendar" ? "Calendar" : "Shared with me"}</div>
          <div className="top-actions">
            {user&&<button className="topbar-action" onClick={createPersonalWorkspace} disabled={workspaceModalOpen}><Plus size={14}/> New space</button>}
            <button className="icon-button" onClick={()=>setTheme(value=>value==="dark"?"light":"dark")} aria-label="Toggle dark mode" title="Toggle dark mode">{theme==="dark"?<Sun size={18}/>:<Moon size={18}/>}</button>{!isInstalled&&<button className="install-app-button" onClick={installApp}>Install app</button>}
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
            {user&&<div className="notification-settings">
              <div className="notification-settings-heading"><strong>Delivery preferences</strong><span>In-app notifications are always kept in your inbox.</span></div>
              {notificationPrefsLoading?<p>Loading preferences…</p>:<>
                <label><input type="checkbox" checked={notificationPrefs.pushEnabled} onChange={event=>{setNotificationPrefs(value=>({...value,pushEnabled:event.target.checked}));setNotificationPrefsSaved(false);}}/> Enable push delivery</label>
                <label><input type="checkbox" checked={notificationPrefs.reminderPushEnabled} onChange={event=>{setNotificationPrefs(value=>({...value,reminderPushEnabled:event.target.checked}));setNotificationPrefsSaved(false);}} disabled={!notificationPrefs.pushEnabled}/> Event and reminder alerts</label>
                <label><input type="checkbox" checked={notificationPrefs.sharedNotePushEnabled} onChange={event=>{setNotificationPrefs(value=>({...value,sharedNotePushEnabled:event.target.checked}));setNotificationPrefsSaved(false);}} disabled={!notificationPrefs.pushEnabled}/> New shared-note alerts</label>
                <div className="quiet-hours-fields"><label>Quiet hours start<input type="time" value={notificationPrefs.quietHoursStart??""} onChange={event=>{setNotificationPrefs(value=>({...value,quietHoursStart:event.target.value||null}));setNotificationPrefsSaved(false);}}/></label><label>Quiet hours end<input type="time" value={notificationPrefs.quietHoursEnd??""} onChange={event=>{setNotificationPrefs(value=>({...value,quietHoursEnd:event.target.value||null}));setNotificationPrefsSaved(false);}}/></label></div>
                <label className="timezone-setting">Timezone<input value={notificationPrefs.timezone} maxLength={64} onChange={event=>{setNotificationPrefs(value=>({...value,timezone:event.target.value}));setNotificationPrefsSaved(false);}} placeholder="Asia/Kuala_Lumpur"/></label>
                <button className="text-action" onClick={()=>{setNotificationPrefs(value=>({...value,quietHoursStart:null,quietHoursEnd:null}));setNotificationPrefsSaved(false);}}>Clear quiet hours</button>
                <div className="notification-settings-footer"><span>{notificationPrefsSaved?"Preferences saved.":"Quiet hours pause push only. Your inbox is unaffected."}</span><button className="secondary-button" onClick={saveNotificationPreferences} disabled={notificationPrefsSaving}>{notificationPrefsSaving?"Saving…":"Save preferences"}</button></div>
              </>}
              {notificationPrefsError&&<p className="invite-error">{notificationPrefsError}</p>}
            </div>}
            {notificationsLoading?<p>Loading…</p>:notifications.length===0?<p>You're all caught up.</p>:notifications.map(notification=><button className={notification.readAt?"notification-item":"notification-item unread"} key={notification.id} onClick={()=>openNotification(notification)}><strong>{notification.title}</strong><span>{notification.body}</span><small>{new Date(notification.createdAt).toLocaleString()}</small></button>)}
          </section>}
          {inviteToken && <section className="invite-panel">
            <div><span className="eyebrow">WORKSPACE INVITATION</span><h2>You've been invited.</h2>
              <p>Anyone with this invitation link can join after signing in with Google.</p></div>
            {user ? <button className="primary-button" onClick={acceptInvite} disabled={inviteStatus === "accepting"}>{inviteStatus === "accepting" ? "Accepting…" : "Accept invitation"}</button>
              : authStatus === "signed_out" ? <a className="primary-button" href={"/auth/google?returnTo=" + encodeURIComponent("/invite/accept?token=" + inviteToken)}><LogIn size={16}/> Sign in to accept</a>
              : <span className="setup-label">{authStatus === "loading" ? "Checking sign-in…" : "Sign-in setup pending"}</span>}
            {inviteError && <p className="invite-error">{inviteError}</p>}
            {inviteError.includes("different Google email") && user && <button className="text-action" onClick={signOut}>Sign out</button>}
          </section>}
          {inviteNotice && <div className="invite-success-banner"><Check size={16}/>{inviteNotice}</div>}

          <div className="page-heading">
            <div><div className="eyebrow">YOUR SECOND BRAIN, TOGETHER</div><h1>{view === "notes" ? "Your notes" : view === "calendar" ? "Your calendar" : "Shared with me"}</h1><p>{view === "notes" ? "A calm place for everything worth remembering." : view === "calendar" ? "Keep the important dates close." : "Notes and spaces people have shared with you."}</p></div>
            {view === "calendar" && user && <button className="primary-button" onClick={startNewEvent}><Plus size={17}/> New event</button>}{view === "notes" && user && <div className="page-actions">{workspaces.find(item=>item.id===activeWorkspaceId)?.role==="owner" && <button className="secondary-button" onClick={()=>openManage("people")}><Users size={16} /> Manage space</button>}{activeWorkspace?.visibility==="shared"&&activeWorkspace.role!=="owner"&&<button className="secondary-button" onClick={()=>openManage("people")}><Users size={16} /> Members</button>}<button className="secondary-button" onClick={()=>setCategoryModalOpen(true)}>Categories</button><button className="secondary-button" onClick={()=>{setAiModalOpen(true);setAiError("");}}><Sparkles size={16}/> Organize with AI</button>{canWrite&&<button className="primary-button" onClick={startNewNote}><Plus size={17} /> New note</button>}</div>}
          </div>

          {view === "notes" && <>
            <div className="toolbar">
              <label className="search-box"><Search size={17} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search notes  ( / )" />{query&&<button className="mini-icon" onClick={()=>setQuery("")} aria-label="Clear search"><X size={14}/></button>}</label>
              <label className="filter-button"><select className="sort-select" aria-label="Sort notes" value={sortMode} onChange={event=>setSortMode(event.target.value as SortMode)}><option value="updated">Recently updated</option><option value="oldest">Oldest first</option><option value="title">Title A–Z</option></select></label>
              <button className={showArchived?"filter-button active-filter":"filter-button"} onClick={()=>setShowArchived(value=>!value)}><Archive size={14}/> {showArchived?"Archived":"Archive"}</button>
            </div>
            {user&&(categories.length>0)&&<div className="chip-row" role="tablist" aria-label="Filter by category"><button className={!categoryFilter?"chip active":"chip"} onClick={()=>setCategoryFilter("")}>All</button>{categories.map(category=><button key={category.id} className={categoryFilter===category.id?"chip active":"chip"} onClick={()=>setCategoryFilter(category.id)}><span className="category-dot" style={{background:category.color||"#8c88a7"}}/>{category.name}</button>)}<button className={categoryFilter==="__none"?"chip active":"chip"} onClick={()=>setCategoryFilter("__none")}><Tag size={11}/> Uncategorised</button>
            </div>}
            <div className="notes-meta">{notesLoading?"":visibleNotes.length+" "+(visibleNotes.length===1?"note":"notes")+(showArchived?" in archive":"")}
            </div>
            {notesError && <div className="inline-error">{notesError}</div>}
            {notesLoading ? <div className="loading-state">Loading your notes…</div> : visibleNotes.length > 0 ? <div className="notes-grid">
              {visibleNotes.map(note => <article className="note-card" key={note.id}>
                <div className="note-card-top">{note.categoryName && <span className="note-category">{note.categoryName}</span>}<span className="note-date">{new Date(note.updatedAt).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</span></div>
                <h3>{note.title}</h3><p>{note.content || "No additional details."}</p><small className="record-audit">Created by {note.createdByName||note.createdByEmail||"Unknown"} · {new Date(note.createdAt).toLocaleString()}<br/>Last updated by {note.updatedByName||note.updatedByEmail||note.createdByName||note.createdByEmail||"Unknown"} · {new Date(note.updatedAt).toLocaleString()}</small>
                <div className="note-card-actions">{canWrite&&!showArchived&&<button onClick={() => startEditNote(note)}><Pencil size={14} /> Edit</button>}{canWrite&&!showArchived&&<button onClick={() => archiveNote(note)}><Archive size={14} /> Archive</button>}{canWrite&&showArchived&&<button onClick={() => archiveNote(note,false)}><RotateCcw size={14} /> Restore</button>}{canWrite&&showArchived&&<button className="danger-action" onClick={() => deleteNote(note)}><Trash2 size={14} /> Delete</button>}{!canWrite&&<span className="note-date">View only</span>}</div>
              </article>)}
            </div> : <div className="empty-state">
              <div className="empty-illustration"><div className="paper paper-back"></div><div className="paper paper-front"><span></span><span></span><span></span><i><Check size={17} /></i></div><div className="sparkle sparkle-one">✦</div><div className="sparkle sparkle-two">✧</div></div>
              <h2>{query||categoryFilter ? "No notes found" : showArchived ? "Archive is empty" : user ? "A fresh page." : authStatus === "unavailable" ? "Almost ready." : "Your notes start here."}</h2>
              <p>{query||categoryFilter ? "Try another search term or clear the category filter." : showArchived ? "Archived notes appear here and can be restored any time." : user ? "Your notes will find a home here. Start with one small thought." : authStatus === "unavailable" ? "The app needs its dedicated D1 database and Google sign-in configuration before accounts can be enabled." : "Sign in with Google to create and sync your notes."}</p>
              {user&&canWrite&&!showArchived&&!query&&!categoryFilter ? <button className="primary-button" onClick={startNewNote}><Plus size={17} /> Create your first note</button> : authStatus === "signed_out" ? <a className="primary-button" href="/auth/google"><LogIn size={16} /> Continue with Google</a> : null}
            </div>}
          </>}

          {view === "calendar" && <section className="calendar-section">
            {eventsError&&<div className="inline-error">{eventsError}</div>}
            <div className="calendar-toolbar"><div className="calendar-navigation"><button className="secondary-button" onClick={()=>setCalendarCursor(new Date())}>Today</button><button className="calendar-arrow" onClick={()=>moveCalendar(-1)} aria-label="Previous period">‹</button><button className="calendar-arrow" onClick={()=>moveCalendar(1)} aria-label="Next period">›</button><h2>{calendarHeading}</h2></div><div className="calendar-mode"><button className={calendarMode==="month"?"active":""} onClick={()=>setCalendarMode("month")}>Month</button><button className={calendarMode==="week"?"active":""} onClick={()=>setCalendarMode("week")}>Week</button></div><div className="google-calendar-actions">{activeWorkspace?.role!=="viewer"&&(googleCalendarStatus.connected?<><button className="secondary-button" onClick={syncGoogleCalendar} disabled={googleCalendarBusy}>{googleCalendarBusy?"Syncing…":"Sync Google Calendar"}</button><button className="text-action" onClick={()=>void disconnectGoogleCalendar()} disabled={googleCalendarBusy}>Disconnect</button></>:<button className="secondary-button" onClick={connectGoogleCalendar}>Connect Google Calendar</button>)}</div></div>
            <p className="calendar-sync-note">Google Calendar → KitaNotes only. Imported events are visible to this workspace’s members. KitaNotes never edits Google Calendar. {googleCalendarStatus.lastSyncAt?"Last sync: "+new Date(googleCalendarStatus.lastSyncAt).toLocaleString():""} </p>
            {googleCalendarError&&<div className="inline-error">{googleCalendarError}</div> }
            {eventsLoading?<div className="loading-state">Loading your calendar…</div>:<div className={calendarMode==="month"?"calendar-grid month-grid":"calendar-grid week-grid"}>{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day=><div className="calendar-weekday" key={day}>{day}</div>)}{calendarDays.map(day=><div className={"calendar-day"+(day.getMonth()!==calendarCursor.getMonth()&&calendarMode==="month"?" outside":"")+(dateKey(day)===dateKey(new Date())?" today":"")} key={dateKey(day)}><div className="calendar-day-heading"><span>{day.getDate()}</span>{calendarMode==="week"&&<small>{day.toLocaleDateString(undefined,{month:"short"})}</small>}</div><div className="calendar-day-events">{eventsForDay(day).map(item=><button className="calendar-event-chip" key={item.id} onClick={()=>{if(item.source!=="google_calendar")startEditEvent(item);}} title={item.source==="google_calendar"?item.title+" · Imported from Google Calendar":item.title}><span>{item.allDay?"All day":new Date(item.startsAt).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</span>{item.title}</button>)}</div>{calendarMode==="week"&&eventsForDay(day).length===0&&<span className="calendar-empty-day">No events</span>}</div>)}</div>}
            {!eventsLoading&&events.length===0&&<div className="calendar-empty-note">Nothing scheduled in this period. Add an event to start filling the calendar.</div>}
            <div className="calendar-agenda"><h3>Upcoming in this view</h3>{events.filter(item=>new Date(item.endsAt)>=new Date(calendarDays[0].getTime()-86400000)&&new Date(item.startsAt)<new Date(calendarDays[calendarDays.length-1].getTime()+2*86400000)).map(item=><article className="event-card" key={item.id}><div className="event-date-block"><strong>{new Date(item.startsAt).toLocaleDateString(undefined,{day:"2-digit",timeZone:item.timezone})}</strong><span>{new Date(item.startsAt).toLocaleDateString(undefined,{month:"short",timeZone:item.timezone})}</span></div><div className="event-copy"><h3>{item.title}</h3><p>{item.allDay?new Date(item.startsAt).toLocaleDateString(undefined,{dateStyle:"long",timeZone:item.timezone})+" · All day":new Date(item.startsAt).toLocaleString(undefined,{timeZone:item.timezone})+" · "+item.timezone}</p>{item.description&&<small>{item.description}</small>}{item.source==="google_calendar"&&<small className="calendar-sync-note">Imported from Google Calendar · read-only</small>}<small className="record-audit">Created by {item.createdByName||item.createdByEmail||"Unknown"} · {new Date(item.createdAt).toLocaleString()}<br/>Last updated by {item.updatedByName||item.updatedByEmail||item.createdByName||item.createdByEmail||"Unknown"} · {new Date(item.updatedAt).toLocaleString()}</small></div>{item.source!=="google_calendar"&&<><button className="mini-icon" onClick={()=>startEditEvent(item)} aria-label="Edit event"><Pencil size={15}/></button><button className="mini-icon" onClick={()=>deleteEvent(item)} aria-label="Delete event"><Archive size={15}/></button></>}</article>)}</div>
          </section>}
          {view === "shared" && <section className="shared-section">{sharedWorkspaces.length===0?<div className="placeholder-panel"><Users size={26} /><h2>Nothing shared yet.</h2><p>When someone invites you, or you share a workspace, it will show up here.</p><button className="secondary-button" onClick={()=>setView("notes")}>Back to notes</button></div>:<div className="shared-grid">{sharedWorkspaces.map(workspace=><button key={workspace.id} className={workspace.id===activeWorkspaceId?"shared-card current":"shared-card"} onClick={()=>{setActiveWorkspaceId(workspace.id);setShowArchived(false);setView("notes");}}><span className="workspace-avatar">{workspace.name.slice(0,1).toUpperCase()}</span><strong>{workspace.name}</strong><small>{workspace.role==="owner"?"You own this space":workspace.role==="editor"?"You can edit":"View only"}</small></button>)}</div>}</section>}

          <button className="ai-hint" onClick={()=>{setAiModalOpen(true);setAiError("");}} disabled={!user}><span className="ai-icon"><Sparkles size={17}/></span><div><strong>AI organiser</strong><p>Turn a brain dump into a note, events and reminders.</p></div><span className="coming-soon">{aiStatus?.configured?"OPEN":"SETUP"}</span></button>
        </div>
      </section>

      {workspaceModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!workspaceSaving)setWorkspaceModalOpen(false);}}>
        <section className="composer workspace-composer" role="dialog" aria-modal="true" aria-labelledby="workspace-create-title">
          <header><div><span className="eyebrow">CREATE A SHARED SPACE</span><h2 id="workspace-create-title">Give this space a purpose</h2></div><button className="icon-button" onClick={()=>setWorkspaceModalOpen(false)} aria-label="Close" disabled={workspaceSaving}><X size={19}/></button></header>
          <p className="workspace-intro">Describe what you want to keep here. AI can suggest a workspace name and a tidy set of categories. You review everything before creation.</p>
          <label className="field-label">What is this workspace for?<textarea className="ai-input" rows={4} maxLength={4000} value={workspacePurpose} onChange={event=>{setWorkspacePurpose(event.target.value);setWorkspaceAiDraft(null);}} placeholder="Example: A shared space for our family plans, school information, household tasks and important dates."/></label>
          <div className="workspace-ai-row"><span className="workspace-ai-status"><Sparkles size={14}/>{!aiStatus?"Checking AI…":!aiStatus.configured?"AI unavailable":"AI ready"}</span><button className="secondary-button" onClick={generateWorkspaceWithAi} disabled={!workspacePurpose.trim()||workspaceAiBusy||!aiStatus?.configured}>{workspaceAiBusy?"Designing…":"Suggest with AI"}</button></div>
          {workspaceAiDraft&&<div className="workspace-ai-preview"><div className="workspace-ai-preview-heading"><Check size={15}/> AI suggestion · review before creating</div><p>{workspaceAiDraft.categories.length} suggested categories</p><div className="workspace-category-suggestions">{workspaceAiDraft.categories.map(category=><div key={category.name}><strong>{category.name}</strong><small>{category.description}</small></div>)}</div></div>}
          <label className="field-label">Workspace name<input className="invite-input" value={workspaceName} onChange={event=>setWorkspaceName(event.target.value)} maxLength={60} placeholder="e.g. Family HQ"/></label>
          {workspaceAiError&&<p className="invite-error">{workspaceAiError}</p>}
          <footer><span>{workspaceAiDraft?"Suggested categories will be added after you confirm.":"You can create it manually or ask AI for a starting structure."}</span><button className="primary-button" onClick={saveNewWorkspace} disabled={!workspaceName.trim()||workspaceSaving}>{workspaceSaving?"Creating…":"Create workspace"}</button></footer>
        </section>
      </div>}

      {categoryModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setCategoryModalOpen(false);}}>
        <section className="composer" role="dialog" aria-modal="true" aria-labelledby="category-title">
          <header><div><span className="eyebrow">ORGANISE YOUR NOTES</span><h2 id="category-title">Categories</h2></div><button className="icon-button" onClick={()=>setCategoryModalOpen(false)} aria-label="Close"><X size={19}/></button></header>
          <label className="field-label">New category<input className="invite-input" value={categoryName} onChange={event=>setCategoryName(event.target.value)} maxLength={50} placeholder="e.g. Family, Work, Ideas"/></label>
          {categoryError&&<p className="invite-error">{categoryError}</p>}
          <footer><span>{categories.length} categories in your workspace</span><button className="primary-button" onClick={createCategory} disabled={!categoryName.trim()||categorySaving}>{categorySaving?"Saving…":"Create category"}</button></footer>
          <div className="category-list">{categories.map(category=><div key={category.id}><span className="category-dot" style={{background:category.color||"#8c88a7"}}/><strong>{category.name}</strong></div>)}</div>
        </section>
      </div>}

      {aiModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setAiModalOpen(false);}}>
        <section className="composer ai-composer" role="dialog" aria-modal="true" aria-labelledby="ai-title">
          <header><div><span className="eyebrow">SMART ORGANISER</span><h2 id="ai-title">Organize with AI</h2></div><button className="icon-button" onClick={()=>setAiModalOpen(false)} aria-label="Close"><X size={19}/></button></header>
          {!aiStatus?<p className="ai-privacy-copy">Checking AI availability…</p>:!aiStatus.configured?<div className="ai-privacy-card"><strong>AI is not configured yet.</strong><p>AI features will be available once the service is configured.</p></div>:!aiDraft?<div>
            <p className="ai-privacy-copy">Add text or an image. AI can prepare a note, recommend its category, and identify calendar events, reminders and tasks. Your submitted content is sent to an external AI service for processing. Review all suggestions before saving.</p>
            <textarea className="ai-input" value={aiInput} onChange={event=>setAiInput(event.target.value)} maxLength={16000} rows={7} placeholder="Example: Meeting with Sarah next Tuesday at 10am. Prepare the proposal beforehand and remind me 30 minutes before…"/>
            <div className="ai-usage-row"><span>{aiInput.length.toLocaleString()} / 16,000 characters</span></div>
            <div className="ai-draft-section">
              <strong>Add an image</strong>
              <p className="ai-privacy-copy">Choose an image from your photo library or take a new picture. Images are processed for text extraction and are not stored by KitaNotes.</p>
              <input ref={galleryInputRef} className="visually-hidden-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>{setOcrFile(event.target.files?.[0]??null);setOcrText("");}}/>
              <input ref={cameraInputRef} className="visually-hidden-file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event=>{setOcrFile(event.target.files?.[0]??null);setOcrText("");}}/>
              <div className="image-source-actions"><button className="secondary-button" onClick={()=>galleryInputRef.current?.click()}><Plus size={15}/> Choose from gallery</button><button className="secondary-button" onClick={()=>cameraInputRef.current?.click()}><Plus size={15}/> Take a photo</button></div>
              {ocrFile&&<div className="selected-image-row"><span>{ocrFile.name}</span><button className="text-action" onClick={()=>{setOcrFile(null);setOcrText("");}}>Remove image</button></div>}
              {ocrPreviewUrl&&<img className="ocr-image-preview" src={ocrPreviewUrl} alt="Selected image preview"/>}
              <button className="secondary-button" onClick={scanImageWithAi} disabled={!ocrFile||ocrWorking}>{ocrWorking?"Reading image…":"Extract text from image"}</button>
              {ocrText!==""&&<label className="field-label">Review extracted text<textarea className="ai-input" rows={5} value={ocrText} onChange={event=>setOcrText(event.target.value)}/></label>}
            </div>
            {aiError&&<p className="invite-error">{aiError}</p>}
            <footer><button className="primary-button" onClick={()=>organizeWithAi(ocrText||aiInput)} disabled={!(ocrText||aiInput).trim()||aiWorking}>{aiWorking?"Organizing…":"Organize"}</button></footer>
          </div>:<div className="ai-draft">
            <div className="ai-draft-banner"><Sparkles size={15}/> Review your suggestions before saving.</div>
            <p className="ai-privacy-copy">{aiDraft.summary}</p>
            <label className="field-label">Note title<input className="invite-input" value={aiDraftTitle} onChange={event=>setAiDraftTitle(event.target.value)} maxLength={200}/></label>
            <label className="field-label">Note content<textarea className="ai-input" value={aiDraftContent} onChange={event=>setAiDraftContent(event.target.value)} rows={6} maxLength={50000}/></label>
            {aiDraft.categorySuggestion&&<div className="ai-category-recommendation"><div><strong>Recommended category</strong><span>{aiDraft.categorySuggestion.name}</span><small>{aiDraft.categorySuggestion.reason||"Based on the note content."}</small></div><span className="ai-category-kind">{aiDraft.categorySuggestion.createNew?"New category":"Existing category"}</span></div>}
            <label className="field-label">Save note in category<select className="invite-input" value={selectedCategoryId} onChange={event=>setSelectedCategoryId(event.target.value)}><option value="">Uncategorised</option>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}{aiDraft.categorySuggestion?.createNew&&<option value="__ai_new_category__">Create new: {aiDraft.categorySuggestion.name}</option>}</select></label>
            {aiDraft.events.length>0&&<div className="ai-draft-section"><strong>Calendar events</strong>{aiDraft.events.map((event,index)=><div key={index}><b>{event.title}</b><small>{event.startLocal} to {event.endLocal} ({event.timezone}){event.reminderLocal?" · reminder "+event.reminderLocal:""}</small></div>)}</div>}
            {aiDraft.reminders.length>0&&<div className="ai-draft-section"><strong>Reminders</strong>{aiDraft.reminders.map((item,index)=><div key={index}><b>{item.title}</b><small>{item.dueLocal} ({item.timezone})</small></div>)}</div>}
            {aiDraft.tasks.length>0&&<div className="ai-draft-section"><strong>Tasks</strong>{aiDraft.tasks.map((item,index)=><div key={index}><b>{item.title}</b><small>{item.dueLocal||"No due date supplied"}</small></div>)}</div>}
            {aiDraft.clarifyingQuestions.length>0&&<div className="ai-questions"><strong>Needs clarification</strong>{aiDraft.clarifyingQuestions.map((question,index)=><p key={index}>{question}</p>)}</div>}
            {aiError&&<p className="invite-error">{aiError}</p>}
            {aiNoteSaved&&<p className="ai-saved">Note saved. Calendar items still need attention.</p>}
            {aiItemsCreated&&<p className="ai-saved">Calendar items saved.</p>}
            <footer><button className="text-action" onClick={()=>{setAiDraft(null);setAiError("");setAiNoteSaved(false);setAiItemsCreated(false);setAiCreatedItems([]);}}>Start over</button><button className="primary-button" onClick={saveAiNote} disabled={aiSavingNote||aiCreatingItems||!aiDraftTitle.trim()}>{aiSavingNote?"Saving…":aiNoteSaved?"Finish saving calendar":"Save note & calendar"}</button></footer>
          </div>}
        </section>
      </div>}

      {inviteOpen && activeWorkspace && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setInviteOpen(false); }}>
        <section className="composer invite-composer manage-composer" role="dialog" aria-modal="true" aria-labelledby="invite-title">
          <header><div><span className="eyebrow">{activeWorkspace.role==="owner"?"MANAGE SPACE":"SHARED SPACE"}</span><h2 id="invite-title">{activeWorkspace.name}</h2></div><button className="icon-button" onClick={() => setInviteOpen(false)} aria-label="Close"><X size={19}/></button></header>
          <div className="manage-tabs" role="tablist">{(["people",...(activeWorkspace.role==="owner"&&activeWorkspace.visibility==="shared"?["invite"]:[]),"activity",...(activeWorkspace.role==="owner"?["settings"]:["leave"])] as string[]).map(tab=><button key={tab} role="tab" aria-selected={manageTab===tab} className={manageTab===tab?"manage-tab active":"manage-tab"} onClick={()=>setManageTab(tab as ManageTab)}>{tab==="people"?"People ("+workspaceMembers.length+")":tab==="invite"?"Invite":tab==="activity"?"Activity":tab==="settings"?"Settings":"Leave"}</button>)}</div>
          {inviteCreateError && <p className="invite-error">{inviteCreateError}</p>}

          {manageTab==="people"&&<div className="invite-list">
            {invitationsLoading?<p>Loading members…</p>:workspaceMembers.map(member=><div className="invite-list-row" key={member.userId}>
              <div><strong>{member.displayName||member.email}{member.userId===user?.id?" (you)":""}</strong><small>{member.email} · {member.role} · joined {new Date(member.joinedAt).toLocaleDateString()}</small></div>
              {activeWorkspace.role==="owner"&&member.role!=="owner"&&<div className="invite-member-actions"><select className="invite-input" aria-label={"Permission for "+member.email} value={member.role} onChange={event=>updateWorkspaceMemberRole(member,event.target.value as "editor"|"viewer")} disabled={workspaceActionBusy}><option value="viewer">Viewer</option><option value="editor">Editor</option></select><button className="text-action" onClick={()=>transferOwnership(member)} disabled={workspaceActionBusy}>Make owner</button><button className="text-action" onClick={()=>removeWorkspaceMember(member)} disabled={workspaceActionBusy}>Remove</button></div>}
            </div>)}
            <p className="invite-list-note">Owners manage people and settings. Editors can change notes, events and categories. Viewers can read only.</p>
          </div>}

          {manageTab==="invite"&&activeWorkspace.role==="owner"&&<>
            {!createdInvite ? <>
              <p className="invite-list-note">Create a reusable link. Anyone who has it can join this workspace after Google sign-in. You can remove members or revoke the link at any time.</p>
              <label className="field-label">Permission<select className="invite-input" value={inviteRole} onChange={event => setInviteRole(event.target.value as "editor" | "viewer")}><option value="viewer">Viewer · can read notes</option><option value="editor">Editor · can read and edit notes</option></select></label>
              <footer><span>Anyone with the link can join as the selected role.</span><button className="primary-button" onClick={createInvite} disabled={inviteSending}>{inviteSending ? "Creating…" : "Create invite link"}</button></footer>
            </> : <>
              <p className="invite-result-copy">Invite link created. It can be used by multiple people and expires in seven days. Revoke it any time.</p>
              <label className="field-label">Reusable invitation link<input className="invite-input" readOnly value={createdInvite.invitationUrl} onFocus={event=>event.currentTarget.select()}/></label>
              <footer><button className="secondary-button" onClick={copyInviteLink}>{copiedInvite ? "Copied" : "Copy link"}</button></footer>
              <button className="text-action" onClick={()=>{setCreatedInvite(null);setCopiedInvite(false);}}>Invite someone else</button>
            </>}
            <div className="invite-list">
              <div className="invite-list-heading"><strong>Invitations</strong><span>{invitations.length}</span></div>
              {invitationsLoading ? <p>Loading invitations…</p> : invitations.length === 0 ? <p>No invitations yet.</p> : invitations.map(invitation => <div className="invite-list-row" key={invitation.id}>
                <div><strong>{invitation.email}</strong><small>{invitation.role} · {invitation.status} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</small></div>
                <div className="invite-member-actions">{(invitation.status==="pending"||invitation.status==="expired"||invitation.status==="revoked")&&<button className="text-action" onClick={()=>regenerateInvite(invitation)} disabled={inviteSending}>{invitation.status==="pending"?"New link":"Re-invite"}</button>}{invitation.status==="pending"&&<button className="text-action" onClick={() => revokeInvitation(invitation.id)}>Revoke</button>}</div>
              </div>)}
              <p className="invite-list-note">Anyone with an active link can join. The owner can revoke a link or remove a member at any time.</p>
            </div>
          </>}

          {manageTab==="activity"&&<div className="invite-list">
            {invitationsLoading?<p>Loading activity…</p>:activity.length===0?<p>No sharing activity yet.</p>:activity.map(item=><div className="invite-list-row" key={item.id}><div><strong>{describeActivity(item)}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></div></div>)}
          </div>}

          {manageTab==="settings"&&activeWorkspace.role==="owner"&&<div className="invite-list">
            <strong>Space settings</strong><p className="invite-list-note">Rename this space or change who can access it. Deleting a shared space permanently removes its notes and events.</p>
            <div className="invite-member-actions"><button className="secondary-button" onClick={renameWorkspace} disabled={workspaceActionBusy}>Rename</button>{activeWorkspace.visibility==="shared"?<button className="secondary-button" onClick={makeWorkspacePrivate} disabled={workspaceActionBusy}>Make private</button>:<button className="secondary-button" onClick={makeWorkspaceShared} disabled={workspaceActionBusy}>Make shared</button>}{activeWorkspace.visibility==="shared"&&<button className="secondary-button danger-action" onClick={deleteWorkspace} disabled={workspaceActionBusy}>Delete space</button>}</div>
          </div>}

          {manageTab==="leave"&&activeWorkspace.role!=="owner"&&<div className="invite-list">
            <strong>Leave this space</strong><p className="invite-list-note">You will lose access to its notes and events until the owner invites you again. Your personal workspace is not affected.</p>
            <div className="invite-member-actions"><button className="secondary-button danger-action" onClick={()=>{setInviteOpen(false);void leaveWorkspace();}} disabled={workspaceActionBusy}>Leave space</button></div>
          </div>}
        </section>
      </div>}

      {eventComposerOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setEventComposerOpen(false);}}>
        <section className="composer" role="dialog" aria-modal="true" aria-labelledby="event-title">
          <header><div><span className="eyebrow">INTERNAL CALENDAR</span><h2 id="event-title">{editingEvent?"Edit event":"New event"}</h2></div><button className="icon-button" onClick={()=>setEventComposerOpen(false)} aria-label="Close"><X size={19}/></button></header>
          <label className="field-label">Event title<input className="invite-input" value={eventTitle} onChange={e=>setEventTitle(e.target.value)} maxLength={200} placeholder="What is happening?"/></label>
          <label className="field-label">Details<textarea className="invite-input event-description" value={eventDescription} onChange={e=>setEventDescription(e.target.value)} maxLength={5000} rows={3} placeholder="Optional details"/></label>
          <div className="event-datetime-grid"><label className="field-label">Starts<input className="invite-input" type="datetime-local" value={eventStart} onChange={e=>setEventStart(e.target.value)}/></label><label className="field-label">Ends<input className="invite-input" type="datetime-local" value={eventEnd} onChange={e=>setEventEnd(e.target.value)}/></label></div>
          <label className="field-label">Timezone<input className="invite-input" value={eventTimezone} onChange={e=>setEventTimezone(e.target.value)} placeholder="Asia/Kuala_Lumpur"/></label>
          <label className="field-label">Link to note (optional)<select className="invite-input" value={eventLinkedNoteId} onChange={e=>setEventLinkedNoteId(e.target.value)}><option value="">No linked note</option>{notes.filter(note=>note.workspaceId===activeWorkspaceId).map(note=><option key={note.id} value={note.id}>{note.title}</option>)}</select></label>
          <label className="field-label">Reminder (optional)<input className="invite-input" type="datetime-local" value={eventReminderAt} onChange={e=>setEventReminderAt(e.target.value)}/></label>
          {eventsError&&<p className="invite-error">{eventsError}</p>}
          <footer><span>{editingEvent?"Changes use version checking. Existing reminders are retained.":"Reminder delivery appears in the in-app inbox, checked every five minutes."}</span><button className="primary-button" onClick={saveEvent} disabled={!eventTitle.trim()||eventSaving}>{eventSaving?"Saving…":editingEvent?"Save changes":"Save event"}</button></footer>
        </section>
      </div>}

      {composerOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setComposerOpen(false); }}>
        <section className="composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
          <header><div><span className="eyebrow">{editingNote?"EDIT NOTE":(workspaces.find(item=>item.id===activeWorkspaceId)?.visibility==="shared"?"SHARED WORKSPACE NOTE":"PRIVATE WORKSPACE NOTE")}</span><h2 id="composer-title">{editingNote ? "Edit note" : "New note"}</h2></div><button className="icon-button" onClick={() => setComposerOpen(false)} aria-label="Close"><X size={19} /></button></header>
          <input className="composer-title" value={draftTitle} onChange={event => setDraftTitle(event.target.value)} placeholder="Give your note a title" maxLength={200} autoFocus />
          <textarea value={draftContent} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==="Enter"){event.preventDefault();void saveNote();}}} onChange={event => setDraftContent(event.target.value)} placeholder="Start writing… anything worth remembering." maxLength={50000} rows={9} />
          <div className="composer-counter">{draftContent.trim()?draftContent.trim().split(/\s+/).length:0} words · {draftContent.length.toLocaleString()} / 50,000</div><label className="field-label">Category<select className="invite-input" value={selectedCategoryId} onChange={event=>setSelectedCategoryId(event.target.value)}><option value="">Uncategorised</option>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <footer><span>{editingNote ? "Changes use version checking to avoid overwriting newer edits." : (activeWorkspace?.visibility==="shared"?"Saved to this shared workspace.":"Saved to your private workspace.")+" Ctrl/⌘+Enter to save."}</span><button className="primary-button" onClick={saveNote} disabled={!draftTitle.trim() || saving}>{saving ? "Saving…" : editingNote ? "Save changes" : "Save note"}</button></footer>
        </section>
      </div>}
      <div className="toast-stack" role="status" aria-live="polite">{toasts.map(toast=><div key={toast.id} className={"toast "+toast.tone}>{toast.text}</div>)}</div>
    </main>
  );
}
