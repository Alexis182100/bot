const fs = require('fs');
const path = require('path');
const axios = require('axios');

const HORO_FILE = path.join(__dirname, '..', 'data', 'horoscopes.json');

const DEFAULT_HOROSCOPES = {
    aries: ['Hoy tu energía te impulsa a tomar la iniciativa. Confía en tu instinto.', 'Un reto laboral se resuelve si actúas con calma y claridad.', 'Buen momento para cerrar pendientes y empezar algo nuevo.'],
    tauro: ['La paciencia trae recompensas. Evita gastos impulsivos hoy.', 'Alguien cercano necesita tu apoyo; escucha antes de aconsejar.', 'Enfócate en lo estable: salud, hogar y finanzas.'],
    geminis: ['Comunicación fluida. Ideal para reuniones y acuerdos.', 'Tu creatividad está alta; comparte ideas sin miedo.', 'Evita dispersarte: prioriza una meta a la vez.'],
    cancer: ['Día emotivo pero positivo. Cuídate y descansa.', 'La familia o amigos traen buenas noticias.', 'Confía en tu intuición en decisiones personales.'],
    leo: ['Brillas en lo social. Aprovecha oportunidades de liderazgo.', 'Reconocimiento por esfuerzo previo. Mantén la humildad.', 'Romance y amistad en armonía si eres generoso.'],
    virgo: ['Organiza tu rutina y verás resultados rápidos.', 'Detalle y disciplina te sacan de un atasco.', 'Salud: hidrátate y no postergues descanso.'],
    libra: ['Busca equilibrio en conflictos. La diplomacia funciona.', 'Gusto por lo belle y armonioso te recarga.', 'Asociaciones favorables en trabajo o estudio.'],
    escorpio: ['Intensidad productiva. Profundiza, no te quedes en la superficie.', 'Secretos o información útil llega a ti.', 'Transformación positiva si sueltas lo que ya no sirve.'],
    sagitario: ['Aventura y aprendizaje. Planes de viaje o estudio favorecidos.', 'Optimismo contagioso. Comparte entusiasmo.', 'Cuidado con prometer de más; sé realista.'],
    capricornio: ['Trabajo constante da frutos. Revisión financiera acertada.', 'Autoridad y responsabilidad bien vistas.', 'Paciencia en proyectos largos.'],
    acuario: ['Ideas originales. Conecta con personas afines.', 'Libertad y cambio te benefician.', 'Tecnología o redes sociales te ayudan hoy.'],
    piscis: ['Sensibilidad alta. Arte, música o meditación te equilibran.', 'Sueños o intuiciones reveladoras.', 'Ayuda a otros y recibirás apoyo a cambio.']
};

function loadHoroscopes() {
    try {
        if (fs.existsSync(HORO_FILE)) {
            return JSON.parse(fs.readFileSync(HORO_FILE, 'utf8'));
        }
    } catch (e) {}
    const dir = path.dirname(HORO_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HORO_FILE, JSON.stringify(DEFAULT_HOROSCOPES, null, 2));
    return DEFAULT_HOROSCOPES;
}

function getHoroscope(signInput) {
    const signoMap = {
        aries: 'aries', tauro: 'tauro', geminis: 'geminis', cancer: 'cancer',
        leo: 'leo', virgo: 'virgo', libra: 'libra', escorpio: 'escorpio',
        sagitario: 'sagitario', capricornio: 'capricornio', acuario: 'acuario', piscis: 'piscis'
    };
    const key = signInput.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const sign = signoMap[key];
    if (!sign) return null;

    const data = loadHoroscopes();
    const messages = data[sign] || DEFAULT_HOROSCOPES[sign] || ['Hoy es un buen día para avanzar con confianza.'];
    const dayIndex = Math.floor(Date.now() / 86400000) % messages.length;
    const mood = ['Optimista', 'Reflexivo', 'Activo', 'Tranquilo'][dayIndex % 4];
    const colors = ['Azul', 'Verde', 'Rojo', 'Dorado', 'Morado', 'Blanco'];
    const color = colors[dayIndex % colors.length];
    const lucky = ((dayIndex * 7 + sign.length) % 99) + 1;

    return {
        sign: key.charAt(0).toUpperCase() + key.slice(1),
        date: new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' }),
        description: messages[dayIndex],
        mood,
        color,
        lucky_number: lucky,
        lucky_time: `${9 + (dayIndex % 8)}:00 - ${11 + (dayIndex % 8)}:00`
    };
}

async function translateText(text, from = 'auto', to = 'es') {
    const sl = from === 'auto' ? 'auto' : from;
    const url = 'https://translate.googleapis.com/translate_a/single';
    const { data } = await axios.get(url, {
        params: { client: 'gtx', sl, tl: to, dt: 't', q: text },
        timeout: 15000
    });
    const translated = (data[0] || []).map((part) => part[0]).join('');
    if (!translated) throw new Error('Traducción vacía');
    return translated;
}

module.exports = { getHoroscope, translateText, signoMap: Object.keys(loadHoroscopes()) };
