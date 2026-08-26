class LowPassFilter {
    constructor() {
        this.initialized = false;
        this.value = 0;
    }

    filter(value, alpha) {
        if (!this.initialized) {
            this.initialized = true;
            this.value = value;
            return value;
        }

        this.value = (alpha * value) + ((1 - alpha) * this.value);
        return this.value;
    }
}

export class OneEuroFilter {
    constructor({ minCutoff = 1.2, beta = 0.025, dCutoff = 1.0 } = {}) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.valueFilter = new LowPassFilter();
        this.derivativeFilter = new LowPassFilter();
        this.lastRawValue = null;
        this.lastTimestamp = null;
    }

    alpha(cutoff, dt) {
        const tau = 1 / (2 * Math.PI * cutoff);
        return 1 / (1 + (tau / dt));
    }

    filter(value, timestampMs = performance.now()) {
        if (!Number.isFinite(value)) return value;

        if (this.lastTimestamp === null || this.lastRawValue === null) {
            this.lastTimestamp = timestampMs;
            this.lastRawValue = value;
            return this.valueFilter.filter(value, 1);
        }

        const dt = Math.max((timestampMs - this.lastTimestamp) / 1000, 1 / 120);
        const derivative = (value - this.lastRawValue) / dt;
        const derivativeAlpha = this.alpha(this.dCutoff, dt);
        const filteredDerivative = this.derivativeFilter.filter(derivative, derivativeAlpha);
        const cutoff = this.minCutoff + (this.beta * Math.abs(filteredDerivative));
        const valueAlpha = this.alpha(cutoff, dt);

        this.lastTimestamp = timestampMs;
        this.lastRawValue = value;

        return this.valueFilter.filter(value, valueAlpha);
    }

    reset() {
        this.valueFilter = new LowPassFilter();
        this.derivativeFilter = new LowPassFilter();
        this.lastRawValue = null;
        this.lastTimestamp = null;
    }
}

export class GarmentSmoother {
    constructor() {
        this.filters = {
            x: new OneEuroFilter({ minCutoff: 1.1, beta: 0.018 }),
            y: new OneEuroFilter({ minCutoff: 1.1, beta: 0.018 }),
            width: new OneEuroFilter({ minCutoff: 1.0, beta: 0.012 }),
            height: new OneEuroFilter({ minCutoff: 1.0, beta: 0.012 }),
            rotation: new OneEuroFilter({ minCutoff: 1.5, beta: 0.01 })
        };
    }

    filter(metrics, timestampMs = performance.now()) {
        return {
            x: this.filters.x.filter(metrics.x, timestampMs),
            y: this.filters.y.filter(metrics.y, timestampMs),
            width: this.filters.width.filter(metrics.width, timestampMs),
            height: this.filters.height.filter(metrics.height, timestampMs),
            rotation: this.filters.rotation.filter(metrics.rotation, timestampMs)
        };
    }

    reset() {
        Object.values(this.filters).forEach(filter => filter.reset());
    }
}
