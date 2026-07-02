const { MessageMedia } = require('whatsapp-web.js');

const viewOnceCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function cacheKeyParts(msg) {
    const id = msg?.id?._serialized;
    const stanza = msg?.id?.id;
    const chat = msg?.from || msg?.to;
    return { id, stanza, chat };
}

function putCache(keys, entry) {
    const payload = { ...entry, at: Date.now() };
    for (const k of keys) {
        if (k) viewOnceCache.set(k, payload);
    }
}

function getFromCache(meta) {
    const keys = [
        meta.serialized,
        meta.stanza,
        meta.remote && meta.stanza ? `${meta.remote}:${meta.stanza}` : null
    ].filter(Boolean);

    for (const k of keys) {
        const hit = viewOnceCache.get(k);
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
    }
    return null;
}

function isViewOnceMsg(msg) {
    const d = msg?._data || {};
    return !!(
        msg?.isViewOnce || d.isViewOnce || d.viewOnce ||
        d.viewOnceMessageV2 || d.type === 'view_once'
    );
}

function buildAllMessageIds(meta) {
    const ids = new Set();
    const { remote, stanza, serialized, author, lid } = meta;
    if (serialized) ids.add(serialized);
    if (remote && stanza) {
        ids.add(`false_${remote}_${stanza}`);
        ids.add(`true_${remote}_${stanza}`);
        if (lid) ids.add(`false_${remote}_${stanza}_${lid}`);
        if (author?.includes('@')) ids.add(`false_${remote}_${stanza}_${author}`);
    }
    return [...ids];
}

async function openGroupChat(client, chatId) {
    if (!chatId || !client?.interface?.openChatWindow) return;
    try {
        const jid = chatId.includes('@') ? chatId : `${chatId}@g.us`;
        await client.interface.openChatWindow(jid);
        await sleep(2000);
    } catch (e) {
        console.error('openChatWindow:', e.message);
    }
}

async function blobFromPage(client) {
    return client.pupPage.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const toB64 = async (blob) => {
            const ab = await blob.arrayBuffer();
            return window.WWebJS.arrayBufferToBase64Async(ab);
        };

        const nodes = [
            ...document.querySelectorAll('img[src^="blob:"]'),
            ...document.querySelectorAll('video[src^="blob:"]')
        ];
        for (let i = nodes.length - 1; i >= 0; i--) {
            try {
                const src = nodes[i].currentSrc || nodes[i].src;
                const resp = await fetch(src);
                const blob = await resp.blob();
                if (blob.size > 2000) {
                    return { data: await toB64(blob), mimetype: blob.type || 'image/jpeg' };
                }
            } catch (e) {}
        }
        return null;
    });
}

async function clickViewPhotoDialog(client) {
    await client.pupPage.evaluate(() => {
        const all = [...document.querySelectorAll('div[role="button"], button, span, div')];
        for (const el of all) {
            const t = (el.textContent || '').trim().toLowerCase();
            if (/ver foto|view photo|view once|abrir foto|open photo|1 foto|photo/i.test(t) && t.length < 40) {
                el.click();
                return;
            }
        }
    });
}

/**
 * Captura view-once con clicks REALES de Puppeteer (no dispatchEvent).
 */
async function captureFromDom(client, meta) {
    if (!client?.pupPage || !meta?.stanza) return null;

    await openGroupChat(client, meta.remote);
    const stanza = meta.stanza;
    const selector = `[data-id*="${stanza}"]`;

    try {
        await client.pupPage.waitForSelector(selector, { timeout: 8000 });
    } catch (e) {
        console.error('DOM capture: burbuja no visible en chat');
        return null;
    }

    const row = await client.pupPage.$(selector);
    if (!row) return null;

    await row.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await sleep(1000);

    const box = await row.boundingBox();
    if (!box) return null;

    const cx = box.x + box.width * 0.5;
    const cy = box.y + box.height * 0.5;

    for (let round = 0; round < 4; round++) {
        await client.pupPage.mouse.click(cx, cy);
        await sleep(1200);
        await clickViewPhotoDialog(client);
        await sleep(1500);

        for (let poll = 0; poll < 12; poll++) {
            const blob = await blobFromPage(client);
            if (blob?.data) {
                return {
                    media: new MessageMedia(blob.mimetype, blob.data, 'ver.jpg'),
                    isViewOnce: true,
                    caption: ''
                };
            }
            await sleep(350);
        }

        // Click esquina superior del thumb (icono "1")
        await client.pupPage.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
        await sleep(1000);
    }

    // Screenshot del overlay / visor
    const shotSelectors = [
        '[data-animate-media-viewer]',
        '[data-testid="media-viewer"]',
        'div[role="dialog"] img',
        '#app img[src^="blob:"]'
    ];
    for (const sel of shotSelectors) {
        const el = await client.pupPage.$(sel);
        if (el) {
            try {
                const buf = await el.screenshot({ type: 'jpeg', quality: 93 });
                if (buf.length > 5000) {
                    return {
                        media: new MessageMedia('image/jpeg', buf.toString('base64'), 'ver.jpg'),
                        isViewOnce: true,
                        caption: ''
                    };
                }
            } catch (e) {}
        }
    }

    // Screenshot de la burbuja misma
    try {
        const buf = await row.screenshot({ type: 'jpeg', quality: 93 });
        if (buf.length > 3000) {
            return {
                media: new MessageMedia('image/jpeg', buf.toString('base64'), 'ver.jpg'),
                isViewOnce: true,
                caption: ''
            };
        }
    } catch (e) {}

    console.error('DOM capture failed: no_blob');
    return null;
}

/** Guarda view-once al llegar al bot (antes de que expire o se abra). */
async function cacheViewOnceFromMessage(client, msg) {
    if (!client?.pupPage || msg.fromMe) return;

    const { id, stanza, chat } = cacheKeyParts(msg);
    if (!id && !stanza) return;

    const maybeViewOnce = isViewOnceMsg(msg) ||
        (msg.hasMedia && (msg.type === 'image' || msg.type === 'video'));

    if (!maybeViewOnce && !msg.hasMedia) return;

    let media = null;
    try {
        if (msg.hasMedia) media = await msg.downloadMedia();
    } catch (e) {}

    if (!media?.data && id) {
        media = await forceDownloadById(client, id);
    }

    if (media?.data) {
        putCache([id, stanza, chat && stanza ? `${chat}:${stanza}` : null], {
            media,
            isViewOnce: isViewOnceMsg(msg)
        });
        console.log('📸 View-once cacheada:', stanza || id);
    }
}

async function forceDownloadById(client, msgId) {
    const result = await client.pupPage.evaluate(async (sid) => {
        const get = async (id) =>
            window.Store.Msg.get(id) || (await window.Store.Msg.getMessagesById([id]))?.messages?.[0];

        let m = await get(sid);
        if (!m) return null;

        for (let i = 0; i < 15; i++) {
            if (m.type === 'ciphertext') {
                try { await window.Store.MsgKeyRequest?.requestMissingKeys?.(m); } catch (e) {}
                await new Promise((r) => setTimeout(r, 400));
                m = await get(sid);
            } else break;
        }

        try {
            await m.downloadMedia?.({ downloadEvenIfExpensive: true, rmrReason: 1 });
        } catch (e) {}

        const blob = m.mediaData?.mediaBlob;
        if (m.mediaData?.mediaStage === 'RESOLVED' && blob) {
            const ab = await blob.arrayBuffer();
            return {
                mimetype: m.mimetype || blob.type || 'image/jpeg',
                data: await window.WWebJS.arrayBufferToBase64Async(ab)
            };
        }

        if (m.directPath || m.mediaKey) {
            try {
                const dec = await window.Store.DownloadManager.downloadAndMaybeDecrypt({
                    directPath: m.directPath,
                    encFilehash: m.encFilehash,
                    filehash: m.filehash,
                    mediaKey: m.mediaKey,
                    mediaKeyTimestamp: m.mediaKeyTimestamp,
                    type: m.type === 'view_once' ? 'image' : (m.type || 'image'),
                    signal: (new AbortController()).signal,
                    downloadQpl: { addAnnotations() { return this; }, addPoint() { return this; } }
                });
                return {
                    mimetype: m.mimetype || 'image/jpeg',
                    data: await window.WWebJS.arrayBufferToBase64Async(dec)
                };
            } catch (e) {}
        }
        return null;
    }, msgId);

    if (!result?.data) return null;
    return new MessageMedia(result.mimetype, result.data);
}

async function aggressiveExtractFromReply(client, replyMsg) {
    const replyId = replyMsg?.id?._serialized;
    if (!replyId || !client?.pupPage) {
        return { error: '❌ Bot no listo para extraer media.' };
    }

    const meta = await client.pupPage.evaluate(async (id) => {
        const getMsg = async (sid) =>
            window.Store.Msg.get(sid) || (await window.Store.Msg.getMessagesById([sid]))?.messages?.[0];

        const reply = await getMsg(id);
        if (!reply) return null;

        let quoted = null;
        try { quoted = window.Store.QuotedMsg?.getQuotedMsgObj?.(reply); } catch (e) {}

        const serialized = quoted?.id?._serialized || '';
        const lidMatch = serialized.match(/_(\d+@lid)$/i);

        const remote =
            reply.quotedRemoteJid?._serialized || reply.quotedRemoteJid ||
            quoted?.id?.remote?._serialized || quoted?.id?.remote ||
            reply.id?.remote?._serialized || reply.id?.remote;

        let stanza = reply.quotedStanzaID || quoted?.id?.id || '';
        if (!stanza && serialized) {
            const parts = serialized.replace(/^(true|false)_/, '').split('_');
            if (parts.length >= 2) stanza = parts[1];
        }
        if (stanza?.includes('_')) stanza = stanza.split('_')[0];

        const author =
            reply.quotedParticipant?._serialized || reply.quotedParticipant ||
            quoted?.author?._serialized || quoted?.author;

        return {
            remote: typeof remote === 'object' ? remote._serialized : remote,
            stanza,
            author: typeof author === 'object' ? author._serialized : author,
            lid: lidMatch ? lidMatch[1] : null,
            serialized,
            ts: quoted?.t || reply.t
        };
    }, replyId);

    if (!meta?.stanza) {
        return { error: '❌ No encontré el mensaje citado. Responde directamente a la foto.' };
    }

    // Paso 0: caché (guardada al recibir el mensaje)
    const cached = getFromCache(meta);
    if (cached?.media?.data) {
        return { media: cached.media, isViewOnce: true, caption: '' };
    }

    const idsToTry = buildAllMessageIds(meta);

    const storeResult = await client.pupPage.evaluate(async (payload) => {
        const { meta, idsToTry } = payload;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const getMsg = async (sid) =>
            window.Store.Msg.get(sid) || (await window.Store.Msg.getMessagesById([sid]))?.messages?.[0];

        function fields(m) {
            const mo = m?.mediaObject, md = m?.mediaData;
            return {
                directPath: m?.directPath || md?.directPath || mo?.directPath,
                mediaKey: m?.mediaKey || md?.mediaKey || mo?.mediaKey,
                encFilehash: m?.encFilehash || md?.encFilehash || mo?.encFilehash,
                filehash: m?.filehash || md?.filehash || mo?.filehash,
                mimetype: m?.mimetype || md?.mimetype || mo?.mimetype,
                type: m?.type || mo?.type
            };
        }

        async function download(m) {
            if (!m) return null;
            for (let i = 0; i < 20; i++) {
                if (m.type === 'ciphertext') {
                    try { await window.Store.MsgKeyRequest?.requestMissingKeys?.(m); } catch (e) {}
                    await sleep(400);
                    m = await getMsg(m.id?._serialized);
                    continue;
                }
                try { await m.downloadMedia?.({ downloadEvenIfExpensive: true, rmrReason: 1 }); } catch (e) {}
                const blob = m.mediaData?.mediaBlob;
                if (m.mediaData?.mediaStage === 'RESOLVED' && blob) {
                    const ab = await blob.arrayBuffer();
                    return { data: await window.WWebJS.arrayBufferToBase64Async(ab), mimetype: fields(m).mimetype || 'image/jpeg' };
                }
                const f = fields(m);
                if (f.directPath || f.mediaKey) {
                    try {
                        const dec = await window.Store.DownloadManager.downloadAndMaybeDecrypt({
                            directPath: f.directPath, encFilehash: f.encFilehash, filehash: f.filehash,
                            mediaKey: f.mediaKey, mediaKeyTimestamp: m.mediaKeyTimestamp,
                            type: f.type === 'view_once' ? 'image' : (f.type || 'image'),
                            signal: (new AbortController()).signal,
                            downloadQpl: { addAnnotations() { return this; }, addPoint() { return this; } }
                        });
                        return { data: await window.WWebJS.arrayBufferToBase64Async(dec), mimetype: f.mimetype || 'image/jpeg' };
                    } catch (e) {}
                }
                await sleep(400);
            }
            return null;
        }

        const candidates = [];
        const seen = new Set();
        const push = (m) => { const s = m?.id?._serialized; if (s && !seen.has(s)) { seen.add(s); candidates.push(m); } };

        for (const sid of idsToTry) push(await getMsg(sid));
        try {
            for (const m of window.Store.Msg.getModelsArray?.() || []) {
                if ((m.id?._serialized || '').includes(meta.stanza)) push(m);
            }
        } catch (e) {}

        for (const m of candidates) {
            const dl = await download(m);
            if (dl?.data) return { ok: true, ...dl };
        }
        return { error: 'no_store' };
    }, { meta, idsToTry });

    if (storeResult?.ok && storeResult.data) {
        const media = new MessageMedia(storeResult.mimetype || 'image/jpeg', storeResult.data);
        putCache([meta.serialized, meta.stanza], { media, isViewOnce: true });
        return { media, isViewOnce: true, caption: '' };
    }

    const domResult = await captureFromDom(client, meta);
    if (domResult?.media) {
        putCache([meta.serialized, meta.stanza], { media: domResult.media, isViewOnce: true });
        return domResult;
    }

    return {
        error:
            '❌ No pude extraer la foto *ver una vez*.\n\n' +
            '📌 *Haz esto en orden:*\n' +
            '1. Manda la foto ver una vez al grupo\n' +
            '2. Espera 2 segundos (el bot la guarda sola)\n' +
            '3. Responde esa foto con `.ver`\n\n' +
            '⚠️ No abras la foto en el navegador del bot antes del paso 3.'
    };
}

async function extractQuotedMedia(client, replyMsg) {
    return aggressiveExtractFromReply(client, replyMsg);
}

async function sendMediaAsView(chat, media, mode, caption, isViewOnce) {
    const mimetype = media.mimetype || 'application/octet-stream';
    const prefix = isViewOnce ? '📸 *Ver una vez extraída*\n\n' : '';

    if (mode === 'document') {
        return chat.sendMessage(media, { sendMediaAsDocument: true, caption: prefix + (caption || '') });
    }
    if (mimetype.startsWith('audio/')) {
        return chat.sendMessage(media, {
            sendAudioAsVoice: mimetype.includes('ogg') || mimetype.includes('opus'),
            caption: prefix + (caption || '')
        });
    }
    return chat.sendMessage(media, { caption: prefix + (caption || '') });
}

module.exports = {
    extractQuotedMedia,
    sendMediaAsView,
    aggressiveExtractFromReply,
    cacheViewOnceFromMessage
};
