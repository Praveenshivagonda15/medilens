import React, { useRef, useState, useEffect } from 'react';

export default function DoodleCanvas() {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#2563eb');
  const [active, setActive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      
      const context = canvas.getContext('2d');
      if (!context) return;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = 2.5;

      let saved = null; try { saved = localStorage.getItem('medilens_doodles'); } catch(e){}
      if (saved) {
        try {
          const strokes = JSON.parse(saved);
          drawStrokes(context, strokes);
        } catch (e) {
          drawDefaults(context);
        }
      } else {
        drawDefaults(context);
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  const drawStrokes = (ctx, strokes) => {
    if (!Array.isArray(strokes)) return;
    strokes.forEach(stroke => {
      if (!stroke || !Array.isArray(stroke) || stroke.length < 2 || !stroke[0]) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke[0].color || '#2563eb';
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) {
        if (stroke[i]) {
          ctx.lineTo(stroke[i].x, stroke[i].y);
        }
      }
      ctx.stroke();
    });
  };

  const drawDefaults = (ctx) => {
    ctx.strokeStyle = '#2563eb';

    ctx.beginPath();
    ctx.moveTo(40, 520);
    ctx.lineTo(40, 560);
    ctx.arc(45, 560, 5, 0, Math.PI);
    ctx.lineTo(50, 520);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(35, 520);
    ctx.lineTo(55, 520);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = '#ef4444';
    ctx.moveTo(38, 545);
    ctx.lineTo(52, 545);
    ctx.stroke();

    ctx.strokeStyle = '#2563eb';
    ctx.beginPath();
    ctx.arc(43, 532, 1.5, 0, Math.PI * 2);
    ctx.arc(47, 538, 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(180, 240);
    ctx.quadraticCurveTo(150, 260, 160, 290);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(153, 282);
    ctx.lineTo(160, 290);
    ctx.lineTo(168, 280);
    ctx.stroke();
  };

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    if (e.touches && e.touches.length > 0) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    }
    
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const startDrawing = (e) => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.moveTo(x, y);
    setIsDrawing(true);

    let saved = null; try { saved = localStorage.getItem('medilens_doodles'); } catch(e){}
    let strokes = [];
    try {
      strokes = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(strokes)) strokes = [];
    } catch {
      strokes = [];
    }
    strokes.push([{ x, y, color }]);
    try { localStorage.setItem('medilens_doodles', JSON.stringify(strokes)); } catch(e){}
  };

  const draw = (e) => {
    if (!isDrawing || !active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);

    ctx.lineTo(x, y);
    ctx.stroke();

    let saved = null; try { saved = localStorage.getItem('medilens_doodles'); } catch(e){}
    if (saved) {
      try {
        const strokes = JSON.parse(saved);
        if (Array.isArray(strokes) && strokes.length > 0) {
          strokes[strokes.length - 1].push({ x, y });
          try { localStorage.setItem('medilens_doodles', JSON.stringify(strokes)); } catch(e){}
        }
      } catch {}
    }
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    try { localStorage.removeItem('medilens_doodles'); } catch(e){}
  };

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: active ? 'auto' : 'none', zIndex: active ? 99 : 0 }}>
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        style={{
          width: '100%',
          height: '100%',
          cursor: active ? 'crosshair' : 'default',
          display: 'block'
        }}
      />

      <div style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        background: '#ffffff',
        border: '2px solid var(--charcoal)',
        boxShadow: 'var(--shadow)',
        borderRadius: 8,
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        zIndex: 99999,
        pointerEvents: 'auto'
      }}>
        <button
          onClick={() => setActive(!active)}
          style={{
            background: active ? 'var(--neon-yellow)' : '#fff',
            border: 'none',
            fontSize: 12,
            padding: '4px 8px',
            borderRadius: 4
          }}
        >
          {active ? ' Draw On' : ' Draw Off'}
        </button>
        {active && (
          <>
            <div style={{ display: 'flex', gap: 4 }}>
              {['#2563eb', '#ef4444', '#f59e0b', '#000000'].map(c => (
                <div
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: c,
                    border: color === c ? '2px solid #000' : '1px solid #ccc',
                    cursor: 'pointer'
                  }}
                />
              ))}
            </div>
            <button
              onClick={clearCanvas}
              style={{
                background: '#f8fafc',
                fontSize: 11,
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid #ccc'
              }}
            >
               Clear
            </button>
          </>
        )}
      </div>
    </div>
  );
}
