import { OcclusionManager } from './occlusion.js';
import { TurnScanController, assignFileToInput } from './turnScan.js';

const video = document.getElementById('webcam-video');
const statusChip = document.getElementById('status-chip');
const turnScanButton = document.getElementById('turn-scan-button');
const occlusionToggle = document.getElementById('occlusion-toggle');
const frontInput = document.getElementById('front-photo');
const sideInput = document.getElementById('side-photo');
const backInput = document.getElementById('back-photo');
const analyzeProfileButton = document.getElementById('analyze-profile');
const heightInput = document.getElementById('height-cm');
const profileAnalysisStatus = document.getElementById('profile-analysis-status');

function setStatus(text, state = 'ready') {
    if (!statusChip) return;
    statusChip.textContent = text;
    statusChip.dataset.state = state;
}

const occlusion = new OcclusionManager(video, { targetFps: 8 });
const turnScanner = new TurnScanController(video);

occlusionToggle?.addEventListener('change', async () => {
    occlusionToggle.disabled = true;
    try {
        await occlusion.setEnabled(occlusionToggle.checked, message => {
            setStatus(message, occlusionToggle.checked ? 'loading' : 'ready');
        });
        setStatus(
            occlusionToggle.checked ? 'Oclusión brazos/manos activa' : 'Oclusión desactivada',
            'ready'
        );
    } catch (error) {
        console.error('No se pudo activar la oclusión:', error);
        occlusionToggle.checked = false;
        setStatus(error?.message || 'No se pudo activar la oclusión.', 'error');
    } finally {
        occlusionToggle.disabled = false;
    }
});

turnScanButton?.addEventListener('click', async () => {
    if (!video || video.readyState < 2) {
        setStatus('Primero inicia la cámara.', 'error');
        return;
    }

    turnScanButton.disabled = true;
    try {
        const result = await turnScanner.start({
            durationMs: 12000,
            onProgress: message => {
                if (profileAnalysisStatus) profileAnalysisStatus.textContent = message;
                setStatus(message, 'loading');
            }
        });

        assignFileToInput(frontInput, result.front);
        assignFileToInput(sideInput, result.side);
        assignFileToInput(backInput, result.back);

        setStatus('Escaneo 360° capturado', 'ready');
        if (profileAnalysisStatus) {
            profileAnalysisStatus.textContent = 'Frontal, lateral y posterior fueron capturadas automáticamente. Procesando perfil...';
        }

        const height = Number(heightInput?.value);
        if (Number.isFinite(height) && height >= 120 && height <= 230 && analyzeProfileButton) {
            analyzeProfileButton.click();
        } else if (profileAnalysisStatus) {
            profileAnalysisStatus.textContent = 'Escaneo 360° listo. Ingresa tu altura y pulsa “Escanear y construir perfil”.';
        }
    } catch (error) {
        console.error('Error en escaneo 360°:', error);
        setStatus(error?.message || 'No se pudo completar el escaneo 360°.', 'error');
        if (profileAnalysisStatus) profileAnalysisStatus.textContent = error?.message || 'Escaneo 360° interrumpido.';
    } finally {
        turnScanButton.disabled = false;
    }
});

window.addEventListener('beforeunload', () => {
    occlusion.destroy();
});
