const fs = require('fs');
const path = require('path');
const { ensureDir, createDebouncedWriter } = require('./debounced-io');

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

const DATA_DIR = path.join(__dirname, '..', 'data', 'store');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const USERS_DIR = path.join(DATA_DIR, 'users');
const STOCK_DIR = path.join(DATA_DIR, 'stock');
const LEGACY_FILE = path.join(__dirname, '..', 'storedata.json');

const metaWriter = createDebouncedWriter(META_FILE, 400);
const userWriters = new Map();
const userCache = new Map();

let meta = {
    stores: {},
    products: {},
    adminContext: {}
};

function loadMeta() {
    ensureDir(DATA_DIR);
    ensureDir(USERS_DIR);
    ensureDir(STOCK_DIR);
    if (fs.existsSync(META_FILE)) {
        try {
            meta = { ...meta, ...JSON.parse(fs.readFileSync(META_FILE, 'utf8')) };
        } catch (e) {
            console.error('Error leyendo meta tienda:', e);
        }
    } else {
        saveMetaNow();
    }
}

function saveMetaNow() {
    metaWriter.flushSync(meta);
}

function saveMeta() {
    metaWriter.schedule(meta);
}

function getUserWriter(storeId) {
    if (!userWriters.has(storeId)) {
        userWriters.set(storeId, createDebouncedWriter(path.join(USERS_DIR, `${storeId}.json`), 500));
    }
    return userWriters.get(storeId);
}

function loadStoreUsers(storeId) {
    if (userCache.has(storeId)) return userCache.get(storeId);
    const filePath = path.join(USERS_DIR, `${storeId}.json`);
    let data = {};
    if (fs.existsSync(filePath)) {
        try {
            data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            console.error(`Error leyendo usuarios tienda ${storeId}:`, e);
        }
    }
    userCache.set(storeId, data);
    return data;
}

function saveStoreUsers(storeId) {
    const data = loadStoreUsers(storeId);
    getUserWriter(storeId).schedule(data);
}

function flushAll() {
    metaWriter.flushSync(meta);
    for (const [storeId, data] of userCache.entries()) {
        getUserWriter(storeId).flushSync(data);
    }
}

function stockFilePath(storeId, productKey) {
    return path.join(STOCK_DIR, storeId, `${productKey}.txt`);
}

function generateStoreId() {
    let id;
    do {
        id = String(Math.floor(10000 + Math.random() * 90000));
    } while (meta.stores[id]);
    return id;
}

function activateStore(groupId, groupName, linkedBy) {
    const existing = Object.values(meta.stores).find(s => s.groupId === groupId);
    if (existing) {
        existing.enabled = true;
        existing.groupName = groupName || existing.groupName;
        if (linkedBy) existing.linkedBy = linkedBy;
        saveMeta();
        return existing;
    }
    const id = generateStoreId();
    meta.stores[id] = {
        id,
        groupId,
        groupName: groupName || 'Grupo',
        enabled: true,
        createdAt: Date.now(),
        linkedBy: linkedBy || ''
    };
    if (!meta.products[id]) meta.products[id] = {};
    saveMeta();
    return meta.stores[id];
}

function getStoreByGroupId(groupId) {
    return Object.values(meta.stores).find(s => s.groupId === groupId && s.enabled) || null;
}

function getStoreById(storeId) {
    return meta.stores[storeId] || null;
}

function listEnabledStores() {
    return Object.values(meta.stores).filter(s => s.enabled);
}

function countEnabledStores() {
    return listEnabledStores().length;
}

function setAdminContext(adminId, storeId) {
    if (!storeId) {
        delete meta.adminContext[adminId];
    } else {
        meta.adminContext[adminId] = { storeId, at: Date.now() };
    }
    saveMeta();
}

function getAdminContext(adminId) {
    const ctx = meta.adminContext[adminId];
    if (!ctx?.storeId) return null;
    const storeInfo = getStoreById(ctx.storeId);
    if (!storeInfo) return null;
    return { ...ctx, store: storeInfo };
}

function normalizeProductKey(name) {
    return (name || '').toLowerCase().trim().replace(/\s+/g, '_');
}

function setProduct(storeId, key, { name, price, category, unitLabel }) {
    if (!meta.products[storeId]) meta.products[storeId] = {};
    meta.products[storeId][key] = {
        name: name || key.toUpperCase(),
        price: Number(price) || 0,
        category: category || 'perfil',
        unitLabel: unitLabel || (category === 'completa' ? 'cuenta' : 'perfil')
    };
    ensureDir(path.join(STOCK_DIR, storeId));
    saveMeta();
}

function addStockLines(storeId, productKey, lines) {
    const clean = lines.map(l => l.trim()).filter(Boolean);
    if (!clean.length) return 0;
    ensureDir(path.join(STOCK_DIR, storeId));
    const filePath = stockFilePath(storeId, productKey);
    fs.appendFileSync(filePath, clean.join('\n') + '\n');
    return clean.length;
}

function addStockItems(storeId, productKey, items) {
    const lines = items.map(item => JSON.stringify(item));
    return addStockLines(storeId, productKey, lines);
}

function ensureProduct(storeId, productKey, platform, category, customPrice) {
    if (!meta.products[storeId]) meta.products[storeId] = {};
    const isCompleta = category === 'completa';
    const defaultPrice = isCompleta ? platform.priceCompleta : platform.pricePerfil;
    const price = customPrice != null ? Number(customPrice) : (defaultPrice || 10);

    if (meta.products[storeId][productKey]) {
        if (customPrice != null) {
            meta.products[storeId][productKey].price = price;
            saveMeta();
        }
        return meta.products[storeId][productKey];
    }

    const name = isCompleta ? `${platform.name} COMPLETA` : platform.name;
    setProduct(storeId, productKey, {
        name,
        price,
        category: isCompleta ? 'completa' : 'perfil',
        unitLabel: isCompleta ? 'cuenta' : 'perfil'
    });
    return meta.products[storeId][productKey];
}

function updateProductPrice(storeId, productQuery, category, price) {
    const baseKey = normalizeProductKey(productQuery);
    const key = category === 'completa' ? `${baseKey}_completa` : baseKey;
    if (!meta.products[storeId]?.[key]) return null;
    meta.products[storeId][key].price = Number(price) || 0;
    saveMeta();
    return meta.products[storeId][key];
}

function listProducts(storeId) {
    return meta.products[storeId] || {};
}

function buildPricesList(storeId) {
    const products = listProducts(storeId);
    const keys = Object.keys(products);
    if (!keys.length) return '📭 No hay productos con precio en esta tienda.\n\nCrea uno con *.cargar* o *.setproducto*';
    let txt = `💲 *PRECIOS — TIENDA \`${storeId}\`*\n\n`;
    for (const key of keys.sort()) {
        const p = products[key];
        const stock = getStockCount(storeId, key);
        txt += `${p.category === 'completa' ? '📺' : '👤'} *${p.name}* — $${p.price}\n`;
        txt += `   Stock: ${stock} · Clave: \`${key.replace(/_completa$/, '')}${p.category === 'completa' ? ' completa' : ''}\`\n`;
    }
    txt += `\n*Actualizar:* *.setprecio max perfil 15*\n*.setprecio prime completa 30*`;
    return txt.trim();
}

function parseStockItem(line) {
    const raw = (line || '').trim();
    if (!raw) return null;
    try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') return { ...obj, raw };
    } catch (e) {
        // legacy texto plano
    }
    if (raw.includes('|')) {
        const [email, pass, pin] = raw.split('|').map(s => s.trim());
        if (email && pass) return { email, pass, pin: pin || null, raw };
    }
    if (raw.includes(':')) {
        const idx = raw.indexOf(':');
        const email = raw.slice(0, idx).trim();
        const pass = raw.slice(idx + 1).trim();
        if (email.includes('@')) return { email, pass, raw };
    }
    return { raw };
}

function formatDeliveryMessage(item, productName, quantity = 1) {
    const parsed = typeof item === 'string' ? parseStockItem(item) : item;
    const fecha = safeLocaleString(new Date(), 'es-MX', { timeZone: 'America/Mexico_City' });

    let txt =
        `> 🤖 Mensaje automático.\n\n` +
        `📦 *ENTREGA DE PEDIDO* 📦\n` +
        `📅 Fecha: ${fecha}\n` +
        `🛒 Producto: ${productName}\n` +
        `🔢 Cantidad: ${quantity}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔹 *ITEM #1 (${productName})*\n`;

    if (parsed?.email) txt += `   📧 Correo: \`${parsed.email}\`\n`;
    if (parsed?.pass) txt += `   🔑 Pass: \`${parsed.pass}\`\n`;
    if (parsed?.profile) txt += `   📺 Perfil Asignado: *${parsed.profile}*\n`;
    if (parsed?.pin) txt += `   📌 PIN: \`${parsed.pin}\`\n`;
    if (!parsed?.email && parsed?.raw) txt += `   ${parsed.raw}\n`;

    txt +=
        `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `> 🚫 Chat de entrega únicamente.\n` +
        `⚠️ *No contestar. Dudas o problemas con su producto contactar al vendedor.*`;
    return txt;
}

function getStockCount(storeId, productKey) {
    const filePath = stockFilePath(storeId, productKey);
    if (!fs.existsSync(filePath)) return 0;
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.trim()) return 0;
    return content.split('\n').filter(l => l.trim()).length;
}

function popStockLine(storeId, productKey) {
    const filePath = stockFilePath(storeId, productKey);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    if (!lines.length) return null;
    const item = lines.shift();
    fs.writeFileSync(filePath, lines.length ? lines.join('\n') + '\n' : '');
    return parseStockItem(item);
}

function getUserWallet(storeId, userId) {
    const users = loadStoreUsers(storeId);
    if (!users[userId]) {
        users[userId] = { balance: 0, spent: 0, name: '', registered: false };
    }
    return users[userId];
}

function isRegistered(storeId, userId) {
    const users = loadStoreUsers(storeId);
    return Boolean(users[userId]?.registered);
}

function registerUser(storeId, userId, name) {
    const users = loadStoreUsers(storeId);
    if (users[userId]?.registered) {
        return { ok: false, already: true, user: users[userId] };
    }
    const existing = users[userId] || {};
    users[userId] = {
        registered: true,
        registeredAt: Date.now(),
        name: name || existing.name || '',
        balance: existing.balance || 0,
        spent: existing.spent || 0
    };
    saveStoreUsers(storeId);
    return { ok: true, user: users[userId] };
}

function getRegisteredCount(storeId) {
    const users = loadStoreUsers(storeId);
    return Object.values(users).filter(u => u.registered).length;
}

function setUserName(storeId, userId, name) {
    if (!name) return getUserWallet(storeId, userId);
    const w = getUserWallet(storeId, userId);
    if (w.name !== name) {
        w.name = name;
        saveStoreUsers(storeId);
    }
    return w;
}

function addBalance(storeId, userId, amount, name) {
    const w = getUserWallet(storeId, userId);
    if (name) w.name = name;
    if (!w.registered) {
        w.registered = true;
        w.registeredAt = w.registeredAt || Date.now();
    }
    const prev = w.balance;
    w.balance += amount;
    saveStoreUsers(storeId);
    return { previous: prev, added: amount, newBalance: w.balance, wallet: w };
}

function buildCatalog(storeId) {
    const products = meta.products[storeId] || {};
    const perfiles = [];
    const completas = [];

    for (const [key, p] of Object.entries(products)) {
        const count = getStockCount(storeId, key);
        const line = `■ *${p.name}* 💲 ${p.price}\n   Disp: ${count} ${p.unitLabel}${count !== 1 ? 's' : ''}`;
        if (p.category === 'completa') completas.push(line);
        else perfiles.push(line);
    }

    let txt =
        `🛍️ *TIENDA VIRTUAL*\n` +
        `📌 *PRODUCTOS DISPONIBLES*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n`;

    if (perfiles.length) {
        txt += `👤 *PERFILES STREAMING*\n${perfiles.join('\n')}\n\n`;
    }
    if (completas.length) {
        txt += `📺 *CUENTAS COMPLETAS*\n${completas.join('\n')}\n\n`;
    }
    if (!perfiles.length && !completas.length) {
        txt += `_Sin productos configurados._\n\n`;
    }
    txt += `_Regístrate:_ *.registro*\n`;
    txt += `_Compra:_ *.comprar [producto]* · _Saldo:_ *.saldo*`;
    return txt.trim();
}

function findProductKey(storeId, query) {
    const q = normalizeProductKey(query);
    const products = meta.products[storeId] || {};
    if (products[q]) return q;
    for (const [key, p] of Object.entries(products)) {
        if (normalizeProductKey(p.name) === q) return key;
        if (key.includes(q) || q.includes(key)) return key;
    }
    return null;
}

function purchase(storeId, userId, productQuery, buyerName) {
    if (!isRegistered(storeId, userId)) {
        return { ok: false, error: 'NOT_REGISTERED' };
    }

    const key = findProductKey(storeId, productQuery);
    if (!key) return { ok: false, error: 'PRODUCT_NOT_FOUND' };

    const product = meta.products[storeId][key];
    if (getStockCount(storeId, key) === 0) {
        return { ok: false, error: 'NO_STOCK' };
    }

    const wallet = getUserWallet(storeId, userId);
    if (buyerName) wallet.name = buyerName;
    if (wallet.balance < product.price) {
        return { ok: false, error: 'INSUFFICIENT', balance: wallet.balance, price: product.price };
    }

    const credential = popStockLine(storeId, key);
    if (!credential) return { ok: false, error: 'NO_STOCK' };

    wallet.balance -= product.price;
    wallet.spent = (wallet.spent || 0) + product.price;
    saveStoreUsers(storeId);

    // Registrar venta en el historial
    const storeObj = meta.stores[storeId];
    if (storeObj) {
        if (!storeObj.sales) storeObj.sales = [];
        storeObj.sales.push({
            buyerId: userId,
            buyerName: buyerName || wallet.name || 'Usuario',
            productKey: key,
            productName: product.name,
            price: product.price,
            timestamp: Date.now()
        });
        saveMeta();
    }

    return {
        ok: true,
        product,
        productKey: key,
        credential,
        deliveryText: formatDeliveryMessage(credential, product.name),
        remaining: wallet.balance,
        wallet
    };
}

function migrateLegacyStore() {
    if (!fs.existsSync(LEGACY_FILE)) return;
    try {
        const old = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
        meta.stores = { ...meta.stores, ...(old.stores || {}) };
        meta.products = { ...meta.products, ...(old.products || {}) };
        meta.adminContext = { ...meta.adminContext, ...(old.adminContext || {}) };

        const storeIds = Object.keys(meta.stores);
        for (const storeId of storeIds) {
            const inv = old.inventory?.[storeId] || {};
            for (const [productKey, lines] of Object.entries(inv)) {
                if (Array.isArray(lines) && lines.length) {
                    addStockLines(storeId, productKey, lines);
                }
            }
            const users = loadStoreUsers(storeId);
            const legacyUsers = old.users || {};
            for (const [userId, u] of Object.entries(legacyUsers)) {
                if (!users[userId]) {
                    users[userId] = {
                        registered: Boolean(u.registered),
                        registeredAt: u.registeredAt || null,
                        name: u.name || '',
                        balance: u.balance || 0,
                        spent: u.spent || 0
                    };
                }
            }
            saveStoreUsers(storeId);
        }

        saveMetaNow();
        fs.renameSync(LEGACY_FILE, LEGACY_FILE + '.bak');
        console.log('✅ Tienda migrada a data/store/ (storedata.json → .bak)');
    } catch (e) {
        console.error('Error migrando storedata.json:', e);
    }
}

loadMeta();
migrateLegacyStore();

// Solo flush — el apagado del proceso lo controla index.js (gracefulShutdown)
process.on('beforeExit', flushAll);
process.on('SIGINT', flushAll);
function deductBalance(storeId, userId, amount, name) {
    const w = getUserWallet(storeId, userId);
    if (name) w.name = name;
    if (!w.registered) {
        w.registered = true;
        w.registeredAt = w.registeredAt || Date.now();
    }
    const prev = w.balance;
    w.balance = Math.max(0, w.balance - amount);
    saveStoreUsers(storeId);
    return { previous: prev, deducted: amount, newBalance: w.balance, wallet: w };
}

function getStoreUsersList(storeId) {
    const users = loadStoreUsers(storeId);
    return Object.entries(users)
        .filter(([id, u]) => u.registered)
        .map(([id, u]) => ({
            id,
            name: u.name || 'Usuario',
            balance: u.balance || 0,
            spent: u.spent || 0,
            registeredAt: u.registeredAt
        }));
}

function getSalesSummary(storeId) {
    const storeObj = meta.stores[storeId];
    if (!storeObj) return null;
    const sales = storeObj.sales || [];
    
    let totalRevenue = 0;
    const productStats = {};
    
    for (const s of sales) {
        totalRevenue += s.price;
        productStats[s.productName] = (productStats[s.productName] || 0) + 1;
    }
    
    return {
        storeId,
        groupName: storeObj.groupName,
        totalRevenue,
        totalSalesCount: sales.length,
        productStats,
        recentSales: sales.slice(-5).reverse(),
        linkedBy: storeObj.linkedBy || ''
    };
}

function getStoresSummaryForOwner() {
    const list = [];
    for (const [id, s] of Object.entries(meta.stores)) {
        if (!s.enabled) continue;
        const users = loadStoreUsers(id);
        const customerCount = Object.values(users).filter(u => u.registered).length;
        
        const products = meta.products[id] || {};
        let totalStock = 0;
        for (const prodKey of Object.keys(products)) {
            totalStock += getStockCount(id, prodKey);
        }
        
        const sales = s.sales || [];
        const revenue = sales.reduce((sum, sale) => sum + sale.price, 0);
        
        list.push({
            id,
            groupName: s.groupName,
            createdAt: s.createdAt,
            linkedBy: s.linkedBy || 'Desconocido',
            customerCount,
            productCount: Object.keys(products).length,
            totalStock,
            totalSalesCount: sales.length,
            revenue
        });
    }
    return list;
}

process.on('SIGTERM', flushAll);

module.exports = {
    flushAll,
    activateStore,
    getStoreByGroupId,
    getStoreById,
    listEnabledStores,
    countEnabledStores,
    setAdminContext,
    getAdminContext,
    setProduct,
    ensureProduct,
    updateProductPrice,
    listProducts,
    buildPricesList,
    addStockLines,
    addStockItems,
    getStockCount,
    parseStockItem,
    formatDeliveryMessage,
    getUserWallet,
    setUserName,
    addBalance,
    deductBalance,
    registerUser,
    isRegistered,
    getRegisteredCount,
    getStoreUsersList,
    buildCatalog,
    findProductKey,
    purchase,
    getSalesSummary,
    getStoresSummaryForOwner,
    normalizeProductKey,
    get storeData() { return meta; }
};
