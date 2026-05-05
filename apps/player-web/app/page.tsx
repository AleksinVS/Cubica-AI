import { GamePlayer } from "@/components/game-player";
import { getRuntimeApiUrl, loadGamePlayerContent } from "@/lib/game-content-resolvers";

export const dynamic = "force-dynamic";

export default async function Page() {
  const content = await loadGamePlayerContent("antarctica");

  return (
    <GamePlayer
      runtimeApiUrl={getRuntimeApiUrl()}
      content={content}
      mockups={content.mockups}
      gameUi={content.ui}
    />
  );
}
