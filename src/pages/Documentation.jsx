import React from 'react'

export default function Documentation({ onBack }) {
  return (
    <div style={{ padding: '24px 20px', maxWidth: '700px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 16 }}>
        <button onClick={onBack} className="btn-cyber-secondary" style={{ fontSize: 12, height: 32, padding: '0 12px', display: 'flex', alignItems: 'center' }}>
          &lt; BACK_TO_CONSOLE
        </button>
        <h2 style={{ fontSize: 18, margin: 0, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>

        </h2>
      </div>

      <div className="bento-card" style={{ textAlign: 'left' }}>
        <h3 style={{ fontSize: 16, marginBottom: 8, color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>// SECURE_PROXY_SYNAPSE</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          This project includes serverless helper endpoints so API keys are not exposed in the browser. Serverless execution limits also shape how longer image-analysis tasks are handled.
        </p>
        <div style={{ marginTop: 12, padding: 12, background: 'rgba(245,158,11,0.08)', borderLeft: '4px solid var(--amber)', borderRadius: 8, fontSize: 12, color: 'var(--amber)' }}>
          NOTE: Yes, I actually documented my API endpoints. If you are building another app, you can use these, but please don't spam them because my Groq and Davaindia scraper credits aren't infinite.
        </div>
      </div>

      <div className="bento-card" style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--emerald)', border: '1px solid rgba(16,185,129,0.3)', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--font-mono)' }}>POST</span>
          <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>/api/scan-stream</code>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          This does the heavy lifting. It reads the uploaded strip image, does the OCR, searches the local IndexedDB, and pulls generic price estimates all in one go. Since Vercel functions timeout after 10 seconds, this streams updates back using Server-Sent Events (SSE) so the browser doesn't hang.
        </p>
        <div style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(255,255,255,0.06)', padding: 10, borderRadius: 8 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>PAYLOAD:</div>
          <pre style={{ fontSize: 11, overflowX: 'auto', whiteSpace: 'pre', color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>
{`{
  "image": "data:image/jpeg;base64,...",
  "barcodeData": null
}`}
          </pre>
        </div>
        <div style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(255,255,255,0.06)', padding: 10, borderRadius: 8 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>STREAM_EVENTS:</div>
          <ul style={{ fontSize: 11.5, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            <li><code>vision</code>: kicks off the OCR processing.</li>
            <li><code>database</code>: matches the salt names in the CDSCO drug registry.</li>
            <li><code>pricing</code>: searches generic alternatives.</li>
            <li><code>complete</code>: gives you the final medicine details JSON object.</li>
          </ul>
        </div>
      </div>

      <div className="bento-card" style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--emerald)', border: '1px solid rgba(16,185,129,0.3)', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--font-mono)' }}>POST</span>
          <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>/api/groq</code>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          A secure proxy to keep Groq API keys out of the client browser. It handles key rotation and model fallback cascading server-side, so if one key gets rate-limited, it handles it without breaking the app.
        </p>
        <div style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(255,255,255,0.06)', padding: 10, borderRadius: 8 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>PAYLOAD_SHAPE:</div>
          <pre style={{ fontSize: 11, overflowX: 'auto', whiteSpace: 'pre', color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>
{`{
  "model": "llama-3.3-70b-versatile",
  "messages": [
    { "role": "user", "content": "Explain paracetamol..." }
  ]
}`}
          </pre>
        </div>
      </div>

      <div className="bento-card" style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', border: '1px solid rgba(6,182,212,0.3)', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--font-mono)' }}>GET</span>
          <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>/api/prices</code>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          Scrapes Apollopharmacy, Netmeds, and 1mg for real retail pricing of the generic salt so you can see exactly how much you're getting charged.
        </p>
      </div>

      <div className="bento-card" style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', border: '1px solid rgba(6,182,212,0.3)', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--font-mono)' }}>GET</span>
          <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>/api/davaindia</code>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          Looks up generic prices from Davaindia's catalog so we have live local price baselines.
        </p>
      </div>

      <button onClick={onBack} className="btn-cyber-primary" style={{ margin: '16px auto 32px' }}>
        BACK_TO_CONSOLE
      </button>
    </div>
  )
}
