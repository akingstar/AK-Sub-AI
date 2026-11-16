let coveragePromise;
const loadedFonts = new WeakMap();

function covers(font, character) {
 const cp = character.codePointAt(0);
 return font.ranges.some(([start, end]) => cp >= start && cp <= end);
}

export function assText(text, fonts) {
 // Browser FFmpeg has no system font provider; assign every script an explicit face.
 let result = '';
 let current = fonts[0];
 for (const character of String(text).replace(/\r\n?/g, '\n')) {
  if (character === '\n') { result += '\\N'; continue; }
  if (character === '\r') continue;
  const font = covers(current, character) ? current : fonts.find(item => covers(item, character));
  if (font && font !== current) { result += '{\\fn' + font.family + '}'; current = font; }
  if (character === '\\') result += '\\\u2060';
  else if (character === '{') result += '\\{';
  else result += character;
 }
 return result;
}

function assTime(value) {
 const centiseconds = Math.round(Math.max(0, value) * 100);
 return Math.floor(centiseconds / 360000) + ':' + String(Math.floor(centiseconds / 6000) % 60).padStart(2, '0') + ':' +
  String(Math.floor(centiseconds / 100) % 60).padStart(2, '0') + '.' + String(centiseconds % 100).padStart(2, '0');
}

export function buildAss(rows, fonts, style) {
 const header = '[Script Info]\nScriptType: v4.00+\nPlayResX: 384\nPlayResY: 288\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n' +
  '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n' +
  `Style: Default,Noto Sans,${style.fontSize},${style.color},${style.color},&H00000000,${style.backColor},${style.bold ? -1 : 0},${style.italic ? -1 : 0},0,0,100,100,0,0,${style.boxed ? 3 : 1},${style.outline},${style.shadow},${style.alignment},16,16,${style.marginV},1\n\n` +
  '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
 return header + rows.map(row => `Dialogue: 0,${assTime(row.start)},${assTime(row.end)},Default,,0,0,0,,${assText(row.text, fonts)}`).join('\n') + '\n';
}

export function selectFonts(text, catalog) {
 const selected = new Set([catalog[0]]);
 const missing = [];
 for (const character of new Set(text)) {
  if (/[\s\p{Cf}\uFE00-\uFE0F]/u.test(character)) continue;
  const cp = character.codePointAt(0);
  const font = catalog.find(item => item.ranges.some(([start, end]) => cp >= start && cp <= end));
  if (font) selected.add(font);
  else missing.push('U+' + cp.toString(16).toUpperCase());
 }
 if (missing.length) throw new Error('Unsupported subtitle characters: ' + missing.slice(0, 8).join(', ') + '. Edit those characters or download SRT; no boxed video was exported.');
 return [...selected];
}

export async function loadSubtitleFonts(ff, text, onProgress) {
 if (!coveragePromise) {
  coveragePromise = fetch(new URL('./assets/fonts/coverage.json', import.meta.url))
   .then(response => {
    if (!response.ok) throw new Error('Font coverage could not be loaded.');
    return response.json();
   }).catch(error => { coveragePromise = null; throw error; });
 }
 const fonts = selectFonts(text, await coveragePromise);
 if (!loadedFonts.has(ff)) loadedFonts.set(ff, new Set());
 const loaded = loadedFonts.get(ff);
 if (!(await ff.listDir('/')).some(item => item.name === 'subtitle-fonts')) await ff.createDir('subtitle-fonts');
 for (const font of fonts) {
  if (loaded.has(font.sha256)) continue;
  onProgress?.('Loading subtitle font: ' + font.family);
  const response = await fetch(new URL('./assets/fonts/' + font.file, import.meta.url));
  if (!response.ok) throw new Error('Subtitle font download failed: ' + font.family);
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== font.sha256) throw new Error('Subtitle font is incomplete or outdated: ' + font.family + '. Refresh and retry.');
  await ff.writeFile('subtitle-fonts/' + font.file, new Uint8Array(bytes));
  loaded.add(font.sha256);
 }
 return fonts;
}
