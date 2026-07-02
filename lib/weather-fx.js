const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
const GEO_CACHE = path.join(CACHE_DIR, 'geo.json');
const FX_CACHE = path.join(CACHE_DIR, 'fx-usd.json');
const CACHE_MS = 6 * 60 * 60 * 1000;

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function readCache(file, maxAge = CACHE_MS) {
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Date.now() - raw.at < maxAge) return raw.data;
    } catch (e) {}
    return null;
}

function writeCache(file, data) {
    ensureCacheDir();
    fs.writeFileSync(file, JSON.stringify({ at: Date.now(), data }, null, 2));
}

async function getWeather(cityName) {
    ensureCacheDir();
    const geoKey = cityName.toLowerCase().trim();
    let geo = readCache(GEO_CACHE)?.[geoKey];

    if (!geo) {
        const { data } = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
            params: { name: cityName, count: 1, language: 'es', format: 'json' },
            timeout: 15000
        });
        if (!data?.results?.length) throw new Error('Ciudad no encontrada');
        geo = data.results[0];
        const all = readCache(GEO_CACHE, 86400000 * 7) || {};
        all[geoKey] = geo;
        writeCache(GEO_CACHE, all);
    }

    const { data: wx } = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
            latitude: geo.latitude,
            longitude: geo.longitude,
            current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
            timezone: 'auto'
        },
        timeout: 15000
    });

    const cur = wx.current;
    const codes = {
        0: 'Despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado', 3: 'Nublado',
        45: 'Niebla', 48: 'Niebla', 51: 'Llovizna', 61: 'Lluvia', 71: 'Nieve', 80: 'Chubascos', 95: 'Tormenta'
    };
    const desc = codes[cur.weather_code] || `Código ${cur.weather_code}`;

    return {
        place: `${geo.name}, ${geo.country_code || geo.country || ''}`.trim(),
        temp: cur.temperature_2m,
        humidity: cur.relative_humidity_2m,
        wind: cur.wind_speed_10m,
        desc
    };
}

async function getExchangeRates() {
    let rates = readCache(FX_CACHE, CACHE_MS);
    if (!rates) {
        const { data } = await axios.get('https://api.frankfurter.app/latest', {
            params: { from: 'USD' },
            timeout: 15000
        });
        rates = data.rates;
        writeCache(FX_CACHE, rates);
    }
    return rates;
}

function convertCurrency(amount, from, to, rates) {
    const all = { USD: 1, ...rates };
    if (!all[from] || !all[to]) throw new Error('Moneda no soportada');
    const inUsd = from === 'USD' ? amount : amount / all[from];
    return inUsd * all[to];
}

module.exports = { getWeather, getExchangeRates, convertCurrency };
