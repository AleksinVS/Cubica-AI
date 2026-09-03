import HomeClient from "@/components/HomeClient";
import { getCatalogGames } from "@/lib/catalog";

export default async function Home() {
  const games = await getCatalogGames();
  return <HomeClient games={games} />;
}
