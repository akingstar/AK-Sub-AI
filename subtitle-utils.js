const ASR_CODES = {
 hindi: 'hi', hinglish: 'hi', english: 'en', spanish: 'es', french: 'fr',
 arabic: 'ar', german: 'de', japanese: 'ja', chinese: 'zh',
 portuguese: 'pt', russian: 'ru', italian: 'it', dutch: 'nl',
 polish: 'pl', swahili: 'sw', thai: 'th', turkish: 'tr',
 urdu: 'ur', vietnamese: 'vi', bulgarian: 'bg', greek: 'el'
};

export function toAsrCode(value) {
 const raw = String(value || '').trim().toLowerCase();
 if (!raw || raw === 'auto') return null;
 return ASR_CODES[raw] || (/^[a-z]{2,3}$/.test(raw) ? raw : null);
}

export function tidyText(value) {
 return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function refineRows(input, options = {}) {
 const duration = Number(options.duration);
 const cleaned = [];
 for (const raw of Array.isArray(input) ? input : []) {
  if (!raw || raw.start == null || raw.end == null) continue;
  const start = Math.max(0, Number(raw.start));
  const end = Number.isFinite(duration) && duration > 0
   ? Math.min(Number(raw.end), duration) : Number(raw.end);
  const text = tidyText(raw.text);
  if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
  const row = { ...raw, start, end, text, reviewReasons: [] };
  const duplicate = cleaned.find(previous => previous.chunkOffset !== undefined &&
   row.chunkOffset !== undefined && previous.chunkOffset !== row.chunkOffset &&
   previous.text === row.text && Math.abs(previous.start - start) < 0.25 &&
   Math.abs(previous.end - end) < 0.25);
  if (!duplicate) cleaned.push(row);
 }
 cleaned.sort((a, b) => a.start - b.start || a.end - b.end);
 for (let i = 0; i < cleaned.length; i++) {
  const row = cleaned[i];
  if (row.text.length > 84 || row.end - row.start > 7) row.reviewReasons.push('Long cue: review timing or split while listening.');
  if (row.end - row.start < 0.45) row.reviewReasons.push('Short cue: check readability.');
  for (let j = i - 1; j >= 0; j--) {
   if (cleaned[j].end > row.start) {
    const reason = 'Overlapping cues: listen before merging or deleting.';
    if (!cleaned[j].reviewReasons.includes(reason)) cleaned[j].reviewReasons.push(reason);
    if (!row.reviewReasons.includes(reason)) row.reviewReasons.push(reason);
   }
  }
 }
 return cleaned;
}

export function wordsToCues(words, offset = 0, options = {}) {
 const maxDuration = Number(options.maxDuration) || 6;
 const maxChars = Number(options.maxChars) || 84;
 const cues = [];
 let current = null;
 for (const item of Array.isArray(words) ? words : []) {
  if (!item || item.start == null || item.end == null) continue;
  const text = tidyText(item.word ?? item.text);
  const start = offset + Number(item.start);
  const end = offset + Number(item.end);
  if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
  if (!current || start - current.end > 0.7 || current.text.length + text.length + 1 > maxChars ||
      end - current.start > maxDuration || (/[.!?।]$/.test(current.text) && end - current.start > 1.2)) {
   if (current) cues.push(current);
   current = { start, end, text };
  } else {
   current.end = Math.max(current.end, end);
   current.text += ' ' + text;
  }
 }
 if (current) cues.push(current);
 return cues;
}
