/**
 * Embedded authoring sample for the editor's repository-unavailable fallback.
 *
 * The browser cannot read repository files directly. This compact v2 source
 * therefore demonstrates the same public contract as a real game: UI-visible
 * actions bind to published Game Intents, while all authoritative mutation is
 * expressed by typed, transactional Cubica Mechanics IR. The compiler normally
 * derives each `planHash`; the editable authoring form intentionally omits it.
 */
export const embeddedAuthoringSample = {
  $schema: "https://cubica.platform/schemas/game-authoring.v2.json",
  _schemaVersion: "2.0",
  _manifestType: "game",
  _definitions: {
    "game.EditorInfoPrototype": {
      _semantics: "Reusable local authoring prototype for short informational content.",
      title: "",
      body: ""
    }
  },
  root: {
    _type: "game.EditorPrototypeManifest",
    _label: "Editor Prototype Sample",
    _semantics: "Compact authoring manifest used by editor-web to demonstrate synchronized graph, JSON and property editing.",
    meta: {
      id: "editor-prototype",
      version: "0.2.0",
      name: "Editor Prototype Sample",
      description: "Small manifest-driven flow used only as embedded editor data.",
      author: "Cubica",
      schemaVersion: "1.1",
      minEngineVersion: "0.1.0",
      training: {
        format: "single",
        duration: {
          minMinutes: 5,
          maxMinutes: 12
        },
        competencies: [
          {
            id: "decision-design",
            name: "Decision Design",
            description: "Models a clear decision and follow-up action."
          }
        ]
      }
    },
    config: {
      players: {
        min: 1,
        max: 1
      },
      settings: {
        mode: "singleplayer",
        locale: "en-US"
      }
    },
    content: {
      data: {
        infos: [
          {
            id: "intro",
            stepIndex: 0,
            screenId: "S1",
            title: "Opening Brief",
            body: "The author introduces the scenario and asks the player to inspect the first decision.",
            advanceActionId: "flow.intro.advance",
            advanceLabel: "Continue"
          },
          {
            id: "result",
            stepIndex: 2,
            screenId: "S3",
            title: "Result",
            body: "The player sees the consequence of the selected action.",
            advanceLabel: "Complete"
          }
        ],
        choices: [
          {
            id: "clear-path",
            title: "Take the clear path",
            summary: "A low-risk decision with a visible metric tradeoff.",
            actionId: "choice.clear_path.accept"
          }
        ]
      }
    },
    engine: {
      systemPrompt: "Run the editor prototype sample from its published action bindings and Mechanics IR plans."
    },
    state: {
      public: {
        timeline: {
          line: "main",
          stepIndex: 0,
          stageId: "stage_editor_sample",
          screenId: "S1",
          canAdvance: true
        },
        metrics: {
          confidence: 1,
          risk: 0
        },
        choice: {
          outcome: "pending"
        },
        log: []
      },
      secret: {}
    },
    logic: {
      _type: "game.Logic",
      _label: "Game logic",
      _semantics: "The visible flow and its published player actions.",
      flows: [
        {
          id: "main",
          _type: "game.Flow",
          _label: "Main flow",
          _semantics: "Opening, choice, and result steps of the embedded sample.",
          pattern: "pearl-string",
          steps: [
            {
              id: "main.intro",
              _type: "game.Step",
              _label: "Opening brief",
              screenId: "S1",
              actionIds: ["flow.intro.advance"],
              next: "main.choice"
            },
            {
              id: "main.choice",
              _type: "game.Step",
              _label: "Clear-path choice",
              screenId: "S2",
              actionIds: ["choice.clear_path.accept"],
              next: "main.result"
            },
            {
              id: "main.result",
              _type: "game.Step",
              _label: "Visible result",
              screenId: "S3",
              actionIds: []
            }
          ]
        }
      ],
      systems: [],
      rules: [],
      actions: [
        {
          id: "flow.intro.advance",
          _type: "game.Action",
          _label: "Advance opening brief",
          _semantics: "Moves the sample from the opening brief to the choice screen.",
          capabilityFamily: "runtime.server",
          capability: "editor.sample.flow.advance",
          displayName: "Advance opening brief",
          binding: {
            kind: "mechanics-plan",
            planRef: "flow.intro.advance"
          }
        },
        {
          id: "choice.clear_path.accept",
          _type: "game.Action",
          _label: "Accept clear path",
          _semantics: "Resolves the sample decision and records its visible metric tradeoff.",
          capabilityFamily: "runtime.server",
          capability: "editor.sample.choice.accept",
          displayName: "Accept clear path",
          binding: {
            kind: "mechanics-plan",
            planRef: "choice.clear_path.accept"
          }
        }
      ]
    },
    mechanics: {
      apiVersion: "cubica.dev/mechanics/v1alpha1",
      budgetProfile: "turn-based-standard-v1",
      moduleLock: {
        "cubica.core": {
          moduleId: "cubica.core",
          moduleVersion: "1.0.0",
          artifactHash: "sha256:903e9660e0702a0bffca5465bfb3742f7f8a80b0adae45f93b77637bf2f8770b"
        }
      },
      stateModel: {
        types: {
          "core.boolean": { kind: "boolean" },
          "core.string": { kind: "string" },
          "core.integer": {
            kind: "integer",
            minimum: -9007199254740991,
            maximum: 9007199254740991
          },
          "core.empty-record": {
            kind: "record",
            fields: {}
          }
        },
        endpoints: {
          "public.timeline.line": {
            audienceRef: "public",
            storage: { root: "public", segments: ["timeline", "line"] },
            valueType: "core.string",
            access: "read-write"
          },
          "public.timeline.stepIndex": {
            audienceRef: "public",
            storage: { root: "public", segments: ["timeline", "stepIndex"] },
            valueType: "core.integer",
            access: "read-write"
          },
          "public.timeline.screenId": {
            audienceRef: "public",
            storage: { root: "public", segments: ["timeline", "screenId"] },
            valueType: "core.string",
            access: "read-write"
          },
          "public.timeline.canAdvance": {
            audienceRef: "public",
            storage: { root: "public", segments: ["timeline", "canAdvance"] },
            valueType: "core.boolean",
            access: "read-write"
          },
          "public.metrics.confidence": {
            audienceRef: "public",
            storage: { root: "public", segments: ["metrics", "confidence"] },
            valueType: "core.integer",
            access: "read-write"
          },
          "public.metrics.risk": {
            audienceRef: "public",
            storage: { root: "public", segments: ["metrics", "risk"] },
            valueType: "core.integer",
            access: "read-write"
          },
          "public.choice.outcome": {
            audienceRef: "public",
            storage: { root: "public", segments: ["choice", "outcome"] },
            valueType: "core.string",
            access: "read-write"
          }
        },
        collections: {},
        events: {
          "editor.flow.advanced": {
            audienceRef: "public",
            payloadType: "core.empty-record"
          },
          "editor.choice.accepted": {
            audienceRef: "public",
            payloadType: "core.empty-record"
          }
        }
      },
      plans: {
        "flow.intro.advance": {
          transaction: {
            steps: [
              {
                id: "precondition",
                kind: "assert",
                op: "core.assert",
                predicate: {
                  op: "predicate.all",
                  items: [
                    {
                      op: "predicate.compare",
                      operator: "eq",
                      left: { op: "value.state", ref: { endpoint: "public.timeline.line" } },
                      right: { op: "value.literal", value: "main" }
                    },
                    {
                      op: "predicate.compare",
                      operator: "eq",
                      left: { op: "value.state", ref: { endpoint: "public.timeline.stepIndex" } },
                      right: { op: "value.literal", value: 0 }
                    },
                    {
                      op: "predicate.compare",
                      operator: "eq",
                      left: { op: "value.state", ref: { endpoint: "public.timeline.canAdvance" } },
                      right: { op: "value.literal", value: true }
                    }
                  ]
                },
                errorCode: "ACTION_PRECONDITION_FAILED"
              },
              {
                id: "advance",
                kind: "command",
                op: "core.state.patch",
                patches: [
                  {
                    operation: "set",
                    target: { endpoint: "public.timeline.canAdvance" },
                    value: { op: "value.literal", value: false }
                  },
                  {
                    operation: "set",
                    target: { endpoint: "public.timeline.stepIndex" },
                    value: { op: "value.literal", value: 1 }
                  },
                  {
                    operation: "set",
                    target: { endpoint: "public.timeline.screenId" },
                    value: { op: "value.literal", value: "S2" }
                  }
                ]
              },
              {
                id: "record",
                kind: "command",
                op: "core.event.emit",
                eventType: "editor.flow.advanced",
                summary: { op: "value.literal", value: "The opening brief was completed." },
                audience: "public"
              }
            ]
          }
        },
        "choice.clear_path.accept": {
          transaction: {
            steps: [
              {
                id: "precondition",
                kind: "assert",
                op: "core.assert",
                predicate: {
                  op: "predicate.compare",
                  operator: "eq",
                  left: { op: "value.state", ref: { endpoint: "public.timeline.stepIndex" } },
                  right: { op: "value.literal", value: 1 }
                },
                errorCode: "ACTION_PRECONDITION_FAILED"
              },
              {
                id: "confidence",
                kind: "command",
                op: "core.number.add",
                target: { endpoint: "public.metrics.confidence" },
                delta: { op: "value.literal", value: 2 }
              },
              {
                id: "risk",
                kind: "command",
                op: "core.number.add",
                target: { endpoint: "public.metrics.risk" },
                delta: { op: "value.literal", value: 1 }
              },
              {
                id: "resolve",
                kind: "command",
                op: "core.state.patch",
                patches: [
                  {
                    operation: "set",
                    target: { endpoint: "public.choice.outcome" },
                    value: { op: "value.literal", value: "accepted" }
                  },
                  {
                    operation: "set",
                    target: { endpoint: "public.timeline.stepIndex" },
                    value: { op: "value.literal", value: 2 }
                  },
                  {
                    operation: "set",
                    target: { endpoint: "public.timeline.screenId" },
                    value: { op: "value.literal", value: "S3" }
                  },
                  {
                    operation: "set",
                    target: { endpoint: "public.timeline.canAdvance" },
                    value: { op: "value.literal", value: false }
                  }
                ]
              },
              {
                id: "record",
                kind: "command",
                op: "core.event.emit",
                eventType: "editor.choice.accepted",
                summary: { op: "value.literal", value: "The player selected the clear path." },
                audience: "public",
                auditMetrics: true
              }
            ]
          }
        }
      }
    }
  }
} as const;
