// ============================================================
//  progreso-sync.js
//  El progreso de cada módulo del curso (lección actual + lecciones
//  completadas) vive ÚNICAMENTE en el Google Sheet — ya NO se usa
//  localStorage para esto. Así, abrir el curso desde cualquier
//  dispositivo siempre muestra el progreso real y actualizado.
//
//  (localStorage se sigue usando para OTRAS cosas que no son
//  progreso: la sesión de login "dg_sesion" y la preferencia de
//  tema claro/oscuro "sw_theme" — esas no cambian.)
//
//  Cómo usarlo en cada página de módulo (pieza, planos, visualize,
//  etc.): definir esta constante ANTES de incluir este archivo:
//
//      <script>const MODULO_ID = 'planos';</script>
//      <script src="progreso-sync.js"></script>
//
//  Y en el bloque de INIT de la página, en vez de llamar
//  renderSidebar()/renderContent()/etc. directamente, llamar a
//  iniciarProgreso() (ver el ejemplo al final de este archivo).
//
//  Requiere que la página ya tenga definidos:
//    - const WEBHOOK_URL  = '...'
//    - let   currentIdx
//    - let   completed = new Set()
//    - const lessons   = [...]
//    - pushURL(idx), renderSidebar(), renderContent(),
//      updateProgress(), startAutoComplete(idx),
//      updateMobileNav() (si existe en la página)
// ============================================================

// saveState() la sigue llamando el resto del código de la página
// (navigate, toggleDone, los botones "Completar y continuar", etc.)
// tal como antes — solo que ahora YA NO escribe nada en
// localStorage, únicamente manda el progreso al Sheet.
function saveState() {
    enviarProgresoRemoto();
}

// ── ENVIAR PROGRESO AL SHEET ─────────────────────────────────
let _guardarProgresoTimer = null;
let _ultimoProgresoEnviado = null; // evita reenviar si no cambió nada

function _construirPayloadProgreso() {
    const raw = localStorage.getItem('dg_sesion');
    if (!raw) return null;
    const sesion = JSON.parse(raw);
    // Solo se sincroniza si hay sesión con código activo (mismo
    // requisito que exige el Apps Script para escribir).
    if (!sesion.email || !sesion.codigo) return null;

    return {
        email: sesion.email,
        codigo: sesion.codigo,
        progreso: JSON.stringify({ idx: currentIdx, done: [...completed] })
    };
}

async function _enviarAhora() {
    try {
        const payload = _construirPayloadProgreso();
        if (!payload) return;
        if (payload.progreso === _ultimoProgresoEnviado) return; // nada nuevo

        const url = WEBHOOK_URL
            + '?action=guardarProgreso'
            + '&email='    + encodeURIComponent(payload.email)
            + '&codigo='   + encodeURIComponent(payload.codigo)
            + '&modulo='   + encodeURIComponent(MODULO_ID)
            + '&progreso=' + encodeURIComponent(payload.progreso);

        await fetch(url);
        _ultimoProgresoEnviado = payload.progreso;
    } catch (err) {
        console.error('No se pudo guardar el progreso en el Sheet:', err);
    }
}

function enviarProgresoRemoto() {
    clearTimeout(_guardarProgresoTimer);
    // Debounce: agrupa clics/avances seguidos en una sola llamada,
    // en vez de mandar un request por cada lección marcada.
    _guardarProgresoTimer = setTimeout(_enviarAhora, 1500);
}

// Si el alumno cierra la pestaña o cambia a otra app justo después
// de marcar algo, no hay que esperar los 1.5s del debounce: se
// manda de inmediato para no perder ese último cambio.
document.addEventListener('visibilitychange', () => {
    if (document.hidden && _guardarProgresoTimer) {
        clearTimeout(_guardarProgresoTimer);
        _enviarAhora();
    }
});
window.addEventListener('pagehide', () => {
    if (_guardarProgresoTimer) {
        clearTimeout(_guardarProgresoTimer);
        _enviarAhora();
    }
});

// ── CARGAR PROGRESO DEL SHEET (fuente de verdad) ─────────────
// Reemplaza currentIdx/completed con lo que hay guardado en el
// Sheet para este módulo — no se fusiona con nada local, porque
// ya no existe una copia local: lo que diga el Sheet es lo real.
async function cargarProgresoRemoto() {
    completed = new Set();
    currentIdx = 0;
    try {
        const raw = localStorage.getItem('dg_sesion');
        if (!raw) return; // sin sesión no hay progreso que cargar
        const sesion = JSON.parse(raw);
        if (!sesion.email || !sesion.codigo) return;

        const url = WEBHOOK_URL
            + '?action=obtenerProgreso'
            + '&email='  + encodeURIComponent(sesion.email)
            + '&codigo=' + encodeURIComponent(sesion.codigo)
            + '&modulo=' + encodeURIComponent(MODULO_ID);

        const res  = await fetch(url);
        const data = await res.json();
        if (!data.ok || !data.progreso) return;

        const remoto = JSON.parse(data.progreso);
        if (!remoto) return;
        if (Array.isArray(remoto.done)) completed = new Set(remoto.done);
        if (typeof remoto.idx === 'number') currentIdx = remoto.idx;
        _ultimoProgresoEnviado = JSON.stringify({ idx: currentIdx, done: [...completed] });
    } catch (err) {
        console.error('No se pudo cargar el progreso del curso:', err);
    }
}

// ── ARRANQUE DEL MÓDULO ───────────────────────────────────────
// Reemplaza el bloque "INIT" que cada página tenía antes
// (loadState(); renderSidebar(); renderContent(); ...). Espera a
// tener el progreso real del Sheet ANTES de dibujar nada, para
// que nunca se vea un 0% momentáneo seguido de un salto.
async function iniciarProgreso() {
    await cargarProgresoRemoto();

    const urlIdx = getLessonFromURL();
    if (urlIdx !== null) currentIdx = urlIdx;

    pushURL(currentIdx);
    renderSidebar();
    renderContent();
    updateProgress();
    startAutoComplete(currentIdx);
    if (typeof updateMobileNav === 'function') updateMobileNav();
}
