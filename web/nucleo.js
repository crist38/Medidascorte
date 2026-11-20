/* Medida a cortar - núcleo (navegador y Node).
   Suma un valor a las medidas de MARCO y HOJA. Reconoce dos formatos de PDF:
     - "epref":   HOJA DE TRABAJO de ePref (sección "01 PVC", columna "Medidas", Pos. V/H)
     - "veratec": LISTADO DE MONTAJE de Veratec (sección "Perfiles y refuerzos", columna "Ancho")
   Necesita pdf.js (lectura) y pdf-lib (escritura). Coordenadas en puntos PDF, origen abajo. */
(function (root) {
  "use strict";

  var RE_TIPO = { MARCO: /^"?\s*MARCO\b/i, HOJA: /^"?\s*HOJA\b/i };

  // ---- formato ePref
  var DESC_X = [150, 170];     // inicio columna "Descripción"
  var DESC_FIN = 330;          // la descripción termina antes de "Cantidad"
  var MEDIDA_X = [400, 460];   // inicio columna "Medidas"
  var POS_X = [450, 470];      // inicio columna "Pos."
  var RE_MEDIDA = /^\d{1,3}(\.\d{3})*$/;
  var RE_POS = /^([VH])\s+(\S.*)$/;   // "V \-/", "H |-|", "V 34-/" ...
  var RE_SECCION = /^\d\d\s+[A-ZÁÉÍÓÚÑ]/i;

  // ---- formato Veratec
  var V_DESC_X = [70, 185];          // columna "Descripción del Material"
  var V_ANCHO_CX = [345, 370];       // centro de la columna "Ancho" (357,5)
  var V_POS_X = [255, 325];          // columna "Posición" (ALTO / ANCHO)
  var V_SECCION = /^(Perfiles y refuerzos|Vidrios|Accesorios|Mano de obra)$/i;
  var V_PIE_Y = 40;                  // pie de página ("OBRA:..." / "Página nº")
  var V_NUM = /^\d+([.,]\d+)*$/;     // cualquier número de la columna (ancla de fila)
  var V_MEDIDA = /^\d+(\.\d{3})*$/;  // medida entera que se modifica

  function aNumero(t) { return parseInt(t.replace(/\./g, ""), 10); }
  function aTexto(n) {
    var s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (n < 0 ? "-" : "") + s;
  }

  function normalizar(items) {
    return items
      .filter(function (it) { return it.str && it.str.trim(); })
      .map(function (it) {
        var t = it.transform;
        return { s: it.str.trim(), x: t[4], y: t[5], size: Math.hypot(t[2], t[3]) || 8, w: it.width };
      });
  }

  // Agrupa textos en filas por línea base (de arriba hacia abajo)
  function filas(lista) {
    lista = lista.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var out = [];
    lista.forEach(function (it) {
      var f = out[out.length - 1];
      if (f && Math.abs(f.y - it.y) < 1.5) f.items.push(it);
      else out.push({ y: it.y, items: [it] });
    });
    out.forEach(function (f) { f.items.sort(function (a, b) { return a.x - b.x; }); });
    return out;
  }

  function nuevaPos(t) {
    var m = RE_POS.exec(t);
    return (m[1].toUpperCase() === "V" ? "ALTO" : "ANCHO") + " " + m[2];
  }

  function detectarFormato(items) {
    var texto = items.map(function (i) { return i.s; }).join(" ");
    return /LISTADO DE MONTAJE|Descripci[oó]n del Material/i.test(texto) ? "veratec" : "epref";
  }

  // ---------------------------------------------------------------- ePref
  function buscarEpref(items, tipos) {
    var seccion = null, encontrados = [], posiciones = [], techo = null;
    filas(items).forEach(function (f) {
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
      if (med) encontrados.push({ tipo: tipo, desc: textoDesc, item: med, pos: pos ? nuevaPos(pos.s) : "",
                                  alinear: "derecha", formato: aTexto });
    });
    return { medidas: encontrados, posiciones: posiciones };
  }

  // -------------------------------------------------------------- Veratec
  // Las celdas no comparten línea base: la descripción va arriba y los números centrados.
  // Cada número de la columna "Ancho" marca el centro de una fila; cada línea de la
  // descripción se asigna a la fila cuyo número le queda más cerca en vertical.
  function buscarVeratec(items, tipos, estado) {
    var cuerpo = items.filter(function (i) { return i.y >= V_PIE_Y; });
    var pie = items.filter(function (i) { return i.y < V_PIE_Y; });
    var eventos = [];
    cuerpo.forEach(function (i) {
      var cx = i.x + i.w / 2;
      if (i.x > 200 && i.x < 360 && V_SECCION.test(i.s)) eventos.push({ sec: i.s, y: i.y });
      else if (cx > V_ANCHO_CX[0] && cx < V_ANCHO_CX[1] && V_NUM.test(i.s)) eventos.push({ item: i, y: i.y });
    });
    eventos.sort(function (a, b) { return b.y - a.y; });
    var anclas = [];
    eventos.forEach(function (e) {
      if (e.sec) { estado.seccion = e.sec.toUpperCase(); return; }
      e.item.seccion = estado.seccion;   // la sección sigue de una página a la siguiente
      e.item.lineas = [];
      anclas.push(e.item);
    });
    filas(cuerpo.filter(function (i) { return i.x >= V_DESC_X[0] && i.x < V_DESC_X[1]; })).forEach(function (l) {
      var mejor = null, dist = 18;
      anclas.forEach(function (a) {
        var d = Math.abs(a.y - l.y);
        if (d < dist) { dist = d; mejor = a; }
      });
      if (mejor) mejor.lineas.push({ y: l.y, s: l.items.map(function (i) { return i.s; }).join(" ") });
    });
    var encontrados = [];
    anclas.forEach(function (a) {
      if (!a.seccion || a.seccion.indexOf("PERFILES") !== 0 || !V_MEDIDA.test(a.s) || !a.lineas.length) return;
      a.lineas.sort(function (p, q) { return q.y - p.y; });
      var tipo = tipos.filter(function (t) { return RE_TIPO[t].test(a.lineas[0].s); })[0];
      if (!tipo) return;
      var pos = cuerpo.filter(function (i) {
        return i.x > V_POS_X[0] && i.x < V_POS_X[1] && Math.abs(i.y - a.y) < 1.5 && /^(ALTO|ANCHO)$/i.test(i.s);
      })[0];
      encontrados.push({ tipo: tipo, desc: a.lineas.map(function (l) { return l.s; }).join(" "), item: a,
                         pos: pos ? pos.s.toUpperCase() : "", alinear: "centro",
                         formato: a.s.indexOf(".") >= 0 ? aTexto : String });
    });
    return { medidas: encontrados, posiciones: [], pie: pie };
  }

  // ------------------------------------------------------------- leyendas
  var ROJO = [0.82, 0.1, 0.08];

  // ePref: en el encabezado, entre "HOJA DE TRABAJO" y el logo (coordenadas desde arriba)
  var SELLO = { x: 268, arriba: 22, base1: 39, base2: 53, abajo: 59, t1: 14, t2: 8 };
  function selloEncabezado(pg, f, l1, l2, PDFLib) {
    var h = pg.getHeight(), s = SELLO, rojo = PDFLib.rgb.apply(null, ROJO);
    var ancho = Math.max(f.negrita.widthOfTextAtSize(l1, s.t1), f.normal.widthOfTextAtSize(l2, s.t2)) + 14;
    pg.drawRectangle({ x: s.x, y: h - s.abajo, width: ancho, height: s.abajo - s.arriba,
                       borderColor: rojo, borderWidth: 1.2, color: PDFLib.rgb(1, 1, 1) });
    pg.drawText(l1, { x: s.x + 7, y: h - s.base1, size: s.t1, font: f.negrita, color: rojo });
    pg.drawText(l2, { x: s.x + 7, y: h - s.base2, size: s.t2, font: f.normal, color: rojo });
  }

  // Veratec: una línea en el pie, entre "OBRA:..." y "Página nº" (o arriba si no cabe)
  function selloPie(pg, f, l1, l2, pie, PDFLib) {
    var W = pg.getWidth(), H = pg.getHeight(), rojo = PDFLib.rgb.apply(null, ROJO);
    var w1 = f.negrita.widthOfTextAtSize(l1, 10), w2 = f.normal.widthOfTextAtSize(l2, 7.5);
    var ancho = w1 + 6 + w2 + 12, centro = W / 2;
    var izq = 20, der = W - 20, base = 24;
    pie.forEach(function (i) {
      if (i.x + i.w / 2 < centro) izq = Math.max(izq, i.x + i.w); else der = Math.min(der, i.x);
      base = i.y;
    });
    var x0;
    if (der - izq - 24 >= ancho) x0 = (izq + der) / 2 - ancho / 2;
    else { x0 = W - 20 - ancho; base = H - 15; }   // no cabe en el pie: arriba a la derecha
    pg.drawRectangle({ x: x0, y: base - 4, width: ancho, height: 15,
                       borderColor: rojo, borderWidth: 1, color: PDFLib.rgb(1, 1, 1) });
    pg.drawText(l1, { x: x0 + 6, y: base, size: 10, font: f.negrita, color: rojo });
    pg.drawText(l2, { x: x0 + 6 + w1 + 6, y: base, size: 7.5, font: f.normal, color: rojo });
  }

  /**
   * bytes: Uint8Array del PDF original.
   * opts: { suma: 261, tipos: ["MARCO","HOJA"], pdfjsLib, PDFLib }
   * Devuelve { bytes, cambios: [{pag,tipo,desc,viejo,nuevo,pos}], posiciones, formato }
   */
  async function procesarPdf(bytes, opts) {
    var pdfjsLib = opts.pdfjsLib, PDFLib = opts.PDFLib;
    var suma = opts.suma, tipos = opts.tipos || ["MARCO", "HOJA"];
    var lector = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
    var doc = await PDFLib.PDFDocument.load(bytes);
    var f = { normal: await doc.embedFont(PDFLib.StandardFonts.Helvetica),
              mono: await doc.embedFont(PDFLib.StandardFonts.Courier) };
    var paginas = doc.getPages();
    var blanco = PDFLib.rgb(1, 1, 1), negro = PDFLib.rgb(0, 0, 0);
    var cambios = [], nPos = 0, formato = null, estado = { seccion: null }, pies = [];

    // tapar un texto viejo: de 0.3 bajo la línea base a 0.88 sobre ella (cubre "|" "\" "/"
    // de Courier), salvo en la primera fila de una sección ePref: ahí se detiene bajo su línea
    function tapar(pg, it) {
      var abajo = it.y - 0.3 * it.size, arriba = it.y + 0.88 * it.size;
      if (it.techo != null) arriba = Math.min(arriba, it.techo);
      pg.drawRectangle({ x: it.x - 0.6, y: abajo, width: it.w + 1.2,
                         height: arriba - abajo, color: blanco, borderWidth: 0 });
    }

    for (var n = 1; n <= lector.numPages; n++) {
      var items = normalizar((await (await lector.getPage(n)).getTextContent()).items);
      if (!formato) formato = detectarFormato(items);
      var r = formato === "veratec" ? buscarVeratec(items, tipos, estado) : buscarEpref(items, tipos);
      var pg = paginas[n - 1];
      pies.push(r.pie || []);
      r.medidas.forEach(function (e) {
        var it = e.item, viejo = it.s, nuevo = e.formato(aNumero(viejo) + suma);
        tapar(pg, it);
        var ancho = f.normal.widthOfTextAtSize(nuevo, it.size);
        var x = e.alinear === "centro" ? it.x + it.w / 2 - ancho / 2 : it.x + it.w - ancho;
        pg.drawText(nuevo, { x: x, y: it.y, size: it.size, font: f.normal, color: negro });
        cambios.push({ pag: n, tipo: e.tipo, desc: e.desc, viejo: viejo, nuevo: nuevo, pos: e.pos });
      });
      r.posiciones.forEach(function (it) {
        tapar(pg, it);
        pg.drawText(nuevaPos(it.s), { x: it.x, y: it.y, size: it.size, font: f.mono, color: negro });
        nPos++;
      });
    }
    await lector.destroy();
    if (cambios.length) {
      f.negrita = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
      var l1 = "REFORMULADO " + (suma >= 0 ? "+" : "") + suma;
      var l2 = "Medidas de " + tipos.join(" y ");
      paginas.forEach(function (pg, i) {
        if (formato === "veratec") selloPie(pg, f, l1, l2, pies[i], PDFLib);
        else selloEncabezado(pg, f, l1, l2, PDFLib);
      });
    }
    return { bytes: await doc.save(), cambios: cambios, posiciones: nPos, formato: formato };
  }

  var api = { procesarPdf: procesarPdf, aTexto: aTexto, aNumero: aNumero };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MedidaCore = api;
})(this);
