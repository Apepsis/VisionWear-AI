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
        this.clothingOutline = null;
        this.lastFrameTime = 0;
        this.targetFps = 30;

        this.handleResize = this.handleResize.bind(this);
    }

    setupRendering() {
        const THREE = this.THREE;
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.scene = new THREE.Scene();

        // Cámara ortográfica: 1 unidad de Three.js = 1 píxel CSS.
        // Esto evita conversiones arbitrarias entre pose y escena 3D.
        this.camera = new THREE.OrthographicCamera(
            -width / 2,
            width / 2,
            height / 2,
            -height / 2,
            0.1,
            100
        );
        this.camera.position.z = 10;

        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true
        });

        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(width, height);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.domElement.id = 'three-overlay';
        document.body.appendChild(this.renderer.domElement);

        window.addEventListener('resize', this.handleResize);
    }

    handleResize() {
        if (!this.camera || !this.renderer) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.left = -width / 2;
        this.camera.right = width / 2;
        this.camera.top = height / 2;
        this.camera.bottom = -height / 2;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
    }

    buildMockClothing() {
        const THREE = this.THREE;

        // Silueta normalizada de camiseta. Después se escala en píxeles
        // según el ancho de hombros y la longitud real del torso.
        const shape = new THREE.Shape();
        shape.moveTo(-0.32, 0.50);
        shape.lineTo(-0.58, 0.38);
        shape.lineTo(-0.48, 0.10);
        shape.lineTo(-0.37, 0.18);
        shape.lineTo(-0.34, -0.50);
        shape.lineTo(0.34, -0.50);
        shape.lineTo(0.37, 0.18);
        shape.lineTo(0.48, 0.10);
        shape.lineTo(0.58, 0.38);
        shape.lineTo(0.32, 0.50);
        shape.lineTo(0.18, 0.43);
        shape.lineTo(-0.18, 0.43);
        shape.closePath();

        const geometry = new THREE.ShapeGeometry(shape);
        const material = new THREE.MeshBasicMaterial({
            color: 0x27d3ff,
            transparent: true,
            opacity: 0.28,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false
        });

        this.clothingModel = new THREE.Mesh(geometry, material);
        this.clothingModel.renderOrder = 2;
        this.clothingModel.visible = false;
        this.scene.add(this.clothingModel);

        const edgeGeometry = new THREE.EdgesGeometry(geometry);
        const edgeMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.9,
            depthTest: false
        });

        this.clothingOutline = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        this.clothingOutline.renderOrder = 3;
        this.clothingOutline.visible = false;
        this.scene.add(this.clothingOutline);
    }

    // Convierte una coordenada de MoveNet (píxeles del video original)
    // a píxeles de pantalla considerando object-fit: cover y espejo horizontal.
    videoPointToScreen(point, videoElement) {
        const videoWidth = videoElement.videoWidth;
        const videoHeight = videoElement.videoHeight;
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        if (!videoWidth || !videoHeight) return null;

        const coverScale = Math.max(
            screenWidth / videoWidth,
            screenHeight / videoHeight
        );

        const renderedWidth = videoWidth * coverScale;
        const renderedHeight = videoHeight * coverScale;
        const cropX = (renderedWidth - screenWidth) / 2;
        const cropY = (renderedHeight - screenHeight) / 2;

        const unmirroredX = (point.x * coverScale) - cropX;
        const screenX = screenWidth - unmirroredX;
        const screenY = (point.y * coverScale) - cropY;

        return { x: screenX, y: screenY };
    }

    screenPointToWorld(point) {
        return {
            x: point.x - (window.innerWidth / 2),
            y: (window.innerHeight / 2) - point.y
        };
    }

    distance(a, b) {
        return Math.hypot(b.x - a.x, b.y - a.y);
    }

    midpoint(a, b) {
        return {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2
        };
    }

    updateGarmentFromPose(pose, videoElement) {
        if (!pose?.keypoints || !this.clothingModel || !this.clothingOutline) {
            return;
        }

        const find = name => pose.keypoints.find(k => k.name === name);

        const leftShoulderRaw = find('left_shoulder');
        const rightShoulderRaw = find('right_shoulder');
        const leftHipRaw = find('left_hip');
        const rightHipRaw = find('right_hip');

        const shouldersReliable =
            leftShoulderRaw?.score > 0.45 &&
            rightShoulderRaw?.score > 0.45;

        if (!shouldersReliable) {
            this.clothingModel.visible = false;
            this.clothingOutline.visible = false;
            return;
        }

        const leftShoulder = this.videoPointToScreen(leftShoulderRaw, videoElement);
        const rightShoulder = this.videoPointToScreen(rightShoulderRaw, videoElement);

        if (!leftShoulder || !rightShoulder) return;

        const shoulderMid = this.midpoint(leftShoulder, rightShoulder);
        const shoulderWidth = this.distance(leftShoulder, rightShoulder);

        const hipsReliable = leftHipRaw?.score > 0.35 && rightHipRaw?.score > 0.35;

        let torsoCenterScreen;
        let torsoHeight;

        if (hipsReliable) {
            const leftHip = this.videoPointToScreen(leftHipRaw, videoElement);
            const rightHip = this.videoPointToScreen(rightHipRaw, videoElement);
            const hipMid = this.midpoint(leftHip, rightHip);

            const shoulderToHip = this.distance(shoulderMid, hipMid);
            torsoHeight = Math.max(shoulderToHip * 1.18, shoulderWidth * 0.95);
            torsoCenterScreen = this.midpoint(shoulderMid, hipMid);

            // La camiseta empieza ligeramente por encima de la línea de hombros.
            torsoCenterScreen.y += torsoHeight * 0.03;
        } else {
            torsoHeight = shoulderWidth * 1.25;
            torsoCenterScreen = {
                x: shoulderMid.x,
                y: shoulderMid.y + torsoHeight * 0.47
            };
        }

        // Ancho visual de la camiseta incluyendo mangas.
        const garmentWidth = shoulderWidth * 1.45;
        const centerWorld = this.screenPointToWorld(torsoCenterScreen);
        const leftWorld = this.screenPointToWorld(leftShoulder);
        const rightWorld = this.screenPointToWorld(rightShoulder);

        const shoulderAngle = Math.atan2(
            rightWorld.y - leftWorld.y,
            rightWorld.x - leftWorld.x
        );

        for (const object of [this.clothingModel, this.clothingOutline]) {
            object.visible = true;
            object.position.set(centerWorld.x, centerWorld.y, 0);
            object.rotation.z = shoulderAngle;
            object.scale.set(garmentWidth, torsoHeight, 1);
        }
    }

    async renderLoop(videoElement, timestamp = 0) {
        const frameInterval = 1000 / this.targetFps;

        if (timestamp - this.lastFrameTime >= frameInterval) {
            this.lastFrameTime = timestamp;

            try {
                const pose = await this.poseEstimator.estimatePose(videoElement);
                this.updateGarmentFromPose(pose, videoElement);
            } catch (error) {
                console.error('Error durante la detección de pose:', error);
            }
        }

        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(nextTimestamp => this.renderLoop(videoElement, nextTimestamp));
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

            loadingIndicator.textContent = 'Cámara activa. Cargando detector de postura...';
            const { PoseEstimator } = await import('./poseDetection.js?v=7');

            loadingIndicator.textContent = 'Cargando motor gráfico...';
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
