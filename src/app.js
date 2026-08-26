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

    setupRendering() {
        const THREE = this.THREE;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );

        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true
        });

        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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

            if (pose?.keypoints && this.clothingModel) {
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
                    const scale = Math.max((shoulderDist / 100) * 1.5, 0.1);
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
            // Primero solicitamos la cámara para que el navegador muestre el permiso.
            await app.cameraManager.initialize();

            loadingIndicator.textContent = 'Cámara activa. Cargando detector de postura...';
            const { PoseEstimator } = await import('./poseDetection.js?v=6');

            loadingIndicator.textContent = 'Cargando motor 3D...';
            const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');

            app.THREE = THREE;
            app.poseEstimator = new PoseEstimator();

            app.setupRendering();
            app.buildMockClothing();

            loadingIndicator.textContent = 'Inicializando MoveNet...';
            await app.poseEstimator.initialize();

            app.renderLoop(app.cameraManager.videoElement);

            loadingIndicator.textContent = 'VisionWear listo.';
            uiOverlay.style.opacity = '0';
            setTimeout(() => {
                uiOverlay.style.display = 'none';
            }, 500);
        } catch (error) {
            console.error('Error al iniciar VisionWear:', error);
            loadingIndicator.style.display = 'none';
            errorMessage.style.display = 'block';
            errorMessage.innerText = error?.message || String(error) || 'No se pudo iniciar VisionWear.';
            startButton.disabled = false;
            startButton.textContent = 'Permitir Cámara e Iniciar';
        }
    });
}
