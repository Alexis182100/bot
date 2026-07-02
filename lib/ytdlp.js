const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const execAsync = promisify(exec);
const TMP_DIR = path.join(__dirname, '..', 'tmp');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function ensureTmp() {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function findOutputFile(prefix, extensions) {
    const files = fs.readdirSync(TMP_DIR);
    return files.find((f) => f.startsWith(prefix) && extensions.some((ext) => f.endsWith(ext)));
}

async function runYtdlp(args, timeout = 180000) {
    const common = [
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        `--user-agent "${UA}"`,
        '--retries 3',
        '--fragment-retries 3'
    ].join(' ');

    const commands = [
        `yt-dlp ${common} ${args}`,
        `python3 -m yt_dlp ${common} ${args}`,
        `python -m yt_dlp ${common} ${args}`
    ];
    let lastErr;
    for (const cmd of commands) {
        try {
            await execAsync(cmd, { timeout, maxBuffer: 30 * 1024 * 1024, cwd: TMP_DIR });
            return true;
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error('yt-dlp no disponible. Ejecuta ./setup.sh en el VPS.');
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

/** 1ª opción: yt-dlp local */
async function downloadWithYtdlp(pageUrl, formatArgs, idPrefix, extensions, timeout) {
    ensureTmp();
    const id = `${idPrefix}_${Date.now()}`;
    const out = path.join(TMP_DIR, `${id}.%(ext)s`);
    await runYtdlp(`${formatArgs} -o "${out}" "${pageUrl}"`, timeout);
    const file = findOutputFile(id, extensions);
    if (!file) throw new Error('yt-dlp no generó archivo');
    return path.join(TMP_DIR, file);
}

/** 2ª opción: APIs gratuitas de respaldo */
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
        const { data } = await axios.post('https://api.cobalt.tools/api/json', {
            url,
            downloadMode: 'auto'
        }, {
            timeout: 30000,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA }
        });
        if (data?.url) return downloadUrlToFile(data.url, 'ig_api');
    } catch (e) {}

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

async function downloadYoutubeAudioViaApi(videoUrl) {
    const match = videoUrl.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([0-9A-Za-z_-]{11})/);
    if (!match) throw new Error('URL YouTube inválida');
    const { data } = await axios.get(`https://api.fabdl.com/youtube/get?id=${match[1]}`, { timeout: 30000 });
    const mp3Url = data?.result?.mp3 || data?.result?.download_url;
    if (!mp3Url) throw new Error('fabdl sin enlace');
    return downloadUrlToFile(mp3Url, 'yt_audio_api', '.mp3');
}

async function downloadYoutubeAudio(videoUrl) {
    try {
        return await downloadWithYtdlp(
            videoUrl,
            '-x --audio-format mp3 --audio-quality 0',
            'audio',
            ['.mp3', '.m4a', '.opus', '.webm'],
            120000
        );
    } catch (e) {
        console.warn('yt-dlp audio falló, probando API gratis...', e.message);
        return downloadYoutubeAudioViaApi(videoUrl);
    }
}

async function downloadYoutubeVideo(videoUrl) {
    try {
        return await downloadWithYtdlp(
            videoUrl,
            '-f "best[height<=720][ext=mp4]/best[ext=mp4]/best" --merge-output-format mp4',
            'video',
            ['.mp4', '.webm', '.mkv', '.mov'],
            180000
        );
    } catch (e) {
        console.warn('yt-dlp video falló, probando cobalt...', e.message);
        const { data } = await axios.post('https://api.cobalt.tools/api/json', {
            url: videoUrl,
            downloadMode: 'auto'
        }, { timeout: 30000, headers: { Accept: 'application/json', 'Content-Type': 'application/json' } });
        if (data?.url) return downloadUrlToFile(data.url, 'yt_video_api');
        throw e;
    }
}

async function downloadSocialVideo(pageUrl, platform) {
    const tiktokFmt = '-f "best[ext=mp4][vcodec^=avc]/best[ext=mp4]/best" --merge-output-format mp4 --referer "https://www.tiktok.com/"';
    const igFmt = '-f "best[ext=mp4]/best" --merge-output-format mp4';

    try {
        const fmt = platform === 'tiktok' ? tiktokFmt : igFmt;
        return await downloadWithYtdlp(pageUrl, fmt, 'social', ['.mp4', '.webm', '.mkv', '.mov'], 120000);
    } catch (e) {
        console.warn(`yt-dlp ${platform} falló, probando API gratis...`, e.message);
        if (platform === 'tiktok') return downloadTikTokViaApi(pageUrl);
        if (platform === 'instagram') return downloadInstagramViaApi(pageUrl);
        throw e;
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

    // Siempre H.264 + AAC en MP4 (WhatsApp no reproduce bien HEVC/webm como video)
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
    for (const cmd of ['yt-dlp --version', 'python3 -m yt_dlp --version']) {
        try {
            const { stdout } = await execAsync(cmd, { timeout: 10000 });
            return stdout.trim();
        } catch (e) {}
    }
    return null;
}

module.exports = {
    downloadYoutubeAudio,
    downloadYoutubeVideo,
    downloadSocialVideo,
    compressVideoIfNeeded,
    prepareVideoForWhatsApp,
    safeUnlink,
    checkYtdlpInstalled,
    TMP_DIR
};
