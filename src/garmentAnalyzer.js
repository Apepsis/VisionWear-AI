function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function round(value, decimals = 1) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function colorDistance(r1, g1, b1, r2, g2, b2) {
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

export class GarmentAnalyzer {
    async fileToImage(file) {
        if (!file?.type?.startsWith('image/')) {
            throw new Error('Sube una imagen válida de la prenda.');
        }

        const url = URL.createObjectURL(file);
        try {
            return await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('No se pudo leer la imagen de la prenda.'));
                image.src = url;
            });
        } finally {
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    }

    drawScaled(image, maxSide = 900) {
        const sourceWidth = image.naturalWidth || image.width;
        const sourceHeight = image.naturalHeight || image.height;
        const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        return { canvas, context, width, height, scale };
    }

    averageCornerColor(data, width, height) {
        const samples = [];
        const radius = Math.max(2, Math.round(Math.min(width, height) * 0.025));
        const corners = [
            [0, 0],
            [Math.max(0, width - radius), 0],
            [0, Math.max(0, height - radius)],
            [Math.max(0, width - radius), Math.max(0, height - radius)]
        ];

        for (const [startX, startY] of corners) {
            for (let y = startY; y < Math.min(height, startY + radius); y += 1) {
                for (let x = startX; x < Math.min(width, startX + radius); x += 1) {
                    const index = (y * width + x) * 4;
                    samples.push([data[index], data[index + 1], data[index + 2]]);
                }
            }
        }

        if (!samples.length) return [255, 255, 255];
        return [0, 1, 2].map(channel =>
            samples.reduce((sum, sample) => sum + sample[channel], 0) / samples.length
        );
    }

    buildMask(imageData, width, height) {
        const source = imageData.data;
        const pixels = width * height;
        let transparentPixels = 0;

        for (let i = 3; i < source.length; i += 4) {
            if (source[i] < 245) transparentPixels += 1;
        }

        const hasUsefulAlpha = (transparentPixels / pixels) > 0.01;
        const background = this.averageCornerColor(source, width, height);
        const mask = new Uint8Array(pixels);
        let foregroundPixels = 0;

        for (let pixel = 0; pixel < pixels; pixel += 1) {
            const index = pixel * 4;
            const alpha = source[index + 3];
            let foreground = false;

            if (hasUsefulAlpha) {
                foreground = alpha > 45;
            } else {
                const distance = colorDistance(
                    source[index], source[index + 1], source[index + 2],
                    background[0], background[1], background[2]
                );
                foreground = distance > 42;
            }

            if (foreground) {
                mask[pixel] = 1;
                foregroundPixels += 1;
            }
        }

        if (foregroundPixels < pixels * 0.025) {
            throw new Error('No pude separar la prenda del fondo. Usa un PNG transparente o una foto con fondo uniforme y contrastante.');
        }

        return {
            mask,
            method: hasUsefulAlpha ? 'alpha' : 'background-difference',
            background,
            foregroundRatio: foregroundPixels / pixels
        };
    }

    getBounds(mask, width, height) {
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        let count = 0;

        for (let y = 0; y < height; y += 1) {
            const row = y * width;
            for (let x = 0; x < width; x += 1) {
                if (!mask[row + x]) continue;
                count += 1;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }

        if (maxX < minX || maxY < minY) {
            throw new Error('No se encontró una silueta de prenda utilizable.');
        }

        return {
            minX,
            minY,
            maxX,
            maxY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
            count
        };
    }

    getRowSpan(mask, width, height, y, band = 4) {
        const centerY = clamp(Math.round(y), 0, height - 1);
        let best = null;

        for (let yy = Math.max(0, centerY - band); yy <= Math.min(height - 1, centerY + band); yy += 1) {
            let minX = width;
            let maxX = -1;
            const row = yy * width;

            for (let x = 0; x < width; x += 1) {
                if (!mask[row + x]) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
            }

            if (maxX >= minX) {
                const spanWidth = maxX - minX + 1;
                if (!best || spanWidth > best.width) {
                    best = { minX, maxX, width: spanWidth, y: yy };
                }
            }
        }

        return best;
    }

    createCutout(canvas, imageData, maskInfo, bounds) {
        const { mask } = maskInfo;
        const { width, height } = canvas;
        const output = document.createElement('canvas');
        output.width = bounds.width;
        output.height = bounds.height;
        const context = output.getContext('2d');
        const cutout = context.createImageData(bounds.width, bounds.height);

        for (let y = 0; y < bounds.height; y += 1) {
            for (let x = 0; x < bounds.width; x += 1) {
                const sourceX = bounds.minX + x;
                const sourceY = bounds.minY + y;
                const sourcePixel = sourceY * width + sourceX;
                const sourceIndex = sourcePixel * 4;
                const targetIndex = (y * bounds.width + x) * 4;

                cutout.data[targetIndex] = imageData.data[sourceIndex];
                cutout.data[targetIndex + 1] = imageData.data[sourceIndex + 1];
                cutout.data[targetIndex + 2] = imageData.data[sourceIndex + 2];
                cutout.data[targetIndex + 3] = mask[sourcePixel] ? imageData.data[sourceIndex + 3] || 255 : 0;
            }
        }

        context.putImageData(cutout, 0, 0);
        return output.toDataURL('image/png');
    }

    async analyze({
        file,
        garmentType = 'tshirt',
        referenceType = 'length',
        referenceCm,
        stretch = 'none',
        onProgress = () => {}
    }) {
        const numericReference = Number(referenceCm);
        if (!Number.isFinite(numericReference) || numericReference <= 5 || numericReference > 250) {
            throw new Error('Ingresa una medida real de referencia válida en centímetros.');
        }

        onProgress('Leyendo imagen de la prenda...');
        const image = await this.fileToImage(file);
        const drawn = this.drawScaled(image);
        const imageData = drawn.context.getImageData(0, 0, drawn.width, drawn.height);

        onProgress('Separando la prenda del fondo...');
        const maskInfo = this.buildMask(imageData, drawn.width, drawn.height);
        const bounds = this.getBounds(maskInfo.mask, drawn.width, drawn.height);

        const rowAt = ratio => bounds.minY + (bounds.height * ratio);
        const chestSpan = this.getRowSpan(maskInfo.mask, drawn.width, drawn.height, rowAt(0.43), 5);
        const waistSpan = this.getRowSpan(maskInfo.mask, drawn.width, drawn.height, rowAt(0.70), 5);
        const hemSpan = this.getRowSpan(maskInfo.mask, drawn.width, drawn.height, rowAt(0.92), 4);

        if (!chestSpan || !waistSpan || !hemSpan) {
            throw new Error('No pude medir el contorno de la prenda. Usa una imagen frontal, extendida y sin pliegues fuertes.');
        }

        let referencePixels;
        if (referenceType === 'chest') {
            referencePixels = chestSpan.width;
        } else {
            referencePixels = bounds.height;
            referenceType = 'length';
        }

        const cmPerPx = numericReference / Math.max(referencePixels, 1);
        const chestFlatCm = chestSpan.width * cmPerPx;
        const waistFlatCm = waistSpan.width * cmPerPx;
        const hemFlatCm = hemSpan.width * cmPerPx;
        const lengthCm = bounds.height * cmPerPx;
        const maxWidthCm = bounds.width * cmPerPx;
        const stretchMap = { none: 0, low: 0.04, medium: 0.08, high: 0.14 };
        const stretchPercent = stretchMap[stretch] ?? 0;

        onProgress('Calculando proporciones y escala...');
        const cutoutDataUrl = this.createCutout(drawn.canvas, imageData, maskInfo, bounds);
        const warnings = [];
        if (maskInfo.method !== 'alpha') {
            warnings.push('El fondo fue eliminado por contraste de color. Un PNG transparente produciría una silueta más fiable.');
        }
        if (bounds.width / drawn.width > 0.95 || bounds.height / drawn.height > 0.95) {
            warnings.push('La prenda toca el borde de la imagen; algunas medidas pueden estar recortadas.');
        }

        const profile = {
            version: 1,
            createdAt: new Date().toISOString(),
            source: 'single-image+known-reference',
            garmentType,
            reference: {
                type: referenceType,
                valueCm: round(numericReference),
                cmPerPx: round(cmPerPx, 4)
            },
            stretch: {
                level: stretch,
                fraction: stretchPercent
            },
            measurements: {
                chestFlatCm: round(chestFlatCm),
                chestCircumferenceCm: round(chestFlatCm * 2),
                waistFlatCm: round(waistFlatCm),
                waistCircumferenceCm: round(waistFlatCm * 2),
                hemFlatCm: round(hemFlatCm),
                lengthCm: round(lengthCm),
                maxWidthCm: round(maxWidthCm)
            },
            ratios: {
                waistToChest: round(waistFlatCm / Math.max(chestFlatCm, 1), 3),
                hemToChest: round(hemFlatCm / Math.max(chestFlatCm, 1), 3),
                lengthToChest: round(lengthCm / Math.max(chestFlatCm, 1), 3)
            },
            extraction: {
                method: maskInfo.method,
                foregroundRatio: round(maskInfo.foregroundRatio, 3),
                imageWidth: drawn.width,
                imageHeight: drawn.height,
                bounds
            },
            cutoutDataUrl,
            confidence: round(maskInfo.method === 'alpha' ? 0.88 : 0.66, 2),
            warnings
        };

        onProgress('Prenda medida y lista para calcular el ajuste.');
        return profile;
    }
}
