"use client";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import GameLinksTable from "@/components/GameLinksTable";
import { useSearch } from "@/context/SearchContext";
import {
    getStoredJwt,
    listUserPurchases,
    PORTAL_AUTH_CHANGED_EVENT,
} from "@/lib/portalApi";

const PageMessage = styled.p`
    margin: 0;
    padding: 12px 0;
    color: rgb(var(--foreground));
`;

function formatDate(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString("ru-RU");
}

function mapPurchaseToGame(purchase) {
    const game = purchase.game || {};
    const purchaseDocumentId = purchase.documentId || purchase.document_id;
    const links = Array.isArray(purchase.links) ? purchase.links : [];
    const sourceLinks = links.length > 0
        ? links
        : [{
            id: `${purchaseDocumentId || purchase.id}-launch`,
            type: purchase.package_type,
            url: "#",
            start_date: purchase.start_date,
            end_date: purchase.end_date,
            purchaseDocumentId,
        }];

    return {
        gameId: game.slug || game.documentId || game.id || purchaseDocumentId,
        gameName: game.title || "Игра",
        gameType: game.game_type === "multiplayer" ? "multiplayer" : "single_player",
        purchaseDocumentId,
        links: sourceLinks.map((link) => ({
            id: link.documentId || link.id || `${purchaseDocumentId}-${link.type}`,
            date: formatDate(purchase.purchaseDate),
            url: link.url || "#",
            type: link.type || purchase.package_type,
            startDate: formatDate(link.start_date || purchase.start_date),
            endDate: formatDate(link.end_date || purchase.end_date),
            purchaseDocumentId,
            linkDocumentId: link.documentId,
        })),
    };
}

export default function MyGamesPage() {
    const { searchQuery } = useSearch();
    const [purchases, setPurchases] = useState([]);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let isMounted = true;

        const loadPurchases = async () => {
            const hasToken = Boolean(getStoredJwt());
            setIsAuthorized(hasToken);

            if (!hasToken) {
                setPurchases([]);
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            setError("");

            try {
                const nextPurchases = await listUserPurchases();
                if (isMounted) {
                    setPurchases(nextPurchases);
                }
            } catch (requestError) {
                if (isMounted) {
                    setError(requestError.message || "Не удалось загрузить покупки.");
                    setPurchases([]);
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        loadPurchases();
        window.addEventListener(PORTAL_AUTH_CHANGED_EVENT, loadPurchases);
        window.addEventListener("storage", loadPurchases);

        return () => {
            isMounted = false;
            window.removeEventListener(PORTAL_AUTH_CHANGED_EVENT, loadPurchases);
            window.removeEventListener("storage", loadPurchases);
        };
    }, []);


    const games = useMemo(() => purchases.map(mapPurchaseToGame), [purchases]);

    const filteredGames = games.filter(game =>
        game.gameName?.toLowerCase().includes(searchQuery.toLowerCase() || "")
    );

    if (!isAuthorized) {
        return <PageMessage>Войдите, чтобы увидеть свои покупки.</PageMessage>;
    }

    if (isLoading) {
        return <PageMessage>Загружаем покупки...</PageMessage>;
    }

    if (error) {
        return <PageMessage>{error}</PageMessage>;
    }

    return (
        <div>
            <GameLinksTable games={filteredGames} />
        </div>
    );
}
