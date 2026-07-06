// Imagen decorativa del menú principal (se envía con el texto como caption).
// Se genera con el Chrome de whatsapp-web.js y se cachea en disco
// (solo se regenera si cambia el nombre del bot).
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'menu-sticker.png');
const CACHE_META = path.join(CACHE_DIR, 'menu-sticker.json');

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function buildStickerHtml(botName, creator) {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 512px; height: 512px;
    display: flex; align-items: center; justify-content: center;
    background: radial-gradient(circle at 30% 20%, #7b2ff7 0%, #4a0d8f 55%, #1c0333 100%);
    font-family: Arial, Helvetica, sans-serif;
    overflow: hidden; position: relative;
  }
  .glow {
    position: absolute; width: 340px; height: 340px; border-radius: 50%;
    background: radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 70%);
    top: 40px; left: 86px;
  }
  .card {
    position: relative; text-align: center; padding: 40px 30px;
    border: 3px solid rgba(255,255,255,0.35); border-radius: 36px;
    width: 420px;
    background: rgba(255,255,255,0.06);
    backdrop-filter: blur(2px);
  }
  .infinity { font-size: 84px; line-height: 1; }
  .name {
    color: #fff; font-size: 46px; font-weight: 800; letter-spacing: 2px;
    margin-top: 10px; text-shadow: 0 4px 18px rgba(0,0,0,0.5);
    word-break: break-word;
  }
  .divider {
    width: 60%; height: 3px; margin: 18px auto;
    background: linear-gradient(90deg, transparent, #ffd6ff, transparent);
    border-radius: 2px;
  }
  .menu-tag {
    display: inline-block; color: #2d0a4e; background: #ffd6ff;
    font-size: 30px; font-weight: 800; letter-spacing: 6px;
    padding: 10px 30px; border-radius: 999px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.35);
  }
  .creator { color: rgba(255,255,255,0.85); font-size: 20px; margin-top: 20px; letter-spacing: 1px; }
  .stars { position: absolute; color: rgba(255,255,255,0.7); font-size: 26px; }
</style></head>
<body>
  <div class="glow"></div>
  <div class="stars" style="top:36px;left:60px;">✦</div>
  <div class="stars" style="top:80px;right:70px;">✧</div>
  <div class="stars" style="bottom:60px;left:90px;">✧</div>
  <div class="stars" style="bottom:40px;right:60px;">✦</div>
  <div class="card">
    <div class="infinity">♾️</div>
    <div class="name">${escapeHtml(botName)}</div>
    <div class="divider"></div>
    <div class="menu-tag">M E N U</div>
    <div class="creator">by ${escapeHtml(creator)} 💜</div>
  </div>
</body></html>`;
}

async function getMenuStickerB64(browser, botName, creator) {
    const key = `${botName}|${creator}`;
    try {
        if (fs.existsSync(CACHE_FILE) && fs.existsSync(CACHE_META)) {
            const meta = JSON.parse(fs.readFileSync(CACHE_META, 'utf8'));
            if (meta.key === key) {
                return fs.readFileSync(CACHE_FILE).toString('base64');
            }
        }
    } catch (e) {}

    if (!browser) return null;
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
        await page.setContent(buildStickerHtml(botName, creator), { waitUntil: 'domcontentloaded' });
        const png = await page.screenshot({ type: 'png' });
        try {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
            fs.writeFileSync(CACHE_FILE, png);
            fs.writeFileSync(CACHE_META, JSON.stringify({ key }));
        } catch (e) {}
        return Buffer.from(png).toString('base64');
    } finally {
        await page.close().catch(() => {});
    }
}

function getCustomMenuImage(botProfile) {
    if (botProfile?.menuImage?.data && botProfile?.menuImage?.mimetype) {
        return {
            b64: botProfile.menuImage.data,
            mimetype: botProfile.menuImage.mimetype
        };
    }
    return null;
}

/** Imagen del menú: personalizada en botProfile o sticker auto-generado. */
async function resolveMenuImageB64(botProfile, browser, botName, creator) {
    const custom = getCustomMenuImage(botProfile);
    if (custom) return custom;
    const b64 = await getMenuStickerB64(browser, botName, creator);
    if (b64) return { b64, mimetype: 'image/png' };
    return null;
}

module.exports = { getMenuStickerB64, resolveMenuImageB64 };
