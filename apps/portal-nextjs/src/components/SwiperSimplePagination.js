"use client"
import { Swiper as SwiperReact, SwiperSlide } from "swiper/react";
import { Navigation, Pagination } from "swiper/modules"; // Import modules
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";

const Swiper = ({ images }) => {
    return (
        <SwiperReact
            modules={[Navigation, Pagination]} // Register the modules
            spaceBetween={10}
            slidesPerView={1}
            navigation={true} // Enable navigation arrows
            pagination={{ clickable: true }} // Enable pagination dots
            loop={true} // Enable looping of slides
            style={{ maxWidth: "600px", margin: "0 auto" }}
        >
            {images.map((image, index) => (
                <SwiperSlide key={index}>
                    <img
                        src={image}
                        alt={`Slide ${index + 1}`}
                        style={{
                            width: "100%",
                            height: "auto",
                            borderRadius: "8px",
                        }}
                    />
                </SwiperSlide>
            ))}
        </SwiperReact>
    );
};

export default Swiper;
