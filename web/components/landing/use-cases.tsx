"use client";

import { Video, Accessibility, GraduationCap, Users, Megaphone, Brain, BookOpen } from "lucide-react";
import Carousel from "react-multi-carousel";
import "react-multi-carousel/lib/styles.css";


export default function UseCases() {
  const useCases = [
    {
      icon: Video,
      title: "Content Creators",
      description: "Transform videos into blog posts, social media content, and newsletters in minutes. Quickly repurpose your content across platforms without manual transcription."
    },
    {
      icon: Brain,
      title: "AI & LLM Training", 
      description: "Extract bulk training data from videos to feed into AI models. Create custom datasets for fine-tuning LLMs and building specialized Q&A systems."
    },
    {
      icon: Megaphone,
      title: "Marketing",
      description: "Hook your audience. Maximize engagement, accessibility, and global reach."
    },
    {
      icon: GraduationCap,
      title: "Researchers",
      description: "Extract valuable insights from interviews, lectures, and presentations without tedious manual work. Save hours on academic papers and research studies."
    },
    {
      icon: Users,
      title: "Journalists",
      description: "Reach a wider audience and increase revenue with subtitles in 120+ languages."
    },
    {
      icon: BookOpen,
      title: "Students",
      description: "Convert educational videos and lectures into organized study notes. Improve learning retention with searchable text references from video content."
    },
    {
      icon: Accessibility,
      title: "Accessibility",
      description: "Create accessible text versions of video content for users with hearing impairments. Make your content inclusive with searchable, readable transcripts."
    }
  ];

  const responsive = {
    desktop: {
      breakpoint: { max: 3000, min: 1024 },
      items: 3,
      slidesToSlide: 1
    },
    tablet: {
      breakpoint: { max: 1024, min: 768 },
      items: 2,
      slidesToSlide: 1
    },
    mobile: {
      breakpoint: { max: 768, min: 0 },
      items: 1,
      slidesToSlide: 1
    }
  };

  return (
    <section id="use-cases" className="py-12 bg-gradient-to-b from-zinc-950 via-amber-950/10 to-zinc-950">
      <div className="px-6 max-w-6xl mx-auto mb-12">
        <h2 className="text-3xl font-bold text-zinc-50 text-center">
          Your go-to solution for localization and productivity
        </h2>
      </div>

      <div className="relative px-6">
          <Carousel
            responsive={responsive}
            infinite={true}
            autoPlay={false}
            keyBoardControl={true}
            customTransition="transform 300ms ease-in-out"
            transitionDuration={300}
            containerClass="carousel-container"
            removeArrowOnDeviceType={["tablet", "mobile"]}
            itemClass="px-4"
            showDots={true}
            dotListClass="custom-dot-list-style"
            arrows={false}
          >
            {useCases.map((useCase, index) => {
              const IconComponent = useCase.icon;
              return (
                <div key={index} className="bg-zinc-900/80 backdrop-blur-sm rounded-2xl p-6 border border-zinc-800 shadow-lg hover:shadow-xl transition-shadow flex flex-col" style={{ height: '280px' }}>
                  <div className="w-14 h-14 bg-amber-950/60 rounded-2xl flex items-center justify-center mb-6 flex-shrink-0">
                    <IconComponent className="w-7 h-7 text-amber-600" />
                  </div>
                  <h3 className="text-xl font-bold text-zinc-50 mb-3 flex-shrink-0">
                    {useCase.title}
                  </h3>
                  <p className="text-zinc-400 leading-relaxed flex-grow">
                    {useCase.description}
                  </p>
                </div>
              );
            })}
          </Carousel>
        </div>

      <style jsx global>{`
        .carousel-container {
          position: relative;
          padding-bottom: 50px;
        }
        
        .react-multi-carousel-list {
          position: static;
        }
        
        .react-multi-carousel-track {
          margin: 0;
        }
        
        .react-multi-carousel-item {
          transform: none !important;
        }
        
        .custom-dot-list-style {
          display: flex !important;
          justify-content: center;
          align-items: center;
          margin-top: 2rem;
          gap: 0.5rem;
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
        }
        
        .custom-dot-list-style li {
          list-style: none;
        }
        
        .custom-dot-list-style li button {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          border: none;
          background-color: #52525b;
          cursor: pointer;
          transition: background-color 0.3s ease;
        }
        
        .custom-dot-list-style li.react-multi-carousel-dot--active button {
          background-color: #d97706;
          width: 24px;
          border-radius: 4px;
        }
        
        .custom-dot-list-style li button:hover {
          background-color: #a1a1aa;
        }
        
        .custom-dot-list-style li.react-multi-carousel-dot--active button:hover {
          background-color: #b45309;
        }
      `}</style>
    </section>
  );
}
