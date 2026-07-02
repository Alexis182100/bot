const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { prepareVideoForWhatsApp } = require('./ytdlp');

async function sendVideoToChat(chat, filePath, caption = '') {
    let prepared = await prepareVideoForWhatsApp(filePath);

    const buildMedia = () => {
        const data = fs.readFileSync(prepared).toString('base64');
        const filename = path.basename(prepared, path.extname(prepared)) + '.mp4';
        return new MessageMedia('video/mp4', data, filename);
    };

    const opts = {
        caption: caption || undefined,
        sendVideoAsGif: false,
        sendMediaAsDocument: false
    };

    try {
        await chat.sendMessage(buildMedia(), opts);
    } catch (e) {
        console.warn('Reintento video con más compresión:', e.message);
        prepared = await prepareVideoForWhatsApp(prepared, 10);
        await chat.sendMessage(buildMedia(), opts);
    }

    return prepared;
}

module.exports = { sendVideoToChat };
