/** Hermes reference: db44c46208f1b421b4ecb7e56bf9d68b0423906f. */
export type UuProfile = 'conversation' | 'task' | 'inference';
export type UuLayerId = 'identity' | 'tools' | 'external-memory' | 'instructions' | 'memory' | 'user' | 'skills' | 'project';
export interface UuSection { id: string; text: string; revision?: number | string; source?: string }
export type UuLayers = Partial<Record<UuLayerId, UuSection[]>>;
export interface UuEvidence extends UuSection { optional?: boolean }
export interface UuContextReference {
  schemaVersion: 1;
  source: string;
  entityId: string;
  sourceIdentity?: string;
  start?: string;
  end?: string;
  revision?: string;
}
export interface UuInvocation {
  profile: UuProfile;
  surfaceId?: string;
  layers?: UuLayers;
  turn: { text: string; history?: Array<{ role: 'user' | 'assistant'; content: string }>; evidence?: UuEvidence[] };
  /** Source reading remains in the Host. Rules must already be scoped and validated. */
  projectRules?: 'discover' | 'provided' | 'none';
  /** Explicit epoch boundary: legacy session migration, approved bundle change, or stage transition. */
  rebuildInstructions?: boolean;
  maxInputChars?: number;
  /** Explicit local inspection command. Never inferred by the model. */
  inspectContext?: 'summary' | 'full';
  layerReasons?: Partial<Record<UuLayerId, string>>;
}
export interface UuPromptPlan {
  schemaVersion: 1;
  developerInstructions: string;
  userInput: string;
  tiers: { stable: string; context: string; volatile: string };
  manifest: Array<{ layerId: UuLayerId; status: 'included' | 'empty' | 'disabled'; reason?: string; sectionCount: number; chars: number; sections: Array<{ id: string; source?: string; revision?: number | string; chars: number }> }>;
  coverage: Array<{ id: string; status: 'included' | 'truncated' | 'omitted'; chars: number }>;
}
export interface UuDriver<Request, Result> { run(request: Request, signal?: AbortSignal): Promise<Result> }

/** Presentation comes from the Host, never from recalled source content. */
export interface UuPromptPresentation { assemblyIntroduction?: string }
export interface UuInspectionPresentation {
  introduction?: string;
  policy?: string;
  fullIntroduction?: string;
  summaryInstruction?: string;
}
