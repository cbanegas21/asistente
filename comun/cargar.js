/* Cargador de las páginas del asistente. La página pública es solo este cascarón: la página de verdad
   (con sus listas y notas) vive en el repo privado, asistente/<página>/pagina.html, y se trae con la llave
   limitada que ya está en este navegador (la misma de la página de aprobación). Aquí no hay datos. */
(function () {
  "use strict";
  var yo = document.currentScript;
  var PAG = yo && yo.getAttribute("data-pagina");
  var LS; try { LS = window.localStorage; LS.getItem("x"); } catch (_) { LS = null; }
  var K = (LS && LS.getItem("aprobar_k")) || "", R = (LS && LS.getItem("aprobar_r")) || "";
  var h = new URLSearchParams(location.hash.slice(1));
  if (h.get("k") || h.get("r")) {
    if (h.get("k")) { K = h.get("k"); try { LS.setItem("aprobar_k", K); } catch (_) {} }
    if (h.get("r")) { R = h.get("r"); try { LS.setItem("aprobar_r", R); } catch (_) {} }
    h.delete("k"); h.delete("r");
    var resto = h.toString();
    history.replaceState(null, "", location.pathname + location.search + (resto ? "#" + resto : ""));
  }
  var estado = document.getElementById("estado");
  function aviso(t) { if (estado) { estado.textContent = t; estado.className = "err"; } }
  if (!LS) { aviso("Este navegador no deja guardar la llave (¿ventana privada?). Ábrela en una ventana normal."); return; }
  if (!K || !R) { aviso("Este navegador todavía no tiene tu llave. Abre una vez tu página de aprobación con el enlace de la llave (el mismo que usaste en este teléfono) y vuelve aquí."); return; }
  fetch("https://api.github.com/repos/" + R + "/contents/asistente/" + PAG + "/pagina.html", {
    cache: "no-cache", headers: { Authorization: "Bearer " + K, Accept: "application/vnd.github.raw", "X-GitHub-Api-Version": "2022-11-28" }
  }).then(function (r) {
    if (r.status === 401 || r.status === 403) throw new Error("La llave de este navegador no sirve o venció.");
    if (r.status === 404) throw new Error("Esta página todavía no está subida.");
    if (!r.ok) throw new Error("GitHub contestó " + r.status + ". Revisa la conexión y recarga.");
    return r.text();
  }).then(function (html) {
    document.open(); document.write(html); document.close();
  }).catch(function (e) { aviso(e.message || "No pude traer la página. Revisa la conexión y recarga."); });
})();
