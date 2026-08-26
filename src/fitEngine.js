function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function round(value, decimals = 1) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function classifyEase(easeCm) {
    if (easeCm < -2) return 'demasiado ajustada';
    if (easeCm < 4) return 'entallada';
    if (easeCm < 12) return 'regular';
    if (easeCm < 22) return 'holgada';
    return 'oversize';
}

export class FitEngine {
    calculate(bodyProfile, garmentProfile) {
        if (!bodyProfile?.measurements) {
            throw new Error('Primero crea un perfil corporal.');
        }
        if (!garmentProfile?.measurements) {
            throw new Error('Primero analiza una prenda.');
        }

        const body = bodyProfile.measurements;
        const garment = garmentProfile.measurements;
        const stretchFraction = garmentProfile.stretch?.fraction ?? 0;

        const effectiveChest = garment.chestCircumferenceCm * (1 + stretchFraction);
        const effectiveWaist = garment.waistCircumferenceCm * (1 + stretchFraction);
        const chestEase = effectiveChest - body.chestCircumferenceCm;
        const waistEase = effectiveWaist - body.waistCircumferenceCm;

        const bodyTorsoTarget = body.torsoLengthCm * 1.18;
        const lengthDelta = garment.lengthCm - bodyTorsoTarget;
        const chestFit = classifyEase(chestEase);
        const waistFit = classifyEase(waistEase);

        const chestPenalty = chestEase < -4
            ? Math.abs(chestEase + 4) * 4
            : chestEase > 28
                ? (chestEase - 28) * 1.6
                : 0;
        const waistPenalty = waistEase < -4
            ? Math.abs(waistEase + 4) * 3
            : waistEase > 30
                ? (waistEase - 30) * 1.2
                : 0;
        const lengthPenalty = Math.abs(lengthDelta) > 18 ? (Math.abs(lengthDelta) - 18) * 1.3 : 0;
        const score = clamp(100 - chestPenalty - waistPenalty - lengthPenalty, 0, 100);

        const garmentToBodyChest = garment.chestCircumferenceCm / Math.max(body.chestCircumferenceCm, 1);
        const garmentToBodyLength = garment.lengthCm / Math.max(bodyTorsoTarget, 1);

        const notes = [];
        if (chestEase < 0) {
            notes.push(`La prenda tiene ${Math.abs(round(chestEase))} cm menos que el contorno de pecho estimado del cuerpo.`);
        } else {
            notes.push(`Hay aproximadamente ${round(chestEase)} cm de holgura efectiva en pecho.`);
        }
        if (waistEase < 0) {
            notes.push(`La cintura quedaría aproximadamente ${Math.abs(round(waistEase))} cm por debajo del contorno corporal estimado.`);
        } else {
            notes.push(`Hay aproximadamente ${round(waistEase)} cm de holgura efectiva en cintura.`);
        }
        if (Math.abs(lengthDelta) > 8) {
            notes.push(lengthDelta > 0
                ? `El largo es unos ${round(lengthDelta)} cm mayor que el largo objetivo del torso.`
                : `El largo es unos ${Math.abs(round(lengthDelta))} cm menor que el largo objetivo del torso.`);
        }

        const confidence = clamp(
            ((bodyProfile.confidence ?? 0.6) * 0.55) +
            ((garmentProfile.confidence ?? 0.6) * 0.45),
            0,
            1
        );

        return {
            version: 1,
            createdAt: new Date().toISOString(),
            chest: {
                bodyCm: round(body.chestCircumferenceCm),
                garmentCm: round(garment.chestCircumferenceCm),
                effectiveGarmentCm: round(effectiveChest),
                easeCm: round(chestEase),
                fit: chestFit
            },
            waist: {
                bodyCm: round(body.waistCircumferenceCm),
                garmentCm: round(garment.waistCircumferenceCm),
                effectiveGarmentCm: round(effectiveWaist),
                easeCm: round(waistEase),
                fit: waistFit
            },
            length: {
                bodyTargetCm: round(bodyTorsoTarget),
                garmentCm: round(garment.lengthCm),
                deltaCm: round(lengthDelta)
            },
            visual: {
                widthFactor: round(clamp(garmentToBodyChest, 0.86, 1.24), 3),
                heightFactor: round(clamp(garmentToBodyLength, 0.82, 1.25), 3),
                waistFactor: round(clamp(
                    garmentProfile.ratios?.waistToChest ?? bodyProfile.ratios?.waistToChest ?? 0.86,
                    0.62,
                    1.18
                ), 3)
            },
            score: Math.round(score),
            confidence: round(confidence, 2),
            label: chestFit,
            notes
        };
    }
}
