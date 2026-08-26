# VisionWear AI

Prototipo web de **virtual try-on** que combina cámara, pose estimation, segmentación corporal y renderizado gráfico para ajustar una prenda al torso del usuario en tiempo real.

## Estado actual

### Implementado

- Cámara web con permisos seguros (`getUserMedia`).
- MoveNet sobre TensorFlow.js para detectar hombros, caderas y pose en tiempo real.
- Conversión correcta entre coordenadas del video, `object-fit: cover`, cámara espejada y pantalla.
- Renderizado Three.js con cámara ortográfica.
- Suavizado temporal con **One Euro Filter** para reducir jitter de posición, escala y rotación.
- Prenda base que sigue hombros/caderas.
- Perfil corporal opcional usando:
  - altura real del usuario;
  - fotografía frontal;
  - fotografía lateral;
  - MoveNet para landmarks;
  - BodyPix para segmentar la silueta.
- Estimación visual aproximada de:
  - ancho de hombros;
  - longitud de torso;
  - ancho frontal de pecho;
  - profundidad lateral de pecho;
  - contorno aproximado de pecho;
  - ancho y contorno aproximado de cintura.
- El perfil corporal se guarda localmente en `localStorage`; las fotos no se persisten.
- El perfil modifica las proporciones de la prenda para adaptarla mejor al usuario.
- Captura frontal/lateral desde la cámara o carga de imágenes.
- Carga de una prenda propia en PNG/WebP/JPG para probarla como overlay.
- Cambio de color de la prenda base.
- Interfaz responsive para escritorio y móvil.

## Flujo de uso

1. Abrir GitHub Pages mediante HTTPS.
2. Pulsar **Permitir Cámara e Iniciar**.
3. Crear un perfil corporal desde el panel lateral si se desea mayor personalización.
4. Ingresar la altura real.
5. Cargar o capturar una imagen frontal y otra lateral de cuerpo completo.
6. Mantener los brazos ligeramente separados del torso y evitar ropa demasiado holgada durante la calibración.
7. Pulsar **Analizar perfil corporal**.
8. Probar la prenda base o cargar una imagen propia con fondo transparente.

## Arquitectura actual

```text
Webcam
  │
  ├── MoveNet ────────────────► pose en vivo
  │                              │
  │                              ▼
  │                       One Euro Filter
  │                              │
  │                              ▼
  │                         garment fitting
  │
  └── Captura frontal/lateral
            │
            ├── MoveNet landmarks
            ├── BodyPix silhouette
            └── altura declarada
                    │
                    ▼
              Body Profile
                    │
                    ▼
              Three.js overlay
```

## Limitación importante

El perfil corporal actual es una **estimación 2D/multivista**, no un escaneo médico ni una reconstrucción 3D exacta. La profundidad se aproxima a partir de la vista lateral y el contorno se aproxima como una elipse.

Para una fase posterior de reconstrucción corporal real se debería integrar un modelo paramétrico como **SMPL/SMPL-X/GHUM**, idealmente con varias vistas o video 360°, y posteriormente deformar prendas 3D (`glTF/GLB`) sobre ese avatar.

## Próximas fases técnicas

- Segmentación por partes corporales para oclusión correcta de brazos/manos.
- Malla deformable de prenda en lugar de un overlay rígido.
- Ajuste de perspectiva al girar el torso.
- Reconstrucción corporal SMPL/SMPL-X desde múltiples vistas.
- Prendas 3D con rigging y deformación por talla/cuerpo.
- Catálogo de prendas y tallas.
- Medición de rendimiento y fallback para dispositivos de baja potencia.

## Publicación

El proyecto es estático y puede desplegarse directamente con GitHub Pages desde la rama `main`.
