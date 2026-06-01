/**
 * Embedded authoring sample for the ADR-034 editor prototype.
 *
 * The browser must not read repository files directly, so this value mirrors the
 * current `game.authoring.json` shape in a compact form: schema metadata,
 * `_definitions`, semantic root, state and deterministic actions.
 */
export const embeddedAuthoringSample = {
  $schema: "https://cubica.platform/schemas/game-authoring.v1.json",
  _schemaVersion: "1.0",
  _manifestType: "game",
  _definitions: {
    "game.EditorPrototypeManifest": {
      _semantics: "Compact authoring manifest used by editor-web to demonstrate synchronized graph, JSON and property editing.",
      meta: {
        id: "editor-prototype",
        version: "0.1.0",
        name: "Editor Prototype Sample",
        description: "Small deterministic flow used only as embedded editor data.",
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
        systemPrompt: "Run the editor prototype sample deterministically from the manifest."
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
      }
    },
    "game.AdvanceIntroAction": {
      _semantics: "Moves the sample from the opening brief to the choice screen.",
      handlerType: "manifest-data",
      capabilityFamily: "runtime.server",
      capability: "editor.sample.flow.advance",
      displayName: "Advance opening brief",
      deterministic: {
        guard: {
          timeline: {
            line: "main",
            stepIndex: 0,
            canAdvance: true
          }
        },
        effects: [
          {
            op: "timeline.set",
            canAdvance: false,
            stepIndex: 1,
            screenId: "S2"
          },
          {
            op: "ui.panel.open",
            panelId: "intro"
          }
        ]
      }
    },
    "game.AcceptClearPathAction": {
      _semantics: "Resolves the sample decision and records a visible metric change.",
      handlerType: "manifest-data",
      capabilityFamily: "runtime.server",
      capability: "editor.sample.choice.accept",
      displayName: "Accept clear path",
      deterministic: {
        effects: [
          {
            op: "metric.add",
            metricId: "confidence",
            delta: 2
          },
          {
            op: "metric.add",
            metricId: "risk",
            delta: 1
          },
          {
            op: "log.append",
            kind: "choice-resolution",
            entityType: "choice",
            displayMode: "summary",
            summary: "The player selected the clear path.",
            auditMetrics: true
          },
          {
            op: "timeline.set",
            canAdvance: false,
            stepIndex: 2,
            screenId: "S3"
          },
          {
            op: "ui.panel.open",
            panelId: "result"
          },
          {
            op: "state.patch",
            patches: [
              {
                op: "replace",
                path: "/public/choice/outcome",
                value: "accepted"
              }
            ]
          }
        ]
      }
    }
  },
  root: {
    _type: "game.EditorPrototypeManifest",
    actions: {
      "flow.intro.advance": {
        _type: "game.AdvanceIntroAction"
      },
      "choice.clear_path.accept": {
        _type: "game.AcceptClearPathAction"
      }
    }
  }
} as const;
