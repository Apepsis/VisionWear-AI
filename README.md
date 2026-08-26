# VisionWear AI

Prototipo web de **virtual try-on adaptativo** que combina cámara, pose estimation, segmentación, medición aproximada del cuerpo, análisis de prendas, fitting y renderizado Three.js.

## Qué hace ahora

### Perfil corporal

VisionWear puede construir un perfil aproximado usando dos modos:

1. **Fotos manuales**: frontal, lateral y posterior opcional.
2. **Giro 360° guiado**: el usuario empieza de frente y completa una vuelta lenta mientras el sistema captura automáticamente frontal, lateral derecha, posterior y lateral izquierda.

El análisis combina:

- altura real;
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

### Giro 360° guiado

`src/turnScan.js` implementa una captura guiada de aproximadamente 12 segundos. El usuario mantiene los pies relativamente quietos y gira hacia su derecha. El sistema captura checkpoints aproximados en:

- 0°: frontal;
- 90°: lateral derecha;
- 180°: posterior;
- 270°: lateral izquierda.

La versión actual usa esos checkpoints para alimentar el perfil multivista. No es todavía fotogrametría ni reconstrucción densa 3D frame-by-frame.

### Oclusión corporal

`src/occlusion.js` usa **BodyPix person-part segmentation** en tiempo real para separar brazos y manos. Luego recompone esos píxeles de la webcam por encima de la malla de la prenda.

Con la opción **Oclusión corporal** activa:

```text
webcam
  ├── Three.js garment mesh
  └── BodyPix person parts
          ↓
     brazos + manos
          ↓
  canvas frontal de oclusión
```

Esto permite que, cuando el usuario cruza un brazo o una mano por delante del torso, esa extremidad pueda aparecer delante de la prenda renderizada en vez de quedar tapada por ella.

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
- tracking aproximado a 30 FPS;
- BodyPix person-part segmentation para oclusión a menor frecuencia y reducir carga.

## Flujo de uso

1. Abrir GitHub Pages mediante HTTPS.
2. Pulsar **Permitir Cámara e Iniciar**.
3. Abrir **Perfil corporal → Escanear**.
4. Ingresar la altura real.
5. Usar **Iniciar escaneo 360°** o cargar frontal/lateral/posterior manualmente.
6. Ejecutar el análisis si no se inició automáticamente.
7. Revisar las medidas y el preview 3D aproximado.
8. Abrir **Prenda → Analizar**.
9. Subir una imagen frontal de la prenda.
10. Indicar una medida real conocida.
11. Elegir tipo de prenda y elasticidad.
12. Ejecutar el análisis.
13. VisionWear calcula el fit y aplica la textura procesada a una malla deformable.
14. Activar **Oclusión corporal** para que brazos y manos puedan pasar visualmente por delante de la prenda.

## Arquitectura

```text
                    ┌─────────────────────┐
manual / giro 360 ─►│ BodyProfileAnalyzer │
altura ────────────►│ MoveNet + BodyPix   │
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
webcam ─► MoveNet ─► One Euro Filter ────┴──────► Three.js garment mesh
  │                                                     │
  └────► BodyPix person parts ─► arms/hands canvas ─────┘
                         (rendered above garment)
```

## Archivos principales

- `src/app.js`: orquestación, UI, tracking y rendering.
- `src/camera.js`: acceso seguro a webcam.
- `src/poseDetection.js`: MoveNet.
- `src/bodyProfile.js`: estimación multivista del perfil corporal.
- `src/turnScan.js`: giro 360° guiado y captura automática de vistas.
- `src/occlusion.js`: human parsing de brazos/manos y composición de oclusión.
- `src/enhancements.js`: integración del giro 360° y oclusión con la interfaz existente.
- `src/garmentAnalyzer.js`: segmentación y medición de prenda.
- `src/fitEngine.js`: comparación cuerpo/prenda.
- `src/avatarBuilder.js`: torso paramétrico 3D aproximado.
- `src/scanAnimation.js`: estados y animación visual de escaneo.
- `src/filters.js`: One Euro Filter.

## Limitaciones actuales

- Las medidas son estimaciones visuales, no mediciones de sastrería exactas.
- El giro 360° usa checkpoints temporales aproximados; depende de que el usuario siga la velocidad indicada.
- La captura 360° todavía no genera una nube de puntos ni un SMPL/SMPL-X optimizado sobre todos los frames.
- El human parsing actual prioriza brazos y manos; no resuelve todavía todas las oclusiones complejas entre torso, cuello, cabello y prenda.
- El análisis de una prenda funciona mejor con PNG transparente o fondo uniforme.
- El sistema necesita al menos una medida conocida de la prenda para obtener centímetros reales.
- El avatar actual es un torso paramétrico 2.5D/3D aproximado, no SMPL/SMPL-X.
- La prenda se deforma mediante una malla 2D subdividida; todavía no hay simulación física de tela.

## Siguientes fases

- usar todos los frames del giro en una optimización multivista en vez de solo checkpoints;
- estimar orientación/yaw automáticamente durante el giro;
- human parsing más completo para torso, cuello, cabello y prendas existentes;
- reconstrucción SMPL/SMPL-X/GHUM;
- prendas GLB/glTF con rigging;
- simulación de tela y materiales;
- catálogo con tallas y tablas de medidas reales;
- recomendación de talla basada en datos de cada marca.

## Publicación

El proyecto es estático y se despliega con GitHub Pages desde `main`.
