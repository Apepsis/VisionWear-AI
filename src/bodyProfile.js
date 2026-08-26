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
                if (data[rowOffset + x]) {
                    pixels += 1;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
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

    getRowSpan(segmentation, targetY, band = 4) {
        const { data, width, height } = segmentation;
        const yCenter = clamp(Math.round(targetY), 0, height - 1);
        let bestSpan = null;

        for (let y = Math.max(0, yCenter - band); y <= Math.min(height - 1, yCenter + band); y += 1) {
            let minX = width;
            let maxX = -1;
            const rowOffset = y * width;

            for (let x = 0; x < width; x += 1) {
                if (data[rowOffset + x]) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                }
            }

            if (maxX >= minX) {
                const span = maxX - minX + 1;
                if (!bestSpan || span > bestSpan.width) {
                    bestSpan = { minX, maxX, width: span, y };
                }
            }
        }

        return bestSpan;
    }

    keypoint(pose, name, minScore = 0.25) {
        const point = pose?.keypoints?.find(item => item.name === name);
        return point && (point.score ?? 0) >= minScore ? point : null;
    }

    lineYFromPose(pose, ratio = 0.3) {
        const shoulders = [
            this.keypoint(pose, 'left_shoulder'),
            this.keypoint(pose, 'right_shoulder')
        ].filter(Boolean);

        const hips = [
            this.keypoint(pose, 'left_hip'),
            this.keypoint(pose, 'right_hip')
        ].filter(Boolean);

        const shoulderY = average(shoulders.map(point => point.y));
        const hipY = average(hips.map(point => point.y));

        if (!Number.isFinite(shoulderY) || !Number.isFinite(hipY)) return null;
        return shoulderY + ((hipY - shoulderY) * ratio);
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
            warnings.push(`${label}: la persona parece tocar el borde superior/inferior. La altura puede estar recortada.`);
        }

        if ((bounds.height / image.naturalHeight) < 0.55) {
            warnings.push(`${label}: la persona ocupa poco espacio en la imagen; la medición será menos estable.`);
        }

        return warnings;
    }

    async analyze({ frontFile, sideFile, heightCm, onProgress = () => {} }) {
        const numericHeight = Number(heightCm);
        if (!Number.isFinite(numericHeight) || numericHeight < 120 || numericHeight > 230) {
            throw new Error('Ingresa una altura válida entre 120 y 230 cm.');
        }

        if (!frontFile || !sideFile) {
            throw new Error('Necesito una imagen frontal y una imagen lateral.');
        }

        await this.initialize(onProgress);

        onProgress('Leyendo imágenes...');
        const [frontImage, sideImage] = await Promise.all([
            this.fileToImage(frontFile),
            this.fileToImage(sideFile)
        ]);

        onProgress('Detectando postura frontal y lateral...');
        const [frontPose, sidePose] = await Promise.all([
            this.poseEstimator.estimateImage(frontImage),
            this.poseEstimator.estimateImage(sideImage)
        ]);

        if (!frontPose) throw new Error('No se detectó una persona completa en la foto frontal.');
        if (!sidePose) throw new Error('No se detectó una persona completa en la foto lateral.');

        const leftShoulder = this.keypoint(frontPose, 'left_shoulder', 0.35);
        const rightShoulder = this.keypoint(frontPose, 'right_shoulder', 0.35);
        const leftHip = this.keypoint(frontPose, 'left_hip', 0.30);
        const rightHip = this.keypoint(frontPose, 'right_hip', 0.30);

        if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
            throw new Error('La foto frontal debe mostrar claramente hombros y caderas.');
        }

        onProgress('Segmentando la silueta corporal...');
        const [frontSegmentation, sideSegmentation] = await Promise.all([
            this.segment(frontImage),
            this.segment(sideImage)
        ]);

        const frontBounds = this.getMaskBounds(frontSegmentation);
        const sideBounds = this.getMaskBounds(sideSegmentation);
        const cmPerPxFront = numericHeight / frontBounds.height;
        const cmPerPxSide = numericHeight / sideBounds.height;

        const shoulderWidthCm = distance(leftShoulder, rightShoulder) * cmPerPxFront;
        const shoulderMid = {
            x: (leftShoulder.x + rightShoulder.x) / 2,
            y: (leftShoulder.y + rightShoulder.y) / 2
        };
        const hipMid = {
            x: (leftHip.x + rightHip.x) / 2,
            y: (leftHip.y + rightHip.y) / 2
        };
        const torsoLengthCm = distance(shoulderMid, hipMid) * cmPerPxFront;

        const frontChestY = this.lineYFromPose(frontPose, 0.30);
        const frontWaistY = this.lineYFromPose(frontPose, 0.74);
        const sideChestY = this.lineYFromPose(sidePose, 0.30);
        const sideWaistY = this.lineYFromPose(sidePose, 0.74);

        if (![frontChestY, frontWaistY, sideChestY, sideWaistY].every(Number.isFinite)) {
            throw new Error('No se pudieron ubicar pecho/cintura. Usa fotos donde el torso sea completamente visible.');
        }

        const frontChestSpan = this.getRowSpan(frontSegmentation, frontChestY, 5);
        const frontWaistSpan = this.getRowSpan(frontSegmentation, frontWaistY, 5);
        const sideChestSpan = this.getRowSpan(sideSegmentation, sideChestY, 5);
        const sideWaistSpan = this.getRowSpan(sideSegmentation, sideWaistY, 5);

        if (!frontChestSpan || !frontWaistSpan || !sideChestSpan || !sideWaistSpan) {
            throw new Error('La silueta no fue suficientemente clara para medir pecho y cintura.');
        }

        const chestFrontWidthCm = frontChestSpan.width * cmPerPxFront;
        const waistFrontWidthCm = frontWaistSpan.width * cmPerPxFront;
        const chestDepthCm = sideChestSpan.width * cmPerPxSide;
        const waistDepthCm = sideWaistSpan.width * cmPerPxSide;
        const chestCircumferenceCm = this.ellipseCircumference(chestFrontWidthCm, chestDepthCm);
        const waistCircumferenceCm = this.ellipseCircumference(waistFrontWidthCm, waistDepthCm);

        const confidencePoints = [leftShoulder, rightShoulder, leftHip, rightHip];
        const poseConfidence = average(confidencePoints.map(point => point.score ?? 0)) ?? 0;
        const warnings = [
            ...this.qualityWarnings(frontImage, frontBounds, 'Frontal'),
            ...this.qualityWarnings(sideImage, sideBounds, 'Lateral')
        ];

        const profile = {
            version: 1,
            createdAt: new Date().toISOString(),
            source: 'front+side+height',
            heightCm: round(numericHeight, 1),
            measurements: {
                shoulderWidthCm: round(shoulderWidthCm),
                torsoLengthCm: round(torsoLengthCm),
                chestFrontWidthCm: round(chestFrontWidthCm),
                chestDepthCm: round(chestDepthCm),
                chestCircumferenceCm: round(chestCircumferenceCm),
                waistFrontWidthCm: round(waistFrontWidthCm),
                waistDepthCm: round(waistDepthCm),
                waistCircumferenceCm: round(waistCircumferenceCm)
            },
            ratios: {
                chestToShoulder: round(chestFrontWidthCm / Math.max(shoulderWidthCm, 1), 3),
                waistToChest: round(waistFrontWidthCm / Math.max(chestFrontWidthCm, 1), 3),
                torsoToShoulder: round(torsoLengthCm / Math.max(shoulderWidthCm, 1), 3),
                depthToChestWidth: round(chestDepthCm / Math.max(chestFrontWidthCm, 1), 3)
            },
            confidence: round(clamp(poseConfidence, 0, 1), 2),
            warnings
        };

        onProgress('Perfil corporal estimado.');
        return profile;
    }
}
