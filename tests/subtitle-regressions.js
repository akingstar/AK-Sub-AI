import { refineRows, tidyText, wordsToCues, toAsrCode } from '../subtitle-utils.js';
import { selectFonts, assText, buildAss, loadSubtitleFonts } from '../subtitle-fonts.js';

export async function runSubtitleTests() {
 const results = [];
 const check = (name, condition) => {
  results.push({ name, passed: Boolean(condition) });
 };
 const row = (text, start = 0, end = 3, extra = {}) => ({ text, start, end, ...extra });
 const distinct = refineRows([row('we can go'), row('we cannot go')]);
 check('Conflicting transcripts preserve negation', distinct.length === 2 && distinct[1].text === 'we cannot go');
 check('Overlaps flagged without guessed timestamps', distinct.every(item => item.start === 0 && item.end === 3 && item.reviewReasons.length));
 check('Numbers are not deduplicated', refineRows([row('pay 15 now'), row('pay 50 now')]).length === 2);
 check('Repeated speech retained', refineRows([row('no', 0, 1), row('no', 1, 2)]).length === 2);
 check('Only same-timed cross-chunk duplicates removed', refineRows([row('hello', 27, 28, { chunkOffset: 0 }), row('hello', 27.1, 28.1, { chunkOffset: 27 })]).length === 1);
 check('Same-chunk cues retained', refineRows([row('hello'), row('hello')]).length === 2);
 const text = '- iPhone 12 costs 3.14; क्\u200dष می\u200cروم ♪';
 check('Case, punctuation, joiners and lyrics preserved', tidyText(text) === text);
 const words = wordsToCues([{ word: 'hello', start: 0, end: 0.4 }, { word: 'iPhone', start: 0.4, end: 1 }], 27);
 check('Word casing and chunk offsets preserved', words.length === 1 && words[0].text === 'hello iPhone' && words[0].start === 27 && words[0].end === 28);
 check('Missing timestamps not invented', wordsToCues([{ word: 'hello', start: null, end: 1 }]).length === 0);
 const long = 'one two three four five six seven eight nine ten '.repeat(3).trim();
 const longRows = refineRows([row(long, 0, 30)]);
 check('Untimed long cues not split by word length', longRows.length === 1 && longRows[0].text === long && longRows[0].end === 30);
 check('Video bounds respected', refineRows([row('last', 9.9, 11)], { duration: 10 })[0].end === 10);
 check('Invalid intervals rejected', refineRows([row('bad', 3, 1), row('bad', 0, NaN), row('bad', -2, -1)]).length === 0);
 check('Language mapping', toAsrCode('auto') === null && toAsrCode('Hindi') === 'hi' && toAsrCode('hinglish') === 'hi');
 const catalog = await (await fetch(new URL('../assets/fonts/coverage.json', import.meta.url))).json();
 const samples = {
  english: 'Hello, Namaste 123!', hindi: 'नमस्ते दुनिया', arabic: 'مرحبا بالعالم', urdu: 'اردو زبان',
  russian: 'Привет мир', greek: 'Γεια σου κόσμε', thai: 'สวัสดี', chinese: '你好世界', japanese: 'こんにちは日本語',
  french: 'Bonjour été', german: 'Grüße', spanish: '¡Hola niño!', portuguese: 'Olá coração', vietnamese: 'Xin chào Việt Nam',
  polish: 'Zażółć gęślą jaźń', turkish: 'İyi günler', bulgarian: 'Здравей свят', italian: 'Città', dutch: 'Hallo wereld', swahili: 'Habari dunia'
 };
 for (const [language, sample] of Object.entries(samples)) {
  try { selectFonts(sample, catalog); check('Glyph coverage: ' + language, true); }
  catch { check('Glyph coverage: ' + language, false); }
 }
 check('Roman export loads only one small font', selectFonts(samples.english, catalog).length === 1);
 const mixedFonts = selectFonts(samples.english + samples.hindi + samples.arabic + samples.chinese, catalog);
 const mixedAss = assText(samples.english + samples.hindi + samples.arabic + samples.chinese, mixedFonts);
 check('Explicit faces avoid missing system fallback', mixedAss.includes('{\\fnNoto Sans Devanagari}') && mixedAss.includes('{\\fnNoto Naskh Arabic}') && mixedAss.includes('{\\fnNoto Sans CJK SC}'));
 let unsupported = false;
 try { selectFonts(String.fromCodePoint(0x1F680), catalog); } catch { unsupported = true; }
 check('Unsupported glyphs stop boxed output', unsupported);
 const ass = buildAss([row('hello\nworld', 0.1, 2.5)], [catalog[0]], { fontSize: 28, color: '&H00FFFFFF', backColor: '&HFF000000', outline: 2, shadow: 1, alignment: 2, marginV: 35 });
 check('ASS times and line breaks', ass.includes('0:00:00.10,0:00:02.50') && ass.includes('hello\\Nworld'));
 check('User text cannot inject font overrides', !assText('{\\fnBad} text \\N', [catalog[0]]).includes('{\\fnBad}'));
 const writes = [];
 let hasDirectory = false;
 const engine = {
  listDir: async () => hasDirectory ? [{ name: 'subtitle-fonts' }] : [],
  createDir: async () => { hasDirectory = true; },
  writeFile: async (name, bytes) => { writes.push({ name, bytes: bytes.length }); }
 };
 await loadSubtitleFonts(engine, 'Hello');
 await loadSubtitleFonts(engine, 'Repeat export');
 check('Font hash validated and bytes loaded once per engine', writes.length === 1 && writes[0].bytes > 100000);
 return { passed: results.filter(item => item.passed).length, total: results.length, failures: results.filter(item => !item.passed) };
}
