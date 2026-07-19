process.env.TZ = 'America/Mexico_City';
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
const axios = require('axios');
const { loadEnv } = require('./load-env');
const { MENU_COMMAND_NAMES, MENU_COMMAND_COUNT } = require('./menu-commands');
const { buildDefaultMenuText, buildDefaultCustomText, hasCommandContent } = require('./menu-defaults');
const { renderQuoteSticker } = require('./quote-card');
const { extractQuotedMedia, sendMediaAsView, cacheViewOnceFromMessage } = require('./media-view');
const {
    downloadSocialVideo,
    safeUnlink,
    checkYtdlpInstalled,
    sweepTmpDir
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
const {
    getMenuStyle,
    buildMainMenu,
    buildAdminsMenu,
    buildFunMenu,
    buildHerramientasMenu,
    buildStickersMenu,
    buildFreeFireMenu,
    DEFAULT_STYLE,
    SYSTEM_CREATOR
} = require('./lib/menu-builder');
const { ensureWaVersionCache } = require('./lib/wa-version-cache');
const store = require('./lib/store');
const storeWizard = require('./lib/store-load-wizard');
const groupCommands = require('./lib/group-commands');
const { resolveMenuImageB64 } = require('./lib/menu-sticker');
const approvalQueue = require('./lib/approval-queue');
const { getRandomFarewell } = require('./lib/welcome-texts');

loadEnv();

function safeLocaleString(date, locale, options) {
    try {
        return date.toLocaleString(locale, options);
    } catch (e) {
        try {
            const optCopy = { ...options };
            delete optCopy.timeZone;
            return date.toLocaleString(locale, optCopy);
        } catch (e2) {
            return date.toString();
        }
    }
}

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
// Clave normalizada por últimos 10 dígitos: WhatsApp puede dar el mismo usuario
// como 521xxxx@c.us o como xxxx@lid, y con el ID completo el mute nunca coincidía.
function muteKeyFor(chatId, userId) {
    const digits = String(userId).split('@')[0].replace(/\D/g, '');
    return `${chatId}_${digits.slice(-10)}`;
}
let mutedUsers = {}; // Formato: { muteKeyFor(chatId, userId): { mutedUntil, reason } }
if (fs.existsSync(MUTED_USERS_FILE)) {
    mutedUsers = JSON.parse(fs.readFileSync(MUTED_USERS_FILE, 'utf8'));
    // Migrar claves viejas (chatId_123@c.us) al formato normalizado
    for (const key of Object.keys(mutedUsers)) {
        if (key.includes('@g.us_') && key.includes('@', key.indexOf('@g.us_') + 6)) {
            const [chatPart, userPart] = key.split('@g.us_');
            const newKey = muteKeyFor(`${chatPart}@g.us`, userPart);
            mutedUsers[newKey] = mutedUsers[key];
            delete mutedUsers[key];
        }
    }
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

// Purga de floodTracker: claves inactivas > 1h se eliminan (evita crecimiento infinito de RAM)
setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const key of Object.keys(floodTracker)) {
        if (floodTracker[key].firstAt < cutoff) delete floodTracker[key];
    }
}, 30 * 60 * 1000).unref();

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

// Devuelve la entrada de mute vigente o null (limpia las expiradas)
function getActiveMute(chatId, userId) {
    const key = muteKeyFor(chatId, userId);
    const entry = mutedUsers[key];
    if (!entry) return null;
    if (Date.now() >= entry.mutedUntil) {
        delete mutedUsers[key];
        saveMutedUsers();
        return null;
    }
    return entry;
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
// Los códigos NUNCA se guardan en texto plano: solo sus hashes SHA-256.
const crypto = require('crypto');
function sha256(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }

const SYSTEM_UNLOCK_HASH = '220a227688e246af1e0fb6fca4c233e0f647afeba862e406f4ee7e6795a5eae4';
const providedUnlock = (process.env.SYSTEM_UNLOCK_CODE || process.argv[2] || '').trim();
if (sha256(providedUnlock) !== SYSTEM_UNLOCK_HASH) {
    console.error('\n🔒 SISTEMA BLOQUEADO');
    console.error('   Este bot requiere el código de desbloqueo del sistema.');
    console.error('   Configura en .env:  SYSTEM_UNLOCK_CODE=********');
    console.error('   O ejecuta:          node index.js <código>\n');
    process.exit(1);
}

const ADMIN_PRIVILEGIADO = process.env.ADMIN_PRIVILEGIADO || '7209143300';
// Hash del código L2 (si defines BOT_L2_CODE en .env, se hashea al vuelo)
const BOT_L2_HASH = process.env.BOT_L2_CODE
    ? sha256(process.env.BOT_L2_CODE.trim())
    : '1788c74b1c9262866c2071b65df7bfcb7911c2b064c931b580515c2d9d2cd7f8';
function isBotL2Code(value) { return sha256(String(value || '').trim()) === BOT_L2_HASH; }
const MAX_RECONNECT = parseInt(process.env.MAX_RECONNECT, 10) || 5;
const BOT_PROFILE_FILE = './botprofile.json';

if (fs.existsSync(path.join(__dirname, '.env'))) {
    console.log('🔐 Configuración cargada desde .env');
} else {
    console.warn('⚠️ Sin .env — copia .env.example → .env para personalizar secretos.');
}

function getBotL2Panel() {
    return `╔══════════════════════════╗
║  ♾️ BOT L2 — PANEL MAESTRO ♾️  ║
╚══════════════════════════╝

🔓 Sesión desbloqueada — usa los comandos sin código

*╭── PERFIL DEL BOT ──╮*
│ *.botl2 nombre [texto]*
│   Cambia el nombre visible (máx. 25)
│
│ *.botl2 status [texto]*
│   Cambia el estado / about (máx. 139)
│
│ *.botl2 foto*
│   Responde a una imagen o envíala con el comando
│
│ *.botl2 quitarfoto*
│   Elimina la foto de perfil personalizada
│
│ *.botl2 info*
│   Ver perfil actual del bot
│
│ *.botl2 aplicar*
│   Re-aplica nombre, status y foto guardados
│
│ *.botl2 auto on/off*
│   Auto-aplicar perfil al reiniciar el bot
│
│ *.botl2 historial*
│   Últimos cambios realizados
│
│ *.botl2 emoji bullet 💜*
│ *.botl2 emoji badge 🎀*
│ *.botl2 emoji welcome ☀️*
│ *.botl2 emoji border ⬣*
│   Personaliza emojis del menú
│
│ *.botl2 firma [texto/off/reset]*
│   Pie de los mensajes de .n y entregas
│
│ *.botl2 menuimagen*
│   Imagen del menú (responde a una imagen o envíala con el comando)
│
│ *.botl2 quitarmenuimagen*
│   Volver a la imagen auto-generada del menú
│
│ *.botl2 menupreview*
│   Vista previa del menú principal
│
│ *.botl2 reporte*
│   Estadísticas: grupos activos, tiendas, pendientes
│
│ *.botl2 salir*
│   Cerrar la sesión del panel
*╰────────────────────╯*`;
}

let botProfile = {
    displayName: null,
    status: null,
    profilePhoto: null,
    hasCustomPhoto: false,
    menuImage: null,
    hasCustomMenuImage: false,
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
    return botProfile.displayName || client.info?.pushname || 'Bot';
}

function getBotBrandFooter(defaultName) {
    // Firma editable con .botl2 firma [texto] — 'off' la desactiva
    const custom = botProfile.brandFooter;
    if (custom === 'off') return '';
    const texto = custom || defaultName || getBotDisplayName();
    return `\n\n> ${texto}`;
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
        `🖼️ Imagen del menú: ${botProfile.hasCustomMenuImage ? '✅ Personalizada' : '♾️ Auto-generada'}\n` +
        `🔒 Creador (fijo): *${SYSTEM_CREATOR}*\n` +
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

function isPrivilegedOwner(senderNumber) {
    if (!senderNumber || !ADMIN_PRIVILEGIADO) return false;
    const a = String(senderNumber).replace(/\D/g, '');
    const b = String(ADMIN_PRIVILEGIADO).replace(/\D/g, '');
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a) || a.slice(-10) === b.slice(-10);
}

function getBotPhoneNumber() {
    return process.env.WA_PHONE || client.info?.wid?.user || 'desconocido';
}

function getPrivilegedOwnerJid() {
    let digits = String(ADMIN_PRIVILEGIADO).replace(/\D/g, '');
    if (digits.length === 10) {
        digits = '521' + digits;
    }
    return `${digits}@c.us`;
}

async function getGroupInviteUrl(chat) {
    try {
        if (!await isChatBotAdmin(chat)) return null;
        const code = await chat.getInviteCode();
        return code ? `https://chat.whatsapp.com/${code}` : null;
    } catch (e) {
        return null;
    }
}

async function notifyPrivilegedOwner(text) {
    try {
        await client.sendMessage(getPrivilegedOwnerJid(), text);
        return true;
    } catch (e) {
        console.error('notifyPrivilegedOwner:', e.message);
        return false;
    }
}

async function getRequesterDisplayName(msg) {
    try {
        const c = await msg.getContact();
        return c.pushname || c.name || c.number || 'Admin';
    } catch (e) {
        return 'Admin';
    }
}

function buildFleetReportText() {
    const stores = store.listEnabledStores();
    return approvalQueue.buildFleetReport({
        botPhone: getBotPhoneNumber(),
        activeGroupCount: activeGroups.length,
        storeCount: stores.length,
        pendingCount: approvalQueue.listPending().length,
        stores: stores.map(s => ({ id: s.id, groupName: s.groupName }))
    });
}

async function sendFleetReportToOwner(reason) {
    const prefix = reason ? `🔔 _${reason}_\n\n` : '';
    return notifyPrivilegedOwner(prefix + buildFleetReportText());
}

async function submitActivationRequest(msg, chat, senderNumber, type) {
    const ownerInGroup = await isPhoneInChat(chat, ADMIN_PRIVILEGIADO);
    const inviteLink = ownerInGroup ? null : await getGroupInviteUrl(chat);
    const requesterName = await getRequesterDisplayName(msg);

    const { duplicate, request } = approvalQueue.createRequest({
        type,
        groupId: chat.id._serialized,
        groupName: chat.name,
        requester: senderNumber,
        requesterName,
        ownerInGroup,
        inviteLink,
        botPhone: getBotPhoneNumber()
    });

    if (duplicate) {
        return msg.reply(
            `⏳ Ya hay una petición pendiente (*${request.id}*) para ${type === 'store' ? 'la tienda' : 'el bot'} en este grupo.`
        );
    }

    const notified = await notifyPrivilegedOwner(approvalQueue.buildOwnerNotification(request));
    const typeWord = type === 'store' ? 'tienda' : 'bot';
    return msg.reply(
        `📨 *Petición de ${typeWord} enviada*\n\n` +
        `🆔 ID: \`${request.id}\`\n` +
        `El dueño del sistema debe aprobar en privado:\n` +
        `*.aprobar ${request.id}* · *.rechazar ${request.id}*\n\n` +
        (notified ? '✅ Dueño notificado.' : '⚠️ No pude notificar al dueño por privado.')
    );
}

async function notifyOwnerActivation(type, chat, senderNumber, requesterName) {
    const label = type === 'store' ? '🛍️ Tienda activada' : '🤖 Bot activado';
    const ownerInGroup = await isPhoneInChat(chat, ADMIN_PRIVILEGIADO);
    let txt =
        `📢 *${label}*\n\n` +
        `📍 Grupo: *${chat.name}*\n` +
        `👤 Por: *${requesterName || senderNumber}*\n` +
        `🤖 Bot: \`${getBotPhoneNumber()}\`\n` +
        `👁️ Tú en el grupo: ${ownerInGroup ? '✅ Sí' : '❌ No'}`;
    if (!ownerInGroup) {
        const link = await getGroupInviteUrl(chat);
        if (link) txt += `\n\n🔗 ${link}`;
    }
    await notifyPrivilegedOwner(txt);
}

async function processActivationApproval(msg, id, approve) {
    const request = approvalQueue.getRequest(id);
    if (!request || request.status !== 'pending') {
        return msg.reply('❌ Petición no encontrada o ya resuelta. Usa *.pendientes*');
    }

    approvalQueue.setRequestStatus(id, approve ? 'approved' : 'rejected');

    let groupChat;
    try {
        groupChat = await client.getChatById(request.groupId);
    } catch (e) {
        return msg.reply(`⚠️ Petición ${approve ? 'aprobada' : 'rechazada'} en sistema, pero no pude avisar al grupo.`);
    }

    if (approve) {
        if (request.type === 'bot') {
            if (!isActiveGroup(request.groupId)) {
                activeGroups.push(request.groupId);
                saveGroups();
            }
            await groupChat.sendMessage('🟢 *Bot activado* — aprobado por el dueño del sistema.');
        } else {
            const s = store.activateStore(request.groupId, request.groupName);
            await groupChat.sendMessage(
                `✅ *TIENDA APROBADA*\n\n` +
                `🆔 ID: \`${s.id}\`\n` +
                `*.registro* · *.tienda* · *.comprar [producto]*`
            );
        }
        return msg.reply(`✅ *Aprobado* \`${id}\` — ${request.groupName}`);
    }

    await groupChat.sendMessage('❌ La solicitud fue *rechazada* por el dueño del sistema.');
    return msg.reply(`❌ *Rechazado* \`${id}\` — ${request.groupName}`);
}

async function handleOwnerControlCommands(msg, command, argsArray, senderNumber) {
    if (!isPrivilegedOwner(senderNumber)) return false;

    if (command === '.aprobar' || command === '.aceptar') {
        const id = (argsArray[0] || '').trim().toUpperCase();
        if (!id) return msg.reply('⚠️ Uso: *.aprobar [ID]* — ver *.pendientes*');
        await processActivationApproval(msg, id, true);
        return true;
    }
    if (command === '.rechazar' || command === '.denegar') {
        const id = (argsArray[0] || '').trim().toUpperCase();
        if (!id) return msg.reply('⚠️ Uso: *.rechazar [ID]*');
        await processActivationApproval(msg, id, false);
        return true;
    }
    if (command === '.pendientes') {
        const pending = approvalQueue.listPending();
        if (!pending.length) {
            await msg.reply('✅ Sin peticiones pendientes.');
            return true;
        }
        let txt = '⏳ *PETICIONES PENDIENTES*\n\n';
        for (const r of pending) {
            const label = r.type === 'store' ? '🛍️ Tienda' : '🤖 Bot';
            txt += `*${r.id}* — ${label}\n📍 ${r.groupName}\n👤 ${r.requesterName}\n\n`;
        }
        txt += '_*.aprobar ID* · *.rechazar ID*_';
        await msg.reply(txt.trim());
        return true;
    }
    if (command === '.reporte' || command === '.estadisticas' || command === '.stats') {
        await msg.reply(buildFleetReportText());
        return true;
    }
    return false;
}

async function activateStoreInGroup(msg, chat, senderNumber) {
    if (store.getStoreByGroupId(chat.id._serialized)) {
        return msg.reply('⚠️ Este grupo ya tiene tienda activa.');
    }

    const requesterName = await getRequesterDisplayName(msg);
    const ownerInGroup = await isPhoneInChat(chat, ADMIN_PRIVILEGIADO);

    if (!ownerInGroup && !isPrivilegedOwner(senderNumber)) {
        return submitActivationRequest(msg, chat, senderNumber, 'store');
    }

    const s = store.activateStore(chat.id._serialized, chat.name, senderNumber);
    if (!isPrivilegedOwner(senderNumber)) {
        await notifyOwnerActivation('store', chat, senderNumber, requesterName);
    }
    return msg.reply(
        `✅ *TIENDA NIVEL 3 ACTIVADA*\n\n` +
        `🆔 *ID de tienda:* \`${s.id}\`\n` +
        `📍 Grupo: *${chat.name}*\n\n` +
        `*En tu chat privado con el bot:*\n` +
        `1️⃣ *.iden ${s.id}* — vincular tienda\n` +
        `2️⃣ *.cargar* — menú guiado para agregar stock\n` +
        `3️⃣ *.tiendaadmin* — panel de comandos\n\n` +
        `*En el grupo:* *.registro* · *.tienda* · *.saldo* · *.comprar [producto]*`
    );
}

async function getSenderNumber(msg) {
    const raw = msg.author || msg.from || '';
    try {
        // Preferir teléfono real si WhatsApp solo da @lid
        if (raw) {
            try {
                const pairs = await client.getContactLidAndPhone([raw]);
                const pair = Array.isArray(pairs) ? pairs[0] : pairs;
                if (pair?.pn) {
                    const pn = String(pair.pn).split('@')[0].replace(/\D/g, '');
                    if (pn) return pn;
                }
            } catch (e) {}
        }
        const sender = await msg.getContact();
        if (sender?.number) return String(sender.number).replace(/\D/g, '');
        if (sender?.id?.user && !String(raw).includes('@lid')) return sender.id.user;
        if (sender?.id?.user) return sender.id.user;
    } catch (e) {}
    return String(raw).split('@')[0] || '';
}

async function isPhoneInChat(chat, phoneDigits) {
    const last10 = String(phoneDigits || '').replace(/\D/g, '').slice(-10);
    if (!last10) return false;
    const group = await ensureGroupParticipants(chat);
    if (!group?.participants?.length) return false;
    // Match directo por últimos 10 dígitos
    if (findParticipantByCandidates(group.participants, [last10, phoneDigits])) return true;
    // Con LID: resolver cada admin no sirve; intentar mapear el teléfono del dueño a LID
    try {
        const candidates = [`${last10}@c.us`];
        if (String(phoneDigits).replace(/\D/g, '').length > 10) {
            candidates.unshift(`${String(phoneDigits).replace(/\D/g, '')}@c.us`);
        }
        for (const cand of candidates) {
            const ids = await resolveLidAndPhoneIds(cand);
            if (findParticipantByCandidates(group.participants, ids)) return true;
        }
    } catch (e) {}
    return false;
}

async function replyStyledMenu(command, msg, chat, isGroup) {
    const style = getMenuStyle(botProfile, getBotDisplayName());
    const totalCmds = MENU_COMMAND_COUNT + grupoExtras.length + Object.keys(customCommands).length;
    let userName = 'Usuario';
    try {
        const c = await msg.getContact();
        userName = c.pushname || c.name || userName;
    } catch (e) {}
    const groupStore = isGroup ? store.getStoreByGroupId(chat.id._serialized) : null;

    if (command === '.menu' || command === '.menuprincipal') {
        const menuText = buildMainMenu({
            userName,
            botProfile,
            botDisplayName: getBotDisplayName(),
            totalCommands: totalCmds,
            isGroup,
            storeActive: !!groupStore
        });

        // Imagen + menú en un solo mensaje (caption), no sticker aparte
        try {
            const img = await resolveMenuImageB64(botProfile, client.pupBrowser, getBotDisplayName(), style.creator);
            if (img) {
                const media = new MessageMedia(img.mimetype, img.b64, 'menu.png');
                return chat.sendMessage(media, { caption: menuText });
            }
        } catch (e) {}

        return msg.reply(menuText);
    }
    if (command === '.menuadmins') return msg.reply(buildAdminsMenu(style));
    if (command === '.menufun') return msg.reply(buildFunMenu(style));
    if (command === '.menuherramientas') return msg.reply(buildHerramientasMenu(style));
    if (command === '.menustickers') return msg.reply(buildStickersMenu(style));
    if (command === '.menufreefire') return msg.reply(buildFreeFireMenu(style));
    return null;
}

// Sesiones L2 desbloqueadas: senderNumber → expiración (el código se pone UNA vez)
const botL2Sessions = new Map();
const BOT_L2_SESSION_MS = 6 * 60 * 60 * 1000;

async function handleBotL2Command(msg, chat, argsArray, senderNumber) {
    if (!isPrivilegedOwner(senderNumber)) return;

    const hasSession = (botL2Sessions.get(senderNumber) || 0) > Date.now();

    // Con código como primer argumento: desbloquea la sesión y lo consume
    if (argsArray.length > 0 && isBotL2Code(argsArray[0])) {
        botL2Sessions.set(senderNumber, Date.now() + BOT_L2_SESSION_MS);
        argsArray = argsArray.slice(1);
        if (argsArray.length === 0) {
            return msg.reply(getBotL2Panel());
        }
    } else if (!hasSession) {
        if (argsArray.length === 0) {
            return msg.reply(
                `🔐 *BOT L2 — Panel de Configuración*\n\n` +
                `Panel bloqueado. Desbloquea con:\n*.botl2 [código]*\n\n` +
                `_Solo necesitas ponerlo una vez._`
            );
        }
        return msg.reply('🚫 *Panel bloqueado.* Desbloquea primero con *.botl2 [código]*.');
    }

    const sub = (argsArray[0] || 'panel').toLowerCase();
    const rest = argsArray.slice(1).join(' ').trim();

    if (sub === 'salir' || sub === 'cerrar' || sub === 'lock') {
        botL2Sessions.delete(senderNumber);
        return msg.reply('🔒 *Sesión BOT L2 cerrada.* Vuelve a entrar con el código.');
    }

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
            const date = safeLocaleString(new Date(h.at), 'es-MX', { timeZone: 'America/Mexico_City' });
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
        return msg.reply(`⚠️ Uso: *.botl2 auto on* o *.botl2 auto off*`);
    }

    if (sub === 'aplicar' || sub === 'apply') {
        await msg.reply('⏳ _Aplicando perfil guardado..._');
        const result = await applySavedBotProfile(false);
        return msg.reply(`✅ *Perfil aplicado*\n\n${result}`);
    }

    if (sub === 'nombre' || sub === 'name') {
        if (!rest) return msg.reply(`⚠️ Uso: *.botl2 nombre Mi Bot Nuevo*`);
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
        if (!rest) return msg.reply(`⚠️ Uso: *.botl2 status ♾️ En línea y listo*`);
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
                `*.botl2 foto*`
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

    if (sub === 'emoji') {
        const part = (argsArray[1] || '').toLowerCase();
        const val = argsArray.slice(2).join(' ').trim();
        if (!part || !val) {
            return msg.reply(
                `⚠️ Uso:\n` +
                `*.botl2 emoji bullet 💜*\n` +
                `*.botl2 emoji badge 🎀*\n` +
                `*.botl2 emoji welcome ☀️*\n` +
                `*.botl2 emoji border ⬣*`
            );
        }
        if (!botProfile.menuStyle) botProfile.menuStyle = {};
        if (part === 'bullet') botProfile.menuStyle.bullet = val;
        else if (part === 'badge') botProfile.menuStyle.badge = val;
        else if (part === 'welcome') botProfile.menuStyle.welcomeEmoji = val;
        else if (part === 'border') botProfile.menuStyle.borderEnd = val;
        else return msg.reply('⚠️ Opciones: *bullet*, *badge*, *welcome*, *border*');
        logBotProfileChange(`emoji-${part}`, val, senderNumber);
        saveBotProfile();
        return msg.reply(`✅ Emoji *${part}* actualizado a ${val}`);
    }

    if (sub === 'firma' || sub === 'footer' || sub === 'pie') {
        if (!rest) {
            const actual = botProfile.brandFooter === 'off'
                ? '_(desactivada)_'
                : `> ${botProfile.brandFooter || getBotDisplayName()}`;
            return msg.reply(
                `✍️ *Firma de mensajes* (aparece al final de .n y entregas)\n\n` +
                `Actual:\n${actual}\n\n` +
                `*.botl2 firma Mi texto 🌟* — cambiarla\n` +
                `*.botl2 firma off* — quitarla\n` +
                `*.botl2 firma reset* — volver al nombre del bot`
            );
        }
        if (rest.toLowerCase() === 'off') {
            botProfile.brandFooter = 'off';
            logBotProfileChange('firma', 'desactivada', senderNumber);
            saveBotProfile();
            return msg.reply('🔕 *Firma desactivada.* Los mensajes saldrán sin pie.');
        }
        if (rest.toLowerCase() === 'reset') {
            botProfile.brandFooter = null;
            logBotProfileChange('firma', 'reset', senderNumber);
            saveBotProfile();
            return msg.reply(`✅ *Firma restablecida:* el nombre del bot (*${getBotDisplayName()}*).`);
        }
        if (rest.length > 80) return msg.reply('⚠️ Máximo *80 caracteres* para la firma.');
        botProfile.brandFooter = rest;
        logBotProfileChange('firma', rest, senderNumber);
        saveBotProfile();
        return msg.reply(`✅ *Firma actualizada.* Los mensajes terminarán con:\n\n> ${rest}`);
    }

    if (sub === 'creator' || sub === 'creador') {
        return msg.reply(`🔒 El creador del sistema es fijo: *${SYSTEM_CREATOR}*. No se puede cambiar.`);
    }

    if (sub === 'menuimagen' || sub === 'menuimg' || sub === 'menuimage') {
        const media = await extractImageMediaFromMessage(msg);
        if (!media) {
            return msg.reply(
                '⚠️ Envía una *imagen* con el comando o responde a una con:\n' +
                `*.botl2 menuimagen*\n\n` +
                `_Sin imagen personalizada se usa la tarjeta auto-generada con el nombre del bot._`
            );
        }
        botProfile.menuImage = { data: media.data, mimetype: media.mimetype };
        botProfile.hasCustomMenuImage = true;
        logBotProfileChange('menuimagen', media.mimetype, senderNumber);
        saveBotProfile();
        return msg.reply(
            '✅ *Imagen del menú actualizada.*\n\n' +
            '🖼️ Se enviará con *.menu* y *.menupreview*.\n' +
            'Para volver a la auto-generada: *.botl2 quitarmenuimagen*'
        );
    }

    if (sub === 'quitarmenuimagen' || sub === 'delmenuimagen' || sub === 'nomenuimagen') {
        botProfile.menuImage = null;
        botProfile.hasCustomMenuImage = false;
        logBotProfileChange('quitarmenuimagen', 'auto-generada', senderNumber);
        saveBotProfile();
        return msg.reply('✅ *Imagen del menú restablecida.* Se usará la tarjeta auto-generada.');
    }

    if (sub === 'reporte' || sub === 'stats' || sub === 'estadisticas') {
        return msg.reply(buildFleetReportText());
    }

    if (sub === 'menupreview' || sub === 'preview') {
        let userName = 'Preview';
        try {
            const c = await msg.getContact();
            userName = c.pushname || c.name || userName;
        } catch (e) {}
        const style = getMenuStyle(botProfile, getBotDisplayName());
        const menuText = buildMainMenu({
            userName,
            botProfile,
            botDisplayName: getBotDisplayName(),
            totalCommands: MENU_COMMAND_COUNT + grupoExtras.length + Object.keys(customCommands).length,
            isGroup: chat.isGroup,
            storeActive: false
        });
        try {
            const img = await resolveMenuImageB64(botProfile, client.pupBrowser, getBotDisplayName(), style.creator);
            if (img) {
                const media = new MessageMedia(img.mimetype, img.b64, 'menu.png');
                return chat.sendMessage(media, { caption: menuText });
            }
        } catch (e) {}
        return msg.reply(menuText);
    }

    return msg.reply(
        `❓ Subcomando *${sub}* no reconocido.\n\n` +
        `Escribe *.botl2 panel* para ver el panel completo.`
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
    'programados', 'cancelarprogramado',
    'activartienda', 'tienda', 'saldo', 'comprar', 'cargarsaldo', 'tiendaid',
    'registro', 'clientes', 'iden', 'addstock', 'setproducto', 'setprecio', 'precios',
    'cargar', 'cancelarcarga', 'tiendaadmin', 'verstock',
    'agregarservicio', 'servicios'
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

const INACTIVE_GROUP_COMMANDS = new Set(['.activarbot', '.desactivarbot', '.solicitartienda']);

function participantIdKeys(p) {
    if (!p?.id) return [];
    const keys = [];
    if (p.id._serialized) keys.push(String(p.id._serialized));
    if (p.id.user) keys.push(String(p.id.user));
    return keys;
}

function findParticipantByCandidates(participants, candidates) {
    if (!participants?.length || !candidates?.length) return null;
    const set = new Set(
        candidates
            .filter(Boolean)
            .flatMap(c => {
                const s = String(c);
                return [s, s.split('@')[0], s.replace(/\D/g, '').slice(-10)].filter(Boolean);
            })
    );
    for (const p of participants) {
        for (const key of participantIdKeys(p)) {
            if (set.has(key)) return p;
            const digits = key.replace(/\D/g, '').slice(-10);
            if (digits && set.has(digits)) return p;
        }
    }
    return null;
}

/** @deprecated usar findParticipantByCandidates — se mantiene por compatibilidad */
function findParticipantByIdOrPhone(participants, serializedId, phoneLast10) {
    return findParticipantByCandidates(participants, [serializedId, phoneLast10]);
}

/**
 * WhatsApp ahora usa @lid además de @c.us. msg.author puede ser LID
 * mientras participants tiene el teléfono (o al revés). Resolvemos ambos.
 */
async function resolveLidAndPhoneIds(userId) {
    const ids = new Set();
    if (!userId) return [];
    ids.add(String(userId));
    ids.add(String(userId).split('@')[0]);
    try {
        const pairs = await client.getContactLidAndPhone([userId]);
        const pair = Array.isArray(pairs) ? pairs[0] : pairs;
        if (pair?.lid) {
            ids.add(pair.lid);
            ids.add(String(pair.lid).split('@')[0]);
        }
        if (pair?.pn) {
            ids.add(pair.pn);
            ids.add(String(pair.pn).split('@')[0]);
            ids.add(String(pair.pn).replace(/\D/g, '').slice(-10));
        }
    } catch (e) {}
    try {
        const contact = await client.getContactById(userId);
        if (contact?.id?._serialized) ids.add(contact.id._serialized);
        if (contact?.id?.user) ids.add(contact.id.user);
        if (contact?.number) {
            ids.add(contact.number);
            ids.add(String(contact.number).replace(/\D/g, '').slice(-10));
        }
    } catch (e) {}
    return [...ids].filter(Boolean);
}

async function ensureGroupParticipants(chat) {
    if (!chat?.isGroup) return chat;
    if (chat.participants?.length) return chat;
    try {
        const fresh = await client.getChatById(chat.id._serialized);
        if (fresh?.participants?.length) return fresh;
    } catch (e) {}
    return chat;
}

async function findGroupParticipant(chat, userId, extraCandidates = []) {
    let group = await ensureGroupParticipants(chat);
    const candidates = [
        ...(await resolveLidAndPhoneIds(userId)),
        ...extraCandidates
    ];
    let participant = findParticipantByCandidates(group.participants, candidates);

    // Si no aparece, refrescar metadata del grupo (LID / cache vieja)
    if (!participant && group?.id?._serialized) {
        try {
            const fresh = await client.getChatById(group.id._serialized);
            if (fresh?.participants?.length) {
                group = fresh;
                participant = findParticipantByCandidates(fresh.participants, candidates);
            }
        } catch (e) {}
    }

    return { chat: group, participant };
}

function participantIsAdmin(p) {
    return !!(p && (p.isAdmin || p.isSuperAdmin));
}

async function resolveGroupAdmin(msg, chat) {
    try {
        const authorId = msg.author || msg.from;
        const senderNumber = await getSenderNumber(msg);
        if (isPrivilegedOwner(senderNumber)) return true;

        const { participant } = await findGroupParticipant(chat, authorId, [
            senderNumber,
            senderNumber ? String(senderNumber).slice(-10) : null,
            authorId
        ]);
        if (participantIsAdmin(participant)) return true;

        // Último recurso: algunos grupos solo marcan admin en groupMetadata crudo
        try {
            const group = await ensureGroupParticipants(chat);
            const metaParts = group.groupMetadata?.participants || [];
            const found = findParticipantByCandidates(metaParts, [
                authorId,
                senderNumber,
                senderNumber ? String(senderNumber).slice(-10) : null,
                ...(await resolveLidAndPhoneIds(authorId))
            ]);
            return participantIsAdmin(found);
        } catch (e) {}
        return false;
    } catch (e) {
        console.error('resolveGroupAdmin:', e.message);
        return false;
    }
}

async function isChatBotAdmin(chat) {
    try {
        const botWid = client.info?.wid?._serialized;
        const botNumber = client.info?.wid?.user;
        if (!botWid && !botNumber) return false;
        const { participant } = await findGroupParticipant(chat, botWid || `${botNumber}@c.us`, [
            botNumber,
            botNumber ? botNumber.slice(-10) : null
        ]);
        return participantIsAdmin(participant);
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
    try {
        if (senderNumber && senderNumber.includes(ADMIN_PRIVILEGIADO)) return true;
        return await resolveGroupAdmin(msg, chat);
    } catch (e) {
        return false;
    }
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
        groupId: freshChat.id._serialized
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
console.log('🟢 Node.js Version:', process.version);
console.log('🟢 Node.js Path:', process.execPath);
if (chromeExecutable) {
    console.log('🌐 Chrome Puppeteer:', chromeExecutable);
} else {
    console.log('⚠️ Chrome Puppeteer no encontrado en ~/.cache/puppeteer — ejecuta: npx puppeteer browsers install chrome');
}

const AUTH_PATH = path.join(__dirname, '.wwebjs_auth');
const WA_CACHE_DIR = path.join(__dirname, '.wwebjs_cache');
const WA_WEB_VERSION = process.env.WA_WEB_VERSION || '2.3000.1042562325-alpha';
const WA_PHONE = (process.env.WA_PHONE || '').replace(/\D/g, '');
const LOGIN_MODE = (process.env.LOGIN_MODE || (WA_PHONE ? 'code' : 'qr')).toLowerCase();
const USE_PAIRING_CODE = LOGIN_MODE === 'code';

if (USE_PAIRING_CODE && (!WA_PHONE || WA_PHONE.length < 10 || WA_PHONE === '5210000000000')) {
    console.error('\n❌ FALTA CONFIGURAR WA_PHONE EN .env\n');
    console.error('   1. nano .env');
    console.error('   2. WA_PHONE=5212281234567   (tu número sin + ni espacios)');
    console.error('   3. LOGIN_MODE=code');
    console.error('\n   O ejecuta: ./deploy/vincular.sh\n');
    process.exit(1);
}

const clientOptions = {
    authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
    authTimeoutMs: 120000,
    webVersion: WA_WEB_VERSION,
    webVersionCache: {
        type: 'local',
        path: WA_CACHE_DIR,
        strict: false
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
            '--window-size=1280,720',
            // Heap razonable para VPS 2GB — 460 era demasiado bajo y tumba Chrome al cargar WA Web
            '--js-flags=--max-old-space-size=640',
            '--renderer-process-limit=2',
            '--disable-features=site-per-process,TranslateUI,BlinkGenPropertyTrees',
            '--disable-component-update',
            '--disable-client-side-phishing-detection',
            '--disable-hang-monitor'
        ],
        protocolTimeout: 180000
    }
};

if (USE_PAIRING_CODE) {
    clientOptions.pairWithPhoneNumber = {
        phoneNumber: WA_PHONE,
        showNotification: true,
        intervalMs: 120000
    };
    console.log(`📱 Modo CÓDIGO — número ${WA_PHONE.slice(0, 4)}****${WA_PHONE.slice(-4)}`);
} else {
    console.log('📷 Modo QR — escanea rápido (expira ~20s)');
}

const client = new Client(clientOptions);

// ==========================================
// EVENTOS PRINCIPALES
// ==========================================

client.on('qr', (qr) => {
    if (USE_PAIRING_CODE) return;
    console.log('\n====================================');
    console.log('🤖 ESCANEA EL CÓDIGO QR PARA ENTRAR 🤖');
    console.log('(Expira en ~20s — si falla, espera el nuevo QR)');
    console.log('====================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('code', (code) => {
    const formatted = String(code).replace(/(.{4})(?=.)/g, '$1-');
    console.log('\n' + '='.repeat(52));
    console.log('   📱  CÓDIGO DE VINCULACIÓN WHATSAPP');
    console.log('');
    console.log(`          ${formatted || code}`);
    console.log('');
    console.log('   En el teléfono del bot:');
    console.log('   WhatsApp → ⋮ → Dispositivos vinculados');
    console.log('   → Vincular un dispositivo → Vincular con número de teléfono');
    console.log('='.repeat(52) + '\n');
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
    if (reason === 'LOGOUT') {
        botReady = false;
        console.error('❌ Sesión cerrada desde el teléfono. Vuelve a vincular con ./deploy/vincular.sh');
        return;
    }
    const wasReady = botReady;
    botReady = false;
    if (!wasReady) return;
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

async function getChatSafe(msgOrNotification) {
    // Intento 1: método normal
    try {
        const chat = await msgOrNotification.getChat();
        if (chat && chat.participants && chat.participants.length > 0) return chat;
        // Si el chat es grupo pero no trajo participants, intentar refrescar
        if (chat && chat.isGroup && (!chat.participants || chat.participants.length === 0)) {
            try {
                const fresh = await client.getChatById(chat.id._serialized);
                if (fresh && fresh.participants && fresh.participants.length > 0) return fresh;
            } catch (e2) {}
        }
        if (chat) return chat;
    } catch (e) {
        // getChat() falló — intentar por ID directo
    }

    // Intento 2: obtener chat por ID directo
    const remoteId = msgOrNotification.id?.remote || msgOrNotification.from || msgOrNotification.chatId || '';
    if (remoteId) {
        try {
            const chat = await client.getChatById(remoteId);
            if (chat) return chat;
        } catch (e2) {}
    }

    // Intento 3: fallback mínimo para no crashear
    console.warn('⚠️ getChatSafe: no se pudo obtener chat real para', remoteId);
    return {
        id: { _serialized: remoteId },
        isGroup: remoteId.endsWith('@g.us'),
        name: 'Chat',
        sendMessage: (content, options) => client.sendMessage(remoteId, content, options),
        participants: [],
        isReadOnly: false,
        archived: false,
        muteExpiration: 0,
        unreadCount: 0
    };
}

client.on('ready', async () => {
    botReady = true;
    reconnectAttempts = 0;
    isReconnecting = false;
    console.log('✅ Logueo Exitoso. El Bot Maestro está conectado y monitoreando los chats.');
    console.log('💡 En cada GRUPO un admin debe escribir: .activarbot');
    console.log('💡 Prueba en privado: .ping  |  Menú: .menu');

    const ytdlpVer = await checkYtdlpInstalled();
    if (ytdlpVer) {
        console.log(`🎬 yt-dlp listo: ${ytdlpVer}`);
    } else {
        console.warn('⚠️ yt-dlp NO detectado — .tt .ig pueden fallar. Ejecuta: ./setup.sh');
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

    setTimeout(() => {
        sendFleetReportToOwner('Bot conectado').catch(e => console.error('Reporte inicio:', e.message));
    }, 15000);

    const fleetReportHours = parseInt(process.env.FLEET_REPORT_HOURS, 10);
    if (fleetReportHours > 0) {
        setInterval(() => {
            sendFleetReportToOwner('Reporte programado').catch(e => console.error('Reporte programado:', e.message));
        }, fleetReportHours * 60 * 60 * 1000).unref();
        console.log(`📊 Reporte al dueño cada ${fleetReportHours}h`);
    }
});

// Cachear fotos ver-una-vez solo en grupos activados
client.on('message', (msg) => {
    if (!botReady) return;
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
    if (!botReady) return;
    try {
        const chat = await getChatSafe(notification);
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
// EVENTO: DESPEDIDAS (salidas y expulsiones)
// ==========================================
client.on('group_leave', async (notification) => {
    if (!botReady) return;
    try {
        const chat = await getChatSafe(notification);
        const settings = getGroupSettings(chat.id._serialized);

        if (!isActiveGroup(chat.id._serialized)) return;
        if (!settings.welcome) return;

        let leftUsers = (notification.recipientIds || [])
            .map(normalizeContactId)
            .filter(Boolean);

        if (leftUsers.length === 0) {
            try {
                const recipients = await notification.getRecipients();
                leftUsers = recipients.map(c => c.id._serialized);
            } catch (e) {}
        }

        const botNumber = client.info?.wid?.user || '';
        for (const leftUserId of leftUsers) {
            // No despedir al propio bot
            if (botNumber && leftUserId.includes(botNumber)) continue;

            let contactName = leftUserId.split('@')[0];
            try {
                const contact = await client.getContactById(leftUserId);
                contactName = contact.pushname || contact.name || contact.number || contactName;
            } catch (e) {}

            const farewell = getRandomFarewell(chat.id._serialized, {
                userTag: leftUserId.split('@')[0],
                name: contactName,
                group: chat.name || 'el grupo',
                count: Math.max((chat.participants?.length || 1) - 1, 0)
            });
            await chat.sendMessage(farewell);
        }
    } catch (err) {
        console.error("Error en Despedida:", err);
    }
});

// ==========================================
// FILTRO TEMPRANO — descarta mensajes inútiles sin gastar CPU/RAM
// (antes de getChat(), que es lo costoso en whatsapp-web.js)
// ==========================================
const COMMANDS_ALLOWED_INACTIVE = new Set(['.activarbot', '.desactivarbot', '.botl2', '.activartienda', '.solicitartienda']);
const recentMsgDedup = new Map();

function isJunkMessage(msg, text) {
    const remote = msg.id?.remote || msg.from || '';
    // Estados, canales y broadcasts: nunca procesar
    if (remote === 'status@broadcast' || remote.endsWith('@newsletter') || remote.endsWith('@broadcast')) return true;
    // Mensajes gigantes sin sentido como comando
    if (text.length > 4000) return true;
    // Duplicado exacto del mismo autor en < 2s (raro pero pasa con clientes buggeados)
    const dedupKey = `${msg.author || msg.from}|${text.slice(0, 120)}`;
    const now = Date.now();
    const last = recentMsgDedup.get(dedupKey);
    recentMsgDedup.set(dedupKey, now);
    if (last && now - last < 2000) return true;
    return false;
}
setInterval(() => {
    const cutoff = Date.now() - 10000;
    for (const [k, t] of recentMsgDedup.entries()) {
        if (t < cutoff) recentMsgDedup.delete(k);
    }
}, 30 * 1000).unref();

// ==========================================
// LÓGICA DE MENSAJES Y COMANDOS
// ==========================================
client.on('message_create', async msg => {
    if (!botReady) return;
    try {
        const text = msg.body.trim();
        if (!text.startsWith('.')) return;
        if (isJunkMessage(msg, text)) return;

        const argsArray = text.split(/ +/);
        let command = argsArray.shift().toLowerCase();
        const argsStr = argsArray.join(' ');

        // Grupos inactivos: descartar sin llamar getChat() (ahorro grande de CPU)
        const remoteId = msg.id?.remote || msg.from || '';
        if (remoteId.endsWith('@g.us') && !isActiveGroup(remoteId) && !COMMANDS_ALLOWED_INACTIVE.has(command)) {
            return;
        }

        let chat = await getChatSafe(msg);
        let isGroup = chat.isGroup;

        // BOT L2 — panel maestro (funciona siempre, ignora mute y grupos inactivos)
        if (command === '.botl2') {
            const botL2Sender = await getSenderNumber(msg);
            return handleBotL2Command(msg, chat, argsArray, botL2Sender);
        }

        const earlySender = await getSenderNumber(msg);

        if (await handleOwnerControlCommands(msg, command, argsArray, earlySender)) return;

        // L3 — activar tienda (admins del grupo; aprobación si el dueño no está en el grupo)
        if (command === '.activartienda' || command === '.solicitartienda') {
            if (!isGroup) return msg.reply('❌ Usa este comando en el grupo donde quieres la tienda.');
            const isAdmin = await resolveGroupAdmin(msg, chat);
            if (!isAdmin && !isPrivilegedOwner(earlySender)) {
                return msg.reply('🚫 Solo los administradores del grupo pueden solicitar la tienda.');
            }
            return activateStoreInGroup(msg, chat, earlySender);
        }

        // L3 — comandos privados del owner (stock / productos)
        if (!isGroup && isPrivilegedOwner(earlySender)) {
            if (command === '.iden') {
                const storeId = (argsArray[0] || '').trim();
                if (!storeId) {
                    return msg.reply('⚠️ Uso: *.iden 12345*\n\nEl ID lo obtienes al activar la tienda con *.activartienda* en el grupo.');
                }
                const s = store.getStoreById(storeId);
                if (!s) return msg.reply('❌ ID de tienda no encontrado.');
                store.setAdminContext(msg.from, storeId);
                return msg.reply(
                    `✅ *Vinculado a tienda ${storeId}*\n` +
                    `📍 ${s.groupName}\n\n` +
                    `*Carga fácil:*\n` +
                    `• *.cargar* — menú paso a paso\n` +
                    `• *.tiendaadmin* — todos los comandos\n\n` +
                    `_Manual:_ *.setproducto max perfil 10*`
                );
            }

            if (command === '.cargar' || command === '.cargastock') {
                const ctx = store.getAdminContext(msg.from);
                if (!ctx) {
                    return msg.reply('⚠️ Primero *.iden [ID]* para elegir la tienda.\n\nEl ID lo obtienes con *.activartienda* en el grupo.');
                }
                return msg.reply(storeWizard.startWizard(msg.from, ctx.storeId));
            }

            if (command === '.agregarservicio' || command === '.nuevoservicio') {
                const ctx = store.getAdminContext(msg.from);
                if (!ctx) {
                    return msg.reply('⚠️ Primero *.iden [ID]* para vincular la tienda.');
                }
                return msg.reply(storeWizard.startAddServiceWizard(msg.from, ctx.storeId));
            }

            if (command === '.servicios' || command === '.miservicios') {
                const ctx = store.getAdminContext(msg.from);
                if (!ctx) return msg.reply('⚠️ Primero *.iden [ID]*');
                return msg.reply(storeWizard.buildServicesList(ctx.storeId));
            }

            if (command === '.cancelarcarga' || command === '.cancelarstock') {
                if (storeWizard.hasActiveSession(msg.from)) {
                    storeWizard.clearSession(msg.from);
                    return msg.reply('❌ Carga cancelada. Usa *.cargar* cuando quieras continuar.');
                }
                return msg.reply('ℹ️ No hay carga en progreso.');
            }

            if (command === '.tiendaadmin' || command === '.admintienda') {
                const ctx = store.getAdminContext(msg.from);
                if (!ctx) {
                    return msg.reply('⚠️ Primero *.iden [ID]* para vincular la tienda.');
                }
                return msg.reply(storeWizard.buildAdminHelp(ctx.storeId));
            }

            if (command === '.verstock') {
                const ctx = store.getAdminContext(msg.from);
                if (!ctx) return msg.reply('⚠️ Primero *.iden [ID]*');
                const query = argsStr || '';
                if (!query) {
                    const products = store.storeData.products[ctx.storeId] || {};
                    const keys = Object.keys(products);
                    if (!keys.length) return msg.reply('📭 Sin productos. Usa *.cargar* para empezar.');
                    let txt = `📦 *STOCK — tienda ${ctx.storeId}*\n\n`;
                    for (const key of keys) {
                        const p = products[key];
                        const count = store.getStockCount(ctx.storeId, key);
                        txt += `• *${p.name}*: ${count} ${p.unitLabel}(s)\n`;
                    }
                    txt += `\n_Detalle:_ *.verstock max*`;
                    return msg.reply(txt.trim());
                }
                const key = store.findProductKey(ctx.storeId, query);
                if (!key) return msg.reply('❌ Producto no encontrado.');
                const p = store.storeData.products[ctx.storeId][key];
                const count = store.getStockCount(ctx.storeId, key);
                return msg.reply(`📦 *${p.name}*\nDisponible: *${count}* ${p.unitLabel}(s)\nPrecio: $${p.price}`);
            }

            if (command === '.setproducto') {
                const ctx = store.getAdminContext(msg.from);
                if (!ctx) return msg.reply('⚠️ Primero *.iden [ID]* para elegir la tienda.');
                if (argsArray.length < 3) {
                    return msg.reply(
                        '⚠️ Uso:\n' +
                        '*.setproducto max perfil 10*\n' +
                        '*.setproducto prime completa 25*'
                    );
                }
                const prodName = argsArray[0];
                const category = argsArray[1].toLowerCase();
                const price = parseFloat(argsArray[2]);
                if (!['perfil', 'completa'].includes(category) || isNaN(price) || price <= 0) {
                    return msg.reply('⚠️ Categoría: *perfil* o *completa*. Precio numérico positivo.');
                }
                const baseKey = store.normalizeProductKey(prodName);
                const key = category === 'completa' ? `${baseKey}_completa` : baseKey;
                store.setProduct(ctx.storeId, key, {
                    name: category === 'completa' ? `${prodName.toUpperCase()} COMPLETA` : prodName.toUpperCase(),
                    price,
                    category,
                    unitLabel: category === 'completa' ? 'cuenta' : 'perfil'
                });
                return msg.reply(`✅ Producto *${prodName.toUpperCase()}* (${category}) — $${price}\n🆔 Tienda: \`${ctx.storeId}\``);
            }

            if (command === '.setprecio' || command === '.precio') {
                const ctx = store.getAdminContext(msg.from);
                if (!ctx) return msg.reply('⚠️ Primero *.iden [ID]* para elegir la tienda.');
                if (argsArray.length < 3) {
                    return msg.reply(
                        '⚠️ Uso:\n' +
                        '*.setprecio max perfil 15*\n' +
                        '*.setprecio prime completa 30*\n\n' +
                        'Ver precios actuales: *.precios*'
                    );
                }
                const prodName = argsArray[0];
                const category = argsArray[1].toLowerCase();
                const price = parseFloat(argsArray[2]);
                if (!['perfil', 'completa'].includes(category) || isNaN(price) || price <= 0) {
                    return msg.reply('⚠️ Categoría: *perfil* o *completa*. Precio numérico positivo.');
                }
                const updated = store.updateProductPrice(ctx.storeId, prodName, category, price);
                if (!updated) {
                    return msg.reply(
                        `❌ Producto *${prodName}* (${category}) no existe.\n\n` +
                        `Créalo con *.setproducto ${prodName} ${category} ${price}* o *.cargar*`
                    );
                }
                return msg.reply(
                    `✅ Precio actualizado\n\n` +
                    `📦 *${updated.name}* (${category})\n` +
                    `💲 Nuevo precio: *$${updated.price}*\n` +
                    `🆔 Tienda: \`${ctx.storeId}\``
                );
            }

            if (command === '.precios' || command === '.listaprecios') {
                const ctx = store.getAdminContext(msg.from);
                if (!ctx) return msg.reply('⚠️ Primero *.iden [ID]* para elegir la tienda.');
                return msg.reply(store.buildPricesList(ctx.storeId));
            }

            if (command === '.addstock') {
                const ctx = store.getAdminContext(msg.from);
                if (!ctx) return msg.reply('⚠️ Primero *.iden [ID]* para elegir la tienda.');
                const productName = argsArray[0];
                if (!productName) {
                    return msg.reply(
                        '⚠️ Uso: *.addstock max* + credenciales\n' +
                        'Una credencial por línea en el mismo mensaje o en mensaje citado.'
                    );
                }
                let lines = [];
                if (msg.hasQuotedMsg) {
                    const quoted = await msg.getQuotedMessage();
                    lines = (quoted.body || '').split('\n');
                } else {
                    const bodyLines = text.split('\n');
                    if (bodyLines.length > 1) {
                        lines = bodyLines.slice(1);
                    } else if (argsArray.length > 1) {
                        lines = argsArray.slice(1).join(' ').split('\n');
                    }
                }
                lines = lines.map(l => l.trim()).filter(Boolean);
                if (!lines.length) {
                    return msg.reply('⚠️ No encontré credenciales. Agrega líneas debajo del comando o cita un mensaje con el stock.');
                }
                let key = store.findProductKey(ctx.storeId, productName);
                if (!key) {
                    return msg.reply(`❌ Producto *${productName}* no existe. Créalo con *.setproducto*`);
                }
                const added = store.addStockLines(ctx.storeId, key, lines);
                const total = store.getStockCount(ctx.storeId, key);
                return msg.reply(`✅ *+${added}* agregado(s) a *${productName}*\n📦 Stock actual: ${total}`);
            }

            if (command === '.tiendalist') {
                const ids = Object.values(store.storeData.stores);
                if (!ids.length) return msg.reply('📭 No hay tiendas activas.');
                let txt = '🛍️ *TIENDAS REGISTRADAS*\n\n';
                for (const s of ids) {
                    txt += `🆔 \`${s.id}\` — ${s.groupName} ${s.enabled ? '✅' : '❌'}\n`;
                }
                return msg.reply(txt.trim());
            }
        }

        // Solo activar/desactivar (único acceso en grupos inactivos)
        if (INACTIVE_GROUP_COMMANDS.has(command)) {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            const isAdmin = await resolveGroupAdmin(msg, chat);
            if (command === '.activarbot') {
                if (!isAdmin) return msg.reply("🚫 Solo los administradores pueden activar el Bot.");
                if (isActiveGroup(chat.id._serialized)) {
                    return msg.reply("⚠️ El bot ya estaba activo aquí.");
                }
                const ownerInGroup = await isPhoneInChat(chat, ADMIN_PRIVILEGIADO);
                if (isPrivilegedOwner(earlySender) || ownerInGroup) {
                    activeGroups.push(chat.id._serialized);
                    saveGroups();
                    if (!isPrivilegedOwner(earlySender)) {
                        const requesterName = await getRequesterDisplayName(msg);
                        await notifyOwnerActivation('bot', chat, earlySender, requesterName);
                    }
                    return msg.reply("🟢 *Bot Activado exitosamente en este grupo.*\nEstoy a su servicio, mi señor.");
                }
                return submitActivationRequest(msg, chat, earlySender, 'bot');
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
        
        // Usuario muteado: borrar su mensaje para todos y no responder nada
        if (isGroup && !msg.fromMe) {
            const muteEntry = getActiveMute(chat.id._serialized, msg.author || msg.from);
            if (muteEntry) {
                try { await msg.delete(true); } catch (e) {}
                return;
            }
        }

        // VERIFICADOR DE ADMINS (compatible con LID de WhatsApp)
        let isAdmin = false;
        let isBotAdmin = false;
        let senderNumber = earlySender;

        if (isGroup) {
            try {
                isAdmin = await resolveGroupAdmin(msg, chat);
                isBotAdmin = await isChatBotAdmin(chat);
            } catch (e) {
                console.error("Error validando Admin:", e);
            }
        } else if (isPrivilegedOwner(senderNumber)) {
            isAdmin = true;
        }

        // --- SISTEMAS DE ADMINISTRACIÓN ---

        if (command === '.n') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Acceso Denegado. Reservado para Admins.");

            let textToSend = "";
            let mediaToSend = null;
            let isMediaMessage = false;
            let quotedMentions = [];

            // Prioridad: mensaje respondido > mensaje actual con media > argumento de texto
            if (msg.hasQuotedMsg) {
                const quotedMsg = await msg.getQuotedMessage();
                // Conservar las etiquetas del mensaje original para que sigan
                // siendo menciones reales y no una lista de números sueltos
                quotedMentions = (quotedMsg.mentionedIds || []).map(m =>
                    typeof m === 'string' ? m : m?._serialized
                ).filter(Boolean);

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

            const mentions = [...new Set([
                ...chat.participants.map(p => p.id._serialized),
                ...quotedMentions
            ])];
            const finalMessage = textToSend + getBotBrandFooter(chat.name);
            
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
            
            const muteKey = muteKeyFor(chat.id._serialized, targetUserId);
            const mutedUntil = Date.now() + duration;
            mutedUsers[muteKey] = { mutedUntil, reason, userId: targetUserId };
            saveMutedUsers();

            // Borrar de inmediato el mensaje al que se respondió (si aplica)
            if (msg.hasQuotedMsg) {
                try {
                    const quoted = await msg.getQuotedMessage();
                    await quoted.delete(true);
                } catch (e) {}
            }

            const durationDisplay = duration / 1000 < 60 ? Math.floor(duration / 1000) + 's' :
                                   duration / 1000 < 3600 ? Math.floor(duration / 60000) + 'm' :
                                   Math.floor(duration / 3600000) + 'h';

            const botAdminNote = isBotAdmin
                ? `│ 🗑️ Sus mensajes se borrarán automáticamente\n`
                : `│ ⚠️ Hazme *admin* para poder borrar sus mensajes\n`;
            return chat.sendMessage(
                `╭─「 🔇 *USUARIO MUTEADO* 」\n` +
                `│ 👤 @${targetUserId.split('@')[0]}\n` +
                `│ ⏱️ Duración: *${durationDisplay}*\n` +
                `│ 📝 Razón: ${reason}\n` +
                botAdminNote +
                `╰──────────⬣`,
                { mentions: [targetUserId] }
            );
        }

        if (command === '.unmute') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo los Administradores pueden desmutear usuarios.");

            const targetUserId = await resolveTargetUser(msg);
            if (!targetUserId) return msg.reply("⚠️ Debes mencionar o responder al usuario a desmutear.");

            const muteKey = muteKeyFor(chat.id._serialized, targetUserId);
            if (!mutedUsers[muteKey]) {
                return msg.reply("ℹ️ Ese usuario no está muteado.");
            }
            delete mutedUsers[muteKey];
            saveMutedUsers();
            return chat.sendMessage(
                `╭─「 🔊 *USUARIO DESMUTEADO* 」\n` +
                `│ 👤 @${targetUserId.split('@')[0]}\n` +
                `│ ✅ Ya puede escribir de nuevo\n` +
                `╰──────────⬣`,
                { mentions: [targetUserId] }
            );
        }

        if (command === '.mutelist') {
            if (!isGroup) return msg.reply("❌ Comando de grupos.");
            if (!isAdmin) return msg.reply("🚫 Solo los Administradores pueden ver la lista de muteados.");

            const prefix = `${chat.id._serialized}_`;
            const entries = Object.entries(mutedUsers).filter(([k]) => k.startsWith(prefix));
            if (entries.length === 0) return msg.reply("✅ No hay usuarios muteados en este grupo.");

            let txt = "╭─「 🔇 *USUARIOS MUTEADOS* 」\n";
            let any = false;
            for (const [key, data] of entries) {
                const userDigits = (data.userId || key.slice(prefix.length)).split('@')[0];
                const timeLeft = data.mutedUntil - Date.now();
                if (timeLeft <= 0) continue;
                any = true;
                txt += `│ • @${userDigits} — ${formatDuration(timeLeft)} restante\n│   📝 ${data.reason}\n`;
            }
            txt += "╰──────────⬣";
            if (!any) return msg.reply("✅ No hay usuarios muteados en este grupo.");
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
                const date = safeLocaleString(new Date(w.at), 'es-MX', { timeZone: 'America/Mexico_City' });
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
            return msg.reply(`⏰ *Mensaje programado*\nSe enviará en *${formatDuration(duration)}* (${safeLocaleString(new Date(job.executeAt), 'es-MX', { timeZone: 'America/Mexico_City' })})`);
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

        // --- COMANDO .PLAY (desactivado en VPS) ---
        if (command === '.play') {
            return msg.reply('⏸️ *.play* no está disponible en este servidor por ahora.');
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
            return msg.reply('⏸️ *.yt* no está disponible en este servidor por ahora.');
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
                    .filter(p => p.id && !(p.id.user || p.id._serialized || '').includes(botNum))
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
                txt += `• ID \`${j.id}\` — ${safeLocaleString(new Date(j.executeAt), 'es-MX', { timeZone: 'America/Mexico_City' })}\n`;
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

        // --- ENRUTADOR DE MENÚS ---
        const styledMenus = new Set([
            '.menuprincipal', '.menu', '.menuadmins', '.menufun',
            '.menuherramientas', '.menustickers', '.menufreefire'
        ]);
        if (styledMenus.has(command)) {
            const styledReply = await replyStyledMenu(command, msg, chat, isGroup);
            if (styledReply) return styledReply;
        }

        const menuRouter = {
            '.menulogos': MENU_LOGOS,
            '.menuventas': MENU_VENTAS,
            '.menuventas2': MENU_VENTAS2,
            '.menuhot': MENU_HOT,
            '.menugrupo': MENU_GRUPO,
            '.menucomandos': MENU_GRUPO,
        };

        if (menuRouter[command]) {
            return msg.reply(menuRouter[command]);
        }

        // --- TIENDA NIVEL 3 (grupo) ---
        if (command === '.registro' || command === '.registrarme') {
            if (!isGroup) return msg.reply('❌ Regístrate en el grupo de la tienda.');
            const s = store.getStoreByGroupId(chat.id._serialized);
            if (!s) return msg.reply('❌ No hay tienda activa en este grupo.');
            const userId = msg.author || msg.from;
            let displayName = 'Usuario';
            try {
                const c = await msg.getContact();
                displayName = c.pushname || c.name || displayName;
            } catch (e) {}
            const result = store.registerUser(s.id, userId, displayName);
            if (result.already) {
                return msg.reply(
                    `ℹ️ *Ya estás registrado*\n\n` +
                    `👤 ${displayName}\n` +
                    `💰 Saldo: $${result.user.balance || 0}\n\n` +
                    `_Compra con_ *.tienda* _y_ *.comprar [producto]*`
                );
            }
            return msg.reply(
                `✅ *REGISTRO EXITOSO*\n\n` +
                `👤 Cliente: ${displayName}\n` +
                `🛍️ Tienda: ${s.groupName}\n\n` +
                `Ahora puedes:\n` +
                `• Ver catálogo: *.tienda*\n` +
                `• Ver saldo: *.saldo*\n` +
                `• Comprar: *.comprar [producto]*\n\n` +
                `_Pide recarga de saldo a un admin._`
            );
        }

        if (command === '.clientes') {
            if (!isGroup) return msg.reply('❌ Comando de grupos.');
            if (!isPrivilegedOwner(senderNumber)) return msg.reply('🚫 Solo el owner.');
            const s = store.getStoreByGroupId(chat.id._serialized);
            if (!s) return msg.reply('❌ No hay tienda activa aquí.');
            const count = store.getRegisteredCount(s.id);
            return msg.reply(
                `👥 *CLIENTES REGISTRADOS*\n\n` +
                `📍 ${s.groupName}\n` +
                `🆔 Tienda: \`${s.id}\`\n` +
                `✅ Registrados: *${count}*\n\n` +
                `_Los datos se guardan por tienda, sin cargar todo en RAM._`
            );
        }

        if (command === '.tiendaid') {
            if (!isGroup) return msg.reply('❌ Comando de grupos.');
            const s = store.getStoreByGroupId(chat.id._serialized);
            if (!s) return msg.reply('❌ No hay tienda activa aquí. Owner: *.activartienda*');
            if (!isPrivilegedOwner(senderNumber)) return msg.reply('🚫 Solo el owner puede ver el ID.');
            return msg.reply(`🆔 *ID de tienda:* \`${s.id}*\n📍 ${s.groupName}`);
        }

        if (command === '.tienda') {
            if (!isGroup) return msg.reply('❌ Comando de grupos.');
            const s = store.getStoreByGroupId(chat.id._serialized);
            if (!s) return msg.reply('❌ No hay tienda activa en este grupo.');
            return msg.reply(store.buildCatalog(s.id));
        }

        if (command === '.saldo') {
            const userId = msg.author || msg.from;
            let displayName = 'Usuario';
            try {
                const c = await msg.getContact();
                displayName = c.pushname || c.name || displayName;
            } catch (e) {}

            if (isGroup) {
                const s = store.getStoreByGroupId(chat.id._serialized);
                if (!s) return msg.reply('❌ No hay tienda activa en este grupo.');
                if (!store.isRegistered(s.id, userId)) {
                    return msg.reply('⚠️ No estás registrado.\n\nUsa *.registro* primero.');
                }
                const wallet = store.getUserWallet(s.id, userId);
                store.setUserName(s.id, userId, displayName);
                return msg.reply(
                    `💳 *TU SALDO*\n\n` +
                    `👤 ${displayName}\n` +
                    `💰 Disponible: $${wallet.balance}\n` +
                    `📉 Histórico Gastado: $${wallet.spent || 0}`
                );
            }
            return msg.reply('❌ Usa *.saldo* en el grupo donde está la tienda.');
        }

        if (command === '.quitarsaldo' || command === '.restarsaldo') {
            if (!isGroup) return msg.reply('❌ Usa este comando en el grupo de la tienda.');
            const isAdmin = await resolveGroupAdmin(msg, chat);
            if (!isAdmin) return msg.reply('🚫 Solo los administradores pueden quitar saldo.');
            const s = store.getStoreByGroupId(chat.id._serialized);
            if (!s) return msg.reply('❌ No hay tienda activa en este grupo.');
            const amount = parseFloat(argsArray[0]);
            if (isNaN(amount) || amount <= 0) {
                return msg.reply('⚠️ Uso: *.quitarsaldo 100* (como respuesta al cliente o con @mención)');
            }
            let targetId = null;
            let targetName = '';
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                targetId = quoted.author || quoted.from;
                try {
                    const tc = await quoted.getContact();
                    targetName = tc.pushname || tc.name || '';
                } catch (e) {}
            } else if (msg.mentionedIds.length > 0) {
                targetId = msg.mentionedIds[0];
                try {
                    const tc = await client.getContactById(targetId);
                    targetName = tc.pushname || tc.name || '';
                } catch (e) {}
            }
            if (!targetId) {
                return msg.reply('⚠️ Responde al mensaje del cliente o menciónalo: *.quitarsaldo 100 @user*');
            }
            const result = store.deductBalance(s.id, targetId, amount, targetName);
            const mention = targetName ? `@${targetName.split(' ')[0]}` : 'Cliente';
            return msg.reply(
                `✅ *Saldo Retirado*\n\n` +
                `📲 ${mention}\n` +
                `👤 Cliente: ${targetName || 'Usuario'}\n` +
                `💰 Anterior: $${result.previous}\n` +
                `➖ Retirado: $${amount}\n` +
                `💵 *Nuevo Saldo: $${result.newBalance}*`
            );
        }

        if (command === '.registrar') {
            if (!isGroup) return msg.reply('❌ Usa este comando en el grupo de la tienda.');
            const isAdmin = await resolveGroupAdmin(msg, chat);
            if (!isAdmin) return msg.reply('🚫 Solo los administradores pueden registrar a otros miembros.');
            let targetId = null;
            let targetName = '';
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                targetId = quoted.author || quoted.from;
                try {
                    const tc = await quoted.getContact();
                    targetName = tc.pushname || tc.name || '';
                } catch (e) {}
            } else if (msg.mentionedIds.length > 0) {
                targetId = msg.mentionedIds[0];
                try {
                    const tc = await client.getContactById(targetId);
                    targetName = tc.pushname || tc.name || '';
                } catch (e) {}
            }
            if (!targetId) {
                return msg.reply('⚠️ Responde al mensaje del cliente o menciónalo: *.registrar @user*');
            }
            const s = store.getStoreByGroupId(chat.id._serialized);
            if (!s) return msg.reply('❌ No hay tienda activa en este grupo.');
            const result = store.registerUser(s.id, targetId, targetName || 'Usuario');
            if (result.already) {
                return msg.reply(
                    `ℹ️ *Ya está registrado*\n\n` +
                    `👤 ${targetName || 'Usuario'}\n` +
                    `💰 Saldo: $${result.user.balance || 0}`
                );
            }
            return msg.reply(
                `✅ *REGISTRO EXITOSO (por Admin)*\n\n` +
                `👤 Cliente: ${targetName || 'Usuario'}\n` +
                `🛍️ Tienda: ${s.groupName}\n\n` +
                `Ahora el cliente ya puede comprar en la tienda.`
            );
        }

        if (command === '.ranking' || command === '.top') {
            if (!isGroup) return msg.reply('❌ Usa este comando en el grupo de la tienda.');
            const s = store.getStoreByGroupId(chat.id._serialized);
            if (!s) return msg.reply('❌ No hay tienda activa en este grupo.');
            const users = store.getStoreUsersList(s.id);
            if (!users.length) return msg.reply('ℹ️ No hay clientes registrados aún en esta tienda.');
            
            users.sort((a, b) => b.spent - a.spent);
            
            let txt = `🏆 *RANKING DE COMPRADORES* 🏆\n`;
            txt += `📍 Tienda: *${s.groupName}*\n`;
            txt += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            
            users.slice(0, 10).forEach((u, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                txt += `${medal} *${u.name}* — Compra total: *$${u.spent}* (Saldo: $${u.balance})\n`;
            });
            
            return msg.reply(txt);
        }

        if (command === '.resumen' || command === '.ventas') {
            if (!isGroup) return msg.reply('❌ Usa este comando en el grupo de la tienda.');
            const s = store.getStoreByGroupId(chat.id._serialized);
            if (!s) return msg.reply('❌ No hay tienda activa en este grupo.');
            
            const isStoreLinkedByMe = s.linkedBy && s.linkedBy.endsWith(earlySender.slice(-10));
            const isAdmin = await resolveGroupAdmin(msg, chat);
            
            if (!isStoreLinkedByMe && !isAdmin && !isPrivilegedOwner(earlySender)) {
                return msg.reply('🚫 Solo el administrador que vinculó la tienda o los admins del grupo pueden ver el resumen de ventas.');
            }
            
            const summary = store.getSalesSummary(s.id);
            if (!summary) return msg.reply('❌ No se pudieron calcular las estadísticas.');
            
            let txt = `📊 *RESUMEN DE VENTAS* 📊\n`;
            txt += `📍 Tienda: *${summary.groupName}*\n`;
            txt += `🆔 ID: \`${summary.storeId}\`\n`;
            txt += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            txt += `💰 *Ingresos Totales:* $${summary.totalRevenue}\n`;
            txt += `📈 *Transacciones:* ${summary.totalSalesCount}\n\n`;
            
            txt += `🛍️ *Ventas por Producto:*\n`;
            const stats = Object.entries(summary.productStats);
            if (stats.length === 0) {
                txt += `   _(Sin ventas registradas aún)_\n`;
            } else {
                stats.forEach(([prodName, count]) => {
                    txt += `   • ${prodName}: *${count}* unidades\n`;
                });
            }
            
            txt += `\n🕒 *Últimas Ventas:*\n`;
            if (summary.recentSales.length === 0) {
                txt += `   _(Sin ventas registradas aún)_\n`;
            } else {
                summary.recentSales.forEach(sale => {
                    let dateStr = '';
                    try {
                        dateStr = safeLocaleString(new Date(sale.timestamp), 'es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });
                    } catch (e) {
                        dateStr = new Date(sale.timestamp).toLocaleTimeString();
                    }
                    txt += `   • *${sale.buyerName}* compró *${sale.productName}* ($${sale.price}) a las ${dateStr}\n`;
                });
            }
            
            return msg.reply(txt);
        }

        if (command === '.resumentiendas' || command === '.tiendas') {
            if (!isPrivilegedOwner(earlySender)) {
                return msg.reply('🚫 Solo el owner principal puede ver este resumen.');
            }
            
            const list = store.getStoresSummaryForOwner();
            if (!list.length) return msg.reply('ℹ️ No hay tiendas activas en el sistema.');
            
            let txt = `🏬 *RESUMEN DE TIENDAS ACTIVAS* 🏬\n`;
            txt += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            
            let totalRevenueSystem = 0;
            let totalSalesCountSystem = 0;
            
            list.forEach((s, i) => {
                totalRevenueSystem += s.revenue;
                totalSalesCountSystem += s.totalSalesCount;
                
                txt += `${i + 1}. *${s.groupName}* (ID: \`${s.id}\`)\n`;
                txt += `   👤 Vinculado por: @${s.linkedBy.split('@')[0]}\n`;
                txt += `   👥 Clientes: *${s.customerCount}* · Productos: *${s.productCount}* · Stock: *${s.totalStock}*\n`;
                txt += `   💰 Ventas: *${s.totalSalesCount}* transacciones · Ingresos: *$${s.revenue}*\n`;
                txt += `   ━━━━━━━━━━━━━━━━━━━━\n`;
            });
            
            txt += `\n📈 *TOTALES DEL SISTEMA:*\n`;
            txt += `• Tiendas activas: *${list.length}*\n`;
            txt += `• Transacciones totales: *${totalSalesCountSystem}*\n`;
            txt += `• Ingresos totales: *$${totalRevenueSystem}*`;
            
            return msg.reply(txt);
        }

        if (command === '.cargarsaldo') {
            if (!isGroup) return msg.reply('❌ Usa este comando en el grupo de la tienda.');
            if (!isPrivilegedOwner(senderNumber)) return msg.reply('🚫 Solo el owner puede recargar saldo.');
            const s = store.getStoreByGroupId(chat.id._serialized);
            if (!s) return msg.reply('❌ No hay tienda activa en este grupo.');
            const amount = parseFloat(argsArray[0]);
            if (isNaN(amount) || amount <= 0) {
                return msg.reply('⚠️ Uso: *.cargarsaldo 100* (como respuesta al cliente o con @mención)');
            }
            let targetId = null;
            let targetName = '';
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                targetId = quoted.author || quoted.from;
                try {
                    const tc = await quoted.getContact();
                    targetName = tc.pushname || tc.name || '';
                } catch (e) {}
            } else if (msg.mentionedIds.length > 0) {
                targetId = msg.mentionedIds[0];
            }
            if (!targetId) {
                return msg.reply('⚠️ Responde al mensaje del cliente o menciónalo: *.cargarsaldo 100 @user*');
            }
            const result = store.addBalance(s.id, targetId, amount, targetName);
            const mention = targetName ? `@${targetName.split(' ')[0]}` : 'Cliente';
            return msg.reply(
                `✅ *Saldo Recargado*\n\n` +
                `📲 ${mention}\n` +
                `👤 Cliente: ${targetName || 'Usuario'}\n` +
                `💰 Anterior: $${result.previous}\n` +
                `➕ Agregado: $${amount}\n` +
                `💵 *Nuevo Saldo: $${result.newBalance}*`
            );
        }

        if (command === '.comprar') {
            if (!isGroup) return msg.reply('❌ Las compras se hacen en el grupo de la tienda.');
            if (!argsStr) return msg.reply('⚠️ Uso: *.comprar max* o *.comprar max completa*');
            const groupStore = store.getStoreByGroupId(chat.id._serialized);
            if (!groupStore) return msg.reply('❌ No hay tienda activa en este grupo.');
            const buyerId = msg.author || msg.from;
            if (!store.isRegistered(groupStore.id, buyerId)) {
                return msg.reply('⚠️ Debes registrarte primero:\n*.registro*');
            }
            let buyerName = '';
            try {
                const c = await msg.getContact();
                buyerName = c.pushname || c.name || '';
            } catch (e) {}
            const result = store.purchase(groupStore.id, buyerId, argsStr, buyerName);
            if (!result.ok) {
                if (result.error === 'NOT_REGISTERED') {
                    return msg.reply('⚠️ Debes registrarte primero:\n*.registro*');
                }
                if (result.error === 'NO_STOCK') {
                    return msg.reply('❌ Sin stock para ese producto. Revisa *.tienda*');
                }
                if (result.error === 'INSUFFICIENT') {
                    return msg.reply(
                        `❌ Saldo insuficiente.\n\n` +
                        `💰 Tu saldo: $${result.balance}\n` +
                        `💳 Precio: $${result.price}\n\n` +
                        `_Pide recarga a un admin._`
                    );
                }
                return msg.reply('❌ Producto no encontrado. Usa *.tienda* para ver el catálogo.');
            }
            await msg.reply(
                `🎉 *COMPRA EXITOSA*\n\n` +
                `👤 Cliente: ${buyerName || 'Usuario'}\n` +
                `🛒 Producto: 1x ${result.product.name}\n` +
                `💳 Costo: $${result.product.price}\n` +
                `💰 Saldo restante: $${result.remaining}`
            );
            try {
                await client.sendMessage(
                    buyerId,
                    result.deliveryText + getBotBrandFooter()
                );
            } catch (e) {
                console.error('Entrega DM tienda:', e);
                await msg.reply('⚠️ Compra OK pero no pude enviarte el producto por privado. Escríbeme al bot en DM.');
            }
            return;
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

            // Aislado por grupo: no aparece en otros grupos
            if (isGroup) {
                const gid = chat.id._serialized;
                if (groupCommands.hasGroupCommand(gid, cmdName)) {
                    return msg.reply(`⚠️ El comando .${cmdName} ya existe en este grupo.`);
                }
                groupCommands.setGroupCommand(gid, cmdName, { text: "", image: null, mimetype: null });
                return msg.reply(`✅ *Comando .${cmdName} creado (solo este grupo)*\n\nConfigúralo con: *.set${cmdName} tu contenido*\nO responde una imagen/sticker con *.set${cmdName}*`);
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

            // Primero: comandos aislados de este grupo
            if (isGroup && groupCommands.deleteGroupCommand(chat.id._serialized, cmdName)) {
                return msg.reply(`🗑️ *Comando .${cmdName} eliminado* de este grupo.`);
            }

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

            // En grupos: aislado por grupo (no se mezcla con otros grupos)
            if (isGroup) {
                const gid = chat.id._serialized;
                if (groupCommands.hasGroupCommand(gid, cmdName)) {
                    return msg.reply(`⚠️ El comando .${cmdName} ya fue creado en este grupo.`);
                }
                groupCommands.setGroupCommand(gid, cmdName, { text: "", image: null, mimetype: null });
                return msg.reply(`✅ *Comando .${cmdName} creado (solo este grupo)*\n\nAhora usa: *.set${cmdName} tu contenido* para guardar información.\nO responde una imagen con *.set${cmdName}* para guardar con imagen.`);
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
            
            // Comando aislado del grupo (prioridad sobre los globales)
            if (isGroup && groupCommands.hasGroupCommand(chat.id._serialized, cmdName)) {
                const gid = chat.id._serialized;
                const prev = groupCommands.getGroupCommand(gid, cmdName);
                groupCommands.setGroupCommand(gid, cmdName, {
                    text: argsStr || prev.text,
                    image: imagenBase64 || prev.image,
                    mimetype: mimeType || prev.mimetype
                });
                return msg.reply(`✅ Comando .${cmdName} actualizado${imagenBase64 ? ' con imagen' : ''} (solo este grupo).`);
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

        // Comandos personalizados — primero los del grupo (aislados), luego globales
        const customName = command.substring(1);
        if (isGroup) {
            const groupCmd = groupCommands.getGroupCommand(chat.id._serialized, customName);
            if (groupCmd) {
                const cmdData = hasCommandContent(groupCmd)
                    ? groupCmd
                    : { text: buildDefaultCustomText(customName), image: groupCmd.image || null, mimetype: groupCmd.mimetype || null };
                return sendMenuCommandResponse(customName, cmdData, chat, msg);
            }
        }
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
        console.log("DEBUG MSG:", { from: msg?.from, to: msg?.to, body: msg?.body });
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
    if (!botReady) return;
    try {
        const text = (msg.body || '').trim();
        if (!text || msg.fromMe) return;

        // Filtro temprano: sin getChat() para chats que no nos interesan
        const remoteId = msg.id?.remote || msg.from || '';
        if (remoteId === 'status@broadcast' || remoteId.endsWith('@newsletter') || remoteId.endsWith('@broadcast')) return;
        // Grupos inactivos: este handler solo actúa en grupos activos o wizard privado
        if (remoteId.endsWith('@g.us') && !isActiveGroup(remoteId)) return;

        const chat = await getChatSafe(msg);

        if (!chat.isGroup && !text.startsWith('.')) {
            const senderNum = await getSenderNumber(msg);
            if (isPrivilegedOwner(senderNum) && storeWizard.hasActiveSession(msg.from)) {
                const reply = storeWizard.handleWizardInput(msg.from, text, store);
                if (reply) return msg.reply(reply);
            }
        }

        if (!chat.isGroup || !isActiveGroup(chat.id._serialized)) return;

        // Usuario muteado: borrar TODO lo que escriba (texto, fotos, stickers...)
        if (getActiveMute(chat.id._serialized, msg.author || msg.from)) {
            try { await msg.delete(true); } catch (e) {}
            return;
        }

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
const MAX_INIT_RETRIES = 5;

function clearChromeSessionLocks() {
    try {
        const sessionDir = path.join(AUTH_PATH, 'session');
        if (!fs.existsSync(sessionDir)) return;
        for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
            const p = path.join(sessionDir, name);
            try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
        }
    } catch (e) {}
}

function isRetryableInitError(msg) {
    const m = String(msg || '').toLowerCase();
    return (
        m.includes('timed out') ||
        m.includes('timeout') ||
        m.includes('execution context was destroyed') ||
        m.includes('protocol error') ||
        m.includes('target closed') ||
        m.includes('session closed') ||
        m.includes('navigation') ||
        m.includes('browser has disconnected')
    );
}

async function startBot() {
    console.log('⏳ Iniciando bot... (en PCs lentas WhatsApp Web puede tardar varios minutos)');
    clearChromeSessionLocks();
    await ensureWaVersionCache(WA_CACHE_DIR, WA_WEB_VERSION);
    try {
        await client.initialize();
    } catch (err) {
        const msg = err?.message || String(err);
        initRetries++;

        if (isRetryableInitError(msg) && initRetries <= MAX_INIT_RETRIES) {
            const waitSec = Math.min(10 + (15 * initRetries), 90);
            console.warn(`⚠️ Arranque falló (${msg.slice(0, 80)}).`);
            console.warn(`   Reintento ${initRetries}/${MAX_INIT_RETRIES} en ${waitSec}s (espera — no mates el proceso)...`);
            try { await client.destroy().catch(() => {}); } catch (e) {}
            clearChromeSessionLocks();
            await new Promise(r => setTimeout(r, waitSec * 1000));
            return startBot();
        }

        console.error('❌ No se pudo iniciar el bot:', msg);
        console.log('\n💡 Solución definitiva en el VPS:');
        console.log('   chmod +x deploy/reparar-arranque.sh && ./deploy/reparar-arranque.sh');
        console.log('   Si el sistema pide reboot: sudo reboot  →  luego pm2 start bot-ventas\n');
        // Delay antes de salir para que PM2 no martillee Chrome
        await new Promise(r => setTimeout(r, 20000));
        process.exit(1);
    }
}

startBot();

// ==========================================
// LIMPIEZA PERIÓDICA DE tmp/ (descargas .play/.yt huérfanas)
// ==========================================
sweepTmpDir();
setInterval(() => sweepTmpDir(), 60 * 60 * 1000).unref();

// ==========================================
// APAGADO LIMPIO (systemd stop / Ctrl+C)
// ==========================================
let shuttingDown = false;
async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    try { console.log(`\n🛑 ${signal} recibido — apagando limpio...`); } catch (e) {}
    try { store.flushAll(); } catch (e) {}
    try { groupCommands.flushAll(); } catch (e) {}
    try {
        await Promise.race([
            client.destroy(),
            new Promise(r => setTimeout(r, 10000))
        ]);
    } catch (e) {}
    try { console.log('👋 Bot apagado correctamente.'); } catch (e) {}
    process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ==========================================
// REINICIO DIARIO OPCIONAL (libera RAM de Chrome en VPS pequeños)
// systemd (Restart=always) vuelve a levantar el proceso
// ==========================================
const DAILY_RESTART_HOUR = process.env.DAILY_RESTART_HOUR !== undefined && process.env.DAILY_RESTART_HOUR !== ''
    ? parseInt(process.env.DAILY_RESTART_HOUR, 10)
    : null;
if (DAILY_RESTART_HOUR !== null && DAILY_RESTART_HOUR >= 0 && DAILY_RESTART_HOUR <= 23) {
    setInterval(() => {
        const now = new Date();
        const uptimeH = (Date.now() - BOT_START_TIME) / 3600000;
        if (now.getHours() === DAILY_RESTART_HOUR && uptimeH > 1) {
            console.log(`♻️ Reinicio programado (${DAILY_RESTART_HOUR}:00) — systemd relanzará el bot.`);
            gracefulShutdown('DAILY_RESTART');
        }
    }, 5 * 60 * 1000).unref();
    console.log(`♻️ Reinicio diario programado a las ${DAILY_RESTART_HOUR}:00`);
}

// ==========================================
// ESCUDO ANTI-CRASH (con salida limpia en errores irrecuperables)
// ==========================================
let puppeteerErrorCount = 0;
process.on('uncaughtException', (err) => {
    // EPIPE en stdout/stderr: si logueamos aquí se genera otro EPIPE → bucle infinito de CPU.
    if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED' || err.code === 'ERR_STREAM_WRITE_AFTER_END')) return;
    try { console.error('🔥 Error crítico interceptado:', err); } catch (e) {}
});
process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || String(reason);
    if (msg.includes('Page.navigate timed out') || msg.includes('ProtocolError') || msg.includes('Session closed') || msg.includes('Target closed')) {
        puppeteerErrorCount++;
        console.error(`🔥 Error Puppeteer (${puppeteerErrorCount}/10):`, msg);
        // Chrome roto de forma persistente: mejor reiniciar limpio (systemd relanza)
        if (puppeteerErrorCount >= 10) {
            console.error('💀 Demasiados errores de Puppeteer — reiniciando proceso...');
            gracefulShutdown('PUPPETEER_FATAL');
        }
        return;
    }
    console.error('🔥 Promesa fallida interceptada:', reason);
});
// Resetear contador cada hora si el bot va bien
setInterval(() => { puppeteerErrorCount = 0; }, 60 * 60 * 1000).unref();
