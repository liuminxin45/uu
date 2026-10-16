import type { UuPromptPlan, UuInspectionPresentation } from './types.js';
export declare function uuInspectionCommand(text: string): 'summary' | 'full' | undefined;
export declare function renderUuInspection(plan: UuPromptPlan, full: boolean, presentation?: UuInspectionPresentation): string;
