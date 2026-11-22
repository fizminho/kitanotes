import type { Dispatch, RefObject, SetStateAction } from "react";
import { Plus, Sparkles, X } from "lucide-react";

type Category = { id:string; workspaceId:string; name:string; color:string|null; sortOrder:number };
type AiStatus = { configured:boolean; dailyLimit:number; dailyUsed:number; dailyRemaining:number };
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
type Props = {
  aiStatus:AiStatus|null; aiDraft:AiDraft|null;
  aiDraftTitle:string; setAiDraftTitle:Dispatch<SetStateAction<string>>;
  aiDraftContent:string; setAiDraftContent:Dispatch<SetStateAction<string>>;
  aiInput:string; setAiInput:Dispatch<SetStateAction<string>>;
  aiWorking:boolean; aiError:string;
  ocrFile:File|null; setOcrFile:Dispatch<SetStateAction<File|null>>;
  galleryInputRef:RefObject<HTMLInputElement>; cameraInputRef:RefObject<HTMLInputElement>;
  ocrPreviewUrl:string; ocrWorking:boolean; scanImageWithAi:()=>void;
  organizeWithAi:(value:string)=>void; categories:Category[];
  selectedCategoryId:string; setSelectedCategoryId:Dispatch<SetStateAction<string>>;
  aiNoteSaved:boolean; aiItemsCreated:boolean; aiSavingNote:boolean; aiCreatingItems:boolean;
  saveAiNote:()=>void; onClose:()=>void; onStartOver:()=>void;
};

export default function AiAssistantModal(props:Props) {
  const {aiStatus,aiDraft,aiDraftTitle,setAiDraftTitle,aiDraftContent,setAiDraftContent,aiInput,setAiInput,
    aiWorking,aiError,ocrFile,setOcrFile,galleryInputRef,cameraInputRef,ocrPreviewUrl,ocrWorking,
    scanImageWithAi,organizeWithAi,categories,selectedCategoryId,setSelectedCategoryId,aiNoteSaved,
    aiItemsCreated,aiSavingNote,aiCreatingItems,saveAiNote,onClose,onStartOver}=props;
  return <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="composer ai-composer" role="dialog" aria-modal="true" aria-labelledby="ai-title">
      <header><div><span className="eyebrow">CREATE WITH AI</span><h2 id="ai-title">AI Note Assistant</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></header>
      {!aiStatus?<p className="ai-privacy-copy">Checking AI availability…</p>:!aiStatus.configured?<div className="ai-privacy-card"><strong>AI is not configured yet.</strong><p>AI features will be available once the service is configured.</p></div>:!aiDraft?<div>
        <p className="ai-privacy-copy">Describe what you want to capture or choose an image. AI can draft a note, detect events and prepare reminders. Text or images you submit are processed by an external AI service. Check the generated note before saving.</p>
        <textarea className="ai-input" value={aiInput} onChange={event=>setAiInput(event.target.value)} maxLength={16000} rows={7} placeholder="Example: Meeting with Sarah next Tuesday at 10 AM. I need to finish the proposal beforehand and remind me 30 minutes early…"/>
        <div className="ai-usage-row"><span>{aiInput.length.toLocaleString()} / 16,000 characters</span></div>
        <div className="ai-draft-section">
          <strong>Add an image</strong>
          <p className="ai-privacy-copy">Choose an image from your photo library or take a new picture. Images are checked for clear, useful text. Unreadable fragments and visual noise are discarded. Images are not stored by KitaNotes.</p>
          <input ref={galleryInputRef} className="visually-hidden-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>{setOcrFile(event.target.files?.[0]??null);setAiInput("");}}/>
          <input ref={cameraInputRef} className="visually-hidden-file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event=>{setOcrFile(event.target.files?.[0]??null);setAiInput("");}}/>
          <div className="image-source-actions"><button className="secondary-button" onClick={()=>galleryInputRef.current?.click()}><Plus size={15}/> Choose from gallery</button><button className="secondary-button" onClick={()=>cameraInputRef.current?.click()}><Plus size={15}/> Take a photo</button></div>
          {ocrFile&&<div className="selected-image-row"><span>{ocrFile.name}</span><button className="text-action" onClick={()=>{setOcrFile(null);setAiInput("");}}>Remove image</button></div>}
          {ocrPreviewUrl&&<img className="ocr-image-preview" src={ocrPreviewUrl} alt="Selected image preview"/>}
          <button className="secondary-button" onClick={scanImageWithAi} disabled={!ocrFile||ocrWorking}>{ocrWorking?"Reading image…":"Add extracted text to note"}</button>
        </div>
        {aiError&&<p className="invite-error">{aiError}</p>}
        <footer><button className="primary-button" onClick={()=>organizeWithAi(aiInput)} disabled={!aiInput.trim()||aiWorking}>{aiWorking?"Preparing…":"Create draft"}</button></footer>
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
        <footer><button className="text-action" onClick={onStartOver}>Start over</button><button className="primary-button" onClick={saveAiNote} disabled={aiSavingNote||aiCreatingItems||!aiDraftTitle.trim()}>{aiSavingNote?"Saving…":aiNoteSaved?"Finish saving calendar":"Save note & calendar"}</button></footer>
      </div>}
    </section>
  </div>;
}
