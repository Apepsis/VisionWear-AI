export class ScanAnimation {
    constructor({ root, status, progressBar, stageLabel }) {
        this.root = root;
        this.status = status;
        this.progressBar = progressBar;
        this.stageLabel = stageLabel;
        this.progress = 0;
    }

    setProgress(value) {
        this.progress = Math.max(0, Math.min(100, value));
        if (this.progressBar) this.progressBar.style.width = `${this.progress}%`;
    }

    start(label = 'Iniciando escaneo...') {
        this.root?.classList.add('is-scanning');
        this.root?.classList.remove('scan-complete', 'scan-error');
        if (this.status) this.status.textContent = label;
        if (this.stageLabel) this.stageLabel.textContent = 'Analizando';
        this.setProgress(8);
    }

    update(message = '') {
        if (this.status && message) this.status.textContent = message;
        const text = String(message).toLowerCase();
        let next = this.progress + 9;

        if (text.includes('leyendo')) next = Math.max(next, 18);
        if (text.includes('detectando')) next = Math.max(next, 34);
        if (text.includes('segment')) next = Math.max(next, 52);
        if (text.includes('silueta') || text.includes('fondo')) next = Math.max(next, 64);
        if (text.includes('propor') || text.includes('medid')) next = Math.max(next, 78);
        if (text.includes('ajuste') || text.includes('fit')) next = Math.max(next, 88);
        if (text.includes('lista') || text.includes('listo') || text.includes('estimado')) next = Math.max(next, 94);

        this.setProgress(Math.min(next, 96));
    }

    complete(label = 'Escaneo completado') {
        this.root?.classList.remove('is-scanning', 'scan-error');
        this.root?.classList.add('scan-complete');
        if (this.status) this.status.textContent = label;
        if (this.stageLabel) this.stageLabel.textContent = 'Completo';
        this.setProgress(100);
    }

    fail(message = 'No se pudo completar el análisis') {
        this.root?.classList.remove('is-scanning', 'scan-complete');
        this.root?.classList.add('scan-error');
        if (this.status) this.status.textContent = message;
        if (this.stageLabel) this.stageLabel.textContent = 'Error';
        this.setProgress(100);
    }

    reset() {
        this.root?.classList.remove('is-scanning', 'scan-complete', 'scan-error');
        if (this.stageLabel) this.stageLabel.textContent = 'Listo';
        this.setProgress(0);
    }
}
