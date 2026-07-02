function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function wrapLines(text, maxLen = 18) {
    const words = String(text || 'brat').split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
        if ((line + ' ' + w).trim().length > maxLen && line) {
            lines.push(line.trim());
            line = w;
        } else {
            line = line ? `${line} ${w}` : w;
        }
    }
    if (line) lines.push(line.trim());
    return lines.slice(0, 6);
}

function buildBratHtml(text) {
    const lines = wrapLines(text);
    const lineHtml = lines.map((l) => `<div class="line">${escapeHtml(l)}</div>`).join('');

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 512px; height: 512px;
    background: #8ACE00;
    display: flex; align-items: center; justify-content: center;
    font-family: Arial, Helvetica, sans-serif;
    padding: 36px;
  }
  .box { width: 100%; }
  .line {
    color: #000;
    font-size: 42px;
    font-weight: 700;
    line-height: 1.05;
    text-transform: lowercase;
    letter-spacing: -0.02em;
    margin-bottom: 6px;
    word-break: break-word;
  }
</style></head>
<body><div class="box">${lineHtml}</div></body></html>`;
}

async function renderBratSticker(browser, text) {
    if (!browser) throw new Error('Navegador no disponible');
    const html = buildBratHtml(text);
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 2 });
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        return await page.screenshot({ type: 'png' });
    } finally {
        await page.close().catch(() => {});
    }
}

module.exports = { renderBratSticker };
