const axios = require('axios');

const DEFAULT_AVATAR = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="48" fill="#6b7c85"/><circle cx="48" cy="38" r="18" fill="#cfd8dc"/><ellipse cx="48" cy="78" rx="28" ry="16" fill="#cfd8dc"/></svg>'
)}`;

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\n/g, '<br>');
}

async function fetchImageAsDataUrl(url) {
    if (!url) return null;
    try {
        const { data, headers } = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const mime = (headers['content-type'] || 'image/jpeg').split(';')[0];
        return `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
    } catch {
        return null;
    }
}

function mediaLabelFromMime(mimetype) {
    if (!mimetype) return 'Multimedia';
    if (mimetype.startsWith('image/')) return 'Imagen';
    if (mimetype.startsWith('video/')) return 'Video';
    if (mimetype.startsWith('audio/')) return 'Audio';
    if (mimetype.startsWith('application/pdf')) return 'Documento PDF';
    return 'Archivo';
}

function buildQuoteHtml({ name, text, avatarDataUrl, hasMedia, mimetype, isViewOnce }) {
    const avatar = avatarDataUrl || DEFAULT_AVATAR;
    let bodyHtml;

    if (text && text.trim()) {
        bodyHtml = `<div class="msg-text">${escapeHtml(text)}</div>`;
    } else if (hasMedia) {
        const label = mediaLabelFromMime(mimetype);
        const extra = isViewOnce ? ' · Ver una vez' : '';
        bodyHtml = `<div class="msg-media">📎 ${escapeHtml(label)}${escapeHtml(extra)}</div>`;
    } else {
        bodyHtml = `<div class="msg-text muted">(mensaje vacío)</div>`;
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 512px;
    min-height: 120px;
    background: #0b141a;
    font-family: "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
    padding: 24px 20px;
    display: flex;
    align-items: flex-start;
  }
  .card {
    display: flex;
    gap: 12px;
    width: 100%;
    max-width: 472px;
  }
  .avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    background: #2a3942;
  }
  .bubble-wrap { flex: 1; min-width: 0; }
  .name {
    color: #53bdeb;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 4px;
    line-height: 1.2;
  }
  .bubble {
    background: #202c33;
    border-radius: 0 12px 12px 12px;
    padding: 10px 14px 12px;
    position: relative;
    box-shadow: 0 1px 2px rgba(0,0,0,.25);
    max-width: 100%;
  }
  .bubble::before {
    content: "";
    position: absolute;
    left: -8px;
    top: 0;
    border: 8px solid transparent;
    border-right-color: #202c33;
    border-top-color: #202c33;
  }
  .msg-text {
    color: #e9edef;
    font-size: 17px;
    line-height: 1.45;
    word-wrap: break-word;
    white-space: pre-wrap;
  }
  .msg-media {
    color: #8696a0;
    font-size: 16px;
    font-style: italic;
  }
  .muted { color: #8696a0; }
  .wa-bar {
    margin-top: 8px;
    font-size: 11px;
    color: #8696a0;
    text-align: right;
  }
</style>
</head>
<body>
  <div class="card">
    <img class="avatar" src="${avatar}" alt="">
    <div class="bubble-wrap">
      <div class="name">${escapeHtml(name)}</div>
      <div class="bubble">
        ${bodyHtml}
        <div class="wa-bar">WhatsApp</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function renderQuoteSticker(browser, options) {
    if (!browser) throw new Error('Navegador Puppeteer no disponible');

    const {
        name = 'Usuario',
        text = '',
        avatarUrl = null,
        hasMedia = false,
        mimetype = null,
        isViewOnce = false
    } = options;

    const avatarDataUrl = await fetchImageAsDataUrl(avatarUrl);
    const html = buildQuoteHtml({
        name,
        text,
        avatarDataUrl,
        hasMedia,
        mimetype,
        isViewOnce
    });

    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 512, height: 280, deviceScaleFactor: 2 });
        await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.evaluate(() => document.body.offsetHeight);
        const clipHeight = await page.evaluate(() => {
            const card = document.querySelector('.card');
            return Math.min(Math.max((card?.offsetHeight || 160) + 48, 140), 720);
        });
        await page.setViewport({ width: 512, height: clipHeight, deviceScaleFactor: 2 });
        await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
        return await page.screenshot({ type: 'png', fullPage: false });
    } finally {
        await page.close().catch(() => {});
    }
}

module.exports = { renderQuoteSticker, mediaLabelFromMime };
