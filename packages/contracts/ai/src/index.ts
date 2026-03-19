export interface AiTaskEnvelope<TInput = unknown> {
  taskType: string;
  input: TInput;
  context?: Record<string, unknown>;
}

export interface AiTaskResult<TOutput = unknown> {
  ok: boolean;
  output?: TOutput;
  model?: string;
  error?: {
    code: string;
    message: string;
  };
}
