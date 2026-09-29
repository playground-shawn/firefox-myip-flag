const IP_API = 'https://api.ipify.org?format=json';
const GEO_API = 'https://ipwho.is/';
const VPN_API = 'https://proxycheck.io/v2/';
const POLL_MS = 20 * 1000;
const MIN_GAP_MS = 5 * 1000;
const CACHE_MS = 24 * 60 * 60 * 1000;
// ponytail: per-browser caps sized so ~10 users behind one office IP stay under the
// free quotas (ipwho.is 1000/day, proxycheck 100/day); a shared server cache would lift this.
const DAILY_CAP = { geo: 50, vpn: 8 };

let current = null;  // { ip, geo, vpn, vpnTried } for the IP I am on now
let checkedAt = 0;
let lastTry = 0;
let error = null;
let fetching = false;

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Storage blocked: caps and cache just reset on restart.
  }
}

// Counts one call against today's cap; false once the cap (less `keep` reserved calls) is used up.
function spend(service, keep = 0) {
  const today = new Date().toISOString().slice(0, 10);
  const used = load('used', {});
  if (used.day !== today) Object.assign(used, { day: today, geo: 0, vpn: 0 });
  if (used[service] >= DAILY_CAP[service] - keep) return false;
  used[service]++;
  save('used', used);
  return true;
}

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  return res.json();
}

// Location and VPN status for an IP, from the 24h cache unless a click forces a refetch.
// A forced refetch may use only half of each cap, so IP changes always have lookups left.
async function lookup(ip, force) {
  const now = Date.now();
  const cache = load('cache', {});
  for (const key in cache) if (now - cache[key].at > CACHE_MS) delete cache[key];
  const entry = cache[ip] || { at: now };
  const needGeo = !entry.geo;
  if (needGeo ? spend('geo') : force && spend('geo', DAILY_CAP.geo / 2)) {
    const geo = await getJson(GEO_API + ip);
    if (!geo.success) throw new Error(geo.message || 'lookup failed');
    entry.geo = { country: geo.country, city: geo.city, country_code: geo.country_code };
    entry.at = now;
  } else if (needGeo) {
    throw new Error('daily location lookup limit reached');
  }
  // A failed VPN check is not retried for the same IP, so a refusing service is not hammered.
  if (entry.vpnTried ? force && spend('vpn', DAILY_CAP.vpn / 2) : spend('vpn')) {
    entry.vpnTried = true;
    try {
      entry.vpn = (await getJson(`${VPN_API}${ip}?vpn=1`))[ip] || null;
    } catch (e) {
      entry.vpn = null;
    }
  }
  cache[ip] = entry;
  save('cache', cache);
  return entry;
}

function flag(cc) {
  return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1A5 + c.charCodeAt(0)));
}

function drawIcon(text) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const g = canvas.getContext('2d');
  g.font = "28px 'Twemoji Mozilla', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 16, 18);
  browser.browserAction.setIcon({ imageData: { 32: g.getImageData(0, 0, 32, 32) } });
}

function ago(ms) {
  const secs = Math.round((Date.now() - ms) / 1000);
  return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
}

function vpnText() {
  const vpn = current.vpn;
  if (!vpn) return 'unknown';
  if (vpn.proxy !== 'yes') return 'no';
  return vpn.operator ? `yes, ${vpn.type} (${vpn.operator.name})` : `yes, ${vpn.type}`;
}

function updateTitle() {
  const lines = [];
  if (current) {
    const geo = current.geo;
    lines.push(`IP: ${current.ip}`, `Country: ${geo ? geo.country : 'unknown'}`, `City: ${geo ? geo.city : 'unknown'}`,
      `VPN: ${vpnText()}`, `Fetched ${ago(checkedAt)} ago`);
  }
  if (error) lines.push(`Last refresh failed: ${error}`);
  if (fetching) lines.push('Fetching...');
  browser.browserAction.setTitle({ title: lines.join('\n') || 'Loading...' });
}

function updateBadge() {
  const vpn = current && current.vpn;
  const flagged = vpn && vpn.proxy === 'yes';
  const text = fetching ? '…' : flagged ? vpn.type.slice(0, 3).toUpperCase() : '';
  browser.browserAction.setBadgeText({ text });
  browser.browserAction.setBadgeBackgroundColor({ color: fetching ? '#666666' : '#d35400' });
}

async function refresh(force = false) {
  if (fetching || Date.now() - lastTry < MIN_GAP_MS) return;
  lastTry = Date.now();
  fetching = true;
  updateBadge();
  updateTitle();
  try {
    const { ip } = await getJson(IP_API);
    if (!current || current.ip !== ip) current = { ip };
    checkedAt = Date.now();
    Object.assign(current, await lookup(ip, force));
    error = null;
    drawIcon(flag(current.geo.country_code));
  } catch (e) {
    error = e.message;
    if (!current || !current.geo) browser.browserAction.setIcon({ path: 'icon.svg' });
  }
  fetching = false;
  updateBadge();
  updateTitle();
}

browser.browserAction.onClicked.addListener(() => refresh(true));
window.addEventListener('online', () => refresh());
setInterval(() => refresh(), POLL_MS);
setInterval(updateTitle, 1000);
refresh();
