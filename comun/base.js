/* Base de las páginas del asistente en GitHub Pages.
   Reemplaza a window.claude.use("db") y window.claude.use("dictation") de las páginas de Claude, con la
   misma forma (collection, doc, set, update, delete, get, onSnapshot), para que el código de cada página
   no cambie. Cada colección es un archivo en el repo privado: asistente/<página>/<colección>.json con
   {"docs": {id: datos}}. Se lee y se escribe con la llave limitada que ya está en este navegador
   (localStorage aprobar_k y aprobar_r, la misma de la página de aprobación). Aquí no hay datos. */
(function () {
  "use strict";
  var LS; try { LS = window.localStorage; LS.getItem("x"); } catch (_) { LS = { getItem: function () { return ""; }, setItem: function () {} }; }
  var K = LS.getItem("aprobar_k") || "", R = LS.getItem("aprobar_r") || "";
  var PAG = window.__PAGINA || "";
  var LENTAS = window.__LENTAS || [];   // colecciones que se juntan más tiempo antes de guardar (p. ej. la posición)
  var API = "https://api.github.com/repos/";

  function gh(path, opt) {
    opt = opt || {};
    var h = { Authorization: "Bearer " + K, "X-GitHub-Api-Version": "2022-11-28" };
    for (var k in (opt.headers || {})) h[k] = opt.headers[k];
    return fetch(API + R + "/contents/" + path, { method: opt.method || "GET", headers: h, body: opt.body, cache: opt.cache || "no-cache" });
  }
  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
  function unb64(s) { return decodeURIComponent(escape(atob(s.replace(/\n/g, "")))); }
  function falla(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
  function porEstado(st) { return st === 401 || st === 403 ? falla("permission_denied", "llave") : falla("unavailable", "GitHub " + st); }
  function clon(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function espera(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Lee un JSON del repo privado con su sha (si pesa más de 1 MB, el contenido llega aparte, en crudo).
  function leer(path) {
    return gh(path, { headers: { Accept: "application/vnd.github+json" } }).then(function (r) {
      if (r.status === 404) return { data: null, sha: null };
      if (!r.ok) throw porEstado(r.status);
      return r.json().then(function (j) {
        if (j.content && j.encoding === "base64") return { data: JSON.parse(unb64(j.content)), sha: j.sha };
        return gh(path, { headers: { Accept: "application/vnd.github.raw" } }).then(function (r2) {
          if (!r2.ok) throw porEstado(r2.status);
          return r2.text().then(function (t) { return { data: JSON.parse(t), sha: j.sha }; });
        });
      });
    });
  }
  // Para las páginas que traían un archivo aparte (p. ej. datos.json): lo da como una respuesta de fetch.
  window.ghPrivado = function (path) { return gh(path, { headers: { Accept: "application/vnd.github.raw" } }); };

  // ---------- colecciones ----------
  var cols = {};
  function archivo(nombre) { return "asistente/" + PAG + "/" + nombre + ".json"; }
  function col(nombre) {
    if (!cols[nombre]) cols[nombre] = { nombre: nombre, base: {}, docs: {}, sha: null, cargada: false, oyentes: [], pend: [], escribiendo: false, timer: null, cargando: null, viejos: {} };
    return cols[nombre];
  }
  function aplicar(docs, op) {
    if (op.tipo === "delete") { delete docs[op.id]; return; }
    if (op.tipo === "set" && !op.merge) { docs[op.id] = clon(op.data); return; }
    var cur = docs[op.id] && typeof docs[op.id] === "object" ? docs[op.id] : {};
    var nuevo = Object.assign({}, cur);
    Object.keys(op.data || {}).forEach(function (k) { if (op.data[k] === undefined) delete nuevo[k]; else nuevo[k] = clon(op.data[k]); });
    docs[op.id] = nuevo;
  }
  function rehacer(c) { c.docs = clon(c.base) || {}; c.pend.forEach(function (op) { aplicar(c.docs, op); }); }
  function docSnap(c, id) {
    var d = c.docs[id];
    return { id: id, exists: d !== undefined, data: function () { return clon(d); }, get: function (k) { return d ? clon(d[k]) : undefined; }, ref: docRef(c.nombre, id) };
  }
  function snapshot(c, lim) {
    var ids = Object.keys(c.docs); if (lim) ids = ids.slice(0, lim);
    var docs = ids.map(function (id) { return docSnap(c, id); });
    return { docs: docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: c.pend.length > 0 },
      forEach: function (f) { docs.forEach(f); }, docChanges: function () { return docs.map(function (d) { return { type: "added", doc: d }; }); } };
  }
  function avisar(c) { c.oyentes.forEach(function (o) { try { o.cb(snapshot(c, o.lim)); } catch (e) { console.error(e); } }); }
  function cargar(c) {
    if (c.cargando) return c.cargando;
    c.cargando = leer(archivo(c.nombre)).then(function (x) {
      c.cargando = null;
      // GitHub puede devolver unos segundos la versión de antes de lo que se acaba de guardar: esa se ignora.
      var cambio = (!c.cargada || x.sha !== c.sha) && !(x.sha && c.viejos[x.sha]);
      if (!cambio) return false;
      c.base = (x.data && x.data.docs) || {}; c.sha = x.sha; c.cargada = true;
      rehacer(c); avisar(c); return true;
    }, function (e) { c.cargando = null; throw e; });
    return c.cargando;
  }
  function encolar(c, op) {
    return new Promise(function (res, rej) {
      op.res = res; op.rej = rej; c.pend.push(op);
      aplicar(c.docs, op); avisar(c);
      clearTimeout(c.timer);
      c.timer = setTimeout(function () { guardar(c); }, LENTAS.indexOf(c.nombre) >= 0 ? 20000 : 800);
    });
  }
  function guardar(c) {
    clearTimeout(c.timer); c.timer = null;
    if (c.escribiendo || !c.pend.length) return;
    if (!K || !R) { var p0 = c.pend.splice(0); rehacer(c); avisar(c); p0.forEach(function (op) { op.rej(falla("permission_denied", "sin llave")); }); return; }
    c.escribiendo = true;
    var lote = c.pend.slice();
    var intento = 0;
    (function vuelta() {
      leer(archivo(c.nombre)).then(function (x) {
        var docs = (x.data && x.data.docs) || {};
        lote.forEach(function (op) { aplicar(docs, op); });
        var ids = lote.map(function (op) { return op.id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
        var body = { message: PAG + "/" + c.nombre + ": " + ids.slice(0, 8).join(", ") + (ids.length > 8 ? " y " + (ids.length - 8) + " más" : ""),
          content: b64(JSON.stringify({ docs: docs }, null, 1)) };
        if (x.sha) body.sha = x.sha;
        return gh(archivo(c.nombre), { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/vnd.github+json" }, body: JSON.stringify(body) })
          .then(function (r) {
            if (r.ok) return r.json().then(function (j) {
              if (x.sha) c.viejos[x.sha] = 1;
              c.base = docs; c.sha = j.content && j.content.sha; c.cargada = true;
              c.pend.splice(0, lote.length); rehacer(c);
              c.escribiendo = false;
              lote.forEach(function (op) { op.res(); });
              avisar(c);
              if (c.pend.length) guardar(c);
            });
            if ((r.status === 409 || r.status === 422) && ++intento < 6) return espera(400 + Math.random() * 800).then(vuelta);
            throw porEstado(r.status);
          });
      }).catch(function (e) {
        c.escribiendo = false;
        var caidas = c.pend.splice(0); rehacer(c); avisar(c);
        caidas.forEach(function (op) { op.rej(e && e.code ? e : falla("unavailable", String(e && e.message || e))); });
        cargar(c).catch(function () {});
      });
    })();
  }
  // Si la página se esconde (cambias de app o cierras), lo que espera se guarda ya.
  function guardarTodo() { Object.keys(cols).forEach(function (n) { if (cols[n].pend.length) guardar(cols[n]); }); }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") guardarTodo();
    else Object.keys(cols).forEach(function (n) { if (cols[n].oyentes.length && !cols[n].pend.length) cargar(cols[n]).catch(function () {}); });
  });
  window.addEventListener("pagehide", guardarTodo);

  function docRef(nombre, id) {
    var c = col(nombre);
    return {
      id: id, path: nombre + "/" + id,
      get: function () { return cargarFresco(c).then(function () { return docSnap(c, id); }); },
      set: function (data, opt) { return encolar(c, { tipo: "set", id: id, data: clon(data), merge: !!(opt && opt.merge) }); },
      update: function (data) { return encolar(c, { tipo: "update", id: id, data: clon(data) }); },
      delete: function () { return encolar(c, { tipo: "delete", id: id }); },
      onSnapshot: function (cb, errCb) {
        return consulta(nombre, 0).onSnapshot(function () { cb(docSnap(c, id)); }, errCb);
      }
    };
  }
  function cargarFresco(c) { return c.pend.length ? Promise.resolve() : cargar(c); }
  function consulta(nombre, lim) {
    var c = col(nombre);
    return {
      limit: function (n) { return consulta(nombre, n); },
      orderBy: function () { return consulta(nombre, lim); },
      doc: function (id) { return docRef(nombre, id); },
      get: function () { return cargarFresco(c).then(function () { return snapshot(c, lim); }); },
      onSnapshot: function (cb, errCb) {
        var o = { cb: cb, lim: lim }; c.oyentes.push(o);
        if (c.cargada) setTimeout(function () { cb(snapshot(c, lim)); }, 0);
        else cargar(c).catch(function (e) { if (errCb) errCb(e && e.code ? e : falla("unavailable")); });
        if (!c.reloj) c.reloj = setInterval(function () {
          if (document.visibilityState === "visible" && !c.escribiendo && !c.pend.length) cargar(c).catch(function () {});
        }, 30000);
        return function () { var i = c.oyentes.indexOf(o); if (i >= 0) c.oyentes.splice(i, 1); };
      }
    };
  }
  var db = {
    collection: function (nombre) { return consulta(nombre, 0); },
    doc: function (ruta) { var p = String(ruta).split("/"); return docRef(p[0], p.slice(1).join("/")); }
  };

  // ---------- dictado (el reconocimiento de voz del navegador) ----------
  function dictado() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    var rec = null, on = false, cb = { p: [], f: [], s: [] };
    function estado(s, why) { cb.s.forEach(function (f) { f({ state: s, reason: why }); }); }
    function codigo(err) { return err === "not-allowed" || err === "service-not-allowed" ? "not_granted" : err === "audio-capture" ? "unavailable" : err || "error"; }
    return {
      onPartial: function (f) { cb.p.push(f); }, onFinal: function (f) { cb.f.push(f); }, onState: function (f) { cb.s.push(f); },
      active: function () { return on; },
      start: function (opt) {
        return new Promise(function (res, rej) {
          var lang = opt && opt.language; if (!lang || lang === "es") lang = "es-MX";
          rec = new SR(); rec.lang = lang; rec.interimResults = true; rec.continuous = true;
          var arranco = false;
          rec.onstart = function () { arranco = true; on = true; estado("listening"); res(); };
          rec.onresult = function (e) {
            for (var i = e.resultIndex; i < e.results.length; i++) {
              var t = (e.results[i][0].transcript || "").trim();
              if (e.results[i].isFinal) { if (t) cb.f.forEach(function (f) { f({ text: t }); }); }
              else cb.p.forEach(function (f) { f({ text: t }); });
            }
          };
          rec.onerror = function (e) { var c = codigo(e.error); if (!arranco) rej(falla(c)); estado("idle", c); };
          rec.onend = function () { on = false; rec = null; estado("idle"); };
          estado("starting");
          try { rec.start(); } catch (_) { rec = null; estado("idle", "unavailable"); rej(falla("unavailable")); }
        });
      },
      stop: function () { if (rec) rec.stop(); return Promise.resolve(); }
    };
  }

  window.claude = {
    use: function (nombre) {
      if (nombre === "db") return Promise.resolve(K && R && PAG ? db : null);
      if (nombre === "dictation") return Promise.resolve(dictado());
      return Promise.resolve(null);
    }
  };
})();
