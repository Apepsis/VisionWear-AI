import { CameraManager } from './camera.js';
import { PoseEstimator } from './poseDetection.js';
import * as THREE from 'https://esm.sh/three](https://esm.sh/three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Al final de src/app.js, reemplaza "app.start();" con esto:

const app = new App();
const startButton = document.getElementById('start-button');
const uiOverlay = document.getElementById('ui-overlay');
const loadingIndicator = document.getElementById('loading-indicator');
const errorMessage = document.getElementById('error-message');

startButton.addEventListener('click', async () => {
    startButton.style.display = 'none';
    loadingIndicator.style.display = 'block';
    
    try {
        await app.start();
        uiOverlay.style.opacity = '0';
        setTimeout(() => uiOverlay.style.display = 'none', 500);
    } catch (error) {
        loadingIndicator.style.display = 'none';
        errorMessage.style.display = 'block';
        errorMessage.innerText = "Error: Verifica tu cámara e inténtalo de nuevo.";
        startButton.style.display = 'inline-block';
    }
});

export class App {
    constructor() {
        this.cameraManager = new CameraManager('webcam-video');
        this.poseEstimator = new PoseEstimator();
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.clothingModel = null;
    }

    async start() {
        const videoElement = await this.cameraManager.initialize();
        await this.poseEstimator.initialize();
        
        this.setupRendering();
        this.loadClothingModel();
        this.renderLoop(videoElement);
    }

    setupRendering() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000, 0);
        document.body.appendChild(this.renderer.domElement);
        this.camera.position.z = 5;

        const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(0, 10, 5);
        this.scene.add(directionalLight);
    }

    loadClothingModel() {
        const loader = new GLTFLoader();
        loader.load(
            'assets/shirt.glb',
            (gltf) => {
                this.clothingModel = gltf.scene;
                this.scene.add(this.clothingModel);
            },
            undefined,
            (error) => console.error(error)
        );
    }

    async renderLoop(videoElement) {
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
        requestAnimationFrame(() => this.renderLoop(videoElement));
    }
}

const app = new App();
app.start();
