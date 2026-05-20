import styled from "styled-components";
import { FaStar } from "react-icons/fa";
import { useState } from "react";
import { createTestPurchase } from "@/lib/portalApi";

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
    gap: 10px;
    flex-wrap: wrap;
    font-size: 1rem;
    font-weight: bold;

    span {
        color: rgb(var(--theme-yellow));
    }
`;

const PurchaseOptions = styled.div`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;

    @media (max-width: 560px) {
        grid-template-columns: 1fr;
    }
`;

const OptionButton = styled.button`
    display: flex;
    flex-direction: column;
    gap: 4px;
    background-color: ${({ $isSelected }) =>
        $isSelected ? "rgba(var(--theme-yellow), 0.16)" : "inherit"};
    border: 1px solid ${({ $isSelected }) =>
        $isSelected ? "rgb(var(--theme-yellow))" : "rgb(var(--theme-grey))"};
    color: rgb(var(--foreground));
    padding: 10px;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;

    &:hover {
        border-color: rgb(var(--theme-yellow));
    }
`;

const OptionTitle = styled.span`
    color: rgb(var(--theme-yellow));
    font-weight: bold;
`;

const OptionMeta = styled.span`
    color: rgba(var(--foreground), 0.78);
    font-size: 0.82rem;
`;

const DateField = styled.label`
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: rgba(var(--foreground), 0.82);
    font-size: 0.9rem;

    input {
        width: 180px;
        max-width: 100%;
        background: inherit;
        border: 1px solid rgb(var(--theme-grey));
        border-radius: 6px;
        color: rgb(var(--foreground));
        padding: 8px;
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

const StatusText = styled.p`
    min-height: 1.4rem;
    margin: 0;
    color: rgb(var(--theme-yellow));
    font-size: 0.9rem;
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

const PACKAGE_OPTIONS = [
    {
        type: "one-time",
        title: "Разовая",
        priceKey: "priceLaunch",
        meta: "Одна постоянная ссылка",
    },
    {
        type: "day",
        title: "Дневная",
        priceKey: "priceDay",
        meta: "С 00:00 до 23:59 по Москве",
    },
    {
        type: "month",
        title: "Месячная",
        priceKey: "priceMonth",
        meta: "Период покупки 1 месяц",
    },
];

function todayInMoscow() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Moscow",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());

    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function addMonths(dateValue, months) {
    const [year, month, day] = dateValue.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1 + months, day));
    return date.toISOString().slice(0, 10);
}


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


const InfoContainer = ({ title, slug, reviews, priceLaunch, priceDay, priceMonth, description, details, rating }) => {
    const [packageType, setPackageType] = useState("one-time");
    const [selectedDate, setSelectedDate] = useState(todayInMoscow);
    const [purchaseStatus, setPurchaseStatus] = useState("");
    const [isBuying, setIsBuying] = useState(false);

    const prices = {
        priceLaunch,
        priceDay: priceDay || priceLaunch,
        priceMonth,
    };

    const selectedOption = PACKAGE_OPTIONS.find((option) => option.type === packageType);
    const selectedPrice = prices[selectedOption.priceKey];

    const buildPurchasePeriod = () => {
        if (packageType === "day") {
            return { startDate: selectedDate, endDate: selectedDate };
        }

        if (packageType === "month") {
            return { startDate: selectedDate, endDate: addMonths(selectedDate, 1) };
        }

        return { startDate: undefined, endDate: undefined };
    };

    const handleTestPurchase = async () => {
        setIsBuying(true);
        setPurchaseStatus("Создаем тестовую покупку...");

        try {
            const period = buildPurchasePeriod();
            const result = await createTestPurchase({
                gameSlug: slug,
                packageType,
                price: selectedPrice,
                ...period,
            });
            const purchaseId = result?.purchase?.documentId;
            setPurchaseStatus(
                purchaseId
                    ? `Покупка зачислена: ${purchaseId}`
                    : "Покупка зачислена"
            );
        } catch (error) {
            setPurchaseStatus(error.message || "Не удалось создать тестовую покупку");
        } finally {
            setIsBuying(false);
        }
    };

    return (
        <InfoWrapper>
            <Title>{title}</Title>
            <Reviews>
                <Rating rating={rating} />
                <span>{reviews} отзывов </span>
            </Reviews>
            <PriceWrapper>
                <span>{priceLaunch} ₽/запуск</span>
                <span>{prices.priceDay} ₽/день</span>
                <span>{priceMonth} ₽/месяц</span>
            </PriceWrapper>
            <PurchaseOptions aria-label="Тип покупки">
                {PACKAGE_OPTIONS.map((option) => (
                    <OptionButton
                        key={option.type}
                        type="button"
                        $isSelected={packageType === option.type}
                        onClick={() => setPackageType(option.type)}
                    >
                        <OptionTitle>{option.title}</OptionTitle>
                        <OptionMeta>{prices[option.priceKey]} ₽</OptionMeta>
                        <OptionMeta>{option.meta}</OptionMeta>
                    </OptionButton>
                ))}
            </PurchaseOptions>
            {packageType !== "one-time" ? (
                <DateField>
                    {packageType === "day" ? "Дата игры" : "Дата начала подписки"}
                    <input
                        type="date"
                        value={selectedDate}
                        onChange={(event) => setSelectedDate(event.target.value)}
                    />
                </DateField>
            ) : null}
            <ButtonGroup>
                <button>Играть</button>
                <button type="button" disabled={isBuying} onClick={handleTestPurchase}>
                    {isBuying ? "Покупаем..." : `Купить: ${selectedOption.title}`}
                </button>

            </ButtonGroup>
            <StatusText role="status">{purchaseStatus}</StatusText>
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
