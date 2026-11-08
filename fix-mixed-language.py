from pathlib import Path
from datetime import datetime

p = Path("ai-worker.js")
s = p.read_text(encoding="utf-8")

start = s.find("async function translate(id,inputRows,selected){")
end = s.find("\nself.onmessage=async", start)

if start < 0 or end < 0:
    raise SystemExit("PATCH CANCELLED: translate function markers not found.")

new_function = r'''
function isRomanHindi(text){
 const words=String(text||'').toLowerCase()
  .replace(/[^a-z\s]/g,' ').split(/\s+/).filter(Boolean);

 const hints=new Set([
  'aap','tum','main','mai','mujhe','hum','hume',
  'hai','hain','ho','hu','tha','thi','the',
  'kya','kaise','kaisa','kaisi','kyun','kyu',
  'nahi','nahin','mera','meri','mere','tera','teri',
  'kar','karo','karen','raha','rahi','rahe',
  'ka','ki','ke','ko','se','mein','me','aur',
  'bhai','acha','achha','theek','thik','chahiye',
  'batao','bolo','kuch','sab','ab','kal','kab',
  'kahan','yahan','wahan','liye','wala','wali'
 ]);

 return words.filter(w=>hints.has(w)).length>=2;
}

async function translate(id,inputRows,selected){
 const originals=inputRows.map(r=>({
  ...r,sourceText:r.sourceText??r.text??''
 }));
 if(!originals.length)throw Error('Generate subtitles first.');

 const translated=originals.map(r=>r.sourceText);
 const groups={};
 let preserved=0;

 for(let i=0;i<originals.length;i++){
  const text=String(originals[i].sourceText||'').trim();
  if(!text){preserved++;continue;}

  let source=selected;

  if(selected==='auto'){
   // Native Hindi script: preserve it.
   if(isHindi(text)||isRomanHindi(text)){
    preserved++;
    continue;
   }

   // Detect each subtitle separately, not the whole mixed transcript.
   try{
    if(!detector){
     progress(id,'Loading language detector...');
     detector=await pipeline(
      'text-classification',
      'onnx-community/xlm-roberta-base-language-detection-ONNX',
      {dtype:'q8'}
     );
    }

    const result=await detector(text.slice(0,500),{
     top_k:1,truncation:true
    });
    const prediction=Array.isArray(result?.[0])
     ?result[0][0]:result?.[0];

    const key=String(prediction?.label||'').toLowerCase()
     .replace(/^__label__/,'').replace(/^label_/,'');
    source=labels[key];

    if(!source||typeof prediction?.score!=='number'
       ||prediction.score<0.45){
     preserved++;
     continue;
    }
   }catch(e){
    console.warn('Subtitle language detection skipped:',e);
    preserved++;
    continue;
   }
  }

  if(source==='hindi'){
   preserved++;
   continue;
  }

  if(!codes[source]){
   preserved++;
   continue;
  }

  (groups[source]??=[]).push(i);
 }

 const sources=Object.keys(groups);

 if(sources.length){
  if(!translator){
   progress(id,'Loading Hindi translation model...');
   const previous=env.remoteHost;
   env.remoteHost=PROXY;
   try{
    translator=await pipeline(
     'translation',
     'Xenova/nllb-200-distilled-600M',
     {dtype:'q8'}
    );
   }finally{
    env.remoteHost=previous;
   }
  }

  for(const source of sources){
   const indexes=groups[source];

   for(let start=0;start<indexes.length;start+=4){
    const batchIndexes=indexes.slice(start,start+4);
    const inputs=batchIndexes.map(i=>originals[i].sourceText);

    progress(id,`Translating ${source}: ${Math.min(start+4,indexes.length)}/${indexes.length}`);

    const results=await translator(inputs,{
     src_lang:codes[source],
     tgt_lang:'hin_Deva'
    });

    if(!Array.isArray(results)||results.length!==inputs.length)
     throw Error('Translation response invalid for '+source);

    results.forEach((r,j)=>{
     const value=String(r?.translation_text||'').trim();
     if(value)translated[batchIndexes[j]]=value;
     else preserved++;
    });
   }
  }
 }

 const count=originals.length-preserved;
 return {
  rows:originals.map((r,i)=>({...r,text:translated[i]})),
  message:`Hindi ready: ${count} translated, ${preserved} preserved (Hindi/uncertain).`
 };
}
'''

backup=p.with_name(
 "ai-worker.js.before-mixed-language-"+datetime.now().strftime("%Y%m%d-%H%M%S")
)
backup.write_text(s,encoding="utf-8")

updated=s[:start]+new_function+s[end:]
tmp=Path("ai-worker.js.tmp")
tmp.write_text(updated,encoding="utf-8")
tmp.replace(p)

print("PATCH SUCCESS")
print("Backup:",backup)
