/* Planilla digital · Action Clean · administración (Paula)
   Toda escritura sensible va por funciones con motivo (revisar_jornada, asignar_centro, cerrar_jornada,
   generar_codigo). Nunca innerHTML con datos: el DOM se arma con h(). */
"use strict";

const VERSION = "v0.1.1";
const ENTORNOS = {
  staging: { nombre: "Pruebas", url: "https://yunevkubrndtccgocwfg.supabase.co", llave: "sb_publishable_zkDa9TL99nHBMzTDPW4FRA_m7fEx2cq" },
  produccion: null,
};
const ES_STAGING = location.pathname.includes("/staging") || ["localhost", "127.0.0.1"].includes(location.hostname);
const ENT = ENTORNOS[ES_STAGING ? "staging" : "produccion"];
const TZ = "America/Bogota";
const URL_APP = location.href.replace(/admin\.html.*$/, "");

const $ = (id) => document.getElementById(id);
const esNum = (v) => typeof v === "number" && Number.isFinite(v);
let sb = null;
const datos = { centros: [], clientes: [], empleadas: [], accesos: new Map() };

/* ───────── Utilidades ───────── */
function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of hijos.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const fmtHora = (d) => d ? new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(d)) : "—";
const fmtDia = (d) => new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(d));
const hoyISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const horaEfectiva = (m) => m && (m.hora_declarada || m.registrada_en);
function toast(texto, tipo) {
  const t = $("toast");
  t.textContent = texto; t.dataset.tipo = tipo || ""; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500);
}
const ERRORES = {
  motivo_requerido: "Escriba el motivo.", solo_admin: "Su cuenta no es de administración.",
  hora_invalida: "La hora debe ser después de la entrada y no en el futuro.", jornada_no_abierta: "Esa jornada ya está cerrada.",
  duplicate: "Ya existe un registro con esos datos.",
};
function errorTexto(e) {
  const m = (e && (e.message || e.details)) || "";
  for (const [k, v] of Object.entries(ERRORES)) if (m.includes(k)) return v;
  if (m.includes("cedula_check")) return "La cédula debe tener solo números (5 a 12).";
  return "No se pudo guardar. " + m;
}
function estadoChip(e, texto) {
  const t = texto || { verde: "En orden", amarillo: "Para revisar", rojo: "Pendiente", abierta: "Abierta" }[e];
  return h("span", { class: "estado", dataset: { e } }, t);
}
function ocupado(btn, si) { if (btn) { btn.disabled = si; } }
/* Coordenadas desde un enlace de Google Maps o "lat, lng" */
function coordenadasDe(texto) {
  const t = String(texto || "");
  const pats = [/@(-?\d+\.\d+),(-?\d+\.\d+)/, /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /[?&](?:q|ll|query)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/];
  for (const p of pats) {
    const m = t.match(p);
    if (m) { const lat = Number(m[1]), lng = Number(m[2]); if (esNum(lat) && esNum(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }; }
  }
  return null;
}

/* ───────── Arranque y sesión ───────── */
async function iniciar() {
  $("pie-entorno").textContent = `${VERSION}${ES_STAGING ? " · " + ENT.nombre : ""}`;
  if (!ENT) { document.body.append(h("p", { class: "vacio" }, "Esta versión aún no está disponible.")); return; }
  sb = window.supabase.createClient(ENT.url, ENT.llave, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data } = await sb.auth.getSession();
  if (data.session && await esAdmin()) return entrar();
  $("v-login").hidden = false;
}
async function esAdmin() {
  const { data } = await sb.rpc("es_admin");
  return data === true;
}
$("f-login").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = ev.submitter; ocupado(btn, true);
  $("l-error").hidden = true;
  const { error } = await sb.auth.signInWithPassword({ email: $("l-correo").value.trim(), password: $("l-clave").value });
  if (error) { $("l-error").textContent = "Correo o contraseña incorrectos."; $("l-error").hidden = false; ocupado(btn, false); return; }
  if (!await esAdmin()) { await sb.auth.signOut(); $("l-error").textContent = "Esta cuenta no tiene permisos de administración."; $("l-error").hidden = false; ocupado(btn, false); return; }
  ocupado(btn, false);
  entrar();
});
$("b-salir").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

async function entrar() {
  $("v-login").hidden = true; $("v-app").hidden = false;
  $("j-fecha").value = hoyISO();
  await cargarMaestros();
  irA(location.hash.slice(1) || "pendientes");
}
async function cargarMaestros() {
  const [c, cl, e, a] = await Promise.all([
    sb.from("centros").select("id,cliente_id,nombre,direccion,lat,lng,radio_m,activo,coordenadas_confirmadas").order("nombre"),
    sb.from("clientes").select("id,nombre").order("nombre"),
    sb.from("empleadas").select("id,cedula,nombre,perfil,puesto,centro_habitual_id,activa,user_id").order("nombre"),
    sb.rpc("accesos_admin"),
  ]);
  datos.centros = c.data || []; datos.clientes = cl.data || []; datos.empleadas = e.data || [];
  datos.accesos = new Map((a.data || []).map((x) => [x.empleada_id, x]));
}
const centroPorId = (id) => datos.centros.find((c) => c.id === id);
const clientePorId = (id) => datos.clientes.find((c) => c.id === id);
const empleadaPorId = (id) => datos.empleadas.find((e) => e.id === id);

/* ───────── Navegación ───────── */
document.querySelectorAll("[data-vista]").forEach((b) => b.addEventListener("click", () => irA(b.dataset.vista)));
document.querySelectorAll("[data-recargar]").forEach((b) => b.addEventListener("click", async () => { await cargarMaestros(); pintarPendientes(); }));
function irA(v) {
  if (!["pendientes", "jornadas", "empleadas", "centros"].includes(v)) v = "pendientes";
  document.querySelectorAll("[data-vista]").forEach((b) => { if (b.dataset.vista === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  document.querySelectorAll(".vista").forEach((s) => { s.hidden = s.id !== `vista-${v}`; });
  history.replaceState(null, "", `#${v}`);
  ({ pendientes: pintarPendientes, jornadas: pintarJornadas, empleadas: pintarEmpleadas, centros: pintarCentros })[v]();
}

/* ───────── Pendientes ───────── */
async function pintarPendientes() {
  const lista = $("pend-lista");
  const { data: js, error } = await sb.from("jornadas")
    .select("id,empleada_id,centro_id,fecha,estado,validacion,pendiente_paula,minutos_adicionales,motivo_adicional,marcas(id,tipo,registrada_en,hora_declarada,declarada,lat,lng,precision_m,distancia_m,selfie_path,validacion)")
    .is("revisada_en", null).order("creado_en", { ascending: false }).limit(200);
  if (error) { lista.replaceChildren(h("p", { class: "vacio" }, "No se pudieron cargar los pendientes.")); return; }
  const hoy = hoyISO();
  const pend = (js || []).filter((j) => j.validacion !== "verde" || (j.estado === "abierta" && j.fecha < hoy));
  const bloqueadas = datos.empleadas.filter((e) => datos.accesos.get(e.id)?.bloqueada);
  const total = pend.length + bloqueadas.length;
  $("n-pend").textContent = total; $("n-pend").hidden = !total;
  const filas = [...bloqueadas.map(filaBloqueada), ...pend.map(filaPendiente)];
  lista.replaceChildren(...(filas.length ? filas : [h("div", { class: "vacio" }, h("b", {}, "No hay pendientes"), "Todas las marcas están en orden.")]));
}

function filaBloqueada(e) {
  const cont = h("div", { class: "pend" },
    estadoChip("amarillo", "PIN bloqueado"),
    h("div", { class: "quien" }, h("b", {}, e.nombre), h("small", {}, `C.C. ${e.cedula}`)),
    h("div", { class: "por" }, "Cuenta bloqueada tras 5 intentos de PIN. Confirme con ella por WhatsApp antes de entregarle un código nuevo."),
  );
  const acc = h("div", { class: "acc" }, h("button", { class: "btn chico", type: "button", onclick: () => generarCodigo(e, acc) }, "Generar código nuevo"));
  cont.append(acc);
  return cont;
}

function filaPendiente(j) {
  const e = empleadaPorId(j.empleada_id);
  const c = centroPorId(j.centro_id);
  const ent = j.marcas.find((m) => m.tipo === "entrada");
  const sal = j.marcas.find((m) => m.tipo === "salida");
  const hoy = hoyISO();
  const abiertaVieja = j.estado === "abierta" && j.fecha < hoy;

  let tipo = j.validacion, etiqueta, explica;
  const conGps = [ent, sal].find((m) => m && esNum(m.lat));
  if (abiertaVieja) { tipo = "abierta"; etiqueta = "Sin salida"; explica = `No marcó la salida el ${fmtDia(j.fecha + "T12:00:00-05:00")}. Ciérrela con la hora que confirme con ella o con el cliente.`; }
  else if (!c) { etiqueta = "Sin centro"; explica = `Marcó «Mi centro no aparece».${conGps ? ` Ubicación: ${conGps.lat.toFixed(5)}, ${conGps.lng.toFixed(5)}.` : " Sin ubicación."}`; }
  else if (!esNum(c.lat)) { etiqueta = "Centro sin ubicación"; explica = `${c.nombre} aún no tiene coordenadas.${conGps ? " Puede usar la ubicación de esta marca para el centro." : ""}`; }
  else {
    const partes = [];
    for (const m of [ent, sal]) {
      if (!m) continue;
      const q = m.tipo === "entrada" ? "Entrada" : "Salida";
      if (m.declarada) partes.push(`${q} declarada (sin foto) a las ${fmtHora(m.hora_declarada)}.`);
      else if (m.distancia_m == null) partes.push(`${q} sin ubicación.`);
      else if (m.validacion === "rojo") partes.push(`${q} a ${m.distancia_m} m de ${c.nombre} (precisión ±${Math.round(m.precision_m || 0)} m).`);
      else if (m.validacion === "amarillo") partes.push(`${q} en ${c.nombre}, que no estaba en su programación.`);
    }
    etiqueta = j.validacion === "rojo" ? "Revisar" : "Para revisar";
    explica = partes.join(" ") || "Revise la marca.";
  }
  if (j.minutos_adicionales > 0) explica += ` Tiempo adicional: ${j.minutos_adicionales} min («${j.motivo_adicional}»).`;

  const cont = h("div", { class: "pend" },
    estadoChip(tipo, etiqueta),
    h("div", { class: "quien" }, h("b", {}, e ? e.nombre : "—"),
      h("small", {}, `${fmtDia(horaEfectiva(ent) || j.fecha)} · ${fmtHora(horaEfectiva(ent))} – ${sal ? fmtHora(horaEfectiva(sal)) : "…"}`),
      h("small", {}, c ? c.nombre : "Sin centro")),
    h("div", { class: "por" }, explica),
  );
  const fotos = h("div", { class: "fotos" }); fotos.hidden = true;
  const zonaForm = h("div", { class: "form-inline" }); zonaForm.hidden = true;
  const acc = h("div", { class: "acc" });

  const conSelfie = j.marcas.filter((m) => m.selfie_path);
  if (conSelfie.length) acc.append(h("button", { class: "btn sec chico", type: "button", onclick: async (ev) => {
    if (!fotos.hidden) { fotos.hidden = true; return; }
    ocupado(ev.currentTarget, true);
    const figs = [];
    for (const m of conSelfie) {
      const { data } = await sb.storage.from("selfies").createSignedUrl(m.selfie_path, 300);
      if (data) figs.push(h("figure", {}, h("img", { src: data.signedUrl, alt: `Selfie de ${m.tipo}` }), h("figcaption", {}, `${m.tipo} · ${fmtHora(m.registrada_en)}`)));
    }
    fotos.replaceChildren(...figs); fotos.hidden = false; ocupado(ev.currentTarget, false);
  } }, "Ver fotos"));

  const formMotivo = (label, accion, extra) => {
    zonaForm.replaceChildren();
    const inp = h("input", { placeholder: "Motivo (queda en el registro)", maxlength: "200" });
    const ok = h("button", { class: "btn chico", type: "button", onclick: async () => {
      const motivo = inp.value.trim();
      if (!motivo) { inp.focus(); toast("Escriba el motivo.", "error"); return; }
      ocupado(ok, true);
      try { await accion(motivo); toast("Listo."); await cargarMaestros(); pintarPendientes(); }
      catch (err) { toast(errorTexto(err), "error"); ocupado(ok, false); }
    } }, label);
    zonaForm.append(...(extra || []), inp, ok, h("button", { class: "btn sec chico", type: "button", onclick: () => { zonaForm.hidden = true; } }, "Cancelar"));
    zonaForm.hidden = false; (extra && extra[0] ? extra[0] : inp).focus();
  };
  const rpc = async (fn, args) => { const { error } = await sb.rpc(fn, args); if (error) throw error; };

  if (abiertaVieja) {
    acc.append(h("button", { class: "btn chico", type: "button", onclick: () => {
      const hora = h("input", { type: "time", value: "14:30", "aria-label": "Hora de salida" });
      formMotivo("Cerrar jornada", (motivo) => rpc("cerrar_jornada", { p_jornada_id: j.id, p_hora: `${j.fecha}T${hora.value}:00-05:00`, p_motivo: motivo }), [hora]);
    } }, "Cerrar con hora"));
  }
  if (!c) {
    acc.append(h("button", { class: "btn chico", type: "button", onclick: () => {
      const sel = h("select", { "aria-label": "Centro" }, h("option", { value: "" }, "Elija el centro…"), ...datos.centros.filter((x) => x.activo).map((x) => h("option", { value: x.id }, x.nombre)));
      formMotivo("Asignar", async (motivo) => { if (!sel.value) throw new Error("Elija un centro."); await rpc("asignar_centro", { p_jornada_id: j.id, p_centro_id: sel.value, p_motivo: motivo }); }, [sel]);
    } }, "Asignar a un centro"));
    if (conGps) acc.append(h("button", { class: "btn sec chico", type: "button", onclick: () => { irA("centros"); abrirFormCentro(null, { lat: conGps.lat, lng: conGps.lng }); } }, "Crear centro aquí"));
  } else if (!esNum(c.lat) && conGps) {
    acc.append(h("button", { class: "btn chico", type: "button", onclick: async (ev) => {
      ocupado(ev.currentTarget, true);
      const { error } = await sb.from("centros").update({ lat: conGps.lat, lng: conGps.lng, coordenadas_confirmadas: true }).eq("id", c.id);
      if (error) { toast(errorTexto(error), "error"); ocupado(ev.currentTarget, false); return; }
      toast(`${c.nombre} quedó ubicado con esta marca.`); await cargarMaestros(); pintarPendientes();
    } }, "Usar esta ubicación para el centro"));
  }
  if (!abiertaVieja) acc.append(h("button", { class: "btn sec chico", type: "button", onclick: () => formMotivo("Marcar revisada", (motivo) => rpc("revisar_jornada", { p_jornada_id: j.id, p_motivo: motivo })) }, "Marcar como revisada"));

  cont.append(acc, zonaForm, fotos);
  return cont;
}

/* ───────── Jornadas ───────── */
$("j-fecha").addEventListener("change", pintarJornadas);
async function pintarJornadas() {
  const cuerpo = $("j-cuerpo");
  const { data, error } = await sb.from("jornadas")
    .select("id,empleada_id,centro_id,fecha,estado,validacion,minutos_adicionales,motivo_adicional,nota_revision,revisada_en,marcas(tipo,registrada_en,hora_declarada,declarada)")
    .eq("fecha", $("j-fecha").value).order("creado_en");
  if (error) { cuerpo.replaceChildren(h("tr", {}, h("td", { colspan: "7" }, "No se pudieron cargar."))); return; }
  if (!data.length) { cuerpo.replaceChildren(h("tr", {}, h("td", { colspan: "7", class: "vacio" }, "No hay jornadas ese día."))); return; }
  cuerpo.replaceChildren(...data.map((j) => {
    const ent = j.marcas.find((m) => m.tipo === "entrada"), sal = j.marcas.find((m) => m.tipo === "salida");
    const horas = ent && sal ? ((new Date(horaEfectiva(sal)) - new Date(horaEfectiva(ent))) / 3600000) : null;
    const notas = [j.minutos_adicionales ? `+${j.minutos_adicionales} min: ${j.motivo_adicional}` : "", sal?.declarada ? "salida declarada" : "", j.nota_revision || ""].filter(Boolean).join(" · ");
    return h("tr", {},
      h("td", {}, empleadaPorId(j.empleada_id)?.nombre || "—"),
      h("td", {}, centroPorId(j.centro_id)?.nombre || "Sin centro"),
      h("td", {}, fmtHora(horaEfectiva(ent))),
      h("td", {}, sal ? fmtHora(horaEfectiva(sal)) : "—"),
      h("td", { class: "num" }, horas != null ? horas.toFixed(2).replace(".", ",") : "—"),
      h("td", {}, j.estado === "abierta" ? estadoChip("abierta") : estadoChip(j.validacion, j.revisada_en && j.validacion !== "verde" ? "Revisada" : null)),
      h("td", {}, h("small", {}, notas || "")));
  }));
}

/* ───────── Empleadas ───────── */
$("b-nueva-emp").addEventListener("click", () => abrirFormEmpleada(null));
function textoAcceso(e) {
  const a = datos.accesos.get(e.id);
  if (!a) return "Sin código";
  if (a.bloqueada) return "Bloqueada";
  if (a.activada) return "Activa";
  if (a.codigo_vigente) return "Código entregado";
  return "Código vencido";
}
function pintarEmpleadas() {
  const cuerpo = $("emp-cuerpo");
  if (!datos.empleadas.length) { cuerpo.replaceChildren(h("tr", {}, h("td", { colspan: "7", class: "vacio" }, "Aún no hay empleadas. Cree la primera con «Nueva empleada»."))); return; }
  cuerpo.replaceChildren(...datos.empleadas.map((e) => h("tr", {},
    h("td", {}, h("b", {}, e.nombre), e.activa ? null : h("small", {}, "Inactiva")),
    h("td", {}, e.cedula), h("td", {}, e.perfil), h("td", {}, e.puesto === "movil" ? "Móvil" : "Fijo"),
    h("td", {}, centroPorId(e.centro_habitual_id)?.nombre || "—"),
    h("td", {}, textoAcceso(e)),
    h("td", { class: "acciones" },
      h("button", { class: "btn sec chico", type: "button", onclick: () => abrirFormEmpleada(e) }, "Editar"),
      h("button", { class: "btn chico", type: "button", onclick: async () => { await abrirFormEmpleada(e); await generarCodigo(e, $("emp-form")); } }, "Código de acceso")))));
}
async function generarCodigo(e, contenedor) {
  const { data, error } = await sb.rpc("generar_codigo", { p_empleada_id: e.id });
  if (error) { toast(errorTexto(error), "error"); return; }
  const nombre = e.nombre.split(" ")[0];
  const mensaje = `Hola ${nombre}, este es su acceso a la planilla digital de Action Clean:\n\n1. Abra este enlace en Chrome o Safari (no dentro de WhatsApp): ${URL_APP}\n2. Escriba su cédula y este código: *${data}*\n3. Cree un PIN de 6 números que solo usted conozca.\n\nEl código vence en 7 días.`;
  const caja = h("div", { class: "codigo" },
    h("div", {}, h("div", {}, `Código para ${e.nombre}`), h("b", {}, data), h("small", { class: "ayuda" }, "Vence en 7 días. Solo se muestra esta vez.")),
    h("button", { class: "btn chico", type: "button", onclick: async () => { await navigator.clipboard.writeText(mensaje); toast("Mensaje copiado. Péguelo en WhatsApp."); } }, "Copiar mensaje para WhatsApp"));
  contenedor.querySelector(".codigo")?.remove();
  contenedor.append(caja);
  await cargarMaestros();
  // En Pendientes no se repinta: la fila desaparecería con el código antes de copiarlo.
  if (!$("vista-empleadas").hidden) pintarEmpleadasSinForm();
}
function pintarEmpleadasSinForm() { const f = $("emp-form"); const abierto = !f.hidden; pintarEmpleadas(); f.hidden = !abierto; }

async function abrirFormEmpleada(e) {
  const f = $("emp-form");
  const opcCentros = (sel) => [h("option", { value: "" }, "—"), ...datos.centros.filter((c) => c.activo).map((c) => h("option", { value: c.id, selected: c.id === sel }, c.nombre))];
  const nombre = h("input", { value: e?.nombre || "", required: true, maxlength: "120" });
  const cedula = h("input", { value: e?.cedula || "", inputmode: "numeric", required: true, maxlength: "12" });
  const perfil = h("select", {}, ...["LS", "LV", "DF", "SN"].map((p) => h("option", { value: p, selected: e?.perfil === p }, { LS: "LS · lunes a sábado", LV: "LV · lunes a viernes", DF: "DF · domingos y festivos", SN: "SN · supernumeraria" }[p])));
  const puesto = h("select", {}, h("option", { value: "fijo", selected: e?.puesto !== "movil" }, "Fijo (aprobación semanal)"), h("option", { value: "movil", selected: e?.puesto === "movil" }, "Móvil (aprobación diaria)"));
  const habitual = h("select", {}, ...opcCentros(e?.centro_habitual_id));
  const activa = h("select", {}, h("option", { value: "1", selected: e?.activa !== false }, "Activa"), h("option", { value: "0", selected: e?.activa === false }, "Inactiva"));
  const err = h("p", { class: "error", role: "alert", hidden: true });
  const guardar = h("button", { class: "btn", type: "button", onclick: async () => {
    err.hidden = true;
    const fila = { nombre: nombre.value.trim(), cedula: cedula.value.replace(/\D/g, ""), perfil: perfil.value, puesto: puesto.value, centro_habitual_id: habitual.value || null, activa: activa.value === "1" };
    if (!fila.nombre || fila.cedula.length < 5) { err.textContent = "Nombre y cédula (solo números) son obligatorios."; err.hidden = false; return; }
    ocupado(guardar, true);
    const r = e ? await sb.from("empleadas").update(fila).eq("id", e.id).select().single() : await sb.from("empleadas").insert(fila).select().single();
    ocupado(guardar, false);
    if (r.error) { err.textContent = errorTexto(r.error); err.hidden = false; return; }
    toast(e ? "Empleada actualizada." : "Empleada creada. Ahora genere su código de acceso.");
    await cargarMaestros(); pintarEmpleadas(); abrirFormEmpleada(r.data);
  } }, e ? "Guardar cambios" : "Crear empleada");

  const partes = [
    h("h2", {}, e ? `Editar · ${e.nombre}` : "Nueva empleada"),
    h("div", { class: "rejilla" },
      h("label", { class: "campo" }, "Nombre completo", nombre),
      h("label", { class: "campo" }, "Cédula", cedula),
      h("label", { class: "campo" }, "Perfil", perfil),
      h("label", { class: "campo" }, "Puesto", puesto),
      h("label", { class: "campo" }, "Centro habitual", h("span", { class: "ayuda" }, "Opcional. Los horarios de abajo también cuentan."), habitual),
      h("label", { class: "campo" }, "Estado", activa)),
    err,
  ];
  if (e) partes.push(await bloqueHorarios(e));
  partes.push(h("div", { class: "pie-panel" },
    h("button", { class: "btn sec", type: "button", onclick: () => { f.hidden = true; } }, "Cerrar"),
    e ? h("button", { class: "btn sec", type: "button", onclick: () => generarCodigo(e, f) }, "Generar código de acceso") : null,
    guardar));
  f.replaceChildren(...partes); f.hidden = false;
  f.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

const DIAS = [[1, "L"], [2, "M"], [3, "X"], [4, "J"], [5, "V"], [6, "S"], [7, "D"]];
async function bloqueHorarios(e) {
  const caja = h("div", { class: "horarios" }, h("h3", {}, "Centros y horarios"),
    h("p", { class: "sub" }, "Con su horario, las marcas en ese centro salen en verde y el tiempo adicional se detecta solo. Sin horario igual puede marcar; le llega a usted en amarillo."));
  const { data } = await sb.from("horarios_habituales").select("id,centro_id,dias,hora_inicio,hora_fin,vigente_hasta").eq("empleada_id", e.id).order("hora_inicio");
  const hoy = hoyISO();
  for (const x of (data || []).filter((x) => !x.vigente_hasta || x.vigente_hasta >= hoy)) {
    caja.append(h("div", { class: "horario" },
      h("b", {}, centroPorId(x.centro_id)?.nombre || "—"),
      h("span", {}, DIAS.filter(([n]) => x.dias.includes(n)).map(([, l]) => l).join(" ")),
      h("span", {}, `${x.hora_inicio.slice(0, 5)}–${x.hora_fin.slice(0, 5)}`),
      h("button", { class: "btn peligro chico", type: "button", onclick: async () => {
        const ayer = new Date(Date.now() - 86400000); const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(ayer);
        const { error } = await sb.from("horarios_habituales").update({ vigente_hasta: f }).eq("id", x.id);
        if (error) return toast(errorTexto(error), "error");
        toast("Horario terminado."); abrirFormEmpleada(e);
      } }, "Terminar")));
  }
  const centro = h("select", { "aria-label": "Centro" }, h("option", { value: "" }, "Centro…"), ...datos.centros.filter((c) => c.activo).map((c) => h("option", { value: c.id }, c.nombre)));
  const dias = h("div", { class: "dias" }, ...DIAS.map(([n, l]) => h("label", {}, h("input", { type: "checkbox", value: String(n), checked: n <= 5 }), h("span", {}, l))));
  const ini = h("input", { type: "time", value: "06:00", "aria-label": "Hora de inicio" });
  const fin = h("input", { type: "time", value: "14:30", "aria-label": "Hora de fin" });
  caja.append(h("div", { class: "horario" }, centro, dias, ini, fin,
    h("button", { class: "btn chico", type: "button", onclick: async () => {
      const d = [...dias.querySelectorAll("input:checked")].map((i) => Number(i.value));
      if (!centro.value || !d.length) return toast("Elija el centro y al menos un día.", "error");
      const { error } = await sb.from("horarios_habituales").insert({ empleada_id: e.id, centro_id: centro.value, dias: d, hora_inicio: ini.value, hora_fin: fin.value });
      if (error) return toast(errorTexto(error), "error");
      toast("Horario agregado."); abrirFormEmpleada(e);
    } }, "Agregar horario")));
  return caja;
}

/* ───────── Centros ───────── */
$("b-nuevo-centro").addEventListener("click", () => abrirFormCentro(null));
function pintarCentros() {
  const cuerpo = $("centro-cuerpo");
  if (!datos.centros.length) { cuerpo.replaceChildren(h("tr", {}, h("td", { colspan: "6", class: "vacio" }, "Aún no hay centros. Cree el primero con «Nuevo centro»."))); return; }
  cuerpo.replaceChildren(...datos.centros.map((c) => h("tr", {},
    h("td", {}, h("b", {}, c.nombre), c.activo ? null : h("small", {}, "Inactivo")),
    h("td", {}, clientePorId(c.cliente_id)?.nombre || "—"),
    h("td", {}, c.direccion || "—"),
    h("td", {}, esNum(c.lat) ? estadoChip("verde", c.coordenadas_confirmadas ? "Confirmada" : "Registrada") : estadoChip("amarillo", "Sin ubicación")),
    h("td", { class: "num" }, `${c.radio_m} m`),
    h("td", { class: "acciones" }, h("button", { class: "btn sec chico", type: "button", onclick: () => abrirFormCentro(c) }, "Editar")))));
}
function abrirFormCentro(c, coordsIniciales) {
  const f = $("centro-form");
  const cliente = h("input", { list: "lista-clientes", value: clientePorId(c?.cliente_id)?.nombre || "", required: true, maxlength: "120", placeholder: "Escriba o elija" });
  const listaCl = h("datalist", { id: "lista-clientes" }, ...datos.clientes.map((x) => h("option", { value: x.nombre })));
  const nombre = h("input", { value: c?.nombre || "", required: true, maxlength: "120" });
  const direccion = h("input", { value: c?.direccion || "", maxlength: "200" });
  const ini = coordsIniciales || (c && esNum(c.lat) ? { lat: c.lat, lng: c.lng } : null);
  const ubic = h("input", { value: ini ? `${ini.lat}, ${ini.lng}` : "", placeholder: "Enlace de Google Maps o «6.2442, -75.5812»" });
  const lectura = h("span", { class: "ayuda" }, ini ? "Ubicación lista." : "Abra el sitio en Google Maps en el computador y copie la dirección de la barra del navegador, o escriba «latitud, longitud».");
  ubic.addEventListener("input", () => { const k = coordenadasDe(ubic.value); lectura.textContent = k ? `Ubicación leída: ${k.lat.toFixed(5)}, ${k.lng.toFixed(5)}` : ubic.value ? "No se reconoce una ubicación en ese texto." : ""; });
  const radio = h("input", { type: "number", min: "30", max: "2000", step: "10", value: String(c?.radio_m || 150) });
  const activo = h("select", {}, h("option", { value: "1", selected: c?.activo !== false }, "Activo"), h("option", { value: "0", selected: c?.activo === false }, "Inactivo"));
  const err = h("p", { class: "error", role: "alert", hidden: true });
  const guardar = h("button", { class: "btn", type: "button", onclick: async () => {
    err.hidden = true;
    const nomCliente = cliente.value.trim();
    if (!nomCliente || !nombre.value.trim()) { err.textContent = "Cliente y nombre del centro son obligatorios."; err.hidden = false; return; }
    const k = ubic.value.trim() ? coordenadasDe(ubic.value) : null;
    if (ubic.value.trim() && !k) { err.textContent = "No se reconoce la ubicación. Pegue el enlace de Google Maps o las coordenadas."; err.hidden = false; return; }
    ocupado(guardar, true);
    let cl = datos.clientes.find((x) => x.nombre.toLowerCase() === nomCliente.toLowerCase());
    if (!cl) {
      const r = await sb.from("clientes").insert({ nombre: nomCliente }).select().single();
      if (r.error) { ocupado(guardar, false); err.textContent = errorTexto(r.error); err.hidden = false; return; }
      cl = r.data;
    }
    const fila = { cliente_id: cl.id, nombre: nombre.value.trim(), direccion: direccion.value.trim() || null, radio_m: Math.max(30, Math.min(2000, Number(radio.value) || 150)), activo: activo.value === "1", lat: k ? k.lat : null, lng: k ? k.lng : null };
    if (k && (!c || c.lat !== k.lat || c.lng !== k.lng)) fila.coordenadas_confirmadas = !!coordsIniciales;
    const r = c ? await sb.from("centros").update(fila).eq("id", c.id) : await sb.from("centros").insert(fila);
    ocupado(guardar, false);
    if (r.error) { err.textContent = errorTexto(r.error); err.hidden = false; return; }
    toast(c ? "Centro actualizado." : "Centro creado. Ya aparece en la app de las empleadas.");
    f.hidden = true; await cargarMaestros(); pintarCentros();
  } }, c ? "Guardar cambios" : "Crear centro");
  f.replaceChildren(
    h("h2", {}, c ? `Editar · ${c.nombre}` : "Nuevo centro"), listaCl,
    h("div", { class: "rejilla" },
      h("label", { class: "campo" }, "Cliente", cliente),
      h("label", { class: "campo" }, "Nombre del centro", nombre),
      h("label", { class: "campo" }, "Dirección", direccion),
      h("label", { class: "campo" }, "Ubicación", ubic, lectura),
      h("label", { class: "campo" }, "Radio (metros)", h("span", { class: "ayuda" }, "Distancia aceptada. 150 m por defecto; más en edificios grandes."), radio),
      h("label", { class: "campo" }, "Estado", activo)),
    err,
    h("div", { class: "pie-panel" }, h("button", { class: "btn sec", type: "button", onclick: () => { f.hidden = true; } }, "Cerrar"), guardar));
  f.hidden = false;
  f.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

iniciar();
