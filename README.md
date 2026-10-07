# 🐶 Shorkie 3D

Un perrito **shorkie** (Shih Tzu × Yorkshire Terrier) caminando, hecho con [three.js](https://threejs.org/).
Pelaje crema claro, orejas puntiagudas y erguidas, hocico corto y la lengüita afuera.

Todo el modelo es procedural: no hay archivos 3D. El pelaje son ~40 000 mechones
curvos generados por código:

- cada mechón nace en la piel, se dobla por la gravedad y no atraviesa el cuerpo;
- raya en el lomo, falda larga, barba y bigotes que caen hacia los lados;
- raíz más oscura y punta más clara, con *sheen* para el brillo suave del pelo;
- las puntas se mueven con una brisa leve y con la inercia al caminar (vertex shader).

Ojos y nariz usan `MeshPhysicalMaterial` con *clearcoat* e iluminación ambiental
(`RoomEnvironment`) para que tengan brillo húmedo.

### Calidad

En equipos lentos agrega `?quality=0.5` (o menor) a la URL para usar menos mechones.
En celulares se usa `0.5` por defecto.

## Cómo correrlo

No necesita build; solo un servidor estático (los módulos ES no cargan desde `file://`):

```bash
npx serve .
# o
python3 -m http.server 8000
```

Abre `http://localhost:8000`.

### GitHub Pages

En **Settings → Pages**, elige *Deploy from a branch* → `main` / `(root)`.

## Controles

| Acción | Control |
| --- | --- |
| Girar / zoom de cámara | arrastrar / rueda del mouse |
| Caminar manualmente | `W A S D` o flechas |
| Ladrar | `Espacio` o el botón 🔊 |
| Velocidad, pausa, cámara que sigue | panel de la esquina |

Sin control manual, el perro pasea solo por el camino circular.

## Estructura

```
index.html      página + import map de three.js (CDN)
style.css       estilos del panel
src/main.js     escena, cámara, suelo, controles y bucle
src/dog.js      modelo del shorkie y animación de caminata
```

### Animación

- **Patas**: paso de 4 tiempos (trasera izq → delantera izq → trasera der → delantera der);
  cadera y rodilla se doblan durante la fase de balanceo.
- **Cuerpo**: rebote y balanceo ligero con cada paso.
- **Cabeza y orejas**: rebotan al caminar; quieto, mira a su alrededor.
- **Cola** moviéndose, jadeo de la lengua y parpadeo.

Para ajustar el aspecto, cambia `PALETTE` y los parámetros de `addHair()` en `src/dog.js`.
