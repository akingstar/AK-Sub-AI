const SITE_KEY = '0x4AAAAAAF4SP-mfoSwBJgvu';
let loadPromise;

function loadTurnstile() {
 if (window.turnstile) return Promise.resolve();
 if (loadPromise) return loadPromise;
 loadPromise = new Promise((resolve, reject) => {
  const script = document.createElement('script');
  const finish = error => {
   clearTimeout(timer);
   script.onload = script.onerror = null;
   if (error) { script.remove(); reject(error); }
   else resolve();
  };
  const timer = setTimeout(() => finish(new Error('Security widget could not load within 20 seconds. Check your connection and retry.')), 20000);
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.onload = () => window.turnstile ? finish() : finish(new Error('Security widget did not initialize. Please retry.'));
  script.onerror = () => finish(new Error('Security widget download failed. Please retry.'));
  document.head.appendChild(script);
 }).catch(error => { loadPromise = null; throw error; });
 return loadPromise;
}

export async function getTurnstileToken(container) {
 container.hidden = false;
 container.textContent = 'Loading secure access check…';
 try { await loadTurnstile(); }
 catch (error) { container.textContent = error.message; throw error; }
 return new Promise((resolve, reject) => {
  let settled = false, widgetId = null;
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = 'Complete the security check below if asked. Audio is sent only after verification.';
  const widget = document.createElement('div');
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'Cancel security check';
  container.replaceChildren(note, widget, cancel);
  const finish = (error, token) => {
   if (settled) return;
   settled = true;
   clearTimeout(timer);
   if (widgetId !== null) window.turnstile.remove(widgetId);
   container.replaceChildren();
   container.hidden = !error;
   if (error) { container.textContent = error.message; reject(error); }
   else resolve(token);
  };
  const timer = setTimeout(() => finish(new Error('Security check timed out. Complete the visible check and retry Generate.')), 90000);
  cancel.onclick = () => finish(new Error('Security check cancelled. Your captions are unchanged.'));
  try {
   widgetId = window.turnstile.render(widget, {
    sitekey: SITE_KEY, size: 'normal', theme: 'dark', action: 'ak_sub_ai',
    callback: token => finish(null, token),
    'error-callback': code => { finish(new Error('Security check failed' + (code ? ' (code ' + code + ')' : '') + '. Please retry.')); return true; },
    'expired-callback': () => finish(new Error('Security check expired. Please retry.')),
    'unsupported-callback': () => finish(new Error('This browser cannot complete the security check. Open this site in an up-to-date Chrome, Edge or Safari tab.'))
   });
  } catch (error) { finish(error); }
 });
}
