from pathlib import Path
from datetime import datetime
import shutil

p=Path("index.html")
s=p.read_text(encoding="utf-8")

def check(old,label):
    n=s.count(old)
    if n!=1:
        raise SystemExit(f"PATCH CANCELLED: {label} match={n}. index.html unchanged.")

old_import="""import { pipeline, env } from
 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2';"""

old_state="""let file=null, videoURL=null, rows=[], asr=null, translator=null, languageDetector=null;
let busy=false;
let translatorModelId=null;
let translationStage='general processing';"""

check(old_import,"Transformers import")
check(old_state,"AI state")
check("// Detect the transcript language with a multilingual AI classifier.","translation function")
check("$('generate').onclick=async()=>{","Generate handler")
check("$('translate').onclick=async()=>{","Translate handler")
check("  status('Loading Whisper AI model. First download can be large...');","Whisper code")
check('<video id="video" controls playsinline>','Video preview')

s=s.replace(
 old_import,
 "// AI inference moved to ai-worker.js",
 1
)

new_state="""let file=null, videoURL=null, rows=[];
let busy=false;
let translationStage='general processing';

const aiWorker=new Worker(
 new URL('./ai-worker.js',import.meta.url),
 {type:'module'}
);
let workerSequence=0;
const workerPending=new Map();

aiWorker.onmessage=({data})=>{
 if(data.progress){
  status(data.progress);
  return;
 }
 const p=workerPending.get(data.id);
 if(!p)return;
 workerPending.delete(data.id);
 if(data.ok)p.resolve(data.result);
 else p.reject(new Error(data.error||'Background AI failed.'));
};
aiWorker.onerror=e=>{
 const error=new Error(e.message||'AI worker failed.');
 for(const p of workerPending.values())p.reject(error);
 workerPending.clear();
};
function workerRequest(type,payload={},transfer=[]){
 return new Promise((resolve,reject)=>{
  const id=++workerSequence;
  workerPending.set(id,{resolve,reject});
  try{
   aiWorker.postMessage({id,type,...payload},transfer);
  }catch(e){
   workerPending.delete(id);
   reject(e);
  }
 });
}"""

s=s.replace(old_state,new_state,1)

start=s.index("// Detect the transcript language with a multilingual AI classifier.")
end=s.index("$('generate').onclick=async()=>{",start)

translation="""async function translateRowsToHindi(){
 translationStage='background Hindi translation';
 if(!rows.length)throw new Error('Generate subtitles first.');

 const result=await workerRequest('translate',{
  rows,
  selectedLanguage:$('language').value
 });

 if(!result||!Array.isArray(result.rows))
  throw new Error('Invalid translation response.');

 rows=result.rows;
 render();
 progress(100);
 translationStage='complete';
 status(result.message||'Hindi subtitles ready.');
}

"""
s=s[:start]+translation+s[end:]

gen=s.index("$('generate').onclick=async()=>{")
a=s.index("  status('Loading Whisper AI model. First download can be large...');",gen)
b=s.index('  render();',a)+len('  render();')

generate="""  status('Preparing audio...');
  const audio=await getAudio();
  const lang=$('language').value;

  status('Whisper is transcribing in background...');
  const result=await workerRequest(
   'transcribe',
   {audioBuffer:audio.buffer,language:lang},
   [audio.buffer]
  );

  rows=result.map(r=>({
   ...r,
   end:Number.isFinite(r.end)
    ?r.end
    :Math.max(3,$('video').duration||3)
  }));

  if(!rows.length)throw new Error('No speech detected.');
  render();"""

s=s[:a]+generate+s[b:]
s=s.replace(
 '<video id="video" controls playsinline>',
 '<video id="video" controls playsinline preload="metadata">',
 1
)

if "workerRequest('translate'" not in s:
    raise SystemExit("Final validation failed. index.html unchanged.")

stamp=datetime.now().strftime("%Y%m%d-%H%M%S")
backup=Path("index.html.before-worker-fix-"+stamp)
shutil.copy2(p,backup)

tmp=Path("index.html.tmp")
tmp.write_text(s,encoding="utf-8")
tmp.replace(p)

print("PATCH SUCCESS")
print("Backup:",backup)
print("Worker: ai-worker.js")
