function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export class AvatarPreview {
    constructor(THREE, container) {
        this.THREE = THREE;
        this.container = container;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.mesh = null;
        this.animationFrame = null;
        this.resizeObserver = null;
    }

    createTorsoGeometry(profile) {
        const THREE = this.THREE;
        const m = profile?.measurements || {};
        const torsoLength = Math.max(Number(m.torsoLengthCm) || 55, 35);
        const shoulderWidth = Math.max(Number(m.shoulderWidthCm) || 42, 25);
        const chestWidth = Math.max(Number(m.chestFrontWidthCm) || shoulderWidth * 0.88, 20);
        const chestDepth = Math.max(Number(m.chestDepthCm) || chestWidth * 0.62, 14);
        const waistWidth = Math.max(Number(m.waistFrontWidthCm) || chestWidth * 0.84, 18);
        const waistDepth = Math.max(Number(m.waistDepthCm) || chestDepth * 0.86, 12);

        const rings = [
            { y: torsoLength * 0.50, width: shoulderWidth * 0.82, depth: chestDepth * 0.70 },
            { y: torsoLength * 0.28, width: chestWidth, depth: chestDepth },
            { y: -torsoLength * 0.05, width: chestWidth * 0.96, depth: chestDepth * 0.96 },
            { y: -torsoLength * 0.32, width: waistWidth, depth: waistDepth },
            { y: -torsoLength * 0.50, width: waistWidth * 1.06, depth: waistDepth * 1.04 }
        ];

        const radialSegments = 40;
        const positions = [];
        const indices = [];

        for (const ring of rings) {
            const halfWidth = ring.width / 2;
            const halfDepth = ring.depth / 2;
            for (let i = 0; i < radialSegments; i += 1) {
                const angle = (i / radialSegments) * Math.PI * 2;
                positions.push(
                    Math.cos(angle) * halfWidth,
                    ring.y,
                    Math.sin(angle) * halfDepth
                );
            }
        }

        for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
            for (let i = 0; i < radialSegments; i += 1) {
                const next = (i + 1) % radialSegments;
                const a = (ringIndex * radialSegments) + i;
                const b = (ringIndex * radialSegments) + next;
                const c = ((ringIndex + 1) * radialSegments) + i;
                const d = ((ringIndex + 1) * radialSegments) + next;
                indices.push(a, c, b, b, c, d);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        return geometry;
    }

    setup() {
        if (!this.container || this.renderer) return;
        const THREE = this.THREE;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 1000);
        this.camera.position.set(0, 4, 150);

        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.container.innerHTML = '';
        this.container.appendChild(this.renderer.domElement);

        this.scene.add(new THREE.AmbientLight(0xffffff, 1.8));
        const key = new THREE.DirectionalLight(0xffffff, 2.4);
        key.position.set(40, 80, 90);
        this.scene.add(key);
        const rim = new THREE.DirectionalLight(0x55d8ff, 1.4);
        rim.position.set(-70, 10, -30);
        this.scene.add(rim);

        const resize = () => {
            const width = Math.max(this.container.clientWidth, 220);
            const height = Math.max(this.container.clientHeight, 220);
            this.renderer.setSize(width, height, false);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        };
        resize();

        this.resizeObserver = new ResizeObserver(resize);
        this.resizeObserver.observe(this.container);

        const animate = () => {
            if (this.mesh) this.mesh.rotation.y += 0.006;
            this.renderer.render(this.scene, this.camera);
            this.animationFrame = requestAnimationFrame(animate);
        };
        animate();
    }

    update(profile) {
        if (!profile || !this.container) return;
        this.setup();
        const THREE = this.THREE;

        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry?.dispose?.();
            this.mesh.material?.dispose?.();
        }

        const geometry = this.createTorsoGeometry(profile);
        const material = new THREE.MeshPhysicalMaterial({
            color: 0x8adcf5,
            transparent: true,
            opacity: 0.58,
            roughness: 0.52,
            metalness: 0.05,
            clearcoat: 0.2,
            side: THREE.DoubleSide
        });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.rotation.x = -0.05;
        this.scene.add(this.mesh);

        const radius = geometry.boundingSphere?.radius || 50;
        this.camera.position.z = clamp(radius * 3.1, 110, 230);
        this.camera.position.y = 2;
        this.camera.lookAt(0, 0, 0);
    }

    clear() {
        if (this.mesh && this.scene) {
            this.scene.remove(this.mesh);
            this.mesh.geometry?.dispose?.();
            this.mesh.material?.dispose?.();
            this.mesh = null;
        }
        if (this.container) this.container.innerHTML = '';
    }

    dispose() {
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        this.resizeObserver?.disconnect?.();
        this.clear();
        this.renderer?.dispose?.();
        this.renderer = null;
    }
}
