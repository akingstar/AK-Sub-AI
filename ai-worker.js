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
let asr=null,translator=null,detector=null;

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

async function translate(id,inputRows,selected){
 const originals=inputRows.map(r=>({
  ...r,sourceText:r.sourceText??r.text??''
 }));
 if(!originals.length)throw Error('Generate subtitles first.');

 const sample=originals.map(r=>r.sourceText).join(' ');
 const source=selected==='auto'
  ?await detect(originals,id)
  :selected;

 // Hindi audio: preserve its transcript, never translate it again.
 if(source==='hindi'||isHindi(sample)){
  return {
   rows:originals.map(r=>({...r,text:r.sourceText})),
   message:'Hindi detected. Original Hindi transcript preserved.'
  };
 }

 const src=codes[source];
 if(!src)throw Error('Unsupported source language. Select it manually.');

 if(!translator){
  progress(id,'Loading NLLB Hindi translation model...');
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

 const translated=new Array(originals.length).fill('');
 for(let start=0;start<originals.length;start+=4){
  const end=Math.min(start+4,originals.length);
  const inputs=[],indexes=[];

  for(let i=start;i<end;i++){
   const t=String(originals[i].sourceText||'').trim();
   if(t){inputs.push(t);indexes.push(i);}
  }
  if(!inputs.length)continue;

  progress(id,`Hindi translation ${end}/${originals.length}...`);
  const results=await translator(inputs,{
   src_lang:src,
   tgt_lang:'hin_Deva'
  });
  if(!Array.isArray(results)||results.length!==inputs.length)
   throw Error('Translation failed. Original transcript preserved.');

  results.forEach((r,j)=>{
   translated[indexes[j]]=String(r?.translation_text||'').trim();
  });
  for(const i of indexes){
   if(!translated[i])throw Error('Empty translation at subtitle '+(i+1));
  }
 }
 return {
  rows:originals.map((r,i)=>({...r,text:translated[i]})),
  message:'Hindi translation complete: '+originals.length+' subtitles.'
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
