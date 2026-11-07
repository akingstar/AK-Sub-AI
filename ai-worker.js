import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2';

const PROXY='https://ak-sub-ai-nllb-proxy.akingstar205.workers.dev';
const codes={
 english:'eng_Latn',spanish:'spa_Latn',french:'fra_Latn',
 arabic:'arb_Arab',german:'deu_Latn',japanese:'jpn_Jpan',
 chinese:'zho_Hans',portuguese:'por_Latn',russian:'rus_Cyrl',
 italian:'ita_Latn',dutch:'nld_Latn',polish:'pol_Latn',
 swahili:'swh_Latn',thai:'tha_Thai',turkish:'tur_Latn',
 urdu:'urd_Arab',vietnamese:'vie_Latn',
 bulgarian:'bul_Cyrl',greek:'ell_Grek'
};
const labels={
 ar:'arabic',bg:'bulgarian',de:'german',el:'greek',
 en:'english',es:'spanish',fr:'french',hi:'hindi',
 it:'italian',ja:'japanese',nl:'dutch',pl:'polish',
 pt:'portuguese',ru:'russian',sw:'swahili',th:'thai',
 tr:'turkish',ur:'urdu',vi:'vietnamese',zh:'chinese'
};
let asr=null,translator=null,translatorModel=null,detector=null;

function progress(id,message){
 self.postMessage({id,progress:message});
}
function isHindi(text){
 text=String(text||'');
 const letters=(text.match(/\p{L}/gu)||[]).length;
 const dev=(text.match(/[\u0900-\u097F]/g)||[]).length;
 return dev>=2 && dev/Math.max(letters,1)>=0.20;
}
async function detect(rows,id){
 const sample=rows.slice(0,40)
  .map(r=>r.sourceText??r.text??'').join(' ').slice(0,2000);

 if(isHindi(sample))return 'hindi';

 if(!detector){
  progress(id,'Loading language detector...');
  detector=await pipeline(
   'text-classification',
   'onnx-community/xlm-roberta-base-language-detection-ONNX',
   {dtype:'q8'}
  );
 }
 progress(id,'Detecting source language...');
 const result=await detector(sample,{top_k:1,truncation:true});
 const p=Array.isArray(result?.[0])?result[0][0]:result?.[0];
 if(!p?.label||typeof p.score!=='number')
  throw Error('Language detection failed. Select language manually.');

 const key=String(p.label).toLowerCase()
  .replace(/^__label__/,'').replace(/^label_/,'');
 const lang=labels[key];
 if(!lang||p.score<0.45)
  throw Error('Language unclear. Select it manually.');
 return lang;
}

async function transcribe(id,buffer,language){
 if(!asr){
  progress(id,'Loading Whisper in background...');
  asr=await pipeline(
   'automatic-speech-recognition',
   'onnx-community/whisper-tiny',
   {dtype:'q8'}
  );
 }
 progress(id,'Whisper transcription running...');
 const options={
  task:'transcribe',
  chunk_length_s:30,
  stride_length_s:5,
  return_timestamps:true
 };
 if(language&&language!=='auto')options.language=language;

 const result=await asr(new Float32Array(buffer),options);
 const rows=(result.chunks||[]).map(c=>({
  start:c.timestamp?.[0]??0,
  end:c.timestamp?.[1]??(c.timestamp?.[0]??0)+3,
  text:(c.text||'').trim()
 })).filter(r=>r.text);

 if(!rows.length&&result.text)
  rows.push({start:0,end:3,text:result.text.trim()});
 if(!rows.length)throw Error('No speech detected.');
 return rows;
}


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
  }
 }

 const count=originals.length-preserved;
 return {
  rows:originals.map((r,i)=>({...r,text:translated[i]})),
  message:`Hindi ready: ${count} translated, ${preserved} preserved (Hindi/uncertain).`
 };
}

self.onmessage=async({data})=>{
 const {id,type}=data||{};
 try{
  let result;
  if(type==='transcribe')
   result=await transcribe(id,data.audioBuffer,data.language);
  else if(type==='translate')
   result=await translate(id,data.rows,data.selectedLanguage);
  else throw Error('Unknown AI task.');
  self.postMessage({id,ok:true,result});
 }catch(e){
  self.postMessage({
   id,ok:false,
   error:e?.stack||e?.message||String(e)
  });
 }
};
