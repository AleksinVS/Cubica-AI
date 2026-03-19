import styled from "styled-components";
import { FaStar } from "react-icons/fa";

const InfoWrapper = styled.div`
    display: flex;
    width: 100%;
    height: 100%;
    flex-direction: column;
    gap: 10px;
    background-color: inherit;
    color: #fff;
    padding: 20px;
    border-radius: 10px;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2); 
`;

const Title = styled.h1`
    font-size: 1.8rem;
    font-weight: bold;
    margin: 0;
`;

const Reviews = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9rem;
`;

const PriceWrapper = styled.div`
    display: flex;
    justify-content: space-between;
    font-size: 1rem;
    font-weight: bold;

    span {
        color: rgb(var(--theme-yellow));
    }
`;

const Description = styled.p`
    font-size: 1rem;
    line-height: 1.5;
    color: #ccc; 
`;

const GameDetails = styled.div`
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 0.9rem;

    span {
        font-weight: bold;
    }
`;

const ButtonGroup = styled.div`
    display: flex;
    gap: 10px;
    margin-top: 20px;

    button {
        background-color: inherit;
        border: 1px solid rgb(var(--theme-grey));
        color: rgb(var(--theme-yellow));
        padding: 10px 20px;
        border-radius: 5px;
        font-size: 0.9rem;
        cursor: pointer;
        transition: background-color 0.3s ease;
        text-transform: uppercase;
        &:hover {
            border: 1px solid rgb(var(--theme-yellow));
            color: rgb(var(--foreground));
        }

`;

const Delimeter = styled.div`
    width: 100%; 
    height: 1px; 
    background-color: rgba(var(--theme-yellow), 0.5);
    margin: 20px 0; 
`;


const StarsWrapper = styled.div`
  display: flex;
    gap: 5px;
    align-items: center;`;


const Rating = ({ rating }) => {
    return (
        <StarsWrapper>
            {[...Array(5)].map((_, index) => (
                <FaStar key={index} color={index < rating ? "rgb(var(--theme-yellow))" : "#ccc"} />
            ))}
            {rating === 0 && <span>Нет оценки</span>}
        </StarsWrapper>
    );
};


const InfoContainer = ({ title, reviews, priceLaunch, priceMonth, description, details, rating }) => {
    return (
        <InfoWrapper>
            <Title>{title}</Title>
            <Reviews>
                <Rating rating={rating} />
                <span>{reviews} отзывов </span>
            </Reviews>
            <PriceWrapper>
                <span>{priceLaunch} ₽/запуск</span>
                <span>{priceMonth} ₽/месяц</span>
            </PriceWrapper>
            <ButtonGroup>
                <button>Играть</button>
                <button>Купить</button>

            </ButtonGroup>
            <Delimeter />
            <Description>{description}</Description>
            <Delimeter />
            <GameDetails>
                <div>
                    <span>Жанр:</span> {details.genre}
                </div>
                <div>
                    <span>Формат:</span> {details.format}
                </div>
                <div>
                    <span>Продолжительность:</span> {details.duration}
                </div>
                <div>
                    <span>Автор:</span> {details.author}
                </div>
            </GameDetails>

        </InfoWrapper>
    );
};

export default InfoContainer;
