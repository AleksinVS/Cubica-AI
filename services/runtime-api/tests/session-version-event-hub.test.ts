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

  hub.subscribe(asServerResponse(response), version(0, 0), "principal-a");
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

  hub.subscribe(asServerResponse(response), version(0, 0), "principal-a");
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

  hub.subscribe(asServerResponse(response), version(0, 0), "principal-a");
  context.mock.timers.tick(20_000);
  assert.equal(response.writes[1], ": keepalive\n\n");

  hub.publish(version(1, 1));
  hub.publish(version(2, 3));
  assert.equal(response.writes.length, 2);
  response.emit("drain");
  assert.match(response.writes[2], /"stateVersion":2,"lastEventSequence":3/u);
  hub.close();
});

test("a second stream for the same session principal replaces and closes the first", () => {
  const hub = new SessionVersionEventHub(2);
  const first = new FakeResponse([true]);
  const second = new FakeResponse([true]);

  const cleanupFirst = hub.subscribe(asServerResponse(first), version(0, 0), "principal-a");
  const cleanupSecond = hub.subscribe(asServerResponse(second), version(1, 1), "principal-a");

  assert.equal(first.writableEnded, true);
  assert.equal(second.writableEnded, false);
  assert.equal(hub.size, 1);
  cleanupFirst();
  assert.equal(hub.size, 1, "stale cleanup must not remove the replacement stream");
  cleanupSecond();
  assert.equal(hub.size, 0);
});

test("credential rotation disconnects only the matching principal stream", () => {
  const hub = new SessionVersionEventHub(2);
  const revoked = new FakeResponse([true]);
  const peer = new FakeResponse([true]);

  hub.subscribe(asServerResponse(revoked), version(2, 4), "principal-a");
  hub.subscribe(asServerResponse(peer), version(2, 4), "principal-b");

  assert.equal(hub.disconnectPrincipal(version(0, 0).sessionId, "principal-a"), true);
  assert.equal(revoked.writableEnded, true);
  assert.equal(peer.writableEnded, false);
  assert.equal(hub.size, 1);
  assert.equal(hub.disconnectPrincipal(version(0, 0).sessionId, "principal-a"), false);
  hub.close();
});

test("credential rotation invalidates an in-flight principal stream reservation", () => {
  const hub = new SessionVersionEventHub(2);
  const response = new FakeResponse([true]);
  const reservation = hub.reservePrincipal(version(0, 0).sessionId, "principal-a");

  assert.equal(hub.disconnectPrincipal(version(0, 0).sessionId, "principal-a"), true);
  assert.throws(
    () => hub.subscribeReserved(asServerResponse(response), version(0, 0), reservation),
    { name: "SessionVersionStreamReservationInvalidError" }
  );
  assert.equal(response.writes.length, 0);
  assert.equal(hub.size, 0);
});

test("stale reservation cleanup cannot cancel a newer reservation", () => {
  const hub = new SessionVersionEventHub(2);
  const stale = hub.reservePrincipal(version(0, 0).sessionId, "principal-a");
  const current = hub.reservePrincipal(version(0, 0).sessionId, "principal-a");
  const response = new FakeResponse([true]);

  hub.cancelReservation(stale);
  hub.subscribeReserved(asServerResponse(response), version(0, 0), current);
  assert.equal(hub.size, 1);
  hub.close();
});

test("global capacity counts distinct principals and still permits replacement at capacity", () => {
  const hub = new SessionVersionEventHub(2);
  const first = new FakeResponse([true]);
  const second = new FakeResponse([true]);
  const replacement = new FakeResponse([true]);

  hub.subscribe(asServerResponse(first), version(0, 0), "principal-a");
  hub.subscribe(asServerResponse(second), version(0, 0), "principal-b");
  assert.throws(
    () => hub.subscribe(asServerResponse(new FakeResponse([true])), version(0, 0), "principal-c"),
    { name: "SessionVersionStreamCapacityError" }
  );
  assert.equal(hub.size, 2);

  hub.subscribe(asServerResponse(replacement), version(0, 0), "principal-a");
  assert.equal(first.writableEnded, true);
  assert.equal(hub.size, 2);
  hub.close();
  assert.equal(hub.size, 0);
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
