# VisionWear AI

Prototipo web de **virtual try-on adaptativo** que combina cámara, pose estimation, segmentación, medición aproximada del cuerpo, análisis de prendas y renderizado Three.js.

## Qué hace ahora

### Perfil corporal

VisionWear puede construir un perfil aproximado usando:

- altura real;
- fotografía frontal;
- fotografía lateral;
- fotografía posterior opcional;
- MoveNet para landmarks;
- BodyPix para silueta;
- una aproximación elíptica para combinar ancho y profundidad.

El perfil estima:

- ancho de hombros;
- largo de torso;
- ancho frontal de pecho;
- profundidad de pecho;
- contorno aproximado de pecho;
- ancho y profundidad de cintura;
- contorno aproximado de cintura.

Las imágenes se procesan en el navegador. Solo se guardan las medidas derivadas en `localStorage`.

### Torso paramétrico 3D

`src/avatarBuilder.js` genera una geometría 3D aproximada del torso a partir de las medidas estimadas. Es una representación paramétrica para visualizar volumen y proporciones; todavía no es SMPL/SMPL-X.

### Análisis de prenda

`src/garmentAnalyzer.js` analiza una imagen frontal de una prenda:

1. intenta separar la prenda mediante canal alpha o contraste con el fondo;
2. calcula su bounding box y varios anchos de la silueta;
3. solicita una **medida real de referencia** para convertir píxeles a centímetros;
4. estima ancho de pecho, cintura, basta, largo y ancho máximo;
5. genera una textura PNG recortada con fondo transparente.

Una imagen sin una referencia conocida solo permite proporciones relativas. Por eso el flujo exige indicar, por ejemplo, el largo total o el ancho de pecho en plano.

### Fit engine

`src/fitEngine.js` compara las medidas del perfil corporal y de la prenda para estimar:

- holgura de pecho;
- holgura de cintura;
- diferencia de largo;
- ajuste entallado, regular, holgado u oversize;
- score experimental de compatibilidad;
- factores visuales para ancho y largo.

La elasticidad indicada para la prenda modifica su dimensión efectiva antes de calcular el fit.

### Prenda deformable

La imagen subida ya no se aplica directamente como un plano rígido. El sistema:

```text
imagen de prenda
      ↓
segmentación / recorte
      ↓
medición en cm
      ↓
comparación con perfil corporal
      ↓
fit engine
      ↓
mesh subdividida Three.js
      ↓
warp de cintura / basta / largo
      ↓
tracking en vivo
```

El mesh sigue hombros y caderas, usa el perfil corporal y aplica los factores calculados por el fit engine.

### Tracking en vivo

- `getUserMedia` para webcam;
- MoveNet sobre TensorFlow.js;
- cámara espejada correctamente;
- corrección de `object-fit: cover`;
- Three.js con cámara ortográfica;
- One Euro Filter para reducir jitter;
- tracking aproximado a 30 FPS.

## Flujo de uso

1. Abrir GitHub Pages mediante HTTPS.
2. Pulsar **Permitir Cámara e Iniciar**.
3. Abrir **Perfil corporal → Escanear**.
4. Ingresar altura y frontal/lateral; posterior es opcional.
5. Ejecutar el escaneo.
6. Revisar las medidas y el preview 3D aproximado.
7. Abrir **Prenda → Analizar**.
8. Subir una imagen frontal de la prenda.
9. Indicar una medida real conocida.
10. Elegir tipo de prenda y elasticidad.
11. Ejecutar el análisis.
12. VisionWear calcula el fit y aplica la textura procesada a una malla deformable.

## Arquitectura

```text
                         ┌─────────────────────┐
frontal/lateral/back ───►│ BodyProfileAnalyzer │
altura ─────────────────►│ MoveNet + BodyPix   │
                         └──────────┬──────────┘
                                    │
                                    ▼
                              Body Profile
                                    │
                         ┌──────────┴───────────┐
                         ▼                      ▼
                  AvatarPreview           FitEngine ◄──── GarmentAnalyzer
                  torso 3D aprox.              │              ▲
                                               ▼              │
                                        deformation data      │
                                               │              │
webcam ─► MoveNet ─► One Euro Filter ─────────┴──────► Three.js mesh
```

## Archivos principales

- `src/app.js`: orquestación, UI, tracking y rendering.
- `src/camera.js`: acceso seguro a webcam.
- `src/poseDetection.js`: MoveNet.
- `src/bodyProfile.js`: estimación multivista del perfil corporal.
- `src/garmentAnalyzer.js`: segmentación y medición de prenda.
- `src/fitEngine.js`: comparación cuerpo/prenda.
- `src/avatarBuilder.js`: torso paramétrico 3D aproximado.
- `src/scanAnimation.js`: estados y animación visual de escaneo.
- `src/filters.js`: One Euro Filter.

## Limitaciones actuales

- Las medidas son estimaciones visuales, no mediciones de sastrería exactas.
- El análisis de una prenda funciona mejor con PNG transparente o fondo uniforme.
- El sistema necesita al menos una medida conocida de la prenda para obtener centímetros reales.
- El avatar actual es un torso paramétrico 2.5D/3D aproximado, no SMPL/SMPL-X.
- La prenda se deforma mediante una malla 2D subdividida; todavía no hay simulación física de tela.
- Aún falta oclusión corporal por partes para que brazos/manos pasen correctamente delante de la prenda.

## Siguientes fases

- human parsing por partes corporales para oclusión;
- deformación de prenda según hombros, pecho, cintura y perspectiva;
- reconstrucción SMPL/SMPL-X/GHUM;
- captura multivista o video 360°;
- prendas GLB/glTF con rigging;
- simulación de tela y materiales;
- catálogo con tallas y tablas de medidas reales;
- recomendación de talla basada en datos de cada marca.

## Publicación

El proyecto es estático y se despliega con GitHub Pages desde `main`.
