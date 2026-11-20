# Medida a cortar

Suma un valor fijo (por defecto **261 mm**) a las medidas de **MARCO** y **HOJA** en las
"HOJA DE TRABAJO" generadas por ePref (PrefSuite), y entrega el mismo PDF con las medidas nuevas.

- Solo cambian las filas de la sección **01 PVC** cuya descripción empieza con `MARCO` o `HOJA`
  (por ejemplo `MARCO PVC 2 GUIAS 6,05 M`, `HOJA PVC H=93 MM FBL 6,05M`).
- Refuerzos, junquillos, tapas, vidrios y las cotas del dibujo no se tocan.
- La medida se escribe en el mismo formato: `1.798` → `2.059`, `970` → `1.231`.
- Cada página del PDF resultante lleva en el encabezado la leyenda **REFORMULADO +261**.
- El original nunca se sobrescribe: se crea `NOMBRE (+261).pdf`.

## Versión web (`web/`)

`web/index.html` + `web/nucleo.js`. Procesa los PDFs dentro del navegador (no se suben a ningún
servidor) usando [pdf.js](https://mozilla.github.io/pdf.js/) para leer y
[pdf-lib](https://pdf-lib.js.org/) para escribir. Suelta los PDFs, ajusta el valor y descarga el
resultado (uno por uno o todos en un `.zip`).

Para usarla en local hay que servir la carpeta (por ejemplo `python -m http.server --directory web`)
y abrir `http://localhost:8000`.

> En la versión web la medida antigua queda tapada con un recuadro blanco: al imprimir solo se ve la
> nueva, pero si se copia el texto del PDF puede aparecer también el número viejo.

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
