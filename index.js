// Bugfix para Node v18 y Undici (ReferenceError: File is not defined)
if (!global.File) {
    global.File = class File {
        constructor(chunks, name, options) {
            this.name = name;
            this.size = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        }
    };
}

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');
const execAsync = promisify(exec);
const ytSearch = require('yt-search');
const axios = require('axios');
const { loadEnv } = require('./load-env');
const { MENU_COMMAND_NAMES, MENU_COMMAND_COUNT } = require('./menu-commands');
const { buildDefaultMenuText, buildDefaultCustomText, hasCommandContent } = require('./menu-defaults');
const { renderQuoteSticker } = require('./quote-card');
const { extractQuotedMedia, sendMediaAsView, cacheViewOnceFromMessage } = require('./media-view');
const {
    downloadYoutubeAudio,
    downloadYoutubeVideo,
    downloadSocialVideo,
    safeUnlink,
    checkYtdlpInstalled
} = require('./lib/ytdlp');
const { sendVideoToChat } = require('./lib/media-send');
const {
    resolveWelcomePhoto,
    buildWelcomeCaption,
    refreshGroupInfo
} = require('./lib/welcome');
const { getWeather, getExchangeRates, convertCurrency } = require('./lib/weather-fx');
const { getHoroscope, translateText } = require('./lib/local-tools');
const { renderBratSticker } = require('./lib/brat-card');

loadEnv();

const { 
    MENU_PRINCIPAL, 
    MENU_VENTAS, 
    MENU_FREE_FIRE, 
    MENU_STICKERS, 
    MENU_HERRAMIENTAS,
    MENU_ADMINS,
    MENU_LOGOS,
    MENU_VENTAS2,
    MENU_FUN,
    MENU_HOT,
    MENU_GRUPO
} = require('./menus');

const MENU_COMMAND_SET = new Set(MENU_COMMAND_NAMES);
console.log(`📋 Comandos de menú cargados: ${MENU_COMMAND_COUNT}`);
const GRUPO_EXTRAS_FILE = './grupoextras.json';

let grupoExtras = [];
if (fs.existsSync(GRUPO_EXTRAS_FILE)) {
    grupoExtras = JSON.parse(fs.readFileSync(GRUPO_EXTRAS_FILE, 'utf8'));
} else {
    fs.writeFileSync(GRUPO_EXTRAS_FILE, JSON.stringify(grupoExtras));
}

function saveGrupoExtras() {
    fs.promises.writeFile(GRUPO_EXTRAS_FILE, JSON.stringify(grupoExtras, null, 2))
        .catch(err => console.error("Error guardando grupoextras:", err));
}

function isMenuCommand(name) {
    return MENU_COMMAND_SET.has(name) || grupoExtras.includes(name);
}

function extractYoutubeId(url) {
    const match = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([0-9A-Za-z_-]{11})/);
    return match ? match[1] : null;
}

// Descargas: lib/ytdlp.js (yt-dlp local — sin APIs de terceros)
// ==========================================
// ALMACENAMIENTO (Base de Datos JSON)
// ==========================================
const STOCK_DATA_FILE = './stockdata.json';
const PAGO_DATA_FILE = './pagodata.json';
const CUSTOM_COMMANDS_FILE = './customcommands.json';
const MENU_COMMANDS_FILE = './menucommands.json';
const MUTED_USERS_FILE = './mutedusers.json';
const WARNS_FILE = './warns.json';
const SCHEDULED_FILE = './scheduled.json';
const POLLS_FILE = './polls.json';

// Stock con imagen (por grupo: { groupId: { itemKey: {...} } })
let stockData = {};
if (fs.existsSync(STOCK_DATA_FILE)) {
    stockData = JSON.parse(fs.readFileSync(STOCK_DATA_FILE, 'utf8'));
} else {
    fs.writeFileSync(STOCK_DATA_FILE, JSON.stringify(stockData));
}

// Método de pago con imagen (por grupo: { groupId: { metodo: {...} } })
let pagoData = {};
if (fs.existsSync(PAGO_DATA_FILE)) {
    pagoData = JSON.parse(fs.readFileSync(PAGO_DATA_FILE, 'utf8'));
} else {
    fs.writeFileSync(PAGO_DATA_FILE, JSON.stringify(pagoData));
}

function isLegacyStockFormat(data) {
    return Object.keys(data).some(k => !k.includes('@') && k !== '_global' && data[k]?.text !== undefined);
}

function migrateStockPagoData() {
    if (isLegacyStockFormat(stockData)) {
        stockData = { _global: { ...stockData } };
        saveStockData();
    }
    if (pagoData.metodo) {
        pagoData = { _global: { metodo: pagoData.metodo } };
        fs.writeFileSync(PAGO_DATA_FILE, JSON.stringify(pagoData, null, 2));
    }
}

function getDataGroupKey(chat, isGroup) {
    return isGroup ? chat.id._serialized : '_global';
}

function getGroupStock(groupKey) {
    if (!stockData[groupKey]) stockData[groupKey] = {};
    return stockData[groupKey];
}

function getGroupPago(groupKey) {
    if (!pagoData[groupKey]) pagoData[groupKey] = {};
    return pagoData[groupKey];
}

// Comandos personalizados
let customCommands = {};
if (fs.existsSync(CUSTOM_COMMANDS_FILE)) {
    customCommands = JSON.parse(fs.readFileSync(CUSTOM_COMMANDS_FILE, 'utf8'));
} else {
    fs.writeFileSync(CUSTOM_COMMANDS_FILE, JSON.stringify(customCommands));
}

// Comandos de menú (diamantes, canva, actas, etc.)
let menuCommands = {};
if (fs.existsSync(MENU_COMMANDS_FILE)) {
    menuCommands = JSON.parse(fs.readFileSync(MENU_COMMANDS_FILE, 'utf8'));
} else {
    fs.writeFileSync(MENU_COMMANDS_FILE, JSON.stringify(menuCommands));
}

// Usuarios muteados
let mutedUsers = {}; // Formato: { "chatId_userId": { mutedUntil: timestamp, reason: string } }
if (fs.existsSync(MUTED_USERS_FILE)) {
    mutedUsers = JSON.parse(fs.readFileSync(MUTED_USERS_FILE, 'utf8'));
} else {
    fs.writeFileSync(MUTED_USERS_FILE, JSON.stringify(mutedUsers));
}

// Advertencias por grupo
let warnsData = {};
if (fs.existsSync(WARNS_FILE)) {
    warnsData = JSON.parse(fs.readFileSync(WARNS_FILE, 'utf8'));
} else {
    fs.writeFileSync(WARNS_FILE, JSON.stringify(warnsData));
}

function saveWarns() {
    fs.promises.writeFile(WARNS_FILE, JSON.stringify(warnsData, null, 2)).catch(err => console.error("Error guardando warns:", err));
}

// Mensajes programados
let scheduledMessages = [];
if (fs.existsSync(SCHEDULED_FILE)) {
    scheduledMessages = JSON.parse(fs.readFileSync(SCHEDULED_FILE, 'utf8'));
} else {
    fs.writeFileSync(SCHEDULED_FILE, JSON.stringify(scheduledMessages));
}

function saveScheduled() {
    fs.promises.writeFile(SCHEDULED_FILE, JSON.stringify(scheduledMessages, null, 2)).catch(err => console.error("Error guardando scheduled:", err));
}

let activePolls = {};
if (fs.existsSync(POLLS_FILE)) {
    try { activePolls = JSON.parse(fs.readFileSync(POLLS_FILE, 'utf8')); } catch (e) { activePolls = {}; }
} else {
    fs.writeFileSync(POLLS_FILE, JSON.stringify(activePolls));
}

function savePolls() {
    fs.promises.writeFile(POLLS_FILE, JSON.stringify(activePolls, null, 2)).catch(err => console.error("Error guardando polls:", err));
}
const floodTracker = {};
const WARN_KICK_LIMIT = 3;
const BOT_START_TIME = Date.now();

function saveStockData() {
    fs.promises.writeFile(STOCK_DATA_FILE, JSON.stringify(stockData, null, 2)).catch(err => console.error("Error guardando stockdata:", err));
}

function savePagoData() {
    fs.promises.writeFile(PAGO_DATA_FILE, JSON.stringify(pagoData, null, 2)).catch(err => console.error("Error guardando pagodata:", err));
}

migrateStockPagoData();

function saveCustomCommands() {
    fs.promises.writeFile(CUSTOM_COMMANDS_FILE, JSON.stringify(customCommands, null, 2)).catch(err => console.error("Error guardando customcommands:", err));
}

function saveMenuCommands() {
    fs.promises.writeFile(MENU_COMMANDS_FILE, JSON.stringify(menuCommands, null, 2)).catch(err => console.error("Error guardando menucommands:", err));
}

function saveMutedUsers() {
    fs.promises.writeFile(MUTED_USERS_FILE, JSON.stringify(mutedUsers, null, 2)).catch(err => console.error("Error guardando mutedusers:", err));
}

// ==========================================
// ESTADO DE GRUPOS (Persistente)
// ==========================================
const GROUPS_FILE = './groups.json';
let activeGroups = [];
if (fs.existsSync(GROUPS_FILE)) {
    activeGroups = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
} else {
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(activeGroups));
}

function saveGroups() {
    fs.promises.writeFile(GROUPS_FILE, JSON.stringify(activeGroups, null, 2)).catch(err => console.error("Error guardando groups:", err));
}

function isActiveGroup(chatId) {
    return !!(chatId && activeGroups.includes(chatId));
}

// ==========================================
// CONFIGURACIÓN GLOBAL
// ==========================================
const ADMIN_PRIVILEGIADO = process.env.ADMIN_PRIVILEGIADO || '7571040521';
const BOT_L2_CODE = process.env.BOT_L2_CODE || '2118';
const BOT_PROFILE_FILE = './botprofile.json';

function getBotL2Panel() {
    const c = BOT_L2_CODE;
    return `╔══════════════════════════╗
║  ♾️ BOT L2 — PANEL MAESTRO ♾️  ║
╚══════════════════════════╝

🔐 Acceso autorizado con código *${c}*

*╭── PERFIL DEL BOT ──╮*
│ *.botl2 ${c} nombre [texto]*
│   Cambia el nombre visible (máx. 25)
│
│ *.botl2 ${c} status [texto]*
│   Cambia el estado / about (máx. 139)
│
│ *.botl2 ${c} foto*
│   Responde a una imagen o envíala con el comando
│
│ *.botl2 ${c} quitarfoto*
│   Elimina la foto de perfil personalizada
│
│ *.botl2 ${c} info*
│   Ver perfil actual del bot
│
│ *.botl2 ${c} aplicar*
│   Re-aplica nombre, status y foto guardados
│
│ *.botl2 ${c} auto on/off*
│   Auto-aplicar perfil al reiniciar el bot
│
│ *.botl2 ${c} historial*
│   Últimos cambios realizados
*╰────────────────────╯*

_El perfil se guarda en botprofile.json_`;
}

let botProfile = {
    displayName: null,
    status: null,
    profilePhoto: null,
    hasCustomPhoto: false,
    autoApplyOnStart: true,
    history: []
};
if (fs.existsSync(BOT_PROFILE_FILE)) {
    try {
        botProfile = { ...botProfile, ...JSON.parse(fs.readFileSync(BOT_PROFILE_FILE, 'utf8')) };
    } catch (e) {
        console.error('Error leyendo botprofile.json:', e);
    }
} else {
    fs.writeFileSync(BOT_PROFILE_FILE, JSON.stringify(botProfile, null, 2));
}

function saveBotProfile() {
    fs.promises.writeFile(BOT_PROFILE_FILE, JSON.stringify(botProfile, null, 2))
        .catch(err => console.error('Error guardando botprofile:', err));
}

function logBotProfileChange(action, value, by) {
    botProfile.history.unshift({ action, value, by: by || 'desconocido', at: Date.now() });
    if (botProfile.history.length > 25) botProfile.history.length = 25;
    saveBotProfile();
}

async function extractImageMediaFromMessage(msg) {
    if (msg.hasQuotedMsg) {
        const quoted = await msg.getQuotedMessage();
        if (quoted.hasMedia) {
            const media = await quoted.downloadMedia();
            if (media?.mimetype?.startsWith('image/')) return media;
        }
    }
    if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (media?.mimetype?.startsWith('image/')) return media;
    }
    return null;
}

function getBotDisplayName() {
    return botProfile.displayName || client.info?.pushname || 'INFINITY BOT';
}

function getBotBrandFooter() {
    return `\n\n> ✨♾️ ${getBotDisplayName()} ♾️✨`;
}

async function getBotProfileInfoText() {
    const info = client.info;
    const wid = info?.wid?._serialized || 'N/A';
    const pushname = getBotDisplayName();
    let hasPhoto = '❓';
    try {
        const url = await client.getProfilePicUrl(wid);
        hasPhoto = url ? '✅ Sí' : '❌ No';
    } catch (e) {
        hasPhoto = botProfile.hasCustomPhoto ? '✅ Sí (guardada)' : '❌ No';
    }
    return (
        `♾️ *PERFIL ACTUAL DEL BOT*\n\n` +
        `📛 Nombre: *${pushname}*\n` +
        `📝 Estado guardado: _${botProfile.status || '(sin configurar)'}_\n` +
        `📛 Nombre guardado: _${botProfile.displayName || '(sin configurar)'}_\n` +
        `🖼️ Foto personalizada: ${botProfile.hasCustomPhoto ? '✅' : '❌'}\n` +
        `🔄 Auto-aplicar al inicio: ${botProfile.autoApplyOnStart ? '✅' : '❌'}\n` +
        `🆔 ID: \`${wid}\`\n` +
        `📱 Número: \`${info?.wid?.user || 'N/A'}\``
    );
}

async function applySavedBotProfile(silent) {
    const results = [];
    if (botProfile.displayName) {
        try {
            const ok = await client.setDisplayName(botProfile.displayName);
            results.push(ok ? `📛 Nombre → *${botProfile.displayName}*` : '📛 Nombre → ⚠️ WhatsApp no permitió el cambio');
        } catch (e) {
            results.push('📛 Nombre → ❌ Error');
        }
    }
    if (botProfile.status) {
        try {
            await client.setStatus(botProfile.status);
            results.push(`📝 Status → _${botProfile.status}_`);
        } catch (e) {
            results.push('📝 Status → ❌ Error');
        }
    }
    if (botProfile.profilePhoto?.data && botProfile.profilePhoto?.mimetype) {
        try {
            const media = new MessageMedia(botProfile.profilePhoto.mimetype, botProfile.profilePhoto.data);
            const ok = await client.setProfilePicture(media);
            results.push(ok ? '🖼️ Foto → ✅ Aplicada' : '🖼️ Foto → ⚠️ No se pudo aplicar');
        } catch (e) {
            results.push('🖼️ Foto → ❌ Error');
        }
    }
    if (!silent && results.length === 0) {
        return 'ℹ️ No hay configuración guardada para aplicar.';
    }
    return results.join('\n');
}

async function handleBotL2Command(msg, chat, argsArray, senderNumber) {
    if (argsArray.length === 0) {
        return msg.reply(
            `🔐 *BOT L2 — Panel de Configuración*\n\n` +
            `Panel maestro para personalizar el bot.\n` +
            `Uso: *.botl2 ${BOT_L2_CODE}* para ver el menú completo.`
        );
    }

    if (argsArray[0] !== BOT_L2_CODE) {
        return msg.reply('🚫 *Código incorrecto.* Acceso denegado al panel BOT L2.');
    }

    const sub = (argsArray[1] || 'panel').toLowerCase();
    const rest = argsArray.slice(2).join(' ').trim();

    if (['panel', 'menu', 'ayuda', 'help'].includes(sub)) {
        return msg.reply(getBotL2Panel());
    }

    if (sub === 'info' || sub === 'ver') {
        return msg.reply(await getBotProfileInfoText());
    }

    if (sub === 'historial' || sub === 'history') {
        if (!botProfile.history.length) return msg.reply('📜 Sin cambios registrados aún.');
        let txt = '📜 *HISTORIAL BOT L2*\n\n';
        botProfile.history.slice(0, 10).forEach((h, i) => {
            const date = new Date(h.at).toLocaleString('es-MX');
            txt += `${i + 1}. *${h.action}* — ${h.value}\n   👤 ${h.by} · ${date}\n`;
        });
        return msg.reply(txt);
    }

    if (sub === 'auto') {
        if (rest === 'on') {
            botProfile.autoApplyOnStart = true;
            saveBotProfile();
            return msg.reply('✅ *Auto-aplicar activado.* El perfil se restaurará al reiniciar el bot.');
        }
        if (rest === 'off') {
            botProfile.autoApplyOnStart = false;
            saveBotProfile();
            return msg.reply('🔕 *Auto-aplicar desactivado.*');
        }
        return msg.reply(`⚠️ Uso: *.botl2 ${BOT_L2_CODE} auto on* o *.botl2 ${BOT_L2_CODE} auto off*`);
    }

    if (sub === 'aplicar' || sub === 'apply') {
        await msg.reply('⏳ _Aplicando perfil guardado..._');
        const result = await applySavedBotProfile(false);
        return msg.reply(`✅ *Perfil aplicado*\n\n${result}`);
    }

    if (sub === 'nombre' || sub === 'name') {
        if (!rest) return msg.reply(`⚠️ Uso: *.botl2 ${BOT_L2_CODE} nombre Mi Bot Nuevo*`);
        if (rest.length > 25) return msg.reply('⚠️ El nombre máximo es *25 caracteres*.');

        await msg.reply('⏳ _Actualizando nombre del bot..._');
        try {
            const ok = await client.setDisplayName(rest);
            if (!ok) return msg.reply('❌ WhatsApp no permitió cambiar el nombre. Intenta más tarde.');
            botProfile.displayName = rest;
            logBotProfileChange('nombre', rest, senderNumber);
            return msg.reply(`✅ *Nombre actualizado*\n\n📛 Nuevo nombre: *${rest}*`);
        } catch (e) {
            console.error('botl2 nombre:', e);
            return msg.reply('❌ Error al cambiar el nombre del bot.');
        }
    }

    if (sub === 'status' || sub === 'about' || sub === 'bio') {
        if (!rest) return msg.reply(`⚠️ Uso: *.botl2 ${BOT_L2_CODE} status ♾️ En línea y listo*`);
        if (rest.length > 139) return msg.reply('⚠️ El estado máximo es *139 caracteres*.');

        await msg.reply('⏳ _Actualizando estado del bot..._');
        try {
            await client.setStatus(rest);
            botProfile.status = rest;
            logBotProfileChange('status', rest, senderNumber);
            return msg.reply(`✅ *Estado actualizado*\n\n📝 _${rest}_`);
        } catch (e) {
            console.error('botl2 status:', e);
            return msg.reply('❌ Error al cambiar el estado del bot.');
        }
    }

    if (sub === 'foto' || sub === 'photo' || sub === 'pfp') {
        const media = await extractImageMediaFromMessage(msg);
        if (!media) {
            return msg.reply(
                '⚠️ Envía una *imagen* con el comando o responde a una con:\n' +
                `*.botl2 ${BOT_L2_CODE} foto*`
            );
        }

        await msg.reply('⏳ _Actualizando foto de perfil..._');
        try {
            const ok = await client.setProfilePicture(media);
            if (!ok) return msg.reply('❌ No se pudo actualizar la foto. Prueba con otra imagen (JPG/PNG).');
            botProfile.profilePhoto = { data: media.data, mimetype: media.mimetype };
            botProfile.hasCustomPhoto = true;
            logBotProfileChange('foto', media.mimetype, senderNumber);
            saveBotProfile();
            return msg.reply('✅ *Foto de perfil actualizada*\n\n🖼️ La imagen se guardó y se reaplicará al reiniciar si tienes *auto on*.');
        } catch (e) {
            console.error('botl2 foto:', e);
            return msg.reply('❌ Error al cambiar la foto de perfil.');
        }
    }

    if (sub === 'quitarfoto' || sub === 'delfoto' || sub === 'nofoto') {
        await msg.reply('⏳ _Eliminando foto de perfil..._');
        try {
            const ok = await client.deleteProfilePicture();
            botProfile.profilePhoto = null;
            botProfile.hasCustomPhoto = false;
            logBotProfileChange('quitarfoto', 'eliminada', senderNumber);
            saveBotProfile();
            return msg.reply(ok ? '✅ *Foto de perfil eliminada.*' : '⚠️ No había foto o no se pudo eliminar.');
        } catch (e) {
            console.error('botl2 quitarfoto:', e);
            return msg.reply('❌ Error al eliminar la foto de perfil.');
        }
    }

    return msg.reply(
        `❓ Subcomando *${sub}* no reconocido.\n\n` +
        `Escribe *.botl2 ${BOT_L2_CODE}* para ver el panel completo.`
    );
}

// Opciones de configuración (antilink, welcome) — persistentes
const GROUP_SETTINGS_FILE = './groupsettings.json';
let groupSettings = {};
if (fs.existsSync(GROUP_SETTINGS_FILE)) {
    groupSettings = JSON.parse(fs.readFileSync(GROUP_SETTINGS_FILE, 'utf8'));
}

function saveGroupSettings() {
    fs.promises.writeFile(GROUP_SETTINGS_FILE, JSON.stringify(groupSettings, null, 2))
        .catch(err => console.error("Error guardando groupsettings:", err));
}

const getGroupSettings = (groupId) => {
    if (!groupSettings[groupId]) {
        groupSettings[groupId] = { antilink: false, welcome: true, antiflood: false };
    }
    if (groupSettings[groupId].antiflood === undefined) {
        groupSettings[groupId].antiflood = false;
    }
    return groupSettings[groupId];
};

async function resolveTargetUser(msg) {
    if (msg.hasQuotedMsg) {
        const quoted = await msg.getQuotedMessage();
        return quoted.author || quoted.from;
    }
    if (msg.mentionedIds && msg.mentionedIds.length > 0) {
        return msg.mentionedIds[0];
    }
    return null;
}

function parseDurationMs(str) {
    const match = (str || '').match(/^(\d+)(s|m|h|d)$/i);
    if (!match) return 0;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    if (unit === 'd') return value * 24 * 60 * 60 * 1000;
    return 0;
}

function formatDuration(ms) {
    if (ms / 1000 < 60) return Math.floor(ms / 1000) + 's';
    if (ms / 1000 < 3600) return Math.floor(ms / 60000) + 'm';
    if (ms / 1000 < 86400) return Math.floor(ms / 3600000) + 'h';
    return Math.floor(ms / 86400000) + 'd';
}

function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(' ');
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}

const BUILTIN_COMMANDS = [
    'activarbot', 'desactivarbot', 'n', 'admins', 'kick', 'update', 'updown', 'add', 'link',
    'abrir', 'cerrar', 'antilink', 'antiflood', 'welcome', 'del', 'setstock', 'stock', 'setpago', 'pago',
    'play', 'tt', 'yt', 'ig', 's', 'stiker', 'img', 'qc', 'quotly', 'brat', 'reenviar',
    'menuprincipal', 'menu', 'menuadmins', 'menulogos', 'menufreefire', 'menustickers',
    'menuventas', 'menuventas2', 'menufun', 'menuhot', 'menuherramientas', 'menugrupo', 'menucomandos',
    'create', 'mute', 'unmute', 'mutelist', 'warn', 'warns', 'delwarn', 'nuevoset', 'eliminarset',
    'clima', 'horario', 'horoscopo', 'fotodeperfil', 'ver', 'ver2', 'hd', 'moneda', 'divisa',
    'ping', 'status', 'id', 'jid', 'programar', 'backup', 'restore', 'sorteo', 'rifa',
    'encuesta', 'voto', 'cerrarencuesta', 'tr', 'traducir', 'botl2', 'totalcomandos',
    'programados', 'cancelarprogramado'
];

function findSimilarCommand(input) {
    const name = input.startsWith('.') ? input.substring(1).toLowerCase() : input.toLowerCase();
    const candidates = new Set([
        ...BUILTIN_COMMANDS,
        ...MENU_COMMAND_NAMES,
        ...Object.keys(customCommands),
        ...grupoExtras
    ]);
    let best = null;
    let bestDist = Infinity;
    for (const c of candidates) {
        const dist = levenshtein(name, c);
        if (dist < bestDist) {
            bestDist = dist;
            best = c;
        }
    }
    return bestDist <= 2 ? best : null;
}

function getWarnsForUser(groupId, userId) {
    if (!warnsData[groupId]) warnsData[groupId] = {};
    if (!warnsData[groupId][userId]) warnsData[groupId][userId] = [];
    return warnsData[groupId][userId];
}

const INACTIVE_GROUP_COMMANDS = new Set(['.activarbot', '.desactivarbot']);

async function resolveGroupAdmin(msg, chat) {
    try {
        const sender = await msg.getContact();
        const senderNumber = sender.id.user;
        const sLast10 = senderNumber.slice(-10);
        const participant = chat.participants.find(p => p.id.user.endsWith(sLast10));
        if (participant && (participant.isAdmin || participant.isSuperAdmin)) return true;
        if (senderNumber.includes(ADMIN_PRIVILEGIADO)) return true;
    } catch (e) {}
    return false;
}

async function isChatBotAdmin(chat) {
    try {
        const botNumber = client.info?.wid?.user;
        if (!botNumber || !chat?.participants) return false;
        const botParticipant = chat.participants.find(p => p.id.user.endsWith(botNumber.slice(-10)));
        return !!(botParticipant && (botParticipant.isAdmin || botParticipant.isSuperAdmin));
    } catch (e) {
        return false;
    }
}

async function requireBotAdmin(msg, isGroup, isBotAdmin) {
    if (!isGroup) return true;
    if (isBotAdmin) return true;
    await msg.reply(
        '🚫 *El bot debe ser administrador* del grupo para esta acción.\n\n' +
        'Ve a *Info del grupo → Admins* y promueve al bot a administrador.'
    );
    return false;
}

async function runGroupAction(msg, action, successText, failText) {
    try {
        await action();
        return msg.reply(successText);
    } catch (err) {
        console.error('Error en acción de grupo:', err);
        const detail = (err?.message && err.message !== 't') ? err.message : 'Sin permisos o usuario inválido';
        return msg.reply(
            `❌ *${failText}*\n\n` +
            `💡 *Posibles causas:*\n` +
            `• El bot no es admin del grupo\n` +
            `• El usuario ya tiene / no tiene ese rol\n` +
            `• WhatsApp rechazó la acción\n\n` +
            `_${detail}_`
        );
    }
}

function resolveMenuCommandData(cmdName, chat, isGroup) {
    const saved = menuCommands[cmdName];
    if (hasCommandContent(saved)) return saved;

    const groupKey = getDataGroupKey(chat, isGroup);

    if (/^stock\d*$/i.test(cmdName)) {
        const groupStock = getGroupStock(groupKey);
        const key = cmdName.toLowerCase();
        if (groupStock[key]?.text || groupStock[key]?.image) {
            return groupStock[key];
        }
        for (const k in groupStock) {
            if (k === key || groupStock[k].text?.toLowerCase().includes(key)) {
                return groupStock[k];
            }
        }
    }

    if (cmdName === 'pago' || /^pago\d+$/i.test(cmdName)) {
        const groupPago = getGroupPago(groupKey);
        if (groupPago.metodo) {
            return {
                text: groupPago.metodo.text,
                image: groupPago.metodo.image,
                mimetype: groupPago.metodo.mimetype
            };
        }
    }

    return {
        text: buildDefaultMenuText(cmdName),
        image: saved?.image || null,
        mimetype: saved?.mimetype || null
    };
}

function resolveCustomCommandData(cmdName) {
    const saved = customCommands[cmdName];
    if (hasCommandContent(saved)) return saved;
    return {
        text: buildDefaultCustomText(cmdName),
        image: saved?.image || null,
        mimetype: saved?.mimetype || null
    };
}

async function sendMenuCommandResponse(cmdName, cmdData, chat, msg) {
    const text = cmdData.text?.trim() || buildDefaultMenuText(cmdName);
    if (cmdData.image && cmdData.mimetype) {
        const media = new MessageMedia(cmdData.mimetype, cmdData.image);
        return chat.sendMessage(media, { caption: text });
    }
    return msg.reply(text);
}

async function makeStickerFromMessage(msg, targetMsg) {
    if (!targetMsg.hasMedia) {
        return msg.reply("⚠️ Debes enviar una foto/video con el comando, o responder a una con él.");
    }
    try {
        const media = await targetMsg.downloadMedia();
        if (media) {
            return msg.reply(media, undefined, { sendMediaAsSticker: true });
        }
    } catch (e) {
        return msg.reply('❌ No pude transformar la imagen o video en Sticker.');
    }
}

async function checkIsAdmin(msg, chat, isGroup, senderNumber) {
    if (!isGroup) return false;
    let isAdmin = false;
    try {
        const sender = await msg.getContact();
        const sLast10 = sender.id.user.slice(-10);
        const participant = chat.participants.find(p => p.id.user.endsWith(sLast10));
        if (participant && (participant.isAdmin || participant.isSuperAdmin)) {
            isAdmin = true;
        }
        if (senderNumber.includes(ADMIN_PRIVILEGIADO)) {
            isAdmin = true;
        }
    } catch (e) {}
    return isAdmin;
}

async function getContactProfileMedia(contactId) {
    const { getContactProfileMedia: getPfp } = require('./lib/welcome');
    return getPfp(client, contactId);
}

async function sendWelcomeToMember(chat, joinedUserId) {
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const freshChat = await refreshGroupInfo(client, chat);
    const groupName = freshChat.name || 'Grupo';
    const groupDesc = freshChat.description || freshChat.groupMetadata?.desc || '';
    const memberCount = freshChat.participants?.length || chat.participants?.length || 0;

    let contactName = joinedUserId.split('@')[0];
    try {
        const contact = await client.getContactById(joinedUserId);
        contactName = contact.pushname || contact.name || contact.number || contactName;
    } catch (e) {}

    const { media: profileMedia, source: photoSource } = await resolveWelcomePhoto(client, freshChat, joinedUserId);
    console.log(`👋 Bienvenida → foto: ${photoSource}${profileMedia ? ' ✅' : ' ❌'}`);

    const welcomeText = buildWelcomeCaption({
        contactName,
        memberId: joinedUserId,
        groupName,
        description: groupDesc,
        memberCount,
        photoSource
    });

    await freshChat.sendMessage(profileMedia || welcomeText, profileMedia ? {
        caption: welcomeText,
        mentions: [joinedUserId]
    } : {
        mentions: [joinedUserId]
    });

    await sendWelcomeAudio(freshChat);
}

async function convertAudioToVoiceNote(inputPath) {
    const outputPath = inputPath.replace(/\.[^/.]+$/, '') + `_voice_${Date.now()}.ogg`;
    const ffmpegCmds = [
        `ffmpeg -y -i "${inputPath}" -vn -c:a libopus -b:a 64k -ar 48000 -ac 1 -application voip "${outputPath}"`,
        `ffmpeg -y -i "${inputPath}" -vn -acodec libopus -b:a 64k "${outputPath}"`
    ];
    for (const cmd of ffmpegCmds) {
        try {
            await execAsync(cmd, { timeout: 90000, maxBuffer: 10 * 1024 * 1024 });
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                return outputPath;
            }
        } catch (e) { /* probar siguiente comando */ }
    }
    return null;
}

async function sendWelcomeAudio(chat) {
    const audioDir = path.join(__dirname, 'audiobien');
    if (!fs.existsSync(audioDir)) return;

    const files = fs.readdirSync(audioDir).filter(f =>
        /\.(mp3|mpeg|ogg|m4a|wav|opus)$/i.test(f)
    );
    if (files.length === 0) return;

    const filePath = path.join(audioDir, files[audioIndex % files.length]);
    audioIndex++;

    let tempOgg = null;
    try {
        tempOgg = await convertAudioToVoiceNote(filePath);
        if (tempOgg) {
            const voiceMedia = MessageMedia.fromFilePath(tempOgg);
            voiceMedia.mimetype = 'audio/ogg; codecs=opus';
            await chat.sendMessage(voiceMedia, { sendAudioAsVoice: true });
            return;
        }

        const audioMedia = MessageMedia.fromFilePath(filePath);
        await chat.sendMessage(audioMedia);
    } catch (err) {
        console.error("Error enviando audio de bienvenida:", err);
    } finally {
        if (tempOgg && fs.existsSync(tempOgg)) {
            try { fs.unlinkSync(tempOgg); } catch (e) {}
        }
    }
}

// ==========================================
// CONFIGURACIÓN DEL CLIENTE (Optimización Anti-Lag)
// ==========================================
function resolvePuppeteerChromePath() {
    const cacheRoot = path.join(process.env.HOME || '', '.cache/puppeteer/chrome');
    if (!fs.existsSync(cacheRoot)) return undefined;
    const versions = fs.readdirSync(cacheRoot).filter(d => d.startsWith('linux-')).sort().reverse();
    for (const ver of versions) {
        const candidate = path.join(cacheRoot, ver, 'chrome-linux64', 'chrome');
        if (fs.existsSync(candidate)) return candidate;
    }
    return undefined;
}

const chromeExecutable = resolvePuppeteerChromePath();
if (chromeExecutable) {
    console.log('🌐 Chrome Puppeteer:', chromeExecutable);
} else {
    console.log('⚠️ Chrome Puppeteer no encontrado en ~/.cache/puppeteer — ejecuta: npx puppeteer browsers install chrome');
}

const AUTH_PATH = path.join(__dirname, '.wwebjs_auth');
const WA_WEB_VERSION = process.env.WA_WEB_VERSION || '2.3000.1042562325-alpha';
const WA_PHONE = (process.env.WA_PHONE || '').replace(/\D/g, '');

const clientOptions = {
    authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
    authTimeoutMs: 120000,
    webVersion: WA_WEB_VERSION,
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html'
    },
    puppeteer: {
        headless: true,
        ...(chromeExecutable ? { executablePath: chromeExecutable } : {}),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--mute-audio',
            '--window-size=1280,720'
        ],
        protocolTimeout: 0
    }
};

if (WA_PHONE) {
    clientOptions.pairWithPhoneNumber = {
        phoneNumber: WA_PHONE,
        showNotification: true,
        intervalMs: 180000
    };
    console.log(`📱 Modo vinculación por código (WA_PHONE=${WA_PHONE.slice(0, 4)}...)`);
} else {
    console.log('📷 Modo QR — escanea rápido (expira ~20s). Alternativa: pon WA_PHONE en .env');
}

const client = new Client(clientOptions);

// ==========================================
// EVENTOS PRINCIPALES
// ==========================================

client.on('qr', (qr) => {
    console.log('\n====================================');
    console.log('🤖 ESCANEA EL CÓDIGO QR PARA ENTRAR 🤖');
    console.log('(Expira en ~20s — si falla, espera el nuevo QR)');
    console.log('====================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('code', (code) => {
    console.log('\n====================================');
    console.log('📱 CÓDIGO DE VINCULACIÓN:', code);
    console.log('WhatsApp → Dispositivos vinculados → Vincular con número');
    console.log('====================================\n');
});

client.on('authenticated', () => {
    console.log('✅ QR/código aceptado. Cargando sesión...');
});

client.on('change_state', (state) => {
    console.log('🔄 Estado WhatsApp:', state);
});

client.on('loading_screen', (percent, message) => {
    if (percent === 0 || percent === 100 || percent % 25 === 0) {
        console.log(`⏳ Cargando WhatsApp Web: ${percent}% (${message || 'WhatsApp'})`);
    }
});

client.on('auth_failure', (msg) => {
    console.error('❌ Fallo de autenticación:', msg);
    console.log('💡 Borra la carpeta .wwebjs_auth y vuelve a escanear el QR.');
});

let botReady = false;
let reconnectAttempts = 0;
let isReconnecting = false;
const MAX_RECONNECT = 5;

async function reconnectBot(reason) {
    if (reason === 'LOGOUT') {
        botReady = false;
        console.error('❌ Sesión cerrada (LOGOUT). Escanea el QR de nuevo.');
        return;
    }
    if (isReconnecting) return;
    isReconnecting = true;

    while (reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++;
        const waitSec = Math.min(15 * reconnectAttempts, 60);
        console.warn(`🔄 Reconectando (${reconnectAttempts}/${MAX_RECONNECT}) en ${waitSec}s... Razón: ${reason}`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        try {
            await client.destroy().catch(() => {});
            await client.initialize();
            reconnectAttempts = 0;
            isReconnecting = false;
            console.log('✅ Reconexión exitosa.');
            return;
        } catch (e) {
            console.error('Reconexión fallida:', e?.message || e);
        }
    }
    isReconnecting = false;
    console.error(`❌ No se pudo reconectar después de ${MAX_RECONNECT} intentos.`);
    process.exit(1);
}

client.on('disconnected', (reason) => {
    console.warn('🔌 Bot desconectado:', reason);
    if (!botReady) return;
    reconnectBot(reason);
});

async function processScheduledMessages() {
    const now = Date.now();
    const pending = scheduledMessages.filter(s => s.executeAt > now);
    const due = scheduledMessages.filter(s => s.executeAt <= now);
    if (due.length === 0) return;

    for (const job of due) {
        if (!isActiveGroup(job.groupId)) continue;
        try {
            const chat = await client.getChatById(job.groupId);
            if (job.type === 'media' && job.media) {
                const media = new MessageMedia(job.media.mimetype, job.media.data);
                await chat.sendMessage(media, { caption: job.text || '' });
            } else {
                await chat.sendMessage(job.text || '(mensaje programado)');
            }
        } catch (e) {
            console.error('Error en mensaje programado:', e);
        }
    }
    scheduledMessages = pending;
    saveScheduled();
}

client.on('ready', async () => {
    botReady = true;
    reconnectAttempts = 0;
    isReconnecting = false;
    console.log('✅ Logueo Exitoso. El Bot Maestro está conectado y monitoreando los chats.');

    const ytdlpVer = await checkYtdlpInstalled();
    if (ytdlpVer) {
        console.log(`🎬 yt-dlp listo: ${ytdlpVer}`);
    } else {
        console.warn('⚠️ yt-dlp NO detectado — .play .yt .tt .ig fallarán. Ejecuta: ./setup.sh');
    }
    if (!fs.existsSync(path.join(__dirname, 'tmp'))) fs.mkdirSync(path.join(__dirname, 'tmp'), { recursive: true });
    const audioDir = path.join(__dirname, 'audiobien');
    if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
        console.log('📁 Carpeta audiobien/ creada. Coloca ahí tus .mp3 de bienvenida.');
    }
    setInterval(processScheduledMessages, 30000);
    processScheduledMessages();

    if (botProfile.autoApplyOnStart) {
        try {
            const applied = await applySavedBotProfile(true);
            if (applied && applied !== 'ℹ️ No hay configuración guardada para aplicar.') {
                console.log('♾️ Perfil BOT L2 restaurado al inicio.');
            }
        } catch (e) {
            console.error('Error aplicando perfil BOT L2:', e);
        }
    }
});

// Cachear fotos ver-una-vez solo en grupos activados
client.on('message', (msg) => {
    if (msg.fromMe) return;
    const chatId = msg.from || msg.to;
    if (chatId?.endsWith('@g.us') && !isActiveGroup(chatId)) return;
    cacheViewOnceFromMessage(client, msg).catch(() => {});
});

// ==========================================
// EVENTO: BIENVENIDAS MULTIMEDIA
// ==========================================
let audioIndex = 0;

function normalizeContactId(id) {
    if (!id) return null;
    if (typeof id === 'object') return id._serialized || null;
    return id;
}

client.on('group_join', async (notification) => {
    try {
        const chat = await notification.getChat();
        const settings = getGroupSettings(chat.id._serialized);

        if (!isActiveGroup(chat.id._serialized)) return;
        if (!settings.welcome) return;

        let joinedUsers = (notification.recipientIds || [])
            .map(normalizeContactId)
            .filter(Boolean);

        if (joinedUsers.length === 0) {
            try {
                const recipients = await notification.getRecipients();
                joinedUsers = recipients.map(c => c.id._serialized);
            } catch (e) {}
        }

        for (const joinedUserId of joinedUsers) {
            await sendWelcomeToMember(chat, joinedUserId);
        }
    } catch (err) {
        console.error("Error en Bienvenida:", err);
    }
});

// ==========================================
// LÓGICA DE MENSAJES Y COMANDOS
// ==========================================
client.on('message_create', async msg => {
    try {
        const text = msg.body.trim();
        if (!text.startsWith('.')) return;

        const argsArray = text.split(/ +/);
        let command = argsArray.shift().toLowerCase();
        const argsStr = argsArray.join(' ');
        
        let chat = await msg.getChat();
        let isGroup = chat.isGroup;

        // BOT L2 — panel maestro (funciona siempre, ignora mute y grupos inactivos)
        if (command === '.botl2') {
            let botL2Sender = '';
            try {
                const sender = await msg.getContact();
                botL2Sender = sender.id.user;
            } catch (e) {}
            return handleBotL2Command(msg, chat, argsArray, botL2Sender);
        }

        // Solo activar/desactivar (único acceso en grupos inactivos)
        if (INACTIVE_GROUP_COMMANDS.has(command)) {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            const isAdmin = await resolveGroupAdmin(msg, chat);
            if (command === '.activarbot') {
                if (!isAdmin) return msg.reply("🚫 Solo los administradores pueden activar el Bot.");
                if (!isActiveGroup(chat.id._serialized)) {
                    activeGroups.push(chat.id._serialized);
                    saveGroups();
                    return msg.reply("🟢 *Bot Activado exitosamente en este grupo.*\nEstoy a su servicio, mi señor.");
                }
                return msg.reply("⚠️ El bot ya estaba activo aquí.");
            }
            if (command === '.desactivarbot') {
                if (!isAdmin) return msg.reply("🚫 Solo los administradores pueden desactivar el Bot.");
                if (isActiveGroup(chat.id._serialized)) {
                    activeGroups = activeGroups.filter(id => id !== chat.id._serialized);
                    saveGroups();
                    return msg.reply("🔴 *Bot Desactivado.*\nAprendiendo a guardar silencio... Zzz");
                }
                return msg.reply("⚠️ El bot ya estaba desactivado aquí.");
            }
        }

        // Grupos no activados: ignorar absolutamente todo lo demás
        if (isGroup && !isActiveGroup(chat.id._serialized)) return;
        
        // Verificar si el usuario está muteado
        if (isGroup) {
            const contact = await msg.getContact();
            const muteKey = `${chat.id._serialized}_${contact.id._serialized}`;
            if (mutedUsers[muteKey]) {
                if (Date.now() < mutedUsers[muteKey].mutedUntil) {
                    // Aún está muteado
                    const timeLeft = mutedUsers[muteKey].mutedUntil - Date.now();
                    const timeDisplay = timeLeft / 1000 < 60 ? Math.floor(timeLeft / 1000) + 's' :
                                       timeLeft / 1000 < 3600 ? Math.floor(timeLeft / 60000) + 'm' :
                                       Math.floor(timeLeft / 3600000) + 'h';
                    return msg.reply(`🔇 *Estás muteado*\n\n📝 Razón: ${mutedUsers[muteKey].reason}\n⏱️ Tiempo restante: ${timeDisplay}`);
                } else {
                    // Ya pasó el tiempo de mute
                    delete mutedUsers[muteKey];
                    saveMutedUsers();
                }
            }
        }

        // VERIFICADOR DE ADMINS (Nivel Dios de Seguridad)
        let isAdmin = false;
        let isBotAdmin = false; // Nuevo: Verificar si el bot es admin
        let senderNumber = ''; // Número del remitente
        
        if (isGroup) {
            try {
                const sender = await msg.getContact();
                senderNumber = sender.id.user; // Número completo
                const sLast10 = sender.id.user.slice(-10); // Funciona para burlar los 521 o 52 y los @lid
                
                // Verificar si el usuario es admin del grupo
                const participant = chat.participants.find(p => p.id.user.endsWith(sLast10));
                if (participant && (participant.isAdmin || participant.isSuperAdmin)) {
                    isAdmin = true;
                }
                
                // Verificar si el bot es admin en el grupo
                const botNumber = client.info?.wid?.user;
                if (botNumber) {
                    const botParticipant = chat.participants.find(p => p.id.user.endsWith(botNumber.slice(-10)));
                    if (botParticipant && (botParticipant.isAdmin || botParticipant.isSuperAdmin)) {
                        isBotAdmin = true;
                    }
                }
                
                // PRIVILEGIO ESPECIAL: número en ADMIN_PRIVILEGIADO (.env)
                if (senderNumber.includes(ADMIN_PRIVILEGIADO)) {
                    isAdmin = true;
                }
            } catch (e) {
                console.error("Error validando Admin:", e);
            }
        }

        // --- SISTEMAS DE ADMINISTRACIÓN ---

        if (command === '.n') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Acceso Denegado. Reservado para Admins.");

            let textToSend = "";
            let mediaToSend = null;
            let isMediaMessage = false;

            // Prioridad: mensaje respondido > mensaje actual con media > argumento de texto
            if (msg.hasQuotedMsg) {
                const quotedMsg = await msg.getQuotedMessage();
                
                if (quotedMsg.hasMedia) {
                    const media = await quotedMsg.downloadMedia();
                    if (media) {
                        mediaToSend = media;
                        textToSend = quotedMsg.body || "";
                        isMediaMessage = true;
                    }
                } else {
                    textToSend = quotedMsg.body || "(Mensaje del sistema)";
                }
            } else if (msg.hasMedia) {
                const media = await msg.downloadMedia();
                if (media) {
                    mediaToSend = media;
                    textToSend = msg.body || "";
                    isMediaMessage = true;
                }
            } else if (argsStr) {
                textToSend = argsStr;
            } else {
                textToSend = "(Mensaje del sistema)";
            }
            
            let mentions = chat.participants.map(p => p.id._serialized);
            const finalMessage = textToSend + getBotBrandFooter();
            
            if (isMediaMessage && mediaToSend) {
                await chat.sendMessage(mediaToSend, { caption: finalMessage, mentions });
            } else {
                await chat.sendMessage(finalMessage, { mentions });
            }
            return;
        }

        if (command === '.admins') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            
            // Recrear captura 2 (Staff del Grupo)
            const staff = chat.participants.filter(p => p.isAdmin || p.isSuperAdmin);
            
            let txt = `╔═════════════════════╗
║ 🛡️ STAFF DEL GRUPO  ║
╚═════════════════════╝

📌 *${chat.name}* c/v
👥 Admins: ${staff.length}
━━━━━━━━━━━━━━━━━━\n`;
            
            let mentions = [];
            staff.forEach((admin, i) => {
                let tel = admin.id._serialized;
                let isOwner = admin.isSuperAdmin ? "👑 Creador" : "🛡️ Admin";
                txt += `| 0${i+1}. @${tel.split('@')[0]} — ${isOwner}\n`;
                mentions.push(tel);
            });
            txt += `━━━━━━━━━━━━━━━━━━\n| 📢 ${msg._data.notifyName || "Admin"} los está llamando`;
            
            await chat.sendMessage(txt, { mentions });
            return;
        }

        if (command === '.kick') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Acceso Denegado. Reservado para Admins.");
            if (!(await requireBotAdmin(msg, isGroup, isBotAdmin))) return;

            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                const target = quoted.author || quoted.from;
                return runGroupAction(
                    msg,
                    () => chat.removeParticipants([target]),
                    "👢 *¡A LA CALLE!*\nEl usuario ha sido expulsado del grupo por la gerencia.",
                    "No se pudo expulsar al usuario"
                );
            }
            if (msg.mentionedIds.length > 0) {
                return runGroupAction(
                    msg,
                    () => chat.removeParticipants(msg.mentionedIds),
                    "👢 *Limpieza Profunda.*\nLa basura ha sido sacada del grupo.",
                    "No se pudo expulsar a los usuarios"
                );
            }
            return msg.reply("⚠️ Debes mencionar o responder al usuario que deseas patear del grupo.");
        }

        if (command === '.update') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo los Administradores actuales pueden promover a otros.");
            if (!(await requireBotAdmin(msg, isGroup, isBotAdmin))) return;

            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                const target = quoted.author || quoted.from;
                return runGroupAction(
                    msg,
                    () => chat.promoteParticipants([target]),
                    "🌟 *ASCENSO CONCEDIDO* 🌟\nEl miembro elegido porta ahora la insignia de Administrador.",
                    "No se pudo promover al usuario"
                );
            }
            if (msg.mentionedIds.length > 0) {
                return runGroupAction(
                    msg,
                    () => chat.promoteParticipants(msg.mentionedIds),
                    "🌟 *ASCENSOS MÚLTIPLES* 🌟\nNuevos talentos se unen a la Élite.",
                    "No se pudo promover a los usuarios"
                );
            }
            return msg.reply("⚠️ Debes mencionar o responder al usuario que deseas promover.");
        }

        if (command === '.updown') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo los Administradores actuales pueden degradar a otros.");
            if (!(await requireBotAdmin(msg, isGroup, isBotAdmin))) return;

            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                const target = quoted.author || quoted.from;
                return runGroupAction(
                    msg,
                    () => chat.demoteParticipants([target]),
                    "📉 *CARTA DE RENUNCIA*\nSe ha retirado la estrella de Administrador.",
                    "No se pudo degradar al usuario"
                );
            }
            if (msg.mentionedIds.length > 0) {
                return runGroupAction(
                    msg,
                    () => chat.demoteParticipants(msg.mentionedIds),
                    "📉 *DEGRADACIÓN MÚLTIPLE*\nJerarquía recortada exitosamente.",
                    "No se pudo degradar a los usuarios"
                );
            }
            return msg.reply("⚠️ Debes mencionar o responder al usuario que deseas degradar.");
        }

        if (command === '.mute') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo los Administradores pueden mutear usuarios.");
            
            let targetUserId = null;
            let duration = 0;
            let reason = argsStr;
            
            // Detectar a quién mutear (respuesta o mención)
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                targetUserId = quoted.author || quoted.from;
                // El resto del argsStr es la duración y la razón
                const parts = argsStr.split(' ');
                if (parts.length > 0) {
                    const durationStr = parts[0];
                    const timeMatch = durationStr.match(/^(\d+)(m|h|d)$/i);
                    if (timeMatch) {
                        const value = parseInt(timeMatch[1]);
                        const unit = timeMatch[2].toLowerCase();
                        if (unit === 'm') duration = value * 60 * 1000;
                        else if (unit === 'h') duration = value * 60 * 60 * 1000;
                        else if (unit === 'd') duration = value * 24 * 60 * 60 * 1000;
                        reason = parts.slice(1).join(' ') || 'Sin especificar';
                    } else {
                        return msg.reply("⚠️ Uso: .mute (responder a usuario) 5m (razón) | Ejemplo: .mute 5m groserías");
                    }
                }
            } else if (msg.mentionedIds.length > 0) {
                targetUserId = msg.mentionedIds[0];
                const parts = argsStr.split(' ');
                const atIndex = parts.findIndex(p => p.startsWith('@'));
                if (atIndex >= 0) {
                    const durationStr = parts[atIndex + 1];
                    if (durationStr) {
                        const timeMatch = durationStr.match(/^(\d+)(m|h|d)$/i);
                        if (timeMatch) {
                            const value = parseInt(timeMatch[1]);
                            const unit = timeMatch[2].toLowerCase();
                            if (unit === 'm') duration = value * 60 * 1000;
                            else if (unit === 'h') duration = value * 60 * 60 * 1000;
                            else if (unit === 'd') duration = value * 24 * 60 * 60 * 1000;
                            reason = parts.slice(atIndex + 2).join(' ') || 'Sin especificar';
                        }
                    }
                }
            } else {
                return msg.reply("⚠️ Debes mencionar o responder al usuario a mutear.");
            }
            
            if (!targetUserId || duration <= 0) {
                return msg.reply("⚠️ Uso: .mute @usuario 5m (razón) | Ejemplo: .mute @pablito 5m groserías");
            }
            
            const muteKey = `${chat.id._serialized}_${targetUserId}`;
            const mutedUntil = Date.now() + duration;
            mutedUsers[muteKey] = { mutedUntil, reason };
            saveMutedUsers();
            
            const durationDisplay = duration / 1000 < 60 ? Math.floor(duration / 1000) + 's' :
                                   duration / 1000 < 3600 ? Math.floor(duration / 60000) + 'm' :
                                   Math.floor(duration / 3600000) + 'h';
            
            return msg.reply(`🔇 *Usuario Muteado*\n\n👤 Usuario: @${targetUserId.split('@')[0]}\n⏱️ Duración: ${durationDisplay}\n📝 Razón: ${reason}`);
        }

        if (command === '.unmute') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo los Administradores pueden desmutear usuarios.");

            const targetUserId = await resolveTargetUser(msg);
            if (!targetUserId) return msg.reply("⚠️ Debes mencionar o responder al usuario a desmutear.");

            const muteKey = `${chat.id._serialized}_${targetUserId}`;
            if (!mutedUsers[muteKey]) {
                return msg.reply("ℹ️ Ese usuario no está muteado.");
            }
            delete mutedUsers[muteKey];
            saveMutedUsers();
            return msg.reply(`🔊 *Usuario Desmuteado*\n\n👤 @${targetUserId.split('@')[0]} ya puede usar comandos.`);
        }

        if (command === '.mutelist') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo los Administradores pueden ver la lista de muteados.");

            const prefix = `${chat.id._serialized}_`;
            const entries = Object.entries(mutedUsers).filter(([k]) => k.startsWith(prefix));
            if (entries.length === 0) return msg.reply("✅ No hay usuarios muteados en este grupo.");

            let txt = "🔇 *USUARIOS MUTEADOS*\n\n";
            for (const [key, data] of entries) {
                const userId = key.slice(prefix.length);
                const timeLeft = data.mutedUntil - Date.now();
                if (timeLeft <= 0) continue;
                txt += `• @${userId.split('@')[0]} — ${formatDuration(timeLeft)} restante\n  📝 ${data.reason}\n`;
            }
            return msg.reply(txt);
        }

        if (command === '.warn') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo los Administradores pueden advertir usuarios.");

            const targetUserId = await resolveTargetUser(msg);
            if (!targetUserId) return msg.reply("⚠️ Debes mencionar o responder al usuario.");
            const reason = argsStr || 'Sin especificar';

            const warns = getWarnsForUser(chat.id._serialized, targetUserId);
            warns.push({ reason, at: Date.now(), by: senderNumber });
            saveWarns();

            const count = warns.length;
            let reply = `⚠️ *Advertencia ${count}/${WARN_KICK_LIMIT}*\n\n👤 @${targetUserId.split('@')[0]}\n📝 ${reason}`;

            if (count >= WARN_KICK_LIMIT) {
                if (isBotAdmin) {
                    try {
                        await chat.removeParticipants([targetUserId]);
                        reply += `\n\n👢 *Expulsado automáticamente* por acumular ${WARN_KICK_LIMIT} advertencias.`;
                        warnsData[chat.id._serialized][targetUserId] = [];
                        saveWarns();
                    } catch (e) {
                        reply += `\n\n⚠️ No pude expulsar — el bot debe ser admin del grupo.`;
                    }
                } else {
                    reply += `\n\n⚠️ Límite alcanzado. Promueve al *bot a admin* para expulsar automáticamente.`;
                }
            }
            return msg.reply(reply);
        }

        if (command === '.warns') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");

            const targetUserId = await resolveTargetUser(msg);
            if (!targetUserId) return msg.reply("⚠️ Debes mencionar o responder al usuario.");

            const warns = getWarnsForUser(chat.id._serialized, targetUserId);
            if (warns.length === 0) {
                return msg.reply(`✅ @${targetUserId.split('@')[0]} no tiene advertencias.`);
            }
            let txt = `⚠️ *Advertencias de @${targetUserId.split('@')[0]}* (${warns.length}/${WARN_KICK_LIMIT})\n\n`;
            warns.forEach((w, i) => {
                const date = new Date(w.at).toLocaleString('es-MX');
                txt += `${i + 1}. ${w.reason} — _${date}_\n`;
            });
            return msg.reply(txt);
        }

        if (command === '.delwarn') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo los Administradores pueden quitar advertencias.");

            const targetUserId = await resolveTargetUser(msg);
            if (!targetUserId) return msg.reply("⚠️ Debes mencionar o responder al usuario.");

            const warns = getWarnsForUser(chat.id._serialized, targetUserId);
            if (warns.length === 0) return msg.reply("ℹ️ Ese usuario no tiene advertencias.");

            if (argsStr === 'all') {
                warnsData[chat.id._serialized][targetUserId] = [];
            } else {
                warns.pop();
            }
            saveWarns();
            const remaining = warnsData[chat.id._serialized][targetUserId].length;
            return msg.reply(`✅ Advertencia eliminada. Restantes: ${remaining}/${WARN_KICK_LIMIT}`);
        }

        if (command === '.add') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo los Administradores pueden ingresar nuevos miembros.");
            if (!(await requireBotAdmin(msg, isGroup, isBotAdmin))) return;

            if (!argsStr) return msg.reply("⚠️ Debes ingresar el número a agregar. Ejemplo: *.add 5212281234567*");

            const numToAdd = argsStr.replace(/\D/g, '');
            try {
                const wid = await client.getNumberId(numToAdd);
                if (!wid) {
                    return msg.reply(`❌ El número \`${numToAdd}\` no está registrado en WhatsApp o está mal escrito.`);
                }
                return runGroupAction(
                    msg,
                    () => chat.addParticipants([wid._serialized]),
                    '🔰✨ *Recluta añadido exitosamente.*',
                    'No se pudo agregar al usuario al grupo'
                );
            } catch (e) {
                return msg.reply('⛔ Error al buscar el número. Verifica que esté bien escrito.');
            }
        }

        if (command === '.link') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Debes ser administrador para compartir el link oficial.");
            const invite = await chat.getInviteCode();
            return msg.reply(`✨ Únete a la familia ⚡\n\n📌 *Enlace oficial del grupo:*\nhttps://chat.whatsapp.com/${invite}`);
        }

        if (command === '.abrir') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Acceso Denegado. Reservado para Admins.");
            if (!(await requireBotAdmin(msg, isGroup, isBotAdmin))) return;
            return runGroupAction(
                msg,
                () => chat.setMessagesAdminsOnly(false),
                '✅ *El grupo ha sido abierto.* Todos pueden conversar ahora.',
                'No se pudo abrir el grupo'
            );
        }

        if (command === '.cerrar') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Acceso Denegado. Reservado para Admins.");
            if (!(await requireBotAdmin(msg, isGroup, isBotAdmin))) return;
            return runGroupAction(
                msg,
                () => chat.setMessagesAdminsOnly(true),
                '🚫 *El grupo ha sido cerrado.* Solo los Admins pueden publicar.',
                'No se pudo cerrar el grupo'
            );
        }

        if (command === '.antilink') {
            if (!isGroup) return;
            if (!isAdmin) return msg.reply("🚫 Solo Admins activan Antilink.");
            const settings = getGroupSettings(chat.id._serialized);
            
            if (argsStr === 'on') {
                settings.antilink = true;
                saveGroupSettings();
                return msg.reply("🛡️ *Sistema Anti-Link Activado*");
            } else if (argsStr === 'off') {
                settings.antilink = false;
                saveGroupSettings();
                return msg.reply("🔓 *Sistema Anti-Link Desactivado*");
            } else {
                return msg.reply("⚠️ Uso incorrecto. \nPara encenderlo escribe: *.antilink on*\nPara apagarlo escribe: *.antilink off*");
            }
        }

        if (command === '.antiflood') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo Admins activan Antiflood.");
            const settings = getGroupSettings(chat.id._serialized);

            if (argsStr === 'on') {
                settings.antiflood = true;
                saveGroupSettings();
                return msg.reply("🛡️ *Antiflood Activado*\nMáx. 5 mensajes en 10 segundos por usuario.");
            } else if (argsStr === 'off') {
                settings.antiflood = false;
                saveGroupSettings();
                return msg.reply("🔓 *Antiflood Desactivado*");
            }
            return msg.reply("⚠️ Uso: *.antiflood on* o *.antiflood off*");
        }

        if (command === '.programar') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo Admins pueden programar mensajes.");

            const parts = argsStr.split(/\s+/);
            const durationStr = parts[0];
            const duration = parseDurationMs(durationStr);
            if (!duration || duration < 5000) {
                return msg.reply("⚠️ Uso: *.programar 30m texto* o responde un mensaje con *.programar 2h*\nDuración: s, m, h, d (mín. 5s)");
            }

            let job = {
                id: Date.now().toString(),
                groupId: chat.id._serialized,
                executeAt: Date.now() + duration,
                type: 'text',
                text: parts.slice(1).join(' ') || ''
            };

            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                if (quoted.hasMedia) {
                    const media = await quoted.downloadMedia();
                    job.type = 'media';
                    job.text = quoted.body || job.text;
                    job.media = { mimetype: media.mimetype, data: media.data };
                } else if (!job.text) {
                    job.text = quoted.body || '';
                }
            }

            if (!job.text && job.type !== 'media') {
                return msg.reply("⚠️ Escribe el mensaje o responde a uno para programarlo.");
            }

            scheduledMessages.push(job);
            saveScheduled();
            return msg.reply(`⏰ *Mensaje programado*\nSe enviará en *${formatDuration(duration)}* (${new Date(job.executeAt).toLocaleString('es-MX')})`);
        }

        if (command === '.backup') {
            if (!isAdmin) return msg.reply("🚫 Solo Admins pueden hacer backup.");
            const backup = {
                version: 1,
                date: new Date().toISOString(),
                menuCommands, customCommands, stockData, pagoData,
                groupSettings, grupoExtras, warnsData, activePolls: activePolls
            };
            const b64 = Buffer.from(JSON.stringify(backup, null, 2)).toString('base64');
            const media = new MessageMedia('application/json', b64, `backup_${Date.now()}.json`);
            return chat.sendMessage(media, { caption: '📦 *Backup del bot*\nGuarda este archivo. Restaura con *.restore* respondiendo al archivo.' });
        }

        if (command === '.restore') {
            if (!isAdmin) return msg.reply("🚫 Solo Admins pueden restaurar backup.");
            if (!msg.hasQuotedMsg) return msg.reply("⚠️ Responde al archivo .json de backup con *.restore*");

            try {
                const quoted = await msg.getQuotedMessage();
                if (!quoted.hasMedia) return msg.reply("❌ El mensaje citado no tiene archivo.");
                const media = await quoted.downloadMedia();
                const content = Buffer.from(media.data, 'base64').toString('utf8');
                const backup = JSON.parse(content);
                if (!backup.version) return msg.reply("❌ Archivo de backup inválido.");

                if (backup.menuCommands) { menuCommands = backup.menuCommands; saveMenuCommands(); }
                if (backup.customCommands) { customCommands = backup.customCommands; saveCustomCommands(); }
                if (backup.stockData) { stockData = backup.stockData; saveStockData(); }
                if (backup.pagoData) { pagoData = backup.pagoData; savePagoData(); }
                if (backup.groupSettings) { groupSettings = backup.groupSettings; saveGroupSettings(); }
                if (backup.grupoExtras) { grupoExtras = backup.grupoExtras; saveGrupoExtras(); }
                if (backup.warnsData) { warnsData = backup.warnsData; saveWarns(); }
                if (backup.activePolls) { activePolls = backup.activePolls; savePolls(); }

                return msg.reply(`✅ *Backup restaurado*\nFecha del backup: ${backup.date || 'desconocida'}`);
            } catch (e) {
                return msg.reply("❌ Error al restaurar. Verifica que el archivo sea un backup válido.");
            }
        }

        if (command === '.welcome') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo Admins pueden configurar bienvenidas.");
            const settings = getGroupSettings(chat.id._serialized);

            if (argsStr === 'on') {
                settings.welcome = true;
                saveGroupSettings();
                return msg.reply("👋 *Bienvenidas Activadas* en este grupo.");
            } else if (argsStr === 'off') {
                settings.welcome = false;
                saveGroupSettings();
                return msg.reply("🔕 *Bienvenidas Desactivadas* en este grupo.");
            }
            return msg.reply("⚠️ Uso: *.welcome on* o *.welcome off*");
        }
        
        if (command === '.del') {
            if (!isAdmin) return msg.reply("🚫 Debes ser Admin para forzar borrados ajenos.");
            if (isGroup && !(await requireBotAdmin(msg, isGroup, isBotAdmin))) return;
            if (!msg.hasQuotedMsg) return msg.reply('⚠️ Debes responder al mensaje a borrar.');
            const quotedMsg = await msg.getQuotedMessage();
            return runGroupAction(
                msg,
                () => quotedMsg.delete(true),
                '🗑️ *Mensaje borrado de la existencia.*',
                'No se pudo borrar el mensaje'
            );
        }

        // --- SISTEMA DE INVENTARIO .SETSTOCK Y .STOCK ---
        
        if (command === '.setstock') {
            if (!isAdmin && isGroup) return msg.reply("🚫 Solo Administradores pueden meter stock.");
            
            let imagenBase64 = null;
            let mimeType = null;
            
            // Si hay una imagen respondida, la capturamos
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                if (quoted.hasMedia) {
                    const media = await quoted.downloadMedia();
                    if (media) {
                        imagenBase64 = media.data;
                        mimeType = media.mimetype;
                    }
                }
            }
            
            // Si el mensaje actual tiene media
            if (msg.hasMedia && !imagenBase64) {
                const media = await msg.downloadMedia();
                if (media) {
                    imagenBase64 = media.data;
                    mimeType = media.mimetype;
                }
            }
            
            if (!argsStr) {
                return msg.reply("⚠️ Uso incorrecto. Prueba: *.setstock netflix texto del stock* o responde una imagen con .setstock");
            }
            
            const groupKey = getDataGroupKey(chat, isGroup);
            const groupStock = getGroupStock(groupKey);
            const item = argsStr.toLowerCase();
            groupStock[item] = {
                text: argsStr,
                image: imagenBase64 || null,
                mimetype: mimeType || null
            };
            
            saveStockData();
            return msg.reply(`✅ Stock de *${argsStr}* guardado${imagenBase64 ? ' con imagen' : ''}${isGroup ? ' en este grupo' : ''}.`);
        }

        if (command === '.stock') {
            const groupKey = getDataGroupKey(chat, isGroup);
            const groupStock = getGroupStock(groupKey);

            if (!argsStr) {
                if (Object.keys(groupStock).length === 0) {
                    return msg.reply("📦 *El Stock está vacío* en este grupo.\nUsa `.setstock [nombre] [info]` para agregar.");
                }

                let txt = "📦 *STOCK DEL GRUPO* 📦\n\n";
                for (let k in groupStock) {
                    txt += `• *${groupStock[k].text}*\n`;
                }
                txt += "\n_Para agregar: .setstock_";
                return msg.reply(txt);
            } else {
                let item = argsStr.toLowerCase();
                let found = null;
                
                for (let k in groupStock) {
                    if (k === item || groupStock[k].text.toLowerCase().includes(item)) {
                        found = groupStock[k];
                        break;
                    }
                }
                
                if (!found) {
                    return msg.reply(`🔍 *${argsStr}* no está en el stock de este grupo.`);
                }
                
                if (found.image && found.mimetype) {
                    const media = new MessageMedia(found.mimetype, found.image);
                    return chat.sendMessage(media, { caption: `📦 *${found.text}*` });
                } else {
                    return msg.reply(`📦 *${found.text}*`);
                }
            }
        }

        // --- SISTEMA DE MÉTODOS DE PAGO .SETPAGO Y .PAGO ---
        
        if (command === '.setpago') {
            if (!isAdmin && isGroup) return msg.reply("🚫 Solo Administradores pueden configurar métodos de pago.");
            
            let imagenBase64 = null;
            let mimeType = null;
            
            // Si hay una imagen respondida, la capturamos
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                if (quoted.hasMedia) {
                    const media = await quoted.downloadMedia();
                    if (media) {
                        imagenBase64 = media.data;
                        mimeType = media.mimetype;
                    }
                }
            }
            
            // Si el mensaje actual tiene media
            if (msg.hasMedia && !imagenBase64) {
                const media = await msg.downloadMedia();
                if (media) {
                    imagenBase64 = media.data;
                    mimeType = media.mimetype;
                }
            }
            
            if (!argsStr) {
                return msg.reply("⚠️ Uso incorrecto. Prueba: *.setpago texto del metodo de pago* o responde una imagen con .setpago");
            }
            
            const groupKey = getDataGroupKey(chat, isGroup);
            const groupPago = getGroupPago(groupKey);
            groupPago.metodo = {
                text: argsStr,
                image: imagenBase64 || null,
                mimetype: mimeType || null
            };
            
            savePagoData();
            return msg.reply(`✅ Método de pago guardado${imagenBase64 ? ' con imagen' : ''}${isGroup ? ' en este grupo' : ''}.`);
        }

        if (command === '.pago') {
            const groupKey = getDataGroupKey(chat, isGroup);
            const groupPago = getGroupPago(groupKey);
            if (!groupPago.metodo) {
                return msg.reply("💳 *No hay método de pago configurado* en este grupo.\nUsa `.setpago [info del pago]` para configurar.");
            }
            
            const metodo = groupPago.metodo;
            if (metodo.image && metodo.mimetype) {
                const media = new MessageMedia(metodo.mimetype, metodo.image);
                return chat.sendMessage(media, { caption: `💳 *${metodo.text}*` });
            } else {
                return msg.reply(`💳 *${metodo.text}*`);
            }
        }

        // --- COMANDO .PLAY (yt-search + yt-dlp + APIs de respaldo) ---
        if (command === '.play') {
            if (!argsStr) return msg.reply("❌ Debes escribir la canción: *.play [titulo]*");

            await msg.reply(`🎧 *Buscando y Procesando Audio*\n🔍 \`${argsStr}\`\n⏳ _Extrayendo de YouTube..._`);

            let tempFile = null;
            try {
                const r = await ytSearch(argsStr);
                const videos = r.videos;
                if (!videos || videos.length === 0) {
                    return msg.reply("❌ No encontré ninguna canción con ese nombre.");
                }

                const video = videos[0];
                const videoUrl = video.url;
                tempFile = await downloadYoutubeAudio(videoUrl);

                const media = MessageMedia.fromFilePath(tempFile);
                await chat.sendMessage(media, {
                    caption: `🎵 *${video.title}*\n⏱️ ${video.timestamp || video.duration?.timestamp || ''}`
                });
            } catch (err) {
                console.error("Play error:", err);
                return msg.reply("❌ No pude descargar la música.\n_Verifica que yt-dlp esté instalado: ./setup.sh_");
            } finally {
                safeUnlink(tempFile);
            }
            return;
        }

        if (command === '.tt') {
            if (!argsStr) return msg.reply("❌ Pega un enlace: *.tt https://www.tiktok.com/...*");
            if (!argsStr.includes('tiktok')) {
                return msg.reply("❌ Enlace inválido. Debe ser de TikTok.");
            }

            await msg.reply(`📱 *Descargando Video de TikTok*\n⏳ _yt-dlp → API gratis..._`);

            let tempFile = null;
            try {
                const url = argsStr.startsWith('http') ? argsStr : `https://${argsStr}`;
                tempFile = await downloadSocialVideo(url, 'tiktok');
                tempFile = await sendVideoToChat(chat, tempFile);
            } catch (err) {
                console.error("TikTok download error:", err.message || err);
                return msg.reply("❌ No pude descargar el video. Verifica el enlace.");
            } finally {
                safeUnlink(tempFile);
            }
            return;
        }

        if (command === '.ig') {
            if (!argsStr) return msg.reply("❌ Pega un enlace: *.ig https://www.instagram.com/reel/...*");
            if (!argsStr.includes('instagram')) {
                return msg.reply("❌ Enlace inválido. Debe ser de Instagram.");
            }

            await msg.reply(`📸 *Descargando de Instagram*\n⏳ _yt-dlp → API gratis..._`);

            let tempFile = null;
            try {
                const url = argsStr.startsWith('http') ? argsStr : `https://${argsStr}`;
                tempFile = await downloadSocialVideo(url, 'instagram');
                tempFile = await sendVideoToChat(chat, tempFile);
            } catch (err) {
                console.error("Instagram download error:", err.message || err);
                return msg.reply("❌ No pude descargar. El reel debe ser público.");
            } finally {
                safeUnlink(tempFile);
            }
            return;
        }

        if (command === '.yt') {
            let videoUrl = argsStr;
            let title = '';

            if (!videoUrl) return msg.reply("❌ Uso: *.yt [url o título]*");

            await msg.reply(`🎬 *Descargando Video*\n⏳ _Procesando..._`);

            let tempFile = null;
            try {
                if (!videoUrl.includes('youtube') && !videoUrl.includes('youtu.be')) {
                    const r = await ytSearch(videoUrl);
                    if (!r.videos || r.videos.length === 0) {
                        return msg.reply("❌ No encontré ningún video con ese nombre.");
                    }
                    videoUrl = r.videos[0].url;
                    title = r.videos[0].title;
                }

                tempFile = await downloadYoutubeVideo(videoUrl);
                tempFile = await sendVideoToChat(chat, tempFile, title ? `🎬 *${title}*` : '🎬 Video de YouTube');
            } catch (err) {
                console.error("YouTube video error:", err);
                return msg.reply("❌ No pude descargar el video. Verifica yt-dlp con ./setup.sh");
            } finally {
                safeUnlink(tempFile);
            }
            return;
        }

        // --- SISTEMA DE STICKERS ---
        if (command === '.s' || command === '.stiker' || command === '.img') {
            let targetMsg = msg;
            if (msg.hasQuotedMsg) {
                targetMsg = await msg.getQuotedMessage();
            }
            return makeStickerFromMessage(msg, targetMsg);
        }

        if (command === '.quotly') {
            if (!msg.hasQuotedMsg) return msg.reply("⚠️ Debes responder a un mensaje con .quotly");
            // Reutiliza la lógica de .qc
            command = '.qc';
        }

        if (command === '.brat') {
            if (!argsStr) return msg.reply("⚠️ Uso: *.brat tu texto aquí*");
            try {
                const browser = client.pupBrowser;
                if (!browser) throw new Error('Bot no listo');
                const png = await renderBratSticker(browser, argsStr);
                const mediaBrat = new MessageMedia('image/png', png.toString('base64'), 'brat.png');
                return chat.sendMessage(mediaBrat, { sendMediaAsSticker: true });
            } catch (e) {
                console.error('brat error:', e);
                return msg.reply("❌ No pude generar el sticker Brat.");
            }
        }

        if (command === '.reenviar') {
            if (!msg.hasQuotedMsg) return msg.reply("⚠️ Debes responder al mensaje que quieres reenviar.");
            const quoted = await msg.getQuotedMessage();
            if (quoted.hasMedia) {
                const media = await quoted.downloadMedia();
                return chat.sendMessage(media, { caption: quoted.body || '' });
            }
            return chat.sendMessage(quoted.body || '(mensaje vacío)');
        }

        if (command === '.qc') {
            if (!msg.hasQuotedMsg) {
                return msg.reply('⚠️ Responde (cita) el mensaje que quieres convertir en sticker con *.qc*');
            }

            await msg.reply('⏳ _Generando sticker de burbuja..._');

            try {
                const targetMsg = await msg.getQuotedMessage();
                const contact = await targetMsg.getContact();
                let pfpUrl = null;
                try {
                    pfpUrl = await contact.getProfilePicUrl();
                } catch (e) {}

                const browser = client.pupBrowser;
                if (!browser) throw new Error('Bot aún no está listo');

                const pngBuffer = await renderQuoteSticker(browser, {
                    name: contact.pushname || contact.name || contact.number || 'Usuario',
                    text: targetMsg.body || '',
                    avatarUrl: pfpUrl,
                    hasMedia: targetMsg.hasMedia,
                    mimetype: targetMsg._data?.mimetype || null,
                    isViewOnce: !!(targetMsg.isViewOnce || targetMsg._data?.isViewOnce)
                });

                const b64 = pngBuffer.toString('base64');
                const mediaQ = new MessageMedia('image/png', b64, 'qc.png');
                return chat.sendMessage(mediaQ, { sendMediaAsSticker: true });
            } catch (e) {
                console.error('qc local error:', e);
                return msg.reply('❌ No pude generar el sticker. Intenta con otro mensaje.');
            }
        }

        // --- HERRAMIENTAS ---
        if (command === '.clima') {
            const ciudad = argsStr || 'Mexico City';
            try {
                const w = await getWeather(ciudad);
                return msg.reply(
                    `🌤️ *Clima en ${w.place}*\n\n` +
                    `🌡️ Temperatura: ${w.temp}°C\n` +
                    `💧 Humedad: ${w.humidity}%\n` +
                    `💨 Viento: ${w.wind} km/h\n` +
                    `☁️ Estado: ${w.desc}`
                );
            } catch (e) {
                return msg.reply("❌ No pude obtener el clima. Prueba: *.clima Ciudad de Mexico*");
            }
        }

        if (command === '.horario') {
            const now = new Date();
            const mx = now.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'full', timeStyle: 'long' });
            const utc = now.toUTCString();
            return msg.reply(`🕐 *Horario Actual*\n\n🇲🇽 México: ${mx}\n🌍 UTC: ${utc}`);
        }

        if (command === '.horoscopo') {
            const signoInput = (argsStr || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const data = getHoroscope(signoInput);
            if (!data) {
                return msg.reply(`⚠️ Uso: *.horoscopo [signo]*\n\nSignos: aries, tauro, geminis, cancer, leo, virgo, libra, escorpio, sagitario, capricornio, acuario, piscis`);
            }
            return msg.reply(
                `♈ *Horóscopo — ${data.sign}*\n\n` +
                `📅 Fecha: ${data.date}\n` +
                `📝 ${data.description}\n\n` +
                `😊 Humor: ${data.mood}\n` +
                `🎨 Color: ${data.color}\n` +
                `🍀 Suerte: ${data.lucky_number}\n` +
                `⏰ Tiempo: ${data.lucky_time}`
            );
        }

        if (command === '.fotodeperfil') {
            let targetId = msg.author || msg.from;
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                targetId = quoted.author || quoted.from;
            } else if (msg.mentionedIds.length > 0) {
                targetId = msg.mentionedIds[0];
            }
            try {
                const contact = await client.getContactById(targetId);
                const pfpUrl = await contact.getProfilePicUrl();
                if (!pfpUrl) return msg.reply("❌ Este usuario no tiene foto de perfil.");
                const media = await MessageMedia.fromUrl(pfpUrl, { unsafeMime: true });
                return chat.sendMessage(media, { caption: `📸 Foto de perfil de *${contact.pushname || contact.number}*` });
            } catch (e) {
                return msg.reply("❌ No pude obtener la foto de perfil.");
            }
        }

        if (command === '.ver' || command === '.ver2' || command === '.hd') {
            if (!msg.hasQuotedMsg) {
                return msg.reply('⚠️ Responde a una imagen, video o foto *ver una vez* con *.ver*');
            }

            await msg.reply('⏳ _Extrayendo multimedia..._');

            const result = await extractQuotedMedia(client, msg);
            if (result.error) return msg.reply(result.error);

            const { media, isViewOnce, caption } = result;
            const mode = command === '.ver2' ? 'document' : 'normal';
            return sendMediaAsView(chat, media, mode, caption, isViewOnce);
        }

        if (command === '.ping' || command === '.status') {
            const uptime = formatUptime(Date.now() - BOT_START_TIME);
            const groups = activeGroups.length;
            const scheduled = scheduledMessages.length;
            return msg.reply(
                `🏓 *${getBotDisplayName()} — Online*\n\n` +
                `⏱️ Uptime: ${uptime}\n` +
                `👥 Grupos activos: ${groups}\n` +
                `⏰ Mensajes programados: ${scheduled}\n` +
                `📋 Comandos de menú: ${MENU_COMMAND_COUNT}+\n` +
                `📦 Node: ${process.version}`
            );
        }

        if (command === '.totalcomandos') {
            const extras = grupoExtras.length;
            const custom = Object.keys(customCommands).length;
            return msg.reply(
                `📋 *COMANDOS DISPONIBLES*\n\n` +
                `• Menú predefinidos: *${MENU_COMMAND_COUNT}*\n` +
                `• Extras del grupo: *${extras}*\n` +
                `• Personalizados (.create): *${custom}*\n` +
                `• Total aproximado: *${MENU_COMMAND_COUNT + extras + custom}*\n\n` +
                `_Configura cualquiera con .setnombre contenido_`
            );
        }

        if (command === '.id' || command === '.jid') {
            let targetId = msg.author || msg.from;
            let label = 'Tu ID';
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                targetId = quoted.author || quoted.from;
                label = 'ID del mensaje citado';
            } else if (msg.mentionedIds.length > 0) {
                targetId = msg.mentionedIds[0];
                label = 'ID del usuario mencionado';
            }
            let txt = `🆔 *${label}*\n\`${targetId}\`\n\n`;
            if (isGroup) {
                txt += `🏠 *ID del grupo*\n\`${chat.id._serialized}\`\n\n`;
            }
            const botId = client.info?.wid?._serialized || 'conectando...';
            txt += `🤖 *ID del bot*\n\`${botId}\``;
            return msg.reply(txt);
        }

        if (command === '.tr' || command === '.traducir') {
            const parts = argsStr.split('|').map(s => s.trim());
            if (parts.length < 2) {
                return msg.reply("⚠️ Uso: *.tr hola | en*\nO: *.tr hello | es*\nFormato: texto | idioma_destino");
            }
            const text = parts[0];
            const toLang = parts[1].toLowerCase();
            const fromLang = parts[2] ? parts[2].toLowerCase() : 'auto';
            try {
                const translated = await translateText(text, fromLang, toLang);
                return msg.reply(`🌐 *Traducción*\n\n📝 _${text}_\n➡️ *${translated}*`);
            } catch (e) {
                return msg.reply("❌ Error al traducir. Verifica el código de idioma (en, es, fr, pt, etc.)");
            }
        }

        if (command === '.sorteo' || command === '.rifa') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");

            let candidates = [];
            if (msg.mentionedIds.length > 0) {
                candidates = msg.mentionedIds;
            } else if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                candidates = [quoted.author || quoted.from];
            } else {
                const botNum = client.info?.wid?.user?.slice(-10) || '';
                candidates = chat.participants
                    .filter(p => !p.id.user.endsWith(botNum))
                    .map(p => p.id._serialized);
            }

            if (candidates.length === 0) return msg.reply("⚠️ No hay participantes para el sorteo.");
            const winner = candidates[Math.floor(Math.random() * candidates.length)];
            return chat.sendMessage(
                `🎉 *¡SORTEO!*\n\n🏆 Ganador: @${winner.split('@')[0]}\n👥 Participantes: ${candidates.length}`,
                { mentions: [winner] }
            );
        }

        if (command === '.encuesta') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo Admins pueden crear encuestas.");

            const parts = argsStr.split('|').map(s => s.trim()).filter(Boolean);
            if (parts.length < 3) {
                return msg.reply("⚠️ Uso: *.encuesta Pregunta? | Opción1 | Opción2 | Opción3*");
            }

            const question = parts[0];
            const options = parts.slice(1);
            if (options.length > 10) return msg.reply("⚠️ Máximo 10 opciones.");

            activePolls[chat.id._serialized] = {
                question,
                options,
                votes: {},
                createdBy: senderNumber,
                createdAt: Date.now()
            };
            savePolls();

            let txt = `📊 *ENCUESTA*\n\n❓ ${question}\n\n`;
            options.forEach((opt, i) => { txt += `${i + 1}. ${opt}\n`; });
            txt += `\n_Vota con: .voto [número]_`;
            return msg.reply(txt);
        }

        if (command === '.voto') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");

            const poll = activePolls[chat.id._serialized];
            if (!poll) return msg.reply("ℹ️ No hay encuesta activa. Crea una con *.encuesta*");

            const voteNum = parseInt(argsStr, 10);
            if (isNaN(voteNum) || voteNum < 1 || voteNum > poll.options.length) {
                return msg.reply(`⚠️ Uso: *.voto [1-${poll.options.length}]*`);
            }

            const voterId = msg.author || msg.from;
            poll.votes[voterId] = voteNum - 1;
            savePolls();

            const counts = poll.options.map(() => 0);
            Object.values(poll.votes).forEach(idx => { counts[idx]++; });

            let txt = `📊 *Resultados — ${poll.question}*\n\n`;
            poll.options.forEach((opt, i) => {
                const total = Object.keys(poll.votes).length || 1;
                const pct = Math.round((counts[i] / total) * 100);
                txt += `${i + 1}. ${opt} — ${counts[i]} voto(s) (${pct}%)\n`;
            });
            txt += `\n_Total votos: ${Object.keys(poll.votes).length}_`;
            return msg.reply(txt);
        }

        if (command === '.cerrarencuesta') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo Admins pueden cerrar encuestas.");
            if (!activePolls[chat.id._serialized]) {
                return msg.reply("ℹ️ No hay encuesta activa en este grupo.");
            }
            delete activePolls[chat.id._serialized];
            savePolls();
            return msg.reply("✅ *Encuesta cerrada.*");
        }

        if (command === '.programados') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo Admins.");
            const jobs = scheduledMessages.filter(j => j.groupId === chat.id._serialized);
            if (!jobs.length) return msg.reply("ℹ️ No hay mensajes programados en este grupo.");
            let txt = '⏰ *MENSAJES PROGRAMADOS*\n\n';
            for (const j of jobs) {
                txt += `• ID \`${j.id}\` — ${new Date(j.executeAt).toLocaleString('es-MX')}\n`;
                txt += `  _${(j.text || '(media)').slice(0, 60)}_\n`;
            }
            txt += '\n_Cancelar: .cancelarprogramado [ID]_';
            return msg.reply(txt);
        }

        if (command === '.cancelarprogramado') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo Admins.");
            if (!argsStr) return msg.reply("⚠️ Uso: *.cancelarprogramado [ID]*\nLista con *.programados*");
            const before = scheduledMessages.length;
            scheduledMessages = scheduledMessages.filter(j =>
                !(j.id === argsStr && j.groupId === chat.id._serialized)
            );
            if (scheduledMessages.length === before) {
                return msg.reply("❌ No encontré ese ID en este grupo.");
            }
            saveScheduled();
            return msg.reply(`✅ Programado \`${argsStr}\` cancelado.`);
        }

        if (command === '.moneda' || command === '.divisa') {
            const parts = argsStr.split(/\s+/).filter(Boolean);
            try {
                const rates = await getExchangeRates();
                if (command === '.divisa' || parts.length === 0) {
                    const show = ['MXN', 'EUR', 'GBP', 'CAD', 'ARS', 'COP', 'BRL'];
                    let txt = '💱 *Tipos de cambio (base USD — BCE)*\n\n';
                    for (const r of show) {
                        if (rates[r]) txt += `• 1 USD = ${rates[r].toFixed(4)} ${r}\n`;
                    }
                    txt += `\n_Uso: .moneda 100 USD MXN_`;
                    return msg.reply(txt);
                }
                const amount = parseFloat(parts[0]);
                const from = (parts[1] || 'USD').toUpperCase();
                const to = (parts[2] || 'MXN').toUpperCase();
                if (isNaN(amount)) return msg.reply("⚠️ Uso: *.moneda 100 USD MXN*");
                const result = convertCurrency(amount, from, to, rates);
                return msg.reply(`💱 *Conversión*\n\n${amount} ${from} = *${result.toFixed(2)} ${to}*`);
            } catch (e) {
                return msg.reply("❌ No pude consultar las divisas. Intenta más tarde.");
            }
        }

        // --- ENRUTADOR DE MENÚS (O(1)) ---
        const menuRouter = {
            '.menuprincipal': MENU_PRINCIPAL,
            '.menu': MENU_PRINCIPAL,
            '.menuadmins': MENU_ADMINS,
            '.menulogos': MENU_LOGOS,
            '.menufreefire': MENU_FREE_FIRE,
            '.menustickers': MENU_STICKERS,
            '.menuventas': MENU_VENTAS,
            '.menuventas2': MENU_VENTAS2,
            '.menufun': MENU_FUN,
            '.menuhot': MENU_HOT,
            '.menuherramientas': MENU_HERRAMIENTAS,
            '.menugrupo': MENU_GRUPO,
            '.menucomandos': MENU_GRUPO,
        };

        if (menuRouter[command]) {
            return msg.reply(menuRouter[command]);
        }

        // --- OWNER: nuevoset / eliminarset ---
        if (command === '.nuevoset') {
            if (!isAdmin && !senderNumber.includes(ADMIN_PRIVILEGIADO)) {
                return msg.reply("🚫 Solo el owner o admins pueden crear comandos del grupo.");
            }
            if (!argsStr) return msg.reply("⚠️ Uso: *.nuevoset nombrecomando*");

            const cmdName = argsStr.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!cmdName) return msg.reply("⚠️ Nombre inválido. Solo letras y números.");

            if (isMenuCommand(cmdName) || customCommands[cmdName]) {
                return msg.reply(`⚠️ El comando .${cmdName} ya existe.`);
            }

            grupoExtras.push(cmdName);
            menuCommands[cmdName] = { text: "", image: null, mimetype: null };
            saveGrupoExtras();
            saveMenuCommands();
            return msg.reply(`✅ *Comando .${cmdName} creado*\n\nConfigúralo con: *.set${cmdName} tu contenido*\nO responde una imagen/sticker con *.set${cmdName}*`);
        }

        if (command === '.eliminarset') {
            if (!isAdmin && !senderNumber.includes(ADMIN_PRIVILEGIADO)) {
                return msg.reply("🚫 Solo el owner o admins pueden eliminar comandos del grupo.");
            }
            if (!argsStr) return msg.reply("⚠️ Uso: *.eliminarset nombrecomando*");

            const cmdName = argsStr.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!cmdName) return msg.reply("⚠️ Nombre inválido.");

            if (!isMenuCommand(cmdName) && !customCommands[cmdName]) {
                return msg.reply(`⚠️ El comando .${cmdName} no existe.`);
            }

            delete menuCommands[cmdName];
            grupoExtras = grupoExtras.filter(c => c !== cmdName);
            saveMenuCommands();
            saveGrupoExtras();
            return msg.reply(`🗑️ *Comando .${cmdName} eliminado* del grupo.`);
        }

        // --- SISTEMA DE COMANDOS PERSONALIZADOS ---
        
        if (command === '.create') {
            if (!isAdmin && isGroup) return msg.reply("🚫 Solo Administradores pueden crear comandos personalizados.");
            if (!argsStr) return msg.reply("⚠️ Uso: .create nombredelcomando");
            
            const cmdName = argsStr.toLowerCase();
            
            const reservedCommands = new Set([
                ...BUILTIN_COMMANDS,
                ...MENU_COMMAND_NAMES
            ]);
            
            if (reservedCommands.has(cmdName)) {
                return msg.reply(`⚠️ El comando .${cmdName} ya existe en el bot.`);
            }
            
            if (customCommands[cmdName]) {
                return msg.reply(`⚠️ El comando personalizado .${cmdName} ya fue creado.`);
            }
            
            customCommands[cmdName] = { text: "", image: null, mimetype: null };
            saveCustomCommands();
            
            return msg.reply(`✅ *Comando .${cmdName} Creado*\n\nAhora usa: *.set${cmdName} tu contenido* para guardar información.\nO responde una imagen con *.set${cmdName}* para guardar con imagen.`);
        }

        // Comando dinámico .set[comando] (excluye .setstock y .setpago, manejados arriba)
        if (command.startsWith('.set') && command !== '.setstock' && command !== '.setpago') {
            const cmdName = command.substring(4).toLowerCase();
            
            if (!cmdName) {
                return msg.reply("⚠️ Uso incorrecto. Ejemplo: .setmicomando info");
            }
            
            if (!isAdmin && isGroup) return msg.reply("🚫 Solo Administradores pueden editar comandos.");
            
            let imagenBase64 = null;
            let mimeType = null;
            
            // Si hay una imagen respondida, la capturamos
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                if (quoted.hasMedia) {
                    const media = await quoted.downloadMedia();
                    if (media) {
                        imagenBase64 = media.data;
                        mimeType = media.mimetype;
                    }
                }
            }
            
            // Si el mensaje actual tiene media
            if (msg.hasMedia && !imagenBase64) {
                const media = await msg.downloadMedia();
                if (media) {
                    imagenBase64 = media.data;
                    mimeType = media.mimetype;
                }
            }
            
            // Verificar si es un comando personalizado (creado con .create)
            if (customCommands[cmdName]) {
                customCommands[cmdName] = {
                    text: argsStr || customCommands[cmdName].text,
                    image: imagenBase64 || customCommands[cmdName].image,
                    mimetype: mimeType || customCommands[cmdName].mimetype
                };
                saveCustomCommands();
                return msg.reply(`✅ Comando personalizado .${cmdName} actualizado${imagenBase64 ? ' con imagen' : ''}.`);
            }
            
            if (isMenuCommand(cmdName)) {
                menuCommands[cmdName] = {
                    text: argsStr || menuCommands[cmdName]?.text || "",
                    image: imagenBase64 || menuCommands[cmdName]?.image || null,
                    mimetype: mimeType || menuCommands[cmdName]?.mimetype || null
                };
                saveMenuCommands();
                return msg.reply(`✅ Comando de menú .${cmdName} configurado${imagenBase64 ? ' con imagen/sticker' : ''}.`);
            }
            
            return msg.reply(`⚠️ El comando .${cmdName} no existe.\n\nOpciones:\n1. *.nuevoset ${cmdName}* (comando de grupo)\n2. *.create ${cmdName}* (personalizado)\n3. O usa uno del menú: ${MENU_COMMAND_NAMES.slice(0, 5).map(c => '.set' + c).join(', ')}...`);
        }

        // Comandos personalizados
        const customName = command.substring(1);
        if (customCommands[customName]) {
            const cmdData = resolveCustomCommandData(customName);
            return sendMenuCommandResponse(customName, cmdData, chat, msg);
        }

        // Comandos de menú — siempre responden (configurados o con plantilla por defecto)
        if (isMenuCommand(customName)) {
            const cmdData = resolveMenuCommandData(customName, chat, isGroup);
            return sendMenuCommandResponse(customName, cmdData, chat, msg);
        }

        const similar = findSimilarCommand(command);
        if (similar) {
            return msg.reply(`❓ Comando *${command}* no encontrado.\n\n¿Quisiste decir *.${similar}*?`);
        }

        return msg.reply(
            `❓ Comando *${command}* no reconocido.\n\n` +
            `• *.menu* — Ver menús\n` +
            `• *.totalcomandos* — Ver cantidad de comandos\n` +
            `• *.activarbot* — Activar bot en el grupo (admins)`
        );

    } catch (err) {
        console.error("Error intercerptando mensaje:", err);
        try {
            await msg.reply(
                '❌ *Error al procesar el comando*\n\n' +
                'Si es de moderación (.kick, .update, etc.), verifica que el *bot sea admin* del grupo.\n' +
                'Si persiste, reinicia el bot.'
            );
        } catch (e) {}
    }
});

// ==========================================
// ANTILINK + ANTIFLOOD — mensajes normales (sin punto)
// ==========================================
client.on('message_create', async msg => {
    try {
        const text = (msg.body || '').trim();
        if (!text || msg.fromMe) return;

        const chat = await msg.getChat();
        if (!chat.isGroup || !isActiveGroup(chat.id._serialized)) return;

        const senderNumber = (await msg.getContact()).id?.user || '';
        const isAdmin = await checkIsAdmin(msg, chat, true, senderNumber);
        const isPrivileged = isAdmin || senderNumber.includes(ADMIN_PRIVILEGIADO);

        const settings = getGroupSettings(chat.id._serialized);
        const botCanDelete = await isChatBotAdmin(chat);

        if (!text.startsWith('.') && settings.antilink && botCanDelete) {
            const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/gi;
            if (urlRegex.test(text) && !isPrivileged) {
                try {
                    await msg.delete(true);
                    const userPush = await msg.getContact().then(c => c.pushname || c.number).catch(() => "Usuario");
                    await chat.sendMessage(`🚨 *ANTILINK ACTIVADO* 🚨\n\n🚫 Se eliminó un mensaje de *${userPush}*.\n⚠️ Está prohibido enviar enlaces en este grupo.`);
                } catch (e) {
                    console.error('Antilink delete error:', e.message);
                }
                return;
            }
        }

        if (!text.startsWith('.') && settings.antiflood && botCanDelete && !isPrivileged) {
            const userId = msg.author || msg.from;
            const floodKey = `${chat.id._serialized}_${userId}`;
            const now = Date.now();
            const window = 10000;
            const maxMsgs = 5;

            if (!floodTracker[floodKey] || now - floodTracker[floodKey].firstAt > window) {
                floodTracker[floodKey] = { count: 1, firstAt: now };
            } else {
                floodTracker[floodKey].count++;
                if (floodTracker[floodKey].count > maxMsgs) {
                    try {
                        await msg.delete(true);
                        const userPush = await msg.getContact().then(c => c.pushname || c.number).catch(() => "Usuario");
                        await chat.sendMessage(`🚨 *ANTIFLOOD* 🚨\n\n🚫 *${userPush}*, deja de spamear (máx. ${maxMsgs} msgs / 10s).`);
                    } catch (e) {}
                    floodTracker[floodKey] = { count: 0, firstAt: now };
                }
            }
        }
    } catch (e) {}
});

let initRetries = 0;
const MAX_INIT_RETRIES = 3;

async function startBot() {
    console.log('⏳ Iniciando bot... (en PCs lentas WhatsApp Web puede tardar varios minutos)');
    try {
        await client.initialize();
    } catch (err) {
        const msg = err?.message || String(err);
        const isTimeout = msg.includes('timed out') || msg.includes('timeout');
        initRetries++;

        if (isTimeout && initRetries <= MAX_INIT_RETRIES) {
            const waitSec = 15 * initRetries;
            console.warn(`⚠️ Timeout al cargar WhatsApp Web. Reintento ${initRetries}/${MAX_INIT_RETRIES} en ${waitSec}s...`);
            await new Promise(r => setTimeout(r, waitSec * 1000));
            return startBot();
        }

        console.error('❌ No se pudo iniciar el bot:', msg);
        console.log('\n💡 Si sigue fallando, prueba:');
        console.log('   1. Verificar conexión a internet');
        console.log('   2. Cerrar otros Chrome/Chromium abiertos');
        console.log('   3. rm -rf .wwebjs_cache && node index.js');
        console.log('   4. Si la sesión está corrupta: rm -rf .wwebjs_auth (tendrás que escanear QR de nuevo)\n');
        process.exit(1);
    }
}

startBot();

// ==========================================
// ESCUDO ANTI-CRASH (Inmortalidad del Proceso)
// ==========================================
process.on('uncaughtException', (err) => {
    console.error('🔥 Error crítico interceptado (El bot no morirá):', err);
});
process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || String(reason);
    if (msg.includes('Page.navigate timed out') || msg.includes('ProtocolError')) {
        console.error('🔥 Error de conexión Puppeteer:', msg);
        console.log('💡 Reinicia el bot. Si persiste: rm -rf .wwebjs_cache');
        return;
    }
    console.error('🔥 Promesa fallida interceptada:', reason);
});
