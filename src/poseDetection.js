export class PoseEstimator {
    constructor() {
        this.detector = null;
        this.smoothedKeypoints = {};
        this.alpha = 0.45;
    }

    async initialize() {
        const tf = globalThis.tf;
        const poseDetection = globalThis.poseDetection;

        if (!tf) {
            throw new Error('TensorFlow.js no se cargó correctamente.');
        }

        if (!poseDetection) {
            throw new Error('MoveNet / pose-detection no se cargó correctamente.');
        }

        await tf.setBackend('webgl');
        await tf.ready();

        const detectorConfig = {
            modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
            enableSmoothing: true
        };

        this.detector = await poseDetection.createDetector(
            poseDetection.SupportedModels.MoveNet,
            detectorConfig
        );

        console.log('Modelo MoveNet inicializado con backend WebGL.');
    }

    smoothKeypoints(keypoints) {
        return keypoints.map(kp => {
            if (!kp.name) return kp;

            if (!this.smoothedKeypoints[kp.name]) {
                this.smoothedKeypoints[kp.name] = { x: kp.x, y: kp.y };
            } else {
                this.smoothedKeypoints[kp.name].x =
                    (this.alpha * kp.x) +
                    ((1 - this.alpha) * this.smoothedKeypoints[kp.name].x);

                this.smoothedKeypoints[kp.name].y =
                    (this.alpha * kp.y) +
                    ((1 - this.alpha) * this.smoothedKeypoints[kp.name].y);
            }

            return {
                ...kp,
                x: this.smoothedKeypoints[kp.name].x,
                y: this.smoothedKeypoints[kp.name].y
            };
        });
    }

    resetSmoothing() {
        this.smoothedKeypoints = {};
    }

    async estimatePose(videoElement) {
        if (!this.detector || !videoElement || videoElement.readyState < 2) {
            return null;
        }

        // El video se refleja con CSS. Dejamos las coordenadas del modelo
        // sin reflejar y hacemos una única conversión en app.js.
        const poses = await this.detector.estimatePoses(videoElement, {
            flipHorizontal: false
        });

        if (poses.length > 0) {
            const smoothed = this.smoothKeypoints(poses[0].keypoints);
            return { ...poses[0], keypoints: smoothed };
        }

        return null;
    }

    async estimateImage(imageElement) {
        if (!this.detector || !imageElement) return null;

        const poses = await this.detector.estimatePoses(imageElement, {
            flipHorizontal: false
        });

        return poses.length > 0 ? poses[0] : null;
    }
}
