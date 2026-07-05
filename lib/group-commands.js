// Comandos personalizados AISLADOS POR GRUPO
// Cada grupo guarda los suyos en data/groups/{groupId}/commands.json
// — lo que se crea en un grupo NO aparece en los demás.
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./debounced-io');

const GROUPS_DIR = path.join(__dirname, '..', 'data', 'groups');
const SAVE_DELAY_MS = 800;

// cache: groupId → { commands: {...}, timer }
const cache = new Map();

function sanitizeId(groupId) {
    return String(groupId).replace(/[^a-zA-Z0-9@._-]/g, '_');
}

function fileFor(groupId) {
    return path.join(GROUPS_DIR, sanitizeId(groupId), 'commands.json');
}

function load(groupId) {
    let entry = cache.get(groupId);
    if (entry) return entry;
    let commands = {};
    try {
        const fp = fileFor(groupId);
        if (fs.existsSync(fp)) {
            commands = JSON.parse(fs.readFileSync(fp, 'utf8')) || {};
        }
    } catch (e) {
        console.error(`Error leyendo comandos del grupo ${groupId}:`, e.message);
    }
    entry = { commands, timer: null };
    cache.set(groupId, entry);
    return entry;
}

function scheduleSave(groupId) {
    const entry = cache.get(groupId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
        const fp = fileFor(groupId);
        ensureDir(path.dirname(fp));
        fs.promises.writeFile(fp, JSON.stringify(entry.commands, null, 2))
            .catch(err => console.error(`Error guardando comandos del grupo ${groupId}:`, err));
    }, SAVE_DELAY_MS);
}

function getGroupCommand(groupId, name) {
    if (!groupId || !name) return null;
    return load(groupId).commands[name] || null;
}

function hasGroupCommand(groupId, name) {
    return !!getGroupCommand(groupId, name);
}

function setGroupCommand(groupId, name, data) {
    const entry = load(groupId);
    entry.commands[name] = data;
    scheduleSave(groupId);
}

function deleteGroupCommand(groupId, name) {
    const entry = load(groupId);
    if (!entry.commands[name]) return false;
    delete entry.commands[name];
    scheduleSave(groupId);
    return true;
}

function listGroupCommands(groupId) {
    return Object.keys(load(groupId).commands);
}

function countGroupCommands(groupId) {
    return listGroupCommands(groupId).length;
}

function flushAll() {
    for (const [groupId, entry] of cache.entries()) {
        if (!entry.timer) continue;
        clearTimeout(entry.timer);
        entry.timer = null;
        try {
            const fp = fileFor(groupId);
            ensureDir(path.dirname(fp));
            fs.writeFileSync(fp, JSON.stringify(entry.commands, null, 2));
        } catch (e) {}
    }
}

module.exports = {
    getGroupCommand,
    hasGroupCommand,
    setGroupCommand,
    deleteGroupCommand,
    listGroupCommands,
    countGroupCommands,
    flushAll
};
