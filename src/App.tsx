import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
const AiAssistantModal = lazy(() => import("./components/AiAssistantModal"));
const CalendarView = lazy(() => import("./components/CalendarView"));
import { Bell, CalendarDays, Check, ChevronDown, Command, Fingerprint, LogIn, LogOut, Plus, Search, Sparkles, Users, X, Archive, Moon, Sun, Tag, Star, Trash2 } from "lucide-react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { defaultReminderDateTime } from "./calendar-utils.ts";
import NoteCard from "./components/NoteCard";
import { subscribePoll } from "./poll-scheduler";

type ActivityItem = { id:string; type:string; actor:string; actorId:string|null; target:string|null; metadata:Record<string,unknown>; createdAt:string };
type ManageTab = "people" | "invite" | "activity" | "settings" | "leave";
type SortMode = "updated" | "oldest" | "title";
type Toast = { id:number; text:string; tone:"ok"|"error" };
type View = "notes" | "calendar" | "shared";
type InstallPromptEvent = Event & { prompt:()=>Promise<void>; userChoice:Promise<{outcome:"accepted"|"dismissed";platform:string}> };

type WorkspacePickerProps = { workspaces:Workspace[]; activeWorkspaceId:string; onChange:(id:string)=>void; unreadByWorkspace?:Record<string,number> };
function WorkspacePicker({workspaces,activeWorkspaceId,onChange,unreadByWorkspace={}}:WorkspacePickerProps){
  const [open,setOpen]=useState(false);
  const rootRef=useRef<HTMLDivElement|null>(null);
  const active=workspaces.find(item=>item.id===activeWorkspaceId);
  useEffect(()=>{
    if(!open)return;
    const onPointerDown=(event:PointerEvent)=>{if(rootRef.current&&!rootRef.current.contains(event.target as Node))setOpen(false);};
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false);};
    document.addEventListener("pointerdown",onPointerDown);
    document.addEventListener("keydown",onKeyDown);
    return()=>{document.removeEventListener("pointerdown",onPointerDown);document.removeEventListener("keydown",onKeyDown);};
  },[open]);
  return <div className="workspace-picker" ref={rootRef}>
    <button type="button" className="workspace-picker-trigger" aria-label="Choose workspace" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <span className="workspace-avatar">K</span>{(unreadByWorkspace[activeWorkspaceId]??0)>0&&<span className="workspace-unread-dot" aria-label="Unread workspace activity"/>}
      <span className="workspace-picker-copy"><strong>{active?.name??"My workspace"}</strong><small>{active?.visibility==="shared"?"Shared space":"Private workspace"}</small></span>
      <ChevronDown size={16} className={open?"workspace-picker-chevron open":"workspace-picker-chevron"}/>
    </button>
    {open&&<div className="workspace-picker-menu" role="listbox" aria-label="Workspaces">
      {workspaces.map(workspace=><button type="button" role="option" aria-selected={workspace.id===activeWorkspaceId} key={workspace.id} className={workspace.id===activeWorkspaceId?"workspace-picker-option active":"workspace-picker-option"} onClick={()=>{onChange(workspace.id);setOpen(false);}}>
        <span className="workspace-picker-option-avatar">{workspace.name.trim().slice(0,1).toUpperCase()||"K"}</span>
        <span className="workspace-picker-option-copy"><strong>{workspace.name}</strong><small>{workspace.visibility==="shared"?"Shared space":"Private workspace"}</small></span>
        {(unreadByWorkspace[workspace.id]??0)>0&&<span className="workspace-unread-count" aria-label={(unreadByWorkspace[workspace.id]??0)+" unread notifications"}>{(unreadByWorkspace[workspace.id]??0)>99?"99+":unreadByWorkspace[workspace.id]}</span>}{workspace.id===activeWorkspaceId&&<Check size={16}/>}
      </button>)}
      {!workspaces.length&&<div className="workspace-picker-empty">No workspaces available</div>}
    </div>}
  </div>;
}
type AccountMenuProps = {
  user:SessionUser|null;
  authStatus:"loading"|"signed_out"|"ready"|"unavailable";
  passkeyBusy:boolean;
  onRegisterPasskey:()=>void;
  onSignInWithPasskey:()=>void;
  onRegenerateRecoveryCodes:()=>void;
  onOpenSignup:()=>void;
  onOpenRecovery:()=>void;
  onSignOut:()=>void;
};
function AccountMenu({user,authStatus,passkeyBusy,onRegisterPasskey,onSignInWithPasskey,onRegenerateRecoveryCodes,onOpenSignup,onOpenRecovery,onSignOut}:AccountMenuProps){
  const [open,setOpen]=useState(false);
  const rootRef=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{
    if(!open)return;
    const onPointerDown=(event:PointerEvent)=>{if(rootRef.current&&!rootRef.current.contains(event.target as Node))setOpen(false);};
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false);};
    document.addEventListener("pointerdown",onPointerDown);
    document.addEventListener("keydown",onKeyDown);
    return()=>{document.removeEventListener("pointerdown",onPointerDown);document.removeEventListener("keydown",onKeyDown);};
  },[open]);
  const signedIn=!!user;
  return <div className="account-menu" ref={rootRef}>
    <button type="button" className="account-control" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      {user?.avatarUrl?<img className="profile-avatar small" src={user.avatarUrl} alt=""/>:<span className="profile-avatar small">{user?.displayName?.slice(0,1).toUpperCase()??"?"}</span>}
      <span className="account-control-label">{signedIn?(user.displayName||"Account"):"Account"}</span>
      <ChevronDown size={15} className={open?"account-chevron open":"account-chevron"}/>
    </button>
    {open&&<div className="account-menu-panel" role="menu" aria-label="Account">
      {signedIn?<>
        <div className="account-menu-identity"><strong>{user.displayName||"KitaNotes account"}</strong><small>{user.email}</small></div>
        <div className="account-menu-divider"/>
        <button type="button" role="menuitem" onClick={()=>{onRegisterPasskey();setOpen(false);}} disabled={passkeyBusy}><Fingerprint size={16}/><span>Add a passkey</span></button>
        <button type="button" role="menuitem" onClick={()=>{onRegenerateRecoveryCodes();setOpen(false);}} disabled={passkeyBusy}><LogIn size={16}/><span>Recovery codes</span></button>
        {user.googleLinked===false&&<a role="menuitem" href="/auth/google/link" onClick={()=>setOpen(false)}><LogIn size={16}/><span>Link Google account</span></a>}
        <div className="account-menu-divider"/>
        <button type="button" role="menuitem" className="account-menu-signout" onClick={()=>{onSignOut();setOpen(false);}}><LogOut size={16}/><span>Sign out</span></button>
      </>:authStatus==="signed_out"?<>
        <div className="account-menu-identity"><strong>Welcome to KitaNotes</strong><small>Sign in or create an account</small></div>
        <div className="account-menu-divider"/>
        <button type="button" role="menuitem" onClick={()=>{onOpenSignup();setOpen(false);}} disabled={passkeyBusy}><Fingerprint size={16}/><span>Create account with Passkey</span></button>
        <button type="button" role="menuitem" onClick={()=>{onSignInWithPasskey();setOpen(false);}} disabled={passkeyBusy}><Fingerprint size={16}/><span>Sign in with Passkey</span></button>
        <a role="menuitem" href="/auth/google" onClick={()=>setOpen(false)}><LogIn size={16}/><span>Continue with Google</span></a>
        <div className="account-menu-divider"/>
        <button type="button" role="menuitem" onClick={()=>{onOpenRecovery();setOpen(false);}}><LogIn size={16}/><span>Recover account</span></button>
      </>:<div className="account-menu-identity"><strong>{authStatus==="loading"?"Checking session…":"Sign-in setup pending"}</strong><small>{authStatus==="unavailable"?"Account services are not available yet.": "Please wait."}</small></div>}
    </div>}
  </div>;
}
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
type SessionUser = { id: string; email: string; displayName: string | null; avatarUrl: string | null; personalWorkspaceId: string | null; googleLinked?:boolean };
type Invitation = { id: string; email: string; role: "editor" | "viewer"; status: string; expiresAt: string };
type WorkspaceMember = {userId:string;email:string;displayName:string|null;role:"owner"|"editor"|"viewer";joinedAt:string};
type Workspace = {id:string;name:string;type:"shared";visibility:"private"|"shared";role:"owner"|"editor"|"viewer"};
type Category = {id:string;workspaceId:string;name:string;color:string|null;sortOrder:number};
type Reminder = {id:string;workspaceId:string;eventId:string|null;noteId:string|null;title:string;dueAt:string;timezone:string;status:"pending"|"delivered"|"cancelled"};
type CalendarEvent = { id:string; workspaceId:string; title:string; description:string; startsAt:string; endsAt:string; timezone:string; allDay:boolean; linkedNoteId:string|null; createdBy:string; createdByName:string|null; updatedBy:string|null; updatedByName:string|null; createdAt:string; updatedAt:string; version:number };
type Notification = { id:string; workspaceId:string|null; type:string; title:string; body:string; resourceType:string|null; resourceId:string|null; createdAt:string; readAt:string|null };
type CalendarItem = CalendarEvent & {holiday?:boolean;holidayType?:"public"|"school"};
type NotificationPreferences = {pushEnabled:boolean;reminderPushEnabled:boolean;sharedNotePushEnabled:boolean;sharedNoteUpdatePushEnabled:boolean;eventPushEnabled:boolean;workspacePushEnabled:boolean;quietHoursStart:string|null;quietHoursEnd:string|null;timezone:string};
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
type ExistingNoteProposal = {noteId:string;categoryName:string;reason:string;selected:boolean;applied?:boolean};
type WorkspaceAiDraft = {name:string;categories:Array<{name:string;description:string}>};
type Note = {
  id: string; workspaceId: string; title: string; content: string; categoryId: string | null;
  categoryName: string | null; createdBy: string; createdByName:string|null; updatedBy:string|null; updatedByName:string|null; version: number; createdAt: string; updatedAt: string; archivedAt: string | null; deletedAt?:string|null;
};
function noteDraftStorageKey(userId:string,workspaceId:string,noteId:string|null){return "kitanotes-note-draft:"+userId+":"+workspaceId+":"+(noteId??"new");}
type NoteConflict = {latest:Note;mine:{title:string;content:string;categoryId:string|null}};

export default function App() {
  // Track the iPhone's visual viewport so bottom-sheet modals resize when the keyboard opens.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateHeight = () => { document.documentElement.style.setProperty("--app-visual-height", Math.round(viewport.height) + "px"); document.documentElement.style.setProperty("--app-visual-offset-top", Math.round(viewport.offsetTop) + "px"); };
    updateHeight();
    viewport.addEventListener("resize", updateHeight);
    viewport.addEventListener("scroll", updateHeight);
    return () => {
      viewport.removeEventListener("resize", updateHeight);
      viewport.removeEventListener("scroll", updateHeight);
      document.documentElement.style.removeProperty("--app-visual-height");
      document.documentElement.style.removeProperty("--app-visual-offset-top");
    };
  }, []);

  const [view, setView] = useState<View>("notes");
  const [query, setQuery] = useState("");
  const [globalSearchActive,setGlobalSearchActive]=useState(false);
  const [globalSearchResults,setGlobalSearchResults]=useState<Note[]>([]);
  const [globalSearchLoading,setGlobalSearchLoading]=useState(false);
  const [globalSearchError,setGlobalSearchError]=useState("");
  const [noteConflict,setNoteConflict]=useState<NoteConflict|null>(null);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [manageTab, setManageTab] = useState<ManageTab>("people");
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityTypeFilter,setActivityTypeFilter]=useState("");
  const [activityPersonFilter,setActivityPersonFilter]=useState("");
  const [activityNextCursor,setActivityNextCursor]=useState<string|null>(null);
  const [activityLoadingMore,setActivityLoadingMore]=useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [showArchived, setShowArchived] = useState(false);
  const [showTrash,setShowTrash]=useState(false);
  const [theme, setTheme] = useState<"light"|"dark">(() => { try { const saved = localStorage.getItem("kitanotes-theme"); if (saved === "dark" || saved === "light") return saved; } catch { /* ignore */ } return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"; });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const calendarIcsInputRef = useRef<HTMLInputElement>(null);
  const pushToast = useCallback((text:string, tone:"ok"|"error"="ok") => {
    const id = Date.now() + Math.random();
    setToasts(current => [...current.slice(-3), { id, text, tone }]);
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), 3500);
  }, []);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [workspaces,setWorkspaces]=useState<Workspace[]>([]);
  const [activeWorkspaceId,setActiveWorkspaceId]=useState("");
  const [starredWorkspaceId,setStarredWorkspaceId]=useState<string|null>(null);
  const [starredWorkspaceSaving,setStarredWorkspaceSaving]=useState(false);
  const [workspaceModalOpen,setWorkspaceModalOpen]=useState(false);
  const [workspaceName,setWorkspaceName]=useState("");
  const [workspacePurpose,setWorkspacePurpose]=useState("");
  const [workspaceAiBusy,setWorkspaceAiBusy]=useState(false);
  const [workspaceSaving,setWorkspaceSaving]=useState(false);
  const [workspaceAiDraft,setWorkspaceAiDraft]=useState<WorkspaceAiDraft|null>(null);
  const [workspaceAiError,setWorkspaceAiError]=useState("");
  const [authStatus, setAuthStatus] = useState<"loading" | "signed_out" | "ready" | "unavailable">("loading");
  const [passkeyBusy,setPasskeyBusy]=useState(false);
  const [authDialog,setAuthDialog]=useState<"signup"|"recovery"|"codes"|null>(null);
  const [signupName,setSignupName]=useState("");
  const [signupEmail,setSignupEmail]=useState("");
  const [recoveryCode,setRecoveryCode]=useState("");
  const [authDialogError,setAuthDialogError]=useState("");
  const [recoveryCodes,setRecoveryCodes]=useState<string[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [viewingNote, setViewingNote] = useState<Note | null>(null);
  const [checklistSavingLine, setChecklistSavingLine] = useState<number | null>(null);
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
  const [invitePreview,setInvitePreview]=useState<{valid:boolean;workspaceName?:string;inviterName?:string;role?:"editor"|"viewer";memberCount?:number;expiresAt?:string;error?:string}|null>(null);
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
  const [eventReminders,setEventReminders]=useState<Reminder[]>([]);
  const [editingEventReminder,setEditingEventReminder]=useState<Reminder|null>(null);
  const [holidays,setHolidays]=useState<CalendarItem[]>([]);
  const [holidayFeedStatus,setHolidayFeedStatus]=useState<{holidayWise:boolean;kpm:boolean;publicHolidayCount:number;schoolHolidayCount:number;holidayWiseError:string|null}|null>(null);
  const [holidayState,setHolidayState]=useState("selangor");
  const [calendarTransferBusy,setCalendarTransferBusy]=useState(false);
  const [calendarRefresh,setCalendarRefresh]=useState(0);
  const [calendarMode,setCalendarMode]=useState<"month"|"week">("month");
  const [calendarCursor,setCalendarCursor]=useState(()=>new Date());
  const [editingEvent,setEditingEvent]=useState<CalendarEvent|null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [eventComposerOpen, setEventComposerOpen] = useState(false);
  const [eventTitle, setEventTitle] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventStart, setEventStart] = useState(() => localDateTime(new Date(Date.now()+25*3600000)));
  const [eventEnd, setEventEnd] = useState(() => localDateTime(new Date(Date.now()+26*3600000)));
  const [eventReminderAt, setEventReminderAt] = useState("");
  const [eventReminderAuto,setEventReminderAuto]=useState(true);
  const [eventLinkedNoteId, setEventLinkedNoteId] = useState("");
  const [eventWorkspaceId,setEventWorkspaceId]=useState("");
  const [eventWorkspaceNotes,setEventWorkspaceNotes]=useState<Note[]>([]);
  const [eventTimezone, setEventTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kuala_Lumpur");
  const [eventSaving, setEventSaving] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadByWorkspace,setUnreadByWorkspace]=useState<Record<string,number>>({});
  const [workspaceNotificationPreferences,setWorkspaceNotificationPreferences]=useState<Array<{id:string;name:string;role:string;mode:"all"|"important"|"mute"}>>([]);
  const [workspaceNotificationSaving,setWorkspaceNotificationSaving]=useState<string|null>(null);
  const [calendarFocusDate,setCalendarFocusDate]=useState<string|null>(null);
  const deepLinkHandled=useRef(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [installPrompt,setInstallPrompt]=useState<InstallPromptEvent|null>(null);
  const [installHelpOpen,setInstallHelpOpen]=useState(false);
  const [isInstalled,setIsInstalled]=useState(false);
  const [pushSupported,setPushSupported]=useState(false);
  const [pushSubscribed,setPushSubscribed]=useState(false);
  const [pushBusy,setPushBusy]=useState(false);
  const [pushError,setPushError]=useState("");
  const [notificationPrefs,setNotificationPrefs]=useState<NotificationPreferences>({pushEnabled:true,reminderPushEnabled:true,sharedNotePushEnabled:true,sharedNoteUpdatePushEnabled:true,eventPushEnabled:true,workspacePushEnabled:true,quietHoursStart:null,quietHoursEnd:null,timezone:"Asia/Kuala_Lumpur"});
  const [notificationPrefsLoading,setNotificationPrefsLoading]=useState(false);
  const [notificationPrefsSaving,setNotificationPrefsSaving]=useState(false);
  const [notificationPrefsError,setNotificationPrefsError]=useState("");
  const [notificationPrefsSaved,setNotificationPrefsSaved]=useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [existingOrganizerOpen,setExistingOrganizerOpen]=useState(false);
  const [existingOrganizerBusy,setExistingOrganizerBusy]=useState(false);
  const [existingOrganizerError,setExistingOrganizerError]=useState("");
  const [existingOrganizerProposals,setExistingOrganizerProposals]=useState<ExistingNoteProposal[]>([]);
  const [selectedOrganizerNoteIds,setSelectedOrganizerNoteIds]=useState<string[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [ocrFile,setOcrFile] = useState<File|null>(null);
  const [ocrWorking,setOcrWorking] = useState(false);

  const [ocrPreviewUrl,setOcrPreviewUrl] = useState("");
  const [aiWorking, setAiWorking] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [aiDraftTitle, setAiDraftTitle] = useState("");
  const [aiDraftContent, setAiDraftContent] = useState("");
  const [aiSavingNote, setAiSavingNote] = useState(false);
  const [aiCreatingItems, setAiCreatingItems] = useState(false);
  const [aiNoteSaved, setAiNoteSaved] = useState(false);
  const [aiSavedNoteId, setAiSavedNoteId] = useState<string | null>(null);
  const [aiCreatedEventIds, setAiCreatedEventIds] = useState<Record<number,string>>({});
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
    if(!user){setWorkspaces([]);setActiveWorkspaceId("");setStarredWorkspaceId(null);return;}
    let active=true;
    fetch("/api/workspaces",{credentials:"same-origin"}).then(async response=>{
      if(!response.ok)throw new Error("Unable to load workspaces.");
      const result=await response.json() as {workspaces:Workspace[];starredWorkspaceId:string|null};
      if(!active)return;
      setWorkspaces(result.workspaces);
      setStarredWorkspaceId(result.starredWorkspaceId);
      let savedWorkspaceId="";try{savedWorkspaceId=localStorage.getItem("kitanotes-active-workspace")??"";}catch{/* storage unavailable */}
      setActiveWorkspaceId(current=>result.workspaces.some(item=>item.id===current)?current:(result.workspaces.find(item=>item.id===savedWorkspaceId)?.id??result.workspaces.find(item=>item.id===result.starredWorkspaceId)?.id??result.workspaces.find(item=>item.id===user.personalWorkspaceId)?.id??result.workspaces[0]?.id??""));
    }).catch(()=>{if(active)setWorkspaces([]);});
    return()=>{active=false;};
  },[user]);

  useEffect(()=>{
    if(!inviteToken){setInvitePreview(null);return;}
    let active=true;
    fetch("/api/invitations/preview?token="+encodeURIComponent(inviteToken),{credentials:"same-origin",cache:"no-store"})
      .then(async response=>{const result=await response.json() as {valid:boolean;workspaceName?:string;inviterName?:string;role?:"editor"|"viewer";memberCount?:number;expiresAt?:string;error?:string};if(active)setInvitePreview(result);})
      .catch(()=>{if(active)setInvitePreview({valid:false,error:"INVITATION_PREVIEW_UNAVAILABLE"});});
    return()=>{active=false;};
  },[inviteToken]);

  useEffect(()=>{
    if(deepLinkHandled.current||workspaces.length===0)return;
    const params=new URLSearchParams(window.location.search),workspaceId=params.get("workspaceId"),noteId=params.get("noteId"),eventId=params.get("eventId");
    if(!workspaceId&&!noteId&&!eventId)return;
    deepLinkHandled.current=true;
    if(workspaceId&&!workspaces.some(item=>item.id===workspaceId)){window.history.replaceState({},"","/");pushToast("That workspace is no longer available.","error");return;}
    if(workspaceId)setActiveWorkspaceId(workspaceId);
    window.history.replaceState({},"","/");
    if(noteId){setView("notes");void fetch("/api/notes/"+encodeURIComponent(noteId),{credentials:"same-origin",cache:"no-store"}).then(async response=>{if(!response.ok)throw new Error("Note unavailable");const result=await response.json() as {note:Note};setViewingNote(result.note);}).catch(()=>pushToast("This note is no longer available.","error"));}
    if(eventId){setView("calendar");void fetch("/api/events/"+encodeURIComponent(eventId),{credentials:"same-origin",cache:"no-store"}).then(async response=>{if(!response.ok)throw new Error("Event unavailable");const result=await response.json() as {event:CalendarEvent};setCalendarCursor(new Date(result.event.startsAt));setCalendarFocusDate(result.event.startsAt.slice(0,10));}).catch(()=>pushToast("This event is no longer available.","error"));}
  },[workspaces,pushToast]);

  useEffect(() => {
    if (!user || !activeWorkspaceId) { setNotes([]); return; }
    let active = true;
    setNotes([]);
    setNotesLoading(true);
    setNotesError("");
    fetch("/api/notes?limit=100&workspaceId=" + encodeURIComponent(activeWorkspaceId) + (showTrash ? "&trash=1" : showArchived ? "&archived=1" : ""), { credentials: "same-origin" })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 503 ? "Database setup is not complete yet." : "Unable to load notes.");
        const result = await response.json() as { notes: Note[] };
        if (active) setNotes(result.notes);
      })
      .catch(error => { if (active) setNotesError(error instanceof Error ? error.message : "Unable to load notes."); })
      .finally(() => { if (active) setNotesLoading(false); });
    return () => { active = false; };
  }, [user, activeWorkspaceId, showArchived,showTrash]);

  useEffect(()=>{
    if(!globalSearchActive||!user||view!=="notes"||!query.trim()){setGlobalSearchResults([]);setGlobalSearchError("");setGlobalSearchLoading(false);return;}
    const controller=new AbortController();let active=true;
    const timer=window.setTimeout(async()=>{
      setGlobalSearchLoading(true);setGlobalSearchError("");
      try{const response=await fetch("/api/notes?q="+encodeURIComponent(query.trim())+"&limit=100",{credentials:"same-origin",cache:"no-store",signal:controller.signal});if(!response.ok)throw new Error("Unable to search notes across workspaces.");const result=await response.json() as {notes:Note[]};if(active)setGlobalSearchResults(result.notes);}
      catch(error){if(active&&!(error instanceof DOMException&&error.name==="AbortError"))setGlobalSearchError(error instanceof Error?error.message:"Global search failed.");}
      finally{if(active)setGlobalSearchLoading(false);}
    },250);
    return()=>{active=false;window.clearTimeout(timer);controller.abort();};
  },[globalSearchActive,user,view,query]);

  useEffect(()=>{
    if(view!=="notes"||!user||!activeWorkspaceId||composerOpen||editingNote||showArchived||showTrash)return;
    let cursor:string|null=null;
    return subscribePoll("notes:"+user.id+":"+activeWorkspaceId,30000,async signal=>{
      const url="/api/notes?limit=100&workspaceId="+encodeURIComponent(activeWorkspaceId)+(cursor?"&updatedSince="+encodeURIComponent(cursor):"");
      const response=await fetch(url,{credentials:"same-origin",cache:"no-store",signal});if(!response.ok)throw new Error("Unable to sync notes.");
      const result=await response.json() as {notes:Note[];removedNoteIds?:string[];nextCursor?:string};
      if(!cursor)setNotes(result.notes);
      else setNotes(current=>{const removed=new Set(result.removedNoteIds??[]),byId=new Map(current.filter(note=>!removed.has(note.id)).map(note=>[note.id,note]));for(const note of result.notes){const existing=byId.get(note.id);if(!existing||note.version>existing.version)byId.set(note.id,note);}return [...byId.values()].sort((x,y)=>y.updatedAt.localeCompare(x.updatedAt));});
      cursor=result.nextCursor??new Date().toISOString();
    });
  },[view,user,activeWorkspaceId,composerOpen,editingNote?.id,showArchived,showTrash]);

  // One keyed poller per open note. The scheduler pauses it while hidden/offline.
  useEffect(()=>{
    if(!viewingNote?.id)return;
    return subscribePoll("note:"+viewingNote.id,5000,async signal=>{
      if(checklistSavingLine!==null)return;
      const response=await fetch("/api/notes/"+encodeURIComponent(viewingNote.id),{credentials:"same-origin",cache:"no-store",signal});
      if(!response.ok)throw new Error("Unable to refresh this note.");
      const result=await response.json() as {note?:Note};
      if(!result.note||result.note.id!==viewingNote.id)return;
      setViewingNote(current=>!current||current.id!==result.note!.id||current.version>=result.note!.version?current:result.note!);
      setNotes(current=>current.map(note=>note.id===result.note!.id&&note.version<result.note!.version?result.note!:note));
    });
  },[viewingNote?.id,checklistSavingLine]);

  useEffect(()=>{
    if(!composerOpen||!user||!activeWorkspaceId)return;
    try{localStorage.setItem(noteDraftStorageKey(user.id,editingNote?.workspaceId??activeWorkspaceId,editingNote?.id??null),JSON.stringify({title:draftTitle,content:draftContent,categoryId:selectedCategoryId||null,updatedAt:Date.now()}));}catch{/* local drafts are best-effort */}
  },[composerOpen,user,activeWorkspaceId,editingNote?.id,editingNote?.workspaceId,draftTitle,draftContent,selectedCategoryId]);

  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem("kitanotes-theme", theme); } catch { /* ignore */ } }, [theme]);
  useEffect(() => { setCategoryFilter("");if(activeWorkspaceId){try{localStorage.setItem("kitanotes-active-workspace",activeWorkspaceId);}catch{/* storage unavailable */}} }, [activeWorkspaceId]);

  useEffect(()=>{
    if(!user)return;
    let cursor:string|null=null;
    return subscribePoll("workspaces:"+user.id,60000,async signal=>{
      const response=await fetch("/api/workspaces"+(cursor?"?updatedSince="+encodeURIComponent(cursor):""),{credentials:"same-origin",cache:"no-store",signal});if(!response.ok)throw new Error("Unable to refresh workspaces.");
      const result=await response.json() as {workspaces:Workspace[];removedWorkspaceIds?:string[];starredWorkspaceId:string|null;nextCursor?:string};
      if(!cursor)setWorkspaces(result.workspaces);
      else setWorkspaces(current=>{const removed=new Set(result.removedWorkspaceIds??[]),byId=new Map(current.filter(item=>!removed.has(item.id)).map(item=>[item.id,item]));for(const item of result.workspaces)byId.set(item.id,item);return [...byId.values()];});
      setStarredWorkspaceId(result.starredWorkspaceId);cursor=result.nextCursor??new Date().toISOString();
      const available=cursor&&result.removedWorkspaceIds?.includes(activeWorkspaceId);
      if(available){const next=result.workspaces.find(item=>item.id===result.starredWorkspaceId)?.id??result.workspaces.find(item=>item.id===user.personalWorkspaceId)?.id??"";setNotes([]);setCategories([]);setActiveWorkspaceId(next);setCalendarRefresh(value=>value+1);pushToast("You no longer have access to a workspace. Your view has been switched.");}
    });
  },[user,activeWorkspaceId,pushToast]);

  useEffect(()=>{
    if(!user){setUnreadCount(0);setUnreadByWorkspace({});return;}
    return subscribePoll("notifications:unread:"+user.id,30000,async signal=>{
      const response=await fetch("/api/notifications?limit=1",{credentials:"same-origin",cache:"no-store",signal});if(!response.ok)throw new Error("Unable to refresh notification count.");
      const result=await response.json() as {unreadCount:number;unreadByWorkspace?:Record<string,number>};
      setUnreadCount(result.unreadCount);setUnreadByWorkspace(result.unreadByWorkspace??{});
    });
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
    if (!aiModalOpen && !workspaceModalOpen && !existingOrganizerOpen) return;
    if (aiStatus) return;
    let active = true;
    fetch("/api/ai/status",{credentials:"same-origin"})
      .then(async response=>{if(!response.ok)throw new Error("AI status unavailable");const result=await response.json() as AiStatus;if(active)setAiStatus(result);})
      .catch(()=>{if(active)setAiStatus(null);});
    return ()=>{active=false;};
  },[user,aiModalOpen,workspaceModalOpen,existingOrganizerOpen,aiStatus]);

  useEffect(() => {
    if (!inviteOpen || !activeWorkspaceId) return;
    let active = true;
    const owner = workspaces.find(item => item.id === activeWorkspaceId)?.role === "owner";
    setInvitationsLoading(true);
    const id = encodeURIComponent(activeWorkspaceId);
    Promise.all([
      fetch("/api/workspaces/" + id + "/members", { credentials: "same-origin" }),
      owner ? fetch("/api/invitations?workspaceId=" + id, { credentials: "same-origin" }) : Promise.resolve(null),
      fetch("/api/workspaces/" + id + "/activity?limit=50&type="+encodeURIComponent(activityTypeFilter)+"&actor="+encodeURIComponent(activityPersonFilter), { credentials: "same-origin" })
    ]).then(async ([memberResponse, inviteResponse, activityResponse]) => {
      if (!memberResponse.ok) throw new Error("Unable to load workspace members.");
      const memberResult = await memberResponse.json() as { members: WorkspaceMember[] };
      if (inviteResponse && !inviteResponse.ok) throw new Error("Unable to load invitations.");
      const inviteResult = inviteResponse ? await inviteResponse.json() as { invitations: Invitation[] } : { invitations: [] };
      const activityResult = activityResponse.ok ? await activityResponse.json() as { activity: ActivityItem[]; nextCursor?:string|null } : { activity: [],nextCursor:null };
      if (!active) return;
      setWorkspaceMembers(memberResult.members); setInvitations(inviteResult.invitations); setActivity(activityResult.activity);setActivityNextCursor(activityResult.nextCursor??null);
    }).catch(error => { if (active) setInviteCreateError(error instanceof Error ? error.message : "Unable to load sharing details."); })
      .finally(() => { if (active) setInvitationsLoading(false); });
    return () => { active = false; };
  }, [inviteOpen, activeWorkspaceId, inviteRefresh, workspaces, activityTypeFilter, activityPersonFilter]);

  useEffect(()=>{
    if(view!=="calendar"||!user)return;
    const range=()=>{
      const rangeStart=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1),rangeEnd=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);
      if(calendarMode==="week"){rangeStart.setDate(calendarCursor.getDate()-((calendarCursor.getDay()+6)%7));rangeEnd.setTime(rangeStart.getTime());rangeEnd.setDate(rangeStart.getDate()+7);}
      else{rangeStart.setDate(rangeStart.getDate()-((rangeStart.getDay()+6)%7));rangeEnd.setTime(rangeStart.getTime());rangeEnd.setDate(rangeStart.getDate()+42);}
      return{from:new Date(rangeStart.getTime()-86400000).toISOString(),to:new Date(rangeEnd.getTime()+86400000).toISOString()};
    };
    let cursor:string|null=null;
    setEventsLoading(true);setEventsError("");
    return subscribePoll("calendar:"+user.id+":"+calendarMode+":"+calendarCursor.getFullYear()+"-"+calendarCursor.getMonth()+"-"+calendarCursor.getDate(),30000,async signal=>{
      const {from,to}=range();
      const [response,reminderResponse]=await Promise.all([
        fetch("/api/events?from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to)+(cursor?"&updatedSince="+encodeURIComponent(cursor):""),{credentials:"same-origin",cache:"no-store",signal}),
        fetch("/api/reminders?limit=100",{credentials:"same-origin",cache:"no-store",signal})
      ]);
      if(!response.ok)throw new Error("Unable to load calendar events.");
      const result=await response.json() as {events:CalendarEvent[];removedEventIds?:string[];nextCursor?:string};
      if(!cursor)setEvents(result.events);else setEvents(current=>{const removed=new Set(result.removedEventIds??[]),byId=new Map(current.filter(item=>!removed.has(item.id)).map(item=>[item.id,item]));for(const item of result.events)byId.set(item.id,item);return [...byId.values()].sort((x,y)=>x.startsAt.localeCompare(y.startsAt));});
      cursor=result.nextCursor??new Date().toISOString();
      if(reminderResponse.ok){const reminderResult=await reminderResponse.json() as {reminders:Reminder[]};setEventReminders(reminderResult.reminders);}
      setEventsError("");setEventsLoading(false);
    });
  },[view,user,calendarMode,calendarCursor,calendarRefresh]);

  useEffect(()=>{
    if(!notificationsOpen||!user)return;
    let active=true;
    fetch("/api/notifications/workspaces",{credentials:"same-origin",cache:"no-store"}).then(async response=>{if(!response.ok)throw new Error("Unable to load workspace alert preferences.");const result=await response.json() as {workspaces:Array<{id:string;name:string;role:string;mode:"all"|"important"|"mute"}>};if(active)setWorkspaceNotificationPreferences(result.workspaces);}).catch(error=>{if(active)setNotificationError(error instanceof Error?error.message:"Unable to load workspace alert preferences.");});
    return()=>{active=false;};
  },[notificationsOpen,user]);

  useEffect(()=>{
    if(!notificationsOpen||!user)return;
    setNotificationsLoading(true);
    return subscribePoll("notifications:inbox:"+user.id,30000,async signal=>{
      const response=await fetch("/api/notifications?limit=50",{credentials:"same-origin",cache:"no-store",signal});if(!response.ok)throw new Error("Unable to load notifications.");
      const result=await response.json() as {notifications:Notification[];unreadCount:number;unreadByWorkspace?:Record<string,number>};
      setNotifications(result.notifications);setUnreadCount(result.unreadCount);setUnreadByWorkspace(result.unreadByWorkspace??{});setNotificationError("");setNotificationsLoading(false);
    });
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
    if(!user){setNotificationPrefs({pushEnabled:true,reminderPushEnabled:true,sharedNotePushEnabled:true,sharedNoteUpdatePushEnabled:true,eventPushEnabled:true,workspacePushEnabled:true,quietHoursStart:null,quietHoursEnd:null,timezone:"Asia/Kuala_Lumpur"});return;}
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

  async function saveWorkspaceNotificationPreference(workspaceId:string,mode:"all"|"important"|"mute"){
    setWorkspaceNotificationSaving(workspaceId);
    try{const response=await fetch("/api/notifications/workspaces/"+encodeURIComponent(workspaceId),{method:"PUT",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({mode})});if(!response.ok)throw new Error("Unable to save workspace notification preference.");setWorkspaceNotificationPreferences(current=>current.map(item=>item.id===workspaceId?{...item,mode}:item));}
    catch(error){setNotificationError(error instanceof Error?error.message:"Unable to save workspace notification preference.");}
    finally{setWorkspaceNotificationSaving(null);}
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

  const sortedNotes = useMemo(() => [...notes].sort((a, b) =>
    sortMode === "title" ? a.title.localeCompare(b.title)
      : sortMode === "oldest" ? a.updatedAt.localeCompare(b.updatedAt)
        : b.updatedAt.localeCompare(a.updatedAt)
  ), [notes, sortMode]);

  const visibleNotes = useMemo(() => {
    const value = query.trim().toLowerCase();
    return sortedNotes.filter(note => (!categoryFilter || (categoryFilter === "__none" ? !note.categoryId : note.categoryId === categoryFilter))
      && (!value || (note.title + " " + note.content + " " + (note.categoryName ?? "")).toLowerCase().includes(value)));
  }, [sortedNotes, query, categoryFilter]);
  const displayNotes=globalSearchActive?globalSearchResults:visibleNotes;
  const sharedWorkspaces = useMemo(() => workspaces.filter(item => item.visibility === "shared"), [workspaces]);
  const activeWorkspace = workspaces.find(item => item.id === activeWorkspaceId);
  const canWrite = activeWorkspace ? activeWorkspace.role !== "viewer" : true;

  function openGlobalNote(note:Note){setActiveWorkspaceId(note.workspaceId);setShowArchived(false);setShowTrash(false);setViewingNote(note);setNotes(current=>current.some(item=>item.id===note.id)?current:[note,...current]);}

  function startNewNote() {
    setEditingNote(null);
    setDraftTitle("");setDraftContent("");setSelectedCategoryId("");
    if(user&&activeWorkspaceId){try{const raw=localStorage.getItem(noteDraftStorageKey(user.id,activeWorkspaceId,null));if(raw){const draft=JSON.parse(raw) as {title?:string;content?:string;categoryId?:string|null;updatedAt?:number};if(Date.now()-(draft.updatedAt??0)<7*24*60*60*1000){setDraftTitle(draft.title??"");setDraftContent(draft.content??"");setSelectedCategoryId(draft.categoryId??"");pushToast("Recovered your unsaved note draft.");}}}catch{/* ignore invalid or unavailable local draft */}}
    setComposerOpen(true);
  }

  const startEditNote = useCallback((note: Note) => {
    setEditingNote(note);setDraftTitle(note.title);setDraftContent(note.content);setSelectedCategoryId(note.categoryId??"");
    if(user){try{const raw=localStorage.getItem(noteDraftStorageKey(user.id,note.workspaceId,note.id));if(raw){const draft=JSON.parse(raw) as {title?:string;content?:string;categoryId?:string|null;updatedAt?:number};if(Date.now()-(draft.updatedAt??0)<7*24*60*60*1000){setDraftTitle(draft.title??note.title);setDraftContent(draft.content??note.content);setSelectedCategoryId(draft.categoryId??note.categoryId??"");pushToast("Recovered your unsaved changes.");}}}catch{/* ignore local draft errors */}}
    setComposerOpen(true);
  }, [user,pushToast]);

  async function enableNoteChecklist() {
    if (!viewingNote || !canWrite || checklistSavingLine !== null) return;
    const lines = viewingNote.content.split("\n");
    let converted = 0;
    const checklistContent = lines.map(line => {
      if (/^\s*-\s+\[[ xX]\]\s+/.test(line)) return line;
      const match = line.match(/^(\s*)-\s+(.*)$/);
      if (!match || !match[2].trim()) return line;
      converted++;
      return match[1] + "- [ ] " + match[2];
    }).join("\n");
    if (!converted) return;
    setChecklistSavingLine(-1);
    try {
      const response = await fetch("/api/notes/" + encodeURIComponent(viewingNote.id), {
        method: "PATCH", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: viewingNote.version, content: checklistContent })
      });
      const result = await response.json() as { note?: Note; error?: string };
      if (!response.ok || !result.note) throw new Error(result.error === "VERSION_CONFLICT" ? "Nota ini telah berubah di tempat lain. Refresh dan cuba lagi." : "Tak dapat aktifkan checklist.");
      setViewingNote(result.note);
      setNotes(current => current.map(note => note.id === result.note!.id ? result.note! : note));
      pushToast("Checklist diaktifkan");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Tak dapat aktifkan checklist.", "error");
    } finally {
      setChecklistSavingLine(null);
    }
  }

  async function toggleNoteChecklistItem(lineIndex: number) {
    if (!viewingNote || !canWrite || checklistSavingLine !== null) return;
    const lines = viewingNote.content.split("\n");
    const line = lines[lineIndex] ?? "";
    const match = line.match(/^(\s*)-\s+(?:\[([ xX])\]\s*)?(.*)$/);
    if (!match) return;
    const checked = (match[2] ?? "").toLowerCase() === "x";
    lines[lineIndex] = match[1] + "- [" + (checked ? " " : "x") + "] " + match[3];
    setChecklistSavingLine(lineIndex);
    try {
      const response = await fetch("/api/notes/" + encodeURIComponent(viewingNote.id), {
        method: "PATCH", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: viewingNote.version, content: lines.join("\n") })
      });
      const result = await response.json() as { note?: Note; error?: string };
      if (!response.ok || !result.note) {
        throw new Error(result.error === "VERSION_CONFLICT" ? "Nota ini telah berubah di tempat lain. Refresh dan cuba lagi." : "Tak dapat kemas kini checklist.");
      }
      setViewingNote(result.note);
      setNotes(current => current.map(note => note.id === result.note!.id ? result.note! : note));
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Tak dapat kemas kini checklist.", "error");
    } finally {
      setChecklistSavingLine(null);
    }
  }

  function useLatestNoteConflict(){if(!noteConflict)return;setDraftTitle(noteConflict.latest.title);setDraftContent(noteConflict.latest.content);setSelectedCategoryId(noteConflict.latest.categoryId??"");setEditingNote(noteConflict.latest);setNoteConflict(null);}
  async function keepMineAfterConflict(){
    if(!noteConflict||saving)return;const conflict=noteConflict;setSaving(true);
    try{const response=await fetch("/api/notes/"+encodeURIComponent(conflict.latest.id),{method:"PATCH",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({...conflict.mine,version:conflict.latest.version})});const result=await response.json() as {note?:Note;latestNote?:Note};
      if(response.status===409&&result.latestNote){setNoteConflict({...conflict,latest:result.latestNote});return;}
      if(!response.ok||!result.note)throw new Error("Unable to save your version of this note.");
      setNotes(current=>current.map(item=>item.id===result.note!.id?result.note!:item));setViewingNote(current=>current?.id===result.note!.id?result.note!:current);setEditingNote(null);setComposerOpen(false);setNoteConflict(null);pushToast("Your version was saved.");
    }catch(error){setNotesError(error instanceof Error?error.message:"Unable to resolve this conflict.");}finally{setSaving(false);}
  }
  async function copyMineAndUseLatest(){if(!noteConflict)return;try{await navigator.clipboard.writeText(noteConflict.mine.content);pushToast("Your unsaved text was copied.");}catch{pushToast("Clipboard unavailable. Copy your text before choosing Use theirs.","error");return;}useLatestNoteConflict();}

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
      const result = await response.json() as { note?: Note; error?: string; latestNote?:Note };
      if(response.status===409&&result.latestNote){setNoteConflict({latest:result.latestNote,mine:{title:draftTitle,content:draftContent,categoryId:selectedCategoryId||null}});return;}
      if (!response.ok || !result.note) throw new Error(result.error === "VERSION_CONFLICT" ? "This note changed elsewhere. Refresh and try again." : "Unable to save this note.");
      setNotes(current => editingNote
        ? current.map(note => note.id === result.note!.id ? result.note! : note)
        : [result.note!, ...current]);
      try{localStorage.removeItem(noteDraftStorageKey(user!.id,editingNote?.workspaceId??activeWorkspaceId,editingNote?.id??null));}catch{/* ignore storage errors */}
      setComposerOpen(false);
      setEditingNote(null);
      pushToast(editingNote ? "Note updated" : "Note saved");
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : "Unable to save this note.");
    } finally {
      setSaving(false);
    }
  }

  const archiveNote = useCallback(async (note: Note, archived = true) => {
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
  }, [pushToast]);

  const restoreNote = useCallback((note: Note) => archiveNote(note, false), [archiveNote]);
  const restoreFromTrash=useCallback(async(note:Note)=>{try{const response=await fetch("/api/notes/"+encodeURIComponent(note.id)+"/restore",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:"{}"});const result=await response.json() as {note?:Note;error?:string};if(!response.ok||!result.note)throw new Error(result.error==="TRASH_RETENTION_EXPIRED"?"This note has passed the 30-day recovery period.":"Unable to restore this note.");setNotes(current=>current.filter(item=>item.id!==note.id));pushToast("Note restored from Trash");}catch(error){pushToast(error instanceof Error?error.message:"Unable to restore this note.","error");}},[pushToast]);

  const deleteNote = useCallback(async (note: Note) => {
    if (!window.confirm("Move \"" + note.title + "\" to Trash? You can restore it for 30 days before permanent deletion.")) return;
    try {
      const response = await fetch("/api/notes/" + encodeURIComponent(note.id), {
        method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: note.version })
      });
      if (!response.ok) throw new Error("Unable to delete this note.");
      setNotes(current => current.filter(item => item.id !== note.id));
      pushToast("Note moved to Trash. Restore it within 30 days.");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Unable to delete this note.", "error");
    }
  }, [pushToast]);

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


  function openExistingOrganizer(){
    setExistingOrganizerError("");setExistingOrganizerProposals([]);
    setSelectedOrganizerNoteIds(notes.slice(0,30).map(note=>note.id));
    setExistingOrganizerOpen(true);
  }

  async function suggestExistingNoteCategories(){
    if(existingOrganizerBusy||!activeWorkspaceId||selectedOrganizerNoteIds.length===0||selectedOrganizerNoteIds.length>30)return;
    setExistingOrganizerBusy(true);setExistingOrganizerError("");setExistingOrganizerProposals([]);
    try{
      const response=await fetch("/api/ai/organize-existing",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId:activeWorkspaceId,noteIds:selectedOrganizerNoteIds})});
      const result=await response.json() as {assignments?:Array<{noteId:string;categoryName:string;reason:string}>;error?:string;usage?:{dailyLimit:number;dailyUsed:number;dailyRemaining:number}};
      if(!response.ok||!result.assignments){
        const message=result.error==="AI_DAILY_FREE_LIMIT_REACHED"||result.error==="AI_FREE_QUOTA_EXHAUSTED"?"The AI daily limit has been reached. Try again after it resets."
          :result.error==="AI_NOT_CONFIGURED"?"AI is not configured yet."
          :result.error==="NOTE_SELECTION_TOO_LARGE"?"Choose fewer or shorter notes for this run."
          :result.error==="NOTES_NOT_FOUND_OR_UNAVAILABLE"?"Some selected notes are no longer available. Refresh and try again."
          :result.error==="AI_INVALID_MODEL_RESPONSE"?"The AI returned an incomplete category plan. Please retry."
          :"Unable to organise these notes right now.";
        throw new Error(message);
      }
      setExistingOrganizerProposals(result.assignments.map(item=>({...item,selected:true})));
      if(result.usage&&aiStatus)setAiStatus({...aiStatus,dailyUsed:result.usage.dailyUsed,dailyRemaining:result.usage.dailyRemaining});
    }catch(error){setExistingOrganizerError(error instanceof Error?error.message:"Unable to organise existing notes.");}
    finally{setExistingOrganizerBusy(false);}
  }

  async function applyExistingNoteCategories(){
    if(existingOrganizerBusy||!activeWorkspaceId)return;
    const pending=existingOrganizerProposals.filter(item=>item.selected&&!item.applied);
    if(!pending.length)return;
    setExistingOrganizerBusy(true);setExistingOrganizerError("");
    try{
      let available=categories.slice();
      const categoryIds=new Map(available.map(category=>[category.name.toLowerCase(),category.id]));
      for(const proposal of pending){
        let categoryId=categoryIds.get(proposal.categoryName.toLowerCase());
        if(!categoryId){
          const created=await fetch("/api/categories",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId:activeWorkspaceId,name:proposal.categoryName,color:"#766bd0",sortOrder:available.length})});
          const payload=await created.json() as {category?:Category};
          if(created.status===409){
            const refreshed=await fetch("/api/categories?workspaceId="+encodeURIComponent(activeWorkspaceId),{credentials:"same-origin"});
            const list=await refreshed.json() as {categories:Category[]};
            available=list.categories;
            const match=available.find(item=>item.name.toLowerCase()===proposal.categoryName.toLowerCase());
            if(!match)throw new Error("Could not find the category "+proposal.categoryName+".");
            categoryId=match.id;
          }else if(!created.ok||!payload.category)throw new Error("Could not create category "+proposal.categoryName+".");
          else{available=[...available,payload.category];categoryId=payload.category.id;}
          if(!categoryId)throw new Error("Could not resolve category "+proposal.categoryName+".");
          categoryIds.set(proposal.categoryName.toLowerCase(),categoryId);
        }
        const note=notes.find(item=>item.id===proposal.noteId);
        if(!note)throw new Error("A selected note is no longer loaded. Refresh notes and retry.");
        const updated=await fetch("/api/notes/"+encodeURIComponent(note.id),{method:"PATCH",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({title:note.title,content:note.content,categoryId,version:note.version})});
        const result=await updated.json() as {note?:Note};
        if(!updated.ok||!result.note)throw new Error("Could not update “"+note.title+"”. It may have changed elsewhere. Refresh and retry.");
        setNotes(current=>current.map(item=>item.id===result.note!.id?result.note!:item));
        setExistingOrganizerProposals(current=>current.map(item=>item.noteId===proposal.noteId?{...item,applied:true}:item));
      }
      setCategories(available);
      if(existingOrganizerProposals.filter(item=>item.selected).every(item=>item.applied||pending.some(p=>p.noteId===item.noteId))) {
        setExistingOrganizerOpen(false);pushToast("Existing notes organised into categories");
      }
    }catch(error){setExistingOrganizerError(error instanceof Error?error.message:"Unable to apply category changes.");}
    finally{setExistingOrganizerBusy(false);}
  }

  async function scanImageWithAi() {
    if(!ocrFile||ocrWorking)return;
    setOcrWorking(true);setAiError("");setAiInput("");
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
      if(!result.text.trim())throw new Error("No clear, meaningful text was found in this image. Try a sharper photo with the text fully visible.");
      setAiInput(result.text);
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
      let availableCategories=categories;
      const categoryResponse=await fetch("/api/categories?workspaceId="+encodeURIComponent(activeWorkspaceId),{credentials:"same-origin"});
      if(categoryResponse.ok){const categoryResult=await categoryResponse.json() as {categories:Category[]};availableCategories=categoryResult.categories;setCategories(availableCategories);}
      setAiDraft(result.draft);setAiDraftTitle(result.draft.note.title);setAiDraftContent(result.draft.note.content);
      const recommendation=result.draft.categorySuggestion;
      const existingCategory=recommendation?availableCategories.find(category=>category.name.toLowerCase()===recommendation.name.toLowerCase()):undefined;
      setSelectedCategoryId(existingCategory?.id??(recommendation?.createNew?"__ai_new_category__":""));
      if(result.usage&&aiStatus)setAiStatus({...aiStatus,dailyUsed:result.usage.dailyUsed,dailyRemaining:result.usage.dailyRemaining});
    }catch(error){setAiError(error instanceof Error?error.message:"Unable to organise this text.");}
    finally{setAiWorking(false);}
  }

  async function saveAiNote() {
    if(!aiDraft||!activeWorkspaceId||aiSavingNote)return;
    let savedNoteId=aiSavedNoteId;
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
        savedNoteId=result.note!.id;setNotes(current=>[result.note!,...current]);setAiSavedNoteId(savedNoteId);setAiNoteSaved(true);
      }
      const hasCalendarItems=Boolean(aiDraft.events.length||aiDraft.reminders.length||aiDraft.tasks.some(task=>task.dueLocal));
      if(hasCalendarItems&&!aiItemsCreated){
        const itemsSaved=await createAiItems(savedNoteId);
        if(!itemsSaved)return;
      }
      setAiModalOpen(false);setAiDraft(null);setAiInput("");setOcrFile(null);setAiInput("");
      pushToast(hasCalendarItems?"Note and calendar items saved":"Note saved");
    }catch(error){setAiError(error instanceof Error?error.message:"Unable to save this note.");}
    finally{setAiSavingNote(false);}
  }

  async function createAiItems(linkedNoteId:string|null=aiSavedNoteId):Promise<boolean> {
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
            startsAt:zonedDateTimeToIso(event.startLocal,event.timezone),endsAt:zonedDateTimeToIso(event.endLocal,event.timezone),timezone:event.timezone,
            linkedNoteId
          })});
          const result=await response.json() as {event?:CalendarEvent};
          if(!response.ok||!result.event)throw new Error("Unable to create event: "+event.title);
          eventId=result.event.id;setAiCreatedEventIds(current=>({...current,[index]:result.event!.id}));completed.add(eventKey);setEvents(current=>[...current,result.event!].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)));setAiCreatedItems([...completed]);
        }else{
          eventId=aiCreatedEventIds[index]??events.find(item=>item.title===event.title&&item.startsAt===zonedDateTimeToIso(event.startLocal,event.timezone))?.id;
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
    setEditingEvent(null);setEditingEventReminder(null);
    setEventTitle("");
    setEventDescription("");
    const start=dateTimeInputFor(new Date(Date.now()+25*3600000).toISOString(),eventTimezone);
    setEventStart(start);
    setEventEnd(dateTimeInputFor(new Date(Date.now()+26*3600000).toISOString(),eventTimezone));
    setEventReminderAt(defaultReminderDateTime(start,eventTimezone));
    setEventReminderAuto(true);
    setEventLinkedNoteId("");
    const writable=workspaces.filter(item=>item.role==="owner"||item.role==="editor");
    const target=writable.some(item=>item.id===activeWorkspaceId)?activeWorkspaceId:(writable[0]?.id??"");
    setEventWorkspaceId(target);
    setEventWorkspaceNotes(target===activeWorkspaceId?notes:[]);
    if(target&&target!==activeWorkspaceId){void fetch("/api/notes?limit=100&workspaceId="+encodeURIComponent(target),{credentials:"same-origin"}).then(async response=>{if(!response.ok)throw new Error("Unable to load notes for this workspace.");const result=await response.json() as {notes:Note[]};setEventWorkspaceNotes(result.notes);}).catch(()=>setEventWorkspaceNotes([]));}
    setEventsError("");
    setEventComposerOpen(true);
  }

  function startEditEvent(item:CalendarEvent) {
    setEditingEvent(item);setEventWorkspaceId(item.workspaceId);setEventWorkspaceNotes(item.workspaceId===activeWorkspaceId?notes:[]);if(item.workspaceId!==activeWorkspaceId){void fetch("/api/notes?limit=100&workspaceId="+encodeURIComponent(item.workspaceId),{credentials:"same-origin"}).then(async response=>{if(!response.ok)throw new Error("Unable to load linked notes.");const result=await response.json() as {notes:Note[]};setEventWorkspaceNotes(result.notes);}).catch(()=>setEventWorkspaceNotes([]));}setEventTitle(item.title);setEventDescription(item.description??"");setEventTimezone(item.timezone);
    setEventStart(dateTimeInputFor(item.startsAt,item.timezone));setEventEnd(dateTimeInputFor(item.endsAt,item.timezone));
    const reminder=eventReminders.filter(value=>value.eventId===item.id).sort((a,b)=>b.dueAt.localeCompare(a.dueAt))[0]??null;
    setEditingEventReminder(reminder);setEventReminderAt(reminder&&reminder.status==="pending"?dateTimeInputFor(reminder.dueAt,reminder.timezone):"");setEventReminderAuto(false);setEventLinkedNoteId(item.linkedNoteId??"");setEventsError("");setEventComposerOpen(true);
  }

  async function saveEvent() {
    if(!(workspaces.some(item=>item.id===eventWorkspaceId&&(item.role==="owner"||item.role==="editor")))||!eventTitle.trim()||eventSaving)return;
    setEventSaving(true);setEventsError("");
    try {
      const payload={title:eventTitle,description:eventDescription,startsAt:zonedDateTimeToIso(eventStart,eventTimezone),endsAt:zonedDateTimeToIso(eventEnd,eventTimezone),timezone:eventTimezone,linkedNoteId:eventLinkedNoteId||null};
      const response=await fetch(editingEvent?"/api/events/"+encodeURIComponent(editingEvent.id):"/api/events",{method:editingEvent?"PATCH":"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(editingEvent?{...payload,version:editingEvent.version}:{...payload,workspaceId:eventWorkspaceId})});
      const result=await response.json() as {event?:CalendarEvent};
      if(!response.ok||!result.event)throw new Error(response.status===409?"This event changed elsewhere. Close and reopen it before saving.":"Unable to save this event.");
      setEvents(current=>editingEvent?current.map(item=>item.id===result.event!.id?result.event!:item).sort((a,b)=>a.startsAt.localeCompare(b.startsAt)):[...current,result.event!].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)));
      if(editingEventReminder?.status==="pending"){
        if(eventReminderAt){
          const reminderResponse=await fetch("/api/reminders/"+encodeURIComponent(editingEventReminder.id),{method:"PATCH",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({title:eventTitle,dueAt:zonedDateTimeToIso(eventReminderAt,eventTimezone),timezone:eventTimezone})});
          if(!reminderResponse.ok)throw new Error("Event saved, but its reminder could not be updated. Reopen the event and try again.");
        }else{
          const reminderResponse=await fetch("/api/reminders/"+encodeURIComponent(editingEventReminder.id),{method:"DELETE",credentials:"same-origin",headers:{"content-type":"application/json"},body:"{}"});
          if(!reminderResponse.ok)throw new Error("Event saved, but its reminder could not be removed. Reopen the event and try again.");
        }
      }else if(eventReminderAt){
        const reminderResponse=await fetch("/api/reminders",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
          workspaceId:eventWorkspaceId,eventId:result.event.id,title:eventTitle,dueAt:zonedDateTimeToIso(eventReminderAt,eventTimezone),timezone:eventTimezone
        })});
        if(!reminderResponse.ok)throw new Error("Event saved, but its reminder could not be created.");
      }
      setEventComposerOpen(false);setEditingEvent(null);setEditingEventReminder(null);setCalendarRefresh(value=>value+1);
    }catch(error){setEventsError(error instanceof Error?error.message:"Unable to save this event.");}
    finally{setEventSaving(false);}
  }

  const calendarDays=useMemo(()=>{const start=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1);if(calendarMode==="week")start.setDate(calendarCursor.getDate()-((calendarCursor.getDay()+6)%7));else start.setDate(start.getDate()-((start.getDay()+6)%7));return Array.from({length:calendarMode==="week"?7:42},(_,i)=>{const day=new Date(start);day.setDate(start.getDate()+i);return day;});},[calendarCursor,calendarMode]);
  useEffect(()=>{
    if(!user)return;let active=true;
    fetch("/api/calendar/preferences",{credentials:"same-origin"}).then(async response=>{if(!response.ok)return;const result=await response.json() as {holidayState:string};if(active&&result.holidayState)setHolidayState(result.holidayState);}).catch(()=>{});
    return()=>{active=false;};
  },[user]);
  useEffect(()=>{
    if(view!=="calendar"||!user)return;let active=true;
    const start=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1);start.setDate(start.getDate()-((start.getDay()+6)%7)-2);const end=new Date(start);end.setDate(end.getDate()+46);
    fetch("/api/calendar/holidays?state="+encodeURIComponent(holidayState)+"&from="+dateKey(start)+"&to="+dateKey(end),{credentials:"same-origin"})
      .then(async response=>{if(!response.ok)throw new Error("Holiday calendar unavailable");const result=await response.json() as {events:CalendarItem[];sources?:{holidayWise:boolean;kpm:boolean;publicHolidayCount:number;schoolHolidayCount:number;holidayWiseError:string|null}};if(active){setHolidays(result.events??[]);setHolidayFeedStatus(result.sources??null);}})
      .catch(()=>{if(active){setHolidays([]);setHolidayFeedStatus({holidayWise:false,kpm:false,publicHolidayCount:0,schoolHolidayCount:0,holidayWiseError:"Unable to load holiday data"});}});
    return()=>{active=false;};
  },[view,user,holidayState,calendarMode,calendarCursor,calendarRefresh]);
  const calendarHeading=calendarMode==="week"?calendarDays[0].toLocaleDateString(undefined,{month:"short",day:"numeric"})+" – "+calendarDays[6].toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):calendarCursor.toLocaleDateString(undefined,{month:"long",year:"numeric"});
  function moveCalendar(amount:number){setCalendarCursor(current=>{const next=new Date(current);if(calendarMode==="week")next.setDate(next.getDate()+amount*7);else next.setMonth(next.getMonth()+amount);return next;});}
  const calendarAgendaItems=useMemo<CalendarItem[]>(()=>[...events.filter(item=>new Date(item.endsAt)>=new Date(calendarDays[0].getTime()-86400000)&&new Date(item.startsAt)<new Date(calendarDays[calendarDays.length-1].getTime()+2*86400000)),...holidays.filter(item=>new Date(item.endsAt)>=new Date(calendarDays[0].getTime()-86400000)&&new Date(item.startsAt)<new Date(calendarDays[calendarDays.length-1].getTime()+2*86400000))].sort((left,right)=>left.startsAt.localeCompare(right.startsAt)) as CalendarItem[],[events,holidays,calendarDays]);

  async function importCalendarIcs(file:File){
    if(!activeWorkspaceId||calendarTransferBusy)return;setCalendarTransferBusy(true);
    try{const ics=await file.text();const response=await fetch("/api/calendar/ics/import",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId:activeWorkspaceId,ics})});const result=await response.json() as {error?:string;imported?:number;updated?:number;skipped?:number};if(!response.ok)throw new Error(result.error==="NO_SUPPORTED_EVENTS"?"No supported calendar events were found in this file.":result.error==="INVALID_ICS_FILE"?"This does not look like a valid .ics calendar file.":"Unable to import this calendar.");setCalendarRefresh(value=>value+1);pushToast("Imported "+(result.imported??0)+", updated "+(result.updated??0)+" events. "+(result.skipped??0)+" unchanged.");}
    catch(error){setEventsError(error instanceof Error?error.message:"Unable to import calendar.");}
    finally{setCalendarTransferBusy(false);if(calendarIcsInputRef.current)calendarIcsInputRef.current.value="";}
  }
  async function exportCalendarIcs(){
    if(!activeWorkspaceId||calendarTransferBusy)return;setCalendarTransferBusy(true);
    try{const response=await fetch("/api/calendar/ics/export?workspaceId="+encodeURIComponent(activeWorkspaceId),{credentials:"same-origin"});if(!response.ok)throw new Error("Unable to export this calendar.");const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="kitanotes-calendar.ics";document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);pushToast("Calendar exported as an .ics file.");}
    catch(error){setEventsError(error instanceof Error?error.message:"Unable to export calendar.");}
    finally{setCalendarTransferBusy(false);}
  }
  async function saveHolidayState(value:string){
    setHolidayState(value);
    try{const response=await fetch("/api/calendar/preferences",{method:"PUT",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({holidayState:value})});if(!response.ok)throw new Error("Unable to save holiday region.");setCalendarRefresh(v=>v+1);}
    catch(error){setEventsError(error instanceof Error?error.message:"Unable to save holiday region.");}
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
    const workspaceId=notification.workspaceId??(notification.resourceType==="workspace"?notification.resourceId:null);
    if(workspaceId&&workspaces.some(item=>item.id===workspaceId))setActiveWorkspaceId(workspaceId);
    if(notification.resourceType==="note"&&notification.resourceId){
      setShowArchived(false);setShowTrash(false);setView("notes");
      void fetch("/api/notes/"+encodeURIComponent(notification.resourceId),{credentials:"same-origin",cache:"no-store"}).then(async response=>{if(!response.ok)throw new Error("This note is no longer available.");const result=await response.json() as {note:Note};setViewingNote(result.note);}).catch(()=>pushToast("This note is no longer available in this workspace.","error"));
    }else if(notification.resourceType==="event"&&notification.resourceId){
      setView("calendar");
      void fetch("/api/events/"+encodeURIComponent(notification.resourceId),{credentials:"same-origin",cache:"no-store"}).then(async response=>{if(!response.ok)throw new Error("This event is no longer available.");const result=await response.json() as {event:CalendarEvent};setCalendarCursor(new Date(result.event.startsAt));setCalendarFocusDate(result.event.startsAt.slice(0,10));}).catch(()=>pushToast("This event is no longer available in this workspace.","error"));
    }else if(notification.type==="reminder")setView("calendar");
    else if(notification.type==="shared_note")setView("notes");
    void markNotificationRead(notification);setNotificationsOpen(false);
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
    const memberCount=workspaceMembers.filter(member=>member.role!=="owner").length;
    const pendingCount=invitations.filter(invitation=>invitation.status==="pending").length;
    const expectedName=activeWorkspace?.name??"";
    const typed=window.prompt("Make this workspace private? "+memberCount+" members will lose access and "+pendingCount+" pending invitations will be revoked. Notes, events and reminders will be kept. Members will not regain access automatically.\n\nType the workspace name to continue:", "");
    if(typed!==expectedName)return;
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
    const result = await response.json() as { workspaces: Workspace[]; starredWorkspaceId: string|null };
    setWorkspaces(result.workspaces);
    setStarredWorkspaceId(result.starredWorkspaceId);
    setActiveWorkspaceId(current => preferId && result.workspaces.some(item => item.id === preferId) ? preferId : (result.workspaces.some(item => item.id === current) ? current : (result.workspaces.find(item => item.id === result.starredWorkspaceId)?.id ?? result.workspaces.find(item => item.id === user?.personalWorkspaceId)?.id ?? result.workspaces[0]?.id ?? "")));
  }

  async function toggleWorkspaceStar() {
    if(!user||!activeWorkspaceId||starredWorkspaceSaving)return;
    const nextWorkspaceId=starredWorkspaceId===activeWorkspaceId?null:activeWorkspaceId;
    setStarredWorkspaceSaving(true);
    try{
      const response=await fetch("/api/workspaces/star",{method:"PUT",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({workspaceId:nextWorkspaceId})});
      const result=await response.json() as {starredWorkspaceId?:string|null;error?:string};
      if(!response.ok||!("starredWorkspaceId" in result))throw new Error("Unable to update the default workspace.");
      setStarredWorkspaceId(result.starredWorkspaceId??null);
      pushToast(nextWorkspaceId?"This workspace will open first next time.":"Default workspace cleared.");
    }catch(error){pushToast(error instanceof Error?error.message:"Unable to update the default workspace.","error");}
    finally{setStarredWorkspaceSaving(false);}
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

  useEffect(()=>{
    if(!inviteOpen||manageTab!=="activity"||!activeWorkspaceId)return;
    return subscribePoll("activity:"+activeWorkspaceId+":"+activityTypeFilter+":"+activityPersonFilter,15000,async signal=>{
      const url="/api/workspaces/"+encodeURIComponent(activeWorkspaceId)+"/activity?limit=50&type="+encodeURIComponent(activityTypeFilter)+"&actor="+encodeURIComponent(activityPersonFilter);
      const response=await fetch(url,{credentials:"same-origin",cache:"no-store",signal});if(!response.ok)throw new Error("Unable to refresh activity.");
      const result=await response.json() as {activity:ActivityItem[];nextCursor?:string|null};setActivity(result.activity);setActivityNextCursor(result.nextCursor??null);
    });
  },[inviteOpen,manageTab,activeWorkspaceId,activityTypeFilter,activityPersonFilter]);

  async function loadMoreActivity(){
    if(!activeWorkspaceId||!activityNextCursor||activityLoadingMore)return;
    setActivityLoadingMore(true);
    try{const url="/api/workspaces/"+encodeURIComponent(activeWorkspaceId)+"/activity?limit=50&type="+encodeURIComponent(activityTypeFilter)+"&actor="+encodeURIComponent(activityPersonFilter)+"&before="+encodeURIComponent(activityNextCursor);
      const response=await fetch(url,{credentials:"same-origin"});if(!response.ok)throw new Error("Unable to load more activity.");
      const result=await response.json() as {activity:ActivityItem[];nextCursor?:string|null};
      setActivity(current=>[...current,...result.activity.filter(item=>!current.some(existing=>existing.id===item.id))]);setActivityNextCursor(result.nextCursor??null);
    }catch(error){setInviteCreateError(error instanceof Error?error.message:"Unable to load more activity.");}
    finally{setActivityLoadingMore(false);}
  }

  function describeActivity(item: ActivityItem): string {
    const role = typeof item.metadata.role === "string" ? item.metadata.role : "";
    switch (item.type) {
      case "invitation.created": return item.actor + " invited " + (item.target ?? "someone") + (role ? " as " + role : "");
      case "invitation.revoked": return item.actor + " revoked an invitation";
      case "note.created": return item.actor + " created the note " + (item.target ? "“"+item.target+"”" : "");
      case "note.updated": return item.actor + " updated the note " + (item.target ? "“"+item.target+"”" : "");
      case "note.deleted": return item.actor + " deleted a note";
      case "event.created": return item.actor + " created the event " + (item.target ? "“"+item.target+"”" : "");
      case "event.updated": return item.actor + " updated the event " + (item.target ? "“"+item.target+"”" : "");
      case "event.deleted": return item.actor + " deleted an event";
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
    const confirmation=window.prompt("Leaving "+activeWorkspace.name+" removes access to its notes, events and reminders. Its events will disappear from your calendar. Your own workspace is unaffected. Type the workspace name to continue:", "");
    if(confirmation!==activeWorkspace.name)return;
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
    let summary:{notes:number;events:number;members:number;pendingInvitations:number}={notes:notes.filter(note=>note.workspaceId===activeWorkspace.id).length,events:events.filter(event=>event.workspaceId===activeWorkspace.id).length,members:workspaceMembers.length,pendingInvitations:invitations.filter(item=>item.status==="pending").length};
    try{const response=await fetch("/api/workspaces/"+encodeURIComponent(activeWorkspace.id)+"/summary",{credentials:"same-origin"});if(response.ok){const result=await response.json() as typeof summary;summary=result;}}catch{/* show best available counts */}
    const confirmation=window.prompt("Permanently delete "+activeWorkspace.name+"? This permanently deletes "+summary.notes+" notes, "+summary.events+" events, "+summary.members+" members and "+summary.pendingInvitations+" pending invitations. Export anything you need first. This cannot be undone.\n\nType the workspace name to continue:", "");
    if(confirmation!==activeWorkspace.name)return;
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

  async function createPasskeyAccount(event?:React.FormEvent) {
    event?.preventDefault();
    if(passkeyBusy)return;
    setPasskeyBusy(true);setAuthDialogError("");
    try {
      const optionsResponse=await fetch("/api/auth/passkeys/signup/options",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({displayName:signupName.trim(),email:signupEmail.trim()})});
      const options=await optionsResponse.json() as any;
      if(!optionsResponse.ok)throw new Error(options.error==="ACCOUNT_ALREADY_EXISTS"?"An account with this email already exists. Sign in with Google, then add a passkey.":options.error==="INVALID_SIGNUP_DETAILS"?"Enter your name and a valid email address.":"Unable to start passkey signup.");
      const credential=await startRegistration({optionsJSON:options});
      const verifyResponse=await fetch("/api/auth/passkeys/signup/verify",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({challenge:options.challenge,response:credential})});
      const result=await verifyResponse.json() as {verified?:boolean;recoveryCodes?:string[];user?:SessionUser;error?:string};
      if(!verifyResponse.ok||!result.verified||!result.user||!result.recoveryCodes?.length)throw new Error(result.error==="ACCOUNT_ALREADY_EXISTS"?"An account with this email already exists. Sign in with Google first.":"Passkey account could not be created. Please try again.");
      setUser({...result.user,personalWorkspaceId:null,googleLinked:false});setAuthStatus("ready");
      setRecoveryCodes(result.recoveryCodes);setAuthDialog("codes");setSignupName("");setSignupEmail("");
    } catch(error) { setAuthDialogError(error instanceof Error?error.message:"Unable to create a passkey account."); }
    finally {setPasskeyBusy(false);}
  }

  async function signInWithRecoveryCode(event?:React.FormEvent) {
    event?.preventDefault();
    if(passkeyBusy)return;
    setPasskeyBusy(true);setAuthDialogError("");
    try {
      const response=await fetch("/api/auth/passkeys/recovery/verify",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({code:recoveryCode})});
      if(!response.ok)throw new Error("That recovery code is invalid or has already been used.");
      const returnTo=inviteToken?"/invite/accept?token="+encodeURIComponent(inviteToken):"/";
      window.location.assign(returnTo);
    } catch(error) { setAuthDialogError(error instanceof Error?error.message:"Unable to recover this account."); }
    finally {setPasskeyBusy(false);}
  }

  async function getPasskeyStepUpToken():Promise<string> {
    const optionsResponse=await fetch("/api/auth/passkeys/step-up/options",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:"{}"});
    const options=await optionsResponse.json() as any;
    if(!optionsResponse.ok&&options.error==="NO_PASSKEY_AVAILABLE")return ""; 
    if(!optionsResponse.ok)throw new Error("Unable to start identity verification.");
    const credential=await startAuthentication({optionsJSON:options});
    const verifyResponse=await fetch("/api/auth/passkeys/step-up/verify",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({challenge:options.challenge,response:credential})});
    const result=await verifyResponse.json() as {verified?:boolean;stepUpToken?:string};
    if(!verifyResponse.ok||!result.verified||!result.stepUpToken)throw new Error("Passkey verification failed. Please try again.");
    return result.stepUpToken;
  }

  async function regenerateRecoveryCodes() {
    if(passkeyBusy||!user)return;
    setPasskeyBusy(true);setAuthDialogError("");
    try {
      const stepUpToken=await getPasskeyStepUpToken();
      const response=await fetch("/api/auth/passkeys/recovery/regenerate",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({stepUpToken})});
      const result=await response.json() as {recoveryCodes?:string[]};
      if(!response.ok||!result.recoveryCodes?.length)throw new Error("Unable to generate recovery codes.");
      setRecoveryCodes(result.recoveryCodes);setAuthDialog("codes");
    } catch(error) {pushToast(error instanceof Error?error.message:"Unable to generate recovery codes.","error");}
    finally {setPasskeyBusy(false);}
  }

  async function registerPasskey() {
    if(!user||passkeyBusy)return;
    setPasskeyBusy(true);
    try {
      const stepUpToken=await getPasskeyStepUpToken();
      const optionsResponse=await fetch("/api/auth/passkeys/register/options",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:"{}"});
      const options=await optionsResponse.json() as any;
      if(!optionsResponse.ok)throw new Error(options.error==="UNAUTHENTICATED"?"Please sign in again before adding a passkey.":"Unable to start passkey setup.");
      const credential=await startRegistration({optionsJSON:options});
      const verificationResponse=await fetch("/api/auth/passkeys/register/verify",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({challenge:options.challenge,response:credential,stepUpToken})});
      const verification=await verificationResponse.json() as {verified?:boolean;error?:string};
      if(!verificationResponse.ok||!verification.verified)throw new Error(verification.error==="PASSKEY_ALREADY_REGISTERED"?"This passkey is already linked to an account.":"Passkey setup could not be verified. Please try again.");
      pushToast("Passkey added. You can now sign in with Face ID or your device PIN.");
    } catch(error) {
      pushToast(error instanceof Error?error.message:"Unable to add a passkey.", "error");
    } finally { setPasskeyBusy(false); }
  }

  async function signInWithPasskey() {
    if(passkeyBusy)return;
    setPasskeyBusy(true);
    try {
      const optionsResponse=await fetch("/api/auth/passkeys/authenticate/options",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:"{}"});
      const options=await optionsResponse.json() as any;
      if(!optionsResponse.ok)throw new Error("Passkey sign-in is temporarily unavailable.");
      const credential=await startAuthentication({optionsJSON:options});
      const verificationResponse=await fetch("/api/auth/passkeys/authenticate/verify",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({challenge:options.challenge,response:credential})});
      const verification=await verificationResponse.json() as {authenticated?:boolean;error?:string};
      if(!verificationResponse.ok||!verification.authenticated)throw new Error(verification.error==="PASSKEY_NOT_RECOGNISED"?"No matching KitaNotes passkey was found on this device.":"Passkey sign-in failed. Try Google sign-in instead.");
      const returnTo=inviteToken?"/invite/accept?token="+encodeURIComponent(inviteToken):"/";
      window.location.assign(returnTo);
    } catch(error) {
      if(error instanceof Error&&error.name==="NotAllowedError")pushToast("Passkey sign-in was cancelled or timed out.","error");
      else pushToast(error instanceof Error?error.message:"Unable to sign in with a passkey.","error");
    } finally { setPasskeyBusy(false); }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    setUser(null);
    setNotes([]);
    setAuthStatus("signed_out");
  }

  return (
    <main className="app-shell">
      {authDialog&&<div className="auth-dialog-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&authDialog!=="codes")setAuthDialog(null);}}>
        <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
          <header><h2 id="auth-dialog-title">{authDialog==="signup"?"Create your KitaNotes account":authDialog==="recovery"?"Recover your account":"Save your recovery codes"}</h2><button type="button" className="mini-icon" onClick={()=>setAuthDialog(null)} aria-label="Close"><X size={17}/></button></header>
          {authDialog==="signup"&&<form onSubmit={event=>void createPasskeyAccount(event)}>
            <p>Create an account with Face ID, Touch ID or your device PIN. Your email is not verified during passkey signup. You can link Google later as an additional sign-in and recovery method.</p>
            <label>Display name<input required maxLength={80} value={signupName} onChange={event=>setSignupName(event.target.value)} autoComplete="name" placeholder="Your name"/></label>
            <label>Email address<input required type="email" maxLength={254} value={signupEmail} onChange={event=>setSignupEmail(event.target.value)} autoComplete="email" placeholder="you@example.com"/></label>
            {authDialogError&&<p className="auth-dialog-error">{authDialogError}</p>}
            <button className="auth-dialog-primary" type="submit" disabled={passkeyBusy}>{passkeyBusy?"Creating account…":"Continue with Passkey"}</button>
            <small>Google accounts already registered should sign in with Google first, then add a passkey.</small>
          </form>}
          {authDialog==="recovery"&&<form onSubmit={event=>void signInWithRecoveryCode(event)}>
            <p>Enter one unused recovery code you saved when setting up your account. Each code works once.</p>
            <label>Recovery code<input required value={recoveryCode} onChange={event=>setRecoveryCode(event.target.value)} autoComplete="off" spellCheck={false} placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"/></label>
            {authDialogError&&<p className="auth-dialog-error">{authDialogError}</p>}
            <button className="auth-dialog-primary" type="submit" disabled={passkeyBusy}>{passkeyBusy?"Checking code…":"Recover account"}</button>
          </form>}
          {authDialog==="codes"&&<div className="recovery-codes-content">
            <p><strong>These codes are shown only once.</strong> Save them somewhere safe, preferably in a password manager. Each code can be used once to sign in if you lose access to all your passkeys.</p>
            <div className="recovery-code-list">{recoveryCodes.map(code=><code key={code}>{code}</code>)}</div>
            <button type="button" className="auth-dialog-primary" onClick={()=>{void navigator.clipboard.writeText(recoveryCodes.join("\n")).then(()=>pushToast("Recovery codes copied."),()=>pushToast("Clipboard unavailable. Copy the codes manually.","error"));}}>Copy all codes</button>
            <button type="button" className="auth-dialog-secondary" onClick={()=>setAuthDialog(null)}>I have saved my codes</button>
          </div>}
        </section>
      </div>}

      <aside className="sidebar">
        <a className="brand" href="/" aria-label="KitaNotes home">
          <img className="brand-logo" src="/icons/mark-96.png" alt="" width="34" height="34" />
          <span className="brand-text"><span>Kita<span className="brand-soft">Notes</span></span><small className="brand-by">by Binalah.com</small></span>
        </a>
        <div className="workspace-switch-row">
          <WorkspacePicker workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onChange={(id:string)=>{setNotes([]);setCategories([]);setNotesLoading(true);setActiveWorkspaceId(id);setSelectedCategoryId("");setComposerOpen(false);setEditingNote(null);}} unreadByWorkspace={unreadByWorkspace} />
          <button type="button" className={starredWorkspaceId===activeWorkspaceId?"workspace-star-button active":"workspace-star-button"} onClick={()=>void toggleWorkspaceStar()} disabled={!activeWorkspaceId||starredWorkspaceSaving} aria-label={starredWorkspaceId===activeWorkspaceId?"Remove default workspace":"Set as default workspace"} title={starredWorkspaceId===activeWorkspaceId?"Default workspace":"Set as default workspace"}>
            <Star size={16} fill={starredWorkspaceId===activeWorkspaceId?"currentColor":"none"}/>
          </button>
        </div>
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
            
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="mobile-workspace-control">
            <WorkspacePicker workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onChange={(id:string)=>{setActiveWorkspaceId(id);setSelectedCategoryId("");setComposerOpen(false);setEditingNote(null);}} />
            <button type="button" className={starredWorkspaceId===activeWorkspaceId?"workspace-star-button mobile active":"workspace-star-button mobile"} onClick={()=>void toggleWorkspaceStar()} disabled={!activeWorkspaceId||starredWorkspaceSaving} aria-label={starredWorkspaceId===activeWorkspaceId?"Remove default workspace":"Set as default workspace"} title={starredWorkspaceId===activeWorkspaceId?"Default workspace":"Set as default workspace"}><Star size={16} fill={starredWorkspaceId===activeWorkspaceId?"currentColor":"none"}/></button>
          </div>
          <div className="breadcrumb">{workspaces.find(item=>item.id===activeWorkspaceId)?.name??"My workspace"} <span>/</span> {view === "notes" ? "Notes" : view === "calendar" ? "Calendar" : "Shared with me"}</div>
          <div className="top-actions">
            {user&&<button className="topbar-action" onClick={createPersonalWorkspace} disabled={workspaceModalOpen}><Plus size={14}/> New space</button>}
            <button className="icon-button" onClick={()=>setTheme(value=>value==="dark"?"light":"dark")} aria-label="Toggle dark mode" title="Toggle dark mode">{theme==="dark"?<Sun size={18}/>:<Moon size={18}/>}</button>{!isInstalled&&<button className="install-app-button" onClick={installApp}>Install app</button>}
            <button className="icon-button notification-trigger" aria-label="Notifications" onClick={()=>setNotificationsOpen(value=>!value)} disabled={!user}><Bell size={18}/>{unreadCount>0&&<span>{unreadCount>9?"9+":unreadCount}</span>}</button>
            <AccountMenu user={user} authStatus={authStatus} passkeyBusy={passkeyBusy} onRegisterPasskey={()=>void registerPasskey()} onSignInWithPasskey={()=>void signInWithPasskey()} onRegenerateRecoveryCodes={()=>void regenerateRecoveryCodes()} onOpenSignup={()=>{setAuthDialogError("");setAuthDialog("signup");}} onOpenRecovery={()=>{setAuthDialogError("");setAuthDialog("recovery");}} onSignOut={signOut}/>
          </div>
        </header>
        <div className="content">
          {installHelpOpen&&<section className="install-help"><button className="mini-icon" onClick={()=>setInstallHelpOpen(false)} aria-label="Close install instructions"><X size={15}/></button><strong>Install KitaNotes</strong><p><b>iPhone / iPad:</b> Open this page in Safari, tap Share, then choose Add to Home Screen.</p><p><b>Android:</b> Open the browser menu and choose Install app or Add to Home screen.</p></section>}
          {notificationsOpen && <section className="notification-panel">
            <header><strong>Notifications</strong><div className="notification-actions">{pushSupported&&user&&<button className="text-action" onClick={pushSubscribed?disablePush:enablePush} disabled={pushBusy}>{pushBusy?"Working…":pushSubscribed?"Disable push":"Enable push"}</button>}{pushSubscribed&&<button className="text-action" onClick={testPush} disabled={pushBusy}>Test</button>}<button className="text-action" onClick={markAllNotificationsRead} disabled={unreadCount===0}>Mark all read</button></div></header>
            {pushError&&<p className="invite-error">{pushError}</p>}
            {notificationError&&<p className="invite-error">{notificationError}</p>}
            
            {notificationsLoading?<p>Loading…</p>:notifications.length===0?<p>You're all caught up.</p>:notifications.map(notification=><button className={notification.readAt?"notification-item":"notification-item unread"} key={notification.id} onClick={()=>openNotification(notification)}><strong>{notification.title}</strong><span>{notification.body}</span><small>{new Date(notification.createdAt).toLocaleString()}</small></button>)}
            {user&&<details className="notification-settings">
              <summary><span><strong>Workspace alerts</strong><small>All, important only, or mute each workspace</small></span><ChevronDown size={16}/></summary>
              <div className="notification-settings-content">
                {workspaceNotificationPreferences.length===0?<p>No joined workspaces.</p>:workspaceNotificationPreferences.map(item=><label className="workspace-notification-row" key={item.id}><span><strong>{item.name}</strong><small>{item.role}</small></span><select className="invite-input" value={item.mode} disabled={workspaceNotificationSaving===item.id} onChange={event=>void saveWorkspaceNotificationPreference(item.id,event.target.value as "all"|"important"|"mute")}><option value="all">All alerts</option><option value="important">Important only</option><option value="mute">Mute</option></select></label>)}
                <p className="notification-settings-note">Important alerts include reminders and workspace access or role changes. Muting a workspace affects push only; the in-app inbox remains available.</p>
              </div>
            </details>}
            {user&&<details className="notification-settings">
              <summary><span><strong>Delivery preferences</strong><small>Choose which alerts reach this device</small></span><ChevronDown size={16}/></summary>
              <div className="notification-settings-content">
                {notificationPrefsLoading?<p>Loading preferences…</p>:<>
                  <p className="notification-settings-note">Your in-app inbox always keeps notifications. These settings only control push alerts.</p>
                  <label><input type="checkbox" checked={notificationPrefs.pushEnabled} onChange={event=>{setNotificationPrefs(value=>({...value,pushEnabled:event.target.checked}));setNotificationPrefsSaved(false);}}/> Enable push delivery</label>
                  <label><input type="checkbox" checked={notificationPrefs.reminderPushEnabled} onChange={event=>{setNotificationPrefs(value=>({...value,reminderPushEnabled:event.target.checked}));setNotificationPrefsSaved(false);}} disabled={!notificationPrefs.pushEnabled}/> Event and reminder alerts</label>
                  <label><input type="checkbox" checked={notificationPrefs.sharedNotePushEnabled} onChange={event=>{setNotificationPrefs(value=>({...value,sharedNotePushEnabled:event.target.checked}));setNotificationPrefsSaved(false);}} disabled={!notificationPrefs.pushEnabled}/> New shared-note alerts</label>
                  <label><input type="checkbox" checked={notificationPrefs.sharedNoteUpdatePushEnabled} onChange={event=>{setNotificationPrefs(value=>({...value,sharedNoteUpdatePushEnabled:event.target.checked}));setNotificationPrefsSaved(false);}} disabled={!notificationPrefs.pushEnabled}/> Shared-note updates and deletions</label>
                  <label><input type="checkbox" checked={notificationPrefs.eventPushEnabled} onChange={event=>{setNotificationPrefs(value=>({...value,eventPushEnabled:event.target.checked}));setNotificationPrefsSaved(false);}} disabled={!notificationPrefs.pushEnabled}/> Calendar event changes</label>
                  <label><input type="checkbox" checked={notificationPrefs.workspacePushEnabled} onChange={event=>{setNotificationPrefs(value=>({...value,workspacePushEnabled:event.target.checked}));setNotificationPrefsSaved(false);}} disabled={!notificationPrefs.pushEnabled}/> Workspace membership and access changes</label>
                  <div className="quiet-hours-fields"><label>Quiet hours start<input type="time" value={notificationPrefs.quietHoursStart??""} onChange={event=>{setNotificationPrefs(value=>({...value,quietHoursStart:event.target.value||null}));setNotificationPrefsSaved(false);}}/></label><label>Quiet hours end<input type="time" value={notificationPrefs.quietHoursEnd??""} onChange={event=>{setNotificationPrefs(value=>({...value,quietHoursEnd:event.target.value||null}));setNotificationPrefsSaved(false);}}/></label></div>
                  <label className="timezone-setting">Timezone<input value={notificationPrefs.timezone} maxLength={64} onChange={event=>{setNotificationPrefs(value=>({...value,timezone:event.target.value}));setNotificationPrefsSaved(false);}} placeholder="Asia/Kuala_Lumpur"/></label>
                  <button className="text-action" onClick={()=>{setNotificationPrefs(value=>({...value,quietHoursStart:null,quietHoursEnd:null}));setNotificationPrefsSaved(false);}}>Clear quiet hours</button>
                  <div className="notification-settings-footer"><span>{notificationPrefsSaved?"Preferences saved.":"Quiet hours pause push only. Your inbox is unaffected."}</span><button className="secondary-button" onClick={saveNotificationPreferences} disabled={notificationPrefsSaving}>{notificationPrefsSaving?"Saving…":"Save preferences"}</button></div>
                </>}
                {notificationPrefsError&&<p className="invite-error">{notificationPrefsError}</p>}
              </div>
            </details>}
          </section>}
          {inviteToken && <section className="invite-panel">
            <div><span className="eyebrow">WORKSPACE INVITATION</span><h2>{invitePreview?.valid?invitePreview.workspaceName:"You've been invited."}</h2>
              {invitePreview?.valid?<p>{invitePreview.inviterName} invited you as <strong>{invitePreview.role==="editor"?"Editor":"Viewer"}</strong>. {invitePreview.memberCount} people are already in this workspace. Events from this workspace will appear in your calendar after you join. Expires {new Date(invitePreview.expiresAt!).toLocaleDateString()}.</p>:invitePreview?.error?<p className="invite-error">{invitePreview.error==="INVITATION_EXPIRED"?"This invitation has expired. Ask the owner for a new link.":invitePreview.error==="INVITATION_REVOKED"?"This invitation was revoked. Ask the owner for a new link.":"This invitation is invalid or no longer available."}</p>:<p>Checking invitation details…</p>}</div>
            {invitePreview?.valid&&(user ? <button className="primary-button" onClick={acceptInvite} disabled={inviteStatus === "accepting"}>{inviteStatus === "accepting" ? "Accepting…" : "Accept invitation"}</button>
              : authStatus === "signed_out" ? <div className="empty-auth-actions"><a className="primary-button" href={"/auth/google?returnTo=" + encodeURIComponent("/invite/accept?token=" + inviteToken)}><LogIn size={16}/> Continue with Google</a><button className="secondary-button" onClick={()=>void signInWithPasskey()} disabled={passkeyBusy}><Fingerprint size={16}/>{passkeyBusy?"Checking…":"Use a passkey"}</button></div>
              : <span className="setup-label">{authStatus === "loading" ? "Checking sign-in…" : "Sign-in setup pending"}</span>)}
            {inviteError && <p className="invite-error">{inviteError}</p>}
            {inviteError.includes("different Google email") && user && <button className="text-action" onClick={signOut}>Sign out</button>}
          </section>}
          {inviteNotice && <div className="invite-success-banner"><Check size={16}/>{inviteNotice}</div>}

          <div className="page-heading">
            <div><div className="eyebrow">NOTES · CALENDAR · SHARED WORKSPACES</div><h1>{view === "notes" ? "My Notes" : view === "calendar" ? "Calendar" : "Shared with Me"}</h1><p>{view === "notes" ? "Save notes, organise them into categories, and find them when you need them." : view === "calendar" ? "View your saved events and reminders." : "Notes and workspaces shared with you."}</p></div>
            {view === "calendar" && user && workspaces.some(item=>item.role==="owner"||item.role==="editor") && <button className="primary-button" onClick={startNewEvent}><Plus size={17}/> New event</button>}{view === "calendar" && user && !workspaces.some(item=>item.role==="owner"||item.role==="editor") && <span className="calendar-readonly-hint">You have view-only access to your joined workspaces.</span>}{view === "notes" && user && <div className="page-actions">{workspaces.find(item=>item.id===activeWorkspaceId)?.role==="owner" && <button className="secondary-button" onClick={()=>openManage("people")}><Users size={16} /> Manage space</button>}{activeWorkspace?.visibility==="shared"&&activeWorkspace.role!=="owner"&&<button className="secondary-button" onClick={()=>openManage("people")}><Users size={16} /> Members</button>}<button className="secondary-button" onClick={()=>setCategoryModalOpen(true)}>Categories</button><button className="secondary-button" onClick={()=>{setAiModalOpen(true);setAiError("");}}><Sparkles size={16}/> AI Note Assistant</button>{canWrite&&<button className="primary-button" onClick={startNewNote}><Plus size={17} /> New note</button>}</div>}
          </div>

          {view === "notes" && <>
            <div className="toolbar">
              <label className="search-box"><Search size={17} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search notes  ( / )" />{query&&<button className="mini-icon" onClick={()=>setQuery("")} aria-label="Clear search"><X size={14}/></button>}</label><button type="button" className={globalSearchActive?"filter-button active-filter":"filter-button"} onClick={()=>{setGlobalSearchActive(value=>!value);setGlobalSearchResults([]);}}>Search all spaces</button>
              <label className="filter-button"><select className="sort-select" aria-label="Sort notes" value={sortMode} onChange={event=>setSortMode(event.target.value as SortMode)}><option value="updated">Recently updated</option><option value="oldest">Oldest first</option><option value="title">Title A–Z</option></select></label>
              <button className={showArchived?"filter-button active-filter":"filter-button"} onClick={()=>{setShowArchived(value=>!value);setShowTrash(false);}}><Archive size={14}/> Arkib</button><button className={showTrash?"filter-button active-filter":"filter-button"} onClick={()=>{setShowTrash(value=>!value);setShowArchived(false);setCategoryFilter("");}}><Trash2 size={14}/> Trash</button>
            </div>
            {!globalSearchActive&&user&&(categories.length>0)&&<div className="chip-row" role="tablist" aria-label="Tapis mengikut kategori"><button className={!categoryFilter?"chip active":"chip"} onClick={()=>setCategoryFilter("")}>All</button>{categories.filter(category=>!["uncategorised","uncategorized","unassigned"].includes(category.name.trim().toLowerCase())).map(category=><button key={category.id} className={categoryFilter===category.id?"chip active":"chip"} onClick={()=>setCategoryFilter(category.id)}><span className="category-dot" style={{background:category.color||"#8c88a7"}}/>{category.name}</button>)}<button className={categoryFilter==="__none"?"chip active":"chip"} onClick={()=>setCategoryFilter("__none")}><Tag size={11}/> Uncategorised</button>
            </div>}
            <div className="notes-meta">{globalSearchActive?(globalSearchLoading?"Searching all workspaces…":displayNotes.length+" results across joined workspaces"):notesLoading?"":visibleNotes.length+" nota"+(showArchived?" dalam arkib":"")}
            </div>
            {notesError && <div className="inline-error">{notesError}</div>}{globalSearchError&&<div className="inline-error">{globalSearchError}</div>}
            {globalSearchActive?(globalSearchLoading?<div className="loading-state">Searching all workspaces…</div>:displayNotes.length>0?<div className="global-search-results">{workspaces.map(workspace=>{const matches=globalSearchResults.filter(note=>note.workspaceId===workspace.id);return matches.length===0?null:<section className="global-search-group" key={workspace.id}><h3>{workspace.name}</h3><div className="notes-grid">{matches.map(note=><NoteCard key={note.id} note={note} canWrite={workspace.role!=="viewer"} showArchived={false} onView={()=>openGlobalNote(note)} onEdit={()=>{setActiveWorkspaceId(note.workspaceId);startEditNote(note);}} onArchive={archiveNote} onRestore={restoreNote} onDelete={deleteNote}/>)}</div></section>;})}</div>:<div className="empty-state"><h2>{query.trim()?"No notes found across your workspaces":"Search all joined workspaces"}</h2><p>Search by title or content. Results are grouped by workspace.</p></div>):notesLoading?<div className="loading-state">Memuatkan nota…</div>:visibleNotes.length > 0 ? <div className="notes-grid">
              {visibleNotes.map(note => <NoteCard key={note.id} note={note} canWrite={canWrite} showArchived={showArchived||showTrash} isTrash={showTrash} onView={setViewingNote} onEdit={startEditNote} onArchive={archiveNote} onRestore={showTrash?restoreFromTrash:restoreNote} onDelete={deleteNote}/>) }
            </div> : <div className="empty-state">
              <div className="empty-illustration"><div className="paper paper-back"></div><div className="paper paper-front"><span></span><span></span><span></span><i><Check size={17} /></i></div><div className="sparkle sparkle-one">✦</div><div className="sparkle sparkle-two">✧</div></div>
              <h2>{query||categoryFilter ? "No notes found" : showTrash ? "Trash is empty" : showArchived ? "Archive is empty" : user ? "A fresh page." : authStatus === "unavailable" ? "Almost ready." : "Your notes start here."}</h2>
              <p>{query||categoryFilter ? "Try another search term or clear the category filter." : showTrash ? "Deleted notes stay here for 30 days. Restore them before they are permanently removed." : showArchived ? "Archived notes appear here and can be restored any time." : user ? "Your notes will find a home here. Start with one small thought." : authStatus === "unavailable" ? "The app needs its dedicated D1 database and Google sign-in configuration before accounts can be enabled." : "Sign in with Google or a passkey to create and sync your notes."}</p>
              {user&&canWrite&&!globalSearchActive&&!showArchived&&!showTrash&&!query&&!categoryFilter ? <button className="primary-button" onClick={startNewNote}><Plus size={17} /> Create your first note</button> : authStatus === "signed_out" ? <div className="empty-auth-actions"><a className="primary-button" href="/auth/google"><LogIn size={16} /> Continue with Google</a><button className="secondary-button" onClick={()=>void signInWithPasskey()} disabled={passkeyBusy}><Fingerprint size={16}/>{passkeyBusy?"Checking…":"Use a passkey"}</button></div> : null}
            </div>}
          </>}

          {view === "calendar" && <Suspense fallback={<div className="loading-state">Loading calendar…</div>}>
            <CalendarView
              events={events} holidays={holidays} eventsLoading={eventsLoading} eventsError={eventsError} workspaces={workspaces}
              holidayFeedStatus={holidayFeedStatus} holidayState={holidayState} onHolidayStateChange={saveHolidayState}
              calendarMode={calendarMode} setCalendarMode={setCalendarMode} calendarCursor={calendarCursor}
              setCalendarCursor={setCalendarCursor} calendarHeading={calendarHeading} calendarDays={calendarDays}
              calendarAgendaItems={calendarAgendaItems} calendarTransferBusy={calendarTransferBusy}
              calendarIcsInputRef={calendarIcsInputRef} onImportCalendarIcs={importCalendarIcs}
              onExportCalendarIcs={exportCalendarIcs} onMoveCalendar={moveCalendar}
              canManageEvent={(event)=>workspaces.some(item=>item.id===event.workspaceId&&(item.role==="owner"||item.role==="editor"))} onEditEvent={startEditEvent} onDeleteEvent={deleteEvent} calendarFocusDate={calendarFocusDate}
            />
          </Suspense>}
          {view === "shared" && <section className="shared-section">{sharedWorkspaces.length===0?<div className="placeholder-panel"><Users size={26} /><h2>Nothing shared yet.</h2><p>When someone invites you, or you share a workspace, it will show up here.</p><button className="secondary-button" onClick={()=>setView("notes")}>Back to notes</button></div>:<div className="shared-grid">{sharedWorkspaces.map(workspace=><button key={workspace.id} className={workspace.id===activeWorkspaceId?"shared-card current":"shared-card"} onClick={()=>{setActiveWorkspaceId(workspace.id);setShowArchived(false);setView("notes");}}><span className="workspace-avatar">{workspace.name.slice(0,1).toUpperCase()}</span><strong>{workspace.name}</strong><small>{workspace.role==="owner"?"You own this space":workspace.role==="editor"?"You can edit":"View only"}</small></button>)}</div>}</section>}

          <div className="ai-actions">
            <button className="ai-hint" onClick={openExistingOrganizer} disabled={!user||!activeWorkspaceId||notes.length===0||showArchived||workspaces.find(item=>item.id===activeWorkspaceId)?.role==="viewer"}><span className="ai-icon"><Sparkles size={17}/></span><div><strong>AI Organizer</strong><p>Organise existing notes into categories.</p></div><span className="coming-soon">{aiStatus?.configured?"OPEN":"SETUP"}</span></button>
            <button className="ai-hint" onClick={()=>{setAiModalOpen(true);setAiError("");}} disabled={!user}><span className="ai-icon"><Plus size={17}/></span><div><strong>AI Note Assistant</strong><p>Bina nota daripada teks atau gambar, dan kenal pasti acara serta peringatan.</p></div><span className="coming-soon">{aiStatus?.configured?"OPEN":"SETUP"}</span></button>
          </div>
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

      {existingOrganizerOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!existingOrganizerBusy)setExistingOrganizerOpen(false);}}>
        <section className="composer ai-composer" role="dialog" aria-modal="true" aria-labelledby="existing-organizer-title">
          <header><div><span className="eyebrow">REORGANISE EXISTING NOTES</span><h2 id="existing-organizer-title">AI Organizer</h2></div><button className="icon-button" onClick={()=>setExistingOrganizerOpen(false)} aria-label="Close" disabled={existingOrganizerBusy}><X size={19}/></button></header>
          {!aiStatus?.configured?<div className="ai-privacy-card"><strong>AI is not available yet.</strong><p>Try again when the service is configured.</p></div>:existingOrganizerProposals.length===0?<div>
            <p className="ai-privacy-copy">Choose up to 30 existing notes. AI will recommend an existing category or suggest a new one. It will not rewrite your notes. Nothing changes until you review and apply the plan.</p>
            <div className="organizer-selection-heading"><strong>{selectedOrganizerNoteIds.length} of 30 selected</strong><button className="text-action" onClick={()=>setSelectedOrganizerNoteIds(notes.slice(0,30).map(note=>note.id))}>Select first 30</button></div>
            <div className="organizer-note-list">{notes.filter(note=>!note.archivedAt).map(note=><label key={note.id} className="organizer-note-option"><input type="checkbox" checked={selectedOrganizerNoteIds.includes(note.id)} disabled={!selectedOrganizerNoteIds.includes(note.id)&&selectedOrganizerNoteIds.length>=30} onChange={event=>setSelectedOrganizerNoteIds(current=>event.target.checked?[...current,note.id]:current.filter(id=>id!==note.id))}/><span><strong>{note.title}</strong><small>{note.categoryName||"Uncategorised"} · {note.content.slice(0,90)}</small></span></label>)}</div>
            {existingOrganizerError&&<p className="invite-error">{existingOrganizerError}</p>}
            <footer><span>Only selected notes will be analysed.</span><button className="primary-button" onClick={suggestExistingNoteCategories} disabled={selectedOrganizerNoteIds.length===0||selectedOrganizerNoteIds.length>30||existingOrganizerBusy}>{existingOrganizerBusy?"Reviewing notes…":"Suggest categories"}</button></footer>
          </div>:<div>
            <p className="ai-privacy-copy">Review the proposed category for each note. New categories are created only when you apply the plan.</p>
            <div className="organizer-proposal-list">{existingOrganizerProposals.map(proposal=>{const note=notes.find(item=>item.id===proposal.noteId);return <label key={proposal.noteId} className={proposal.applied?"organizer-proposal applied":"organizer-proposal"}><input type="checkbox" checked={proposal.selected} disabled={proposal.applied||existingOrganizerBusy} onChange={event=>setExistingOrganizerProposals(current=>current.map(item=>item.noteId===proposal.noteId?{...item,selected:event.target.checked}:item))}/><span><strong>{note?.title||"Note unavailable"}</strong><span>{proposal.categoryName}</span><small>{proposal.reason||"Suggested from the note content."}</small></span><small>{proposal.applied?"Applied":categories.some(category=>category.name.toLowerCase()===proposal.categoryName.toLowerCase())?"Existing":"New category"}</small></label>;})}</div>
            {existingOrganizerError&&<p className="invite-error">{existingOrganizerError}</p>}
            <footer><button className="secondary-button" onClick={()=>setExistingOrganizerProposals([])} disabled={existingOrganizerBusy}>Back</button><button className="primary-button" onClick={applyExistingNoteCategories} disabled={existingOrganizerBusy||!existingOrganizerProposals.some(item=>item.selected&&!item.applied)}>{existingOrganizerBusy?"Applying…":"Apply selected changes"}</button></footer>
          </div>}
        </section>
      </div>}

      {aiModalOpen && <Suspense fallback={<div className="modal-backdrop"><section className="composer ai-composer" role="status">Loading AI assistant…</section></div>}>
        <AiAssistantModal
          aiStatus={aiStatus} aiDraft={aiDraft} aiDraftTitle={aiDraftTitle} setAiDraftTitle={setAiDraftTitle}
          aiDraftContent={aiDraftContent} setAiDraftContent={setAiDraftContent} aiInput={aiInput} setAiInput={setAiInput}
          aiWorking={aiWorking} aiError={aiError} ocrFile={ocrFile} setOcrFile={setOcrFile}
          galleryInputRef={galleryInputRef} cameraInputRef={cameraInputRef} ocrPreviewUrl={ocrPreviewUrl}
          ocrWorking={ocrWorking} scanImageWithAi={scanImageWithAi} organizeWithAi={organizeWithAi}
          categories={categories} selectedCategoryId={selectedCategoryId} setSelectedCategoryId={setSelectedCategoryId}
          aiNoteSaved={aiNoteSaved} aiItemsCreated={aiItemsCreated} aiSavingNote={aiSavingNote}
          aiCreatingItems={aiCreatingItems} saveAiNote={saveAiNote}
          onClose={()=>setAiModalOpen(false)}
          onStartOver={()=>{setAiDraft(null);setAiError("");setAiNoteSaved(false);setAiSavedNoteId(null);setAiItemsCreated(false);setAiCreatedItems([]);setAiCreatedEventIds({});}}
        />
      </Suspense>}
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
            <div className="activity-filters"><label>Type<select className="invite-input" value={activityTypeFilter} onChange={event=>setActivityTypeFilter(event.target.value)}><option value="">All activity</option><option value="note.created">Notes created</option><option value="note.updated">Notes updated</option><option value="note.deleted">Notes deleted</option><option value="event.created">Events created</option><option value="event.updated">Events updated</option><option value="event.deleted">Events deleted</option><option value="member.joined">Members joined</option><option value="member.left">Members left</option><option value="member.removed">Members removed</option><option value="member.role_changed">Role changes</option></select></label><label>Person<select className="invite-input" value={activityPersonFilter} onChange={event=>setActivityPersonFilter(event.target.value)}><option value="">Everyone</option>{Array.from(new Map(activity.filter(item=>item.actorId).map(item=>[item.actorId!,item.actor])).entries()).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label></div>
            {invitationsLoading?<p>Loading activity…</p>:activity.length===0?<p>No activity matches these filters.</p>:activity.map(item=><div className="invite-list-row" key={item.id}><div><strong>{describeActivity(item)}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></div></div>)}
            {activityNextCursor&&<button className="secondary-button" onClick={()=>void loadMoreActivity()} disabled={activityLoadingMore}>{activityLoadingMore?"Loading…":"Load more activity"}</button>}
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
        <section className="composer event-composer" role="dialog" aria-modal="true" aria-labelledby="event-title">
          <header><div><span className="eyebrow">INTERNAL CALENDAR</span><h2 id="event-title">{editingEvent?"Edit event":"New event"}</h2></div><button className="icon-button" onClick={()=>setEventComposerOpen(false)} aria-label="Close"><X size={19}/></button></header>
          <label className="field-label">Workspace<select className="invite-input" value={eventWorkspaceId} disabled={!!editingEvent} onChange={async e=>{const id=e.target.value;setEventWorkspaceId(id);setEventLinkedNoteId("");if(id===activeWorkspaceId){setEventWorkspaceNotes(notes);return;}try{const response=await fetch("/api/notes?limit=100&workspaceId="+encodeURIComponent(id),{credentials:"same-origin"});if(!response.ok)throw new Error("Unable to load notes for this workspace.");const result=await response.json() as {notes:Note[]};setEventWorkspaceNotes(result.notes);}catch(error){setEventWorkspaceNotes([]);setEventsError(error instanceof Error?error.message:"Unable to load workspace notes.");}}}>{workspaces.filter(item=>item.role==="owner"||item.role==="editor").map(item=><option key={item.id} value={item.id}>{item.name} · {item.role==="owner"?"Owner":"Editor"}</option>)}</select>{editingEvent&&<small className="calendar-reminder-help">Events stay in their original workspace. Create a new event to use another workspace.</small>}</label>
          <label className="field-label">Event title<input className="invite-input" value={eventTitle} onChange={e=>setEventTitle(e.target.value)} maxLength={200} placeholder="What is happening?"/></label>
          <label className="field-label">Details<textarea className="invite-input event-description" value={eventDescription} onChange={e=>setEventDescription(e.target.value)} maxLength={5000} rows={3} placeholder="Optional details"/></label>
          <div className="event-datetime-grid"><label className="field-label">Starts<input className="invite-input" type="datetime-local" value={eventStart} onChange={e=>{setEventStart(e.target.value);if(eventReminderAuto)setEventReminderAt(defaultReminderDateTime(e.target.value,eventTimezone));}}/></label><label className="field-label">Ends<input className="invite-input" type="datetime-local" value={eventEnd} onChange={e=>setEventEnd(e.target.value)}/></label></div>
          <label className="field-label">Timezone<input className="invite-input" value={eventTimezone} onChange={e=>{setEventTimezone(e.target.value);if(eventReminderAuto)setEventReminderAt(defaultReminderDateTime(eventStart,e.target.value));}} placeholder="Asia/Kuala_Lumpur"/></label>
          <label className="field-label">Link to note (optional)<select className="invite-input" value={eventLinkedNoteId} onChange={e=>setEventLinkedNoteId(e.target.value)}><option value="">No linked note</option>{eventWorkspaceNotes.filter(note=>note.workspaceId===eventWorkspaceId).map(note=><option key={note.id} value={note.id}>{note.title}</option>)}</select></label>
          <label className="field-label">Event reminder{editingEventReminder&&<small className="calendar-reminder-help">{editingEventReminder.status==="pending"?"Current reminder":"Previous reminder"}: {new Date(editingEventReminder.dueAt).toLocaleString(undefined,{timeZone:editingEventReminder.timezone,dateStyle:"medium",timeStyle:"short"})} · {editingEventReminder.timezone} · {editingEventReminder.status}</small>}<input className="invite-input" type="datetime-local" value={eventReminderAt} onChange={e=>{setEventReminderAt(e.target.value);setEventReminderAuto(false);}}/>{!editingEventReminder&&<small className="calendar-reminder-help">Automatically set to 1 day before. You can change the time or leave it empty.</small>}<button type="button" className="text-action" onClick={()=>{setEventReminderAt(defaultReminderDateTime(eventStart,eventTimezone));setEventReminderAuto(true);}}>{editingEventReminder?"Set a new reminder 1 day before":"Reset to 1 day before"}</button>{editingEventReminder?.status==="pending"&&<button type="button" className="text-action" onClick={()=>setEventReminderAt("")}>Remove reminder</button>}</label>
          {eventsError&&<p className="invite-error">{eventsError}</p>}
          <footer><span>{editingEvent?"Event and reminder changes are saved separately.":"Reminder delivery appears in the in-app inbox, checked every five minutes."}</span><button className="primary-button" onClick={saveEvent} disabled={!eventTitle.trim()||!eventWorkspaceId||eventSaving}>{eventSaving?"Saving…":editingEvent?"Save changes":"Save event"}</button></footer>
        </section>
      </div>}

      {noteConflict&&<div className="modal-backdrop" role="presentation"><section className="composer conflict-composer" role="dialog" aria-modal="true" aria-labelledby="note-conflict-title"><header><div><span className="eyebrow">EDIT CONFLICT</span><h2 id="note-conflict-title">This note changed elsewhere</h2></div></header><p>Someone saved a newer version at {new Date(noteConflict.latest.updatedAt).toLocaleString()}. Your unsaved text is still here. Choose how to continue.</p><div className="conflict-preview"><strong>Latest saved version</strong><p>{noteConflict.latest.content.slice(0,320)||"No content"}</p></div><footer><button className="secondary-button" onClick={copyMineAndUseLatest} disabled={saving}>Copy mine and use theirs</button><button className="secondary-button" onClick={useLatestNoteConflict} disabled={saving}>Use theirs</button><button className="primary-button" onClick={keepMineAfterConflict} disabled={saving}>{saving?"Saving…":"Keep mine"}</button></footer></section></div>}
      {composerOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setComposerOpen(false); }}>
        <section className="composer note-composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
          <header><div><span className="eyebrow">{editingNote?"EDIT NOTE":(workspaces.find(item=>item.id===activeWorkspaceId)?.visibility==="shared"?"SHARED WORKSPACE NOTE":"PRIVATE WORKSPACE NOTE")}</span><h2 id="composer-title">{editingNote ? "Edit note" : "New note"}</h2></div><button className="icon-button" onClick={() => setComposerOpen(false)} aria-label="Close"><X size={19} /></button></header>
          <input className="composer-title" value={draftTitle} onChange={event => setDraftTitle(event.target.value)} placeholder="Give your note a title" maxLength={200} autoFocus />
          <textarea value={draftContent} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==="Enter"){event.preventDefault();void saveNote();}}} onChange={event => setDraftContent(event.target.value)} placeholder="Start writing… anything worth remembering." maxLength={50000} rows={9} />
          <div className="composer-counter">{draftContent.trim()?draftContent.trim().split(/\s+/).length:0} words · {draftContent.length.toLocaleString()} / 50,000</div><label className="field-label">Category<select className="invite-input" value={selectedCategoryId} onChange={event=>setSelectedCategoryId(event.target.value)}><option value="">Uncategorised</option>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <footer><span>{editingNote ? "Changes use version checking to avoid overwriting newer edits." : (activeWorkspace?.visibility==="shared"?"Saved to this shared workspace.":"Saved to your private workspace.")+" Ctrl/⌘+Enter to save."}</span><button className="primary-button" onClick={saveNote} disabled={!draftTitle.trim() || saving}>{saving ? "Saving…" : editingNote ? "Save changes" : "Save note"}</button></footer>
        </section>
      </div>}
      {viewingNote && <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setViewingNote(null);}}>
        <section className="composer note-viewer" role="dialog" aria-modal="true" aria-labelledby="view-note-title">
          <header><div><span className="eyebrow">{viewingNote.categoryName||"NOTE"}</span><h2 id="view-note-title">{viewingNote.title}</h2></div><button className="icon-button" onClick={()=>setViewingNote(null)} aria-label="Close"><X size={19}/></button></header>
          <div className="note-full-content">{viewingNote.content ? viewingNote.content.split("\n").map((line,index)=>{
            const item=line.match(/^(\s*)-\s+\[([ xX])\]\s+(.*)$/);
            if(item){
              const checked=item[2].toLowerCase()==="x";
              return <div className={checked?"note-checklist-row checked":"note-checklist-row"} key={index}><input type="checkbox" checked={checked} disabled={!canWrite||checklistSavingLine!==null} onChange={()=>void toggleNoteChecklistItem(index)} aria-label={(checked?"Mark incomplete: ":"Mark complete: ")+item[3]}/><span>{item[3]}</span></div>;
            }
            return <div className="note-content-line" key={index}>{line||" "}</div>;
          }) : "No additional details."}</div>
          <small className="record-audit">Created by {viewingNote.createdByName||"Workspace member"} · {new Date(viewingNote.createdAt).toLocaleString()}<br/>Last updated by {viewingNote.updatedByName||viewingNote.createdByName||"Workspace member"} · {new Date(viewingNote.updatedAt).toLocaleString()}</small>
          <footer><span>Full note</span><div className="note-viewer-actions">{canWrite&&!showArchived&&viewingNote.content.split("\n").some(line=>/^\s*-\s+(?!\[[ xX]\]\s).+/.test(line))&&<button className="secondary-button" disabled={checklistSavingLine!==null} onClick={()=>void enableNoteChecklist()}>{checklistSavingLine===-1?"Enabling…":"Enable checklist"}</button>}{canWrite&&!showArchived&&<button className="primary-button" onClick={()=>{const note=viewingNote;setViewingNote(null);startEditNote(note);}}>Edit note</button>}</div></footer>
        </section>
      </div>}
      <div className="toast-stack" role="status" aria-live="polite">{toasts.map(toast=><div key={toast.id} className={"toast "+toast.tone}>{toast.text}</div>)}</div>
    </main>
  );
}
