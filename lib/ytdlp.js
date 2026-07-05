const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const execAsync = promisify(exec);
const TMP_DIR = path.join(__dirname, '..', 'tmp');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const COOKIES_FILE = process.env.YTDLP_COOKIES || path.join(__dirname, '..', 'cookies', 'youtube.txt');

function getCookiesArg() {
    try {
        if (fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 100) {
            return `--cookies "${COOKIES_FILE}"`;
        }
    } catch (e) {}
    return '';
}

function isYoutubeUrl(url) {
    return /youtube\.com|youtu\.be/i.test(url || '');
}

function extractYoutubeId(url) {
    const m = String(url || '').match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([0-9A-Za-z_-]{11})/);
    return m ? m[1] : null;
}

// Modo lite: serializa descargas pesadas (1 a la vez)
let downloadQueue = Promise.resolve();

function enqueueDownload(fn) {
    const run = downloadQueue.then(fn, fn);
    downloadQueue = run.catch(() => {});
    return run;
}

function ensureTmp() {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function findOutputFile(prefix, extensions) {
    const files = fs.readdirSync(TMP_DIR);
    return files.find((f) => f.startsWith(prefix) && extensions.some((ext) => f.endsWith(ext)));
}

// Detecta qué binarios de yt-dlp existen (no intenta python si no está)
let cachedYtdlpBases = null;
async function getYtdlpBases() {
    if (cachedYtdlpBases) return cachedYtdlpBases;
    const bases = [];
    for (const base of ['yt-dlp', 'python3 -m yt_dlp']) {
        try {
            await execAsync(`${base} --version`, { timeout: 8000 });
            bases.push(base);
        } catch (e) {}
    }
    cachedYtdlpBases = bases;
    return bases;
}

async function runYtdlp(args, timeout = 180000, { youtube = false, useCookies = false } = {}) {
    const parts = [
        '--no-playlist',
        '--no-warnings',
        '--no-update',
        '--no-check-certificates',
        `--user-agent "${UA}"`,
        '--retries 3',
        '--fragment-retries 3'
    ];

    if (youtube) {
        // Obligatorio desde yt-dlp 2025+: resuelve firmas de YouTube
        parts.push('--remote-components ejs:npm');
        if (useCookies) {
            const cookies = getCookiesArg();
            if (cookies) parts.push(cookies);
        }
    }

    const common = parts.join(' ');
    const bases = await getYtdlpBases();
    if (!bases.length) {
        throw new Error('yt-dlp no instalado. Ejecuta: ./setup.sh');
    }

    let lastErr;
    for (const base of bases) {
        try {
            await execAsync(`${base} ${common} ${args}`, {
                timeout,
                maxBuffer: 30 * 1024 * 1024,
                cwd: TMP_DIR
            });
            return true;
        } catch (e) {
            lastErr = e;
        }
    }
    const msg = lastErr?.stderr || lastErr?.message || String(lastErr);
    throw new Error(msg.slice(0, 400));
}

async function downloadUrlToFile(url, prefix, ext = '.mp4') {
    ensureTmp();
    const filePath = path.join(TMP_DIR, `${prefix}_${Date.now()}${ext}`);
    const { data } = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 120000,
        maxContentLength: 80 * 1024 * 1024,
        headers: { 'User-Agent': UA }
    });
    fs.writeFileSync(filePath, Buffer.from(data));
    return filePath;
}

async function downloadWithYtdlp(pageUrl, formatArgs, idPrefix, extensions, timeout, opts = {}) {
    ensureTmp();
    const id = `${idPrefix}_${Date.now()}`;
    const out = path.join(TMP_DIR, `${id}.%(ext)s`);
    await runYtdlp(`${formatArgs} -o "${out}" "${pageUrl}"`, timeout, {
        youtube: isYoutubeUrl(pageUrl),
        ...opts
    });
    const file = findOutputFile(id, extensions);
    if (!file) throw new Error('yt-dlp no generó archivo');
    return path.join(TMP_DIR, file);
}

async function downloadTikTokViaApi(rawUrl) {
    const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const apis = [
        () => axios.get('https://www.tikwm.com/api/', { params: { url }, timeout: 25000 }),
        () => axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, { timeout: 25000 })
    ];
    for (const call of apis) {
        try {
            const { data } = await call();
            const mp4 = data?.data?.play || data?.data?.hdplay || data?.video_url;
            if (mp4) return downloadUrlToFile(mp4, 'tt_api');
        } catch (e) {}
    }
    throw new Error('API TikTok falló');
}

async function downloadInstagramViaApi(rawUrl) {
    const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    try {
        const { data } = await axios.get('https://api.saveig.app/api/ajaxSearch.php', {
            params: { q: url, t: 'media', lang: 'es' },
            timeout: 25000,
            headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' }
        });
        const mp4 = data?.data?.[0]?.url || data?.items?.[0]?.video_versions?.[0]?.url;
        if (mp4) return downloadUrlToFile(mp4, 'ig_api');
    } catch (e) {}
    throw new Error('API Instagram falló');
}

/** Respaldo: APIs alternativas cuando yt-dlp falla */
async function downloadYoutubeAudioViaApi(videoUrl) {
    const id = extractYoutubeId(videoUrl);
    if (!id) throw new Error('URL YouTube inválida');

    // 1) Cobalt instancias comunitarias (v10)
    const cobaltInstances = [
        'https://cobalt-api.kwiatekmiki.com',
        'https://api.cobalt.tools'
    ];
    for (const base of cobaltInstances) {
        try {
            const { data } = await axios.post(`${base}/`, {
                url: videoUrl,
                downloadMode: 'audio',
                audioFormat: 'mp3',
                audioBitrate: '128'
            }, {
                timeout: 45000,
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': UA
                }
            });
            const dlUrl = data?.url || data?.tunnel?.[0] || data?.picker?.[0]?.url;
            if (dlUrl) return downloadUrlToFile(dlUrl, 'yt_api', '.mp3');
        } catch (e) {}
    }

    // 2) yt1s / similar via redirect API
    try {
        const { data } = await axios.get(`https://www.yt1s.com/api/ajaxSearch/index`, {
            params: { q: videoUrl, vt: 'mp3' },
            timeout: 30000,
            headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' }
        });
        const link = data?.links?.mp3?.k || data?.links?.mp3?.[0]?.k;
        if (link) {
            const { data: conv } = await axios.post('https://www.yt1s.com/api/ajaxConvert/index', {
                vid: id,
                k: link
            }, {
                timeout: 60000,
                headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' }
            });
            if (conv?.dlink) return downloadUrlToFile(conv.dlink, 'yt_api', '.mp3');
        }
    } catch (e) {}

    throw new Error('No se pudo descargar el audio (yt-dlp y APIs de respaldo fallaron)');
}

const YT_AUDIO_FMT = '-f bestaudio/best -x --audio-format mp3 --audio-quality 0';
const YT_AUDIO_EXTS = ['.mp3', '.m4a', '.opus', '.webm'];

function downloadYoutubeAudio(videoUrl) {
    return enqueueDownload(async () => {
        // 1ª: yt-dlp con EJS (sin cookies — las cookies rompen la resolución de firmas)
        try {
            return await downloadWithYtdlp(
                videoUrl, YT_AUDIO_FMT, 'audio', YT_AUDIO_EXTS, 120000, { useCookies: false }
            );
        } catch (e1) {
            console.warn('yt-dlp audio (sin cookies):', e1.message?.slice(0, 150));
        }

        // 2ª: yt-dlp con cookies (VPS con bloqueo de bot)
        try {
            return await downloadWithYtdlp(
                videoUrl, YT_AUDIO_FMT, 'audio', YT_AUDIO_EXTS, 120000, { useCookies: true }
            );
        } catch (e2) {
            console.warn('yt-dlp audio (con cookies):', e2.message?.slice(0, 150));
        }

        // 3ª: APIs de respaldo
        console.warn('yt-dlp agotado, probando APIs de respaldo...');
        return downloadYoutubeAudioViaApi(videoUrl);
    });
}

function downloadYoutubeVideo(videoUrl) {
    return enqueueDownload(async () => {
        const fmt = '-f "best[height<=720][ext=mp4]/best[ext=mp4]/best" --merge-output-format mp4';
        try {
            return await downloadWithYtdlp(
                videoUrl, fmt, 'video', ['.mp4', '.webm', '.mkv', '.mov'], 180000, { useCookies: false }
            );
        } catch (e1) {
            console.warn('yt-dlp video (sin cookies):', e1.message?.slice(0, 150));
        }
        try {
            return await downloadWithYtdlp(
                videoUrl, fmt, 'video', ['.mp4', '.webm', '.mkv', '.mov'], 180000, { useCookies: true }
            );
        } catch (e2) {
            console.warn('yt-dlp video (con cookies):', e2.message?.slice(0, 150));
            throw e2;
        }
    });
}

function downloadSocialVideo(pageUrl, platform) {
    return enqueueDownload(async () => {
        const tiktokFmt = '-f "best[ext=mp4][vcodec^=avc]/best[ext=mp4]/best" --merge-output-format mp4 --referer "https://www.tiktok.com/"';
        const igFmt = '-f "best[ext=mp4]/best" --merge-output-format mp4';

        try {
            const fmt = platform === 'tiktok' ? tiktokFmt : igFmt;
            return await downloadWithYtdlp(pageUrl, fmt, 'social', ['.mp4', '.webm', '.mkv', '.mov'], 120000);
        } catch (e) {
            console.warn(`yt-dlp ${platform} falló, probando API...`, e.message?.slice(0, 100));
            if (platform === 'tiktok') return downloadTikTokViaApi(pageUrl);
            if (platform === 'instagram') return downloadInstagramViaApi(pageUrl);
            throw e;
        }
    });
}

function sweepTmpDir(maxAgeMs = 2 * 60 * 60 * 1000) {
    try {
        if (!fs.existsSync(TMP_DIR)) return 0;
        const now = Date.now();
        let removed = 0;
        for (const f of fs.readdirSync(TMP_DIR)) {
            const fp = path.join(TMP_DIR, f);
            try {
                const st = fs.statSync(fp);
                if (st.isFile() && now - st.mtimeMs > maxAgeMs) {
                    fs.unlinkSync(fp);
                    removed++;
                }
            } catch (e) {}
        }
        if (removed > 0) console.log(`🧹 tmp/: ${removed} archivo(s) viejos eliminados`);
        return removed;
    } catch (e) {
        return 0;
    }
}

async function prepareVideoForWhatsApp(filePath, maxMb = 15) {
    if (!filePath || !fs.existsSync(filePath)) return filePath;

    async function transcode(input, crf, scale) {
        const out = path.join(TMP_DIR, `wa_${Date.now()}_${crf}.mp4`);
        await execAsync(
            `ffmpeg -y -i "${input}" -vcodec libx264 -profile:v main -level 3.1 -pix_fmt yuv420p ` +
            `-crf ${crf} -preset fast -vf "scale='min(${scale},iw)':-2" ` +
            `-acodec aac -b:a 128k -ar 44100 -movflags +faststart -max_muxing_queue_size 9999 "${out}"`,
            { timeout: 180000, maxBuffer: 15 * 1024 * 1024 }
        );
        if (input !== filePath && input.includes(TMP_DIR)) safeUnlink(input);
        return out;
    }

    let current = filePath;
    let crf = 23;
    let scale = 720;

    current = await transcode(current, crf, scale);

    let size = fs.statSync(current).size;
    while (size > maxMb * 1024 * 1024 && crf <= 35) {
        crf += 3;
        if (crf > 29) scale = 480;
        if (crf > 32) scale = 360;
        current = await transcode(current, crf, scale);
        size = fs.statSync(current).size;
    }

    if (filePath !== current && filePath.includes(TMP_DIR)) safeUnlink(filePath);
    return current;
}

async function compressVideoIfNeeded(filePath, maxMb = 14) {
    return prepareVideoForWhatsApp(filePath, maxMb);
}

function safeUnlink(filePath) {
    if (!filePath) return;
    try { fs.unlinkSync(filePath); } catch (e) {}
}

async function checkYtdlpInstalled() {
    const bases = await getYtdlpBases();
    if (!bases.length) return null;
    try {
        const { stdout } = await execAsync(`${bases[0]} --version`, { timeout: 10000 });
        return stdout.trim();
    } catch (e) {
        return null;
    }
}

module.exports = {
    downloadYoutubeAudio,
    downloadYoutubeVideo,
    downloadSocialVideo,
    compressVideoIfNeeded,
    prepareVideoForWhatsApp,
    safeUnlink,
    checkYtdlpInstalled,
    sweepTmpDir,
    COOKIES_FILE,
    TMP_DIR
};
