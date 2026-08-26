export class CameraManager {
    constructor(videoElementId) {
        this.videoElement = document.getElementById(videoElementId);
        this.stream = null;
    }

    async initialize() {
        if (!this.videoElement) {
            throw new Error('No se encontró el elemento de video para la cámara.');
        }

        // getUserMedia solo funciona en contextos seguros: HTTPS o localhost.
        const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
        if (!window.isSecureContext && !isLocalhost) {
            throw new Error('La cámara requiere HTTPS o ejecutar la aplicación desde localhost.');
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Este navegador no soporta navigator.mediaDevices.getUserMedia().');
        }

        // Si había una cámara activa, la detenemos antes de solicitar una nueva.
        this.stop();

        const constraints = {
            video: {
                facingMode: 'user',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };

        try {
            // Esta llamada es la que hace que el navegador muestre el diálogo
            // para permitir o bloquear el acceso a la cámara.
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (error) {
            const messages = {
                NotAllowedError: 'Permiso de cámara denegado. Habilítalo desde la configuración del sitio.',
                PermissionDeniedError: 'Permiso de cámara denegado. Habilítalo desde la configuración del sitio.',
                NotFoundError: 'No se encontró ninguna cámara disponible.',
                DevicesNotFoundError: 'No se encontró ninguna cámara disponible.',
                NotReadableError: 'La cámara está siendo usada por otra aplicación o no puede abrirse.',
                TrackStartError: 'La cámara está siendo usada por otra aplicación o no puede abrirse.',
                OverconstrainedError: 'La cámara disponible no cumple con la configuración solicitada.',
                SecurityError: 'El navegador bloqueó el acceso a la cámara por seguridad.'
            };

            throw new Error(messages[error.name] || `No se pudo abrir la cámara: ${error.message}`);
        }

        this.videoElement.srcObject = this.stream;
        this.videoElement.autoplay = true;
        this.videoElement.muted = true;
        this.videoElement.playsInline = true;

        if (this.videoElement.readyState < HTMLMediaElement.HAVE_METADATA) {
            await new Promise((resolve, reject) => {
                const onLoaded = () => {
                    cleanup();
                    resolve();
                };
                const onError = () => {
                    cleanup();
                    reject(new Error('No se pudo cargar el video de la cámara.'));
                };
                const cleanup = () => {
                    this.videoElement.removeEventListener('loadedmetadata', onLoaded);
                    this.videoElement.removeEventListener('error', onError);
                };

                this.videoElement.addEventListener('loadedmetadata', onLoaded, { once: true });
                this.videoElement.addEventListener('error', onError, { once: true });
            });
        }

        await this.videoElement.play();
        return this.videoElement;
    }

    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        if (this.videoElement && this.videoElement.srcObject) {
            this.videoElement.srcObject = null;
        }
    }
}
