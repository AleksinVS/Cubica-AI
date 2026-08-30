/**
 * Bounded admission control for new authenticated gameplay commands.
 *
 * Admission control is the early resource-protection boundary: it limits how
 * often one authenticated principal can submit new commands for one session,
 * and applies stricter rate and cost budgets before an Agent Runtime is called.
 * Durable receipt retries deliberately bypass this controller at the caller.
 */
import { HttpError } from "../errors.ts";

export type CommandAdmissionKind = "game-intent" | "agent-turn";

export interface CommandAdmissionRequest {
  readonly sessionId: string;
  readonly principalId: string;
  readonly commandId: string;
  readonly kind: CommandAdmissionKind;
  /**
   * Trusted estimated cost units for an AI call. The current adapter charges
   * one unit per turn; future provider adapters can supply a reviewed estimate.
   */
  readonly costUnits?: number;
}

/**
 * Injectable seam for a process-local controller today and a shared backend
 * when runtime-api is deployed with more than one command-serving process.
 */
export interface CommandAdmissionController {
  assertNewCommandAdmitted(request: CommandAdmissionRequest): Promise<void>;
}

export interface CommandAdmissionWindowPolicy {
  readonly limit: number;
  readonly windowMs: number;
}

export interface CommandAdmissionPolicy {
  /** Applies to every new mutating command, including Agent Turns. */
  readonly commandRate: CommandAdmissionWindowPolicy;
  /** Additional, deliberately stricter call-rate limit for Agent Turns. */
  readonly agentTurnRate: CommandAdmissionWindowPolicy;
  /** Additional weighted cost budget for Agent Turns. */
  readonly agentTurnCost: CommandAdmissionWindowPolicy;
  /** Maximum simultaneously active principal/session subjects in memory. */
  readonly maxSubjects: number;
}

export interface InMemoryCommandAdmissionControllerOptions {
  readonly policy?: CommandAdmissionPolicy;
  /** Monotonic-test seam. Production uses wall-clock milliseconds. */
  readonly now?: () => number;
}

export const DEFAULT_COMMAND_ADMISSION_POLICY: CommandAdmissionPolicy = Object.freeze({
  commandRate: Object.freeze({ limit: 120, windowMs: 60_000 }),
  agentTurnRate: Object.freeze({ limit: 6, windowMs: 60_000 }),
  agentTurnCost: Object.freeze({ limit: 30, windowMs: 60 * 60_000 }),
  maxSubjects: 10_000
});

export const COMMAND_ADMISSION_CODES = Object.freeze({
  commandRate: "COMMAND_RATE_LIMITED",
  agentTurnRate: "AGENT_TURN_RATE_LIMITED",
  agentTurnCost: "AGENT_TURN_COST_QUOTA_EXCEEDED",
  capacity: "COMMAND_ADMISSION_CAPACITY_EXCEEDED"
} as const);

type CommandAdmissionCode = typeof COMMAND_ADMISSION_CODES[keyof typeof COMMAND_ADMISSION_CODES];

/** HTTP 429 with a stable code and a safe integer Retry-After value. */
export class CommandAdmissionRejectedError extends HttpError {
  readonly retryAfterSeconds: number;

  constructor(code: CommandAdmissionCode, retryAfterSeconds: number) {
    super(429, admissionMessage(code), code);
    this.name = "CommandAdmissionRejectedError";
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

interface WindowCounter {
  windowStartedAtMs: number;
  used: number;
}

interface SubjectCounters {
  commandRate?: WindowCounter;
  agentTurnRate?: WindowCounter;
  agentTurnCost?: WindowCounter;
}

interface PendingCharge {
  readonly counterName: keyof SubjectCounters;
  readonly policy: CommandAdmissionWindowPolicy;
  readonly amount: number;
  readonly code: CommandAdmissionCode;
}

/**
 * Single-process fixed-window implementation with fail-closed bounded memory.
 *
 * Expired subjects are evicted before a new subject is admitted. If every
 * retained subject is still active, a new subject is rejected instead of
 * evicting an active limiter entry and thereby allowing quota evasion.
 */
export class BoundedInMemoryCommandAdmissionController implements CommandAdmissionController {
  private readonly policy: CommandAdmissionPolicy;
  private readonly now: () => number;
  private readonly subjects = new Map<string, SubjectCounters>();

  constructor(options: InMemoryCommandAdmissionControllerOptions = {}) {
    this.policy = options.policy ?? DEFAULT_COMMAND_ADMISSION_POLICY;
    this.now = options.now ?? Date.now;
    assertPolicy(this.policy);
  }

  async assertNewCommandAdmitted(request: CommandAdmissionRequest): Promise<void> {
    assertRequest(request);
    const nowMs = this.now();
    if (!Number.isFinite(nowMs)) {
      throw new Error("Command admission clock must return finite milliseconds");
    }

    const subjectKey = JSON.stringify([request.sessionId, request.principalId]);
    let counters = this.subjects.get(subjectKey);
    if (counters === undefined) {
      this.evictExpiredSubjects(nowMs);
      if (this.subjects.size >= this.policy.maxSubjects) {
        throw new CommandAdmissionRejectedError(
          COMMAND_ADMISSION_CODES.capacity,
          this.retryAfterForCapacity(nowMs)
        );
      }
      counters = {};
    }

    const charges: PendingCharge[] = [{
      counterName: "commandRate",
      policy: this.policy.commandRate,
      amount: 1,
      code: COMMAND_ADMISSION_CODES.commandRate
    }];
    if (request.kind === "agent-turn") {
      charges.push({
        counterName: "agentTurnRate",
        policy: this.policy.agentTurnRate,
        amount: 1,
        code: COMMAND_ADMISSION_CODES.agentTurnRate
      }, {
        counterName: "agentTurnCost",
        policy: this.policy.agentTurnCost,
        amount: request.costUnits ?? 1,
        code: COMMAND_ADMISSION_CODES.agentTurnCost
      });
    }

    // Evaluate all budgets before mutating any one of them. A request rejected
    // by the stricter AI quota must not silently consume the general quota.
    const normalized = charges.map((charge) => ({
      charge,
      counter: currentWindow(counters![charge.counterName], charge.policy, nowMs)
    }));
    for (const { charge, counter } of normalized) {
      if (counter.used + charge.amount > charge.policy.limit) {
        throw new CommandAdmissionRejectedError(
          charge.code,
          retryAfterSeconds(counter, charge.policy, nowMs)
        );
      }
    }

    for (const { charge, counter } of normalized) {
      counters[charge.counterName] = {
        windowStartedAtMs: counter.windowStartedAtMs,
        used: counter.used + charge.amount
      };
    }
    this.subjects.set(subjectKey, counters);
  }

  /** Visible for focused regression tests and operational diagnostics. */
  activeSubjectCount(): number {
    return this.subjects.size;
  }

  private evictExpiredSubjects(nowMs: number): void {
    for (const [key, counters] of this.subjects) {
      if (subjectExpired(counters, this.policy, nowMs)) {
        this.subjects.delete(key);
      }
    }
  }

  private retryAfterForCapacity(nowMs: number): number {
    let earliestExpiryMs = Number.POSITIVE_INFINITY;
    for (const counters of this.subjects.values()) {
      earliestExpiryMs = Math.min(earliestExpiryMs, subjectExpiryMs(counters, this.policy));
    }
    return Number.isFinite(earliestExpiryMs)
      ? Math.max(1, Math.ceil((earliestExpiryMs - nowMs) / 1_000))
      : 1;
  }
}

function currentWindow(
  counter: WindowCounter | undefined,
  policy: CommandAdmissionWindowPolicy,
  nowMs: number
): WindowCounter {
  if (counter === undefined || nowMs >= counter.windowStartedAtMs + policy.windowMs) {
    return { windowStartedAtMs: nowMs, used: 0 };
  }
  return counter;
}

function retryAfterSeconds(
  counter: WindowCounter,
  policy: CommandAdmissionWindowPolicy,
  nowMs: number
): number {
  return Math.max(1, Math.ceil((counter.windowStartedAtMs + policy.windowMs - nowMs) / 1_000));
}

function subjectExpired(counters: SubjectCounters, policy: CommandAdmissionPolicy, nowMs: number): boolean {
  return subjectExpiryMs(counters, policy) <= nowMs;
}

function subjectExpiryMs(counters: SubjectCounters, policy: CommandAdmissionPolicy): number {
  return Math.max(
    counterExpiryMs(counters.commandRate, policy.commandRate),
    counterExpiryMs(counters.agentTurnRate, policy.agentTurnRate),
    counterExpiryMs(counters.agentTurnCost, policy.agentTurnCost)
  );
}

function counterExpiryMs(counter: WindowCounter | undefined, policy: CommandAdmissionWindowPolicy): number {
  return counter === undefined ? Number.NEGATIVE_INFINITY : counter.windowStartedAtMs + policy.windowMs;
}

function assertPolicy(policy: CommandAdmissionPolicy): void {
  assertWindowPolicy(policy.commandRate, "commandRate");
  assertWindowPolicy(policy.agentTurnRate, "agentTurnRate");
  assertWindowPolicy(policy.agentTurnCost, "agentTurnCost");
  if (!Number.isSafeInteger(policy.maxSubjects) || policy.maxSubjects < 1) {
    throw new Error("Command admission maxSubjects must be a positive safe integer");
  }
}

function assertWindowPolicy(policy: CommandAdmissionWindowPolicy, label: string): void {
  if (!Number.isSafeInteger(policy.limit) || policy.limit < 1) {
    throw new Error(`Command admission ${label}.limit must be a positive safe integer`);
  }
  if (!Number.isSafeInteger(policy.windowMs) || policy.windowMs < 1) {
    throw new Error(`Command admission ${label}.windowMs must be a positive safe integer`);
  }
}

function assertRequest(request: CommandAdmissionRequest): void {
  if (request.sessionId.length === 0 || request.principalId.length === 0 || request.commandId.length === 0) {
    throw new Error("Command admission identity fields must be non-empty");
  }
  if (request.costUnits !== undefined && (!Number.isSafeInteger(request.costUnits) || request.costUnits < 1)) {
    throw new Error("Command admission costUnits must be a positive safe integer");
  }
}

function admissionMessage(code: CommandAdmissionCode): string {
  switch (code) {
    case COMMAND_ADMISSION_CODES.commandRate:
      return "Too many new commands for this session principal.";
    case COMMAND_ADMISSION_CODES.agentTurnRate:
      return "Too many new Agent Turns for this session principal.";
    case COMMAND_ADMISSION_CODES.agentTurnCost:
      return "Agent Turn cost quota is exhausted for this session principal.";
    case COMMAND_ADMISSION_CODES.capacity:
      return "Command admission capacity is temporarily exhausted.";
  }
}
