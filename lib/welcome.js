const axios = require('axios');
const { MessageMedia } = require('whatsapp-web.js');

function isValidMedia(media) {
    return !!(media?.data && String(media.data).length > 100);
}

function mediaFromBase64(b64, mimetype = 'image/jpeg') {
    if (!b64) return null;
    return new MessageMedia(mimetype, b64, 'profile.jpg');
}

async function fetchProfilePicViaBrowser(client, chatId) {
    if (!client?.pupPage || !chatId) return null;
    try {
        const result = await client.pupPage.evaluate(async (id) => {
            const chatWid = window.Store.WidFactory.createWid(id);

            const blobToBase64 = (blob) => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const dataUrl = reader.result;
                    if (!dataUrl || typeof dataUrl !== 'string') return resolve(null);
                    const mime = dataUrl.split(';')[0].replace('data:', '') || 'image/jpeg';
                    const b64 = dataUrl.split(',')[1];
                    resolve(b64 ? { b64, mime } : null);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            const fetchUrlToBase64 = async (url) => {
                if (!url) return null;
                try {
                    const res = await fetch(url);
                    if (!res.ok) return null;
                    const blob = await res.blob();
                    if (!blob?.size) return null;
                    return blobToBase64(blob);
                } catch (e) {
                    return null;
                }
            };

            // 1) Método oficial de wwebjs — funciona bien en grupos
            try {
                const thumbB64 = await window.WWebJS.getProfilePicThumbToBase64(chatWid);
                if (thumbB64) return { b64: thumbB64, mime: 'image/jpeg' };
            } catch (e) {}

            // 2) Colección ProfilePicThumb (img / eurl)
            try {
                const collection = window.Store.ProfilePicThumb.get(id)
                    || await window.Store.ProfilePicThumb.find(chatWid);
                const fromCollection = await fetchUrlToBase64(collection?.img || collection?.eurl);
                if (fromCollection) return fromCollection;
            } catch (e) {}

            // 3) API de perfil del servidor
            try {
                const profilePic = window.compareWwebVersions(window.Debug.VERSION, '<', '2.3000.0')
                    ? await window.Store.ProfilePic.profilePicFind(chatWid)
                    : await window.Store.ProfilePic.requestProfilePicFromServer(chatWid);
                const fromServer = await fetchUrlToBase64(
                    profilePic?.eurl || profilePic?.imgFull || profilePic?.img
                );
                if (fromServer) return fromServer;
            } catch (e) {
                if (e?.name !== 'ServerStatusCodeError') { /* ignorar */ }
            }

            return null;
        }, chatId);

        return mediaFromBase64(result?.b64, result?.mime || 'image/jpeg');
    } catch (e) {
        console.error('welcome photo (browser):', chatId, e.message);
        return null;
    }
}

async function downloadProfileFromUrl(client, url) {
    if (!url) return null;

    // Descargar dentro del navegador (tiene cookies de WhatsApp)
    if (client?.pupPage) {
        try {
            const result = await client.pupPage.evaluate(async (imgUrl) => {
                try {
                    const res = await fetch(imgUrl);
                    if (!res.ok) return null;
                    const blob = await res.blob();
                    if (!blob?.size) return null;
                    const dataUrl = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    if (!dataUrl || typeof dataUrl !== 'string') return null;
                    return {
                        mime: dataUrl.split(';')[0].replace('data:', '') || 'image/jpeg',
                        b64: dataUrl.split(',')[1]
                    };
                } catch (e) {
                    return null;
                }
            }, url);
            const media = mediaFromBase64(result?.b64, result?.mime);
            if (isValidMedia(media)) return media;
        } catch (e) {}
    }

    try {
        const media = await MessageMedia.fromUrl(url, { unsafeMime: true });
        if (isValidMedia(media)) return media;
    } catch (e) {}

    try {
        const { data } = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const media = new MessageMedia('image/jpeg', Buffer.from(data).toString('base64'), 'profile.jpg');
        if (isValidMedia(media)) return media;
    } catch (e2) {}

    return null;
}

async function getContactProfileMedia(client, contactId) {
    const viaBrowser = await fetchProfilePicViaBrowser(client, contactId);
    if (isValidMedia(viaBrowser)) return viaBrowser;

    let pfpUrl = null;
    try {
        pfpUrl = await client.getProfilePicUrl(contactId);
    } catch (e) {}
    if (!pfpUrl) {
        try {
            const contact = await client.getContactById(contactId);
            pfpUrl = await contact.getProfilePicUrl();
        } catch (e) {}
    }
    return downloadProfileFromUrl(client, pfpUrl);
}

async function getGroupProfileMedia(client, chat) {
    const chatId = typeof chat === 'string' ? chat : chat?.id?._serialized;
    if (!chatId) return null;

    const viaBrowser = await fetchProfilePicViaBrowser(client, chatId);
    if (isValidMedia(viaBrowser)) return viaBrowser;

    let pfpUrl = null;
    try {
        pfpUrl = await client.getProfilePicUrl(chatId);
    } catch (e) {}
    return downloadProfileFromUrl(client, pfpUrl);
}

async function resolveWelcomePhoto(client, chat, memberId) {
    const userPhoto = await getContactProfileMedia(client, memberId);
    if (isValidMedia(userPhoto)) {
        return { media: userPhoto, source: 'user' };
    }

    const groupPhoto = await getGroupProfileMedia(client, chat);
    if (isValidMedia(groupPhoto)) {
        return { media: groupPhoto, source: 'group' };
    }

    console.warn(`🖼️ Bienvenida sin foto (usuario=${memberId}, grupo=${chat?.id?._serialized})`);
    return { media: null, source: 'none' };
}

const { getRandomWelcome } = require('./welcome-texts');

function buildWelcomeCaption({ contactName, memberId, groupName, description, memberCount, groupId }) {
    const userTag = memberId.split('@')[0];
    const descBlock = description?.trim()
        ? `\n\n📋 *Reglas / descripción:*\n${description.trim()}`
        : '';

    const frase = getRandomWelcome(groupId || groupName, {
        userTag,
        name: contactName,
        group: groupName,
        count: memberCount
    });

    return (
        `${frase}\n\n` +
        `╭─❏ 「 👤 𝐍𝐔𝐄𝐕𝐎 𝐌𝐈𝐄𝐌𝐁𝐑𝐎 」\n` +
        `│ ✨ *${contactName}*\n` +
        `│ 📍 ${groupName}\n` +
        `│ 👥 Ya somos *${memberCount}*\n` +
        `╰───────────⬣` +
        descBlock
    );
}

async function refreshGroupInfo(client, chat) {
    try {
        const fresh = await client.getChatById(chat.id._serialized);
        if (fresh?.isGroup) return fresh;
    } catch (e) {}
    return chat;
}

module.exports = {
    getContactProfileMedia,
    getGroupProfileMedia,
    resolveWelcomePhoto,
    buildWelcomeCaption,
    refreshGroupInfo
};
