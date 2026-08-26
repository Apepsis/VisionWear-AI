const BODY_PIX_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/body-pix@2.2.0/dist/body-pix.min.js';

const FRONT_OCCLUDER_PARTS = new Set([
    2, 3, 4, 5,
    6, 7, 8, 9,
    10, 11
]);

async function loadScriptOnce(src, globalName) {
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
        script.addEventListener('error', () => reject(new Error('No se pudo cargar BodyPix para oclusión.')), { once: true });
        document.head.appendChild(script);
    });
}

export class OcclusionManager {
    constructor(videoElement, { targetFps = 8 } = {}) {
        this.video = videoElement;
        this.targetFps = targetFps;
        this.model = null;
        this.enabled = false;
        this.running = false;
        this.lastFrameTime = 0;
        this.onStatus = () => {};

        this.canvas = document.createElement('canvas');
        this.canvas.id = 'occlusion-canvas';
        this.canvas.setAttribute('aria-hidden', 'true');
        document.body.appendChild(this.canvas);
        this.context = this.canvas.getContext('2d', { alpha: true });

        this.maskCanvas = document.createElement('canvas');
        this.maskContext = this.maskCanvas.getContext('2d', { alpha: true });

        this.resize = this.resize.bind(this);
        this.loop = this.loop.bind(this);
        window.addEventListener('resize', this.resize);
        this.resize();
    }

    resize() {
        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        if (this.canvas.width !== width) this.canvas.width = width;
        if (this.canvas.height !== height) this.canvas.height = height;
    }

    async initialize(onStatus = () => {}) {
        this.onStatus = onStatus;
        if (this.model) return;

        onStatus('Cargando human parsing para brazos y manos...');
        await loadScriptOnce(BODY_PIX_URL, 'bodyPix');
        if (!globalThis.bodyPix) throw new Error('BodyPix no quedó disponible.');

        onStatus('Inicializando oclusión corporal...');
        this.model = await globalThis.bodyPix.load({
            architecture: 'MobileNetV1',
            outputStride: 16,
            multiplier: 0.50,
            quantBytes: 2
        });
    }

    async setEnabled(value, onStatus = () => {}) {
        this.onStatus = onStatus;
        this.enabled = Boolean(value);

        if (!this.enabled) {
            this.clear();
            onStatus('Oclusión desactivada.');
            return;
        }

        if (!this.video || this.video.readyState < 2) {
            this.enabled = false;
            throw new Error('Primero inicia la cámara.');
        }

        await this.initialize(onStatus);
        onStatus('Oclusión de brazos y manos activa.');

        if (!this.running) {
            this.running = true;
            requestAnimationFrame(this.loop);
        }
    }

    createPartMask(segmentation) {
        const { width, height, data } = segmentation;
        if (this.maskCanvas.width !== width) this.maskCanvas.width = width;
        if (this.maskCanvas.height !== height) this.maskCanvas.height = height;

        const image = this.maskContext.createImageData(width, height);
        const pixels = image.data;

        for (let index = 0; index < data.length; index += 1) {
            const partId = data[index];
            if (!FRONT_OCCLUDER_PARTS.has(partId)) continue;
            const offset = index * 4;
            pixels[offset] = 255;
            pixels[offset + 1] = 255;
            pixels[offset + 2] = 255;
            pixels[offset + 3] = 255;
        }

        this.maskContext.clearRect(0, 0, width, height);
        this.maskContext.putImageData(image, 0, 0);
    }

    drawCompositedOccluders(segmentation) {
        const videoWidth = this.video.videoWidth;
        const videoHeight = this.video.videoHeight;
        const screenWidth = this.canvas.width;
        const screenHeight = this.canvas.height;
        if (!videoWidth || !videoHeight) return;

        this.createPartMask(segmentation);

        const coverScale = Math.max(screenWidth / videoWidth, screenHeight / videoHeight);
        const drawWidth = videoWidth * coverScale;
        const drawHeight = videoHeight * coverScale;
        const drawX = (screenWidth - drawWidth) / 2;
        const drawY = (screenHeight - drawHeight) / 2;

        const ctx = this.context;
        ctx.clearRect(0, 0, screenWidth, screenHeight);
        ctx.save();
        ctx.translate(screenWidth, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(this.video, drawX, drawY, drawWidth, drawHeight);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.filter = 'blur(0.7px)';
        ctx.drawImage(this.maskCanvas, drawX, drawY, drawWidth, drawHeight);
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';
    }

    async processFrame() {
        if (!this.enabled || !this.model || this.video.readyState < 2) return;
        const segmentation = await this.model.segmentPersonParts(this.video, {
            flipHorizontal: false,
            internalResolution: 'low',
            segmentationThreshold: 0.55,
            maxDetections: 1,
            scoreThreshold: 0.25,
            nmsRadius: 20
        });
        this.drawCompositedOccluders(segmentation);
    }

    async loop(timestamp) {
        if (!this.running) return;

        const interval = 1000 / this.targetFps;
        if (this.enabled && timestamp - this.lastFrameTime >= interval) {
            this.lastFrameTime = timestamp;
            try {
                await this.processFrame();
            } catch (error) {
                console.warn('Occlusion frame error:', error);
                this.onStatus('Oclusión temporalmente inestable; reduciendo carga.');
            }
        }

        requestAnimationFrame(this.loop);
    }

    clear() {
        this.context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    destroy() {
        this.running = false;
        this.enabled = false;
        window.removeEventListener('resize', this.resize);
        this.canvas.remove();
        this.model?.dispose?.();
        this.model = null;
    }
}
