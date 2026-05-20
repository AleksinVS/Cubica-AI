import { ANTARCTICA_GAME_CONFIG_DATA } from "@/presenter/antarctica-config-data";
import { GamePlayer } from "@/components/game-player";
import { getRuntimeApiUrl, loadGamePlayerContent } from "@/lib/game-content-resolvers";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{
    gameId?: string;
  }>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const gameId = params?.gameId || "antarctica";
  const content = await loadGamePlayerContent(gameId);

  return (
    <GamePlayer
      runtimeApiUrl={getRuntimeApiUrl()}
      content={content}
      mockups={content.mockups}
      gameUi={content.ui}
      config={ANTARCTICA_GAME_CONFIG_DATA}
    />
  );
}
