import { CameraManager } from './camera.js';
import { PoseEstimator } from './poseDetection.js';
import * as THREE from 'three';

export class App {
    constructor() {
        this.cameraManager = new CameraManager('webcam-video');
        this.poseEstimator = new PoseEstimator();
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.clothingMesh = null;
    }

    async start() {
        const videoElement = await this.cameraManager.initialize();
        await this.poseEstimator.initialize();
        
        this.setupRendering();
        this.buildClothingMesh();
        this.renderLoop(videoElement);
    }

    setupRendering() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000, 0);
        document.body.appendChild(this.renderer.domElement);
        this.camera.position.z = 5;
    }

    buildClothingMesh() {
        const geometry = new THREE.BoxGeometry(1.5, 2, 0.5);
        const material = new THREE.MeshNormalMaterial({ wireframe: true });
        this.clothingMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.clothingMesh);
    }

    async renderLoop(videoElement) {
        const pose = await this.poseEstimator.estimatePose(videoElement);
        
        if (pose && pose.keypoints) {
            const leftShoulder = pose.keypoints.find(k => k.name === 'left_shoulder');
            const rightShoulder = pose.keypoints.find(k => k.name === 'right_shoulder');
            
            if (leftShoulder?.score > 0.5 && rightShoulder?.score > 0.5) {
                const midX = (leftShoulder.x + rightShoulder.x) / 2;
                const midY = (leftShoulder.y + rightShoulder.y) / 2;
                
                const ndcX = (midX / videoElement.videoWidth) * 2 - 1;
                const ndcY = -(midY / videoElement.videoHeight) * 2 + 1;
                
                this.clothingMesh.position.x = ndcX * 5;
                this.clothingMesh.position.y = ndcY * 5;
                
                const shoulderDist = Math.abs(rightShoulder.x - leftShoulder.x);
                const scale = shoulderDist / 100;
                this.clothingMesh.scale.set(scale, scale, scale);
            }
        }

        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(() => this.renderLoop(videoElement));
    }
}

const app = new App();
app.start();
