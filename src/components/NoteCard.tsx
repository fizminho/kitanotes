import { memo } from "react";
import { Archive, Pencil, RotateCcw, Trash2 } from "lucide-react";

export type NoteCardNote = {
  id:string; workspaceId:string; title:string; content:string; categoryId:string|null;
  categoryName:string|null; createdBy:string; createdByName:string|null;
  updatedBy:string|null; updatedByName:string|null;
  version:number; createdAt:string; updatedAt:string; archivedAt:string|null; deletedAt?:string|null;
};

type Props = {
  note:NoteCardNote; canWrite:boolean; showArchived:boolean; isTrash?:boolean;
  onView:(note:NoteCardNote)=>void; onEdit:(note:NoteCardNote)=>void; onArchive:(note:NoteCardNote)=>void;
  onRestore:(note:NoteCardNote)=>void; onDelete:(note:NoteCardNote)=>void;
};

function NoteCard({note,canWrite,showArchived,isTrash=false,onView,onEdit,onArchive,onRestore,onDelete}:Props) {
  return <article className="note-card">
    <div className="note-card-top">{note.categoryName&&<span className="note-category">{note.categoryName}</span>}<span className="note-date">{new Date(note.updatedAt).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</span></div>
    <button type="button" className="note-card-open" onClick={()=>onView(note)} aria-label={"View full note: "+note.title}>
      <h3>{note.title}</h3><p>{note.content||"No additional details."}</p>
      <small className="record-audit">Created by {note.createdByName||"Workspace member"} · {new Date(note.createdAt).toLocaleString()}<br/>Last updated by {note.updatedByName||note.createdByName||"Workspace member"} · {new Date(note.updatedAt).toLocaleString()}</small>
      <span className="note-open-hint">Tap to read full note</span>
    </button>
    <div className="note-card-actions">{canWrite&&!showArchived&&<button onClick={()=>onEdit(note)}><Pencil size={14}/> Edit</button>}{canWrite&&!showArchived&&<button onClick={()=>onArchive(note)}><Archive size={14}/> Archive</button>}{canWrite&&showArchived&&<button onClick={()=>onRestore(note)}><RotateCcw size={14}/> {isTrash?"Restore from Trash":"Restore"}</button>}{canWrite&&showArchived&&!isTrash&&<button className="danger-action" onClick={()=>onDelete(note)}><Trash2 size={14}/> Delete</button>}{isTrash&&note.deletedAt&&<span className="note-date">In Trash since {new Date(note.deletedAt).toLocaleDateString()}</span>}{!canWrite&&<span className="note-date">View only</span>}</div>
  </article>;
}

export default memo(NoteCard);
