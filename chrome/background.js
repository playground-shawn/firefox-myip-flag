const IP_API = 'https://api.ipify.org?format=json';
const GEO_API = 'https://ipwho.is/';
const VPN_API = 'https://proxycheck.io/v2/';
// MV3 alarms fire at most every 30s, so that is the poll floor here (Firefox polls every 20s).
const MIN_GAP_MS = 5 * 1000;
const CACHE_MS = 24 * 60 * 60 * 1000;
// ponytail: per-browser caps sized so ~10 users behind one office IP stay under the
// free quotas (ipwho.is 1000/day, proxycheck 100/day); a shared server cache would lift this.
const DAILY_CAP = { geo: 50, vpn: 8 };

async function get(key, fallback) {
  const out = await chrome.storage.local.get(key);
  return out[key] ?? fallback;
}

// Counts one call against today's cap; false once the cap (less `keep` reserved calls) is used up.
async function spend(service, keep = 0) {
  const today = new Date().toISOString().slice(0, 10);
  const used = await get('used', {});
  if (used.day !== today) Object.assign(used, { day: today, geo: 0, vpn: 0 });
  if ((used[service] || 0) >= DAILY_CAP[service] - keep) return false;
  used[service] = (used[service] || 0) + 1;
  await chrome.storage.local.set({ used });
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
  const cache = await get('cache', {});
  for (const key in cache) if (now - cache[key].at > CACHE_MS) delete cache[key];
  const entry = cache[ip] || { at: now };
  const needGeo = !entry.geo;
  if (needGeo ? await spend('geo') : force && await spend('geo', DAILY_CAP.geo / 2)) {
    const geo = await getJson(GEO_API + ip);
    if (!geo.success) throw new Error(geo.message || 'lookup failed');
    entry.geo = { country: geo.country, city: geo.city, country_code: geo.country_code };
    entry.at = now;
  } else if (needGeo) {
    throw new Error('daily location lookup limit reached');
  }
  // A failed VPN check is not retried for the same IP, so a refusing service is not hammered.
  if (entry.vpnTried ? force && await spend('vpn', DAILY_CAP.vpn / 2) : await spend('vpn')) {
    entry.vpnTried = true;
    try {
      entry.vpn = (await getJson(`${VPN_API}${ip}?vpn=1`))[ip] || null;
    } catch (e) {
      entry.vpn = null;
    }
  }
  cache[ip] = entry;
  await chrome.storage.local.set({ cache });
  return entry;
}

// The service worker has no DOM, so an offscreen document renders the flag emoji to a bitmap.
async function drawFlag(cc) {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Render the country flag emoji into a toolbar icon bitmap.',
    });
  }
  const img = await chrome.runtime.sendMessage({ target: 'offscreen', cc });
  if (img && img.data) {
    const imageData = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    await chrome.action.setIcon({ imageData: { [img.width]: imageData } });
  }
}

function vpnText(vpn) {
  if (!vpn) return 'unknown';
  if (vpn.proxy !== 'yes') return 'no';
  return vpn.operator ? `yes, ${vpn.type} (${vpn.operator.name})` : `yes, ${vpn.type}`;
}

function clock(ms) {
  return new Date(ms).toLocaleTimeString();
}

async function paint(snap) {
  const lines = [];
  if (snap.ip) {
    lines.push(`IP: ${snap.ip}`, `Country: ${snap.geo ? snap.geo.country : 'unknown'}`,
      `City: ${snap.geo ? snap.geo.city : 'unknown'}`,
      `VPN: ${vpnText(snap.vpn)}`, `Fetched at ${clock(snap.checkedAt)}`);
  }
  if (snap.error) lines.push(`Last refresh failed: ${snap.error}`);
  await chrome.action.setTitle({ title: lines.join('\n') || 'Loading...' });
  const flagged = snap.vpn && snap.vpn.proxy === 'yes';
  await chrome.action.setBadgeText({ text: flagged ? snap.vpn.type.slice(0, 3).toUpperCase() : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#d35400' });
  if (snap.geo) await drawFlag(snap.geo.country_code);
  else await chrome.action.setIcon({ path: 'icon-128.png' });
}

async function refresh(force = false) {
  const now = Date.now();
  if (now - (await get('lastTry', 0)) < MIN_GAP_MS) return;
  await chrome.storage.local.set({ lastTry: now });
  await chrome.action.setBadgeText({ text: '…' });
  await chrome.action.setBadgeBackgroundColor({ color: '#666666' });
  const last = await get('last', {});
  let ip;
  try {
    ip = (await getJson(IP_API)).ip;
  } catch (e) {
    // Could not even learn the IP: keep the last snapshot and note the failure.
    return paint({ ...last, error: e.message });
  }
  let snap = { ip, checkedAt: now, geo: null, vpn: null, error: null };
  try {
    const entry = await lookup(ip, force);
    snap.geo = entry.geo;
    snap.vpn = entry.vpn;
  } catch (e) {
    // IP is known but its location is unavailable (e.g. daily cap): show it as unknown.
    snap.error = e.message;
  }
  await chrome.storage.local.set({ last: snap });
  await paint(snap);
}

chrome.alarms.create('poll', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'poll') refresh(); });
chrome.runtime.onStartup.addListener(() => refresh());
chrome.runtime.onInstalled.addListener(() => refresh());
chrome.action.onClicked.addListener(() => refresh(true));
