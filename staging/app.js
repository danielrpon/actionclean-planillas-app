/* Planilla digital · Action Clean · app de la empleada
   Reglas: hora del servidor (marcar() la pone), nunca bloquear, coordenadas con Number.isFinite,
   cámara solo con gesto del usuario (iOS), nunca innerHTML con datos (solo textContent). */
"use strict";

const VERSION = "v0.1.0";
const ENTORNOS = {
  staging: {
    nombre: "Pruebas",
    url: "https://yunevkubrndtccgocwfg.supabase.co",
    llave: "sb_publishable_zkDa9TL99nHBMzTDPW4FRA_m7fEx2cq",
  },
  produccion: null, // se configura al crear el proyecto de producción
};
const ES_STAGING = location.pathname.includes("/staging") || ["localhost", "127.0.0.1"].includes(location.hostname);
const ENT = ENTORNOS[ES_STAGING ? "staging" : "produccion"];
const TZ = "America/Bogota";
const CLAVE_CEDULA = "ac_planilla_cedula";

const $ = (id) => document.getElementById(id);
const esNum = (v) => typeof v === "number" && Number.isFinite(v);

let sb = null;
const estado = {
  empleada: null, centros: [], horariosHoy: [], jornada: null,
  pos: null, gpsError: null, watchId: null,
  centroElegido: undefined, // undefined = sugerido; null = «mi centro no aparece»; objeto = elegido
  tipo: "entrada", selfiePath: null, horaDeclarada: null, stream: null, tick: null,
};

/* ───────── Utilidades ───────── */
function mostrar(id) {
  document.querySelectorAll(".pantalla").forEach((p) => { p.hidden = true; p.removeAttribute("data-entrando"); });
  const p = $(id);
  p.hidden = false;
  void p.offsetWidth; // reinicia la animación de entrada
  p.setAttribute("data-entrando", "");
  window.scrollTo(0, 0);
  if (id !== "p-camara") apagarCamara();
}

function horaTexto(fecha) {
  return new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true })
    .format(fecha).replace(/\s?a\.?\s?m\.?/i, " a. m.").replace(/\s?p\.?\s?m\.?/i, " p. m.");
}
function fechaLarga(fecha) {
  const t = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(fecha);
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function fechaISO(fecha) { // yyyy-mm-dd en Bogotá
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(fecha);
}
function horaDe(t) { // "14:30:00" → "2:30 p. m."
  const [h, m] = t.split(":").map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, h + 5, m)); // 5 = offset Bogotá
  return horaTexto(d);
}
function distanciaM(a, b, c, d) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
function distanciaTexto(m) {
  if (!esNum(m)) return "";
  return m < 1000 ? `A ${Math.round(m / 10) * 10 || 5} m` : `A ${(m / 1000).toFixed(1).replace(".", ",")} km`;
}
function ocupado(btn, si) {
  btn.disabled = si;
  btn.setAttribute("aria-busy", si ? "true" : "false");
}
function error(id, texto) { const e = $(id); e.textContent = texto || ""; e.hidden = !texto; }
function esWebview() {
  const ua = navigator.userAgent || "";
  return /WhatsApp|FBAN|FBAV|Instagram|; wv\)/i.test(ua);
}
const MENSAJES = {
  selfie_requerida: "No se pudo guardar la foto. Intente de nuevo.",
  jornada_abierta: "Ya tiene una entrada abierta. Marque primero la salida.",
  sin_jornada_abierta: "No encontramos una entrada abierta.",
  hora_declarada_invalida: "Esa hora no es válida. Si ya pasaron más de 3 días, avísele a Paula.",
  salida_antes_de_entrada: "La salida no puede ser antes de la entrada.",
  centro_invalido: "Ese centro ya no está activo. Elija otro.",
  sin_empleada: "Esta cuenta no corresponde a una empleada activa.",
};
function mensajeDe(err) {
  const m = (err && (err.message || err.error_description)) || "";
  for (const k of Object.keys(MENSAJES)) if (m.includes(k)) return MENSAJES[k];
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "Sin conexión. Revise los datos o el wifi e intente de nuevo.";
  return "Algo falló. Intente de nuevo en un momento.";
}

/* ───────── Arranque ───────── */
async function iniciar() {
  $("pie-version").textContent = `${VERSION}${ES_STAGING ? " · " + ENT.nombre : ""}`;
  if (!ENT) {
    $("p-cargando").querySelector(".sub").textContent = "Esta versión aún no está disponible.";
    return;
  }
  sb = window.supabase.createClient(ENT.url, ENT.llave, { auth: { persistSession: true, autoRefreshToken: true } });
  const ced = localStorage.getItem(CLAVE_CEDULA) || "";
  $("e-cedula").value = ced; $("a-cedula").value = ced;
  $("e-webview").hidden = !esWebview();

  const { data } = await sb.auth.getSession();
  if (data.session) await cargarEstado();
  else mostrar(ced ? "p-entrar" : "p-activar");
}

async function cargarEstado() {
  mostrar("p-cargando");
  $("pie-salir").hidden = false;
  const [r1, r2, r3] = await Promise.all([
    sb.rpc("mi_estado"),
    sb.from("centros").select("id,nombre,lat,lng,radio_m").eq("activo", true).order("nombre"),
    sb.rpc("mis_horarios_hoy"),
  ]);
  if (r1.error) { await salirConMensaje("Su sesión venció. Entre de nuevo."); return; }
  estado.empleada = r1.data && r1.data.empleada;
  estado.jornada = r1.data && r1.data.jornada_abierta;
  estado.centros = r2.data || [];
  estado.horariosHoy = r3.data || [];
  if (!estado.empleada) { mostrar("p-noempleada"); return; }
  iniciarGPS();
  if (estado.jornada) {
    const hoy = fechaISO(new Date());
    if (estado.jornada.fecha < hoy) return mostrarOlvidada();
    return mostrarJornada();
  }
  mostrarInicio();
}

async function salirConMensaje(texto) {
  await sb.auth.signOut();
  $("pie-salir").hidden = true;
  mostrar("p-entrar");
  error("e-error", texto);
}

/* ───────── Acceso (Edge Function) ───────── */
async function llamarAcceso(cuerpo) {
  const r = await fetch(`${ENT.url}/functions/v1/acceso`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ENT.llave },
    body: JSON.stringify(cuerpo),
  });
  let d = {};
  try { d = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok || !d.ok) throw new Error(d.mensaje || "Algo falló. Intente de nuevo.");
  await sb.auth.setSession({ access_token: d.sesion.access_token, refresh_token: d.sesion.refresh_token });
  localStorage.setItem(CLAVE_CEDULA, cuerpo.cedula);
}

$("f-activar").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = ev.submitter || ev.target.querySelector(".btn");
  const cedula = $("a-cedula").value.replace(/\D/g, "");
  const pin = $("a-pin").value;
  error("a-error");
  if (cedula.length < 5) return error("a-error", "Escriba su cédula, solo números.");
  if (!$("a-codigo").value.trim()) return error("a-error", "Escriba el código que le mandó Paula.");
  if (!/^\d{6}$/.test(pin)) return error("a-error", "El PIN debe tener 6 números.");
  ocupado(btn, true);
  try {
    await llamarAcceso({ accion: "activar", cedula, codigo: $("a-codigo").value, pin });
    $("a-pin").value = ""; $("a-codigo").value = "";
    await cargarEstado();
  } catch (e) { error("a-error", e.message); }
  finally { ocupado(btn, false); }
});

$("f-entrar").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = ev.submitter || ev.target.querySelector(".btn");
  const cedula = $("e-cedula").value.replace(/\D/g, "");
  const pin = $("e-pin").value;
  error("e-error");
  if (cedula.length < 5) return error("e-error", "Escriba su cédula, solo números.");
  if (!/^\d{6}$/.test(pin)) return error("e-error", "El PIN tiene 6 números.");
  ocupado(btn, true);
  try {
    await llamarAcceso({ accion: "ingresar", cedula, pin });
    $("e-pin").value = "";
    await cargarEstado();
  } catch (e) { error("e-error", e.message); $("e-pin").value = ""; }
  finally { ocupado(btn, false); }
});

document.querySelectorAll("[data-ir]").forEach((b) => b.addEventListener("click", () => {
  const destino = b.getAttribute("data-ir");
  if (destino === "p-inicio") { mostrarInicio(); return; }
  mostrar(destino);
}));
document.querySelectorAll("[data-salir]").forEach((b) => b.addEventListener("click", async () => {
  if (estado.watchId != null) navigator.geolocation.clearWatch(estado.watchId);
  estado.watchId = null;
  await sb.auth.signOut();
  $("pie-salir").hidden = true;
  mostrar("p-entrar");
}));

/* ───────── GPS ───────── */
function iniciarGPS(desdeGesto) {
  if (!("geolocation" in navigator)) { estado.gpsError = "Este celular no permite ubicación."; pintarGPS(); return; }
  const opciones = { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 };
  navigator.geolocation.getCurrentPosition((p) => {
    fijarPos(p);
    if (estado.watchId == null) { // el watch solo tras el primer fix bueno (lección iOS)
      estado.watchId = navigator.geolocation.watchPosition(fijarPos, () => {}, opciones);
    }
  }, (e) => {
    estado.gpsError = e.code === 1
      ? "Ubicación sin permiso. Actívela en los ajustes del navegador."
      : e.code === 3 ? "La ubicación tarda. Salga a un lugar más abierto." : "No se encuentra la ubicación.";
    pintarGPS();
    $("i-gps-pedir").hidden = e.code !== 1 || !!desdeGesto;
  }, opciones);
}
function fijarPos(p) {
  const { latitude: lat, longitude: lng, accuracy: acc } = p.coords;
  if (!esNum(lat) || !esNum(lng)) return;
  estado.pos = { lat, lng, acc: esNum(acc) ? acc : null, t: Date.now() };
  estado.gpsError = null;
  $("i-gps-pedir").hidden = true;
  $("i-singps").hidden = true; $("j-singps").hidden = true;
  pintarGPS();
  if (!$("p-inicio").hidden) pintarCentro();
}
function pintarGPS() {
  for (const id of ["i-gps", "j-gps"]) {
    const el = $(id);
    const span = el.querySelector("span");
    if (estado.pos) { el.dataset.estado = "lista"; span.textContent = `Ubicación lista · ±${Math.round(estado.pos.acc || 0)} m`; }
    else if (estado.gpsError) { el.dataset.estado = "error"; span.textContent = estado.gpsError; }
    else { el.dataset.estado = "buscando"; span.textContent = "Buscando ubicación…"; }
  }
  $("i-webview").hidden = !(esWebview() && !estado.pos);
}
$("i-gps-pedir").addEventListener("click", () => iniciarGPS(true));

/* ───────── Inicio ───────── */
function centrosProgramados() {
  const ids = new Set(estado.horariosHoy.map((h) => h.centro_id));
  if (estado.empleada && estado.empleada.centro_habitual_id) ids.add(estado.empleada.centro_habitual_id);
  return ids;
}
function centrosOrdenados() {
  const lista = estado.centros.map((c) => ({
    ...c,
    dist: estado.pos && esNum(c.lat) && esNum(c.lng) ? distanciaM(estado.pos.lat, estado.pos.lng, c.lat, c.lng) : null,
  }));
  lista.sort((a, b) => (a.dist ?? 1e12) - (b.dist ?? 1e12) || a.nombre.localeCompare(b.nombre, "es"));
  return lista;
}
function centroSugerido() {
  const lista = centrosOrdenados();
  const prog = centrosProgramados();
  const cercano = lista.find((c) => c.dist != null && c.dist <= c.radio_m + Math.min(estado.pos?.acc || 0, 100));
  if (cercano) return cercano;
  return lista.find((c) => prog.has(c.id)) || lista[0] || null;
}
function centroActual() {
  if (estado.centroElegido === null) return null;
  if (estado.centroElegido) {
    return centrosOrdenados().find((c) => c.id === estado.centroElegido.id) || estado.centroElegido;
  }
  return centroSugerido();
}
function pintarCentro() {
  const c = centroActual();
  const prog = centrosProgramados();
  if (estado.centroElegido === null) {
    $("i-centro-nombre").textContent = "Centro no registrado";
    $("i-centro-detalle").textContent = "Paula lo revisará con su ubicación.";
    $("i-cambiar").textContent = "Elegir de la lista";
    return;
  }
  $("i-cambiar").textContent = "Es otro centro";
  if (!c) {
    $("i-centro-nombre").textContent = "Aún no hay centros";
    $("i-centro-detalle").textContent = "Toque «Mi centro no aparece».";
    return;
  }
  $("i-centro-nombre").textContent = c.nombre;
  const partes = [];
  if (c.dist != null) partes.push(distanciaTexto(c.dist));
  if (prog.has(c.id)) partes.push("su centro de hoy");
  $("i-centro-detalle").textContent = partes.join(" · ");
}
function mostrarInicio() {
  const ahora = new Date();
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(ahora));
  const saludo = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  const nombre = (estado.empleada.nombre || "").split(" ")[0];
  $("i-saludo").textContent = nombre ? `${saludo}, ${nombre}` : saludo;
  $("i-fecha").textContent = fechaLarga(ahora);
  estado.tipo = "entrada";
  estado.centroElegido = undefined;
  $("i-singps").hidden = true;
  pintarGPS(); pintarCentro();
  mostrar("p-inicio");
}
$("i-cambiar").addEventListener("click", () => {
  const ul = $("c-lista");
  ul.replaceChildren();
  const prog = centrosProgramados();
  for (const c of centrosOrdenados()) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const n = document.createElement("span"); n.className = "n"; n.textContent = c.nombre;
    const d = document.createElement("span"); d.className = "d";
    d.textContent = [c.dist != null ? distanciaTexto(c.dist) : "", prog.has(c.id) ? "su centro de hoy" : ""].filter(Boolean).join(" · ") || " ";
    b.append(n, d);
    b.addEventListener("click", () => { estado.centroElegido = c; pintarCentro(); mostrar("p-inicio"); });
    li.append(b); ul.append(li);
  }
  mostrar("p-centros");
});
$("i-no-esta").addEventListener("click", () => { estado.centroElegido = null; pintarCentro(); });

function pedirMarca(tipo, idSinGps) {
  estado.tipo = tipo;
  if (!estado.pos && $(idSinGps).hidden) { $(idSinGps).hidden = false; return; }
  abrirCamara();
}
$("i-marcar").addEventListener("click", () => pedirMarca("entrada", "i-singps"));
$("i-singps-si").addEventListener("click", () => abrirCamara());
$("j-marcar").addEventListener("click", () => pedirMarca("salida", "j-singps"));
$("j-singps-si").addEventListener("click", () => abrirCamara());

/* ───────── Cámara ───────── */
function apagarCamara() {
  if (estado.stream) { estado.stream.getTracks().forEach((t) => t.stop()); estado.stream = null; }
}
async function abrirCamara() {
  // Debe correr dentro del toque del usuario (iOS exige gesto vivo para getUserMedia).
  const nombreCentro = estado.tipo === "entrada"
    ? (centroActual()?.nombre || "Centro no registrado")
    : (estado.centros.find((c) => c.id === estado.jornada?.centro_id)?.nombre || "");
  $("k-sello").textContent = `${new Intl.DateTimeFormat("es-CO", { timeZone: TZ, dateStyle: "short" }).format(new Date())} · ${estado.tipo}\n${nombreCentro}`;
  $("k-instr").textContent = "Ponga su cara en el óvalo";
  $("k-disparar").disabled = true;
  mostrar("p-camara");
  try {
    estado.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false,
    });
    const v = $("k-video");
    v.srcObject = estado.stream;
    await v.play().catch(() => {});
    $("k-disparar").disabled = false;
  } catch {
    // Respaldo: el selector nativo con capture=user abre la cámara frontal directamente.
    $("k-instr").textContent = "Toque el botón azul para abrir la cámara";
    $("k-disparar").disabled = false;
  }
}
$("k-cancelar").addEventListener("click", () => { estado.jornada ? mostrarJornada() : mostrarInicio(); });
$("k-disparar").addEventListener("click", async () => {
  if (!estado.stream) { $("k-respaldo").click(); return; }
  const v = $("k-video");
  if (!v.videoWidth) return;
  const blob = await recortar(v, v.videoWidth, v.videoHeight);
  apagarCamara();
  await enviarMarca(blob);
});
$("k-respaldo").addEventListener("change", async (ev) => {
  const f = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (!f) return;
  // Una foto vieja de la galería no sirve: solo se acepta si es de los últimos 2 minutos.
  if (f.lastModified && Date.now() - f.lastModified > 120000) {
    $("k-instr").textContent = "Use una foto tomada ahora, no de la galería.";
    return;
  }
  const img = await createImageBitmap(f).catch(() => null);
  if (!img) { $("k-instr").textContent = "No se pudo leer la foto. Intente de nuevo."; return; }
  await enviarMarca(await recortar(img, img.width, img.height));
});
function recortar(fuente, w, h) {
  const max = 720;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(fuente, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob((b) => ok(b), "image/jpeg", 0.72));
}

/* ───────── Enviar marca ───────── */
async function enviarMarca(blob, motivo, horaDeclarada) {
  if (horaDeclarada) estado.horaDeclarada = horaDeclarada;
  horaDeclarada = estado.horaDeclarada;
  mostrar("p-enviando");
  $("v-texto").textContent = "Guardando su marca…";
  try {
    if (blob) {
      const ruta = `${estado.empleada.id}/${fechaISO(new Date())}/${crypto.randomUUID()}.jpg`;
      const { error: eSubida } = await sb.storage.from("selfies").upload(ruta, blob, { contentType: "image/jpeg", upsert: false });
      if (eSubida) throw eSubida;
      estado.selfiePath = ruta;
    }
    const c = estado.tipo === "entrada" ? centroActual() : null;
    const pos = estado.pos && Date.now() - estado.pos.t < 120000 ? estado.pos : null;
    const { data, error: e } = await sb.rpc("marcar", {
      p_tipo: estado.tipo,
      p_centro_id: estado.tipo === "entrada" ? (c ? c.id : null) : null,
      p_lat: horaDeclarada ? null : pos?.lat ?? null,
      p_lng: horaDeclarada ? null : pos?.lng ?? null,
      p_precision_m: horaDeclarada ? null : pos?.acc ?? null,
      p_selfie_path: horaDeclarada ? null : estado.selfiePath,
      p_hora_declarada: horaDeclarada || null,
      p_motivo_adicional: motivo || null,
    });
    if (e) {
      if ((e.message || "").includes("motivo_requerido")) return mostrarAdicional();
      throw e;
    }
    await mostrarResultado(data, horaDeclarada);
  } catch (e) {
    const m = mensajeDe(e);
    estado.horaDeclarada = null;
    if (estado.jornada) {
      if (estado.jornada.fecha < fechaISO(new Date())) mostrarOlvidada(); else await mostrarJornada();
    } else mostrarInicio();
    mostrarAvisoTemporal(m);
  }
}
function mostrarAvisoTemporal(texto) {
  const pant = document.querySelector(".pantalla:not([hidden])");
  let a = pant.querySelector(".aviso-error");
  if (!a) { a = document.createElement("p"); a.className = "error aviso-error"; a.setAttribute("role", "alert"); pant.insertBefore(a, pant.querySelector(".espacio")); }
  a.textContent = texto;
}

/* ───────── Resultado ───────── */
async function mostrarResultado(r, declarada) {
  const v = r.validacion;
  const tipo = estado.tipo;
  // Hora registrada por el servidor (no la del celular).
  const { data: m } = await sb.from("marcas").select("registrada_en,hora_declarada")
    .eq("jornada_id", r.jornada_id).eq("tipo", tipo).maybeSingle();
  const hora = m ? new Date(m.hora_declarada || m.registrada_en) : new Date();
  const centroId = tipo === "entrada" ? centroActual()?.id : estado.jornada?.centro_id;
  const centro = estado.centros.find((c) => c.id === centroId);

  $("r-sello").dataset.estado = v;
  $("r-icono").setAttribute("href", v === "verde" ? "#i-ok" : v === "amarillo" ? "#i-rev" : "#i-mal");
  $("r-titulo").textContent = tipo === "entrada" ? "Entrada registrada" : declarada ? "Salida guardada" : "Salida registrada";
  $("r-hora").textContent = horaTexto(hora);
  $("r-centro").textContent = centro ? centro.nombre : "Centro no registrado";
  const est = $("r-estado");
  est.dataset.estado = v;
  est.replaceChildren();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", v === "verde" ? "#i-ok" : v === "amarillo" ? "#i-rev" : "#i-mal");
  svg.append(use);
  est.append(svg, document.createTextNode(v === "verde" ? "En su centro" : "Para revisar"));

  let aviso = "";
  if (v !== "verde") {
    if (!centro) aviso = "Su centro no está registrado. Paula lo revisará; usted no tiene que hacer nada.";
    else if (declarada) aviso = "Es una hora declarada. El cliente la revisará.";
    else if (r.distancia_m == null) aviso = "La marca quedó sin ubicación. Paula la revisará; usted no tiene que hacer nada.";
    else if (v === "rojo") aviso = `Quedó lejos del centro (${distanciaTexto(r.distancia_m).toLowerCase()}). Paula la revisará; usted no tiene que hacer nada.`;
    else aviso = "Este centro no estaba en su programación de hoy. Paula lo revisará; usted no tiene que hacer nada.";
  }
  $("r-aviso").textContent = aviso; $("r-aviso").hidden = !aviso;

  // P1 · varios centros: tras la salida, avisar el siguiente centro del día.
  let siguiente = "";
  if (tipo === "salida") {
    const ahoraHM = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const h = estado.horariosHoy.find((x) => x.hora_inicio.slice(0, 5) > ahoraHM && x.centro_id !== centroId);
    const c2 = h && estado.centros.find((c) => c.id === h.centro_id);
    if (c2) siguiente = `Hoy sigue en ${c2.nombre} a las ${horaDe(h.hora_inicio)}. Marque la entrada cuando llegue.`;
  }
  $("r-siguiente").textContent = siguiente; $("r-siguiente").hidden = !siguiente;

  estado.selfiePath = null;
  estado.horaDeclarada = null;
  mostrar("p-resultado");
}
$("r-listo").addEventListener("click", () => cargarEstado());

/* ───────── Jornada abierta ───────── */
async function mostrarJornada() {
  const j = estado.jornada;
  if (!j) return mostrarInicio();
  const c = estado.centros.find((x) => x.id === j.centro_id);
  $("j-centro").textContent = c ? c.nombre : "Centro no registrado";
  const entrada = new Date(j.entrada);
  $("j-desde").textContent = `Desde las ${horaTexto(entrada)}`;
  const h = estado.horariosHoy.find((x) => x.centro_id === j.centro_id);
  $("j-horario").hidden = !h; $("j-barra").hidden = !h;
  if (h) $("j-horario").textContent = `Su horario aquí: hasta las ${horaDe(h.hora_fin)}`;
  const pintar = () => {
    const min = Math.max(0, Math.floor((Date.now() - entrada.getTime()) / 60000));
    $("j-duracion").textContent = min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
    if (h) {
      const [hi, mi] = h.hora_inicio.split(":").map(Number), [hf, mf] = h.hora_fin.split(":").map(Number);
      const total = ((hf * 60 + mf) - (hi * 60 + mi) + 1440) % 1440 || 1;
      $("j-barra-i").style.width = `${Math.min(100, (min / total) * 100)}%`;
    }
  };
  pintar();
  clearInterval(estado.tick); estado.tick = setInterval(pintar, 30000);
  estado.tipo = "salida";
  $("j-singps").hidden = true;
  pintarGPS();
  mostrar("p-jornada");
}

/* ───────── Tiempo adicional ───────── */
function mostrarAdicional() {
  const h = estado.horariosHoy.find((x) => x.centro_id === estado.jornada?.centro_id);
  if (h) {
    const ahora = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const [ha, ma] = ahora.split(":").map(Number), [hf, mf] = h.hora_fin.split(":").map(Number);
    const extra = (ha * 60 + ma) - (hf * 60 + mf);
    $("d-titulo").textContent = extra > 0 ? `Salió ${extra >= 60 ? Math.floor(extra / 60) + " h " : ""}${extra % 60} min después de su horario` : "Salió después de su horario";
    $("d-sub").textContent = `Su horario termina a las ${horaDe(h.hora_fin)}. ¿Por qué se quedó?`;
  }
  document.querySelectorAll("input[name=motivo]").forEach((r) => { r.checked = false; });
  $("d-detalle").value = "";
  error("d-error");
  mostrar("p-adicional");
}
$("f-adicional").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const sel = document.querySelector("input[name=motivo]:checked");
  const det = $("d-detalle").value.trim();
  if (!sel) return error("d-error", "Elija un motivo.");
  if (sel.value === "Otro motivo" && !det) return error("d-error", "Cuéntenos qué pasó.");
  await enviarMarca(null, det ? `${sel.value}: ${det}` : sel.value, null);
});
document.querySelectorAll("input[name=motivo]").forEach((r) => r.addEventListener("change", () => {
  $("d-ayuda").textContent = r.value === "Otro motivo" ? "Obligatorio" : "Opcional";
}));

/* ───────── Salida olvidada ───────── */
function mostrarOlvidada() {
  const j = estado.jornada;
  const c = estado.centros.find((x) => x.id === j.centro_id);
  const entrada = new Date(j.entrada);
  $("o-sub").textContent = `${fechaLarga(entrada)} · ${c ? c.nombre : "centro no registrado"} · entró a las ${horaTexto(entrada)}`;
  const sh = $("o-hora"), sm = $("o-min");
  if (!sh.options.length) {
    for (let i = 1; i <= 12; i++) sh.add(new Option(String(i), String(i)));
    for (let i = 0; i < 60; i += 5) sm.add(new Option(String(i).padStart(2, "0"), String(i)));
  }
  const h = estado.horariosHoy.find((x) => x.centro_id === j.centro_id);
  const [hf, mf] = h ? h.hora_fin.split(":").map(Number) : [14, 30];
  sh.value = String(((hf + 11) % 12) + 1); sm.value = String(mf - (mf % 5)); $("o-ampm").value = hf >= 12 ? "pm" : "am";
  error("o-error");
  estado.tipo = "salida";
  mostrar("p-olvidada");
}
$("f-olvidada").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  let h = Number($("o-hora").value) % 12;
  if ($("o-ampm").value === "pm") h += 12;
  const m = Number($("o-min").value);
  const iso = `${estado.jornada.fecha}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-05:00`;
  if (new Date(iso) <= new Date(estado.jornada.entrada)) return error("o-error", "La salida debe ser después de la entrada.");
  await enviarMarca(null, null, iso);
});

window.addEventListener("pageshow", (e) => { if (e.persisted && sb) cargarEstado(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) apagarCamara(); });
iniciar();
