const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function createDebouncedWriter(filePath, delayMs = 500) {
    let timer = null;
    let pending = null;

    function schedule(data) {
        pending = data;
        clearTimeout(timer);
        timer = setTimeout(() => {
            const toWrite = pending;
            pending = null;
            ensureDir(path.dirname(filePath));
            fs.promises.writeFile(filePath, JSON.stringify(toWrite))
                .catch(err => console.error(`Error guardando ${filePath}:`, err));
        }, delayMs);
    }

    function flushSync(data) {
        clearTimeout(timer);
        pending = null;
        ensureDir(path.dirname(filePath));
        fs.writeFileSync(filePath, JSON.stringify(data));
    }

    return { schedule, flushSync };
}

module.exports = { ensureDir, createDebouncedWriter };
