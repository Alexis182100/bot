const { MENU_COMMAND_COUNT } = require('../menu-commands');

// Creador fijo del sistema — no configurable desde L2
const SYSTEM_CREATOR = 'Alexis GM';

const DEFAULT_STYLE = {
    bullet: '💜',
    badge: '🎀',
    borderEnd: '⬣',
    creator: SYSTEM_CREATOR,
    welcomeEmoji: '☀️'
};

function getMenuStyle(botProfile = {}, botDisplayName = 'Bot') {
    const s = botProfile.menuStyle || {};
    return {
        bullet: s.bullet || botProfile.menuBullet || DEFAULT_STYLE.bullet,
        badge: s.badge || botProfile.menuBadge || DEFAULT_STYLE.badge,
        borderEnd: s.borderEnd || DEFAULT_STYLE.borderEnd,
        creator: SYSTEM_CREATOR,
        welcomeEmoji: s.welcomeEmoji || DEFAULT_STYLE.welcomeEmoji
    };
}

function greetingByHour() {
    const h = parseInt(new Date().toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit' }), 10);
    if (h >= 5 && h < 12) return { saludo: '𝐁𝐮𝐞𝐧𝐨𝐬 𝐝𝐢́𝐚𝐬', emoji: '🌅' };
    if (h >= 12 && h < 19) return { saludo: '𝐁𝐮𝐞𝐧𝐚𝐬 𝐭𝐚𝐫𝐝𝐞𝐬', emoji: '☀️' };
    return { saludo: '𝐁𝐮𝐞𝐧𝐚𝐬 𝐧𝐨𝐜𝐡𝐞𝐬', emoji: '🌙' };
}

function section(title, commands, style) {
    if (!commands.length) return '';
    let txt = `╭─❏ 「 ${title} 」\n`;
    for (const cmd of commands) {
        const line = cmd.startsWith('.') ? cmd : `.${cmd}`;
        txt += `│ ${style.bullet} *${line}*\n`;
    }
    txt += `╰───────────${style.borderEnd}\n\n`;
    return txt;
}

function botInfoHeader(userName, style, totalCommands, isGroup, botDisplayName) {
    const now = new Date();
    const fecha = now.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'long' });
    const hora = now.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });
    const { saludo, emoji } = greetingByHour();
    const nombre = (botDisplayName || 'Bot').toUpperCase();
    return (
        `╔═══════ ✦ ✦ ✦ ═══════╗\n` +
        `   ♾️ *${nombre}* ♾️\n` +
        `╚═══════ ✦ ✦ ✦ ═══════╝\n\n` +
        `${emoji} ${saludo}, *${userName || 'Usuario'}* ${style.welcomeEmoji}\n` +
        `_Un gusto tenerte por aquí_ ✨\n\n` +
        `╭─❏ 「 𝐈𝐍𝐅𝐎 𝐃𝐄𝐋 𝐁𝐎𝐓 」\n` +
        `│ ${style.badge} 𝖬𝗈𝖽𝗈: *${isGroup ? 'GRUPO' : 'PRIVADO'}*\n` +
        `│ ${style.badge} 𝖥𝖾𝖼𝗁𝖺: ${fecha}\n` +
        `│ ${style.badge} 𝖧𝗈𝗋𝖺: ${hora}\n` +
        `│ ${style.badge} 𝖢𝗈𝗆𝖺𝗇𝖽𝗈𝗌: *${totalCommands}+*\n` +
        `│ ${style.badge} 𝖢𝗋𝖾𝖺𝖽𝗈𝗋: *${style.creator}*\n` +
        `╰───────────${style.borderEnd}\n\n` +
        `✦ ・ 𝐋𝐈𝐒𝐓𝐀 𝐃𝐄 𝐂𝐎𝐌𝐀𝐍𝐃𝐎𝐒 ・ ✦\n\n`
    );
}

function buildMainMenu({ userName, botProfile, botDisplayName, totalCommands, isGroup, storeActive }) {
    const style = getMenuStyle(botProfile, botDisplayName);
    let txt = botInfoHeader(userName, style, totalCommands || MENU_COMMAND_COUNT, isGroup, botDisplayName);

    txt += section('𝗣𝗥𝗜𝗡𝗖𝗜𝗣𝗔𝗟 📚', [
        'menuprincipal', 'menuadmins', 'menugrupo', 'menufreefire',
        'menulogos', 'menuventas', 'menuventas2', 'menufun', 'menuhot',
        'menuherramientas', 'menustickers', 'totalcomandos', 'ping'
    ], style);

    if (storeActive) {
        txt += section('𝗧𝗜𝗘𝗡𝗗𝗔 🛍️', [
            'registro', 'tienda', 'saldo', 'comprar [producto]'
        ], style);
    }

    txt += section('𝗔𝗖𝗧𝗜𝗩𝗔𝗖𝗜𝗢𝗡 ⚡', [
        'activarbot', 'desactivarbot'
    ], style);

    txt += `> ✨ 𝖢𝗋𝖾𝖺𝖽𝗈 𝖼𝗈𝗇 💜 𝗉𝗈𝗋 *${style.creator}* ✨`;

    return txt.trim();
}

function buildAdminsMenu(style) {
    return (
        botInfoHeader('Admin', style, MENU_COMMAND_COUNT, true) +
        section('𝗔𝗗𝗠𝗜𝗡𝗦 🛡️', [
            'activarbot', 'desactivarbot', 'n', 'admins', 'kick', 'update', 'updown',
            'mute', 'unmute', 'mutelist', 'warn', 'warns', 'delwarn',
            'antiflood on/off', 'antilink on/off', 'welcome on/off',
            'programar 30m texto', 'programados', 'cancelarprogramado',
            'backup', 'restore', 'add', 'link', 'abrir', 'cerrar', 'del'
        ], style)
    ).trim();
}

function buildFunMenu(style) {
    return (
        `*𝗠𝗘𝗡𝗨 𝗙𝗨𝗡 🎮*\n\n` +
        section('𝗗𝗜𝗩𝗘𝗥𝗦𝗜𝗢𝗡 🎵', [
            'play [canción]', 'yt [url]', 'tt [link]', 'ig [link]',
            'sorteo @users', 'encuesta pregunta | op1 | op2', 'voto [n]'
        ], style) +
        section('𝗖𝗢𝗡𝗦𝗨𝗟𝗧𝗔𝗦 🔮', [
            'horoscopo [signo]', 'clima [ciudad]', 'horario', 'moneda', 'divisa'
        ], style)
    ).trim();
}

function buildHerramientasMenu(style) {
    return (
        `*𝗠𝗘𝗡𝗨 𝗛𝗘𝗥𝗥𝗔𝗠𝗜𝗘𝗡𝗧𝗔𝗦 🛠️*\n\n` +
        section('𝗛𝗘𝗥𝗥𝗔𝗠𝗜𝗘𝗡𝗧𝗔𝗦 ⚙️', [
            'clima [ciudad]', 'horario', 'horoscopo [signo]', 'fotodeperfil',
            'ver', 'ver2', 'hd', 'moneda [cant] [de] [a]', 'divisa',
            'tr texto | idioma', 'ping', 'totalcomandos', 'id'
        ], style)
    ).trim();
}

function buildStickersMenu(style) {
    return (
        `*𝗠𝗘𝗡𝗨 𝗦𝗧𝗜𝗖𝗞𝗘𝗥𝗦 🏞️*\n\n` +
        section('𝗦𝗧𝗜𝗖𝗞𝗘𝗥𝗦 ✨', [
            'img (reply)', 's', 'qc (reply)', 'brat texto', 'reenviar (reply)'
        ], style)
    ).trim();
}

function buildFreeFireMenu(style) {
    return (
        `*𝗠𝗘𝗡𝗨 𝗙𝗥𝗘𝗘 𝗙𝗜𝗥𝗘 🔥*\n\n` +
        section('𝗖𝗢𝗠𝗣𝗘𝗧𝗜𝗧𝗜𝗩𝗢 📌', [
            '4vs4', '6vs6', '8vs8', '12vs12', '16vs16', '20vs20', '24vs24',
            'donarsala', 'iniciales', 'setiniciales', 'reglaslideres', 'reglaslideres2'
        ], style)
    ).trim();
}

function buildTiendaMenu(catalogText) {
    return catalogText;
}

module.exports = {
    getMenuStyle,
    buildMainMenu,
    buildAdminsMenu,
    buildFunMenu,
    buildHerramientasMenu,
    buildStickersMenu,
    buildFreeFireMenu,
    buildTiendaMenu,
    section,
    DEFAULT_STYLE,
    SYSTEM_CREATOR
};
