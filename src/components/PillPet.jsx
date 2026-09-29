import React, { useState, useEffect } from 'react';

export default function PillPet({ cabinetCount = 0 }) {
  const [mood, setMood] = useState('happy');
  const [bubble, setBubble] = useState('');
  const [isBouncing, setIsBouncing] = useState(false);

  const quotes = [
    "i hunger for cheap jan aushadhi generics! ",
    "did you take your pills on time today?",
    "big pharma hates this one simple trick! ",
    "molecular formula synthesis online! ",
    "chemists in india charging 10x? not on my watch! ",
    "click me again and i'll break into an 8-bit dance! "
  ];

  const handlePetClick = () => {
    setIsBouncing(true);
    setTimeout(() => setIsBouncing(false), 600);
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    setBubble(randomQuote);
    setMood(m => m === 'happy' ? 'hyped' : 'happy');
  };

  useEffect(() => {

    setBubble("hey! i'm pilly. point your camera at any med strip! ");
  }, []);

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      left: 24,
      zIndex: 9999,
      display: 'flex',
      alignItems: 'flex-end',
      gap: 8,
      pointerEvents: 'auto'
    }}>
      
      {bubble && (
        <div style={{
          background: '#ffffff',
          border: '2.5px solid var(--charcoal)',
          boxShadow: 'var(--shadow)',
          borderRadius: '16px 16px 16px 0px',
          padding: '8px 12px',
          maxWidth: 180,
          fontSize: 11.5,
          fontWeight: 700,
          color: 'var(--navy)',
          fontFamily: 'var(--font-mono)',
          position: 'relative',
          animation: 'popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
        }}>
          {bubble}
          <button
            onClick={() => setBubble('')}
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              background: 'var(--charcoal)',
              color: '#fff',
              border: 'none',
              borderRadius: '50%',
              width: 16,
              height: 16,
              fontSize: 9,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>
      )}

      <div
        onClick={handlePetClick}
        title="Click Pilly the Medicine Pet!"
        style={{
          width: 52,
          height: 52,
          background: mood === 'hyped' ? 'var(--neon-pink)' : 'var(--neon-yellow)',
          border: '3px solid var(--charcoal)',
          borderRadius: 26,
          boxShadow: '3px 3px 0px var(--charcoal)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transform: isBouncing ? 'translateY(-12px) scale(1.1)' : 'translateY(0)',
          transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.3s',
          userSelect: 'none'
        }}
      >
        <span style={{ fontSize: 26 }}>{mood === 'hyped' ? '' : ''}</span>
      </div>
    </div>
  );
}
