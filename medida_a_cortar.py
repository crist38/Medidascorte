"""
Medida a cortar
---------------
Suma un valor fijo (por defecto 261 mm) a las medidas de MARCO y HOJA.
Reconoce solo el formato del PDF:

- "HOJA DE TRABAJO" de ePref (PrefSuite): filas de la sección "01 PVC" cuya
  descripción empieza con MARCO o HOJA, columna "Medidas". Además, en la
  columna "Pos." cambia V por ALTO y H por ANCHO.
- "LISTADO DE MONTAJE" de Veratec: filas de "Perfiles y refuerzos" cuya
  descripción empieza con MARCO o HOJA, columna "Ancho".

Refuerzos, junquillos, tapas, etc. no se tocan. El PDF original nunca se
sobrescribe: se crea una copia.

Uso:
    python medida_a_cortar.py                 -> abre la ventana
    python medida_a_cortar.py a.pdf b.pdf ... -> procesa sin ventana
        opciones: --suma 261  --salida CARPETA  --solo-marco  --solo-hoja
"""

import os
import re
import sys

import pymupdf

SUMA_DEFECTO = 261

# Columnas del formato ePref (en puntos PDF, página A4)
DESC_X = (150, 170)      # inicio de la columna "Descripción"
MEDIDA_X = (400, 460)    # inicio de la columna "Medidas"
POS_X = (450, 470)       # inicio de la columna "Pos."
RE_POS = re.compile(r"^([VH])\s+(\S.*)$")               # V \-/ , H |-| , V 34-/

RE_SECCION = re.compile(r"^\d\d\s")
RE_MEDIDA = re.compile(r"^\d{1,3}(\.\d{3})*$")          # 970 / 1.798
RE_DESC = {
    "MARCO": re.compile(r'^"?\s*MARCO\b', re.I),
    "HOJA": re.compile(r'^"?\s*HOJA\b', re.I),
}


def a_numero(txt):
    return int(txt.replace(".", ""))


def a_texto(n):
    # Mismo formato que ePref: punto como separador de miles
    return f"{n:,}".replace(",", ".")


def _spans(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                if s["text"].strip():
                    out.append(s)
    out.sort(key=lambda s: (round(s["bbox"][1], 1), s["bbox"][0]))
    return out


def buscar_medidas(page, tipos):
    """Devuelve lista de (tipo, descripcion, span_medida) a modificar."""
    spans = _spans(page)
    seccion = None
    encontrados = []
    for s in spans:
        txt = s["text"].strip()
        x0, y0 = s["bbox"][0], s["bbox"][1]
        if "Bold" in s["font"] and RE_SECCION.match(txt) and x0 < 30:
            seccion = txt.upper()
            continue
        if not (seccion and seccion.startswith("01 PVC")):
            continue
        if not (DESC_X[0] < x0 < DESC_X[1]):
            continue
        tipo = next((t for t in tipos if RE_DESC[t].match(txt)), None)
        if not tipo:
            continue
        fila = [o for o in spans
                if abs(o["bbox"][1] - y0) < 1.5
                and MEDIDA_X[0] < o["bbox"][0] < MEDIDA_X[1]
                and RE_MEDIDA.match(o["text"].strip())]
        if fila:
            encontrados.append((tipo, txt, fila[0]))
    return encontrados


def buscar_posiciones(page):
    """Textos de la columna 'Pos.' que empiezan con V o H (ej. 'V \\-/', 'H |-|')."""
    return [s for s in _spans(page)
            if POS_X[0] < s["bbox"][0] < POS_X[1] and RE_POS.match(s["text"].strip())]


def nueva_pos(txt):
    """'V \\-/' -> 'ALTO \\-/'   'H |-|' -> 'ANCHO |-|'"""
    m = RE_POS.match(txt.strip())
    return ("ALTO" if m.group(1).upper() == "V" else "ANCHO") + " " + m.group(2)


def sello(page, l1, l2):
    """Leyenda en el encabezado, entre 'HOJA DE TRABAJO' y el logo."""
    x, arriba, base1, base2, abajo, t1, t2 = 268, 22, 39, 53, 59, 14, 8
    rojo = (0.82, 0.1, 0.08)
    ancho = max(pymupdf.get_text_length(l1, fontname="hebo", fontsize=t1),
                pymupdf.get_text_length(l2, fontname="helv", fontsize=t2)) + 14
    page.draw_rect(pymupdf.Rect(x, arriba, x + ancho, abajo), color=rojo, fill=(1, 1, 1), width=1.2)
    page.insert_text((x + 7, base1), l1, fontname="hebo", fontsize=t1, color=rojo)
    page.insert_text((x + 7, base2), l2, fontname="helv", fontsize=t2, color=rojo)


# ----------------------------------------------------------------- Veratec
# "LISTADO DE MONTAJE": las celdas no comparten línea base (la descripción va arriba y
# los números centrados). Cada número de la columna "Ancho" marca el centro de una fila y
# cada línea de la descripción se asigna a la fila cuyo número le queda más cerca.
V_DESC_X = (70, 185)          # columna "Descripción del Material"
V_ANCHO_CX = (345, 370)       # centro de la columna "Ancho" (357,5)
V_POS_X = (255, 325)          # columna "Posición" (ALTO / ANCHO)
V_SECCION = re.compile(r"^(Perfiles y refuerzos|Vidrios|Accesorios|Mano de obra)$", re.I)
V_PIE = 40                    # pie de página ("OBRA:..." / "Página nº"), desde abajo
V_NUM = re.compile(r"^\d+([.,]\d+)*$")
V_MEDIDA = re.compile(r"^\d+(\.\d{3})*$")


def detectar_formato(doc):
    texto = doc[0].get_text() if len(doc) else ""
    return "veratec" if re.search(r"LISTADO DE MONTAJE|Descripci[oó]n del Material", texto, re.I) else "epref"


def buscar_veratec(page, tipos, estado):
    """Devuelve (lista de (tipo, descripcion, span_medida), spans_del_pie)."""
    h = page.rect.height
    spans = _spans(page)
    cuerpo = [s for s in spans if s["origin"][1] <= h - V_PIE]
    pie = [s for s in spans if s["origin"][1] > h - V_PIE]
    eventos = []
    for s in cuerpo:
        t = s["text"].strip()
        x0, x1 = s["bbox"][0], s["bbox"][2]
        if 200 < x0 < 360 and V_SECCION.match(t):
            eventos.append((s["origin"][1], t, None))
        elif V_ANCHO_CX[0] < (x0 + x1) / 2 < V_ANCHO_CX[1] and V_NUM.match(t):
            eventos.append((s["origin"][1], None, s))
    eventos.sort(key=lambda e: e[0])
    anclas = []
    for y, sec, s in eventos:
        if sec:
            estado["seccion"] = sec.upper()      # sigue de una página a la siguiente
        else:
            anclas.append({"y": y, "span": s, "seccion": estado["seccion"], "lineas": []})
    lineas = {}
    for s in cuerpo:
        if V_DESC_X[0] <= s["bbox"][0] < V_DESC_X[1]:
            y = s["origin"][1]
            clave = next((k for k in lineas if abs(k - y) < 1.5), y)
            lineas.setdefault(clave, []).append(s)
    for y, partes in lineas.items():
        texto = " ".join(p["text"].strip() for p in sorted(partes, key=lambda p: p["bbox"][0]))
        cerca = min(anclas, key=lambda a: abs(a["y"] - y), default=None)
        if cerca and abs(cerca["y"] - y) < 18:
            cerca["lineas"].append((y, texto))
    encontrados = []
    for a in anclas:
        t = a["span"]["text"].strip()
        if not (a["seccion"] or "").startswith("PERFILES") or not V_MEDIDA.match(t) or not a["lineas"]:
            continue
        a["lineas"].sort()
        tipo = next((k for k in tipos if RE_DESC[k].match(a["lineas"][0][1])), None)
        if tipo:
            encontrados.append((tipo, " ".join(l[1] for l in a["lineas"]), a["span"]))
    return encontrados, pie


def sello_pie(page, l1, l2, pie):
    """Veratec: una línea en el pie, entre 'OBRA:...' y 'Página nº' (o arriba si no cabe)."""
    W = page.rect.width
    rojo = (0.82, 0.1, 0.08)
    w1 = pymupdf.get_text_length(l1, fontname="hebo", fontsize=10)
    w2 = pymupdf.get_text_length(l2, fontname="helv", fontsize=7.5)
    ancho = w1 + 6 + w2 + 12
    izq, der, base = 20, W - 20, page.rect.height - 24
    for s in pie:
        x0, x1 = s["bbox"][0], s["bbox"][2]
        if (x0 + x1) / 2 < W / 2:
            izq = max(izq, x1)
        else:
            der = min(der, x0)
        base = s["origin"][1]
    if der - izq - 24 >= ancho:
        x = (izq + der) / 2 - ancho / 2
    else:                                          # no cabe en el pie: arriba a la derecha
        x, base = W - 20 - ancho, 15
    page.draw_rect(pymupdf.Rect(x, base - 11, x + ancho, base + 4), color=rojo, fill=(1, 1, 1), width=1)
    page.insert_text((x + 6, base), l1, fontname="hebo", fontsize=10, color=rojo)
    page.insert_text((x + 6 + w1 + 6, base), l2, fontname="helv", fontsize=7.5, color=rojo)


def procesar_pdf(origen, destino, suma=SUMA_DEFECTO, tipos=("MARCO", "HOJA")):
    """Crea 'destino' con las medidas cambiadas. Devuelve lista de cambios."""
    doc = pymupdf.open(origen)
    formato = detectar_formato(doc)
    estado = {"seccion": None}
    pies = []
    cambios = []
    for num_pag, page in enumerate(doc, start=1):
        if formato == "veratec":
            encontrados, pie = buscar_veratec(page, tipos, estado)
            posiciones = []                          # la Posición ya dice ALTO / ANCHO
            pies.append(pie)
        else:
            encontrados = buscar_medidas(page, tipos)
            posiciones = buscar_posiciones(page)
        if not encontrados and not posiciones:
            continue

        def borrar(s):
            # borrar solo ese texto (sin relleno, para no tapar líneas de la tabla)
            r = pymupdf.Rect(s["bbox"])
            page.add_redact_annot(pymupdf.Rect(r.x0 - 0.5, r.y0 + 1.5, r.x1 + 0.5, r.y1 - 1.5),
                                  fill=False)

        nuevos = []
        for tipo, desc, s in encontrados:
            viejo = s["text"].strip()
            n = a_numero(viejo) + suma
            # ePref usa punto de miles (1.798); Veratec escribe el número sin punto (2106)
            nuevo = a_texto(n) if formato == "epref" or "." in viejo else str(n)
            borrar(s)
            nuevos.append((s, nuevo))
            cambios.append((num_pag, tipo, desc, viejo, nuevo))
        for s in posiciones:
            borrar(s)
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                              graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
        for s, nuevo in nuevos:
            size = s["size"]
            ancho = pymupdf.get_text_length(nuevo, fontname="helv", fontsize=size)
            if formato == "veratec":                  # columna centrada
                x = (s["bbox"][0] + s["bbox"][2]) / 2 - ancho / 2
            else:                                     # columna alineada a la derecha
                x = s["bbox"][2] - ancho
            page.insert_text((x, s["origin"][1]), nuevo,
                             fontname="helv", fontsize=size, color=(0, 0, 0))
        for s in posiciones:
            page.insert_text(s["origin"], nueva_pos(s["text"]),
                             fontname="cour", fontsize=s["size"], color=(0, 0, 0))
    if cambios:
        l1 = f"REFORMULADO {'+' if suma >= 0 else ''}{suma}"
        l2 = "Medidas de " + " y ".join(tipos)
        for i, page in enumerate(doc):
            if formato == "veratec":
                sello_pie(page, l1, l2, pies[i])
            else:
                sello(page, l1, l2)
    doc.save(destino, garbage=3, deflate=True)
    doc.close()
    return cambios


def nombre_salida(origen, carpeta, suma):
    base = os.path.splitext(os.path.basename(origen))[0]
    signo = "+" if suma >= 0 else ""
    return os.path.join(carpeta or os.path.dirname(origen), f"{base} ({signo}{suma}).pdf")


# ----------------------------------------------------------------- consola
def main_consola(args):
    suma, salida, tipos, archivos = SUMA_DEFECTO, None, ["MARCO", "HOJA"], []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--suma":
            suma = int(args[i + 1]); i += 1
        elif a == "--salida":
            salida = args[i + 1]; i += 1
        elif a == "--solo-marco":
            tipos = ["MARCO"]
        elif a == "--solo-hoja":
            tipos = ["HOJA"]
        else:
            archivos.append(a)
        i += 1
    if salida:
        os.makedirs(salida, exist_ok=True)
    for f in archivos:
        dest = nombre_salida(f, salida, suma)
        cambios = procesar_pdf(f, dest, suma, tipos)
        print(f"{os.path.basename(f)} -> {dest}  ({len(cambios)} medidas)")
        for pag, tipo, desc, v, n in cambios:
            print(f"   pág {pag}  {tipo:5}  {v:>6} -> {n:>6}   {desc}")


# ----------------------------------------------------------------- ventana
def main_ventana():
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    root = tk.Tk()
    root.title("Medida a cortar - sumar a MARCO y HOJA")
    root.geometry("820x560")
    root.minsize(700, 450)

    archivos = []
    var_suma = tk.StringVar(value=str(SUMA_DEFECTO))
    var_marco = tk.BooleanVar(value=True)
    var_hoja = tk.BooleanVar(value=True)
    var_carpeta = tk.StringVar(value="")   # vacío = misma carpeta del original
    var_abrir = tk.BooleanVar(value=False)

    pad = {"padx": 8, "pady": 4}

    # --- lista de archivos
    marco_arch = ttk.LabelFrame(root, text="PDFs (Hoja de trabajo ePref)")
    marco_arch.pack(fill="both", expand=False, **pad)
    lista = tk.Listbox(marco_arch, height=7, selectmode="extended")
    lista.pack(side="left", fill="both", expand=True, padx=(6, 0), pady=6)
    sb = ttk.Scrollbar(marco_arch, orient="vertical", command=lista.yview)
    sb.pack(side="left", fill="y", pady=6)
    lista.config(yscrollcommand=sb.set)
    botones = ttk.Frame(marco_arch)
    botones.pack(side="left", fill="y", padx=6, pady=6)

    def refrescar():
        lista.delete(0, "end")
        for f in archivos:
            lista.insert("end", os.path.basename(f))

    def agregar():
        fs = filedialog.askopenfilenames(title="Elegir PDFs",
                                         filetypes=[("PDF", "*.pdf")])
        for f in fs:
            if f not in archivos:
                archivos.append(f)
        refrescar()

    def quitar():
        for i in reversed(lista.curselection()):
            archivos.pop(i)
        refrescar()

    def limpiar():
        archivos.clear()
        refrescar()

    ttk.Button(botones, text="Agregar PDFs...", command=agregar).pack(fill="x", pady=2)
    ttk.Button(botones, text="Quitar selección", command=quitar).pack(fill="x", pady=2)
    ttk.Button(botones, text="Limpiar lista", command=limpiar).pack(fill="x", pady=2)

    # --- opciones
    op = ttk.LabelFrame(root, text="Opciones")
    op.pack(fill="x", **pad)
    ttk.Label(op, text="Sumar (mm):").grid(row=0, column=0, sticky="w", padx=6, pady=4)
    ttk.Entry(op, textvariable=var_suma, width=8).grid(row=0, column=1, sticky="w")
    ttk.Checkbutton(op, text="MARCO", variable=var_marco).grid(row=0, column=2, padx=12)
    ttk.Checkbutton(op, text="HOJA", variable=var_hoja).grid(row=0, column=3)
    ttk.Checkbutton(op, text="Abrir PDFs al terminar", variable=var_abrir).grid(row=0, column=4, padx=12)

    ttk.Label(op, text="Guardar en:").grid(row=1, column=0, sticky="w", padx=6, pady=4)
    lbl_carp = ttk.Label(op, text="(misma carpeta que el original)", width=60, anchor="w")
    lbl_carp.grid(row=1, column=1, columnspan=3, sticky="w")

    def elegir_carpeta():
        c = filedialog.askdirectory(title="Carpeta de salida")
        if c:
            var_carpeta.set(c)
            lbl_carp.config(text=c)

    def carpeta_original():
        var_carpeta.set("")
        lbl_carp.config(text="(misma carpeta que el original)")

    ttk.Button(op, text="Cambiar...", command=elegir_carpeta).grid(row=1, column=4, padx=4)
    ttk.Button(op, text="Igual al original", command=carpeta_original).grid(row=1, column=5, padx=4)

    # --- resultado
    res = ttk.LabelFrame(root, text="Resultado")
    res.pack(fill="both", expand=True, **pad)
    txt = tk.Text(res, height=12, font=("Consolas", 9), wrap="none")
    txt.pack(side="left", fill="both", expand=True, padx=(6, 0), pady=6)
    sb2 = ttk.Scrollbar(res, orient="vertical", command=txt.yview)
    sb2.pack(side="left", fill="y", pady=6)
    txt.config(yscrollcommand=sb2.set)

    def log(linea):
        txt.insert("end", linea + "\n")
        txt.see("end")
        root.update_idletasks()

    def procesar():
        if not archivos:
            messagebox.showwarning("Falta PDF", "Agrega al menos un PDF.")
            return
        try:
            suma = int(var_suma.get().strip())
        except ValueError:
            messagebox.showerror("Valor inválido", "La suma debe ser un número entero (mm).")
            return
        tipos = [t for t, v in (("MARCO", var_marco), ("HOJA", var_hoja)) if v.get()]
        if not tipos:
            messagebox.showwarning("Nada que cambiar", "Marca MARCO y/o HOJA.")
            return
        carpeta = var_carpeta.get() or None
        txt.delete("1.0", "end")
        ok = 0
        for f in archivos:
            dest = nombre_salida(f, carpeta, suma)
            try:
                cambios = procesar_pdf(f, dest, suma, tipos)
            except Exception as e:
                log(f"ERROR  {os.path.basename(f)}: {e}")
                continue
            ok += 1
            log(f"{os.path.basename(f)}  ->  {os.path.basename(dest)}   ({len(cambios)} medidas)")
            if not cambios:
                log("   (no se encontraron medidas de MARCO/HOJA en este PDF)")
            for pag, tipo, desc, v, n in cambios:
                log(f"   pág {pag:<2} {tipo:5} {v:>6} -> {n:>6}   {desc}")
            log("")
            if var_abrir.get():
                try:
                    os.startfile(dest)
                except Exception:
                    pass
        log(f"Listo: {ok} de {len(archivos)} PDF procesados.")

    ttk.Button(root, text="PROCESAR", command=procesar).pack(pady=(0, 10), ipadx=20, ipady=4)

    # archivos pasados por argumento (ej. arrastrados sobre el .bat)
    for a in sys.argv[1:]:
        if a.lower().endswith(".pdf") and os.path.isfile(a):
            archivos.append(a)
    refrescar()
    root.mainloop()


if __name__ == "__main__":
    if len(sys.argv) > 1 and any(a.startswith("--") for a in sys.argv[1:]) or "--consola" in sys.argv:
        main_consola([a for a in sys.argv[1:] if a != "--consola"])
    else:
        main_ventana()
