function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function captureVideoFrame(video, fileName) {
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        throw new Error('La cámara todavía no está lista para el escaneo 360°.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
            result => result ? resolve(result) : reject(new Error('No se pudo capturar una vista del giro.')),
            'image/jpeg',
            0.92
        );
    });

    return new File([blob], fileName, { type: 'image/jpeg' });
}

export class TurnScanController {
    constructor(videoElement) {
        this.video = videoElement;
        this.overlay = null;
        this.progress = null;
        this.angleLabel = null;
        this.cue = null;
        this.timer = null;
        this.cancelled = false;
    }

    ensureOverlay() {
        if (this.overlay) return;

        const root = document.createElement('div');
        root.className = 'turn-scan-overlay';
        root.hidden = true;
        root.innerHTML = `
            <div class="turn-scan-card">
                <button type="button" class="turn-scan-cancel" aria-label="Cancelar">×</button>
                <p class="eyebrow">Guided 360 scan</p>
                <h2>Gira lentamente una vuelta completa</h2>
                <p class="turn-scan-help">Mantén todo el cuerpo dentro del encuadre, pies relativamente quietos y brazos separados unos centímetros del torso.</p>
                <div class="turn-scan-ring">
                    <div class="turn-scan-person">◉</div>
                    <div class="turn-scan-arrow">↻</div>
                    <span class="turn-scan-angle">0°</span>
                </div>
                <strong class="turn-scan-cue">Prepárate</strong>
                <div class="turn-scan-progress"><span></span></div>
                <small class="turn-scan-timer">3</small>
                <div class="turn-scan-checkpoints">
                    <span data-step="front">Frente</span>
                    <span data-step="right">Lateral</span>
                    <span data-step="back">Espalda</span>
                    <span data-step="left">Lateral</span>
                </div>
            </div>
        `;
        document.body.appendChild(root);
        this.overlay = root;
        this.progress = root.querySelector('.turn-scan-progress span');
        this.angleLabel = root.querySelector('.turn-scan-angle');
        this.cue = root.querySelector('.turn-scan-cue');
        this.timer = root.querySelector('.turn-scan-timer');
        root.querySelector('.turn-scan-cancel')?.addEventListener('click', () => {
            this.cancelled = true;
        });
    }

    setCheckpoint(name, active = true) {
        const item = this.overlay?.querySelector(`[data-step="${name}"]`);
        if (item) item.classList.toggle('captured', active);
    }

    async countdown(seconds = 3) {
        for (let remaining = seconds; remaining > 0; remaining -= 1) {
            if (this.cancelled) throw new Error('Escaneo 360° cancelado.');
            this.timer.textContent = String(remaining);
            this.cue.textContent = 'Colócate de frente y no te muevas todavía';
            await sleep(1000);
        }
        this.timer.textContent = 'GO';
        await sleep(350);
    }

    async start({ durationMs = 12000, onProgress = () => {} } = {}) {
        this.ensureOverlay();
        if (!this.video || this.video.readyState < 2) {
            throw new Error('Primero inicia la cámara.');
        }

        this.cancelled = false;
        this.overlay.hidden = false;
        this.progress.style.width = '0%';
        this.angleLabel.textContent = '0°';
        ['front', 'right', 'back', 'left'].forEach(name => this.setCheckpoint(name, false));

        try {
            onProgress('Preparando escaneo 360°...');
            await this.countdown(3);

            const captures = {};
            captures.front = await captureVideoFrame(this.video, 'visionwear-360-front.jpg');
            this.setCheckpoint('front');
            onProgress('Frontal capturada. Empieza a girar lentamente hacia tu derecha.');

            const checkpoints = [
                { ratio: 0.25, key: 'right', fileName: 'visionwear-360-right.jpg', cue: 'Perfil derecho · sigue girando' },
                { ratio: 0.50, key: 'back', fileName: 'visionwear-360-back.jpg', cue: 'Espalda · sigue girando' },
                { ratio: 0.75, key: 'left', fileName: 'visionwear-360-left.jpg', cue: 'Perfil izquierdo · completa la vuelta' }
            ];
            const captured = new Set();
            const startTime = performance.now();

            while (true) {
                if (this.cancelled) throw new Error('Escaneo 360° cancelado.');
                const elapsed = performance.now() - startTime;
                const ratio = Math.min(elapsed / durationMs, 1);
                const angle = Math.round(ratio * 360);
                this.progress.style.width = `${Math.round(ratio * 100)}%`;
                this.angleLabel.textContent = `${angle}°`;
                this.timer.textContent = `${Math.max(0, Math.ceil((durationMs - elapsed) / 1000))} s`;

                for (const checkpoint of checkpoints) {
                    if (ratio >= checkpoint.ratio && !captured.has(checkpoint.key)) {
                        captures[checkpoint.key] = await captureVideoFrame(this.video, checkpoint.fileName);
                        captured.add(checkpoint.key);
                        this.setCheckpoint(checkpoint.key);
                        this.cue.textContent = checkpoint.cue;
                        onProgress(checkpoint.cue);
                    }
                }

                if (ratio >= 1) break;
                await sleep(45);
            }

            this.progress.style.width = '100%';
            this.angleLabel.textContent = '360°';
            this.cue.textContent = 'Escaneo completado';
            this.timer.textContent = '✓';
            onProgress('Giro completo capturado. Preparando frontal, lateral y posterior.');
            await sleep(650);

            return {
                front: captures.front,
                side: captures.right || captures.left,
                back: captures.back,
                alternateSide: captures.left || null,
                all: captures
            };
        } finally {
            this.overlay.hidden = true;
        }
    }
}

export function assignFileToInput(input, file) {
    if (!input || !file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
}
