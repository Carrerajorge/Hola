import { nativeDesktop, UIElement } from '../native';
import { elementDetector, FrameAnalysis } from './elementDetector';

export interface UnifiedUIState extends FrameAnalysis {
    accessibilityTree: UIElement[];
}

export class AccessibilityFusion {
    /**
     * Combina la información del Accessibility Tree nativo con
     * la detección visual del VLM para crear un mapa unificado
     * de la UI con máxima precisión.
     *
     * El AT da: roles, labels, values, states, actions
     * El VLM da: posición visual exacta, contexto semántico, OCR
     */
    async getUnifiedUIState(base64Frame: string): Promise<UnifiedUIState> {
        const [accessibilityTree, visionAnalysis] = await Promise.all([
            nativeDesktop.getFocusedElement().then(el => [el]).catch(() => []), // Abstracción simplificada del árbol
            elementDetector.analyzeFrame(base64Frame)
        ]);

        return this.merge(accessibilityTree, visionAnalysis);
    }

    private merge(accessibilityTree: UIElement[], visionAnalysis: FrameAnalysis): UnifiedUIState {
        // Fase 2: Mapeo de bounding boxes lógicos (SO) con visuales (VLM/OCR)
        const enrichedElements = [...visionAnalysis.uiElements];

        // Asignación rudimentaria de texto por superposición de Bounding Boxes
        for (const astNode of accessibilityTree) {
            if (!astNode.size || astNode.size.width === 0) continue;

            const [ax, ay, aw, ah] = [astNode.size.x, astNode.size.y, astNode.size.width, astNode.size.height];

            for (const visNode of enrichedElements) {
                if (!visNode.bbox) continue;
                const [vx, vy, vw, vh] = visNode.bbox;

                // Intersection Over Union (IoU) simple condition
                const isOverlapping = (
                    ax < vx + vw && ax + aw > vx &&
                    ay < vy + vh && ay + ah > vy
                );

                if (isOverlapping) {
                    visNode.logicalRole = astNode.role;
                    visNode.logicalId = astNode.id;
                }
            }
        }

        return {
            ...visionAnalysis,
            accessibilityTree,
            uiElements: enrichedElements
        };
    }
}

export const accessibilityFusion = new AccessibilityFusion();
