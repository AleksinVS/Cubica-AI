"use client";

import { useState } from "react";
import { Swiper as SwiperReact, SwiperSlide } from "swiper/react";
import { Navigation, Pagination, Thumbs, FreeMode } from "swiper/modules";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";
import "swiper/css/thumbs";
import styled from "styled-components";

const SwiperWrapper = styled.div`

width: 100%;
max-width: 100%; 
margin: 0 auto;


@media (max-width: 875px) {
    max-width: 325px; 

  }

`;

const Swiper = ({ images = [] }) => {
    const [thumbsSwiper, setThumbsSwiper] = useState(null);

    return (
        <SwiperWrapper>
            {images.length > 0 ? (
                <>
                    {/* Main Swiper (Big Image) */}
                    <SwiperReact
                        modules={[Navigation, Pagination, Thumbs]}
                        spaceBetween={10}
                        slidesPerView={1}
                        navigation
                        pagination={{ clickable: true }}
                        loop={true}
                        thumbs={{ swiper: thumbsSwiper }} // Ensure correct linking to thumbnails
                        style={{ marginBottom: "10px" }}

                    >
                        {images.map((image, index) => (
                            <SwiperSlide
                                key={index}
                                style={{ display: "flex", justifyContent: "center" }}
                            >
                                <img
                                    src={image}
                                    alt={`Slide ${index + 1}`}
                                    style={{
                                        width: "100%",
                                        maxHeight: "300px",
                                        objectFit: "cover",
                                        borderRadius: "8px",
                                    }}
                                />
                            </SwiperSlide>
                        ))}
                    </SwiperReact>

                    {/* Thumbnail Swiper */}
                    <SwiperReact
                        onSwiper={setThumbsSwiper}
                        modules={[Thumbs, FreeMode]}
                        spaceBetween={10}
                        slidesPerView={5} // Default for larger screens
                        breakpoints={{
                            0: { slidesPerView: 4, spaceBetween: 5 },
                            768: { slidesPerView: images.length < 5 ? images.length : 5, spaceBetween: 10 }, // 5 thumbnails on desktop
                        }}
                        watchSlidesProgress
                        freeMode
                        slideToClickedSlide
                        watchOverflow
                        style={{ cursor: "pointer" }}
                    >
                        {images.map((image, index) => (
                            <SwiperSlide
                                key={index}
                                style={{ cursor: "pointer", display: "flex", justifyContent: "center" }}
                            >
                                <img
                                    src={image}
                                    alt={`Thumbnail ${index + 1}`}
                                    style={{
                                        width: "80px",
                                        height: "60px",
                                        objectFit: "cover",
                                        borderRadius: "5px",
                                        border: "2px solid transparent",
                                    }}
                                />
                            </SwiperSlide>
                        ))}
                    </SwiperReact>
                </>
            ) : (
                <p>No images available</p>
            )}
        </SwiperWrapper>
    );
};

export default Swiper;
