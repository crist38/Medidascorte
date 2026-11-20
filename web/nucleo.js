/* Medida a cortar - núcleo (navegador y Node).
   Suma un valor a las medidas de MARCO y HOJA de la sección "01 PVC"
   en las "HOJA DE TRABAJO" de ePref. Necesita pdf.js (lectura) y pdf-lib (escritura). */
(function (root) {
  "use strict";

  var DESC_X = [150, 170];     // inicio columna "Descripción" (puntos PDF)
  var DESC_FIN = 330;          // la descripción termina antes de "Cantidad"
  var MEDIDA_X = [400, 460];   // inicio columna "Medidas"
  var POS_X = [450, 470];      // inicio columna "Pos."
  var RE_MEDIDA = /^\d{1,3}(\.\d{3})*$/;
  var RE_POS = /^([VH])\s+(\S.*)$/;   // "V \-/", "H |-|", "V 34-/" ...
  var RE_SECCION = /^\d\d\s+[A-ZÁÉÍÓÚÑ]/i;
  var RE_TIPO = { MARCO: /^"?\s*MARCO\b/i, HOJA: /^"?\s*HOJA\b/i };

  function aNumero(t) { return parseInt(t.replace(/\./g, ""), 10); }
  function aTexto(n) {
    var s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (n < 0 ? "-" : "") + s;
  }

  // Agrupa los textos de la página en filas por línea base
  function filas(items) {
    var lista = items
      .filter(function (it) { return it.str && it.str.trim(); })
      .map(function (it) {
        var t = it.transform;
        return { s: it.str.trim(), x: t[4], y: t[5], size: Math.hypot(t[2], t[3]) || 8, w: it.width };
      })
      .sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var out = [];
    lista.forEach(function (it) {
      var f = out[out.length - 1];
      if (f && Math.abs(f.y - it.y) < 1.5) f.items.push(it);
      else out.push({ y: it.y, items: [it] });
    });
    out.forEach(function (f) { f.items.sort(function (a, b) { return a.x - b.x; }); });
    return out;
  }

  async function buscarEnPagina(page, tipos) {
    var tc = await page.getTextContent();
    var seccion = null, encontrados = [], posiciones = [], techo = null;
    filas(tc.items).forEach(function (f) {
      var izq = f.items.filter(function (i) { return i.x < 150; }).map(function (i) { return i.s; }).join(" ");
      var resto = f.items.filter(function (i) { return i.x >= 150; });
      if (f.items[0].x < 30 && RE_SECCION.test(izq) && resto.length === 0) {
        seccion = izq.toUpperCase();
        // la línea de la sección queda ~2,7 pt bajo su texto: la primera fila no debe taparla
        techo = f.y - 3.22;
        return;
      }
      f.items.forEach(function (i) { i.techo = techo; });
      techo = null;
      // columna "Pos.": V -> ALTO, H -> ANCHO (en todas las filas de la tabla)
      var pos = f.items.filter(function (i) { return i.x > POS_X[0] && i.x < POS_X[1] && RE_POS.test(i.s); })[0];
      if (pos) posiciones.push(pos);
      if (!seccion || seccion.indexOf("01 PVC") !== 0) return;
      var desc = f.items.filter(function (i) { return i.x > DESC_X[0] && i.x < DESC_FIN; });
      if (!desc.length || desc[0].x > DESC_X[1]) return;
      var textoDesc = desc.map(function (i) { return i.s; }).join(" ");
      var tipo = tipos.filter(function (t) { return RE_TIPO[t].test(textoDesc); })[0];
      if (!tipo) return;
      var med = f.items.filter(function (i) { return i.x > MEDIDA_X[0] && i.x < MEDIDA_X[1] && RE_MEDIDA.test(i.s); })[0];
      if (med) encontrados.push({ tipo: tipo, desc: textoDesc, item: med, pos: pos ? nuevaPos(pos.s) : "" });
    });
    return { medidas: encontrados, posiciones: posiciones };
  }

  function nuevaPos(t) {
    var m = RE_POS.exec(t);
    return (m[1].toUpperCase() === "V" ? "ALTO" : "ANCHO") + " " + m[2];
  }

  // Leyenda en el encabezado, entre "HOJA DE TRABAJO" y el logo (coordenadas desde arriba)
  var SELLO = { x: 268, arriba: 22, base1: 39, base2: 53, abajo: 59, t1: 14, t2: 8 };
  function sello(pg, fuente, negrita, l1, l2, PDFLib) {
    var h = pg.getHeight(), s = SELLO, rojo = PDFLib.rgb(0.82, 0.1, 0.08);
    var ancho = Math.max(negrita.widthOfTextAtSize(l1, s.t1), fuente.widthOfTextAtSize(l2, s.t2)) + 14;
    pg.drawRectangle({ x: s.x, y: h - s.abajo, width: ancho, height: s.abajo - s.arriba,
                       borderColor: rojo, borderWidth: 1.2, color: PDFLib.rgb(1, 1, 1) });
    pg.drawText(l1, { x: s.x + 7, y: h - s.base1, size: s.t1, font: negrita, color: rojo });
    pg.drawText(l2, { x: s.x + 7, y: h - s.base2, size: s.t2, font: fuente, color: rojo });
  }

  /**
   * bytes: Uint8Array del PDF original. Devuelve { bytes: Uint8Array, cambios: [...] }.
   * opts: { suma: 261, tipos: ["MARCO","HOJA"], pdfjsLib, PDFLib }
   */
  async function procesarPdf(bytes, opts) {
    var pdfjsLib = opts.pdfjsLib, PDFLib = opts.PDFLib;
    var suma = opts.suma, tipos = opts.tipos || ["MARCO", "HOJA"];
    var lector = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
    var doc = await PDFLib.PDFDocument.load(bytes);
    var fuente = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    var mono = await doc.embedFont(PDFLib.StandardFonts.Courier);
    var paginas = doc.getPages();
    var blanco = PDFLib.rgb(1, 1, 1), negro = PDFLib.rgb(0, 0, 0);
    var cambios = [], nPos = 0;
    // tapar un texto viejo (solo la altura de los caracteres, sin tocar las líneas de la tabla)
    function tapar(pg, it) {
      // de 0.3 bajo la línea base a 0.88 sobre ella (cubre "|" "\" "/" de Courier),
      // salvo en la primera fila de una sección: ahí se detiene bajo la línea de la sección
      var abajo = it.y - 0.3 * it.size, arriba = it.y + 0.88 * it.size;
      if (it.techo != null) arriba = Math.min(arriba, it.techo);
      pg.drawRectangle({ x: it.x - 0.6, y: abajo, width: it.w + 1.2,
                         height: arriba - abajo, color: blanco, borderWidth: 0 });
    }
    for (var n = 1; n <= lector.numPages; n++) {
      var r = await buscarEnPagina(await lector.getPage(n), tipos);
      var pg = paginas[n - 1];
      r.medidas.forEach(function (e) {
        var it = e.item, viejo = it.s, nuevo = aTexto(aNumero(viejo) + suma);
        tapar(pg, it);
        var ancho = fuente.widthOfTextAtSize(nuevo, it.size);
        pg.drawText(nuevo, { x: it.x + it.w - ancho, y: it.y, size: it.size, font: fuente, color: negro });
        cambios.push({ pag: n, tipo: e.tipo, desc: e.desc, viejo: viejo, nuevo: nuevo, pos: e.pos });
      });
      r.posiciones.forEach(function (it) {
        tapar(pg, it);
        pg.drawText(nuevaPos(it.s), { x: it.x, y: it.y, size: it.size, font: mono, color: negro });
        nPos++;
      });
    }
    await lector.destroy();
    if (cambios.length) {
      var negrita = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
      var l1 = "REFORMULADO " + (suma >= 0 ? "+" : "") + suma;
      var l2 = "Medidas de " + tipos.join(" y ");
      paginas.forEach(function (pg) { sello(pg, fuente, negrita, l1, l2, PDFLib); });
    }
    return { bytes: await doc.save(), cambios: cambios, posiciones: nPos };
  }

  var api = { procesarPdf: procesarPdf, aTexto: aTexto, aNumero: aNumero };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MedidaCore = api;
})(this);
