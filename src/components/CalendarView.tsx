import { useMemo, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { Archive, Download, Pencil, Upload } from "lucide-react";

type CalendarEvent = {
  id:string; workspaceId:string; title:string; description:string; startsAt:string; endsAt:string;
  timezone:string; allDay:boolean; linkedNoteId:string|null; createdBy:string;
  createdByName:string|null; updatedBy:string|null;
  updatedByName:string|null; createdAt:string; updatedAt:string; version:number;
};
type CalendarItem = CalendarEvent & {holiday?:boolean;holidayType?:"public"|"school"};
type HolidayFeedStatus = {holidayWise:boolean;kpm:boolean;publicHolidayCount:number;schoolHolidayCount:number;holidayWiseError:string|null};
type WorkspaceSource = {id:string;name:string;role:"owner"|"editor"|"viewer"};
type Props = {
  events:CalendarEvent[]; holidays:CalendarItem[]; eventsLoading:boolean; eventsError:string; workspaces:WorkspaceSource[];
  canManageEvent:(event:CalendarEvent)=>boolean;
  holidayFeedStatus:HolidayFeedStatus|null; holidayState:string; onHolidayStateChange:(value:string)=>void;
  calendarMode:"month"|"week"; setCalendarMode:Dispatch<SetStateAction<"month"|"week">>;
  calendarCursor:Date; setCalendarCursor:Dispatch<SetStateAction<Date>>; calendarHeading:string;
  calendarDays:Date[]; calendarAgendaItems:CalendarItem[]; calendarTransferBusy:boolean;
  calendarIcsInputRef:RefObject<HTMLInputElement>;
  onImportCalendarIcs:(file:File)=>void; onExportCalendarIcs:()=>void; onMoveCalendar:(amount:number)=>void;
  onEditEvent:(event:CalendarEvent)=>void; onDeleteEvent:(event:CalendarEvent)=>void;
};
function dateKey(value:Date):string {
  return value.getFullYear()+"-"+String(value.getMonth()+1).padStart(2,"0")+"-"+String(value.getDate()).padStart(2,"0");
}
export default function CalendarView(props:Props) {
  const {events,holidays,eventsLoading,eventsError,workspaces,canManageEvent,holidayFeedStatus,holidayState,onHolidayStateChange,
    calendarMode,setCalendarMode,calendarCursor,setCalendarCursor,calendarHeading,calendarDays,
    calendarTransferBusy,calendarIcsInputRef,onImportCalendarIcs,onExportCalendarIcs,
    onMoveCalendar,onEditEvent,onDeleteEvent}=props;
  const [selectedDate,setSelectedDate]=useState<Date|null>(null);
  const [workspaceFilter,setWorkspaceFilter]=useState<string>(()=>{try{return localStorage.getItem("kitanotes-calendar-workspace-filter")??"all";}catch{return "all";}});
  const workspaceColors=["#6477d8","#159b83","#d18a36","#b36ac8","#d46d78","#4389b7","#82933c","#98765b"];
  const workspaceById=useMemo(()=>new Map(workspaces.map(workspace=>{const hash=Array.from(workspace.id).reduce((value,char)=>((value*31)+char.charCodeAt(0))>>>0,7);return [workspace.id,{...workspace,color:workspaceColors[hash%workspaceColors.length]}] as const;})),[workspaces]);
  const visibleEvents=workspaceFilter==="all"?events:events.filter(event=>event.workspaceId===workspaceFilter);
  function setWorkspaceFilterValue(value:string){setWorkspaceFilter(value);try{localStorage.setItem("kitanotes-calendar-workspace-filter",value);}catch{/* storage may be unavailable */}}

  function occursOnDay(item:CalendarItem,day:Date):boolean {
    const startKey=dateKey(new Date(item.startsAt));
    const lastVisibleKey=dateKey(new Date(new Date(item.endsAt).getTime()-1));
    const key=dateKey(day);
    return key>=startKey&&key<=lastVisibleKey;
  }
  function eventsForDay(day:Date):CalendarEvent[]{return visibleEvents.filter(item=>occursOnDay(item,day));}
  function holidaysForDay(day:Date):CalendarItem[]{return holidays.filter(item=>occursOnDay(item,day));}
  function holidayTypesForDay(day:Date):Array<"public"|"school"> {
    return [...new Set(holidaysForDay(day).map(item=>item.holidayType||"public"))];
  }
  const selectedDayItems:CalendarItem[]=selectedDate?[...eventsForDay(selectedDate),...holidaysForDay(selectedDate)].sort((a,b)=>new Date(a.startsAt).getTime()-new Date(b.startsAt).getTime()):[];
  const selectedDateLabel=selectedDate?.toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long",year:"numeric"})||"";
  const periodStart=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1);
  const periodEnd=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);
  const monthItems:CalendarItem[]=[...visibleEvents,...holidays].filter(item=>new Date(item.startsAt)<periodEnd&&new Date(item.endsAt)>periodStart).sort((a,b)=>new Date(a.startsAt).getTime()-new Date(b.startsAt).getTime());
  const monthEventCount=monthItems.filter(item=>!item.holiday).length;
  const monthPublicHolidayCount=monthItems.filter(item=>item.holiday&&item.holidayType!=="school").length;
  const monthSchoolHolidayCount=monthItems.filter(item=>item.holiday&&item.holidayType==="school").length;
  function showMonthSummary(){setSelectedDate(null);}
  function movePeriod(amount:number){setSelectedDate(null);onMoveCalendar(amount);}
  function goToToday(){setSelectedDate(null);setCalendarCursor(new Date());}
  function dateRange(item:CalendarItem):string {
    const start=new Date(item.startsAt).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric",timeZone:item.timezone});
    const end=new Date(new Date(item.endsAt).getTime()-1).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric",timeZone:item.timezone});
    return start===end?start:start+" – "+end;
  }

  return <section className="calendar-section">
    {eventsError&&<div className="inline-error">{eventsError}</div>}
    <div className="calendar-toolbar"><div className="calendar-navigation"><button className="secondary-button" onClick={goToToday}>Today</button><button className="calendar-arrow" onClick={()=>movePeriod(-1)} aria-label="Previous period">‹</button><button className="calendar-arrow" onClick={()=>movePeriod(1)} aria-label="Next period">›</button><h2>{calendarHeading}</h2></div><div className="calendar-mode"><button className={calendarMode==="month"?"active":""} onClick={()=>setCalendarMode("month")}>Month</button><button className={calendarMode==="week"?"active":""} onClick={()=>setCalendarMode("week")}>Week</button></div><div className="calendar-tools"><label className="field-label holiday-state-select">Holiday region<select className="invite-input" value={holidayState} onChange={e=>void onHolidayStateChange(e.target.value)}><option value="selangor">Selangor</option><option value="kuala-lumpur">Kuala Lumpur</option><option value="johor">Johor</option><option value="kedah">Kedah</option><option value="kelantan">Kelantan</option><option value="melaka">Melaka</option><option value="negeri-sembilan">Negeri Sembilan</option><option value="pahang">Pahang</option><option value="perak">Perak</option><option value="perlis">Perlis</option><option value="pulau-pinang">Pulau Pinang</option><option value="sabah">Sabah</option><option value="sarawak">Sarawak</option><option value="terengganu">Terengganu</option><option value="labuan">Labuan</option><option value="putrajaya">Putrajaya</option></select></label><input ref={calendarIcsInputRef} type="file" accept=".ics,text/calendar" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void onImportCalendarIcs(file);}}/><button className="secondary-button" onClick={()=>calendarIcsInputRef.current?.click()} disabled={calendarTransferBusy}><Upload size={14}/> Import .ics</button><button className="secondary-button" onClick={()=>void onExportCalendarIcs()} disabled={calendarTransferBusy}><Download size={14}/> Export .ics</button></div></div>
    <p className="calendar-sync-note">Import calendars from Apple Calendar, Google Calendar or Outlook using .ics files. Public holidays and KPM school breaks for {holidayState.replace(/-/g," ")} are marked on the calendar. Select a date to see event and holiday details. Sources: <a href="https://holidaywise.wee.my" target="_blank" rel="noreferrer">HolidayWise</a> · <a href="https://www.moe.gov.my/kalendar-akademik-semasa" target="_blank" rel="noreferrer">KPM</a>.</p>
    <div className="calendar-workspace-filters" role="group" aria-label="Filter calendar by workspace"><button type="button" className={workspaceFilter==="all"?"chip active":"chip"} onClick={()=>setWorkspaceFilterValue("all")}>All workspaces</button>{workspaces.map(workspace=>{const source=workspaceById.get(workspace.id)!;return <button type="button" key={workspace.id} className={workspaceFilter===workspace.id?"chip active":"chip"} onClick={()=>setWorkspaceFilterValue(workspace.id)} aria-pressed={workspaceFilter===workspace.id}><i className="calendar-workspace-dot" style={{backgroundColor:source.color}}/>{workspace.name}</button>;})}{workspaceFilter!=="all"&&!workspaces.some(item=>item.id===workspaceFilter)&&<button type="button" className="chip active" onClick={()=>setWorkspaceFilterValue("all")}>Clear unavailable filter</button>}</div>
    {workspaceFilter!=="all"&&<p className="calendar-filtered-note">Filtered to {workspaceById.get(workspaceFilter)?.name??"one workspace"}. Other workspace events are hidden.</p>}
    <div className="calendar-legend" aria-label="Calendar legend"><span><i className="calendar-legend-dot event"/>KitaNotes event</span><span><i className="calendar-legend-dot public"/>Public holiday</span><span><i className="calendar-legend-dot school"/>School holiday</span></div>
    {holidayFeedStatus&&!holidayFeedStatus.holidayWise&&<div className="inline-error holiday-feed-warning">Public holiday data is temporarily unavailable. {holidayFeedStatus.schoolHolidayCount>0?"KPM school holidays are still available.":"School holiday data is also unavailable."} {holidayFeedStatus.holidayWiseError||"The feed could not be reached."}</div>}
    {eventsLoading?<div className="loading-state">Loading your calendar…</div>:<div className={calendarMode==="month"?"calendar-grid month-grid":"calendar-grid week-grid"}>{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day=><div className="calendar-weekday" key={day}>{day}</div>)}{calendarDays.map(day=><div className={"calendar-day"+(day.getMonth()!==calendarCursor.getMonth()&&calendarMode==="month"?" outside":"")+(dateKey(day)===dateKey(new Date())?" today":"")+(selectedDate&&dateKey(day)===dateKey(selectedDate)?" selected":"")} key={dateKey(day)}><div className="calendar-day-heading"><button type="button" className="calendar-day-select" aria-pressed={!!selectedDate&&dateKey(day)===dateKey(selectedDate)} aria-label={"Show events for "+day.toLocaleDateString(undefined,{dateStyle:"full"})} onClick={()=>setSelectedDate(day)}><span>{day.getDate()}</span></button>{calendarMode==="week"&&<small>{day.toLocaleDateString(undefined,{month:"short"})}</small>}</div><button type="button" className="calendar-day-markers" onClick={()=>setSelectedDate(day)} aria-label={"View "+(eventsForDay(day).length+holidaysForDay(day).length)+" items on "+day.toLocaleDateString(undefined,{dateStyle:"full"})} title="View this day's details"><span className="calendar-marker-list">{eventsForDay(day).map(item=><i key={item.id} className="calendar-marker event" title={(workspaceById.get(item.workspaceId)?.name??"Workspace")+": "+item.title} style={{backgroundColor:workspaceById.get(item.workspaceId)?.color??undefined}}/>) }{holidayTypesForDay(day).map(type=><i key={type} className={"calendar-marker "+type} title={type==="school"?"KPM school holiday":"Public holiday"}/>)}</span>{calendarMode==="week"&&(eventsForDay(day).length+holidaysForDay(day).length)>0&&<small>View details</small>}</button></div>)}</div>}

    <section className="calendar-selected-agenda" aria-live="polite">
      {!selectedDate?<><div className="calendar-agenda-heading"><div><span className="calendar-agenda-eyebrow">MONTHLY SUMMARY</span><h3>{calendarHeading}</h3></div><span className="calendar-agenda-count">{monthItems.length} {monthItems.length===1?"item":"items"}</span></div>
        <div className="calendar-month-summary-stats"><div><strong>{monthEventCount}</strong><span>Events</span></div><div><strong>{monthPublicHolidayCount}</strong><span>Public holidays</span></div><div><strong>{monthSchoolHolidayCount}</strong><span>School holidays</span></div></div>
        {eventsLoading?<p className="calendar-selected-empty">Loading this month’s schedule…</p>:monthItems.length===0?<p className="calendar-selected-empty">Nothing scheduled for this month yet.</p>:<div className="calendar-month-summary-list">{monthItems.map(item=><article className={"calendar-detail-card"+(item.holiday?" holiday "+(item.holidayType||"public"):" personal-event")} key={(item.holiday?"holiday-":"event-")+item.id}>
          <span className={"calendar-detail-marker "+(item.holiday?(item.holidayType||"public"):"event")} style={!item.holiday?{backgroundColor:workspaceById.get(item.workspaceId)?.color}:undefined}/><div className="calendar-detail-copy"><div className="calendar-detail-meta"><span>{item.holiday?(item.holidayType==="school"?"SCHOOL HOLIDAY · KPM":"PUBLIC HOLIDAY · MALAYSIA"):(workspaceById.get(item.workspaceId)?.name??"WORKSPACE EVENT")}</span>{item.allDay&&<span>ALL DAY</span>}</div><h4>{item.title}</h4><p className="calendar-detail-date">{dateRange(item)}{!item.allDay?" · "+new Date(item.startsAt).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit",timeZone:item.timezone}):""}</p>{item.description&&<p className="calendar-detail-description">{item.description}</p>}</div>
          {!item.holiday&&canManageEvent(item)&&<div className="calendar-detail-actions"><button className="mini-icon" onClick={()=>onEditEvent(item)} aria-label={"Edit "+item.title}><Pencil size={15}/></button><button className="mini-icon" onClick={()=>onDeleteEvent(item)} aria-label={"Delete "+item.title}><Archive size={15}/></button></div>}
        </article>)}</div>}
      </>:<><div className="calendar-agenda-heading"><div><span className="calendar-agenda-eyebrow">DAY DETAILS</span><h3>{selectedDateLabel}</h3></div><div><button className="secondary-button" type="button" onClick={showMonthSummary}>Monthly summary</button><span className="calendar-agenda-count">{selectedDayItems.length} {selectedDayItems.length===1?"item":"items"}</span></div></div>
        {selectedDayItems.length===0?<p className="calendar-selected-empty">No events or holidays on this date.</p>:selectedDayItems.map(item=><article className={"calendar-detail-card"+(item.holiday?" holiday "+(item.holidayType||"public"):" personal-event")} key={item.id}>
          <span className={"calendar-detail-marker "+(item.holiday?(item.holidayType||"public"):"event")} style={!item.holiday?{backgroundColor:workspaceById.get(item.workspaceId)?.color}:undefined}/><div className="calendar-detail-copy"><div className="calendar-detail-meta"><span>{item.holiday?(item.holidayType==="school"?"SCHOOL HOLIDAY · KPM":"PUBLIC HOLIDAY · MALAYSIA"):(workspaceById.get(item.workspaceId)?.name??"WORKSPACE EVENT")}</span>{item.allDay&&<span>ALL DAY</span>}</div><h4>{item.title}</h4><p className="calendar-detail-date">{dateRange(item)}{!item.allDay?" · "+new Date(item.startsAt).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit",timeZone:item.timezone})+" – "+new Date(item.endsAt).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit",timeZone:item.timezone}):""}</p>{item.description&&<p className="calendar-detail-description">{item.description}</p>}
            {item.holiday&&item.holidayType==="school"&&<p className="calendar-detail-source">Kalendar Akademik Kementerian Pendidikan Malaysia · {holidayState.replace(/-/g," ")}</p>}{item.holiday&&item.holidayType==="public"&&<p className="calendar-detail-source">Cuti umum persekutuan / negeri · {holidayState.replace(/-/g," ")}</p>}</div>
          {!item.holiday&&canManageEvent(item)&&<div className="calendar-detail-actions"><button className="mini-icon" onClick={()=>onEditEvent(item)} aria-label={"Edit "+item.title}><Pencil size={15}/></button><button className="mini-icon" onClick={()=>onDeleteEvent(item)} aria-label={"Delete "+item.title}><Archive size={15}/></button></div>}
        </article>)}</>}
    </section>


  </section>;
}
