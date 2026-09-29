import React, { useState } from 'react';

export default function PillSynth({ saltName = 'Paracetamol 500mg' }) {
  const [isPlaying, setIsPlaying] = useState(false);

  const safeName = (saltName && typeof saltName === 'string' && saltName.trim()) ? saltName.trim() : 'Paracetamol 500mg';
  const displayWord = safeName.split(' ')[0] || 'Drug';

  const playChemicalSound = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      setIsPlaying(true);

      const charCode = safeName.charCodeAt(0) || 65;
      const baseFreq = 220 + (charCode % 200);
      const notes = [baseFreq, baseFreq * 1.25, baseFreq * 1.5, baseFreq * 2];

      notes.forEach((freq, idx) => {
        if (!isFinite(freq)) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = idx % 2 === 0 ? 'square' : 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.12);

        gain.gain.setValueAtTime(0.15, ctx.currentTime + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.12 + 0.4);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * 0.12);
        osc.stop(ctx.currentTime + idx * 0.12 + 0.45);
      });

      setTimeout(() => {
        setIsPlaying(false);
      }, 800);
    } catch (e) {
      console.error("Audio synth error:", e);
      setIsPlaying(false);
    }
  };

  return (
    <div style={{
      background: 'var(--navy)',
      color: '#fff',
      border: '2.5px solid var(--charcoal)',
      borderRadius: 12,
      padding: '12px 16px',
      marginTop: 14,
      boxShadow: 'var(--shadow)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32,
          height: 32,
          background: isPlaying ? 'var(--neon-pink)' : 'var(--green)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          transition: 'background 0.2s'
        }}>
          {isPlaying ? '🎵' : '📻'}
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', color: 'var(--neon-yellow)' }}>
            MOLECULAR AUDIO SYNTHESIZER
          </div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
            Synthesize 8-bit harmonic frequency for {displayWord}
          </div>
        </div>
      </div>

      <button
        onClick={playChemicalSound}
        style={{
          background: isPlaying ? 'var(--neon-pink)' : 'var(--green)',
          color: '#fff',
          border: '1.5px solid var(--charcoal)',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          cursor: 'pointer',
          whiteSpace: 'nowrap'
        }}
      >
        {isPlaying ? '▶ PLAYING...' : '🔊 SYNTHESIZE'}
      </button>
    </div>
  );
}