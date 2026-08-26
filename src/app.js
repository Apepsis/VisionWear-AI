import { CameraManager } from './camera.js';
import { PoseEstimator } from './poseDetection.js';


import * as THREE from 'https://esm.sh/three';

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
        this.buildMockClothing(); 
        this.renderLoop(videoElement);
    }

    setupRendering() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000, 0);
        document.body.appendChild(this.renderer.domElement);
        this.camera.position.z = 5;
    }

    buildMockClothing() {
        // 1. Creamos la geometría de una caja (Box) que simulará ser el torso
        const geometry = new THREE.BoxGeometry(1.5, 2, 0.5);
        // 2. Le aplicamos un material "Normal" que genera colores brillantes y formato de malla (wireframe)
        const material = new THREE.MeshNormalMaterial({ wireframe: true });
        
        this.clothingModel = new THREE.Mesh(geometry, material);
        this.scene.add(this.clothingModel);
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

// Inicialización de la Interfaz y el Botón
const app = new App();
const startButton = document.getElementById('start-button');
const uiOverlay = document.getElementById('ui-overlay');
const loadingIndicator = document.getElementById('loading-indicator');
const errorMessage = document.getElementById('error-message');

startButton.addEventListener('click', async () => {
    startButton.style.display = 'none';
    loadingIndicator.style.display = 'block';
    errorMessage.style.display = 'none';
    
    try {
        await app.start();
        uiOverlay.style.opacity = '0';
        setTimeout(() => uiOverlay.style.display = 'none', 500);
    } catch (error) {
        console.error(error);
        loadingIndicator.style.display = 'none';
        errorMessage.style.display = 'block';
        errorMessage.innerText = "Error: Verifica tu cámara o la consola (F12).";
        startButton.style.display = 'inline-block';
    }
});
