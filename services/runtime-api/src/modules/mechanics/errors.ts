/** Stable non-secret failures produced by Mechanics IR execution. */
export class MechanicsExecutionError extends Error {
  readonly code: string;
  readonly stepId?: string;

  constructor(
    code: string,
    message: string,
    stepId?: string
  ) {
    super(message);
    this.name = "MechanicsExecutionError";
    this.code = code;
    if (stepId !== undefined) this.stepId = stepId;
  }
}
