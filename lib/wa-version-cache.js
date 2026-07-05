const fs = require('fs');
const path = require('path');
const axios = require('axios');

const REMOTE_URL =
    'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html';

function getCacheFilePath(cacheDir, version) {
    return path.join(cacheDir, `${version}.html`);
}

function hasValidCache(cacheDir, version) {
    const filePath = getCacheFilePath(cacheDir, version);
    try {
        return fs.existsSync(filePath) && fs.statSync(filePath).size > 1000;
    } catch (e) {
        return false;
    }
}

/**
 * Intenta tener la versión de WA Web en disco (.wwebjs_cache).
 * Si hay red, descarga una vez. Si no hay red pero ya existe caché, sigue.
 * Si falla todo, whatsapp-web.js usará web.whatsapp.com en vivo (strict: false).
 */
async function ensureWaVersionCache(cacheDir, version) {
    if (hasValidCache(cacheDir, version)) {
        console.log(`📦 WhatsApp Web en caché local (${version})`);
        return true;
    }

    fs.mkdirSync(cacheDir, { recursive: true });
    const url = REMOTE_URL.replace('{version}', version);

    try {
        const res = await axios.get(url, {
            timeout: 20000,
            responseType: 'text',
            validateStatus: s => s === 200
        });
        if (res.data && res.data.length > 1000) {
            fs.writeFileSync(getCacheFilePath(cacheDir, version), res.data);
            console.log(`✅ WhatsApp Web ${version} descargado y guardado en caché`);
            return true;
        }
    } catch (e) {
        const reason = e.code || e.response?.status || e.message;
        console.warn(`⚠️ No se pudo descargar WA Web ${version} (${reason})`);
        console.warn('   → Se usará web.whatsapp.com en vivo. Evita borrar .wwebjs_cache si ya funcionó.');
    }
    return false;
}

module.exports = { ensureWaVersionCache, hasValidCache, getCacheFilePath, REMOTE_URL };
