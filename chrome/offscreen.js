function flag(cc) {
  return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1A5 + c.charCodeAt(0)));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  const canvas = new OffscreenCanvas(32, 32);
  const g = canvas.getContext('2d');
  g.font = "28px 'Noto Color Emoji', 'Twemoji Mozilla', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(flag(msg.cc), 16, 18);
  const d = g.getImageData(0, 0, 32, 32);
  sendResponse({ width: 32, height: 32, data: Array.from(d.data) });
});
