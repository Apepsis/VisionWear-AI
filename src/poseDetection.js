import * as tf from 'https://esm.sh/@tensorflow/tfjs@4.22.0';
import * as poseDetection from 'https://esm.sh/@tensorflow-models/pose-detection@2.1.3';

export class PoseEstimator {
    constructor() {
        this.detector = null;
        this.smoothedKeypoints = {};
        this.alpha = 0.45;
    }

    async initialize() {
        await tf.setBackend('webgl');
        await tf.ready();

        const detectorConfig = {
            modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
        };

        this.detector = await poseDetection.createDetector(
            poseDetection.SupportedModels.MoveNet,
            detectorConfig
        );

        console.log('Modelo MoveNet inicializado con backend WebGL.');
    }

    smoothKeypoints(keypoints) {
        return keypoints.map(kp => {
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

    async estimatePose(videoElement) {
        if (!this.detector || !videoElement || videoElement.readyState < 2) {
            return null;
        }

        const poses = await this.detector.estimatePoses(videoElement);

        if (poses.length > 0) {
            const smoothed = this.smoothKeypoints(poses[0].keypoints);
            return { ...poses[0], keypoints: smoothed };
        }

        return null;
    }
}
