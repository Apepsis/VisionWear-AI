const BODY_PIX_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/body-pix@2.2.0/dist/body-pix.min.js';

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function round(value, decimals = 1) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function average(values) {
    const valid = values.filter(Number.isFinite);
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

export class BodyProfileAnalyzer {
    constructor(poseEstimator) {
        this.poseEstimator = poseEstimator;
        this.bodyPixNet = null;
        this.loadingPromise = null;
    }

    async loadScriptOnce(src, globalName) {
        if (globalThis[globalName]) return;

        const existing = document.querySelector(`script[data-visionwear-src="${src}"]`);
        if (existing) {
            await new Promise((resolve, reject) => {
                if (globalThis[globalName]) return resolve();
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', reject, { once: true });
            });
            return;
        }

        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.dataset.visionwearSrc = src;
            script.addEventListener('load', resolve, { once: true });
            script.addEventListener('error', () => reject(new Error(`No se pudo cargar ${src}`)), { once: true });
            document.head.appendChild(script);
        });

        if (!globalThis[globalName]) {
            throw new Error(`La librería ${globalName} no quedó disponible en el navegador.`);
        }
    }

    async initialize(onProgress = () => {}) {
        if (this.bodyPixNet) return;
        if (this.loadingPromise) return this.loadingPromise;

        this.loadingPromise = (async () => {
            onProgress('Cargando segmentación corporal...');
            await this.loadScriptOnce(BODY_PIX_URL, 'bodyPix');
            onProgress('Inicializando BodyPix...');
            this.bodyPixNet = await globalThis.bodyPix.load({
                architecture: 'MobileNetV1',
                outputStride: 16,
                multiplier: 0.75,
                quantBytes: 2
            });
        })();

        try {
            await this.loadingPromise;
        } finally {
            this.loadingPromise = null;
        }
    }

    async fileToImage(file) {
        if (!file) throw new Error('Falta una imagen para analizar.');
        if (!file.type?.startsWith('image/')) throw new Error('El archivo debe ser una imagen.');

        const url = URL.createObjectURL(file);
        try {
            return await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error(`No se pudo leer ${file.name || 'la imagen'}.`));
                image.src = url;
            });
        } finally {
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    }

    async segment(image) {
        if (!this.bodyPixNet) throw new Error('BodyPix todavía no está inicializado.');
        return this.bodyPixNet.segmentPerson(image, {
            internalResolution: 'medium',
            segmentationThreshold: 0.68,
            maxDetections: 1,
            scoreThreshold: 0.30,
            nmsRadius: 20
        });
    }

    getMaskBounds(segmentation) {
        const { data, width, height } = segmentation;
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        let pixels = 0;

        for (let y = 0; y < height; y += 1) {
            const rowOffset = y * width;
            for (let x = 0; x < width; x += 1) {
                if (!data[rowOffset + x]) continue;
                pixels += 1;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }

        if (maxX < minX || maxY < minY || pixels < 100) {
            throw new Error('No se pudo aislar claramente a la persona del fondo.');
        }

        return {
            minX,
            minY,
            maxX,
            maxY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
            pixels
        };
    }

    keypoint(pose, name, minScore = 0.25) {
        const point = pose?.keypoints?.find(item => item.name === name);
        return point && (point.score ?? 0) >= minScore ? point : null;
    }

    torsoReference(pose, ratio = 0.3) {
        const shoulders = [
            this.keypoint(pose, 'left_shoulder'),
            this.keypoint(pose, 'right_shoulder')
        ].filter(Boolean);
        const hips = [
            this.keypoint(pose, 'left_hip'),
            this.keypoint(pose, 'right_hip')
        ].filter(Boolean);

        const shoulderX = average(shoulders.map(point => point.x));
        const shoulderY = average(shoulders.map(point => point.y));
        const hipX = average(hips.map(point => point.x));
        const hipY = average(hips.map(point => point.y));

        if (![shoulderX, shoulderY, hipX, hipY].every(Number.isFinite)) return null;
        return {
            x: shoulderX + ((hipX - shoulderX) * ratio),
            y: shoulderY + ((hipY - shoulderY) * ratio)
        };
    }

    getTorsoSpan(segmentation, targetY, targetX, band = 5) {
        const { data, width, height } = segmentation;
        const yCenter = clamp(Math.round(targetY), 0, height - 1);
        const requestedX = clamp(Math.round(targetX), 0, width - 1);
        let best = null;

        for (let y = Math.max(0, yCenter - band); y <= Math.min(height - 1, yCenter + band); y += 1) {
            const rowOffset = y * width;
            let seed = requestedX;

            if (!data[rowOffset + seed]) {
                const searchRadius = Math.max(8, Math.round(width * 0.08));
                let nearest = null;
                for (let offset = 1; offset <= searchRadius; offset += 1) {
                    const left = requestedX - offset;
                    const right = requestedX + offset;
                    if (left >= 0 && data[rowOffset + left]) {
                        nearest = left;
                        break;
                    }
                    if (right < width && data[rowOffset + right]) {
                        nearest = right;
                        break;
                    }
                }
                if (nearest === null) continue;
                seed = nearest;
            }

            let minX = seed;
            let maxX = seed;
            while (minX > 0 && data[rowOffset + minX - 1]) minX -= 1;
            while (maxX < width - 1 && data[rowOffset + maxX + 1]) maxX += 1;

            const span = maxX - minX + 1;
            if (!best || span > best.width) {
                best = { minX, maxX, width: span, y };
            }
        }

        return best;
    }

    ellipseCircumference(width, depth) {
        const a = Math.max(width / 2, 0.1);
        const b = Math.max(depth / 2, 0.1);
        return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    }

    qualityWarnings(image, bounds, label) {
        const warnings = [];
        const topMargin = bounds.minY / image.naturalHeight;
        const bottomMargin = (image.naturalHeight - 1 - bounds.maxY) / image.naturalHeight;

        if (topMargin < 0.01 || bottomMargin < 0.01) {
            warnings.push(`${label}: el cuerpo parece tocar el borde superior/inferior; la escala por altura puede ser menos precisa.`);
        }
        if ((bounds.height / image.naturalHeight) < 0.55) {
            warnings.push(`${label}: la persona ocupa poco espacio en la imagen; acércate o usa una imagen con mayor resolución.`);
        }
        return warnings;
    }

    measureView({ image, pose, segmentation, heightCm, label }) {
        const bounds = this.getMaskBounds(segmentation);
        const cmPerPx = heightCm / bounds.height;
        const chestRef = this.torsoReference(pose, 0.30);
        const waistRef = this.torsoReference(pose, 0.74);

        if (!chestRef || !waistRef) {
            throw new Error(`${label}: no se pudieron ubicar hombros/caderas con suficiente confianza.`);
        }

        const chestSpan = this.getTorsoSpan(segmentation, chestRef.y, chestRef.x, 5);
        const waistSpan = this.getTorsoSpan(segmentation, waistRef.y, waistRef.x, 5);
        if (!chestSpan || !waistSpan) {
            throw new Error(`${label}: la silueta del torso no fue suficientemente clara.`);
        }

        return {
            bounds,
            cmPerPx,
            chestWidthCm: chestSpan.width * cmPerPx,
            waistWidthCm: waistSpan.width * cmPerPx,
            warnings: this.qualityWarnings(image, bounds, label)
        };
    }

    async analyze({ frontFile, sideFile, backFile = null, heightCm, onProgress = () => {} }) {
        const numericHeight = Number(heightCm);
        if (!Number.isFinite(numericHeight) || numericHeight < 120 || numericHeight > 230) {
            throw new Error('Ingresa una altura válida entre 120 y 230 cm.');
        }
        if (!frontFile || !sideFile) {
            throw new Error('Necesito al menos una imagen frontal y una imagen lateral.');
        }

        await this.initialize(onProgress);
        onProgress('Leyendo imágenes...');

        const frontImagePromise = this.fileToImage(frontFile);
        const sideImagePromise = this.fileToImage(sideFile);
        const backImagePromise = backFile ? this.fileToImage(backFile) : Promise.resolve(null);
        const [frontImage, sideImage, backImage] = await Promise.all([
            frontImagePromise,
            sideImagePromise,
            backImagePromise
        ]);

        onProgress('Detectando postura en las vistas...');
        const frontPose = await this.poseEstimator.estimateImage(frontImage);
        const sidePose = await this.poseEstimator.estimateImage(sideImage);
        const backPose = backImage ? await this.poseEstimator.estimateImage(backImage) : null;

        if (!frontPose) throw new Error('No se detectó una persona clara en la foto frontal.');
        if (!sidePose) throw new Error('No se detectó una persona clara en la foto lateral.');
        if (backImage && !backPose) throw new Error('No se detectó una persona clara en la foto posterior.');

        const leftShoulder = this.keypoint(frontPose, 'left_shoulder', 0.35);
        const rightShoulder = this.keypoint(frontPose, 'right_shoulder', 0.35);
        const leftHip = this.keypoint(frontPose, 'left_hip', 0.30);
        const rightHip = this.keypoint(frontPose, 'right_hip', 0.30);

        if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
            throw new Error('La foto frontal debe mostrar claramente hombros y caderas.');
        }

        onProgress('Segmentando las siluetas...');
        const frontSegmentation = await this.segment(frontImage);
        const sideSegmentation = await this.segment(sideImage);
        const backSegmentation = backImage ? await this.segment(backImage) : null;

        const frontView = this.measureView({
            image: frontImage,
            pose: frontPose,
            segmentation: frontSegmentation,
            heightCm: numericHeight,
            label: 'Frontal'
        });
        const sideView = this.measureView({
            image: sideImage,
            pose: sidePose,
            segmentation: sideSegmentation,
            heightCm: numericHeight,
            label: 'Lateral'
        });
        const backView = backImage ? this.measureView({
            image: backImage,
            pose: backPose,
            segmentation: backSegmentation,
            heightCm: numericHeight,
            label: 'Posterior'
        }) : null;

        const shoulderWidthCm = distance(leftShoulder, rightShoulder) * frontView.cmPerPx;
        const shoulderMid = {
            x: (leftShoulder.x + rightShoulder.x) / 2,
            y: (leftShoulder.y + rightShoulder.y) / 2
        };
        const hipMid = {
            x: (leftHip.x + rightHip.x) / 2,
            y: (leftHip.y + rightHip.y) / 2
        };
        const torsoLengthCm = distance(shoulderMid, hipMid) * frontView.cmPerPx;

        const chestWidthCm = average([
            frontView.chestWidthCm,
            backView?.chestWidthCm
        ]);
        const waistWidthCm = average([
            frontView.waistWidthCm,
            backView?.waistWidthCm
        ]);
        const chestDepthCm = sideView.chestWidthCm;
        const waistDepthCm = sideView.waistWidthCm;
        const chestCircumferenceCm = this.ellipseCircumference(chestWidthCm, chestDepthCm);
        const waistCircumferenceCm = this.ellipseCircumference(waistWidthCm, waistDepthCm);

        const confidencePoints = [leftShoulder, rightShoulder, leftHip, rightHip];
        const poseConfidence = average(confidencePoints.map(point => point.score ?? 0)) ?? 0;
        const warnings = [
            ...frontView.warnings,
            ...sideView.warnings,
            ...(backView?.warnings || [])
        ];

        const profile = {
            version: 2,
            createdAt: new Date().toISOString(),
            source: backView ? 'front+side+back+height' : 'front+side+height',
            heightCm: round(numericHeight, 1),
            measurements: {
                shoulderWidthCm: round(shoulderWidthCm),
                torsoLengthCm: round(torsoLengthCm),
                chestFrontWidthCm: round(chestWidthCm),
                chestBackWidthCm: backView ? round(backView.chestWidthCm) : null,
                chestDepthCm: round(chestDepthCm),
                chestCircumferenceCm: round(chestCircumferenceCm),
                waistFrontWidthCm: round(waistWidthCm),
                waistBackWidthCm: backView ? round(backView.waistWidthCm) : null,
                waistDepthCm: round(waistDepthCm),
                waistCircumferenceCm: round(waistCircumferenceCm)
            },
            ratios: {
                chestToShoulder: round(chestWidthCm / Math.max(shoulderWidthCm, 1), 3),
                waistToChest: round(waistWidthCm / Math.max(chestWidthCm, 1), 3),
                torsoToShoulder: round(torsoLengthCm / Math.max(shoulderWidthCm, 1), 3),
                depthToChestWidth: round(chestDepthCm / Math.max(chestWidthCm, 1), 3)
            },
            confidence: round(clamp(poseConfidence, 0, 1), 2),
            warnings
        };

        onProgress('Perfil corporal estimado y listo para el try-on.');
        return profile;
    }
}
