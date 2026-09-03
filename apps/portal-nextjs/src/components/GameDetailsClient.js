"use client";

import styled from "styled-components";
import Swiper from "@/components/Swiper";
import Tabs from "@/components/Tabs";
import InfoContainer from "@/components/InfoContainer";

const GridContainer = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto auto;
  width: 100%;
  max-width: 100vw;
  margin: 0 auto;
  gap: 20px;
  padding: 20px;
  box-sizing: border-box;
  grid-template-areas:
    "slider info"
    "tabs tabs";

  @media (max-width: 875px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto;
    grid-template-areas:
      "info"
      "slider"
      "tabs";
    gap: 15px;
  }
`;

const FirstRow = styled.div`
  width: 100%;
  display: contents;
`;

const SliderContainer = styled.div`
  grid-area: slider;
  display: flex;
  width: 100%;
  height: auto;
  flex-direction: column;
  gap: 10px;
  background-color: inherit;
  color: #fff;
  padding: 20px;
  overflow: hidden;
`;

const InfoContainerWrapper = styled.div`
  grid-area: info;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
`;

const SecondRow = styled.div`
  grid-area: tabs;
  padding-top: 1em;
  border-radius: 10px;
`;

export default function GameDetailsClient({ game }) {
  return (
    <GridContainer>
      <FirstRow>
        <SliderContainer>
          <Swiper images={game.images} />
        </SliderContainer>
        <InfoContainerWrapper>
          <InfoContainer
            title={game.title}
            slug={game.slug}
            rating={game.rating}
            reviews={game.reviews}
            priceLaunch={game.pricePerLaunch}
            priceDay={game.pricePerDay}
            priceMonth={game.pricePerMonth}
            description={game.description}
            details={{
              genre: game.genre,
              format: game.format,
              duration: game.duration,
              author: game.author,
            }}
          />
        </InfoContainerWrapper>
      </FirstRow>

      <SecondRow>
        <Tabs />
      </SecondRow>
    </GridContainer>
  );
}
