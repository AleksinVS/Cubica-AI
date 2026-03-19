"use client"
import React from "react";
import Header from "@/components/Header";
import Aside from "@/components/Aside";
import styled from "styled-components";
import { usePathname } from "next/navigation";
import { SearchProvider } from "@/context/SearchContext";



const FlexWrapper = styled.div`
    display: flex;
    flex-direction: row;
    align-items: stretch;
    width: 100%;
    gap: 20px; 
`;

const Content = styled.div`
    flex: 1; 
    overflow: auto; 
    padding: 1rem 0.5rem;
`;

export default function GameLayout({ children }) {

    const pathname = usePathname();


    // Determine Aside type based on the current route
    let asideType = "game-page"; // Default type
    if (pathname === "/games/my") {
        asideType = "my-purchases";
    }

    return (
        <SearchProvider>
            <main>
                <Header />
                <FlexWrapper>
                    <Aside type={asideType} />
                    <Content>{children}</Content>
                </FlexWrapper>
            </main>
        </SearchProvider>
    );
}

