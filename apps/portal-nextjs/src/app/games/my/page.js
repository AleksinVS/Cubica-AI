"use client";
import linksData from "@/data/gameDataWithLinks.json";
import GameLinksTable from "@/components/GameLinksTable";
import { useSearch } from "@/context/SearchContext";

export default function MyGamesPage() {
    const { searchQuery } = useSearch();


    const filteredGames = linksData.filter(game =>
        game.gameName?.toLowerCase().includes(searchQuery.toLowerCase() || "")
    );

    return (
        <div>
            <GameLinksTable games={filteredGames} />
        </div>
    );
}
