import { CameraManager } from './camera.js';
import { GarmentSmoother } from './filters.js';
import { BodyProfileAnalyzer } from './bodyProfile.js';
import { GarmentAnalyzer } from './garmentAnalyzer.js';
import { FitEngine } from './fitEngine.js';
import { AvatarPreview } from './avatarBuilder.js';
import { ScanAnimation } from './scanAnimation.js';

const PROFILE_STORAGE_KEY = 'visionwear.bodyProfile.v2';

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
        this.usingCustomGarment = false;
        this.currentGarmentProfile = null;
        this.fitResult = null;
        this.lastFrameTime = 0;
        this.targetFps = 30;
        this.garmentSmoother = new GarmentSmoother();
        this.bodyProfileAnalyzer = null;
        this.garmentAnalyzer = new GarmentAnalyzer();
        this.fitEngine = new FitEngine();
        this.bodyProfile = this.loadSavedBodyProfile();
        this.currentGarmentColor = 0x27d3ff;
        this.handleResize = this.handleResize.bind(this);
    }

    loadSavedBodyProfile() {
        try {
            const current = localStorage.getItem(PROFILE_STORAGE_KEY);
            const legacy = localStorage.getItem('visionwear.bodyProfile.v1');
            return JSON.parse(current || legacy || 'null');
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
    }

    clearBodyProfile() {
        this.bodyProfile = null;
        this.fitResult = null;
        localStorage.removeItem(PROFILE_STORAGE_KEY);
        localStorage.removeItem('visionwear.bodyProfile.v1');
        this.resetGarment();
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

        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
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
        this.fitResult = null;

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
            opacity: 0.46,
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
            opacity: 0.72,
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

    createDeformableGarmentGeometry(garmentProfile, fitResult) {
        const THREE = this.THREE;
        const geometry = new THREE.PlaneGeometry(1, 1, 14, 18);
        const position = geometry.attributes.position;
        const waistRatio = clamp(
            fitResult?.visual?.waistFactor ?? garmentProfile?.ratios?.waistToChest ?? 0.88,
            0.62,
            1.18
        );
        const hemRatio = clamp(garmentProfile?.ratios?.hemToChest ?? waistRatio, 0.64, 1.28);

        for (let i = 0; i < position.count; i += 1) {
            const originalX = position.getX(i);
            const y = position.getY(i);
            const t = y + 0.5;
            let widthFactor;

            if (t < 0.34) {
                const local = t / 0.34;
                widthFactor = hemRatio + ((waistRatio - hemRatio) * local);
            } else if (t < 0.72) {
                const local = (t - 0.34) / 0.38;
                widthFactor = waistRatio + ((1 - waistRatio) * local);
            } else {
                const local = (t - 0.72) / 0.28;
                widthFactor = 1 + (0.08 * local);
            }

            const centerPull = 1 - (Math.abs(originalX) * 0.035);
            position.setX(i, originalX * widthFactor * centerPull);
        }

        position.needsUpdate = true;
        geometry.computeVertexNormals();
        return geometry;
    }

    async applyAnalyzedGarment(garmentProfile, fitResult) {
        if (!this.THREE || !this.scene) throw new Error('El motor gráfico todavía no está listo.');
        if (!garmentProfile?.cutoutDataUrl) throw new Error('La prenda todavía no tiene una textura procesada.');
        if (!fitResult) throw new Error('Necesito un perfil corporal para calcular el ajuste antes de renderizar la prenda.');

        const THREE = this.THREE;
        const texture = await new Promise((resolve, reject) => {
            new THREE.TextureLoader().load(
                garmentProfile.cutoutDataUrl,
                resolve,
                undefined,
                () => reject(new Error('No se pudo crear la textura procesada de la prenda.'))
            );
        });
        texture.colorSpace = THREE.SRGBColorSpace;

        this.disposeGarment();
        this.customGarmentTexture?.dispose?.();
        this.customGarmentTexture = texture;
        this.currentGarmentProfile = garmentProfile;
        this.fitResult = fitResult;
        this.usingCustomGarment = true;

        const geometry = this.createDeformableGarmentGeometry(garmentProfile, fitResult);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.97,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false
        });
        this.clothingModel = new THREE.Mesh(geometry, material);
        this.clothingModel.renderOrder = 2;
        this.clothingModel.visible = false;
        this.scene.add(this.clothingModel);
    }

    resetGarment() {
        this.customGarmentTexture?.dispose?.();
        this.customGarmentTexture = null;
        this.usingCustomGarment = false;
        this.fitResult = null;
        if (this.THREE && this.scene) this.buildDefaultGarment();
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
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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
        const find = name => pose.keypoints.find(point => point.name === name);
        const leftShoulderRaw = find('left_shoulder');
        const rightShoulderRaw = find('right_shoulder');
        const leftHipRaw = find('left_hip');
        const rightHipRaw = find('right_hip');

        if ((leftShoulderRaw?.score ?? 0) <= 0.45 || (rightShoulderRaw?.score ?? 0) <= 0.45) {
            this.hideGarment();
            return;
        }

        const leftShoulder = this.videoPointToScreen(leftShoulderRaw, videoElement);
        const rightShoulder = this.videoPointToScreen(rightShoulderRaw, videoElement);
        if (!leftShoulder || !rightShoulder) return;

        const shoulderMid = this.midpoint(leftShoulder, rightShoulder);
        const shoulderWidth = this.distance(leftShoulder, rightShoulder);
        const hipsReliable = (leftHipRaw?.score ?? 0) > 0.32 && (rightHipRaw?.score ?? 0) > 0.32;

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
            torsoCenterScreen = { x: shoulderMid.x, y: shoulderMid.y + (torsoHeight * 0.46) };
        }

        const fitWidthFactor = this.fitResult?.visual?.widthFactor ?? 1;
        const fitHeightFactor = this.fitResult?.visual?.heightFactor ?? 1;
        const garmentWidth = shoulderWidth * this.profileWidthFactor() * fitWidthFactor;
        const garmentHeight = torsoHeight * fitHeightFactor;
        const centerWorld = this.screenPointToWorld(torsoCenterScreen);
        const leftWorld = this.screenPointToWorld(leftShoulder);
        const rightWorld = this.screenPointToWorld(rightShoulder);
        const shoulderAngle = Math.atan2(rightWorld.y - leftWorld.y, rightWorld.x - leftWorld.x);

        const smoothed = this.garmentSmoother.filter({
            x: centerWorld.x,
            y: centerWorld.y,
            width: garmentWidth,
            height: garmentHeight,
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

    async analyzeBodyProfile({ frontFile, sideFile, backFile = null, heightCm, onProgress }) {
        if (!this.poseEstimator) throw new Error('Primero inicia VisionWear para cargar el modelo de postura.');
        if (!this.bodyProfileAnalyzer) this.bodyProfileAnalyzer = new BodyProfileAnalyzer(this.poseEstimator);

        const profile = await this.bodyProfileAnalyzer.analyze({
            frontFile,
            sideFile,
            backFile,
            heightCm,
            onProgress
        });
        this.saveBodyProfile(profile);

        if (this.currentGarmentProfile) {
            this.fitResult = this.fitEngine.calculate(profile, this.currentGarmentProfile);
            await this.applyAnalyzedGarment(this.currentGarmentProfile, this.fitResult);
        }
        return profile;
    }

    async analyzeGarment({ file, garmentType, referenceType, referenceCm, stretch, onProgress }) {
        const garmentProfile = await this.garmentAnalyzer.analyze({
            file,
            garmentType,
            referenceType,
            referenceCm,
            stretch,
            onProgress
        });
        this.currentGarmentProfile = garmentProfile;

        let fitResult = null;
        if (this.bodyProfile) {
            onProgress('Comparando prenda y perfil corporal...');
            fitResult = this.fitEngine.calculate(this.bodyProfile, garmentProfile);
            await this.applyAnalyzedGarment(garmentProfile, fitResult);
        }
        return { garmentProfile, fitResult };
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
        requestAnimationFrame(next => this.renderLoop(videoElement, next));
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
    backInput: document.getElementById('back-photo'),
    frontCapture: document.getElementById('capture-front'),
    sideCapture: document.getElementById('capture-side'),
    backCapture: document.getElementById('capture-back'),
    frontStatus: document.getElementById('front-status'),
    sideStatus: document.getElementById('side-status'),
    backStatus: document.getElementById('back-status'),
    analyzeProfile: document.getElementById('analyze-profile'),
    profileAnalysisStatus: document.getElementById('profile-analysis-status'),
    profileResults: document.getElementById('profile-results'),
    clearProfile: document.getElementById('clear-profile'),
    avatarPreview: document.getElementById('avatar-preview'),
    bodyScanStage: document.getElementById('body-scan-stage'),
    bodyScanProgress: document.getElementById('body-scan-progress'),
    bodyScanLabel: document.getElementById('body-scan-label'),
    garmentButton: document.getElementById('garment-button'),
    garmentModal: document.getElementById('garment-modal'),
    garmentClose: document.getElementById('garment-close'),
    garmentSummary: document.getElementById('garment-summary'),
    garmentUpload: document.getElementById('garment-upload'),
    garmentType: document.getElementById('garment-type'),
    garmentStretch: document.getElementById('garment-stretch'),
    garmentReferenceType: document.getElementById('garment-reference-type'),
    garmentReferenceCm: document.getElementById('garment-reference-cm'),
    analyzeGarment: document.getElementById('analyze-garment'),
    garmentAnalysisStatus: document.getElementById('garment-analysis-status'),
    garmentResults: document.getElementById('garment-results'),
    fitResults: document.getElementById('fit-results'),
    fitSummary: document.getElementById('fit-summary'),
    garmentScanStage: document.getElementById('garment-scan-stage'),
    garmentScanProgress: document.getElementById('garment-scan-progress'),
    garmentScanLabel: document.getElementById('garment-scan-label'),
    garmentColor: document.getElementById('garment-color'),
    resetGarment: document.getElementById('reset-garment')
};

const app = new App();
let capturedFrontFile = null;
let capturedSideFile = null;
let capturedBackFile = null;
let avatarPreview = null;

const bodyScanner = new ScanAnimation({
    root: elements.bodyScanStage,
    status: elements.profileAnalysisStatus,
    progressBar: elements.bodyScanProgress,
    stageLabel: elements.bodyScanLabel
});
const garmentScanner = new ScanAnimation({
    root: elements.garmentScanStage,
    status: elements.garmentAnalysisStatus,
    progressBar: elements.garmentScanProgress,
    stageLabel: elements.garmentScanLabel
});

function setStatus(text, state = 'ready') {
    if (!elements.statusChip) return;
    elements.statusChip.textContent = text;
    elements.statusChip.dataset.state = state;
}

function setProfileOpen(open) {
    if (elements.profileModal) elements.profileModal.hidden = !open;
}

function setGarmentOpen(open) {
    if (elements.garmentModal) elements.garmentModal.hidden = !open;
}

function measurementLine(label, value, unit = 'cm') {
    if (!Number.isFinite(Number(value))) return '';
    return `<div class="measurement"><span>${label}</span><strong>${value} ${unit}</strong></div>`;
}

function ensureAvatar(profile) {
    if (!profile || !app.THREE || !elements.avatarPreview) return;
    if (!avatarPreview) avatarPreview = new AvatarPreview(app.THREE, elements.avatarPreview);
    avatarPreview.update(profile);
}

function renderProfile(profile) {
    if (!elements.profileSummary || !elements.profileResults) return;
    if (!profile) {
        elements.profileSummary.textContent = 'Sin perfil';
        elements.profileResults.hidden = true;
        elements.profileResults.innerHTML = '';
        avatarPreview?.clear?.();
        return;
    }

    const m = profile.measurements || {};
    elements.profileSummary.textContent = `${profile.heightCm} cm · confianza ${Math.round((profile.confidence || 0) * 100)}%`;
    elements.profileResults.innerHTML = `
        ${measurementLine('Hombros', m.shoulderWidthCm)}
        ${measurementLine('Largo torso', m.torsoLengthCm)}
        ${measurementLine('Ancho pecho', m.chestFrontWidthCm)}
        ${measurementLine('Profundidad pecho', m.chestDepthCm)}
        ${measurementLine('Contorno pecho', m.chestCircumferenceCm)}
        ${measurementLine('Ancho cintura', m.waistFrontWidthCm)}
        ${measurementLine('Profundidad cintura', m.waistDepthCm)}
        ${measurementLine('Contorno cintura', m.waistCircumferenceCm)}
        <p class="profile-warning">${(profile.warnings || []).length ? profile.warnings.join(' ') : 'Perfil utilizable para el fitting experimental.'}</p>
    `;
    elements.profileResults.hidden = false;
    ensureAvatar(profile);
}

function renderGarment(profile) {
    if (!elements.garmentSummary || !elements.garmentResults) return;
    if (!profile) {
        elements.garmentSummary.textContent = 'Sin análisis';
        elements.garmentResults.hidden = true;
        return;
    }
    const m = profile.measurements || {};
    elements.garmentSummary.textContent = `${profile.garmentType} · ${m.chestFlatCm} cm pecho plano`;
    elements.garmentResults.innerHTML = `
        ${measurementLine('Pecho en plano', m.chestFlatCm)}
        ${measurementLine('Contorno prenda', m.chestCircumferenceCm)}
        ${measurementLine('Cintura en plano', m.waistFlatCm)}
        ${measurementLine('Basta en plano', m.hemFlatCm)}
        ${measurementLine('Largo total', m.lengthCm)}
        ${measurementLine('Ancho máximo', m.maxWidthCm)}
        <p class="profile-warning">${(profile.warnings || []).length ? profile.warnings.join(' ') : 'Silueta separada y calibrada con la referencia ingresada.'}</p>
    `;
    elements.garmentResults.hidden = false;
}

function renderFit(fit) {
    if (!elements.fitSummary || !elements.fitResults) return;
    if (!fit) {
        elements.fitSummary.classList.add('empty-state');
        elements.fitSummary.textContent = app.currentGarmentProfile
            ? 'Prenda medida. Falta crear el perfil corporal para calcular el fit.'
            : 'Escanea tu perfil y analiza una prenda.';
        elements.fitResults.hidden = true;
        return;
    }

    elements.fitSummary.classList.remove('empty-state');
    elements.fitSummary.innerHTML = `<strong>${fit.label}</strong> · score ${fit.score}/100 · holgura pecho ${fit.chest.easeCm} cm`;
    elements.fitResults.innerHTML = `
        <div class="fit-result-head"><span class="fit-badge">${fit.label}</span><span class="fit-score">${fit.score}/100</span></div>
        <div class="profile-results">
            ${measurementLine('Pecho cuerpo', fit.chest.bodyCm)}
            ${measurementLine('Pecho prenda efectivo', fit.chest.effectiveGarmentCm)}
            ${measurementLine('Holgura pecho', fit.chest.easeCm)}
            ${measurementLine('Holgura cintura', fit.waist.easeCm)}
            ${measurementLine('Largo objetivo', fit.length.bodyTargetCm)}
            ${measurementLine('Largo prenda', fit.length.garmentCm)}
        </div>
        <ul>${fit.notes.map(note => `<li>${note}</li>`).join('')}</ul>
    `;
    elements.fitResults.hidden = false;
}

function selectedFile(input, captured) {
    return captured || input?.files?.[0] || null;
}

function bindFileStatus(input, statusElement, capturedSetter, emptyText) {
    input?.addEventListener('change', () => {
        capturedSetter(null);
        statusElement.textContent = input.files?.[0]?.name || emptyText;
    });
}

async function captureInto(setter, statusElement, fileName, successText) {
    try {
        const file = await app.captureCurrentFrame(fileName);
        setter(file);
        statusElement.textContent = successText;
    } catch (error) {
        statusElement.textContent = error.message;
    }
}

renderProfile(app.bodyProfile);
renderGarment(null);
renderFit(null);

elements.profileButton?.addEventListener('click', () => setProfileOpen(true));
elements.profileClose?.addEventListener('click', () => setProfileOpen(false));
elements.profileModal?.addEventListener('click', event => {
    if (event.target?.dataset?.closeProfile === 'true') setProfileOpen(false);
});
elements.garmentButton?.addEventListener('click', () => setGarmentOpen(true));
elements.garmentClose?.addEventListener('click', () => setGarmentOpen(false));
elements.garmentModal?.addEventListener('click', event => {
    if (event.target?.dataset?.closeGarment === 'true') setGarmentOpen(false);
});

bindFileStatus(elements.frontInput, elements.frontStatus, value => { capturedFrontFile = value; }, 'Sin imagen frontal');
bindFileStatus(elements.sideInput, elements.sideStatus, value => { capturedSideFile = value; }, 'Sin imagen lateral');
bindFileStatus(elements.backInput, elements.backStatus, value => { capturedBackFile = value; }, 'Sin imagen posterior');

elements.frontCapture?.addEventListener('click', () => captureInto(value => { capturedFrontFile = value; }, elements.frontStatus, 'visionwear-front.jpg', 'Frontal capturada desde cámara'));
elements.sideCapture?.addEventListener('click', () => captureInto(value => { capturedSideFile = value; }, elements.sideStatus, 'visionwear-side.jpg', 'Lateral capturada desde cámara'));
elements.backCapture?.addEventListener('click', () => captureInto(value => { capturedBackFile = value; }, elements.backStatus, 'visionwear-back.jpg', 'Posterior capturada desde cámara'));

elements.analyzeProfile?.addEventListener('click', async () => {
    elements.analyzeProfile.disabled = true;
    bodyScanner.start('Preparando escaneo corporal...');
    try {
        const profile = await app.analyzeBodyProfile({
            frontFile: selectedFile(elements.frontInput, capturedFrontFile),
            sideFile: selectedFile(elements.sideInput, capturedSideFile),
            backFile: selectedFile(elements.backInput, capturedBackFile),
            heightCm: elements.heightInput?.value,
            onProgress: message => bodyScanner.update(message)
        });
        renderProfile(profile);
        renderFit(app.fitResult);
        bodyScanner.complete('Perfil corporal actualizado.');
        setStatus(app.fitResult ? 'Perfil + fit actualizados' : 'Perfil corporal activo', 'ready');
    } catch (error) {
        console.error('Error creando perfil corporal:', error);
        bodyScanner.fail(error?.message || 'No se pudo crear el perfil.');
    } finally {
        elements.analyzeProfile.disabled = false;
    }
});

elements.clearProfile?.addEventListener('click', () => {
    app.clearBodyProfile();
    renderProfile(null);
    renderFit(null);
    bodyScanner.reset();
    setStatus('Perfil eliminado', 'ready');
});

elements.analyzeGarment?.addEventListener('click', async () => {
    const file = elements.garmentUpload?.files?.[0];
    elements.analyzeGarment.disabled = true;
    garmentScanner.start('Preparando análisis de prenda...');
    try {
        const result = await app.analyzeGarment({
            file,
            garmentType: elements.garmentType?.value,
            referenceType: elements.garmentReferenceType?.value,
            referenceCm: elements.garmentReferenceCm?.value,
            stretch: elements.garmentStretch?.value,
            onProgress: message => garmentScanner.update(message)
        });
        renderGarment(result.garmentProfile);
        renderFit(result.fitResult);
        if (result.fitResult) {
            garmentScanner.complete('Prenda medida, ajustada y aplicada al try-on.');
            setStatus(`Fit ${result.fitResult.label} · score ${result.fitResult.score}/100`, 'ready');
        } else {
            garmentScanner.complete('Prenda medida. Falta el perfil corporal para calcular el fit.');
            setStatus('Prenda medida · falta perfil corporal', 'loading');
        }
    } catch (error) {
        console.error('Error analizando prenda:', error);
        garmentScanner.fail(error?.message || 'No se pudo analizar la prenda.');
        setStatus(error?.message || 'Error de prenda', 'error');
    } finally {
        elements.analyzeGarment.disabled = false;
    }
});

elements.garmentColor?.addEventListener('input', () => app.setGarmentColor(elements.garmentColor.value));
elements.resetGarment?.addEventListener('click', () => {
    app.resetGarment();
    renderFit(null);
    setStatus('Prenda base activa', 'ready');
});

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
            elements.loadingIndicator.textContent = 'Cargando detector de postura...';
            const { PoseEstimator } = await import('./poseDetection.js?v=11');
            elements.loadingIndicator.textContent = 'Cargando motor gráfico...';
            const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');

            app.THREE = THREE;
            app.poseEstimator = new PoseEstimator();
            app.setupRendering();
            app.buildDefaultGarment();
            elements.loadingIndicator.textContent = 'Inicializando MoveNet...';
            await app.poseEstimator.initialize();
            app.renderLoop(app.cameraManager.videoElement);

            elements.controlPanel.hidden = false;
            setStatus(app.bodyProfile ? 'Tracking + perfil corporal' : 'Tracking corporal activo', 'ready');
            renderProfile(app.bodyProfile);
            renderFit(app.fitResult);
            elements.uiOverlay.style.opacity = '0';
            setTimeout(() => { elements.uiOverlay.style.display = 'none'; }, 500);
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
