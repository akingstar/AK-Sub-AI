import { refineRows, wordsToCues, toAsrCode } from './subtitle-utils.js';
import { translateCaptions } from './subtitle-ai.js';

const PROXY = 'https://ak-sub-ai-nllb-proxy.akingstar205.workers.dev';

function progress(id, message) {
 self.postMessage({ id, progress: message });
}

async function cloudRequest(path, body, sessionToken) {
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), path === '/authorize' ? 20000 : 90000);
 try {
  const response = await fetch(PROXY + path, {
   method: 'POST', signal: controller.signal,
   headers: { 'Content-Type': 'application/json', ...(sessionToken ? { Authorization: 'Bearer ' + sessionToken } : {}) },
   body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
   const details = path === '/authorize' && Array.isArray(payload.codes) && payload.codes.length ? ' Codes: ' + payload.codes.join(', ') : '';
   const error = new Error((payload.error || 'Cloud speech AI failed (HTTP ' + response.status + ').') + details);
   error.quota = /4006|daily free allocation|neurons/i.test(error.message);
   throw error;
  }
  return payload;
 } catch (error) {
  if (error.name === 'AbortError') throw new Error(path === '/authorize' ? 'Secure authorization timed out.' : 'Cloud speech AI timed out for this audio chunk.');
  if (error instanceof TypeError) throw new Error('Cannot reach cloud speech AI. Check your connection.');
  throw error;
 } finally {
  clearTimeout(timer);
 }
}

function encodeWavBase64(samples, from, to) {
 const count = to - from;
 const buffer = new ArrayBuffer(44 + count * 2);
 const view = new DataView(buffer);
 const bytes = new Uint8Array(buffer);
 const write = (offset, value) => {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
 };
 write(0, 'RIFF');
 view.setUint32(4, 36 + count * 2, true);
 write(8, 'WAVE');
 write(12, 'fmt ');
 view.setUint32(16, 16, true);
 view.setUint16(20, 1, true);
 view.setUint16(22, 1, true);
 view.setUint32(24, 16000, true);
 view.setUint32(28, 32000, true);
 view.setUint16(32, 2, true);
 view.setUint16(34, 16, true);
 write(36, 'data');
 view.setUint32(40, count * 2, true);
 for (let i = 0; i < count; i++) {
  const value = Math.max(-1, Math.min(1, samples[from + i]));
  view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
 }
 let binary = '';
 for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
 return btoa(binary);
}

function parseVttTime(value) {
 const parts = value.trim().split(':').map(Number);
 if (parts.some(number => !Number.isFinite(number))) return NaN;
 if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
 if (parts.length === 2) return parts[0] * 60 + parts[1];
 return NaN;
}

function parseVttRows(vtt, offset) {
 if (typeof vtt !== 'string' || !vtt.trim()) return [];
 const rows = [];
 for (const block of vtt.replace(/\r/g, '').split(/\n\s*\n/)) {
  const lines = block.split('\n');
  const timingIndex = lines.findIndex(line => line.includes('-->'));
  if (timingIndex < 0) continue;
  const timing = lines[timingIndex].split('-->');
  if (timing.length !== 2) continue;
  const start = parseVttTime(timing[0]);
  const end = parseVttTime(timing[1].trim().split(/\s+/)[0]);
  const text = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]*>/g, '').trim();
  if (text && Number.isFinite(start) && Number.isFinite(end) && end > start) rows.push({ start: offset + start, end: offset + end, text });
 }
 return rows;
}

function cleanAudio(input) {
 const out = new Float32Array(input.length);
 const a = Math.exp(-2 * Math.PI * 80 / 16000);
 let prevIn = 0, prevOut = 0, peak = 0;
 for (let i = 0; i < input.length; i++) {
  const x = input[i];
  const y = a * (prevOut + x - prevIn);
  prevIn = x; prevOut = y; out[i] = y;
  peak = Math.max(peak, Math.abs(y));
 }
 if (peak < 0.005) return input;
 const gain = Math.min(0.9 / peak, 6);
 if (gain > 1.05 || gain < 0.95) for (let i = 0; i < out.length; i++) out[i] *= gain;
 return out;
}

function planChunks(samples, maxLen, overlap) {
 const sr = 16000, frame = 1600, minLen = 15 * sr;
 const plan = [];
 let offset = 0;
 while (offset < samples.length) {
  let end = Math.min(samples.length, offset + maxLen);
  if (offset + maxLen < samples.length) {
   let best = -1, bestEnergy = Infinity;
   const from = offset + minLen, to = offset + maxLen - sr;
   for (let p = from; p + frame <= to; p += frame) {
    let energy = 0;
    for (let i = p; i < p + frame; i++) energy += samples[i] * samples[i];
    if (energy < bestEnergy) { bestEnergy = energy; best = p + (frame >> 1); }
   }
   if (best > 0) end = best;
  }
  plan.push({ offset, end });
  if (end >= samples.length) break;
  offset = Math.max(offset + 1, end - overlap);
 }
 return plan;
}

async function cloudTranscribe(id, buffer, language, turnstileToken) {
 const samples = cleanAudio(new Float32Array(buffer));
 if (!samples.length) throw new Error('Audio is empty.');
 const lang = toAsrCode(language);
 if (typeof turnstileToken !== 'string' || !turnstileToken) throw new Error('Security verification is required. Please retry.');
 progress(id, 'Verifying secure access...');
 const auth = await cloudRequest('/authorize', { token: turnstileToken });
 if (!auth.sessionToken) throw new Error('Cloud authorization returned no session. Complete the security check again.');
 const rows = [];
 const plan = planChunks(samples, 30 * 16000, 3 * 16000);
 for (const { offset, end } of plan) {
  const offsetSeconds = offset / 16000;
  progress(id, 'Cloud Whisper: ' + Math.round(offsetSeconds) + 's / ' + Math.ceil(samples.length / 16000) + 's');
  const body = { audio: encodeWavBase64(samples, offset, end), ...(lang ? { language: lang } : {}) };
  const payload = await cloudRequest('/transcribe', body, auth.sessionToken);
  const info = payload.transcription_info || {};
  let chunkRows = parseVttRows(payload.vtt, offsetSeconds);
  const segmentRows = Array.isArray(payload.segments) ? payload.segments.map(item => ({
   start: item.start ?? item.timestamp?.[0], end: item.end ?? item.timestamp?.[1], text: item.text
  })).filter(item => item.start != null && item.end != null).map(item => ({
   start: offsetSeconds + Number(item.start), end: offsetSeconds + Number(item.end), text: String(item.text || '').trim()
  })).filter(row => row.text && Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start) : [];
  if (!chunkRows.length) chunkRows = segmentRows;
  if (lang === 'hi' && /\p{Script=Devanagari}/u.test(String(payload.text)) && !chunkRows.some(row => /\p{Script=Devanagari}/u.test(row.text))) {
   chunkRows = segmentRows.some(row => /\p{Script=Devanagari}/u.test(row.text)) ? segmentRows : [{ start: offsetSeconds, end: end / 16000, text: String(payload.text).trim() }];
  }
  if (!chunkRows.length) chunkRows = wordsToCues(payload.words, offsetSeconds);
  if (!chunkRows.length && typeof payload.text === 'string' && payload.text.trim()) chunkRows = [{ start: offsetSeconds, end: end / 16000, text: payload.text.trim() }];
  for (const row of chunkRows) rows.push({
   ...row, chunkOffset: offsetSeconds,
   detectedLanguage: typeof info.language === 'string' ? info.language : null,
   languageProbability: Number.isFinite(info.language_probability) ? info.language_probability : null
  });
 }
 const result = refineRows(rows, { duration: samples.length / 16000 });
 if (!result.length) throw new Error('No speech detected by Cloud Whisper.');
 return result;
}

let localAsr;
async function localTranscribe(id, samples, lang) {
 const memory = navigator.deviceMemory || 4;
 if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '') || memory < 8) {
  throw new Error('Cloud speech quota is exhausted. Local Whisper is disabled on this low-memory device; retry after the provider quota resets.');
 }
 if (!localAsr) {
  progress(id, 'Cloud speech quota exhausted; loading local Whisper on this high-memory device...');
  const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2');
  const useGpu = !!navigator.gpu;
  localAsr = await pipeline('automatic-speech-recognition', useGpu ? 'onnx-community/whisper-large-v3-turbo' : 'onnx-community/whisper-base',
   useGpu ? { device: 'webgpu', dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' } } : { dtype: 'q8' });
 }
 progress(id, 'Local Whisper: transcribing...');
 const output = await localAsr(samples, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true, ...(lang ? { language: lang, task: 'transcribe' } : {}) });
 const rows = refineRows((output.chunks || []).filter(chunk => chunk.timestamp?.[0] != null && chunk.timestamp?.[1] != null).map(chunk => ({
  start: Number(chunk.timestamp[0]), end: Number(chunk.timestamp[1]), text: chunk.text
 })), { duration: samples.length / 16000 });
 if (!rows.length) throw new Error('No speech detected by local Whisper.');
 return rows;
}

async function transcribe(id, buffer, language, token) {
 try { return await cloudTranscribe(id, buffer, language, token); }
 catch (error) {
  if (!error.quota) throw error;
  return localTranscribe(id, new Float32Array(buffer), toAsrCode(language));
 }
}

self.onmessage = async ({ data }) => {
 const { id, type } = data || {};
 try {
  let result;
  if (type === 'transcribe') result = await transcribe(id, data.audioBuffer, data.language, data.turnstileToken);
  else if (type === 'translate') result = await translateCaptions(data.rows, data.selectedLanguage, message => progress(id, message));
  else throw new Error('Unknown AI task.');
  self.postMessage({ id, ok: true, result });
 } catch (error) {
  self.postMessage({ id, ok: false, error: error?.message || String(error) });
 }
};
self.postMessage({ ready: true });
