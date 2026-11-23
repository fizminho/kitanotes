import { useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { Archive, Download, Pencil, Upload } from "lucide-react";

type CalendarEvent = {
  id:string; workspaceId:string; title:string; description:string; startsAt:string; endsAt:string;
  timezone:string; allDay:boolean; linkedNoteId:string|null; createdBy:string;
  createdByName:string|null; createdByEmail:string|null; updatedBy:string|null;
  updatedByName:string|null; updatedByEmail:string|null; createdAt:string; updatedAt:string; version:number;
};
type CalendarItem = CalendarEvent & {holiday?:boolean;holidayType?:"public"|"school"};
type HolidayFeedStatus = {holidayWise:boolean;kpm:boolean;publicHolidayCount:number;schoolHolidayCount:number;holidayWiseError:string|null};
type Props = {
  events:CalendarEvent[]; holidays:CalendarItem[]; eventsLoading:boolean; eventsError:string;
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
  const {events,holidays,eventsLoading,eventsError,holidayFeedStatus,holidayState,onHolidayStateChange,
    calendarMode,setCalendarMode,calendarCursor,setCalendarCursor,calendarHeading,calendarDays,
    calendarAgendaItems,calendarTransferBusy,calendarIcsInputRef,onImportCalendarIcs,onExportCalendarIcs,
    onMoveCalendar,onEditEvent,onDeleteEvent}=props;
  const [selectedDate,setSelectedDate]=useState(()=>new Date());

  function occursOnDay(item:CalendarItem,day:Date):boolean {
    const startKey=dateKey(new Date(item.startsAt));
    const lastVisibleKey=dateKey(new Date(new Date(item.endsAt).getTime()-1));
    const key=dateKey(day);
    return key>=startKey&&key<=lastVisibleKey;
  }
  function eventsForDay(day:Date):CalendarItem[]{return [...events.filter(item=>occursOnDay(item,day)),...holidays.filter(item=>occursOnDay(item,day))];}
  const selectedDayItems=eventsForDay(selectedDate).sort((a,b)=>new Date(a.startsAt).getTime()-new Date(b.startsAt).getTime());
  const selectedDateLabel=selectedDate.toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long",year:"numeric"});

  return <section className="calendar-section">
    {eventsError&&<div className="inline-error">{eventsError}</div>}
    <div className="calendar-toolbar"><div className="calendar-navigation"><button className="secondary-button" onClick={()=>setCalendarCursor(new Date())}>Today</button><button className="calendar-arrow" onClick={()=>onMoveCalendar(-1)} aria-label="Previous period">‹</button><button className="calendar-arrow" onClick={()=>onMoveCalendar(1)} aria-label="Next period">›</button><h2>{calendarHeading}</h2></div><div className="calendar-mode"><button className={calendarMode==="month"?"active":""} onClick={()=>setCalendarMode("month")}>Month</button><button className={calendarMode==="week"?"active":""} onClick={()=>setCalendarMode("week")}>Week</button></div><div className="calendar-tools"><label className="field-label holiday-state-select">Holiday region<select className="invite-input" value={holidayState} onChange={e=>void onHolidayStateChange(e.target.value)}><option value="selangor">Selangor</option><option value="kuala-lumpur">Kuala Lumpur</option><option value="johor">Johor</option><option value="kedah">Kedah</option><option value="kelantan">Kelantan</option><option value="melaka">Melaka</option><option value="negeri-sembilan">Negeri Sembilan</option><option value="pahang">Pahang</option><option value="perak">Perak</option><option value="perlis">Perlis</option><option value="pulau-pinang">Pulau Pinang</option><option value="sabah">Sabah</option><option value="sarawak">Sarawak</option><option value="terengganu">Terengganu</option><option value="labuan">Labuan</option><option value="putrajaya">Putrajaya</option></select></label><input ref={calendarIcsInputRef} type="file" accept=".ics,text/calendar" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void onImportCalendarIcs(file);}}/><button className="secondary-button" onClick={()=>calendarIcsInputRef.current?.click()} disabled={calendarTransferBusy}><Upload size={14}/> Import .ics</button><button className="secondary-button" onClick={()=>void onExportCalendarIcs()} disabled={calendarTransferBusy}><Download size={14}/> Export .ics</button></div></div>
    <p className="calendar-sync-note">Import calendars from Apple Calendar, Google Calendar or Outlook using .ics files. Public holidays and KPM school breaks for {holidayState.replace(/-/g," ")} are shown automatically. Sources: <a href="https://holidaywise.wee.my" target="_blank" rel="noreferrer">HolidayWise</a> · <a href="https://www.moe.gov.my/kalendar-akademik-semasa" target="_blank" rel="noreferrer">KPM</a>.</p>
    {holidayFeedStatus&&!holidayFeedStatus.holidayWise&&<div className="inline-error holiday-feed-warning">Public holiday data is temporarily unavailable. {holidayFeedStatus.schoolHolidayCount>0?"KPM school holidays are still available.":"School holiday data is also unavailable."} {holidayFeedStatus.holidayWiseError||"The feed could not be reached."}</div>}
    {eventsLoading?<div className="loading-state">Loading your calendar…</div>:<div className={calendarMode==="month"?"calendar-grid month-grid":"calendar-grid week-grid"}>{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day=><div className="calendar-weekday" key={day}>{day}</div>)}{calendarDays.map(day=><div className={"calendar-day"+(day.getMonth()!==calendarCursor.getMonth()&&calendarMode==="month"?" outside":"")+(dateKey(day)===dateKey(new Date())?" today":"")+(dateKey(day)===dateKey(selectedDate)?" selected":"")} key={dateKey(day)}><div className="calendar-day-heading"><button type="button" className="calendar-day-select" aria-pressed={dateKey(day)===dateKey(selectedDate)} aria-label={"Show events for "+day.toLocaleDateString(undefined,{dateStyle:"full"})} onClick={()=>setSelectedDate(day)}><span>{day.getDate()}</span></button>{calendarMode==="week"&&<small>{day.toLocaleDateString(undefined,{month:"short"})}</small>}</div><div className="calendar-day-events">{eventsForDay(day).map(item=><button className={"calendar-event-chip"+(item.holiday?(item.holidayType==="school"?" school-holiday-chip":" holiday-event-chip"):"")} key={item.id} onClick={()=>{if(!item.holiday)onEditEvent(item);}} title={item.holiday?item.title+(item.holidayType==="school"?" · School holiday":" · Malaysia public holiday"):item.title}><span>{item.allDay?"All day":new Date(item.startsAt).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit",timeZone:item.timezone})}</span>{item.title}</button>)}</div>{calendarMode==="week"&&eventsForDay(day).length===0&&<span className="calendar-empty-day">No events</span>}</div>)}</div>}

    <div className="calendar-selected-agenda">
      <h3>{selectedDateLabel}</h3>
      {selectedDayItems.length===0?<p className="calendar-selected-empty">Nothing scheduled for this date.</p>:selectedDayItems.map(item=><article className={"event-card"+(item.holiday?(item.holidayType==="school"?" school-holiday-card":" holiday-event-card"):"")} key={item.id}>
        <div className="event-date-block"><strong>{item.allDay?"ALL":new Date(item.startsAt).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit",timeZone:item.timezone})}</strong><span>{item.allDay?"DAY":item.timezone}</span></div>
        <div className="event-copy"><h3>{item.title}</h3>{item.description&&<p>{item.description}</p>}{item.holiday&&<small>{item.holidayType==="school"?"School holiday · KPM":"Malaysia public holiday"}</small>}</div>
        {!item.holiday&&<button className="mini-icon" onClick={()=>onEditEvent(item)} aria-label={"Edit "+item.title}><Pencil size={15}/></button>}
      </article>)}
    </div>

    {!eventsLoading&&events.length===0&&holidays.length===0&&<div className="calendar-empty-note">Nothing scheduled in this period. Add an event to start filling the calendar.</div>}
    <div className="calendar-agenda"><h3>Upcoming in this view</h3>{calendarAgendaItems.map(item=><article className={"event-card"+(item.holiday?(item.holidayType==="school"?" school-holiday-card":" holiday-event-card"):"")} key={item.id}><div className="event-date-block"><strong>{new Date(item.startsAt).toLocaleDateString(undefined,{day:"2-digit",timeZone:item.timezone})}</strong><span>{new Date(item.startsAt).toLocaleDateString(undefined,{month:"short",timeZone:item.timezone})}</span></div><div className="event-copy"><h3>{item.title}</h3><p>{item.allDay?(()=>{const startLabel=new Date(item.startsAt).toLocaleDateString(undefined,{dateStyle:"long",timeZone:item.timezone});const endLabel=new Date(new Date(item.endsAt).getTime()-1).toLocaleDateString(undefined,{dateStyle:"long",timeZone:item.timezone});return (startLabel===endLabel?startLabel:startLabel+" – "+endLabel)+" · All day";})():new Date(item.startsAt).toLocaleString(undefined,{timeZone:item.timezone})+" · "+item.timezone}</p>{item.description&&<small>{item.description}</small>}{item.holiday?<span className={"holiday-kind-label"+(item.holidayType==="school"?" school-holiday-label":"")}>{item.holidayType==="school"?"School holiday · KPM":"Malaysia public holiday"}</span>:<small className="record-audit">Created by {item.createdByName||item.createdByEmail||"Unknown"} · {new Date(item.createdAt).toLocaleString()}<br/>Last updated by {item.updatedByName||item.updatedByEmail||item.createdByName||item.createdByEmail||"Unknown"} · {new Date(item.updatedAt).toLocaleString()}</small>}</div>{!item.holiday&&<><button className="mini-icon" onClick={()=>onEditEvent(item)} aria-label="Edit event"><Pencil size={15}/></button><button className="mini-icon" onClick={()=>onDeleteEvent(item)} aria-label="Delete event"><Archive size={15}/></button></>}</article>)}</div>
  </section>;
}
