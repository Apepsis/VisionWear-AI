import { CameraManager } from './camera.js';
import { GarmentSmoother } from './filters.js';
import { BodyProfileAnalyzer } from './bodyProfile.js';

const PROFILE_STORAGE_KEY = 'visionwear.bodyProfile.v1';

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

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
        this.customGarmentTexture = null;
        this.customGarmentUrl = null;
        this.usingCustomGarment = false;
        this.lastFrameTime = 0;
        this.targetFps = 30;
        this.garmentSmoother = new GarmentSmoother();
        this.bodyProfileAnalyzer = null;
        this.bodyProfile = this.loadSavedBodyProfile();
        this.currentGarmentColor = 0x27d3ff;

        this.handleResize = this.handleResize.bind(this);
    }

    loadSavedBodyProfile() {
        try {
            const saved = localStorage.getItem(PROFILE_STORAGE_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch (error) {
            console.warn('No se pudo leer el perfil corporal guardado:', error);
            return null;
        }
    }

    saveBodyProfile(profile) {
        this.bodyProfile = profile;
        try {
            localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
        } catch (error) {
            console.warn('No se pudo guardar el perfil corporal:', error);
        }

        if (this.THREE && !this.usingCustomGarment) {
            this.buildDefaultGarment();
        }
    }

    clearBodyProfile() {
        this.bodyProfile = null;
        localStorage.removeItem(PROFILE_STORAGE_KEY);
        if (this.THREE && !this.usingCustomGarment) {
            this.buildDefaultGarment();
        }
    }

    setupRendering() {
        const THREE = this.THREE;
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.scene = new THREE.Scene();
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

    disposeGarment() {
        if (this.clothingModel) {
            this.scene?.remove(this.clothingModel);
            this.clothingModel.geometry?.dispose?.();
            if (Array.isArray(this.clothingModel.material)) {
                this.clothingModel.material.forEach(material => material.dispose?.());
            } else {
                this.clothingModel.material?.dispose?.();
            }
            this.clothingModel = null;
        }

        if (this.clothingOutline) {
            this.scene?.remove(this.clothingOutline);
            this.clothingOutline.geometry?.dispose?.();
            this.clothingOutline.material?.dispose?.();
            this.clothingOutline = null;
        }
    }

    buildDefaultGarment() {
        if (!this.THREE || !this.scene) return;
        const THREE = this.THREE;
        this.disposeGarment();
        this.usingCustomGarment = false;

        const waistRatio = clamp(this.bodyProfile?.ratios?.waistToChest ?? 0.86, 0.68, 1.12);
        const bottomHalfWidth = 0.34 * waistRatio;

        const shape = new THREE.Shape();
        shape.moveTo(-0.32, 0.50);
        shape.lineTo(-0.58, 0.38);
        shape.lineTo(-0.48, 0.10);
        shape.lineTo(-0.37, 0.18);
        shape.lineTo(-bottomHalfWidth, -0.50);
        shape.lineTo(bottomHalfWidth, -0.50);
        shape.lineTo(0.37, 0.18);
        shape.lineTo(0.48, 0.10);
        shape.lineTo(0.58, 0.38);
        shape.lineTo(0.32, 0.50);
        shape.lineTo(0.18, 0.43);
        shape.lineTo(-0.18, 0.43);
        shape.closePath();

        const geometry = new THREE.ShapeGeometry(shape);
        const material = new THREE.MeshBasicMaterial({
            color: this.currentGarmentColor,
            transparent: true,
            opacity: 0.48,
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
            opacity: 0.78,
            depthTest: false
        });

        this.clothingOutline = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        this.clothingOutline.renderOrder = 3;
        this.clothingOutline.visible = false;
        this.scene.add(this.clothingOutline);
    }

    setGarmentColor(hexColor) {
        const numeric = Number.parseInt(String(hexColor).replace('#', ''), 16);
        if (!Number.isFinite(numeric)) return;
        this.currentGarmentColor = numeric;

        if (!this.usingCustomGarment && this.clothingModel?.material?.color) {
            this.clothingModel.material.color.setHex(numeric);
        }
    }

    async setCustomGarment(file) {
        if (!this.THREE || !this.scene) throw new Error('El motor gráfico todavía no está listo.');
        if (!file?.type?.startsWith('image/')) throw new Error('La prenda debe ser una imagen PNG/WebP con fondo transparente.');

        const THREE = this.THREE;
        const url = URL.createObjectURL(file);

        try {
            const texture = await new Promise((resolve, reject) => {
                new THREE.TextureLoader().load(url, resolve, undefined, () => reject(new Error('No se pudo cargar la imagen de la prenda.')));
            });

            texture.colorSpace = THREE.SRGBColorSpace;
            this.disposeGarment();

            if (this.customGarmentTexture) this.customGarmentTexture.dispose?.();
            if (this.customGarmentUrl) URL.revokeObjectURL(this.customGarmentUrl);

            this.customGarmentTexture = texture;
            this.customGarmentUrl = url;
            this.usingCustomGarment = true;

            const geometry = new THREE.PlaneGeometry(1, 1);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                opacity: 0.96,
                side: THREE.DoubleSide,
                depthTest: false,
                depthWrite: false
            });

            this.clothingModel = new THREE.Mesh(geometry, material);
            this.clothingModel.renderOrder = 2;
            this.clothingModel.visible = false;
            this.scene.add(this.clothingModel);
        } catch (error) {
            URL.revokeObjectURL(url);
            throw error;
        }
    }

    resetGarment() {
        if (this.customGarmentTexture) {
            this.customGarmentTexture.dispose?.();
            this.customGarmentTexture = null;
        }
        if (this.customGarmentUrl) {
            URL.revokeObjectURL(this.customGarmentUrl);
            this.customGarmentUrl = null;
        }
        this.buildDefaultGarment();
    }

    videoPointToScreen(point, videoElement) {
        const videoWidth = videoElement.videoWidth;
        const videoHeight = videoElement.videoHeight;
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        if (!videoWidth || !videoHeight) return null;

        const coverScale = Math.max(screenWidth / videoWidth, screenHeight / videoHeight);
        const renderedWidth = videoWidth * coverScale;
        const renderedHeight = videoHeight * coverScale;
        const cropX = (renderedWidth - screenWidth) / 2;
        const cropY = (renderedHeight - screenHeight) / 2;

        const unmirroredX = (point.x * coverScale) - cropX;
        return {
            x: screenWidth - unmirroredX,
            y: (point.y * coverScale) - cropY
        };
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

    hideGarment() {
        if (this.clothingModel) this.clothingModel.visible = false;
        if (this.clothingOutline) this.clothingOutline.visible = false;
    }

    profileWidthFactor() {
        const chestToShoulder = this.bodyProfile?.ratios?.chestToShoulder;
        if (!Number.isFinite(chestToShoulder)) return 1.42;
        return clamp(1.18 + (chestToShoulder * 0.28), 1.34, 1.58);
    }

    profileTorsoRatio() {
        const ratio = this.bodyProfile?.ratios?.torsoToShoulder;
        return Number.isFinite(ratio) ? clamp(ratio, 0.85, 1.85) : 1.25;
    }

    updateGarmentFromPose(pose, videoElement, timestamp = performance.now()) {
        if (!pose?.keypoints || !this.clothingModel) return;

        const find = name => pose.keypoints.find(keypoint => keypoint.name === name);
        const leftShoulderRaw = find('left_shoulder');
        const rightShoulderRaw = find('right_shoulder');
        const leftHipRaw = find('left_hip');
        const rightHipRaw = find('right_hip');

        const shouldersReliable =
            (leftShoulderRaw?.score ?? 0) > 0.45 &&
            (rightShoulderRaw?.score ?? 0) > 0.45;

        if (!shouldersReliable) {
            this.hideGarment();
            return;
        }

        const leftShoulder = this.videoPointToScreen(leftShoulderRaw, videoElement);
        const rightShoulder = this.videoPointToScreen(rightShoulderRaw, videoElement);
        if (!leftShoulder || !rightShoulder) return;

        const shoulderMid = this.midpoint(leftShoulder, rightShoulder);
        const shoulderWidth = this.distance(leftShoulder, rightShoulder);
        const hipsReliable =
            (leftHipRaw?.score ?? 0) > 0.32 &&
            (rightHipRaw?.score ?? 0) > 0.32;

        let torsoCenterScreen;
        let torsoHeight;

        if (hipsReliable) {
            const leftHip = this.videoPointToScreen(leftHipRaw, videoElement);
            const rightHip = this.videoPointToScreen(rightHipRaw, videoElement);
            const hipMid = this.midpoint(leftHip, rightHip);
            const liveTorsoHeight = this.distance(shoulderMid, hipMid);
            const profileTorsoHeight = shoulderWidth * this.profileTorsoRatio();

            torsoHeight = this.bodyProfile
                ? ((liveTorsoHeight * 0.72) + (profileTorsoHeight * 0.28)) * 1.12
                : Math.max(liveTorsoHeight * 1.18, shoulderWidth * 0.98);

            torsoCenterScreen = this.midpoint(shoulderMid, hipMid);
            torsoCenterScreen.y += torsoHeight * 0.03;
        } else {
            torsoHeight = shoulderWidth * this.profileTorsoRatio() * 1.12;
            torsoCenterScreen = {
                x: shoulderMid.x,
                y: shoulderMid.y + (torsoHeight * 0.46)
            };
        }

        const garmentWidth = shoulderWidth * this.profileWidthFactor();
        const centerWorld = this.screenPointToWorld(torsoCenterScreen);
        const leftWorld = this.screenPointToWorld(leftShoulder);
        const rightWorld = this.screenPointToWorld(rightShoulder);
        const shoulderAngle = Math.atan2(
            rightWorld.y - leftWorld.y,
            rightWorld.x - leftWorld.x
        );

        const smoothed = this.garmentSmoother.filter({
            x: centerWorld.x,
            y: centerWorld.y,
            width: garmentWidth,
            height: torsoHeight,
            rotation: shoulderAngle
        }, timestamp);

        this.clothingModel.visible = true;
        this.clothingModel.position.set(smoothed.x, smoothed.y, 0);
        this.clothingModel.rotation.z = smoothed.rotation;
        this.clothingModel.scale.set(smoothed.width, smoothed.height, 1);

        if (this.clothingOutline) {
            this.clothingOutline.visible = true;
            this.clothingOutline.position.copy(this.clothingModel.position);
            this.clothingOutline.rotation.copy(this.clothingModel.rotation);
            this.clothingOutline.scale.copy(this.clothingModel.scale);
        }
    }

    async analyzeBodyProfile({ frontFile, sideFile, heightCm, onProgress }) {
        if (!this.poseEstimator) throw new Error('Primero inicia VisionWear para cargar el modelo de postura.');
        if (!this.bodyProfileAnalyzer) {
            this.bodyProfileAnalyzer = new BodyProfileAnalyzer(this.poseEstimator);
        }

        const profile = await this.bodyProfileAnalyzer.analyze({
            frontFile,
            sideFile,
            heightCm,
            onProgress
        });

        this.saveBodyProfile(profile);
        return profile;
    }

    async captureCurrentFrame(fileName = 'visionwear-capture.jpg') {
        const video = this.cameraManager.videoElement;
        if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
            throw new Error('La cámara todavía no está lista para capturar.');
        }

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(result => result ? resolve(result) : reject(new Error('No se pudo capturar la imagen.')), 'image/jpeg', 0.92);
        });

        return new File([blob], fileName, { type: 'image/jpeg' });
    }

    async renderLoop(videoElement, timestamp = 0) {
        const frameInterval = 1000 / this.targetFps;

        if (timestamp - this.lastFrameTime >= frameInterval) {
            this.lastFrameTime = timestamp;

            try {
                const pose = await this.poseEstimator.estimatePose(videoElement);
                this.updateGarmentFromPose(pose, videoElement, timestamp);
            } catch (error) {
                console.error('Error durante la detección de pose:', error);
            }
        }

        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(nextTimestamp => this.renderLoop(videoElement, nextTimestamp));
    }
}

const elements = {
    startButton: document.getElementById('start-button'),
    uiOverlay: document.getElementById('ui-overlay'),
    loadingIndicator: document.getElementById('loading-indicator'),
    errorMessage: document.getElementById('error-message'),
    controlPanel: document.getElementById('control-panel'),
    statusChip: document.getElementById('status-chip'),
    profileButton: document.getElementById('profile-button'),
    profileModal: document.getElementById('profile-modal'),
    profileClose: document.getElementById('profile-close'),
    profileSummary: document.getElementById('profile-summary'),
    heightInput: document.getElementById('height-cm'),
    frontInput: document.getElementById('front-photo'),
    sideInput: document.getElementById('side-photo'),
    frontCapture: document.getElementById('capture-front'),
    sideCapture: document.getElementById('capture-side'),
    frontStatus: document.getElementById('front-status'),
    sideStatus: document.getElementById('side-status'),
    analyzeProfile: document.getElementById('analyze-profile'),
    profileAnalysisStatus: document.getElementById('profile-analysis-status'),
    profileResults: document.getElementById('profile-results'),
    clearProfile: document.getElementById('clear-profile'),
    garmentColor: document.getElementById('garment-color'),
    garmentUpload: document.getElementById('garment-upload'),
    resetGarment: document.getElementById('reset-garment')
};

const app = new App();
let capturedFrontFile = null;
let capturedSideFile = null;

function setStatus(text, state = 'ready') {
    if (!elements.statusChip) return;
    elements.statusChip.textContent = text;
    elements.statusChip.dataset.state = state;
}

function setModalOpen(open) {
    if (!elements.profileModal) return;
    elements.profileModal.hidden = !open;
}

function measurementLine(label, value, unit = 'cm') {
    if (!Number.isFinite(Number(value))) return '';
    return `<div class="measurement"><span>${label}</span><strong>${value} ${unit}</strong></div>`;
}

function renderProfile(profile) {
    if (!elements.profileSummary || !elements.profileResults) return;

    if (!profile) {
        elements.profileSummary.textContent = 'Sin perfil corporal';
        elements.profileResults.hidden = true;
        elements.profileResults.innerHTML = '';
        return;
    }

    const m = profile.measurements || {};
    elements.profileSummary.textContent = `Perfil activo · ${profile.heightCm} cm · confianza ${Math.round((profile.confidence || 0) * 100)}%`;
    elements.profileResults.innerHTML = `
        ${measurementLine('Hombros', m.shoulderWidthCm)}
        ${measurementLine('Torso', m.torsoLengthCm)}
        ${measurementLine('Ancho pecho', m.chestFrontWidthCm)}
        ${measurementLine('Profundidad pecho', m.chestDepthCm)}
        ${measurementLine('Contorno pecho aprox.', m.chestCircumferenceCm)}
        ${measurementLine('Ancho cintura', m.waistFrontWidthCm)}
        ${measurementLine('Contorno cintura aprox.', m.waistCircumferenceCm)}
        <p class="profile-warning">${(profile.warnings || []).length ? profile.warnings.join(' ') : 'Captura aceptable. Las medidas siguen siendo estimaciones visuales, no medidas de sastrería.'}</p>
    `;
    elements.profileResults.hidden = false;
}

function selectedFile(input, capturedFile) {
    return capturedFile || input?.files?.[0] || null;
}

renderProfile(app.bodyProfile);

if (elements.profileButton) {
    elements.profileButton.addEventListener('click', () => setModalOpen(true));
}
if (elements.profileClose) {
    elements.profileClose.addEventListener('click', () => setModalOpen(false));
}
if (elements.profileModal) {
    elements.profileModal.addEventListener('click', event => {
        if (event.target?.dataset?.closeProfile === 'true') setModalOpen(false);
    });
}

if (elements.frontInput) {
    elements.frontInput.addEventListener('change', () => {
        capturedFrontFile = null;
        elements.frontStatus.textContent = elements.frontInput.files?.[0]?.name || 'Sin imagen frontal';
    });
}
if (elements.sideInput) {
    elements.sideInput.addEventListener('change', () => {
        capturedSideFile = null;
        elements.sideStatus.textContent = elements.sideInput.files?.[0]?.name || 'Sin imagen lateral';
    });
}

if (elements.frontCapture) {
    elements.frontCapture.addEventListener('click', async () => {
        try {
            capturedFrontFile = await app.captureCurrentFrame('visionwear-front.jpg');
            elements.frontStatus.textContent = 'Frontal capturada desde cámara';
        } catch (error) {
            elements.frontStatus.textContent = error.message;
        }
    });
}

if (elements.sideCapture) {
    elements.sideCapture.addEventListener('click', async () => {
        try {
            capturedSideFile = await app.captureCurrentFrame('visionwear-side.jpg');
            elements.sideStatus.textContent = 'Lateral capturada desde cámara';
        } catch (error) {
            elements.sideStatus.textContent = error.message;
        }
    });
}

if (elements.analyzeProfile) {
    elements.analyzeProfile.addEventListener('click', async () => {
        elements.analyzeProfile.disabled = true;
        elements.profileAnalysisStatus.textContent = 'Preparando análisis...';

        try {
            const profile = await app.analyzeBodyProfile({
                frontFile: selectedFile(elements.frontInput, capturedFrontFile),
                sideFile: selectedFile(elements.sideInput, capturedSideFile),
                heightCm: elements.heightInput?.value,
                onProgress: message => {
                    elements.profileAnalysisStatus.textContent = message;
                }
            });

            renderProfile(profile);
            elements.profileAnalysisStatus.textContent = 'Perfil aplicado al ajuste de la prenda.';
        } catch (error) {
            console.error('Error creando perfil corporal:', error);
            elements.profileAnalysisStatus.textContent = error?.message || 'No se pudo crear el perfil corporal.';
        } finally {
            elements.analyzeProfile.disabled = false;
        }
    });
}

if (elements.clearProfile) {
    elements.clearProfile.addEventListener('click', () => {
        app.clearBodyProfile();
        renderProfile(null);
        elements.profileAnalysisStatus.textContent = 'Perfil eliminado.';
    });
}

if (elements.garmentColor) {
    elements.garmentColor.addEventListener('input', () => app.setGarmentColor(elements.garmentColor.value));
}

if (elements.garmentUpload) {
    elements.garmentUpload.addEventListener('change', async () => {
        const file = elements.garmentUpload.files?.[0];
        if (!file) return;

        try {
            setStatus('Cargando prenda...', 'loading');
            await app.setCustomGarment(file);
            setStatus('Prenda personalizada activa', 'ready');
        } catch (error) {
            console.error(error);
            setStatus(error.message, 'error');
        }
    });
}

if (elements.resetGarment) {
    elements.resetGarment.addEventListener('click', () => {
        app.resetGarment();
        if (elements.garmentUpload) elements.garmentUpload.value = '';
        setStatus('Prenda base activa', 'ready');
    });
}

if (!elements.startButton) {
    console.error('No se encontró #start-button');
} else {
    elements.startButton.addEventListener('click', async () => {
        elements.startButton.disabled = true;
        elements.startButton.textContent = 'Solicitando cámara...';
        elements.loadingIndicator.style.display = 'block';
        elements.loadingIndicator.textContent = 'Esperando permiso de cámara...';
        elements.errorMessage.style.display = 'none';

        try {
            await app.cameraManager.initialize();

            elements.loadingIndicator.textContent = 'Cámara activa. Cargando detector de postura...';
            const { PoseEstimator } = await import('./poseDetection.js?v=10');

            elements.loadingIndicator.textContent = 'Cargando motor gráfico...';
            const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');

            app.THREE = THREE;
            app.poseEstimator = new PoseEstimator();
            app.setupRendering();
            app.buildDefaultGarment();

            elements.loadingIndicator.textContent = 'Inicializando MoveNet...';
            await app.poseEstimator.initialize();
            app.renderLoop(app.cameraManager.videoElement);

            elements.loadingIndicator.textContent = 'VisionWear listo.';
            elements.controlPanel.hidden = false;
            setStatus(app.bodyProfile ? 'Tracking + perfil corporal' : 'Tracking corporal activo', 'ready');
            renderProfile(app.bodyProfile);

            elements.uiOverlay.style.opacity = '0';
            setTimeout(() => {
                elements.uiOverlay.style.display = 'none';
            }, 500);
        } catch (error) {
            console.error('Error al iniciar VisionWear:', error);
            elements.loadingIndicator.style.display = 'none';
            elements.errorMessage.style.display = 'block';
            elements.errorMessage.innerText = error?.message || String(error) || 'No se pudo iniciar VisionWear.';
            elements.startButton.disabled = false;
            elements.startButton.textContent = 'Permitir Cámara e Iniciar';
        }
    });
}
