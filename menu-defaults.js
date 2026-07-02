const STREAMING = new Set([
    'netflix', 'disney', 'hbo', 'max', 'primevideo', 'prime', 'spotify', 'apple', 'youtube',
    'crunchyroll', 'vix', 'paramount', 'universal', 'deezer', 'tidal', 'soundcloud', 'audible',
    'kindle', 'scribd', 'twitch', 'kick', 'peliculas', 'cinepolis', 'cinemex'
]);

const GAMING = new Set([
    'diamantes', 'robux', 'gamepass', 'freefire', 'pasesff', 'minecraft', 'fortnite', 'valorant',
    'lol', 'cod', 'fifa', 'pes', 'nba2k', 'gta', 'steam', 'epicgames', 'battlenet', 'origin',
    'ubisoft', 'nintendo', 'xbox', 'psplus', 'pubg', 'mobilelegends', 'clash', 'brawlstars',
    'genshin', 'honkai', 'pokemon', 'digimon', 'diamante', 'gemas', 'monedas', 'creditos',
    'tokens', 'pases', 'skin', 'battlepass', 'seasonpass', 'fragmentos', '4vs4', '6vs6', '8vs8',
    '12vs12', '16vs16', '20vs20', '24vs24', 'donarsala', 'iniciales', 'reglaslideres', 'reglaslideres2'
]);

const DOCUMENTS = new Set([
    'actas', 'rfc', 'documentos', 'penales', 'pasaporte', 'licencias', 'imss', 'recetas', 'pape',
    'requisitos', 'sat', 'refacturas', 'carta', 'buro', 'pruebas', 'infonavit', 'nss', 'certificados',
    'constancias', 'justificantes', 'curp', 'ine', 'cedula', 'cedulaprof', 'titulo', 'constancia',
    'diploma', 'certificado', 'tramites', 'universidad', 'facturas', 'declaracion', 'iva', 'isr'
]);

const PAYMENT = new Set([
    'pago', 'metodo', 'metodos', 'paypal', 'mercadopago', 'oxxo', 'spei', 'transferencia',
    'binance', 'bitcoin', 'usdt', 'ethereum', 'crypto', 'visa', 'mastercard', 'amex', 'tarjetacredito'
]);

const DESIGN = new Set([
    'canva', 'logo', 'banner', 'flyer', 'tarjeta', 'invitacion', 'figma', 'adobe', 'photoshop',
    'illustrator', 'edicion', 'animacion', 'render', 'modelado3d', 'foto', 'video'
]);

const SPECIAL_DEFAULTS = {
    comandos: `📋 *COMANDOS DEL BOT*\n\n• *.menuprincipal* — Menú principal\n• *.menugrupo* — Comandos del grupo\n• *.menuadmins* — Administración\n• *.menufun* — Diversión\n• *.menuherramientas* — Herramientas\n• *.totalcomandos* — Ver total de comandos\n\n_Configura cada uno con .setnombre contenido_`,
    reglas: `📜 *REGLAS DEL GRUPO*\n\n1. Respeto entre todos los miembros\n2. No spam ni flood\n3. No enlaces sin permiso\n4. Trato directo con administración\n\n_Admin: *.setreglas* para personalizar._`,
    aviso: `📢 *AVISO IMPORTANTE*\n\nRevisa los mensajes fijados y contacta a un administrador si tienes dudas.\n\n_Admin: *.setaviso* para editar este mensaje._`,
    servicios: `🛎️ *SERVICIOS DISPONIBLES*\n\nConsulta el catálogo con *.menugrupo* o *.menuprincipal*.\nCada servicio tiene su comando: *.netflix*, *.spotify*, *.disney*, etc.\n\n_Admin: *.set[nombre]* para poner precios e info._`,
    extras: `✨ *EXTRAS*\n\nServicios adicionales disponibles bajo pedido.\nEscribe el comando del producto o pregunta a un admin.\n\n_Admin: *.setextras* para configurar._`,
    reportes: `📊 *REPORTES*\n\nPara reportar un problema, contacta a un administrador con evidencia.\n\n_Admin: *.setreportes* para configurar el proceso._`,
    contacto: `📞 *CONTACTO*\n\nEscríbele a un administrador del grupo para atención personalizada.`,
    horarioatencion: `🕐 *HORARIO DE ATENCIÓN*\n\nConsulta disponibilidad con un administrador.\n\n_Admin: *.sethorarioatencion* para configurar._`,
    faq: `❓ *PREGUNTAS FRECUENTES*\n\n• ¿Cómo compro? → Pregunta al admin o usa *.pago*\n• ¿Métodos de pago? → *.pago*\n• ¿Ver productos? → *.menugrupo*\n\n_Admin: *.setfaq* para personalizar._`
};

function formatCommandLabel(cmdName) {
    if (SPECIAL_DEFAULTS[cmdName]) return cmdName.charAt(0).toUpperCase() + cmdName.slice(1);
    const numMatch = cmdName.match(/^([a-z]+)(\d+)$/i);
    if (numMatch) {
        const base = numMatch[1].replace(/([a-z])([A-Z])/g, '$1 $2');
        return `${base.charAt(0).toUpperCase() + base.slice(1)} ${numMatch[2]}`;
    }
    return cmdName
        .replace(/(\d+)vs(\d+)/g, '$1 vs $2')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

function detectCategory(cmdName) {
    if (SPECIAL_DEFAULTS[cmdName]) return 'special';
    if (STREAMING.has(cmdName)) return 'streaming';
    if (GAMING.has(cmdName)) return 'gaming';
    if (DOCUMENTS.has(cmdName)) return 'documents';
    if (PAYMENT.has(cmdName) || /^pago\d*$/i.test(cmdName)) return 'payment';
    if (DESIGN.has(cmdName)) return 'design';
    if (/^stock\d*$/i.test(cmdName)) return 'stock';
    if (/^paquete\d*$/i.test(cmdName) || /^pack\d+$/i.test(cmdName)) return 'package';
    if (/^combos?\d*$/i.test(cmdName) || /^combo\d+$/i.test(cmdName)) return 'combo';
    if (/^producto\d+$/i.test(cmdName) || /^item\d+$/i.test(cmdName)) return 'product';
    if (/^servicio\d+$/i.test(cmdName)) return 'service';
    if (/^premium\d+$/i.test(cmdName) || /^app\d+$/i.test(cmdName)) return 'premium';
    if (/^catalogo\d+$/i.test(cmdName)) return 'catalog';
    if (/^oferta\d+$/i.test(cmdName) || /^promo\d*$/i.test(cmdName) || /^plan\d+$/i.test(cmdName)) return 'promo';
    if (/^lote\d*$/i.test(cmdName) || /^membresia\d+$/i.test(cmdName) || /^suscripcion\d+$/i.test(cmdName) || /^cuenta\d+$/i.test(cmdName)) return 'membership';
    if (/^(blackfriday|cybermonday|hotsale|navidad|buenfin|sanvalentin)/i.test(cmdName)) return 'promo';
    return 'general';
}

const CATEGORY_ICONS = {
    streaming: '🎬',
    gaming: '🎮',
    documents: '📄',
    payment: '💳',
    design: '🎨',
    stock: '📦',
    package: '📦',
    combo: '🎁',
    product: '🛍️',
    service: '🛎️',
    premium: '⭐',
    catalog: '📒',
    promo: '🔥',
    membership: '💎',
    general: '📌'
};

function buildDefaultMenuText(cmdName) {
    if (SPECIAL_DEFAULTS[cmdName]) return SPECIAL_DEFAULTS[cmdName];

    const category = detectCategory(cmdName);
    const icon = CATEGORY_ICONS[category] || '📌';
    const label = formatCommandLabel(cmdName);

    const footers = {
        streaming: 'Plataforma de streaming — solicita precios y disponibilidad.',
        gaming: 'Producto gaming — consulta stock y precios con un admin.',
        documents: 'Trámite o documento — pregunta requisitos y tiempos de entrega.',
        payment: 'Método de pago — usa también *.pago* para ver el método activo del grupo.',
        design: 'Servicio de diseño — solicita cotización al administrador.',
        stock: 'Producto en inventario — el admin puede vincularlo con *.setstock*.',
        package: 'Paquete disponible — pregunta contenido y precio.',
        combo: 'Combo promocional — consulta qué incluye y su costo.',
        product: 'Producto del catálogo — disponible bajo pedido.',
        service: 'Servicio disponible — contacta a un administrador.',
        premium: 'Cuenta premium / app — verifica disponibilidad y vigencia.',
        catalog: 'Ítem del catálogo — pide detalles al admin.',
        promo: 'Promoción activa — aprovecha antes de que termine.',
        membership: 'Membresía o lote — consulta planes y vigencia.',
        general: 'Servicio disponible en este grupo.'
    };

    return (
        `${icon} *${label.toUpperCase()}*\n\n` +
        `✅ ${footers[category]}\n\n` +
        `📩 Escribe al administrador o revisa *.pago* para métodos de pago.\n\n` +
        `_Admin: *.set${cmdName}* tu info/precios para personalizar este comando._`
    );
}

function buildDefaultCustomText(cmdName) {
    const label = formatCommandLabel(cmdName);
    return (
        `📌 *${label}*\n\n` +
        `Comando personalizado del grupo.\n\n` +
        `_Admin: *.set${cmdName}* para configurar el contenido._`
    );
}

function hasCommandContent(data) {
    return !!(data && (data.text?.trim() || (data.image && data.mimetype)));
}

module.exports = {
    buildDefaultMenuText,
    buildDefaultCustomText,
    hasCommandContent,
    formatCommandLabel,
    detectCategory,
    SPECIAL_DEFAULTS
};
