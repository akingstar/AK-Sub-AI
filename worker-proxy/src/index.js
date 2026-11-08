const BASE =
  "https://github.com/akingstar/AK-Sub-AI/releases/download/v1.0-nllb/";

const FILES = {
  "config.json": "config.json",
  "generation_config.json": "generation_config.json",
  "quantize_config.json": "quantize_config.json",
  "sentencepiece.bpe.model": "sentencepiece.bpe.model",
  "special_tokens_map.json": "special_tokens_map.json",
  "tokenizer.json": "tokenizer.json",
  "tokenizer_config.json": "tokenizer_config.json",
  "encoder_model_quantized.onnx": "encoder_model_quantized.onnx",
  "decoder_model_merged_quantized.onnx": "decoder_model_merged_quantized.onnx",
  "MODEL-README.md": "MODEL-README.md"
};


const TURNSTILE_VERIFY_URL =
 "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const ALLOWED_TURNSTILE_HOSTNAME = "akingstar.github.io";
const TURNSTILE_ACTION = "ak_sub_ai";

function b64url(bytes) {
 let binary="";
 for(const b of bytes) binary+=String.fromCharCode(b);
 return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function unb64url(value) {
 const b=value.replace(/-/g,"+").replace(/_/g,"/");
 const padded=b+"=".repeat((4-b.length%4)%4);
 const binary=atob(padded);
 return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
async function sessionKey(secret) {
 return crypto.subtle.importKey(
  "raw",new TextEncoder().encode(secret),
  {name:"HMAC",hash:"SHA-256"},false,["sign","verify"]
 );
}
async function makeSession(secret) {
 const payload=b64url(new TextEncoder().encode(JSON.stringify({
  exp:Math.floor(Date.now()/1000)+900,
  id:crypto.randomUUID()
 })));
 const sig=await crypto.subtle.sign(
  "HMAC",await sessionKey(secret),new TextEncoder().encode(payload)
 );
 return payload+"."+b64url(new Uint8Array(sig));
}
async function checkSession(token,secret) {
 try {
  const parts=String(token||"").split(".");
  if(parts.length!==2)return false;
  const valid=await crypto.subtle.verify(
   "HMAC",await sessionKey(secret),unb64url(parts[1]),
   new TextEncoder().encode(parts[0])
  );
  if(!valid)return false;
  const p=JSON.parse(new TextDecoder().decode(unb64url(parts[0])));
  const now=Math.floor(Date.now()/1000);
  return Number.isInteger(p.exp)&&p.exp>now&&p.exp<=now+16*60;
 } catch { return false; }
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type, If-Range, Authorization",
      "Access-Control-Expose-Headers":
        "Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);


    if (url.pathname.replace(/\/+$/, "") === "/authorize") {
      if (request.method !== "POST") {
        return Response.json({error:"POST required."},{status:405,headers:cors});
      }
      if (!env.TURNSTILE_SECRET) {
        return Response.json({error:"Turnstile secret is not configured."},{status:503,headers:cors});
      }
      try {
        const body=await request.json();
        if(typeof body.token!=="string"||!body.token) {
          return Response.json({error:"Turnstile token is missing."},{status:400,headers:cors});
        }
        const form=new FormData();
        form.set("secret",env.TURNSTILE_SECRET);
        form.set("response",body.token);
        const ip=request.headers.get("CF-Connecting-IP");
        if(ip)form.set("remoteip",ip);

        const verifyResponse=await fetch(TURNSTILE_VERIFY_URL,{method:"POST",body:form});
        const result=await verifyResponse.json();
        if(!result.success ||
           result.hostname!==ALLOWED_TURNSTILE_HOSTNAME ||
           result.action!==TURNSTILE_ACTION) {
          return Response.json({error:"Security check failed. Please retry.",codes:result["error-codes"]||[],hostname:result.hostname||null,action:result.action||null},{status:403,headers:cors});
        }
        return Response.json({sessionToken:await makeSession(env.TURNSTILE_SECRET)},{headers:cors});
      } catch(error) {
        return Response.json({error:"Security verification error: "+(error?.message||String(error))},{status:502,headers:cors});
      }
    }

    if (url.pathname.replace(/\/+$/, "") === "/transcribe") {
      if (request.method !== "POST") {
        return Response.json({ error: "POST required." }, {
          status: 405, headers: cors
        });
      }


      if (!env.TURNSTILE_SECRET) {
        return Response.json({error:"Turnstile secret is not configured."},{status:503,headers:cors});
      }
      const auth=request.headers.get("Authorization")||"";
      const token=auth.startsWith("Bearer ")?auth.slice(7):"";
      if(!(await checkSession(token,env.TURNSTILE_SECRET))) {
        return Response.json({error:"Unauthorized. Complete the security check again."},{status:401,headers:cors});
      }

      if (!env.AI) {
        return Response.json({ error: "Workers AI binding is missing." }, {
          status: 503, headers: cors
        });
      }

      try {
        const body = await request.json();

        if (typeof body.audio !== "string" || !body.audio.length) {
          return Response.json({ error: "Audio data is missing." }, {
            status: 400, headers: cors
          });
        }

        if (body.audio.length > 2000000) {
          return Response.json({ error: "Audio chunk is too large." }, {
            status: 413, headers: cors
          });
        }

        const isHindiRequest = body.language === "hi";

        const input = {
          audio: body.audio,
          task: "transcribe",
          vad_filter: false,
          condition_on_previous_text: false,
          initial_prompt: isHindiRequest
            ? "Transcribe spoken Hindi in Devanagari script. Keep English words in Latin script only when they are actually spoken in English. Do not translate Hindi speech into English. Do not invent or omit words."
            : "Accurately transcribe the spoken words in their original language. The audio may contain Hindi, English, or mixed Hindi-English speech. Do not translate or invent missing words."
        };

        if (typeof body.language === "string" &&
            /^[a-z]{2,3}$/.test(body.language)) {
          input.language = body.language;
        }

        const result = await env.AI.run(
          "@cf/openai/whisper-large-v3-turbo",
          input
        );

        if (!result || typeof result.text !== "string") {
          return Response.json({
            error: "Cloud AI returned an empty transcription."
          }, { status: 502, headers: cors });
        }

        const info = result.transcription_info || {};

        return Response.json({
          text: result.text,
          transcription_info: {
            language: typeof info.language === "string" ? info.language : null,
            language_probability: Number.isFinite(info.language_probability)
              ? info.language_probability
              : null
          },
          vtt: result.vtt || "",
          words: Array.isArray(result.words) ? result.words : [],
          segments: Array.isArray(result.segments) ? result.segments : []
        }, { headers: cors });

      } catch (error) {
        return Response.json({
          error: "Cloud transcription error: " +
            (error?.message || String(error))
        }, { status: 502, headers: cors });
      }
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed", {
        status: 405, headers: cors
      });
    }

    const filename = url.pathname.split("/").filter(Boolean).pop();
    const asset = FILES[filename];

    if (!asset) {
      return new Response("Model file not found", {
        status: 404, headers: cors
      });
    }

    try {
      const upstreamHeaders = new Headers();

      for (const header of ["Range", "If-Range", "If-None-Match"]) {
        const value = request.headers.get(header);
        if (value) upstreamHeaders.set(header, value);
      }

      const upstream = await fetch(BASE + encodeURIComponent(asset), {
        method: request.method,
        headers: upstreamHeaders,
        redirect: "follow"
      });

      const headers = new Headers(upstream.headers);
      for (const [key, value] of Object.entries(cors)) {
        headers.set(key, value);
      }

      headers.set("Cache-Control", "public, max-age=86400");

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers
      });

    } catch (error) {
      return new Response("Upstream error: " + error.message, {
        status: 502, headers: cors
      });
    }
  }
};
