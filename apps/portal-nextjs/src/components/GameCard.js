"use client";

import Link from "next/link";
import styled from "styled-components";
import SquareIcon from "./SquareIcon";
import { CiHeart } from "react-icons/ci";
import { LuShoppingCart, LuGamepad2 } from "react-icons/lu";
import { FaStar, FaInfoCircle, FaEdit, FaCopy, FaCheck, FaArchive, FaTimes } from "react-icons/fa";
import { useState, useEffect } from "react";


const CardWrapper = styled.div`
position: relative; /* ! fixed star appering somewhere on the top left where logo */
  background-color: inherit;
  border-radius: 5px;
  padding: 16px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s ease, box-shadow 0.2s ease;

  &:hover {
    transform: scale(1.02);
    box-shadow: 0 6px 10px rgba(0, 0, 0, 0.2);
  }

  &:hover .hover-overlay {
  opacity: 1;
  visibility: visible
  }
`;

const TopLeftBadge = styled.div`
  position: absolute;
  top: 25px;
  left: 16px;
  background-color: rgba(var(--theme-grey), 0.6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: .4rem 1rem;
  font-size: 1rem;
  gap: 4px;
  z-index: 2; 
`;

const TopRightBadge = styled.div`
  position: absolute;
  top: 25px;
  right: 15px;
  background-color: rgba(var(--theme-grey), 0.6);
  color: #fff;
  padding: .4rem 1rem;
  font-size: 1rem;
  z-index: 2; 
`;

const CardImage = styled.img`
  width: 100%;
  height: 200px;
  object-fit: cover;
  border-radius: 5px;
  margin-bottom: 12px;
  cursor: pointer;
`;



const CardImageWrapper = styled.div`
  position: relative;
  width: 100%;
  height: 200px;
  margin-bottom: 1rem;
`;

const HoverOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-radius: 5px;
  transform: scale(${({ $isOverlayVisible }) => ($isOverlayVisible ? "1" : "0")});
  opacity: ${({ $isOverlayVisible }) => ($isOverlayVisible ? "1" : "0")};
  visibility: ${({ $isOverlayVisible }) => ($isOverlayVisible ? "visible" : "hidden")};
  transition: opacity 0.3s ease, visibility 0.3s ease, transform 0.3s ease-out;

  ${CardImageWrapper}:hover & {
    @media (min-width: 769px) {
      opacity: 1;
      visibility: visible;
      transform: scale(1);
    }
  }
`;



const ButtonRow = styled.div`
  display: flex;
  gap: 10px;
  width: 100%; 
  justify-content: center;
`;

const IconButton = styled.div`
  background: rgba(255, 255, 255, 0.8);
  width: 50px;
  height: 50px;
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: background 0.3s;
  color: #4a4a4a;
 font-size: 20px;

  &:hover {
    background: rgba(var(--theme-grey), 0.7);
     color: rgb(var(--foreground));
  }

  &:hover::after {
    content: attr(data-tooltip);
    position: absolute;
    background: black;
    color: white;
    padding: 5px 10px;
    border-radius: 5px;
    font-size: 12px;
    white-space: nowrap;
  }

  &:hover::after {
    bottom: -35px; /* Move tooltips below for smaller buttons */
  }
`;

const LargeIconButton = styled(IconButton)`
  width: 60px;
  height: 60px;

  &:hover::after {
    top: -30px; /* Move tooltips above for larger buttons */
    bottom: auto;
    left: 50%;
    transform: translateX(-50%);
  }
`;



const CardContent = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
`;

const PriceContainer = styled.div`
  display: flex;
  gap: 8px;
`;

const PriceText = styled.span`
  font-size: 0.9rem;
`;

const PriceValue = styled.span`
  color: rgb(var(--theme-yellow));
  font-weight: bold;
`;

const PriceLabel = styled.span`
  color: rgb(var(--theme-grey));
`;

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
`;

const GameName = styled.h3`
  font-size: 1rem;
  color: #fff;
  margin: 0;
  cursor: pointer;
  font-weight: 400;
  display: -webkit-box;
  -webkit-line-clamp: 2; 
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RowIcon = styled.div`
  flex-shrink: 0;
  margin-right: 8px;
`;

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background: rgb(var(--background));
  padding: 20px;
  border-radius: 10px;
  max-width: 600px;
  width: 90%;
  color: rgb(var(--foreground));
  position: relative;
  border: 1px solid rgba(var(--theme-yellow), 0.2);

  h2 {
  font-weight: 600;
  font-size: 1rem;
  margin-bottom: 1rem;
  }

    @media (max-width: 768px) {
    width: 95%; 
    padding: 15px; 
  }
`;

const CloseButton = styled.div`
  position: absolute;
  top: 10px;
  right: 10px;
  cursor: pointer;
  font-size: 20px;

     @media (max-width: 768px) {
      font-size: 30px;
  }
`;

const ModalHeader = styled.div`
  display: flex;
  gap: 20px;
  align-items: center;

    @media (max-width: 768px) {
    flex-direction: column; 
    gap: 10px; 
    text-align: center; 
  }
`;

const ModalImage = styled.img`
  width: 100%;
  max-width: 300px;
  height: auto;
  object-fit: cover;
  border-radius: 5px;

  @media (max-width: 768px) {
    max-width: 100%; 
    margin-top: 2rem;
    margin-bottom: 1rem;
  }
`;

const ModalDetails = styled.div`
  flex: 1;

    @media (max-width: 768px) {
    width: 100%; 
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 10px;
  margin-top: 1rem;


`;

const ModalButton = styled.button`
  background: inherit;
  border: 1px solid rgb(var(--theme-grey));
  color: rgb(var(--foreground));
    font-family: var(--font-montserrat), Arial, Helvetica, sans-serif;
  padding: 10px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 14px;
 
  width: auto;
  min-width: 150px;
  &:hover {
    border: 1px solid rgb(var(--theme-yellow));
    color: #fff;
  }

      @media (max-width: 768px) {
  width: 100%;
  }

`;

const ModalDescription = styled.p`
  margin-top: 20px;
  font-size: 14px;
  color: rgb(var(--foreground));

    @media (max-width: 768px) {
    text-align: left; 
    line-height: 1.5;
  }
`;


const GameCard = ({ game }) => {

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);

  const handleOverlayToggle = () => {
    if (window.innerWidth <= 768) {
      setIsOverlayVisible(!isOverlayVisible);
    }
  };

  const handleOutsideClick = (e) => {
    if (isOverlayVisible && !e.target.closest('.hover-overlay')) {
      setIsOverlayVisible(false);
    }
  };

  useEffect(() => {
    document.addEventListener("click", handleOutsideClick);
    return () => {
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [isOverlayVisible]);


  return (
    <>
      <CardWrapper>
        {/* top left badge (rating) */}
        <TopLeftBadge>
          <FaStar color="white" />
          {game.rating}
        </TopLeftBadge>

        {/* top right badge (total reviews) */}
        <TopRightBadge>{game.reviews}</TopRightBadge>

        {/* Link the image to the game page */}
        <CardImageWrapper onClick={handleOverlayToggle}>
          <CardImage src={game.image} alt={game.title} />
          <HoverOverlay className="hover-overlay" $isOverlayVisible={isOverlayVisible}>
            <ButtonRow>
              <LargeIconButton data-tooltip="информация" onClick={() => setIsModalOpen(true)}>
                <FaInfoCircle />
              </LargeIconButton>
              <LargeIconButton data-tooltip="демо">
                <LuGamepad2 />
              </LargeIconButton>
            </ButtonRow>
            <ButtonRow>
              <IconButton data-tooltip="редактировать"><FaEdit /></IconButton>
              <IconButton data-tooltip="копировать"><FaCopy /></IconButton>
              <IconButton data-tooltip="публикация"><FaCheck /></IconButton>
              <IconButton data-tooltip="в архив"><FaArchive /></IconButton>
            </ButtonRow>
          </HoverOverlay>
        </CardImageWrapper>


        {/* Cart Icon and Prices */}
        <CardContent>
          <SquareIcon icon={<LuShoppingCart />} />
          <PriceContainer>
            <PriceText>
              <PriceValue>{game.pricePerLaunch}</PriceValue>
              <PriceLabel> ₽/запуск</PriceLabel>
            </PriceText>
            <PriceText>
              <PriceValue>{game.pricePerMonth}</PriceValue>
              <PriceLabel> ₽/месяц</PriceLabel>
            </PriceText>
          </PriceContainer>
        </CardContent>

        {/* Row with Linkable Game Name */}
        <Row>
          <RowIcon>
            <SquareIcon icon={<CiHeart />} $variant="fill" />
          </RowIcon>
          <Link href={`/games/${game.slug}`}>
            <GameName>{game.title}</GameName>
          </Link>
        </Row>
      </CardWrapper>
      {isModalOpen && (
        <ModalOverlay>
          <ModalContent>
            <CloseButton onClick={() => setIsModalOpen(false)}>
              <FaTimes />
            </CloseButton>
            <ModalHeader>
              <ModalImage src={game.image} alt={game.title} />
              <ModalDetails>
                <h2>{game.title}</h2>
                <PriceContainer>
                  <PriceText>
                    <PriceValue>{game.pricePerLaunch}</PriceValue>
                    <PriceLabel> ₽/запуск</PriceLabel>
                  </PriceText>
                  <PriceText>
                    <PriceValue>{game.pricePerMonth}</PriceValue>
                    <PriceLabel> ₽/месяц</PriceLabel>
                  </PriceText>
                </PriceContainer>
                <ButtonGroup>
                  <SquareIcon icon={<LuShoppingCart />} />
                  <SquareIcon icon={<CiHeart />} $variant="fill" />
                  <Link href={`/games/${game.slug}`}>
                    <ModalButton>Подробнее</ModalButton>
                  </Link>
                </ButtonGroup>
              </ModalDetails>
            </ModalHeader>
            <ModalDescription>{game.description}</ModalDescription>
          </ModalContent>
        </ModalOverlay>
      )}
    </>
  );
};

export default GameCard;
