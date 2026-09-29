import React, { useEffect, useRef } from "react";

const AuroraBackground = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);

    let mouseX = 0;
    let mouseY = 0;

    const handleMouseMove = (e) => {
      mouseX = (e.clientX - w / 2) / (w / 2);
      mouseY = (e.clientY - h / 2) / (h / 2);
    };

    const resize = () => {
      if (!canvas) return;
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", handleMouseMove);

    // Love Mode Palette: Romantic rose pinks, ruby crimson, blush peach, and warm magenta
    const loveColors = [
      "hsla(340, 85%, 68%, 0.45)",  // Romantic Rose
      "hsla(355, 90%, 75%, 0.40)",  // Cherry Blossom Pink
      "hsla(15, 88%, 78%, 0.42)",   // Golden Blush Peach
      "hsla(325, 82%, 70%, 0.38)"   // Warm Magenta Glow
    ];

    class Aurora {
      constructor() {
        this.reset(true);
      }
      reset(init = false) {
        this.baseX = Math.random() * w;
        this.baseY = Math.random() * h;
        this.x = this.baseX;
        this.y = this.baseY;
        this.radius = 320 + Math.random() * 320;
        this.color = loveColors[Math.floor(Math.random() * loveColors.length)];
        this.angle = Math.random() * Math.PI * 2;
        this.speed = 0.001 + Math.random() * 0.0018; 
      }
      draw() {
        this.angle += this.speed;
        const targetX = this.baseX + mouseX * 90;
        const targetY = this.baseY + mouseY * 90;
        
        this.x += (targetX - this.x) * 0.05;
        this.y += (targetY - this.y) * 0.05;

        const gradient = ctx.createRadialGradient(
          this.x + Math.cos(this.angle) * 110,
          this.y + Math.sin(this.angle) * 110,
          40,
          this.x,
          this.y,
          this.radius
        );
        gradient.addColorStop(0, this.color);
        gradient.addColorStop(1, "transparent");
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const auroras = [];
    for (let i = 0; i < 8; i++) {
      auroras.push(new Aurora());
    }

    let animationFrameId;

    function animate() {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      // Soft romantic blush cream background for Love Mode
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, "#fff5f7"); 
      gradient.addColorStop(1, "#fde8ef"); 
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = "multiply"; 
      auroras.forEach((a) => a.draw());

      animationFrameId = requestAnimationFrame(animate);
    }
    animate();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 0,
        background: "transparent",
        pointerEvents: "none"
      }}
    />
  );
};

export default AuroraBackground;
