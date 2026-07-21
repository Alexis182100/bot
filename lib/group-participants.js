/**
 * Participantes/admins siempre frescos desde WhatsApp Web (soporta @lid + @c.us).
 * No confiar en chat.participants cacheado: se re-extrae del navegador cuando hace falta.
 */

async function fetchParticipantsFromBrowser(client, groupId) {
    if (!client?.pupPage || !groupId) return [];
    try {
        const result = await client.pupPage.evaluate(async (gid) => {
            try {
                const chat = await window.WWebJS.getChat(gid, { getAsModel: false });
                if (!chat?.groupMetadata) return [];

                const GroupMetadata =
                    window.require('WAWebCollections').GroupMetadata ||
                    window.require('WAWebCollections').WAWebGroupMetadataCollection;
                try {
                    const wid = window.require('WAWebWidFactory').createWid(gid);
                    await GroupMetadata.update(wid);
                } catch (e) {}

                let toPn = (id) => id;
                try {
                    toPn = window.require('WAWebLidMigrationUtils').toPn;
                } catch (e) {}

                const parts = chat.groupMetadata.participants;
                let list = [];
                if (parts?.getModelsArray) list = parts.getModelsArray();
                else if (Array.isArray(parts)) list = parts;
                else if (parts && typeof parts === 'object') {
                    list = Object.values(parts).filter((p) => p && (p.id || p._serialized));
                }

                return list.map((p) => {
                    const raw = p.id || p;
                    const serialized =
                        raw._serialized ||
                        (raw.user ? `${raw.user}@${raw.server || 'c.us'}` : String(raw));
                    let pn = null;
                    const lid = serialized.includes('@lid') ? serialized : null;
                    try {
                        const converted = toPn(raw);
                        if (converted?._serialized) pn = converted._serialized;
                        else if (typeof converted === 'string') pn = converted;
                    } catch (e) {}
                    if (!pn && serialized.includes('@c.us')) pn = serialized;

                    const adminStr = String(p.admin || '').toLowerCase();
                    const isSuperAdmin = !!(
                        p.isSuperAdmin ||
                        adminStr === 'superadmin' ||
                        p.rank === 'SUPERADMIN'
                    );
                    const isAdmin = !!(
                        isSuperAdmin ||
                        p.isAdmin ||
                        adminStr === 'admin' ||
                        adminStr === 'superadmin' ||
                        p.rank === 'ADMIN' ||
                        p.rank === 'SUPERADMIN'
                    );

                    return {
                        id: {
                            _serialized: serialized,
                            user: String(serialized).split('@')[0]
                        },
                        _serialized: serialized,
                        pn,
                        lid,
                        isAdmin,
                        isSuperAdmin
                    };
                });
            } catch (e) {
                return [];
            }
        }, groupId);
        return Array.isArray(result) ? result : [];
    } catch (e) {
        console.error('fetchParticipantsFromBrowser:', e.message);
        return [];
    }
}

function collectIdVariants(value) {
    if (!value) return [];
    const s = String(value);
    const out = new Set([s, s.split('@')[0]]);
    const digits = s.replace(/\D/g, '');
    if (digits) {
        out.add(digits);
        out.add(digits.slice(-10));
        if (digits.length === 10) out.add(`521${digits}`);
        if (digits.length >= 10) out.add(`${digits}@c.us`);
    }
    return [...out];
}

function participantMatches(p, candidateSet) {
    const keys = [p._serialized, p.pn, p.lid, p.id?._serialized, p.id?.user];
    for (const k of keys) {
        for (const v of collectIdVariants(k)) {
            if (candidateSet.has(v)) return true;
        }
    }
    return false;
}

function buildCandidateSet(values) {
    const set = new Set();
    for (const v of values || []) {
        for (const x of collectIdVariants(v)) set.add(x);
    }
    return set;
}

/** Siempre intenta datos frescos del navegador; fallback a chat.participants */
async function getNormalizedParticipants(client, chat) {
    const groupId = chat?.id?._serialized;
    let list = await fetchParticipantsFromBrowser(client, groupId);
    if (!list.length && Array.isArray(chat?.participants) && chat.participants.length) {
        list = chat.participants.map((p) => {
            const ser = p.id?._serialized || '';
            return {
                id: p.id,
                _serialized: ser,
                pn: ser.includes('@c.us') ? ser : null,
                lid: ser.includes('@lid') ? ser : null,
                isAdmin: !!(
                    p.isAdmin ||
                    p.isSuperAdmin ||
                    p.admin === 'admin' ||
                    p.admin === 'superadmin'
                ),
                isSuperAdmin: !!(p.isSuperAdmin || p.admin === 'superadmin')
            };
        });
    }
    return list;
}

async function resolveLidPhoneCandidates(client, userId) {
    const ids = new Set(collectIdVariants(userId));
    if (!userId || !client) return [...ids];
    try {
        const pairs = await client.getContactLidAndPhone([userId]);
        const pair = Array.isArray(pairs) ? pairs[0] : pairs;
        if (pair?.lid) collectIdVariants(pair.lid).forEach((x) => ids.add(x));
        if (pair?.pn) collectIdVariants(pair.pn).forEach((x) => ids.add(x));
    } catch (e) {}
    try {
        const contact = await client.getContactById(userId);
        if (contact?.id?._serialized) {
            collectIdVariants(contact.id._serialized).forEach((x) => ids.add(x));
        }
        if (contact?.number) collectIdVariants(contact.number).forEach((x) => ids.add(x));
    } catch (e) {}
    return [...ids];
}

function participantIsAdmin(p) {
    if (!p) return false;
    const adminStr = String(p.admin || '').toLowerCase();
    return !!(
        p.isAdmin ||
        p.isSuperAdmin ||
        adminStr === 'admin' ||
        adminStr === 'superadmin'
    );
}

async function findParticipantFresh(client, chat, userId, extraCandidates = []) {
    const list = await getNormalizedParticipants(client, chat);
    const candidates = [
        ...(await resolveLidPhoneCandidates(client, userId)),
        ...extraCandidates
    ];
    const set = buildCandidateSet(candidates);
    const participant = list.find((p) => participantMatches(p, set)) || null;
    return { list, participant };
}

module.exports = {
    fetchParticipantsFromBrowser,
    getNormalizedParticipants,
    resolveLidPhoneCandidates,
    buildCandidateSet,
    participantMatches,
    participantIsAdmin,
    findParticipantFresh,
    collectIdVariants
};
