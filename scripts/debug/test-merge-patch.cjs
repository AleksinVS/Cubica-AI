const { applyJsonMergePatch } = require("@cubica/sdk-core");

const currentSession = {
  sessionId: "test",
  gameId: "antarctica",
  state: {
    public: {
      metrics: { time: 0 },
      log: []
    }
  },
  version: { stateVersion: 0, lastEventSequence: 0 }
};

const next1 = {
  sessionId: "test",
  version: { stateVersion: 1, lastEventSequence: 1 },
  state: {
    public: {
      metrics: { time: 5, pro: 8 },
      log: [
        { actionId: "opening.card.1", kind: "opening-card-resolution", metricsBefore: { time: 0 }, metricsAfter: { time: 5 } }
      ]
    }
  }
};

const merged1 = applyJsonMergePatch(currentSession, next1);
console.log("After first merge, log length:", merged1.state.public.log.length);

const next2 = {
  sessionId: "test",
  version: { stateVersion: 2, lastEventSequence: 2 },
  state: {
    public: {
      metrics: { time: 7, pro: 8 },
      log: [
        { actionId: "opening.card.1", kind: "opening-card-resolution", metricsBefore: { time: 0 }, metricsAfter: { time: 5 } },
        { actionId: "opening.card.2", kind: "opening-card-resolution", metricsBefore: { time: 5 }, metricsAfter: { time: 7 } }
      ]
    }
  }
};

const merged2 = applyJsonMergePatch(merged1, next2);
console.log("After second merge, log length:", merged2.state.public.log.length);
console.log("Entries:", merged2.state.public.log.map(e => e.actionId));
