/* Capacitación «Mi plata, mi plan» · Action Clean · 27-nov-2026
   Prueba de capacidad tecnológica (foto + ubicación + hora del servidor + celular) y ejercicio de finanzas.
   Reglas: las cifras de dinero NUNCA salen del celular (solo se envían pasos y segundos);
   cámara solo con gesto del usuario (iOS); coordenadas con Number.isFinite; nunca innerHTML con datos;
   la red nunca bloquea el ejercicio. */
"use strict";

const VERSION = "cap-v1.1";
const SESION = "cap-2026-11-27";
const AUTORIZA = "cap-1"; // versión del texto de autorización mostrado en p-datos
const ENTORNOS = {
  staging: { nombre: "Pruebas", url: "https://yunevkubrndtccgocwfg.supabase.co", llave: "sb_publishable_zkDa9TL99nHBMzTDPW4FRA_m7fEx2cq" },
  produccion: null,
};
const ES_STAGING = location.pathname.includes("/staging") || ["localhost", "127.0.0.1"].includes(location.hostname);
const ENT = ENTORNOS[ES_STAGING ? "staging" : "produccion"];
const TZ = "America/Bogota";
const CLAVE = "ac_cap_" + SESION;

const $ = (id) => document.getElementById(id);
const esNum = (v) => typeof v === "number" && Number.isFinite(v);
const nf = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const plata = (n) => "$" + nf.format(Math.round(n || 0));
const PASOS = { "p-hormiga": "hormiga", "p-presupuesto": "presupuesto", "p-prima": "prima", "p-meta": "meta", "p-compromiso": "compromiso" };

let sb = null;
let S = nuevoEstado();
const vivo = { stream: null, pos: null, gps: null, watchId: null, t0: Date.now(), tick: null, camara: "directa" };

function nuevoEstado() {
  return { reg: null, nombre: "", foto: null, pantalla: "p-inicio",
    hormiga: { sel: [], otro: 0 }, b: {}, prima: { total: 0, deudas: 0, enero: 0, navidad: 0, editado: false },
    meta: { que: "", cuanto: 0, q: 4 }, comp: { val: "", otro: "" } };
}
function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify(S)); } catch { /* modo privado: seguimos sin guardar */ } }
function cargar() {
  try { const t = localStorage.getItem(CLAVE); if (t) S = Object.assign(nuevoEstado(), JSON.parse(t)); } catch { /* nada */ }
}

/* ───────── Utilidades ───────── */
function mostrar(id) {
  document.querySelectorAll(".pantalla").forEach((p) => { p.hidden = true; p.removeAttribute("data-entrando"); });
  const p = $(id);
  p.hidden = false;
  void p.offsetWidth;
  p.setAttribute("data-entrando", "");
  window.scrollTo(0, 0);
  if (id !== "p-camara") apagarCamara();
  if (id === "p-fin") pintarResumen();
  if (S.foto && S.foto.pendiente) reintentarFoto();
  if (!["p-camara", "p-enviando", "p-inicio"].includes(id)) { S.pantalla = id; guardar(); }
  vivo.t0 = Date.now();
}
function horaTexto(f) {
  return new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })
    .format(f).replace(/\s?a\.?\s?m\.?/i, " a. m.").replace(/\s?p\.?\s?m\.?/i, " p. m.");
}
function fechaLarga(f) {
  const t = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(f);
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function error(id, texto) { const e = $(id); e.textContent = texto || ""; e.hidden = !texto; }
function ocupado(btn, si) { btn.disabled = si; btn.setAttribute("aria-busy", si ? "true" : "false"); }
function esWebview() { return /WhatsApp|FBAN|FBAV|Instagram|; wv\)/i.test(navigator.userAgent || ""); }
function leer(el) { const n = parseInt(String(el.value).replace(/\D/g, ""), 10); return Number.isFinite(n) ? n : 0; }
function escribir(el, n) { el.value = n ? nf.format(n) : ""; }
function dispositivo() {
  const c = navigator.connection || {};
  return {
    ua: (navigator.userAgent || "").slice(0, 400),
    plataforma: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "",
    movil: navigator.userAgentData ? !!navigator.userAgentData.mobile : /Mobi|Android|iPhone/i.test(navigator.userAgent || ""),
    pantalla: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
    idioma: navigator.language || "", memoria_gb: navigator.deviceMemory || null, nucleos: navigator.hardwareConcurrency || null,
    red: c.effectiveType || null, ahorro_datos: c.saveData || null, webview: esWebview(),
    camara_api: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), gps_api: "geolocation" in navigator,
    compartir_archivos: !!navigator.canShare, version: VERSION,
  };
}

/* ───────── Servidor (nunca bloquea) ───────── */
async function rpc(nombre, args) {
  if (!sb) throw new Error("sin_servidor");
  const { data, error: e } = await sb.rpc(nombre, args);
  if (e) throw e;
  return data;
}
function avance(paso, segundos) {
  if (!sb || !S.reg) return;
  rpc("cap_avance", { p_id: S.reg.id, p_token: S.reg.token, p_paso: paso, p_segundos: Math.round(segundos) }).catch(() => {});
}
function mensajeDe(err) {
  const m = (err && (err.message || err.error_description)) || "";
  if (m.includes("cap_cerrada")) return "La capacitación ya cerró el registro. Puede hacer el ejercicio igual.";
  if (/Failed to fetch|NetworkError|network|sin_servidor|Load failed/i.test(m))
    return navigator.onLine === false ? "Su celular no tiene internet. Revise los datos o el wifi." : "No pudimos comunicarnos con el sistema.";
  return "Algo falló al guardar. Puede seguir con el ejercicio.";
}

/* ───────── Arranque ───────── */
function iniciar() {
  $("pie-version").textContent = `${VERSION}${ES_STAGING ? " · Pruebas" : ""}`;
  if (ENT && window.supabase) {
    sb = window.supabase.createClient(ENT.url, ENT.llave, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  cargar();
  $("i-webview").hidden = !esWebview();
  $("d-nombre").value = S.nombre || "";
  pintarTodo();
  if (S.pantalla && S.pantalla !== "p-inicio") $("i-seguir").hidden = false;
  mostrar("p-inicio");
}
$("i-empezar").addEventListener("click", () => mostrar(S.reg ? (S.foto ? "p-hormiga" : "p-foto") : "p-datos"));
$("i-seguir").addEventListener("click", () => mostrar(S.pantalla && $(S.pantalla) ? S.pantalla : "p-datos"));

document.querySelectorAll("[data-atras]").forEach((b) => b.addEventListener("click", () => mostrar(b.getAttribute("data-atras"))));
document.querySelectorAll("[data-sig]").forEach((b) => b.addEventListener("click", () => {
  const actual = b.closest(".pantalla").id;
  if (PASOS[actual]) avance(PASOS[actual], (Date.now() - vivo.t0) / 1000);
  const sig = b.getAttribute("data-sig");
  mostrar(sig);
}));

/* ───────── 1 · Datos y autorización ───────── */
$("d-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const nombre = $("d-nombre").value.replace(/\s+/g, " ").trim();
  if (nombre.length < 2) { error("d-error", "Escriba su nombre."); $("d-nombre").focus(); return; }
  if (!$("d-acepto").checked) { error("d-error", "Para seguir, marque «Autorizo». Si no quiere, haga el ejercicio con un compañero."); return; }
  error("d-error", "");
  S.nombre = nombre; guardar();
  if (!S.reg) {
    const btn = $("d-seguir"); ocupado(btn, true);
    try {
      const r = await rpc("cap_registrar", { p_nombre: nombre, p_autoriza_version: AUTORIZA, p_dispositivo: dispositivo(), p_sesion: SESION });
      S.reg = { id: r.id, token: r.token, hora: r.hora }; guardar();
    } catch (e) {
      // Sin conexión: el ejercicio sigue; la foto intentará registrar de nuevo.
      error("d-error", mensajeDe(e));
    } finally { ocupado(btn, false); }
  }
  mostrar(S.foto ? "p-hormiga" : "p-foto");
});

/* ───────── 2 · Foto + ubicación ───────── */
function iniciarGPS() {
  if (!("geolocation" in navigator)) { vivo.gps = "no_disponible"; pintarGPS(); return; }
  if (vivo.watchId != null) return;
  const op = { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 };
  vivo.gps = null; pintarGPS();
  navigator.geolocation.getCurrentPosition((p) => {
    fijarPos(p);
    if (vivo.watchId == null) vivo.watchId = navigator.geolocation.watchPosition(fijarPos, () => {}, op);
  }, (e) => { if (!vivo.pos) { vivo.gps = e.code === 1 ? "denegado" : e.code === 3 ? "tiempo" : "no_disponible"; pintarGPS(); } }, op);
}
function fijarPos(p) {
  const { latitude: lat, longitude: lng, accuracy: acc } = p.coords;
  if (!esNum(lat) || !esNum(lng)) return;
  vivo.pos = { lat, lng, acc: esNum(acc) ? acc : null, t: Date.now() };
  vivo.gps = "ok"; pintarGPS();
}
const TXT_GPS = {
  ok: () => `Ubicación lista · ±${Math.round(vivo.pos.acc || 0)} m`,
  denegado: () => "Ubicación sin permiso",
  tiempo: () => "La ubicación tarda",
  no_disponible: () => "Este celular no da la ubicación",
};
function pintarGPS() {
  const el = $("f-gps"), span = el.querySelector("span");
  if (vivo.gps && TXT_GPS[vivo.gps]) { el.dataset.estado = vivo.gps === "ok" ? "lista" : "error"; span.textContent = TXT_GPS[vivo.gps](); }
  else if (vivo.watchId != null || vivo.gps === null && vivo.t0) { el.dataset.estado = "buscando"; span.textContent = "Buscando ubicación…"; }
}
function esperarGPS(ms) {
  return new Promise((ok) => {
    if (vivo.pos || (vivo.gps && vivo.gps !== null)) return ok();
    const t0 = Date.now();
    const i = setInterval(() => { if (vivo.pos || vivo.gps || Date.now() - t0 > ms) { clearInterval(i); ok(); } }, 250);
  });
}

function apagarCamara() {
  if (vivo.stream) { vivo.stream.getTracks().forEach((t) => t.stop()); vivo.stream = null; }
  if (vivo.tick) { clearInterval(vivo.tick); vivo.tick = null; }
}
function pintarSello() {
  const ahora = new Date();
  const g = vivo.pos ? `Ubicación ±${Math.round(vivo.pos.acc || 0)} m` : vivo.gps ? TXT_GPS[vivo.gps]() : "Buscando ubicación…";
  $("k-sello").textContent = `${fechaLarga(ahora)}\n${horaTexto(ahora)} · ${g}`;
}
$("f-abrir").addEventListener("click", async () => {
  // Dentro del toque: iOS exige gesto vivo para cámara y ubicación.
  error("f-error", "");
  iniciarGPS();
  $("k-instr").textContent = "Ponga su cara en el óvalo";
  $("k-disparar").disabled = true;
  mostrar("p-camara");
  pintarSello(); vivo.tick = setInterval(pintarSello, 1000);
  try {
    vivo.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    const v = $("k-video"); v.srcObject = vivo.stream; await v.play().catch(() => {});
    vivo.camara = "directa";
  } catch {
    vivo.camara = "respaldo";
    $("k-instr").textContent = "Toque el botón azul para abrir la cámara";
  }
  $("k-disparar").disabled = false;
});
$("k-cancelar").addEventListener("click", () => mostrar("p-foto"));
$("k-disparar").addEventListener("click", async () => {
  if (!vivo.stream) { $("k-respaldo").click(); return; }
  const v = $("k-video");
  if (!v.videoWidth) return;
  const blob = await recortar(v, v.videoWidth, v.videoHeight);
  apagarCamara();
  await enviarFoto(blob);
});
$("k-respaldo").addEventListener("change", async (ev) => {
  const f = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (!f) return;
  if (f.lastModified && Date.now() - f.lastModified > 120000) { $("k-instr").textContent = "Use una foto tomada ahora, no de la galería."; return; }
  const img = await createImageBitmap(f).catch(() => null);
  if (!img) { $("k-instr").textContent = "No se pudo leer la foto. Intente de nuevo."; return; }
  vivo.camara = "respaldo";
  await enviarFoto(await recortar(img, img.width, img.height));
});
function recortar(fuente, w, h) {
  const k = Math.min(1, 720 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(fuente, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob((b) => ok(b), "image/jpeg", 0.72));
}
async function asegurarRegistro() {
  if (S.reg) return true;
  if (!S.nombre) return false;
  try {
    const r = await rpc("cap_registrar", { p_nombre: S.nombre, p_autoriza_version: AUTORIZA, p_dispositivo: dispositivo(), p_sesion: SESION });
    S.reg = { id: r.id, token: r.token, hora: r.hora }; guardar(); return true;
  } catch { return false; }
}
function aDataURL(blob) { return new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ok(null); r.readAsDataURL(blob); }); }
async function enviarFoto(blob) {
  if (blob) { S.selfie = await aDataURL(blob); S.selfieHora = new Date().toISOString(); guardar(); }
  mostrar("p-enviando");
  $("v-texto").textContent = "Buscando su ubicación…";
  await esperarGPS(8000);
  $("v-texto").textContent = "Guardando su foto…";
  try {
    if (!(await asegurarRegistro())) throw new Error("sin_servidor");
    if (blob) {
      const { error: e } = await sb.storage.from("capacitacion").upload(`${S.reg.id}.jpg`, blob, { contentType: "image/jpeg", upsert: false });
      if (e && !/exists|Duplicate/i.test(e.message || "")) throw e;
    }
    const pos = vivo.pos && Date.now() - vivo.pos.t < 120000 ? vivo.pos : null;
    const r = await rpc("cap_foto", {
      p_id: S.reg.id, p_token: S.reg.token, p_camara: blob ? vivo.camara : "sin_foto",
      p_lat: pos ? pos.lat : null, p_lng: pos ? pos.lng : null, p_precision_m: pos ? pos.acc : null,
      p_gps: pos ? "ok" : (vivo.gps || "tiempo"),
    });
    S.foto = { hora: r.hora, gps: pos ? "ok" : (vivo.gps || "tiempo"), acc: pos ? pos.acc : null, conFoto: !!blob }; guardar();
    pintarFotoOk();
    mostrar("p-foto-ok");
  } catch (e) {
    if ((e.message || "").includes("cap_foto_repetida")) { S.foto = S.foto || { hora: new Date().toISOString(), gps: "ok", conFoto: true }; guardar(); pintarFotoOk(); mostrar("p-foto-ok"); return; }
    if (blob || S.selfie) {
      // La foto queda en el celular (entra al PDF) y el envío se reintenta solo en cada paso.
      const pos = vivo.pos && Date.now() - vivo.pos.t < 120000 ? vivo.pos : null;
      S.foto = { hora: new Date().toISOString(), gps: pos ? "ok" : (vivo.gps || "tiempo"), acc: pos ? pos.acc : null,
        pos: pos ? { lat: pos.lat, lng: pos.lng, acc: pos.acc } : null, camara: vivo.camara, conFoto: true, pendiente: true };
      guardar(); pintarFotoOk(); mostrar("p-foto-ok");
      return;
    }
    mostrar("p-foto");
    error("f-error", mensajeDe(e) + " Intente de nuevo o toque «No puedo tomar la foto».");
  }
}
function aBlob(dataURL) {
  const [cab, b64] = dataURL.split(","); const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: (cab.match(/data:([^;]+)/) || [])[1] || "image/jpeg" });
}
let reintentando = false;
async function reintentarFoto() {
  if (reintentando || !S.foto || !S.foto.pendiente || !S.selfie || !sb) return;
  reintentando = true;
  try {
    if (!(await asegurarRegistro())) return;
    const { error: e } = await sb.storage.from("capacitacion").upload(`${S.reg.id}.jpg`, aBlob(S.selfie), { contentType: "image/jpeg", upsert: false });
    if (e && !/exists|Duplicate/i.test(e.message || "")) return;
    const p = S.foto.pos;
    try {
      const r = await rpc("cap_foto", { p_id: S.reg.id, p_token: S.reg.token, p_camara: S.foto.camara || "directa",
        p_lat: p ? p.lat : null, p_lng: p ? p.lng : null, p_precision_m: p ? p.acc : null, p_gps: S.foto.gps || "tiempo" });
      S.foto.hora = r.hora;
    } catch (e2) { if (!(e2.message || "").includes("cap_foto_repetida")) return; }
    S.foto.pendiente = false; guardar();
  } catch { /* se reintenta en el siguiente paso */ }
  finally { reintentando = false; }
}
function pintarFotoOk() {
  const h = new Date(S.foto.hora);
  $("r-titulo").textContent = !S.foto.conFoto ? "Registro guardado sin foto" : S.foto.pendiente ? "¡Foto tomada!" : "¡Foto registrada!";
  $("r-hora").textContent = horaTexto(h);
  $("r-fecha").textContent = fechaLarga(h);
  const ok = S.foto.gps === "ok" && !S.foto.pendiente;
  const est = $("r-gps");
  est.dataset.estado = ok ? "verde" : "amarillo";
  est.textContent = S.foto.gps === "ok" ? `Ubicación ±${Math.round(S.foto.acc || 0)} m` : "Sin ubicación";
  $("r-sello").dataset.estado = S.foto.conFoto && ok ? "verde" : "amarillo";
  $("r-icono").setAttribute("href", S.foto.conFoto && ok ? "#i-ok" : "#i-rev");
  const av = $("r-aviso");
  av.hidden = ok;
  av.textContent = S.foto.pendiente ? "Su foto quedó guardada en su celular y saldrá en su PDF. La enviaremos sola cuando haya conexión: siga con el ejercicio."
    : S.foto.gps === "denegado" ? "El celular no dio permiso de ubicación. Para la planilla habrá que activarlo en los ajustes del navegador." : "El celular no encontró la ubicación a tiempo. No pasa nada: ya quedó anotado.";
}
$("f-omitir").addEventListener("click", async () => {
  vivo.camara = "sin_foto";
  if (!S.reg && !(await asegurarRegistro())) { S.foto = { hora: new Date().toISOString(), gps: vivo.gps || "tiempo", conFoto: false, local: true }; guardar(); mostrar("p-hormiga"); return; }
  await enviarFoto(null);
});

/* ───────── Campos de plata ───────── */
document.querySelectorAll("input.plata").forEach((el) => {
  el.addEventListener("input", () => {
    const n = Math.min(leer(el), 9999999999);
    escribir(el, n);
    el.dispatchEvent(new CustomEvent("plata"));
  });
});

/* ───────── 3 · Gasto hormiga ───────── */
const fichas = [...document.querySelectorAll("#h-fichas .ficha")];
fichas.forEach((f, i) => f.addEventListener("click", () => {
  const set = new Set(S.hormiga.sel);
  set.has(i) ? set.delete(i) : set.add(i);
  S.hormiga.sel = [...set]; guardar(); pintarHormiga();
}));
$("h-otro").addEventListener("plata", () => { S.hormiga.otro = leer($("h-otro")); guardar(); pintarHormiga(); });
function hormigaDia() { return S.hormiga.sel.reduce((a, i) => a + (+fichas[i]?.dataset.v || 0), 0) + (S.hormiga.otro || 0); }
function pintarHormiga() {
  fichas.forEach((f, i) => f.setAttribute("aria-pressed", S.hormiga.sel.includes(i) ? "true" : "false"));
  const d = hormigaDia();
  $("h-dia").textContent = plata(d); $("h-mes").textContent = plata(d * 30); $("h-ano").textContent = plata(d * 365);
}

/* ───────── 4 · Presupuesto ───────── */
const CAMPOS_B = ["entra", "ahorro", "casa", "comida", "deudas", "gustos"];
CAMPOS_B.forEach((k) => $("b-" + k).addEventListener("plata", () => { S.b[k] = leer($("b-" + k)); guardar(); pintarBalance(); }));
function balance() { const b = S.b; return (b.entra || 0) - CAMPOS_B.slice(1).reduce((a, k) => a + (b[k] || 0), 0); }
function pintarBalance() {
  const el = $("b-balance"), q = balance();
  if (!S.b.entra) { el.dataset.estado = "vacio"; $("b-etq").textContent = "Lo que me queda"; $("b-queda").textContent = plata(0); $("b-msg").textContent = "Escriba lo que le entra y lo que le sale."; $("b-icono").setAttribute("href", "#i-cuenta"); return; }
  if (q > 0) { el.dataset.estado = "bien"; $("b-etq").textContent = "Me quedan"; $("b-queda").textContent = plata(q); $("b-msg").textContent = "¡Bien! Llévelos al bolsillo del ahorro."; $("b-icono").setAttribute("href", "#i-ok"); }
  else if (q === 0) { el.dataset.estado = "justo"; $("b-etq").textContent = "Me queda"; $("b-queda").textContent = plata(0); $("b-msg").textContent = "Le alcanza justo. Mire si puede recortar algo."; $("b-icono").setAttribute("href", "#i-rev"); }
  else { el.dataset.estado = "mal"; $("b-etq").textContent = "Me faltan"; $("b-queda").textContent = plata(-q); $("b-msg").textContent = "Sale más de lo que entra. ¿Qué puede recortar?"; $("b-icono").setAttribute("href", "#i-mal"); }
}

/* ───────── 5 · Prima ───────── */
$("p-total").addEventListener("plata", () => {
  const t = leer($("p-total")); S.prima.total = t;
  if (!S.prima.editado) {
    const parte = Math.floor(t / 3 / 1000) * 1000;
    S.prima.deudas = parte; S.prima.enero = parte; S.prima.navidad = t - 2 * parte;
    escribir($("p-deudas"), S.prima.deudas); escribir($("p-enero"), S.prima.enero); escribir($("p-navidad"), S.prima.navidad);
  }
  guardar(); pintarPrima();
});
["deudas", "enero", "navidad"].forEach((k) => $("p-" + k).addEventListener("plata", () => { S.prima[k] = leer($("p-" + k)); S.prima.editado = true; guardar(); pintarPrima(); }));
function pintarPrima() {
  const p = S.prima, suma = (p.deudas || 0) + (p.enero || 0) + (p.navidad || 0), n = $("p-nota");
  if (!p.total) { n.className = "nota"; n.textContent = "Al escribir su prima, la partimos en 3. Puede cambiar cada parte."; return; }
  if (suma === p.total) { n.className = "nota"; n.textContent = "Las 3 partes suman su prima completa."; }
  else { n.className = "nota mal"; n.textContent = `Las 3 partes suman ${plata(suma)}, pero su prima es ${plata(p.total)}.`; }
}

/* ───────── 6 · Meta ───────── */
$("m-que").addEventListener("input", () => { S.meta.que = $("m-que").value.slice(0, 80); guardar(); });
$("m-cuanto").addEventListener("plata", () => { S.meta.cuanto = leer($("m-cuanto")); guardar(); pintarMeta(); });
$("m-menos").addEventListener("click", () => { S.meta.q = Math.max(1, S.meta.q - 1); guardar(); pintarMeta(); });
$("m-mas").addEventListener("click", () => { S.meta.q = Math.min(12, S.meta.q + 1); guardar(); pintarMeta(); });
function cuotaMeta() { return S.meta.cuanto ? Math.ceil(S.meta.cuanto / S.meta.q / 100) * 100 : 0; }
function pintarMeta() {
  $("m-quincenas").textContent = String(S.meta.q);
  $("m-menos").disabled = S.meta.q <= 1; $("m-mas").disabled = S.meta.q >= 12;
  $("m-cuota").textContent = plata(cuotaMeta());
  $("m-resultado").dataset.estado = S.meta.cuanto ? "meta" : "vacio";
}

/* ───────── 7 · Compromiso ───────── */
document.querySelectorAll("input[name=comp]").forEach((r) => r.addEventListener("change", () => {
  S.comp.val = r.value; guardar();
  $("c-otro-campo").hidden = r.value !== "otro";
  if (r.value === "otro") $("c-otro").focus();
}));
$("c-otro").addEventListener("input", () => { S.comp.otro = $("c-otro").value.slice(0, 120); guardar(); });
function compromiso() { return S.comp.val === "otro" ? (S.comp.otro || "").trim() : S.comp.val; }

/* ───────── Pintar todo (al recargar) ───────── */
function pintarTodo() {
  pintarHormiga();
  escribir($("h-otro"), S.hormiga.otro);
  CAMPOS_B.forEach((k) => escribir($("b-" + k), S.b[k] || 0)); pintarBalance();
  ["total", "deudas", "enero", "navidad"].forEach((k) => escribir($("p-" + k), S.prima[k] || 0)); pintarPrima();
  $("m-que").value = S.meta.que || ""; escribir($("m-cuanto"), S.meta.cuanto); pintarMeta();
  document.querySelectorAll("input[name=comp]").forEach((r) => { r.checked = r.value === S.comp.val; });
  $("c-otro").value = S.comp.otro || ""; $("c-otro-campo").hidden = S.comp.val !== "otro";
  if (S.foto) pintarFotoOk();
}

/* ───────── Resumen y PDF ───────── */
function filas() {
  const q = balance();
  return [
    ["Gasto hormiga al día", plata(hormigaDia())], ["Gasto hormiga al año", plata(hormigaDia() * 365)],
    ["Me entra en la quincena", plata(S.b.entra)], [q < 0 ? "Me faltan" : "Me queda", plata(Math.abs(q))],
    ["Prima para enero", plata(S.prima.enero)],
    ["Mi meta", S.meta.que || "—"], ["Guardo cada quincena", plata(cuotaMeta())],
  ];
}
function pintarResumen() {
  $("z-nombre").textContent = (S.nombre || "").split(" ")[0];
  const zf = $("z-foto");
  zf.replaceChildren(); zf.hidden = !S.selfie;
  if (S.selfie) { const im = new Image(); im.className = "foto-recuerdo"; im.alt = "Mi foto del día"; im.src = S.selfie; zf.append(im); }
  const dl = $("z-resumen"); dl.replaceChildren();
  for (const [k, v] of filas()) {
    const d = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = k; dd.textContent = v; d.append(dt, dd); dl.append(d);
  }
  const c = compromiso();
  if (c) {
    const d = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
    d.className = "bloque"; dt.textContent = "Mi compromiso"; dd.textContent = c; d.append(dt, dd); dl.append(d);
  }
  $("z-compartir").hidden = !(navigator.canShare && window.File && navigator.canShare({ files: [new File(["x"], "x.pdf", { type: "application/pdf" })] }));
}

let logoURL = null;
async function logo() {
  if (logoURL) return logoURL;
  try {
    const b = await (await fetch("../logo-completo.png")).blob();
    const url = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
    logoURL = { url, w: img.naturalWidth, h: img.naturalHeight };
  } catch { logoURL = null; }
  return logoURL;
}
async function generarPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = 612, M = 48;
  const azul = [31, 122, 192], morado = [102, 36, 131], tinta = [27, 26, 46], suave = [85, 88, 114], linea = [227, 230, 238];
  // Franja de marca (degradado cian → azul → morado en tiras)
  const c1 = [0, 159, 227], c2 = azul, c3 = morado;
  for (let i = 0; i < 120; i++) {
    const t = i / 119, [a, b, u] = t < 0.55 ? [c1, c2, t / 0.55] : [c2, c3, (t - 0.55) / 0.45];
    doc.setFillColor(...a.map((v, k) => Math.round(v + (b[k] - v) * u)));
    doc.rect((W / 120) * i, 0, W / 120 + 0.5, 10, "F");
  }
  const lg = await logo();
  if (lg) doc.addImage(lg.url, "PNG", M, 30, 120, (120 * lg.h) / lg.w);
  if (S.selfie) {
    const fw = 104, fh = 130, fx = W - M - fw, fy = 30;
    try { doc.addImage(S.selfie, "JPEG", fx, fy, fw, fh, undefined, "FAST"); } catch { /* foto ilegible: seguimos */ }
    doc.setDrawColor(...morado); doc.setLineWidth(2); doc.rect(fx, fy, fw, fh); doc.setLineWidth(1);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...suave);
    const hf = S.foto && S.foto.hora ? new Date(S.foto.hora) : new Date(S.selfieHora || Date.now());
    doc.text("Mi foto del día que me lo propuse", fx + fw / 2, fy + fh + 11, { align: "center" });
    doc.text(horaTexto(hf).replace(/\u00a0/g, " "), fx + fw / 2, fy + fh + 21, { align: "center" });
  }
  let y = 30 + (lg ? (120 * lg.h) / lg.w : 30) + 30;
  doc.setTextColor(...tinta); doc.setFont("helvetica", "normal"); doc.setFontSize(26);
  doc.text("Mi plata, mi plan", M, y);
  y += 20; doc.setFontSize(12); doc.setTextColor(...suave);
  doc.text(`${S.nombre || ""} · ${fechaLarga(new Date())}`, M, y);
  y += 14;

  const seccion = (t) => { y += 22; doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...morado); doc.text(t, M, y); y += 8; };
  const fila = (k, v, fuerte) => {
    y += 19; doc.setDrawColor(...linea); doc.line(M, y + 6, W - M, y + 6);
    doc.setFont("helvetica", fuerte ? "bold" : "normal"); doc.setFontSize(12); doc.setTextColor(...tinta);
    doc.text(k, M, y); doc.text(v, W - M, y, { align: "right" });
  };
  const ah = hormigaDia();
  seccion("1. Mis gastos hormiga");
  const elegidos = S.hormiga.sel.map((i) => fichas[i] && fichas[i].firstChild.textContent.trim()).filter(Boolean);
  if (S.hormiga.otro) elegidos.push("otro");
  fila("Lo que compro casi todos los días", elegidos.join(", ") || "—");
  fila("Al día", plata(ah)); fila("Al mes", plata(ah * 30)); fila("Al año", plata(ah * 365), true);

  seccion("2. Mi presupuesto de la quincena");
  const b = S.b, q = balance();
  fila("Lo que me entra", plata(b.entra), true);
  fila("1. Ahorro (primero)", plata(b.ahorro)); fila("2. Casa: arriendo y servicios", plata(b.casa));
  fila("3. Comida y transporte", plata(b.comida)); fila("4. Deudas", plata(b.deudas)); fila("5. Gustos", plata(b.gustos));
  fila(q < 0 ? "Me faltan" : "Me queda", plata(Math.abs(q)), true);

  seccion("3. Mi prima de diciembre en 3 partes");
  fila("Mi prima", plata(S.prima.total), true);
  fila("Pagar deudas", plata(S.prima.deudas)); fila("Guardar para enero", plata(S.prima.enero)); fila("Disfrutar la Navidad", plata(S.prima.navidad));

  seccion("4. Mi meta de 90 días");
  fila("¿Qué quiero?", S.meta.que || "—"); fila("¿Cuánto cuesta?", plata(S.meta.cuanto));
  fila("¿En cuántas quincenas?", String(S.meta.q)); fila("Guardo cada quincena", plata(cuotaMeta()), true);

  seccion("5. Mi compromiso desde hoy");
  y += 22; doc.setFont("helvetica", "normal"); doc.setFontSize(13); doc.setTextColor(...tinta);
  doc.text(doc.splitTextToSize(compromiso() || "—", W - 2 * M), M, y);

  doc.setTextColor(...suave); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text("Action Clean · Capacitación de finanzas personales · 27 de noviembre de 2026 · Este documento es personal.", W / 2, 792 - 24, { align: "center" });
  memorias(doc, { W, M, azul, morado, tinta, suave, linea });
  return doc.output("blob");
}
function memorias(doc, k) {
  const { W, M, azul, morado, tinta, suave } = k;
  doc.addPage();
  doc.setFillColor(...morado); doc.rect(0, 0, W, 10, "F");
  let y = 64;
  doc.setFont("helvetica", "normal"); doc.setFontSize(24); doc.setTextColor(...tinta);
  doc.text("Memorias de la capacitación", M, y);
  y += 18; doc.setFontSize(11); doc.setTextColor(...suave);
  doc.text("Lo que vimos el viernes 27 de noviembre de 2026, para repasarlo en cada quincena.", M, y);
  const ideas = [
    ["La cuenta más importante", "Lo que me entra - lo que me sale = lo que me queda. Si sale más de lo que entra, me endeudo. Si sale menos, puedo ahorrar."],
    ["¿Lo necesito o lo quiero?", "Mercado, arriendo y medicamentos se necesitan. Lo que solo quiero, espero 3 días: si después lo sigo queriendo y me alcanza, lo compro."],
    ["Los gastos hormiga", "Son pequeñitos pero se comen la quincena. Un tinto y una arepa al día ($5.000) suman $150.000 al mes y más de $1.800.000 al año."],
    ["Cuatro bolsillos apenas me paguen", "1. Ahorro (primero, aunque sean $20.000). 2. Casa. 3. Comida y transporte. 4. Deudas. Con sobres de papel o con los bolsillos de Nequi."],
    ["Cuidado con el gota a gota", "Cobra unos $20.000 al mes por cada $100.000 (cerca de 790 % al año). Un banco o cooperativa no puede pasar la tasa de usura: en noviembre de 2026, 28,34 % al año, unos $2.100 al mes por cada $100.000."],
    ["La prima en 3 partes", "Pagar deudas, guardar para enero (útiles, uniformes, matrícula, arriendo) y disfrutar la Navidad."],
    ["Una meta que sirve", "Dice qué quiero, cuánto cuesta y para cuándo. Ejemplo: útiles por $180.000 en 4 quincenas = $45.000 cada quincena."],
  ];
  y += 12;
  ideas.forEach(([t, d], i) => {
    y += 30;
    doc.setFillColor(...azul); doc.circle(M + 11, y - 4, 11, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(String(i + 1), M + 11, y, { align: "center" });
    doc.setTextColor(...morado); doc.setFontSize(13); doc.text(t, M + 32, y);
    doc.setTextColor(...tinta); doc.setFont("helvetica", "normal"); doc.setFontSize(11);
    const lineas = doc.splitTextToSize(d, W - 2 * M - 32);
    doc.text(lineas, M + 32, y + 16);
    y += 16 + lineas.length * 13;
  });
  // Las 3 ideas para llevar
  const yp = Math.max(y + 24, 792 - 150);
  doc.setFillColor(...morado); doc.roundedRect(M, yp, W - 2 * M, 84, 10, 10, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text("Tres cosas para empezar hoy", M + 18, yp + 24);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  ["1. Anote lo que gasta, aunque sea poquito.", "2. Apenas le paguen, separe primero el ahorro.", "3. Antes de comprar, espere 3 días."]
    .forEach((t, i) => doc.text(t, M + 18, yp + 44 + i * 14));
  doc.setTextColor(...suave); doc.setFontSize(9);
  doc.text("Action Clean · Capacitación de finanzas personales · 27 de noviembre de 2026 · Este documento es personal.", W / 2, 792 - 24, { align: "center" });
}
function nombreArchivo() {
  const n = (S.nombre || "mi").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `Mi-plan-${n || "Action-Clean"}.pdf`;
}
$("z-pdf").addEventListener("click", async () => {
  const btn = $("z-pdf"); ocupado(btn, true); error("z-error", "");
  try {
    const blob = await generarPDF();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nombreArchivo();
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    $("z-donde").hidden = false;
    avance("pdf", (Date.now() - vivo.t0) / 1000);
  } catch { error("z-error", "No se pudo crear el PDF. Tome un pantallazo de su plan."); }
  finally { ocupado(btn, false); }
});
$("z-compartir").addEventListener("click", async () => {
  const btn = $("z-compartir"); ocupado(btn, true); error("z-error", "");
  try {
    const file = new File([await generarPDF()], nombreArchivo(), { type: "application/pdf" });
    await navigator.share({ files: [file], title: "Mi plata, mi plan" });
    avance("compartir", (Date.now() - vivo.t0) / 1000);
  } catch (e) { if (e && e.name !== "AbortError") error("z-error", "No se pudo compartir. Use «Descargar mi PDF»."); }
  finally { ocupado(btn, false); }
});

window.addEventListener("online", () => reintentarFoto());
iniciar();
