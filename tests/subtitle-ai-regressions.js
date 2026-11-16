import { parseCaptionResponse, captionNeedsReview, requestCaptionConversion, translateCaptions, needsRomanConversion } from '../subtitle-ai.js';
import { getTurnstileToken } from '../subtitle-security.js';

export async function runAIRegressionTests() {
 const results = [];
 const check = (name, condition) => results.push({ name, passed: Boolean(condition) });
 const payload = lines => ({ choices: [{ message: { content: JSON.stringify(lines) } }] });
 const rejects = async action => { try { await action(); return false; } catch { return true; } };
 check('Caption JSON parsed in input order', parseCaptionResponse(payload(['one', 'two']), 2).join('|') === 'one|two');
 check('Empty cloud response rejected', await rejects(() => parseCaptionResponse(payload(['']), 1)));
 check('Wrong line count rejected', await rejects(() => parseCaptionResponse(payload(['one']), 2)));
 check('Non-string cloud text rejected', await rejects(() => parseCaptionResponse(payload([42]), 1)));
 check('Prose is not mistaken for captions', await rejects(() => parseCaptionResponse({ choices: [{ message: { content: 'Here is an answer ["hello"]' } }] }, 1)));
 check('Number changes require review', captionNeedsReview('15 apples', '50 सेब', 'hindi'));
 check('Decimal changes require review', captionNeedsReview('costs 3.14', 'कीमत 314', 'hindi'));
 check('Preserved Hindi numbers accepted', !captionNeedsReview('15 apples', '15 सेब', 'hindi'));
 check('Native script rejected as Roman output', captionNeedsReview('नमस्ते', 'नमस्ते', 'roman'));
 check('Natural Roman output accepted', !captionNeedsReview('नमस्ते दुनिया', 'namaste duniya', 'roman'));
 check('Greek text is included in Roman conversion', needsRomanConversion('Γεια σου κόσμε'));
 check('Latin-script captions do not need conversion', !needsRomanConversion('Namaste déjà vu 15'));
 check('Unspaced CJK is not checked by Latin word counts', !captionNeedsReview('你好世界今天你好', 'ni hao shi jie jin tian ni hao', 'roman'));
 check('Untranslated English is flagged', captionNeedsReview('Hello world', 'Hello world', 'hindi'));
 const nativeFetch = globalThis.fetch;
 let calls = 0;
 try {
  globalThis.fetch = async () => { calls++; return Response.json(payload(['मैं आज नहीं जा सकता। आपके पास 15 सेब हैं।'])); };
  const input = [{ start: 1.2, end: 3.4, text: 'I cannot go today. You have 15 apples.' }];
  const before = JSON.stringify(input);
  const progress = [];
  const output = await translateCaptions(input, 'english', message => progress.push(message));
  check('Translation source rows not mutated', JSON.stringify(input) === before);
  check('Translation preserves exact timing', output.rows[0].start === 1.2 && output.rows[0].end === 3.4);
  check('Translation text reaches result', output.rows[0].text.includes('नहीं') && !output.rows[0].translationReview);
  check('Progress emitted per cloud batch', progress.length === 1);
  calls = 0;
  const hindi = await translateCaptions([{ start: 0, end: 2, text: 'नमस्ते दुनिया' }], 'auto');
  check('Native Hindi preserved without model download', hindi.rows[0].text === 'नमस्ते दुनिया' && calls === 0);
  globalThis.fetch = async () => Response.json(payload(['आपके पास 50 सेब हैं।']));
  const wrong = await translateCaptions([{ start: 0, end: 2, text: '15 apples' }], 'english');
  check('Invalid numeric translation retains original', wrong.rows[0].text === '15 apples' && wrong.rows[0].translationReview);
  globalThis.fetch = async () => Response.json({ error: 'limited' }, { status: 429 });
  let rateMessage = '';
  try { await requestCaptionConversion(['Hello'], 'hindi'); } catch (error) { rateMessage = error.message; }
  check('Rate limit reported explicitly', rateMessage.includes('rate-limited'));
  check('Cloud failure leaves input unchanged', await rejects(() => translateCaptions(input, 'english')) && JSON.stringify(input) === before);
  globalThis.fetch = async () => { throw new DOMException('aborted', 'AbortError'); };
  let timeoutMessage = '';
  try { await requestCaptionConversion(['Hello'], 'hindi'); } catch (error) { timeoutMessage = error.message; }
  check('Cloud timeout gives actionable result', timeoutMessage.includes('45 seconds'));
  check('Oversized cloud input rejected', await rejects(() => requestCaptionConversion(Array(13).fill('Hello'), 'hindi')));
 } finally { globalThis.fetch = nativeFetch; }
 const nativeTurnstile = window.turnstile;
 const container = document.createElement('div');
 document.body.appendChild(container);
 let options, removed = 0;
 try {
  window.turnstile = { render: (element, config) => { options = config; return 'test-widget'; }, remove: () => { removed++; } };
  let request = getTurnstileToken(container);
  await Promise.resolve();
  check('Security widget is visible and not invisible-sized', !container.hidden && options.size === 'normal');
  check('Security check retains production action', options.action === 'ak_sub_ai');
  options.callback('test-token');
  check('Success cleans up security widget', await request === 'test-token' && container.hidden && removed === 1);
  request = getTurnstileToken(container);
  await Promise.resolve();
  options['error-callback']('12345');
  check('Security error includes diagnostic code', await request.then(() => false, error => error.message.includes('12345')) && removed === 2);
  request = getTurnstileToken(container);
  await Promise.resolve();
  container.querySelector('button').click();
  check('Security cancellation settles and cleans up', await request.then(() => false, error => error.message.includes('cancelled')) && removed === 3);
  request = getTurnstileToken(container);
  await Promise.resolve();
  options['expired-callback']();
  check('Expired security token is not accepted', await request.then(() => false, error => error.message.includes('expired')));
 } finally { window.turnstile = nativeTurnstile; container.remove(); }
 return { passed: results.filter(result => result.passed).length, total: results.length, failures: results.filter(result => !result.passed) };
}
