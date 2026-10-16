import type { UuInvocation, UuPromptPlan, UuSection, UuPromptPresentation } from './types.js';
export declare const UU_HERMES_REFERENCE = "db44c46208f1b421b4ecb7e56bf9d68b0423906f";
export declare const UU_MAX_INPUT_CHARS: number;
export declare function uuSection(id: string, text: string, revision?: number | string): UuSection[];
/** Pure compiler: no IO, model selection, database access, logging, or mutable session state. */
export declare function compileUuPrompt(input: UuInvocation, presentation?: UuPromptPresentation): UuPromptPlan;
