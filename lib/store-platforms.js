const fs = require('fs');
const path = require('path');

const SERVICES_DIR = path.join(__dirname, '..', 'data', 'store', 'services');
const servicesCache = new Map();

const BASE_PLATFORMS = [
    { key: 'max', name: 'MAX', emoji: '🎬', profiles: 5, pricePerfil: 10, priceCompleta: 30 },
    { key: 'prime', name: 'PRIME VIDEO', emoji: '📦', profiles: 6, pricePerfil: 6, priceCompleta: 25 },
    { key: 'netflix', name: 'NETFLIX', emoji: '🔴', profiles: 5, pricePerfil: 8, priceCompleta: 35 },
    { key: 'disney', name: 'DISNEY+', emoji: '🏰', profiles: 7, pricePerfil: 7, priceCompleta: 28 },
    { key: 'vix', name: 'VIX', emoji: '📺', profiles: 5, pricePerfil: 8, priceCompleta: 15 },
    { key: 'paramount', name: 'PARAMOUNT+', emoji: '⛰️', profiles: 6, pricePerfil: 6, priceCompleta: 20 },
    { key: 'crunchyroll', name: 'CRUNCHYROLL', emoji: '🍥', profiles: 4, pricePerfil: 8, priceCompleta: 22 },
    { key: 'iptv', name: 'IPTV', emoji: '📡', profiles: 6, pricePerfil: 15, priceCompleta: 40 },
    { key: 'kocowa', name: 'KOCOWA', emoji: '🇰🇷', profiles: 1, pricePerfil: 5, priceCompleta: 12 },
    { key: 'spotify', name: 'SPOTIFY', emoji: '🎵', profiles: 1, pricePerfil: 5, priceCompleta: 15 },
    { key: 'duolingo', name: 'DUOLINGO FAM', emoji: '🦉', profiles: 0, pricePerfil: 0, priceCompleta: 8, completaOnly: true },
    { key: 'canva', name: 'CANVA PRO', emoji: '🎨', profiles: 0, pricePerfil: 0, priceCompleta: 10, completaOnly: true }
];

function normalizeKey(name) {
    return (name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function loadCustomServices(storeId) {
    if (!storeId) return {};
    if (servicesCache.has(storeId)) return servicesCache.get(storeId);
    ensureDir();
    const file = path.join(SERVICES_DIR, `${storeId}.json`);
    let data = {};
    if (fs.existsSync(file)) {
        try {
            data = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) {
            console.error(`Error leyendo servicios ${storeId}:`, e);
        }
    }
    servicesCache.set(storeId, data);
    return data;
}

function ensureDir() {
    if (!fs.existsSync(SERVICES_DIR)) {
        fs.mkdirSync(SERVICES_DIR, { recursive: true });
    }
}

function saveCustomServices(storeId, data) {
    ensureDir();
    servicesCache.set(storeId, data);
    fs.writeFileSync(
        path.join(SERVICES_DIR, `${storeId}.json`),
        JSON.stringify(data, null, 2)
    );
}

function addCustomService(storeId, { name, emoji, profiles, pricePerfil, priceCompleta, completaOnly }) {
    const key = normalizeKey(name);
    if (!key) return null;
    const custom = loadCustomServices(storeId);
    const onlyCompleta = completaOnly || profiles === 0;
    const platform = {
        key,
        name: (name || key).toUpperCase(),
        emoji: emoji || '📦',
        profiles: onlyCompleta ? 0 : (profiles || 1),
        pricePerfil: onlyCompleta ? 0 : (pricePerfil || 10),
        priceCompleta: priceCompleta || 15,
        completaOnly: onlyCompleta,
        custom: true
    };
    custom[key] = platform;
    saveCustomServices(storeId, custom);
    return platform;
}

function listCustomServices(storeId) {
    return Object.values(loadCustomServices(storeId));
}

function getMenuPlatforms(storeId) {
    return [...BASE_PLATFORMS, ...listCustomServices(storeId)];
}

function getAddServiceMenuIndex(storeId) {
    return getMenuPlatforms(storeId).length + 1;
}

function isAddServiceOption(index, storeId) {
    return parseInt(index, 10) === getAddServiceMenuIndex(storeId);
}

function getPlatformByIndex(index, storeId) {
    const list = getMenuPlatforms(storeId);
    const i = parseInt(index, 10);
    if (isNaN(i) || i < 1 || i > list.length) return null;
    return list[i - 1];
}

function getPlatformByKey(key, storeId) {
    const k = normalizeKey(key);
    const base = BASE_PLATFORMS.find(p => p.key === k || normalizeKey(p.name) === k);
    if (base) return base;
    if (!storeId) return null;
    const custom = loadCustomServices(storeId);
    if (custom[k]) return custom[k];
    return Object.values(custom).find(
        p => p.key === k || normalizeKey(p.name) === k || p.name.toLowerCase().includes(k)
    ) || null;
}

function buildPlatformMenu(storeId) {
    const list = getMenuPlatforms(storeId);
    const addIdx = getAddServiceMenuIndex(storeId);

    let txt =
        `📦 *CARGA DE STOCK — MENÚ*\n\n` +
        `¿Qué plataforma deseas agregar?\n\n`;

    list.forEach((p, i) => {
        const tag = p.custom ? ' _(tuyo)_' : '';
        const perfilInfo = p.completaOnly
            ? 'solo completas'
            : `${p.profiles} perfiles/cuenta`;
        txt += `*${i + 1}.* ${p.emoji} *${p.name}*${tag} — ${perfilInfo}\n`;
    });

    txt +=
        `\n*${addIdx}.* ➕ *Agregar servicio nuevo*\n` +
        `*0.* ❌ Cancelar\n\n` +
        `_Responde con el número._`;
    return txt;
}

function buildServicesList(storeId) {
    const custom = listCustomServices(storeId);
    if (!custom.length) {
        return '📭 No tienes servicios personalizados.\n\nUsa *.agregarservicio* o *.cargar* → *Agregar servicio nuevo*';
    }
    let txt = `📋 *TUS SERVICIOS PERSONALIZADOS*\n🆔 Tienda: \`${storeId}\`\n\n`;
    custom.forEach((p, i) => {
        const info = p.completaOnly ? 'solo completas' : `${p.profiles} perfiles`;
        txt += `*${i + 1}.* ${p.emoji} *${p.name}* — ${info} · $${p.pricePerfil}/${p.priceCompleta}\n`;
    });
    txt += `\n_Agregar otro:_ *.agregarservicio* o *.cargar*`;
    return txt.trim();
}

function buildAdminHelp(storeId) {
    return (
        `🛠️ *PANEL TIENDA L3*\n` +
        `🆔 Tienda: \`${storeId}\`\n\n` +
        `*Carga fácil:*\n` +
        `• *.cargar* — menú guiado (recomendado)\n` +
        `• *.agregarservicio* — crear plataforma nueva\n` +
        `• *.servicios* — ver tus servicios custom\n` +
        `• *.cancelarcarga* — cancelar menú\n\n` +
        `*Manual:*\n` +
        `• *.setproducto max perfil 10* — crear producto\n` +
        `• *.setprecio max perfil 15* — cambiar precio\n` +
        `• *.precios* — ver todos los precios\n` +
        `• *.addstock max* + credenciales\n\n` +
        `*Consultas:*\n` +
        `• *.verstock* — stock disponible\n` +
        `• *.tiendalist* — todas las tiendas`
    );
}

module.exports = {
    BASE_PLATFORMS,
    normalizeKey,
    loadCustomServices,
    addCustomService,
    listCustomServices,
    getMenuPlatforms,
    getAddServiceMenuIndex,
    isAddServiceOption,
    getPlatformByIndex,
    getPlatformByKey,
    buildPlatformMenu,
    buildServicesList,
    buildAdminHelp
};
