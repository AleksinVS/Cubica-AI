import { NextResponse } from 'next/server';
import { loadLocalFixture } from '../../utils/localDataLoader';

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action ?? 'StartGame';
  const fixtureKey = body?.fixtureKey ?? body?.payload?.fixtureKey;
  const patchMode = body?.patchMode;

  if (action === 'StartGame') {
    const manifest = loadLocalFixture(fixtureKey);
    return NextResponse.json({ state: manifest });
  }

  if (action === 'requestServer') {
    const score = Math.floor(Math.random() * 100);

    if (patchMode === 'jsonPatch') {
      return NextResponse.json({
        jsonPatch: [
          { op: 'replace', path: '/game/state/public/metrics/score', value: score }
        ]
      });
    }

    return NextResponse.json({
      mergePatch: {
        game: {
          state: {
            public: {
              metrics: {
                score,
              },
            },
          },
        },
      },
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
