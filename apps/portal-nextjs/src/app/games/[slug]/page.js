import { notFound } from "next/navigation";
import GameDetailsClient from "@/components/GameDetailsClient";
import { getCatalogGame } from "@/lib/catalog";

export async function generateMetadata({ params }) {
    const { slug } = await params;
    const game = await getCatalogGame(slug);

    return {
        title: game ? `Страница игры ${game.title}` : "Игра не найдена",
    };
}

export default async function GamePage({ params }) {
    const { slug } = await params;
    const game = await getCatalogGame(slug);

    if (!game) {
        notFound();
    }

    return <GameDetailsClient game={game} />;
}
