from pathlib import Path
from datetime import datetime

p = Path("ai-worker.js")
s = p.read_text(encoding="utf-8")

if "let asr=null,translator=null,detector=null;" not in s:
    raise SystemExit("CANCELLED: translator declaration not found.")

start = s.find("  for(const source of sources){")
end = s.find("\n }\n\n const count=", start)

if start < 0 or end < 0:
    raise SystemExit("CANCELLED: translation loop markers not found.")

backup = Path(
    "ai-worker.js.before-translation-engine-" +
    datetime.now().strftime("%Y%m%d-%H%M%S")
)
backup.write_text(s, encoding="utf-8")

s = s.replace(
    "let asr=null,translator=null,detector=null;",
    "let asr=null,translator=null,translatorModel=null,detector=null;",
    1
)

# Recalculate positions after declaration edit.
start = s.find("  for(const source of sources){")
end = s.find("\n }\n\n const count=", start)

new_loop = r'''  for(const source of sources){
   const indexes=groups[source];

   let modelName;
   if(source==='english'){
    modelName='Xenova/opus-mt-en-hi';
   }else{
    modelName='Xenova/nllb-200-distilled-600M';
   }

   if(!translator||translatorModel!==modelName){
    progress(id,source==='english'
     ?'Loading lightweight English-Hindi model...'
     :'Loading multilingual Hindi translation model...');

    if(source==='english'){
     translator=await pipeline(
      'translation',
      modelName,
      {dtype:'q8'}
     );
    }else{
     const previous=env.remoteHost;
     env.remoteHost=PROXY;
     try{
      translator=await pipeline(
       'translation',
       modelName,
       {dtype:'q8'}
      );
     }finally{
      env.remoteHost=previous;
     }
    }
    translatorModel=modelName;
   }

   for(let start=0;start<indexes.length;start+=4){
    const batchIndexes=indexes.slice(start,start+4);
    const inputs=batchIndexes.map(i=>originals[i].sourceText);

    progress(id,`Translating ${source}: ${Math.min(start+4,indexes.length)}/${indexes.length}`);

    const results=source==='english'
     ?await translator(inputs)
     :await translator(inputs,{
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
  }'''

s = s[:start] + new_loop + s[end:]

Path("ai-worker.js.tmp").write_text(s, encoding="utf-8")
Path("ai-worker.js.tmp").replace(p)

print("PATCH SUCCESS")
print("Backup:", backup)
