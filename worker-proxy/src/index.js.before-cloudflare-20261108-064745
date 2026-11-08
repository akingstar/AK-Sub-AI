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

export default {
  async fetch(request) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type, If-Range",
      "Access-Control-Expose-Headers":
        "Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed", {
        status: 405,
        headers: cors
      });
    }

    const url = new URL(request.url);
    const filename = url.pathname.split("/").filter(Boolean).pop();
    const asset = FILES[filename];

    if (!asset) {
      return new Response("Model file not found", {
        status: 404,
        headers: cors
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
        status: 502,
        headers: cors
      });
    }
  }
};
