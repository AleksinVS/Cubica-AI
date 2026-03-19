"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styled from "styled-components";
import { useEffect, useState } from "react";
import { games } from "@/data/games";

const BreadcrumbContainer = styled.nav`
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgb(var(--foreground));
`;

const BreadcrumbLink = styled(Link)`
  color: rgb(var(--theme-yellow));
  text-decoration: none;
  transition: color 0.3s ease-in-out;

  &:hover {
    color: rgb(var(--foreground));
  }
`;

const ActiveBreadcrumb = styled.span`
  font-weight: normal;
  color: rgb(var(--foreground)); /* Make active page more distinct */
`;

// Translations for static routes. Might be expanded later
const breadcrumbTranslations = {
    home: "Магазин игр",
    launch: "Запуск",
    my: "Мои покупки"
};

// Function to dynamically fetch game name (Supports API in the future)
const getBreadcrumbName = async (segment, setTitles) => {
    // Check if the segment is a game slug in JSON
    const game = games.find((g) => g.slug === segment);

    if (game) {
        setTitles((prev) => ({ ...prev, [segment]: game.title })); // Store title in state
        return;
    }

    // Future API call to get game names dynamically (when JSON is replaced)
    // const response = await fetch(`/api/games?slug=${segment}`);
    // const data = await response.json();
    // if (data.title) {
    //   setTitles((prev) => ({ ...prev, [segment]: data.title }));
    //   return;
    // }

    setTitles((prev) => ({ ...prev, [segment]: breadcrumbTranslations[segment] || segment.replace(/-/g, " ") }));
};

const Breadcrumbs = () => {
    const pathname = usePathname();
    const pathSegments = pathname.split("/").filter(Boolean);
    const [titles, setTitles] = useState({}); // Store translated names

    // Fetch game names or translations on mount
    useEffect(() => {
        pathSegments.forEach((segment) => {
            if (!titles[segment]) {
                getBreadcrumbName(segment, setTitles);
            }
        });
    }, [pathname]);

    // Remove  /games/ from breadcrumbs because there is no such page, but I've a directory games
    const filteredSegments = pathSegments.filter((segment) => segment !== "games");

    return (
        <BreadcrumbContainer>
            <BreadcrumbLink href="/">Магазин игр</BreadcrumbLink> {/* Home  */}
            {filteredSegments.map((segment, index) => {
                const path = `/${filteredSegments.slice(0, index + 1).join("/")}`;
                const name = titles[segment] || segment; // Use translated name or fallback

                return (
                    <span key={path}>
                        {" > "}
                        {index === filteredSegments.length - 1 ? (
                            <ActiveBreadcrumb>{name}</ActiveBreadcrumb> // Highlight active page
                        ) : (
                            <BreadcrumbLink href={path}>{name}</BreadcrumbLink> // Previous pages as links
                        )}
                    </span>
                );
            })}
        </BreadcrumbContainer>
    );
};

export default Breadcrumbs;
