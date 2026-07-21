/**
 * Participantes/admins SIEMPRE frescos desde WhatsApp Web.
 * Reconoce a TODOS los admins: cruza el remitente contra CADA admin del grupo
 * expandiendo @lid + teléfono en ambos lados (no solo los que tienen teléfono).
 */

/** ¿Este usuario es admin AHORA en este grupo? */
async function isUserAdminInGroup(client, groupId, userIds) {
    if (!client?.pupPage || !groupId) return false;
    const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String);
    if (!ids.length) return false;

    try {
        return await client.pupPage.evaluate(async (gid, idList) => {
            const getChat = async () => {
                try {
                    return await window.WWebJS.getChat(gid, { getAsModel: false });
                } catch (e) {
                    try {
                        const Chat = window.require('WAWebCollections').Chat;
                        return Chat.get(gid) || Chat.find(gid);
                    } catch (e2) {
                        return null;
                    }
                }
            };

            const chat = await getChat();
            if (!chat?.groupMetadata?.participants) return false;

            try {
                const GM =
                    window.require('WAWebCollections').GroupMetadata ||
                    window.require('WAWebCollections').WAWebGroupMetadataCollection;
                if (GM?.update) {
                    try {
                        const WidFactory = window.require('WAWebWidFactory');
                        await GM.update(WidFactory.createWid(gid));
                    } catch (e) {
                        try { await GM.update(gid); } catch (e2) {}
                    }
                }
            } catch (e) {}

            const parts = chat.groupMetadata.participants;
            const arr = parts?.getModelsArray
                ? parts.getModelsArray()
                : Array.isArray(parts)
                  ? parts
                  : Object.values(parts || {}).filter((p) => p && p.id);

            const checkAdmin = (p) => {
                if (!p) return false;
                const adminStr = String(p.admin || '').toLowerCase();
                return !!(
                    p.isAdmin ||
                    p.isSuperAdmin ||
                    adminStr === 'admin' ||
                    adminStr === 'superadmin' ||
                    p.rank === 'ADMIN' ||
                    p.rank === 'SUPERADMIN'
                );
            };

            const addKeys = (set, raw) => {
                if (!raw) return;
                const s = String(raw._serialized || raw.user || raw);
                if (!s || s === 'undefined' || s === 'null') return;
                set.add(s);
                set.add(s.split('@')[0]);
                const d = s.replace(/\D/g, '');
                if (d.length >= 8) {
                    set.add(d);
                    set.add(d.slice(-10));
                    set.add(d.slice(-8));
                }
            };

            const expand = async (raw) => {
                const set = new Set();
                addKeys(set, raw);
                const asStr = String(raw?._serialized || raw || '');
                if (!asStr) return set;
                try {
                    const both = await window.WWebJS.enforceLidAndPnRetrieval(asStr);
                    addKeys(set, both?.lid);
                    addKeys(set, both?.phone);
                } catch (e) {}
                try {
                    const Contact = window.require('WAWebCollections')?.Contact;
                    const contact = Contact?.get?.(asStr);
                    if (contact) {
                        addKeys(set, contact.id);
                        addKeys(set, contact.phoneNumber);
                        addKeys(set, contact.lid);
                    }
                } catch (e) {}
                return set;
            };

            // Remitente: todas sus identidades
            const senderSet = new Set();
            for (const id of idList) {
                const s = await expand(id);
                s.forEach((x) => senderSet.add(x));
            }
            if (!senderSet.size) return false;

            // Lookup directo por Collection.get
            if (typeof parts.get === 'function') {
                for (const key of senderSet) {
                    if (!String(key).includes('@')) continue;
                    try {
                        const p = parts.get(key);
                        if (checkAdmin(p)) return true;
                    } catch (e) {}
                }
            }

            // CLAVE: recorrer TODOS los admins del grupo y cruzar IDs
            for (const p of arr) {
                if (!checkAdmin(p)) continue;
                const adminKeys = await expand(p.id);
                try {
                    if (p.contact?.id) {
                        const more = await expand(p.contact.id);
                        more.forEach((x) => adminKeys.add(x));
                    }
                } catch (e) {}
                for (const k of adminKeys) {
                    if (senderSet.has(k)) return true;
                }
            }

            return false;
        }, groupId, ids);
    } catch (e) {
        console.error('isUserAdminInGroup:', e.message);
        return false;
    }
}

async function fetchParticipantsFromBrowser(client, groupId) {
    if (!client?.pupPage || !groupId) return [];
    try {
        const result = await client.pupPage.evaluate(async (gid) => {
            try {
                let chat = null;
                try {
                    chat = await window.WWebJS.getChat(gid, { getAsModel: false });
                } catch (e) {
                    try {
                        const Chat = window.require('WAWebCollections').Chat;
                        chat = Chat.get(gid) || Chat.find(gid);
                    } catch (e2) {}
                }
                if (!chat?.groupMetadata) return [];

                try {
                    const GM =
                        window.require('WAWebCollections').GroupMetadata ||
                        window.require('WAWebCollections').WAWebGroupMetadataCollection;
                    if (GM?.update) {
                        try {
                            const WidFactory = window.require('WAWebWidFactory');
                            await GM.update(WidFactory.createWid(gid));
                        } catch (e) {
                            try { await GM.update(gid); } catch (e2) {}
                        }
                    }
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

                const out = [];
                for (const p of list) {
                    const raw = p.id || p;
                    const serialized =
                        raw._serialized ||
                        (raw.user ? `${raw.user}@${raw.server || 'c.us'}` : String(raw));

                    let pn = null;
                    let lid = serialized.includes('@lid') ? serialized : null;
                    try {
                        const converted = toPn(raw);
                        if (converted?._serialized) pn = converted._serialized;
                        else if (typeof converted === 'string') pn = converted;
                    } catch (e) {}

                    try {
                        const both = await window.WWebJS.enforceLidAndPnRetrieval(serialized);
                        if (both?.lid?._serialized) lid = both.lid._serialized;
                        if (both?.phone?._serialized) pn = both.phone._serialized;
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

                    out.push({
                        id: {
                            _serialized: serialized,
                            user: String(serialized).split('@')[0]
                        },
                        _serialized: serialized,
                        pn,
                        lid,
                        isAdmin,
                        isSuperAdmin
                    });
                }
                return out;
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

async function fetchGroupNameFromBrowser(client, groupId) {
    if (!client?.pupPage || !groupId) return null;
    try {
        return await client.pupPage.evaluate(async (gid) => {
            try {
                let chat = null;
                try {
                    chat = await window.WWebJS.getChat(gid, { getAsModel: false });
                } catch (e) {
                    const Chat = window.require('WAWebCollections').Chat;
                    chat = Chat.get(gid) || Chat.find(gid);
                }
                return chat?.formattedTitle || chat?.name || chat?.groupMetadata?.subject || null;
            } catch (e) {
                return null;
            }
        }, groupId);
    } catch (e) {
        return null;
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
        if (digits.length === 10) {
            out.add(`521${digits}`);
            out.add(`521${digits}@c.us`);
        }
        if (digits.length >= 10) {
            out.add(`${digits}@c.us`);
            out.add(`${digits}@lid`);
        }
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

async function resolveIsGroupAdmin(client, chat, msg, senderNumber) {
    const groupId = chat?.id?._serialized;
    const authorId = msg?.author || msg?.from;
    const contactId = msg?._data?.author || msg?._data?.participant || null;

    const idBag = new Set([
        authorId,
        contactId,
        senderNumber,
        senderNumber ? `${senderNumber}@c.us` : null,
        senderNumber ? `${String(senderNumber).slice(-10)}@c.us` : null,
        senderNumber ? `${senderNumber}@lid` : null,
        msg?.author,
        msg?.from
    ].filter(Boolean));

    try {
        const contact = await msg.getContact();
        if (contact?.id?._serialized) idBag.add(contact.id._serialized);
        if (contact?.number) {
            idBag.add(contact.number);
            idBag.add(`${contact.number}@c.us`);
        }
    } catch (e) {}

    const ids = [...idBag];
    if (await isUserAdminInGroup(client, groupId, ids)) return true;

    const { list, participant } = await findParticipantFresh(client, chat, authorId, ids);
    if (participantIsAdmin(participant)) return true;

    // Último intento: cruzar lista de admins vs ids del remitente en Node
    const senderSet = buildCandidateSet(ids);
    for (const p of list) {
        if (!participantIsAdmin(p)) continue;
        if (participantMatches(p, senderSet)) return true;
    }
    return false;
}

module.exports = {
    isUserAdminInGroup,
    fetchParticipantsFromBrowser,
    fetchGroupNameFromBrowser,
    getNormalizedParticipants,
    resolveLidPhoneCandidates,
    buildCandidateSet,
    participantMatches,
    participantIsAdmin,
    findParticipantFresh,
    resolveIsGroupAdmin,
    collectIdVariants
};
