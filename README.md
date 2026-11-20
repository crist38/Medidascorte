# Medida a cortar

Suma un valor fijo (por defecto **261 mm**) a las medidas de **MARCO** y **HOJA** y entrega el
mismo PDF con las medidas nuevas. El formato del PDF se reconoce solo.

### ePref — "HOJA DE TRABAJO" (PrefSuite)

- Cambian las filas de la sección **01 PVC** cuya descripción empieza con `MARCO` o `HOJA`
  (por ejemplo `MARCO PVC 2 GUIAS 6,05 M`, `HOJA PVC H=93 MM FBL 6,05M`), columna **Medidas**.
- La medida se escribe en el mismo formato: `1.798` → `2.059`, `970` → `1.231`.
- En la columna **Pos.** de toda la tabla, `V` pasa a **ALTO** y `H` a **ANCHO**
  (se mantiene el símbolo de corte: `V \-/` → `ALTO \-/`, `H |-|` → `ANCHO |-|`).
- Cada página lleva en el encabezado la leyenda **REFORMULADO +261**.

### Veratec — "LISTADO DE MONTAJE"

- Cambian las filas de **Perfiles y refuerzos** cuya descripción empieza con `MARCO` o `HOJA`
  (por ejemplo `MARCO CORREDERA 74MM 2R`, `HOJA VENTANA APERT. EXTER. 60X79`), columna **Ancho**:
  `2106` → `2367`. La sección puede seguir en la página siguiente sin encabezado.
- La columna **Posición** ya dice ALTO / ANCHO, así que no se cambia.
- La leyenda **REFORMULADO +261** va en el pie de cada página, entre «OBRA:…» y «Página nº».

En los dos formatos: refuerzos, junquillos, tapas, vidrios y las cotas del dibujo no se tocan, y
el original nunca se sobrescribe: se crea `NOMBRE (+261).pdf`.

## Versión web (`web/`)

En línea: **https://medidascorte.vercel.app**

`web/index.html` + `web/nucleo.js`. Procesa los PDFs dentro del navegador (no se suben a ningún
servidor) usando [pdf.js](https://mozilla.github.io/pdf.js/) para leer y
[pdf-lib](https://pdf-lib.js.org/) para escribir. Suelta los PDFs, ajusta el valor y descarga el
resultado (uno por uno o todos en un `.zip`).

Para usarla en local hay que servir la carpeta (por ejemplo `python -m http.server --directory web`)
y abrir `http://localhost:8000`.

> En la versión web la medida y la posición antiguas quedan tapadas con un recuadro blanco: al
> imprimir solo se ve lo nuevo, pero si se copia el texto del PDF puede aparecer también lo viejo.

## Versión de escritorio (`medida_a_cortar.py`)

Requiere Python 3 y PyMuPDF:

```bash
pip install -r requirements.txt
```

- Ventana: doble clic en `Medida a cortar.bat` (o arrastrar PDFs encima).
- Consola:

```bash
python medida_a_cortar.py --consola --suma 261 --salida CARPETA archivo1.pdf archivo2.pdf
```

Opciones: `--solo-marco`, `--solo-hoja`.
