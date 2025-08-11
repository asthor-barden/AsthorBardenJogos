// Variáveis para suavização
let previousWristSize = null;
const DEPTH_SMOOTHING = 0.7; // Fator de suavização para evitar movimentos bruscos

function processHandResults(results) {
    // Limpar canvas de saída
    outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    outputCtx.save();
    outputCtx.scale(-1, 1);
    outputCtx.translate(-outputCanvas.width, 0);
    
    // Desenhar vídeo
    outputCtx.drawImage(
        results.image, 0, 0, outputCanvas.width, outputCanvas.height);
    
    // Desenhar landmarks se mão detectada
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        for (const landmarks of results.multiHandLandmarks) {
            self.drawConnectors(
                outputCtx, landmarks, self.HAND_CONNECTIONS,
                {color: '#00FF00', lineWidth: 2});
            self.drawLandmarks(outputCtx, landmarks, {
                color: '#FF0000',
                lineWidth: 1,
                radius: 4
            });
            
            // Destacar o ponto de controle da palma
            const palmCenter = calculatePalmCenter(landmarks);
            drawControlPoint(outputCtx, palmCenter);
        }
        
        // Processar a primeira mão detectada
        processHandData(results.multiHandLandmarks[0]);
    } else {
        // Nenhuma mão detectada
        gripperStatusText.textContent = "Aguardando mão";
    }
    
    outputCtx.restore();
}

function calculatePalmCenter(landmarks) {
    // Usar pontos específicos da palma para criar um centro estável
    // Pontos da palma: 0 (pulso), 5, 9, 13, 17 (base dos dedos)
    const palmPoints = [
        landmarks[0],  // Pulso
        landmarks[5],  // Base do polegar
        landmarks[9],  // Base do indicador
        landmarks[13], // Base do médio
        landmarks[17]  // Base do mindinho
    ];
    
    let xSum = 0, ySum = 0;
    for (const point of palmPoints) {
        xSum += point.x;
        ySum += point.y;
    }
    
    return {
        x: xSum / palmPoints.length,
        y: ySum / palmPoints.length
    };
}

function drawControlPoint(ctx, point) {
    // Desenhar um círculo destacado no ponto de controle
    const x = point.x * outputCanvas.width;
    const y = point.y * outputCanvas.height;
    
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, 2 * Math.PI);
    ctx.fillStyle = '#00FFFF'; // Ciano para destacar
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function calculateStableDepth(landmarks) {
    // Usar distância do punho às bases dos dedos (não afetada por pinça)
    const wrist = landmarks[0];
    const basePoints = [
        landmarks[5],  // Base do indicador  
        landmarks[9],  // Base do médio
        landmarks[13], // Base do anelar
        landmarks[17]  // Base do mindinho
    ];
    
    // Calcular distância média do punho às bases dos dedos
    let totalDistance = 0;
    for (const point of basePoints) {
        const distance = Math.sqrt(
            Math.pow(wrist.x - point.x, 2) + 
            Math.pow(wrist.y - point.y, 2)
        );
        totalDistance += distance;
    }
    
    return totalDistance / basePoints.length;
}

function smoothDepthValue(newValue) {
    if (previousWristSize === null) {
        previousWristSize = newValue;
        return newValue;
    }
    
    // Aplicar filtro passa-baixa para suavizar movimentos
    const smoothedValue = previousWristSize * DEPTH_SMOOTHING + newValue * (1 - DEPTH_SMOOTHING);
    previousWristSize = smoothedValue;
    
    return smoothedValue;
}

function detectPinchGesture(landmarks) {
    // === USAR A FÓRMULA ORIGINAL QUE FUNCIONAVA BEM ===
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    
    // Fórmula original com potência 4 (mais sensível)
    const distance = Math.sqrt(
        Math.pow(thumbTip.x - indexTip.x, 4) + 
        Math.pow(thumbTip.y - indexTip.y, 4)
    );
    
    // Usar o limiar original que funcionava bem
    return distance < 0.05;
}

function processHandData(landmarks) {
    // === USAR CENTRO DA PALMA PARA CONTROLE ===
    const palmCenter = calculatePalmCenter(landmarks);
    
    // === CONTROLE DE PROFUNDIDADE ESTÁVEL ===
    const rawDepth = calculateStableDepth(landmarks);
    const smoothedDepth = smoothDepthValue(rawDepth);
    
    // === CALCULAR VALORES DOS SERVOS ===
    
    // Controle horizontal (rotação da base) - baseado na posição X da palma
    let servoBase;
    if (invertHorizontal) {
        servoBase = mapValue(palmCenter.x, 0.2, 0.8, 30, 330);
    } else {
        servoBase = mapValue(palmCenter.x, 0.2, 0.8, 330, 30);
    }
    
    // Controle vertical (ombro) - baseado na posição Y da palma
    const servoShoulder = mapValue(palmCenter.y, 0.2, 0.8, 270, 180);
    
    // Controle de profundidade (cotovelo) - baseado na distância estável do punho
    const servoElbow = mapValue(smoothedDepth, 0.08, 0.25, 100, -10);
    
    // === DETECÇÃO DE PINÇA COM FÓRMULA ORIGINAL ===
    const isPinching = detectPinchGesture(landmarks);
    const servoGripper = isPinching ? 110 : 180;
    
    // === ATUALIZAR VALORES NA UI ===
    baseValue.textContent = `${Math.round(servoBase)}°`;
    shoulderValue.textContent = `${Math.round(servoShoulder)}°`;
    elbowValue.textContent = `${Math.round(servoElbow)}°`;
    
    if (servoGripper === 110) {
        gripperValue.textContent = "Fechada";
        gripperStatusText.textContent = "Fechada";
        gripperIndicator.className = "gripper-indicator gripper-closed";
    } else {
        gripperValue.textContent = "Aberta";
        gripperStatusText.textContent = "Aberta";
        gripperIndicator.className = "gripper-indicator gripper-open";
    }
    
    // Atualizar ângulos do braço
    armAngles = {
        base: servoBase,
        shoulder: servoShoulder,
        elbow: servoElbow,
        gripper: servoGripper
    };
    
    // Atualizar o braço robótico 3D
    updateRobotArm();
}

// Função auxiliar para mapear valores (mantida igual)
function mapValue(value, inMin, inMax, outMin, outMax) {
    const clampedValue = Math.max(inMin, Math.min(inMax, value));
    return outMin + (clampedValue - inMin) * (outMax - outMin) / (inMax - inMin);
}