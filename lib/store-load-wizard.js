const {
    getPlatformByIndex,
    isAddServiceOption,
    buildPlatformMenu,
    buildAdminHelp,
    buildServicesList,
    addCustomService,
    normalizeKey
} = require('./store-platforms');

const SESSION_TTL_MS = 15 * 60 * 1000;
const sessions = new Map();

function getSession(adminId) {
    const s = sessions.get(adminId);
    if (!s) return null;
    if (Date.now() - s.updatedAt > SESSION_TTL_MS) {
        sessions.delete(adminId);
        return null;
    }
    return s;
}

function clearSession(adminId) {
    sessions.delete(adminId);
}

function touchSession(adminId, data) {
    const s = { ...data, updatedAt: Date.now() };
    sessions.set(adminId, s);
    return s;
}

function startWizard(adminId, storeId) {
    touchSession(adminId, { step: 'pick_platform', storeId, mode: 'load_stock' });
    return buildPlatformMenu(storeId);
}

function startAddServiceWizard(adminId, storeId) {
    touchSession(adminId, { step: 'new_svc_name', storeId, mode: 'add_service', draft: {} });
    return (
        `➕ *AGREGAR SERVICIO NUEVO*\n\n` +
        `📝 Paso 1/4 — Escribe el *nombre* del servicio:\n` +
        `_(ej: STAR PLUS, CLARO VIDEO, PEACOCK)_\n\n` +
        `*0.* Cancelar`
    );
}

function parseCredentials(text) {
    const t = (text || '').trim();
    if (!t) return null;

    if (t.includes('|')) {
        const parts = t.split('|').map(s => s.trim()).filter(Boolean);
        if (parts[0] && parts[1]) {
            return { email: parts[0], pass: parts[1], pin: parts[2] || null };
        }
    }

    const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2 && lines[0].includes('@')) {
        return { email: lines[0], pass: lines[1], pin: lines[2] || null };
    }

    const spaced = t.match(/^(\S+@\S+)\s+(.+)$/);
    if (spaced) {
        return { email: spaced[1], pass: spaced[2].trim(), pin: null };
    }

    const colon = t.match(/^(\S+@\S+)[:;](.+)$/);
    if (colon) {
        return { email: colon[1], pass: colon[2].trim(), pin: null };
    }

    return null;
}

function createProfileItems(platform, email, password) {
    const items = [];
    const accountTag = `${Date.now().toString(36)}`;
    for (let i = 1; i <= platform.profiles; i++) {
        items.push({
            email,
            pass: password,
            profile: i,
            platform: platform.key,
            type: 'perfil',
            accountTag
        });
    }
    return items;
}

function finishStockLoad(adminId, session, platform, category, creds, storeApi) {
    const storeId = session.storeId;
    const productKey = category === 'completa'
        ? `${platform.key}_completa`
        : platform.key;

    storeApi.ensureProduct(storeId, productKey, platform, category);

    let items;
    if (category === 'perfil') {
        items = createProfileItems(platform, creds.email, creds.pass);
    } else {
        items = [{
            email: creds.email,
            pass: creds.pass,
            pin: creds.pin || null,
            platform: platform.key,
            type: 'completa'
        }];
    }

    const added = storeApi.addStockItems(storeId, productKey, items);
    const total = storeApi.getStockCount(storeId, productKey);
    clearSession(adminId);

    const typeLabel = category === 'perfil'
        ? `${added} perfiles (${platform.profiles} por cuenta)`
        : '1 cuenta completa';

    return (
        `✅ *STOCK AGREGADO*\n\n` +
        `${platform.emoji} *${platform.name}* (${category})\n` +
        `➕ Agregado: ${typeLabel}\n` +
        `📦 Total en tienda: *${total}*\n` +
        `🆔 Tienda: \`${storeId}\`\n\n` +
        `¿Más stock? → *.cargar*`
    );
}

function handleAddServiceSteps(adminId, session, body) {
    const draft = session.draft || {};

    if (session.step === 'new_svc_name') {
        if (body.length < 2) return '⚠️ Nombre muy corto. Ej: *STAR PLUS*';
        draft.name = body.trim();
        touchSession(adminId, { ...session, step: 'new_svc_profiles', draft });
        return (
            `✅ Nombre: *${draft.name}*\n\n` +
            `📝 Paso 2/4 — ¿Cuántos *perfiles* por cuenta?\n\n` +
            `• Escribe un número (ej: *6*)\n` +
            `• *0* = solo cuentas completas\n\n` +
            `*↩️* Cancelar menú: *0*`
        );
    }

    if (session.step === 'new_svc_profiles') {
        const n = parseInt(body, 10);
        if (isNaN(n) || n < 0 || n > 20) {
            return '⚠️ Escribe un número entre *0* y *20* (0 = solo completas).';
        }
        draft.profiles = n;
        draft.completaOnly = n === 0;
        touchSession(adminId, { ...session, step: 'new_svc_prices', draft });
        if (n === 0) {
            return (
                `✅ Solo *cuentas completas*\n\n` +
                `📝 Paso 3/4 — Precio de la cuenta completa:\n` +
                `_(ej: *25*)_`
            );
        }
        return (
            `✅ *${n} perfiles* por cuenta\n\n` +
            `📝 Paso 3/4 — Precios en formato:\n` +
            `\`precio_perfil|precio_completa\`\n\n` +
            `Ejemplo: \`8|30\` → perfil $8, completa $30`
        );
    }

    if (session.step === 'new_svc_prices') {
        if (draft.completaOnly) {
            const price = parseFloat(body);
            if (isNaN(price) || price <= 0) return '⚠️ Precio inválido. Ej: *25*';
            draft.priceCompleta = price;
            draft.pricePerfil = 0;
        } else {
            const parts = body.split('|').map(s => s.trim());
            if (parts.length < 2) {
                return '⚠️ Usa: `precio_perfil|precio_completa`\nEj: `8|30`';
            }
            const pp = parseFloat(parts[0]);
            const pc = parseFloat(parts[1]);
            if (isNaN(pp) || isNaN(pc) || pp <= 0 || pc <= 0) {
                return '⚠️ Precios inválidos. Ej: `8|30`';
            }
            draft.pricePerfil = pp;
            draft.priceCompleta = pc;
        }
        touchSession(adminId, { ...session, step: 'new_svc_emoji', draft });
        return (
            `📝 Paso 4/4 — Emoji del servicio:\n\n` +
            `Envía un emoji (ej: ⭐ 🎮 📱)\n` +
            `o *-* para usar 📦 por defecto`
        );
    }

    if (session.step === 'new_svc_emoji') {
        draft.emoji = body === '-' ? '📦' : body.trim().slice(0, 4);

        const existingKey = normalizeKey(draft.name);
        const platform = addCustomService(session.storeId, draft);
        if (!platform) {
            clearSession(adminId);
            return '❌ No se pudo crear el servicio. Intenta otro nombre.';
        }

        touchSession(adminId, {
            step: 'pick_type',
            storeId: session.storeId,
            mode: 'load_stock',
            platform,
            afterCreate: true
        });

        if (platform.completaOnly) {
            touchSession(adminId, {
                ...getSession(adminId),
                step: 'await_credentials',
                category: 'completa'
            });
            return (
                `✅ *Servicio creado:* ${platform.emoji} *${platform.name}*\n` +
                `🔑 Clave: \`${existingKey}\`\n\n` +
                `📧 Ahora envía credenciales para la primera cuenta:\n` +
                `\`correo@mail.com|contraseña\`\n\n` +
                `_Omitir y cargar después:_ *.cancelarcarga*`
            );
        }

        return (
            `✅ *Servicio creado:* ${platform.emoji} *${platform.name}*\n` +
            `🔑 Clave: \`${existingKey}\`\n` +
            `👤 ${platform.profiles} perfiles/cuenta · $${platform.pricePerfil} perfil · $${platform.priceCompleta} completa\n\n` +
            `¿Cargar stock ahora?\n\n` +
            `*1.* 👤 Perfiles (correo+pass → ${platform.profiles} perfiles)\n` +
            `*2.* 📺 Cuenta completa\n` +
            `*0.* Después (usa *.cargar*)`
        );
    }

    return null;
}

function handleWizardInput(adminId, text, storeApi) {
    const session = getSession(adminId);
    if (!session) return null;

    const body = (text || '').trim();
    if (!body) return '⚠️ Envía un mensaje válido o *0* para cancelar.';

    if (body === '0' || body.toLowerCase() === 'cancelar') {
        clearSession(adminId);
        return '❌ *Cancelado.*\n\n*.cargar* — stock · *.agregarservicio* — nuevo servicio';
    }

    if (session.mode === 'add_service') {
        return handleAddServiceSteps(adminId, session, body);
    }

    if (session.step === 'pick_platform') {
        if (isAddServiceOption(body, session.storeId)) {
            return startAddServiceWizard(adminId, session.storeId);
        }

        const platform = getPlatformByIndex(body, session.storeId);
        if (!platform) {
            return '⚠️ Número inválido.\n\n' + buildPlatformMenu(session.storeId);
        }
        touchSession(adminId, { ...session, step: 'pick_type', platform });

        if (platform.completaOnly) {
            touchSession(adminId, {
                ...getSession(adminId),
                step: 'await_credentials',
                category: 'completa'
            });
            return (
                `✅ *${platform.name}* (cuenta completa)\n\n` +
                `📧 Envía correo y contraseña:\n` +
                `\`correo@mail.com|contraseña\`\n\n` +
                `_PIN opcional:_ \`correo|pass|pin\`\n` +
                `*0.* Cancelar`
            );
        }

        return (
            `✅ *${platform.name}* seleccionado\n\n` +
            `¿Qué tipo de stock cargas?\n\n` +
            `*1.* 👤 *Perfiles* — *${platform.profiles} perfiles* por cuenta\n` +
            `*2.* 📺 *Cuenta completa*\n` +
            `*0.* Cancelar`
        );
    }

    if (session.step === 'pick_type') {
        if (body === '0' && session.afterCreate) {
            clearSession(adminId);
            return `✅ Servicio listo. Carga stock cuando quieras con *.cargar*`;
        }
        if (body === '1') {
            touchSession(adminId, { ...session, step: 'await_credentials', category: 'perfil' });
            return (
                `👤 *PERFILES — ${session.platform.name}*\n\n` +
                `📧 Envía *correo y contraseña*:\n` +
                `\`correo@mail.com|contraseña\`\n\n` +
                `🤖 Se crearán *${session.platform.profiles} perfiles* (1–${session.platform.profiles})\n` +
                `*0.* Cancelar`
            );
        }
        if (body === '2') {
            touchSession(adminId, { ...session, step: 'await_credentials', category: 'completa' });
            return (
                `📺 *CUENTA COMPLETA — ${session.platform.name}*\n\n` +
                `📧 Envía credenciales:\n` +
                `\`correo@mail.com|contraseña\`\n` +
                `_PIN:_ \`correo|pass|pin\`\n` +
                `*0.* Cancelar`
            );
        }
        return '⚠️ Responde *1* (perfiles) o *2* (completa).';
    }

    if (session.step === 'await_credentials') {
        const creds = parseCredentials(body);
        if (!creds?.email || !creds.pass) {
            return (
                '⚠️ No pude leer correo/contraseña.\n\n' +
                '`correo@mail.com|contraseña`\n\n' +
                '*0.* Cancelar'
            );
        }
        return finishStockLoad(adminId, session, session.platform, session.category, creds, storeApi);
    }

    return null;
}

function hasActiveSession(adminId) {
    return Boolean(getSession(adminId));
}

module.exports = {
    startWizard,
    startAddServiceWizard,
    handleWizardInput,
    clearSession,
    hasActiveSession,
    buildAdminHelp,
    buildServicesList,
    parseCredentials
};
