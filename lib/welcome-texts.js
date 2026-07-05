// Banco de bienvenidas y despedidas variadas.
// Placeholders: {user} = mención @, {name} = nombre visible, {group} = nombre del grupo, {count} = participantes.
// Se elige al azar evitando repetir la última usada por grupo.

const WELCOMES = [
    `🎉 ¡Ábranle paso! {user} acaba de llegar a *{group}* 🎊`,
    `👋 Bienvenid@ {user}, ponte cómod@ que aquí se pasa bien 😎`,
    `🚪 *Toc toc...* ¡Es {user}! Pásale, estás en tu casa 🏡`,
    `⚡ {user} se ha unido a *{group}*. ¡Que empiece la fiesta! 🥳`,
    `🌟 Una estrella más en el grupo: ¡bienvenid@ {user}!`,
    `🔥 Se siente el calor... ¡{user} acaba de entrar con todo!`,
    `🎺 *¡Tararí!* Anunciamos la llegada de {user} a *{group}* 📯`,
    `😂 {user} llegó sin avisar, pero igual le damos la bienvenida`,
    `🍀 Qué suerte la nuestra, {user} se unió a *{group}*`,
    `🛬 Aterrizando en *{group}*... ¡{user}, bienvenid@ a bordo! ✈️`,
    `👑 Recibamos con honores a {user}, nuev@ integrante de *{group}*`,
    `🎮 Player {user} has joined the game 🕹️`,
    `💫 El universo conspiró para que {user} llegara a *{group}*`,
    `🥁 Redoble de tambores... ¡{user} está aquí! 🥁`,
    `🌮 {user} llegó con hambre de buenas pláticas, ¡bienvenid@!`,
    `🚀 3, 2, 1... ¡{user} despegó directo a *{group}*!`,
    `🤠 Miren nomás quién llegó al rancho: ¡{user}!`,
    `🧩 Nos faltaba una pieza y era {user}. ¡Bienvenid@!`,
    `📢 Atención todos: {user} es de los nuestros ahora 😏`,
    `🎁 El mejor regalo de hoy: la llegada de {user} a *{group}*`,
    `🌈 Después de la tormenta llegó {user}. ¡Bienvenid@!`,
    `⚔️ Un nuevo guerrero se une al clan: ¡{user}!`,
    `🍿 Agarren sus palomitas, {user} acaba de entrar y esto se pone bueno`,
    `🏆 Fichaje estrella confirmado: {user} ya es parte de *{group}*`,
    `🌻 Que tu estancia en *{group}* sea tan buena como tu llegada, {user}`,
    `🦁 Rugió la selva... ¡{user} entró al territorio!`,
    `💎 Encontramos un diamante: ¡bienvenid@ {user}!`,
    `📱 {user} se conectó a la mejor red: *{group}* 😎`,
    `🎪 Damas y caballeros... ¡con ustedes, {user}! 🎩`,
    `🕶️ Llegó {user} y subió el nivel de estilo del grupo`,
    `🍕 {user} llegó justo a tiempo, ¡estábamos por pedir pizza!`,
    `🔔 *¡Ding dong!* {user} está en la puerta de *{group}*, ¡adelante!`,
    `🌊 Una nueva ola llegó a la playa: ¡bienvenid@ {user}! 🏄`,
    `✨ Cierra los ojos y pide un deseo... ¡ya se cumplió, llegó {user}!`,
    `🎯 Justo en el blanco: {user} eligió el mejor grupo para estar`,
    `🐉 Cuidado... digo, ¡bienvenid@ {user}! 😅`,
    `🥂 ¡Salud! Brindemos por la llegada de {user} a *{group}*`,
    `📖 Hoy empieza un nuevo capítulo: {user} en *{group}*`,
    `🏡 {user}, aquí ya tienes familia. ¡Bienvenid@!`,
    `⚽ ¡GOOOOOL! Perdón, me emocioné... ¡llegó {user}!`,
    `🎨 El grupo acaba de ganar más color con {user}`,
    `🚦 Luz verde para {user}: ¡adelante, estás en *{group}*!`,
    `🧲 Este grupo atrae pura gente buena, y llegó {user} a confirmarlo`,
    `🍩 Dulce llegada la de {user}, ¡bienvenid@!`,
    `🎸 *Riff de guitarra* 🤘 ¡{user} entró con rockstar energy!`,
    `🌙 Ni la luna brilla tanto como la llegada de {user} esta noche`,
    `🐣 Acaba de nacer una leyenda en *{group}*: ¡{user}!`,
    `🛡️ La orden de *{group}* tiene nuevo integrante: ¡{user}!`,
    `💌 Con cariño te decimos: bienvenid@ {user} 💜`,
    `🗺️ De todos los grupos del mundo, {user} eligió el correcto`,
    `🏅 Medalla de oro para {user} por unirse a *{group}*`
];

const FAREWELLS = [
    `👋 {name} ha dejado el grupo. ¡Buen viaje! 🛫`,
    `😢 Se nos fue {name}... *{group}* no será lo mismo`,
    `🚪 {name} salió por la puerta grande. ¡Hasta pronto!`,
    `🌅 {name} partió hacia nuevos horizontes. ¡Éxito!`,
    `📦 {name} empacó sus cosas y se fue. Aquí siempre tendrá lugar`,
    `🕊️ Vuela alto, {name}. ¡Hasta la próxima!`,
    `💔 F por {name}, que abandonó *{group}*`,
    `🎬 Y así termina la participación de {name} en esta película...`,
    `🚶 {name} se fue caminando lento, como en las películas 😔`,
    `⭐ Una estrella menos en el cielo de *{group}*: adiós, {name}`,
    `🍂 Como hoja en otoño, {name} se dejó llevar por el viento`,
    `🛸 {name} fue abducid@... o simplemente salió del grupo 👽`,
    `📉 El nivel del grupo bajó un poquito: se fue {name}`,
    `🌊 La marea se llevó a {name}. ¡Buen viaje, marinero!`,
    `🎈 {name} soltó el globo y se fue volando. ¡Adiós!`,
    `🏃 {name} salió corriendo... ¿dijimos algo malo? 😅`,
    `🧳 Buen viaje, {name}. Las puertas de *{group}* quedan abiertas`,
    `🌚 {name} se fue del lado oscuro... digo, del grupo`,
    `⏳ El tiempo de {name} en *{group}* llegó a su fin. ¡Suerte!`,
    `🎤 {name} soltó el micrófono y se retiró. *Mic drop* 🎤⬇️`,
    `🚂 El tren de {name} partió de la estación *{group}*. ¡Chuu chuu!`,
    `🌪️ {name} desapareció como torbellino. ¡Hasta luego!`,
    `🃏 {name} jugó su última carta y se retiró de la mesa`,
    `📴 {name} se desconectó de *{group}*. Esperamos verle pronto`,
    `🦋 {name} extendió sus alas y se fue. ¡Que le vaya bonito!`,
    `⚓ {name} levó anclas y zarpó. ¡Buen viento y buena mar!`,
    `🎭 Fin del acto: {name} abandonó el escenario de *{group}*`,
    `💨 ¿Sintieron esa brisa? Era {name} saliendo del grupo`,
    `🌇 {name} caminó hacia el atardecer... qué cinematográfico 🎥`,
    `🪂 {name} saltó del avión *{group}*. ¡Esperamos que abra el paracaídas!`,
    `🔕 Silencio... {name} ya no está entre nosotros (en el grupo, tranquilos 😅)`,
    `🏁 {name} cruzó la meta y terminó su carrera en *{group}*`,
    `🎣 Se nos escapó {name} del anzuelo. ¡Hasta la próxima pesca!`,
    `🌠 {name} se fue como estrella fugaz. ¡Pide un deseo!`,
    `🚕 El taxi de {name} llegó y se lo llevó. ¡Buen viaje!`,
    `📚 Se cierra el libro de {name} en *{group}*. Gran historia`,
    `🧭 {name} siguió su brújula hacia otro destino. ¡Suerte!`,
    `🐢 {name} se fue lento pero seguro. ¡Adiós, amig@!`,
    `❄️ {name} se derritió... o sea, se fue del grupo`,
    `🎩 {name} hizo su truco final: ¡desaparecer! ✨`,
    `🥀 Se marchitó una flor del jardín de *{group}*: adiós, {name}`,
    `🛶 {name} remó hacia otras aguas. ¡Buen viaje!`,
    `🎮 {name} left the game. GG 🕹️`,
    `🚀 Houston, perdimos a {name}... salió de órbita`,
    `🍃 {name} se fue con el viento, como buen ninja 🥷`,
    `⛺ {name} levantó su campamento y siguió su camino`,
    `🎻 Música triste de violín para despedir a {name} 🎶`,
    `🌉 {name} cruzó el puente hacia otro lado. ¡Hasta pronto!`,
    `📮 {name} dejó su carta de renuncia y se fue. Aceptada 😢`,
    `👻 {name} se convirtió en fantasma de *{group}*. ¡Buuu!`,
    `🕰️ Fue bonito mientras duró, {name}. ¡Hasta siempre!`
];

// Última plantilla usada por grupo (evita repetir dos veces seguidas)
const lastUsed = new Map();

function pickRandom(pool, groupId, kind) {
    const key = `${groupId}|${kind}`;
    const prev = lastUsed.get(key);
    let idx = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && idx === prev) idx = (idx + 1) % pool.length;
    lastUsed.set(key, idx);
    return pool[idx];
}

function fillTemplate(template, { userTag, name, group, count }) {
    return template
        .replace(/\{user\}/g, `@${userTag}`)
        .replace(/\{name\}/g, name || 'alguien')
        .replace(/\{group\}/g, group || 'el grupo')
        .replace(/\{count\}/g, String(count ?? ''));
}

function getRandomWelcome(groupId, data) {
    return fillTemplate(pickRandom(WELCOMES, groupId, 'w'), data);
}

function getRandomFarewell(groupId, data) {
    return fillTemplate(pickRandom(FAREWELLS, groupId, 'f'), data);
}

module.exports = { getRandomWelcome, getRandomFarewell, WELCOMES, FAREWELLS };
