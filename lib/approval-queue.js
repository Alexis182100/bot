const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./debounced-io');

const QUEUE_FILE = path.join(__dirname, '..', 'data', 'pending-requests.json');

let queue = { requests: [] };

function loadQueue() {
    ensureDir(path.dirname(QUEUE_FILE));
    if (fs.existsSync(QUEUE_FILE)) {
        try {
            queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
        } catch (e) {
            queue = { requests: [] };
        }
    }
    if (!Array.isArray(queue.requests)) queue.requests = [];
}

function saveQueue() {
    ensureDir(path.dirname(QUEUE_FILE));
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

function generateRequestId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id;
    do {
        id = '';
        for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
    } while (queue.requests.some(r => r.id === id && r.status === 'pending'));
    return id;
}

function findPending(groupId, type) {
    return queue.requests.find(r => r.status === 'pending' && r.groupId === groupId && r.type === type);
}

function createRequest({ type, groupId, groupName, requester, requesterName, ownerInGroup, inviteLink, botPhone }) {
    const existing = findPending(groupId, type);
    if (existing) return { duplicate: true, request: existing };

    const request = {
        id: generateRequestId(),
        type,
        groupId,
        groupName: groupName || 'Grupo',
        requester,
        requesterName: requesterName || requester || 'Admin',
        ownerInGroup: !!ownerInGroup,
        inviteLink: inviteLink || null,
        botPhone: botPhone || null,
        status: 'pending',
        createdAt: Date.now()
    };
    queue.requests.unshift(request);
    if (queue.requests.length > 100) queue.requests.length = 100;
    saveQueue();
    return { duplicate: false, request };
}

function getRequest(id) {
    const key = String(id || '').trim().toUpperCase();
    return queue.requests.find(r => r.id === key) || null;
}

function listPending() {
    return queue.requests.filter(r => r.status === 'pending');
}

function setRequestStatus(id, status) {
    const req = getRequest(id);
    if (!req || req.status !== 'pending') return null;
    req.status = status;
    req.resolvedAt = Date.now();
    saveQueue();
    return req;
}

function buildOwnerNotification(request) {
    const typeLabel = request.type === 'store' ? '🛍️ TIENDA' : '🤖 BOT';
    let txt =
        `📩 *NUEVA PETICIÓN — ${typeLabel}*\n\n` +
        `🆔 ID: *${request.id}*\n` +
        `📍 Grupo: *${request.groupName}*\n` +
        `👤 Solicita: *${request.requesterName}*\n` +
        `📱 Número: \`${request.requester}\`\n` +
        `👁️ Tú en el grupo: ${request.ownerInGroup ? '✅ Sí' : '❌ No'}\n`;

    if (!request.ownerInGroup && request.inviteLink) {
        txt += `\n🔗 *Enlace del grupo:*\n${request.inviteLink}\n`;
    } else if (!request.ownerInGroup && !request.inviteLink) {
        txt += `\n⚠️ _No pude obtener enlace (el bot debe ser admin del grupo)._\n`;
    }

    txt +=
        `\n*Responder en este chat:*\n` +
        `✅ *.aprobar ${request.id}*\n` +
        `❌ *.rechazar ${request.id}*`;

    return txt;
}

function buildFleetReport({ botPhone, activeGroupCount, storeCount, pendingCount, activeGroups, stores }) {
    let txt =
        `📊 *REPORTE DEL BOT*\n\n` +
        `🤖 Número: \`${botPhone || 'N/A'}\`\n` +
        `🟢 Grupos activos: *${activeGroupCount}*\n` +
        `🛍️ Con tienda: *${storeCount}*\n` +
        `⏳ Peticiones pendientes: *${pendingCount}*\n`;

    if (activeGroups?.length) {
        txt += `\n*Grupos con bot activo:*\n`;
        for (const g of activeGroups.slice(0, 15)) {
            txt += `• ${g}\n`;
        }
        if (activeGroups.length > 15) txt += `_…y ${activeGroups.length - 15} más_\n`;
    }

    if (stores?.length) {
        txt += `\n*Tiendas activas:*\n`;
        for (const s of stores.slice(0, 15)) {
            txt += `• \`${s.id}\` — ${s.groupName}\n`;
        }
        if (stores.length > 15) txt += `_…y ${stores.length - 15} más_\n`;
    }

    txt += `\n_Comando manual: *.reporte*_`;
    return txt.trim();
}

loadQueue();

module.exports = {
    createRequest,
    getRequest,
    listPending,
    setRequestStatus,
    findPending,
    buildOwnerNotification,
    buildFleetReport,
    loadQueue
};
