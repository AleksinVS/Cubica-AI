import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import {
  SESSION_VERSION_STREAM_DRAIN_TIMEOUT_MS,
  SessionVersionEventHub
} from "../src/modules/player-api/sessionVersionEventHub.ts";

class FakeResponse extends EventEmitter {
  readonly writes: string[] = [];
  readonly writeResults: boolean[];
  destroyed = false;
  writableEnded = false;

  constructor(writeResults: boolean[]) {
    super();
    this.writeResults = [...writeResults];
  }

  writeHead(): this {
    return this;
  }

  flushHeaders(): void {}

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return this.writeResults.shift() ?? true;
  }

  destroy(): this {
    this.destroyed = true;
    this.emit("close");
    return this;
  }

  end(): this {
    this.writableEnded = true;
    this.emit("close");
    return this;
  }
}

test("an initial write that never drains is disconnected after the bounded timeout", (context) => {
  context.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const hub = new SessionVersionEventHub();
  const response = new FakeResponse([false]);

  hub.subscribe(asServerResponse(response), version(0, 0));
  hub.publish(version(1, 1));
  assert.equal(response.writes.length, 1);
  assert.equal(response.destroyed, false);

  context.mock.timers.tick(SESSION_VERSION_STREAM_DRAIN_TIMEOUT_MS - 1);
  assert.equal(response.destroyed, false);
  context.mock.timers.tick(1);
  assert.equal(response.destroyed, true);
  assert.equal(hub.size, 0);
});

test("publish backpressure coalesces buffered notifications to the latest cursor", (context) => {
  context.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const hub = new SessionVersionEventHub();
  const response = new FakeResponse([true, false, true]);

  hub.subscribe(asServerResponse(response), version(0, 0));
  hub.publish(version(1, 1));
  hub.publish(version(2, 2));
  hub.publish(version(3, 4));
  assert.equal(response.writes.length, 2);

  response.emit("drain");
  assert.equal(response.writes.length, 3);
  assert.match(response.writes[2], /"stateVersion":3,"lastEventSequence":4/u);
  assert.doesNotMatch(response.writes.join(""), /"stateVersion":2/u);

  context.mock.timers.tick(SESSION_VERSION_STREAM_DRAIN_TIMEOUT_MS);
  assert.equal(response.destroyed, false);
  hub.close();
});

test("heartbeat backpressure suppresses writes until drain and then flushes the latest cursor", (context) => {
  context.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const hub = new SessionVersionEventHub();
  const response = new FakeResponse([true, false, true]);

  hub.subscribe(asServerResponse(response), version(0, 0));
  context.mock.timers.tick(20_000);
  assert.equal(response.writes[1], ": keepalive\n\n");

  hub.publish(version(1, 1));
  hub.publish(version(2, 3));
  assert.equal(response.writes.length, 2);
  response.emit("drain");
  assert.match(response.writes[2], /"stateVersion":2,"lastEventSequence":3/u);
  hub.close();
});

function asServerResponse(response: FakeResponse): ServerResponse {
  return response as unknown as ServerResponse;
}

function version(stateVersion: number, lastEventSequence: number) {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    stateVersion,
    lastEventSequence
  };
}
