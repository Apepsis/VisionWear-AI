import { CameraManager } from './camera.js';

export class App {
    constructor() {
        this.cameraManager = new CameraManager('webcam-video');
        this.poseEstimator = null;
        this.THREE = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clothingModel = null;
    }

    async start() {
        // IMPORTANTE: pedir acceso a la cámara primero.
        // Así un error al cargar TensorFlow/Three.js no impide que Chrome
        // muestre el diálogo de permiso.
        const videoElement = await this.cameraManager.initialize();

        const [{ PoseEstimator }, THREE] = await Promise.all([
            import('./poseDetection.js'),
            import('https://esm.sh/three@0.180.0')
        ]);

        this.THREE = THREE;
        this.poseEstimator = new PoseEstimator();

        this.setupRendering();
        this.buildMockClothing();
        await this.poseEstimator.initialize();
        this.renderLoop(videoElement);
    }

    setupRendering() {
        const THREE = this.THREE;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.domElement.id = 'three-overlay';
        document.body.appendChild(this.renderer.domElement);
        this.camera.position.z = 5;
    }

    buildMockClothing() {
        const THREE = this.THREE;
        const geometry = new THREE.BoxGeometry(1.5, 2, 0.5);
        const material = new THREE.MeshNormalMaterial({ wireframe: true });

        this.clothingModel = new THREE.Mesh(geometry, material);
        this.scene.add(this.clothingModel);
    }

    async renderLoop(videoElement) {
        try {
            const pose = await this.poseEstimator.estimatePose(videoElement);

            if (pose && pose.keypoints && this.clothingModel) {
                const leftShoulder = pose.keypoints.find(k => k.name === 'left_shoulder');
                const rightShoulder = pose.keypoints.find(k => k.name === 'right_shoulder');

                if (leftShoulder?.score > 0.5 && rightShoulder?.score > 0.5) {
                    const midX = (leftShoulder.x + rightShoulder.x) / 2;
                    const midY = (leftShoulder.y + rightShoulder.y) / 2;

                    const ndcX = (midX / videoElement.videoWidth) * 2 - 1;
                    const ndcY = -(midY / videoElement.videoHeight) * 2 + 1;

                    this.clothingModel.position.x = ndcX * 5;
                    this.clothingModel.position.y = ndcY * 5;

                    const shoulderDist = Math.abs(rightShoulder.x - leftShoulder.x);
                    const scale = (shoulderDist / 100) * 1.5;
                    this.clothingModel.scale.set(scale, scale, scale);
                }
            }

            this.renderer.render(this.scene, this.camera);
        } catch (error) {
            console.error('Error durante la detección de pose:', error);
        }

        requestAnimationFrame(() => this.renderLoop(videoElement));
    }
}

const startButton = document.getElementById('start-button');
const uiOverlay = document.getElementById('ui-overlay');
const loadingIndicator = document.getElementById('loading-indicator');
const errorMessage = document.getElementById('error-message');

if (!startButton) {
    console.error('No se encontró #start-button');
} else {
    const app = new App();

    startButton.addEventListener('click', async () => {
        startButton.disabled = true;
        startButton.textContent = 'Solicitando cámara...';
        loadingIndicator.style.display = 'block';
        loadingIndicator.textContent = 'Esperando permiso de cámara...';
        errorMessage.style.display = 'none';

        try {
            await app.cameraManager.initialize();

            // En este punto Chrome ya tuvo que pedir/validar el permiso.
            loadingIndicator.textContent = 'Cámara activa. Cargando modelos de IA y 3D...';

            const [{ PoseEstimator }, THREE] = await Promise.all([
                import('./poseDetection.js'),
                import('https://esm.sh/three@0.180.0')
            ]);

            app.THREE = THREE;
            app.poseEstimator = new PoseEstimator();
            app.setupRendering();
            app.buildMockClothing();
            await app.poseEstimator.initialize();
            app.renderLoop(app.cameraManager.videoElement);

            uiOverlay.style.opacity = '0';
            setTimeout(() => {
                uiOverlay.style.display = 'none';
            }, 500);
        } catch (error) {
            console.error('Error al iniciar VisionWear:', error);
            loadingIndicator.style.display = 'none';
            errorMessage.style.display = 'block';
            errorMessage.innerText = error?.message || 'No se pudo iniciar VisionWear.';
            startButton.disabled = false;
            startButton.textContent = 'Permitir Cámara e Iniciar';
        }
    });
}
