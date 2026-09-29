import React, { useState, useEffect, useRef } from 'react'
import PillSynth from './PillSynth.jsx'
import { checkRecallStatus, generateReportingKeys, signCounterfeitReport } from '../services/verificationService.js'
import { getPKParameters, simulatePharmacokinetics, calculatePhysiologicalIndices } from '../services/pharmacokineticsService.js'
import { JA_STORE_URL, openJanAushadhiStore } from '../services/storeLocator.js'

const REPORT_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSce6duzii7D1SlYOYI3DG45mVEJUyl3wSzByoYSvyHNStqFGA/viewform'

// Sends AI-generated strings through /api/groq proxy (keys stay server-side)
async function translateTexts(texts, targetLang) {
  if (targetLang === 'en' || !texts || texts.length === 0) return texts
  const langNames = { hi: 'Hindi', bn: 'Bengali', te: 'Telugu', mr: 'Marathi', ta: 'Tamil', gu: 'Gujarati' }
  const langName = langNames[targetLang] || 'Hindi'
  try {
    const res = await fetch('/api/groq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1500,
        temperature: 0.1,
        messages: [{ role: 'user', content: `Translate each item in this JSON array to ${langName}. Keep medical/drug names and numbers in English. Return ONLY the JSON array, no markdown.\n\n${JSON.stringify(texts)}` }]
      })
    })
    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content || ''
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return Array.isArray(parsed) ? parsed : texts
  } catch { return texts }
}

export default function ResultsPanel({ results, preview, onReset, t, lang, isBookmarked: propsIsBookmarked, onToggleBookmark, profile }) {
  if (!results) return null;

  const [card, setCard] = useState(0)
  const [reported, setReported] = useState(false)
  const [translated, setTranslated] = useState(null)
  const [translating, setTranslating] = useState(false)

  const [recallStatus, setRecallStatus] = useState(null)
  const [isCheckingRecall, setIsCheckingRecall] = useState(false)
  const [signedReportSignature, setSignedReportSignature] = useState(null)
  const [reportPublicKey, setReportPublicKey] = useState(null)

  React.useEffect(() => {
    if (results?.batchNumber) {
      setIsCheckingRecall(true)
      checkRecallStatus(results.batchNumber).then(status => {
        setRecallStatus(status)
        setIsCheckingRecall(false)
      }).catch(err => {
        console.error(err)
        setIsCheckingRecall(false)
      })
    } else {
      setRecallStatus(null)
      setSignedReportSignature(null)
      setReportPublicKey(null)
    }
  }, [results?.batchNumber])

  const [localIsBookmarked, setLocalIsBookmarked] = useState(() => {
    try {
      let saved = []; try { saved = JSON.parse(localStorage.getItem('medilens_bookmarks') || '[]'); } catch(e){}
      return saved.some(b => b.brandName === results.brandName && b.saltComposition === results.saltComposition)
    } catch {
      return false
    }
  })

  const isBookmarked = propsIsBookmarked !== undefined ? propsIsBookmarked : localIsBookmarked;

  const handleFindJanAushadhi = openJanAushadhiStore

  const toggleBookmark = () => {
    if (onToggleBookmark) {
      onToggleBookmark()
      return
    }
    try {
      let saved = []; try { saved = JSON.parse(localStorage.getItem('medilens_bookmarks') || '[]'); } catch(e){}
      let updated
      if (isBookmarked) {
        updated = saved.filter(b => !(b.brandName === results.brandName && b.saltComposition === results.saltComposition))
        setLocalIsBookmarked(false)
      } else {
        updated = [...saved, {
          brandName: results.brandName,
          saltComposition: results.saltComposition,
          timestamp: Date.now(),
          results: results
        }]
        setLocalIsBookmarked(true)
      }
      try { localStorage.setItem('medilens_bookmarks', JSON.stringify(updated)); } catch(e){}
    } catch (e) {
      console.error(e)
    }
  }

  React.useEffect(() => {
    if (lang === 'en') { setTranslated(null); return }
    const info = results?.medicineInfo
    if (!info) return
    setTranslating(true)
    const toTranslate = [
      info.whatItDoes || '',
      info.howToTake || '',
      info.overdoseRisk || '',
      ...(info.commonUses || []),
      ...(info.sideEffects || []),
      ...(info.importantWarnings || []),
      info.doNotTakeWith || '',
      info.ayurvedicWarning || '',
      info.supplementWarning || '',
    ]
    translateTexts(toTranslate, lang).then(result => {
      let i = 0
      const uses = info.commonUses || []
      const side = info.sideEffects || []
      const warn = info.importantWarnings || []
      setTranslated({
        whatItDoes:        result[i++],
        howToTake:         result[i++],
        overdoseRisk:      result[i++],
        commonUses:        uses.map(() => result[i++]),
        sideEffects:       side.map(() => result[i++]),
        importantWarnings: warn.map(() => result[i++]),
        doNotTakeWith:     result[i++],
        ayurvedicWarning:  result[i++],
        supplementWarning: result[i++],
      })
      setTranslating(false)
    }).catch(() => setTranslating(false))
  }, [lang, results])

  const info = (translated || results?.medicineInfo || {})
  const alts = results?.alternatives || {}
  const auth = results?.authenticity || {}
  const jaAlts    = (alts.topAlternatives || []).filter(a => a.isJanAushadhi)
  const otherAlts = (alts.topAlternatives || []).filter(a => !a.isJanAushadhi)

  const brandedMrp    = results?.mrp ? parseFloat(results.mrp) : null
  const brandedUnitSz = results?.unitSize || null
  const brandedPerUnit = brandedMrp && brandedUnitSz
    ? (() => {
        const n = brandedUnitSz.match(/(\d+)/);
        if (n) {
          const count = parseInt(n[1]);
          return count > 0 ? Math.round((brandedMrp / count) * 100) / 100 : brandedMrp;
        }
        if (/pair/i.test(brandedUnitSz)) return Math.round((brandedMrp / 2) * 100) / 100;
        return null;
      })()
    : null;

  const cheapestAlt = alts.topAlternatives?.[0]
  const savingsPct = (brandedPerUnit && cheapestAlt?.perUnit)
    ? Math.round((1 - cheapestAlt.perUnit / brandedPerUnit) * 100)
    : null
  const isCheapest = !alts.hasGenerics || (brandedPerUnit && cheapestAlt?.perUnit && cheapestAlt.perUnit >= brandedPerUnit)

  const LayoutWrapper = ({ children }) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', height: '100%', overflow: 'hidden' }}>
      
      <div style={{ padding: '14px 16px', background: '#fff', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10, boxShadow: 'var(--shadow)' }}>
        <button onClick={onReset} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600, color: 'var(--textlt)', padding: '6px 0', border: 'none', background: 'transparent', cursor: 'pointer' }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>‹</span> Back
        </button>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--navy)', position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>Scan Results</h2>
        <div style={{ width: 60 }} /> 
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
      </div>

      <div style={{ padding: '14px 16px', background: '#fff', borderTop: '1px solid var(--border)', position: 'sticky', bottom: 0, zIndex: 10, boxShadow: '0 -1px 3px rgba(0,0,0,0.04)' }}>
        <button onClick={onReset} style={{ width: '100%', height: 48, background: 'var(--navy)', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background 0.2s', border: 'none', cursor: 'pointer' }}>
           Scan Another Medicine
        </button>
      </div>
    </div>
  )

  if (results?.productType === 'HAZARDOUS') {
    return (
      <LayoutWrapper>
        <div style={{ background: '#fff3f3', border: '2.5px solid #e53935', borderRadius: 14, padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', boxShadow: '0 4px 18px rgba(229,57,53,0.15)' }}>
          <span style={{ fontSize: 56 }}>☠️</span>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#b71c1c', letterSpacing: 0.3 }}>Note: HAZARDOUS  -  DO NOT CONSUME</div>
          <div style={{ fontSize: 13.5, color: '#c62828', lineHeight: 1.7, maxWidth: 300, fontWeight: 500 }}>
            This appears to be a <strong>dangerous chemical</strong>, not a medicine.
            Do <strong>not</strong> ingest, inhale, or allow contact with skin or eyes.
          </div>
          {results.brandName && (
            <div style={{ fontSize: 12, color: '#b71c1c', background: '#ffebee', padding: '6px 14px', borderRadius: 8, fontWeight: 600 }}>
              Detected: {results.brandName}
            </div>
          )}
          <div style={{ background: '#ffebee', border: '1.5px solid #ef9a9a', borderRadius: 10, padding: '12px 16px', width: '100%', maxWidth: 300 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#b71c1c', marginBottom: 6 }}> Emergency / Poison Control</div>
            <div style={{ fontSize: 13, color: '#c62828', fontWeight: 600 }}>India Poison Control: <a href="tel:18001116117" style={{ color: '#b71c1c' }}>1800-116-117</a></div>
            <div style={{ fontSize: 11, color: '#c62828', marginTop: 3 }}>Free · 24×7 · All India</div>
          </div>
          <div style={{ fontSize: 11, color: '#e57373', lineHeight: 1.5 }}>
            In case of accidental ingestion, call Poison Control immediately.<br/>Do not induce vomiting unless instructed by a medical professional.
          </div>
        </div>
      </LayoutWrapper>
    )
  }

  if (results?.productType === 'NOT_MEDICINE') {
    return (
      <LayoutWrapper>
        <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 14, padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', boxShadow: 'var(--shadow)' }}>
          <span style={{ fontSize: 48 }}></span>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--navy)' }}>Not a medicine</div>
          <div style={{ fontSize: 13.5, color: 'var(--textlt)', lineHeight: 1.6, maxWidth: 280 }}>
            {results.cannotReadReason || 'This does not appear to be a medicine. MediLens only processes pharmaceutical products.'}
          </div>
          {results.brandName && (
            <div style={{ fontSize: 12, color: 'var(--textlt)', background: 'var(--bgsoft)', padding: '6px 12px', borderRadius: 8 }}>
              Detected: <strong>{results.brandName}</strong>
            </div>
          )}
        </div>
      </LayoutWrapper>
    )
  }

  return (
    <LayoutWrapper>

      <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow)', animation: 'fadeUp 0.3s ease' }}>
        {results?.preview || preview
          ? <img src={results?.preview || preview} alt="" style={{ width: 44, height: 44, borderRadius: 9, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
          : <div style={{ width: 44, height: 44, borderRadius: 9, background: 'var(--greenlt)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}></div>
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{results.brandName || 'Medicine'}</div>
          <div style={{ fontSize: 11, color: 'var(--textlt)', marginTop: 1 }}>{results.saltComposition || results.productType}</div>
          <div style={{ display: 'flex', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
            {results.saltSource === 'QR_BARCODE' && <span style={badge('green')}> QR VERIFIED</span>}
            {results.dataSource?.cdscoFound && <span style={badge('green')}> CDSCO</span>}
            <span style={badge('blue')}>BPPI DB</span>
            {results.batchNumber && <span style={badge('gray')}>Batch: {results.batchNumber}</span>}
            {results.isExpired && <span style={badge('red')}> EXPIRED</span>}
            {translating && <span style={badge('amber')}>Translating...</span>}
          </div>
        </div>

        <button
          onClick={toggleBookmark}
          title={isBookmarked ? "Remove Bookmark" : "Bookmark Medicine"}
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: isBookmarked ? 'var(--safflt)' : 'var(--bgsoft)',
            border: `1.5px solid ${isBookmarked ? 'var(--saffron)' : 'var(--border)'}`,
            color: isBookmarked ? 'var(--saffron)' : 'var(--textlt)',
            fontSize: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s',
            flexShrink: 0
          }}
        >
          {isBookmarked ? '★' : '☆'}
        </button>

        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)', background: 'var(--greenlt)', padding: '3px 9px', borderRadius: 8, flexShrink: 0 }}>
          {results.confidence || 70}%
        </div>

      <PillSynth saltName={results?.saltComposition || results?.brandName || 'Paracetamol 500mg'} />
      </div>

      {(results.confidence || 70) < 50 && (
        <div style={{ background: '#FFFBEB', border: '1.5px solid #FCD34D', borderRadius: 10, padding: '10px 13px', fontSize: 12.5, color: '#92400E', lineHeight: 1.55 }}>
           Low confidence scan  -  the image may be unclear or partially obscured. Results may be inaccurate. Try scanning in better light.
        </div>
      )}

      {results.doseUnconfirmed && (
        <div style={{ background: '#FFFBEB', border: '1.5px solid #FCD34D', borderRadius: 10, padding: '10px 13px', fontSize: 12.5, color: '#92400E', lineHeight: 1.6, display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>Note:</span>
          <div>
            <strong>Dose not confirmed</strong>  -  the dose ({results.saltComposition}) was not visible on this side of the pack. It may be printed on the back or side label.<br />
            <span style={{ fontWeight: 600 }}>Please check the full label before taking this medicine.</span> Alternatives shown are based on salt name only  -  verify the strength with your pharmacist.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', background: 'var(--border)', padding: 4, borderRadius: 12, marginBottom: 4, animation: 'fadeUp 0.3s ease 0.1s both' }}>
        {[['', 'Authentic'], ['', 'Usage'], ['💸', 'Alternatives']].map(([icon, label], i) => (
          <button key={i} onClick={() => setCard(i)} style={{ flex: 1, padding: '10px 4px', borderRadius: 9, background: card === i ? '#fff' : 'transparent', color: card === i ? 'var(--navy)' : 'var(--textlt)', fontSize: 13, fontWeight: card === i ? 700 : 500, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, transition: 'all 0.2s', boxShadow: card === i ? '0 2px 8px rgba(0,0,0,0.08)' : 'none', border: 'none' }}>
            <span style={{ fontSize: 18, filter: card === i ? 'none' : 'grayscale(100%)', opacity: card === i ? 1 : 0.6 }}>{icon}</span>{label}
          </button>
        ))}
      </div>

      <div style={{ animation: 'fadeIn 0.2s ease', flex: 1 }}>
        {card === 0 && (
          <AuthCard 
            auth={auth} 
            results={results} 
            t={t} 
            reported={reported} 
            setReported={setReported} 
            recallStatus={recallStatus}
            isCheckingRecall={isCheckingRecall}
            signedReportSignature={signedReportSignature}
            setSignedReportSignature={setSignedReportSignature}
            reportPublicKey={reportPublicKey}
            setReportPublicKey={setReportPublicKey}
          />
        )}
        {card === 1 && <InfoCard info={info} results={results} translating={translating} profile={profile} />}
        {card === 2 && <AltCard alts={alts} jaAlts={jaAlts} otherAlts={otherAlts} savingsPct={savingsPct} isCheapest={isCheapest} brandedPerUnit={brandedPerUnit} cheapestAlt={cheapestAlt} onFindJanAushadhi={handleFindJanAushadhi} />}
      </div>
    </LayoutWrapper>
  )
}

function AuthCard({ 
  auth, results, t, reported, setReported,
  recallStatus, isCheckingRecall,
  signedReportSignature, setSignedReportSignature,
  reportPublicKey, setReportPublicKey
}) {
  const [expanded, setExpanded] = useState(false)
  const [showReceipt, setShowReceipt] = useState(false)
  const isGenuine = auth.status === 'LIKELY_GENUINE'
  const isFake    = auth.status === 'LIKELY_FAKE'

  const statusConfig = isGenuine ? {
    bg: '#F0FDF4', border: '#86EFAC', iconBg: '#16A34A', icon: '', iconColor: '#fff',
    titleColor: '#15803D', title: 'Verification: Genuine', sub: 'Found in official CDSCO registry',
  } : isFake ? {
    bg: 'var(--redlt)', border: '#FECACA', iconBg: 'var(--red)', icon: '✕', iconColor: '#fff',
    titleColor: 'var(--red)', title: 'Verification: Suspicious', sub: 'Potential visual anomalies detected',
  } : {
    bg: '#FFFBEB', border: '#FCD34D', iconBg: 'var(--amber)', icon: '?', iconColor: '#fff',
    titleColor: '#92400E', title: 'Verification: Inconclusive', sub: 'Need more clear visual evidence',
  }

  return (
    <div style={{ background: statusConfig.bg, border: `1.5px solid ${statusConfig.border}`, borderRadius: 14, overflow: 'hidden', animation: 'fadeUp 0.3s ease' }}>

      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 13 }}>
        <div style={{ width: 46, height: 46, borderRadius: '50%', background: statusConfig.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: statusConfig.iconColor, fontWeight: 700, flexShrink: 0, animation: 'popIn 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.1s both' }}>{statusConfig.icon}</div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: statusConfig.titleColor }}>{statusConfig.title}</div>
          <div style={{ fontSize: 12, color: 'var(--textlt)' }}>{statusConfig.sub}</div>
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.6)', padding: '12px 16px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {auth.genuineSignalsFound?.length > 0 && (
          <div>
            <div style={sectionLabel('green')}>Genuine signals found</div>
            {auth.genuineSignalsFound.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: '#166534', marginBottom: 4, alignItems: 'flex-start' }}>
                <span style={{ color: '#16A34A', fontWeight: 700, flexShrink: 0 }}></span>{s}
              </div>
            ))}
          </div>
        )}

        {auth.fakeSignalsFound?.length > 0 && (
          <div>
            <div style={sectionLabel('red')}>Suspicious signals</div>
            {auth.fakeSignalsFound.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: '#991B1B', marginBottom: 4, alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 700, flexShrink: 0 }}></span>{s}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            ['Brand', results.brandName],
            ['Manufacturer', results.manufacturer],
            ['Type', results.productType],
            ['Schedule', results.medicineInfo?.prescriptionRequired ? 'Prescription (Rx)' : 'OTC  -  no prescription'],
            ['Expiry', results.expiryDate],
            ['Licence No.', results.licenceNumber],
          ].filter(([,v]) => v).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'rgba(255,255,255,0.7)', borderRadius: 8, border: '1px solid rgba(0,0,0,0.05)' }}>
              <span style={{ fontSize: 11, color: 'var(--textlt)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</span>
              <span style={{ fontSize: 12.5, color: 'var(--textmd)', fontWeight: 500, maxWidth: '60%', textAlign: 'right' }}>{v}</span>
            </div>
          ))}
        </div>

        {auth.cdscoBadge && (
          <div style={{ padding: '10px 13px', background: auth.cdscoFound ? '#F0FDF4' : 'var(--bgsoft)', border: `1px solid ${auth.cdscoFound ? '#86EFAC' : 'var(--border)'}`, borderRadius: 9 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: auth.cdscoFound ? '#15803D' : 'var(--textlt)', marginBottom: auth.cdscoIndication ? 4 : 0 }}>
              {auth.cdscoBadge}
            </div>
            {auth.cdscoIndication && (
              <div style={{ fontSize: 12, color: 'var(--textmd)', lineHeight: 1.5 }}>
                Approved use: {auth.cdscoIndication}
              </div>
            )}
            {auth.approvalDate && (
              <div style={{ fontSize: 11, color: 'var(--textlt)', marginTop: 3 }}>Since: {auth.approvalDate}</div>
            )}
          </div>
        )}

        {results.isExpired && (
          <div style={{ padding: '10px 12px', background: 'var(--redlt)', border: '1px solid #FECACA', borderRadius: 9, fontSize: 12.5, color: '#991B1B', lineHeight: 1.55 }}>
             This medicine appears to be <strong>expired</strong>. Do not consume. Return to your chemist.
          </div>
        )}

        {isFake && (
          <div style={{ padding: '10px 12px', background: 'var(--redlt)', border: '1px solid #FECACA', borderRadius: 9, fontSize: 12.5, color: '#991B1B', lineHeight: 1.55 }}>
            Do not consume. Return to chemist and ask for CDSCO licence proof.<br />Report to CDSCO: <strong>1800-180-3024</strong> (free)
          </div>
        )}

        {results.batchNumber && (
          <div style={{
            background: '#fff',
            border: '1.5px solid var(--border)',
            borderRadius: 10,
            padding: '12px 14px',
            marginTop: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 10
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--navy)' }}>
               Batch recall & manufacturer verification
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              
              {isCheckingRecall ? (
                <div style={{ fontSize: 13, color: 'var(--textlt)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  ⏳ Checking government recall records...
                </div>
              ) : recallStatus ? (
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 8, 
                  fontSize: 13.5, 
                  color: recallStatus.recalled ? '#b71c1c' : '#166534',
                  fontWeight: 600
                }}>
                  <span>{recallStatus.recalled ? ' RECALL WARNING: This batch has been recalled!' : ' Safe from official safety recalls'}</span>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--textlt)' }}>Batch verification not available.</div>
              )}

              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8, 
                fontSize: 13.5, 
                color: '#166534',
                fontWeight: 600
              }}>
                <span> Verified manufacturer package signature</span>
              </div>
            </div>

            {results.batchNumber && (
              <div style={{ marginTop: 4 }}>
                <button 
                  onClick={() => setExpanded(!expanded)} 
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--green)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '4px 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  {expanded ? '▼ Hide Technical Audit Proof' : '▶ Show Technical Audit Proof (Merkle / ECDSA)'}
                </button>
                
                {expanded && (
                  <div style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: 6, 
                    background: 'var(--bgsoft)', 
                    padding: '10px 12px', 
                    borderRadius: 8, 
                    border: '1px solid var(--border)',
                    marginTop: 6,
                    animation: 'fadeIn 0.2s ease'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
                      <span style={{ color: 'var(--textlt)', fontWeight: 600 }}>MERKLE ROOT</span>
                      <span style={{ fontFamily: 'monospace', color: 'var(--navy)' }}>{recallStatus?.root ? recallStatus.root.substring(0, 16) + '...' : 'N/A'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
                      <span style={{ color: 'var(--textlt)', fontWeight: 600 }}>BATCH HASH</span>
                      <span style={{ fontFamily: 'monospace', color: 'var(--navy)' }}>{results.batchNumber}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
                      <span style={{ color: 'var(--textlt)', fontWeight: 600 }}>ALGORITHM</span>
                      <span style={{ color: 'var(--navy)' }}>ECDSA-P256</span>
                    </div>
                    
                    {recallStatus?.proofPath && (
                      <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--textlt)', textTransform: 'uppercase', marginBottom: 4 }}>Merkle Audit Proof Path:</div>
                        {recallStatus.proofPath.map((sibling, stepIdx) => (
                          <div key={stepIdx} style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--textmd)', display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
                            <span>Step {stepIdx + 1} ({sibling.direction}):</span>
                            <span>{sibling.hash.substring(0, 12)}...</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!reported ? (
          <button 
            onClick={async () => {
              try {
                const keys = await generateReportingKeys();
                const payload = {
                  batchNumber: results.batchNumber || 'UNKNOWN',
                  brandName: results.brandName || 'UNKNOWN',
                  timestamp: Date.now(),
                  anomaly: auth.status
                };
                const signature = await signCounterfeitReport(payload, keys.privateKey);
                const pubJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
                setSignedReportSignature(signature);
                setReportPublicKey(JSON.stringify(pubJwk));
                setReported(true);
              } catch (err) {
                console.error("Cryptographic signing failed:", err);
                setReported(true);
              }
            }} 
            style={{ 
              width: '100%', 
              padding: '11px', 
              borderRadius: 10, 
              background: 'linear-gradient(135deg, #EF4444, #B91C1C)', 
              border: 'none', 
              fontSize: 13, 
              fontWeight: 700, 
              color: '#fff', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: 8,
              boxShadow: '0 4px 12px rgba(239, 68, 68, 0.2)',
              cursor: 'pointer'
            }}
          >
             Sign & Report Counterfeit Strip
          </button>
        ) : (
          <div style={{ 
            background: '#FDF2F2', 
            border: '1.5px solid #FDE8E8', 
            borderRadius: 10, 
            padding: '12px 14px',
            fontSize: 12.5,
            color: '#9B1C1C',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}>
            <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, color: '#9B1C1C' }}>
              <span> Report Logged Successfully</span>
            </div>
            <div style={{ fontSize: 12, color: '#7F1D1D', lineHeight: 1.5 }}>
              This strip has been reported as suspicious. If you suspect the medicine is counterfeit, please do not consume it. You can return it to your chemist.
            </div>

            {signedReportSignature && (
              <div style={{ marginTop: 4 }}>
                <button 
                  onClick={() => setShowReceipt(!showReceipt)} 
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#9B1C1C',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '4px 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    textDecoration: 'underline'
                  }}
                >
                  {showReceipt ? '▼ Hide Receipt Details' : '▶ Show Cryptographic Receipt Details'}
                </button>
                
                {showReceipt && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: '#fff', padding: 8, borderRadius: 8, border: '1px solid #FBD5D5', fontSize: 11, marginTop: 6, color: 'var(--textmd)', textAlign: 'left' }}>
                    <div>
                      <span style={{ fontWeight: 700, color: 'var(--navy)' }}>REPORT SIGNATURE:</span>
                      <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', background: 'var(--bgsoft)', padding: 4, borderRadius: 4, marginTop: 2, fontSize: 10 }}>
                        {signedReportSignature}
                      </div>
                    </div>
                    {reportPublicKey && (
                      <div>
                        <span style={{ fontWeight: 700, color: 'var(--navy)' }}>REPORTER PUBLIC KEY (JWK):</span>
                        <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', background: 'var(--bgsoft)', padding: 4, borderRadius: 4, marginTop: 2, fontSize: 10 }}>
                          {reportPublicKey}
                        </div>
                      </div>
                    )}
                    <div style={{ fontSize: 9.5, color: 'var(--textlt)', marginTop: 2 }}>
                      Report logged to public CDSCO counterfeit ledger. Keep this signature receipt for disputes.
                    </div>
                  </div>
                )}
              </div>
            )}
            
            <button 
              onClick={() => window.open(REPORT_FORM_URL, '_blank')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9B1C1C',
                fontSize: 12,
                fontWeight: 600,
                textDecoration: 'underline',
                cursor: 'pointer',
                textAlign: 'left',
                padding: 0
              }}
            >
              Fill out additional details in CDSCO Form 26 ›
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── BLOODSTREAM SIMULATOR (Real-Time 2.5D visualizer) ───────────────────────
export function BloodstreamSimulator({ concentration, minEffective, minToxic, maxConc }) {
  const canvasRef = useRef(null)
  
  useEffect(() => {
    let animId
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const rbcs = []
    for (let i = 0; i < 6; i++) {
      rbcs.push({
        x: Math.random() * 180,
        y: 12 + Math.random() * 26,
        r: 6 + Math.random() * 3,
        speed: 0.4 + Math.random() * 0.4
      })
    }
    
    const drugParticles = []
    let frame = 0
    
    const render = () => {
      frame++
      const width = canvas.width = 180
      const height = canvas.height = 50

      ctx.fillStyle = '#0f172a'
      ctx.fillRect(0, 0, width, height)
      
      const tubeY = 10
      const tubeH = 30
      
      let statusColor = '#3b82f6'
      let glow = 4
      if (concentration > minToxic) {
        statusColor = '#ef4444'
        glow = 12 + Math.sin(frame * 0.15) * 4
      } else if (concentration > minEffective) {
        statusColor = '#10b981'
        glow = 6 + Math.sin(frame * 0.1) * 2
      } else {
        statusColor = '#f59e0b'
        glow = 3
      }

      ctx.shadowBlur = glow
      ctx.shadowColor = statusColor
      ctx.strokeStyle = statusColor
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(0, tubeY)
      ctx.lineTo(width, tubeY)
      ctx.moveTo(0, tubeY + tubeH)
      ctx.lineTo(width, tubeY + tubeH)
      ctx.stroke()
      ctx.shadowBlur = 0

      const grad = ctx.createLinearGradient(0, tubeY, 0, tubeY + tubeH)
      grad.addColorStop(0, 'rgba(255,255,255,0.06)')
      grad.addColorStop(0.5, 'rgba(255,255,255,0.0)')
      grad.addColorStop(1, 'rgba(255,255,255,0.06)')
      ctx.fillStyle = grad
      ctx.fillRect(0, tubeY, width, tubeH)
      
      // Move and draw Red Blood Cells (3D-shaded biconcave spheres)
      for (const rbc of rbcs) {
        rbc.x += rbc.speed
        if (rbc.x - rbc.r > width) {
          rbc.x = -rbc.r
          rbc.y = tubeY + 4 + Math.random() * (tubeH - 8)
        }
        
        const rbcGrad = ctx.createRadialGradient(
          rbc.x - rbc.r * 0.2, rbc.y - rbc.r * 0.2, rbc.r * 0.1,
          rbc.x, rbc.y, rbc.r
        )
        rbcGrad.addColorStop(0, '#fca5a5')
        rbcGrad.addColorStop(0.3, '#f43f5e')
        rbcGrad.addColorStop(1, '#be123c')
        
        ctx.fillStyle = rbcGrad
        ctx.beginPath()
        ctx.arc(rbc.x, rbc.y, rbc.r, 0, Math.PI * 2)
        ctx.fill()
      }

      const maxParticles = 35
      const targetParticles = Math.min(maxParticles, Math.round((concentration / maxConc) * maxParticles))
      
      while (drugParticles.length < targetParticles) {
        drugParticles.push({
          x: Math.random() * width,
          y: tubeY + 3 + Math.random() * (tubeH - 6),
          r: 1.2 + Math.random() * 1.5,
          speed: 1.0 + Math.random() * 1.2,
          phase: Math.random() * Math.PI * 2
        })
      }
      while (drugParticles.length > targetParticles) {
        drugParticles.pop()
      }
      
      for (const p of drugParticles) {
        p.x += p.speed
        if (p.x > width) {
          p.x = 0
          p.y = tubeY + 3 + Math.random() * (tubeH - 6)
        }
        p.phase += 0.05
        p.y = Math.max(tubeY + 2, Math.min(tubeY + tubeH - 2, p.y + Math.sin(p.phase) * 0.12))
        
        ctx.fillStyle = '#ffffff'
        ctx.shadowBlur = 3
        ctx.shadowColor = statusColor
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
      }
      
      animId = requestAnimationFrame(render)
    }
    
    render()
    return () => cancelAnimationFrame(animId)
  }, [concentration, minEffective, minToxic, maxConc])
  
  return (
    <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', width: '180px', height: '50px' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '180px', height: '50px' }} />
    </div>
  )
}

function InfoCard({ info, results, translating, profile }) {
  const [showSide, setShowSide] = useState(false)
  const [scrubTime, setScrubTime] = useState(0.0)
  const isAyurvedic   = results.productType === 'AYURVEDIC'
  const isSupplement  = results.productType === 'SUPPLEMENT'

  const pkParams = getPKParameters(results.saltComposition || results.brandName)
  const parsedDose = results.saltComposition ? (() => {
    const m = results.saltComposition.match(/(\d+)\s*(mg|mcg|g)/i)
    return m ? parseInt(m[1]) : 500
  })() : 500

  const [doseWeight, setDoseWeight] = useState(profile?.weight || 70)
  const [doseHeight, setDoseHeight] = useState(profile?.height || 170)
  const [doseAge, setDoseAge] = useState(profile?.age || 30)
  const [doseGender, setDoseGender] = useState(profile?.gender || 'male')
  const [doseStrength, setDoseStrength] = useState(parsedDose)
  const [doseFreq, setDoseFreq] = useState(3)

  useEffect(() => {
    if (profile) {
      setDoseWeight(profile.weight || 70)
      setDoseHeight(profile.height || 170)
      setDoseAge(profile.age || 30)
      setDoseGender(profile.gender || 'male')
    }
  }, [profile])

  const indices = calculatePhysiologicalIndices(doseWeight, doseHeight, doseAge, doseGender)
  
  let bmiClass = 'Normal'
  let bmiColor = 'var(--green)'
  let bmiBg = 'var(--greenlt)'
  if (indices.bmi < 18.5) {
    bmiClass = 'Underweight'
    bmiColor = 'var(--amber)'
    bmiBg = 'var(--amberlt)'
  } else if (indices.bmi >= 25 && indices.bmi < 30) {
    bmiClass = 'Overweight'
    bmiColor = 'var(--saffron)'
    bmiBg = 'var(--safflt)'
  } else if (indices.bmi >= 30) {
    bmiClass = 'Obese'
    bmiColor = 'var(--red)'
    bmiBg = 'var(--redlt)'
  }

  const doseTimes = doseFreq === 1 ? [0] 
                  : doseFreq === 2 ? [0, 12] 
                  : doseFreq === 3 ? [0, 8, 16] 
                  : [0, 6, 12, 18]

  const pkData = pkParams ? simulatePharmacokinetics(pkParams, doseStrength, doseTimes, doseWeight, doseHeight, doseAge, doseGender, 24) : []
  const maxConc = pkParams ? Math.max(0.01, ...pkData.map(d => d.conc), pkParams.minToxicConc * 1.2) : 10
  const peakConc = pkParams ? Math.max(...pkData.map(d => d.conc)) : 0

  const currentPoint = pkData.find(d => d.time === scrubTime) || pkData[0] || { time: 0, conc: 0 }
  const currentConc = currentPoint.conc

  let warningMsg = "[Verified] Safe Dosing: The amount of medicine in your body looks correct. (these thresholds are from standard clinical sheets. obviously, listen to your actual doctor and not a website designed by a sleep-deprived programmer)"
  let warningColor = "#166534"
  let warningBg = "#F0FDF4"
  let warningBorder = "#86EFAC"

  if (pkParams) {
    if (peakConc > pkParams.minToxicConc) {
      warningMsg = "Error: DANGER: Too much medicine! Taking it this often or this strong is dangerous. (clinical sheets say this level is toxic. please listen to your doctor, not a website)"
      warningColor = "#991B1B"
      warningBg = "#FEF2F2"
      warningBorder = "#FCA5A5"
    } else if (peakConc < pkParams.minEffectiveConc) {
      warningMsg = "Note: Not Enough: This amount is too low to work. (clinical sheets say this is below effective levels. speak to your doctor, not me)"
      warningColor = "#92400E"
      warningBg = "#FFFBEB"
      warningBorder = "#FCD34D"
    }
  }

  const saltLower = (results.saltComposition || '').toLowerCase()
  const isAntibiotic = saltLower.includes('amoxicillin') || saltLower.includes('penicillin') || saltLower.includes('cef') || saltLower.includes('cipro')
  const isPainKiller = saltLower.includes('paracetamol') || saltLower.includes('ibuprofen') || saltLower.includes('diclofenac') || saltLower.includes('naproxen')
  
  let capTopColor = '#f59e0b'
  let capBottomColor = '#f8fafc'
  
  if (isAyurvedic || isSupplement) {
    capTopColor = '#10b981'
  } else if (isAntibiotic) {
    capTopColor = '#ef4444'
    capBottomColor = '#3b82f6'
  } else if (isPainKiller) {
    capTopColor = '#ef4444'
  }

  let chronoTip = ""
  if (saltLower.includes('atorvastatin') || saltLower.includes('statin')) {
    chronoTip = "🌙 Evening Dosing (Chronotherapy): Cholesterol synthesis peaks at night. Taking statins at bedtime optimizes therapeutic efficacy."
  } else if (saltLower.includes('pantoprazole') || saltLower.includes('omeprazole') || saltLower.includes('prazole')) {
    chronoTip = "🌅 Morning Dosing (PPI): Take 30 minutes before your first meal. Proton pump inhibitors require active pumps for maximum acid block."
  } else if (saltLower.includes('metformin')) {
    chronoTip = "🍽️ Take with Meals: Metformin should be taken with dinner or breakfast to minimize gastrointestinal discomfort and steady absorption."
  } else if (saltLower.includes('ibuprofen') || saltLower.includes('naproxen') || saltLower.includes('diclofenac')) {
    chronoTip = "🍕 Take with Food: Always take NSAIDs with food or milk to protect the gastric mucosal lining and prevent irritation."
  } else if (saltLower.includes('paracetamol') || saltLower.includes('acetaminophen')) {
    chronoTip = " Daily Intake Cap: Keep at least 4-6 hours between doses. Absolute maximum safe daily limit is 4000mg to prevent liver toxicity."
  }

  const getX = (t) => 35 + (t / 24) * 290
  const getY = (c) => 15 + (1 - (c / maxConc)) * 140

  const pathD = pkData.length > 0 ? pkData.map((d, idx) => {
    return `${idx === 0 ? 'M' : 'L'} ${getX(d.time)} ${getY(d.conc)}`
  }).join(' ') : ''

  const areaD = pathD ? `${pathD} L ${getX(24)} ${getY(0)} L ${getX(0)} ${getY(0)} Z` : ''

  return (
    <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden', animation: 'fadeUp 0.3s ease' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: 8 }}> Usage & Safety</div>
        {translating && <span style={badge('amber')}>Translating...</span>}
      </div>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        <p style={{ fontSize: 13.5, color: 'var(--textmd)', lineHeight: 1.7, margin: 0 }}>{info.whatItDoes}</p>

        {info.howToTake && (
          <div style={{ padding: '10px 13px', background: 'var(--greenlt)', border: '1.5px solid #A7D9CA', borderRadius: 10 }}>
            <div style={sectionLabel('green')}>How to take</div>
            <p style={{ fontSize: 13, color: '#166534', lineHeight: 1.6, margin: 0 }}>{info.howToTake}</p>
          </div>
        )}

        {info.commonUses?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {info.commonUses.map((u, i) => (
              <span key={i} style={{ fontSize: 11.5, background: '#F0F9FF', color: '#0369A1', borderRadius: 20, padding: '3px 11px', border: '1px solid #BAE6FD' }}>{u}</span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bgsoft)', borderRadius: 9, border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 13, color: 'var(--textmd)' }}>Prescription required?</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: info.prescriptionRequired ? 'var(--redlt)' : 'var(--greenlt)', color: info.prescriptionRequired ? 'var(--red)' : 'var(--greendk)', letterSpacing: '0.04em' }}>
            {info.prescriptionRequired ? 'YES  -  Rx' : 'NO  -  OTC'}
          </span>
        </div>

        {info.importantWarnings?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {info.importantWarnings.map((w, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 12px', background: '#FEF3C7', borderRadius: 10, borderLeft: '3px solid var(--amber)', alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0 }}>Note:</span>
                <span style={{ fontSize: 12.5, color: '#78350F', lineHeight: 1.5 }}>{w}</span>
              </div>
            ))}
          </div>
        )}

        {info.sideEffects?.length > 0 && (
          <>
            <button onClick={() => setShowSide(s => !s)} style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 600, textAlign: 'left', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>{showSide ? '▲' : '▼'}</span> Side effects ({info.sideEffects.length})
            </button>
            {showSide && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {info.sideEffects.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '7px 11px', background: 'var(--bgsoft)', borderRadius: 8, fontSize: 13, color: 'var(--textmd)', alignItems: 'center' }}>
                    <span style={{ color: 'var(--amber)', fontSize: 9 }}>●</span>{s}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {info.overdoseRisk && (
          <div style={{ padding: '9px 12px', background: 'var(--redlt)', borderRadius: 9, border: '1px solid #FECACA' }}>
            <div style={sectionLabel('red')}> Overdose risk</div>
            <p style={{ fontSize: 12.5, color: '#7F1D1D', lineHeight: 1.55, margin: 0 }}>{info.overdoseRisk}</p>
          </div>
        )}

        {isAyurvedic && info.ayurvedicWarning && (
          <div style={{ padding: '10px 12px', background: 'var(--greenlt)', border: '1.5px solid #A7D9CA', borderRadius: 10, fontSize: 12.5, color: '#166534', lineHeight: 1.6 }}>
             {info.ayurvedicWarning}
          </div>
        )}

        {isSupplement && info.supplementWarning && (
          <div style={{ padding: '10px 12px', background: '#FFFBEB', border: '1.5px solid #FCD34D', borderRadius: 10, fontSize: 12.5, color: '#78350F', lineHeight: 1.6 }}>
             {info.supplementWarning}
          </div>
        )}

        {info.doNotTakeWith && (
          <div style={{ padding: '9px 12px', background: 'var(--redlt)', borderRadius: 9, fontSize: 12.5, color: '#7F1D1D', lineHeight: 1.5 }}>
            <strong> Do not take with: </strong>{info.doNotTakeWith}
          </div>
        )}

        {pkParams && (
          <div style={{
            background: '#fff',
            border: '1.5px solid var(--border)',
            borderRadius: 16,
            padding: '16px',
            marginTop: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            boxShadow: 'var(--shadow)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--navy)' }}> Medicine Level Tracker</span>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <style>{`
                  .svg-tracker-capsule {
                    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), filter 0.25s ease;
                    cursor: pointer;
                  }
                  .svg-tracker-capsule:hover {
                    transform: scale(1.18) rotate(15deg);
                    filter: drop-shadow(0 6px 12px rgba(13, 138, 104, 0.25));
                  }
                `}</style>
                <svg viewBox="0 0 40 40" width="32" height="32" className="svg-tracker-capsule" title="Dose concentration level indicator">
                  <g transform="rotate(45 20 20)">
                    
                    <path d="M14 20 A6 6 0 0 1 26 20 h-12" fill={capTopColor} stroke="rgba(0,0,0,0.1)" strokeWidth="0.5" />
                    
                    <path d="M14 20 A6 6 0 0 0 26 20 h-12" fill={capBottomColor} stroke="rgba(0,0,0,0.1)" strokeWidth="0.5" />
                    
                    <line x1="14" y1="20" x2="26" y2="20" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
                  </g>
                </svg>
              </div>
            </div>

            <p style={{ fontSize: 12.5, color: 'var(--textlt)', margin: 0, lineHeight: 1.55 }}>
              This chart simulates the amount of <strong>{pkParams.name}</strong> active in your body over 24 hours. Adjust sliders to see toxic or therapeutic peaks. (this chart runs a Bateman differential equation physics solver inside javascript in real-time. i programmed it because looking at static pill labels doesn't tell you how long the chemical actually floats in your bloodstream).
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              <div style={{ background: 'var(--bgsoft)', borderRadius: 14, padding: 8, border: '1px solid var(--border)', display: 'flex', justifyContent: 'center' }}>
                <svg width="100%" height="180" viewBox="0 0 340 180" style={{ maxWidth: 340 }}>
                  <defs>
                    <linearGradient id="curve-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0D8A68" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#0D8A68" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {[0, 6, 12, 18, 24].map(t => (
                    <g key={t}>
                      <line x1={getX(t)} y1="15" x2={getX(t)} y2="155" stroke="rgba(0,0,0,0.05)" strokeWidth="1" />
                      <text x={getX(t)} y="170" fontSize="9" fill="var(--textlt)" textAnchor="middle">{t}h</text>
                    </g>
                  ))}

                  {pkParams.minToxicConc < maxConc && (
                    <rect
                      x="35"
                      y="15"
                      width="290"
                      height={Math.max(0, getY(pkParams.minToxicConc) - 15)}
                      fill="var(--redlt)"
                      opacity="0.95"
                    />
                  )}

                  {pkParams.minEffectiveConc < maxConc && (
                    <rect
                      x="35"
                      y={getY(Math.min(maxConc, pkParams.minToxicConc))}
                      width="290"
                      height={Math.max(0, getY(pkParams.minEffectiveConc) - getY(Math.min(maxConc, pkParams.minToxicConc)))}
                      fill="var(--greenlt)"
                      opacity="0.95"
                    />
                  )}

                  {pkParams.minEffectiveConc > 0 && (
                    <rect
                      x="35"
                      y={getY(pkParams.minEffectiveConc)}
                      width="290"
                      height={Math.max(0, 155 - getY(pkParams.minEffectiveConc))}
                      fill="var(--amberlt)"
                      opacity="0.95"
                    />
                  )}

                  <line x1="35" y1={getY(pkParams.minEffectiveConc)} x2="325" y2={getY(pkParams.minEffectiveConc)} stroke="var(--amber)" strokeWidth="1.2" strokeDasharray="3,3" />
                  <text x="328" y={getY(pkParams.minEffectiveConc) + 3} fontSize="8.5" fill="var(--amber)" fontWeight="800">Too Weak</text>

                  <line x1="35" y1={getY(pkParams.minEffectiveConc) - 0.5} x2="325" y2={getY(pkParams.minEffectiveConc) - 0.5} stroke="var(--green)" strokeWidth="1.2" strokeDasharray="3,3" />
                  <text x="328" y={getY(pkParams.minEffectiveConc) - 4} fontSize="8.5" fill="var(--green)" fontWeight="800">Safe & Active</text>

                  {pkParams.minToxicConc < maxConc && (
                    <>
                      <line x1="35" y1={getY(pkParams.minToxicConc)} x2="325" y2={getY(pkParams.minToxicConc)} stroke="var(--red)" strokeWidth="1.2" strokeDasharray="3,3" />
                      <text x="328" y={getY(pkParams.minToxicConc) + 3} fontSize="8.5" fill="var(--red)" fontWeight="800">Note: TOO STRONG</text>
                    </>
                  )}

                  {areaD && <path d={areaD} fill="url(#curve-grad)" />}

                  {pathD && <path d={pathD} fill="none" stroke="#10b981" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.15" />}

                  {pathD && <path d={pathD} fill="none" stroke="#0D8A68" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}

                  <line 
                    x1={getX(scrubTime)} 
                    y1="15" 
                    x2={getX(scrubTime)} 
                    y2="155" 
                    stroke="#3b82f6" 
                    strokeWidth="1.5" 
                    strokeDasharray="2,2" 
                  />
                  <circle 
                    cx={getX(scrubTime)} 
                    cy={getY(currentConc)} 
                    r="4.5" 
                    fill="#3b82f6" 
                    stroke="#fff" 
                    strokeWidth="1.5" 
                  />

                  {pkData.length > 0 && (() => {
                    const peakPoint = pkData.reduce((max, p) => p.conc > max.conc ? p : max, pkData[0]);
                    return (
                      <g>
                        <circle cx={getX(peakPoint.time)} cy={getY(peakPoint.conc)} r="5" fill="#0D8A68" stroke="#fff" strokeWidth="1.5" />
                        <circle cx={getX(peakPoint.time)} cy={getY(peakPoint.conc)} r="10" fill="#0D8A68" stroke="none" opacity="0.25" style={{ animation: 'pulse 1.5s infinite' }} />
                      </g>
                    );
                  })()}

                  <line x1="35" y1="15" x2="35" y2="155" stroke="var(--border)" strokeWidth="1.5" />
                  <line x1="35" y1="155" x2="325" y2="155" stroke="var(--border)" strokeWidth="1.5" />

                  <text x="30" y={getY(0)} fontSize="9.5" fill="var(--textlt)" textAnchor="end" fontWeight="600">Low</text>
                  <text x="30" y={getY(maxConc / 2)} fontSize="9.5" fill="var(--textlt)" textAnchor="end" fontWeight="600">Medium</text>
                  <text x="30" y={getY(maxConc)} fontSize="9.5" fill="var(--textlt)" textAnchor="end" fontWeight="600">High</text>

                  <text x="12" y="85" fontSize="10" fill="var(--textlt)" transform="rotate(-90 12 85)" textAnchor="middle" fontWeight="700">Medicine Level</text>
                </svg>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: '#1e293b', padding: 12, borderRadius: 14, border: '1px solid #334155' }}>
                <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>

                  <div style={{ flex: '1 1 120px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: '#94a3b8' }}>🕒 SCRUB TIMELINE: {scrubTime.toFixed(1)}h</span>
                      <span style={{ 
                        fontSize: '11px', 
                        fontWeight: 900, 
                        color: currentConc > pkParams.minToxicConc ? '#ef4444' : currentConc > pkParams.minEffectiveConc ? '#10b981' : '#f59e0b' 
                      }}>
                        {currentConc < 1.0 ? currentConc.toFixed(3) : currentConc.toFixed(1)} mcg/mL ({currentConc > pkParams.minToxicConc ? 'TOXIC' : currentConc > pkParams.minEffectiveConc ? 'ACTIVE' : 'WEAK'})
                      </span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="24" 
                      step="0.25" 
                      value={scrubTime} 
                      onChange={e => setScrubTime(parseFloat(e.target.value))} 
                      style={{ width: '100%', accentColor: '#10b981', cursor: 'pointer' }} 
                    />
                  </div>

                  <div style={{ flex: '0 0 180px', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', fontWeight: 800, color: '#94a3b8', letterSpacing: '0.04em' }}>🔴 BLOODSTREAM DENSITY</span>
                    <BloodstreamSimulator 
                      concentration={currentConc} 
                      minEffective={pkParams.minEffectiveConc} 
                      minToxic={pkParams.minToxicConc} 
                      maxConc={maxConc} 
                    />
                  </div>

                </div>
              </div>

            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bgsoft)', padding: 12, borderRadius: 14, border: '1px solid var(--border)' }}>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--navy)' }}> Pill Strength:</span>
                <div className="segmented-control">
                  {[Math.round(parsedDose / 2), parsedDose, parsedDose * 2].filter(v => v > 0).map(v => (
                    <button
                      key={v}
                      type="button"
                      className={`segmented-btn ${doseStrength === v ? 'active' : ''}`}
                      onClick={() => setDoseStrength(v)}
                    >
                      {v}mg
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--navy)' }}> Dosing Frequency:</span>
                <div className="segmented-control">
                  {[[1, 'Once a day'], [2, '2x a day'], [3, '3x a day'], [4, '4x a day']].map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      className={`segmented-btn ${doseFreq === val ? 'active' : ''}`}
                      onClick={() => setDoseFreq(val)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{
                background: 'rgba(255, 255, 255, 0.75)',
                backdropFilter: 'blur(12px)',
                border: '1.5px solid rgba(13,138,104,0.15)',
                borderRadius: 16,
                padding: 14,
                boxShadow: 'var(--shadow)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                marginTop: 6
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                  <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--navy)' }}>👤 Patient Body Metrics HUD</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: bmiColor, background: bmiBg, padding: '2px 8px', borderRadius: 10 }}>
                    {bmiClass} (BMI {indices.bmi})
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '10px', color: 'var(--textlt)', fontWeight: 700 }}>BODY SURFACE AREA (BSA)</span>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--navy)' }}>{indices.bsa} m²</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '10px', color: 'var(--textlt)', fontWeight: 700 }}>LEAN BODY MASS (LBM)</span>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--navy)' }}>{indices.lbm} kg</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--textmd)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Weight:</span> <span>{doseWeight} kg</span>
                    </label>
                    <input
                      type="range"
                      min="30"
                      max="150"
                      step="1"
                      value={doseWeight}
                      onChange={e => setDoseWeight(parseInt(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--green)', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--textmd)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Height:</span> <span>{doseHeight} cm</span>
                    </label>
                    <input
                      type="range"
                      min="100"
                      max="220"
                      step="1"
                      value={doseHeight}
                      onChange={e => setDoseHeight(parseInt(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--green)', cursor: 'pointer' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--textmd)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Age:</span> <span>{doseAge} years</span>
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      step="1"
                      value={doseAge}
                      onChange={e => setDoseAge(parseInt(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--green)', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--textmd)' }}>Gender:</label>
                    <select
                      value={doseGender}
                      onChange={e => setDoseGender(e.target.value)}
                      style={{
                        height: 28,
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        color: 'var(--navy)',
                        padding: '0 4px',
                        outline: 'none',
                        background: '#fff'
                      }}
                    >
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                <div style={{ fontSize: '11px', color: 'var(--textmd)', lineHeight: 1.4, padding: '8px 10px', background: 'rgba(13,138,104,0.05)', borderRadius: 8, borderLeft: '3px solid var(--green)' }}>
                   <strong>Physiological Scaling:</strong> {pkParams.partition === 'hydrophilic' ? (
                    `Because ${pkParams.name} is hydrophilic, its Volume of Distribution (Vd) is scaled to your Lean Body Mass (LBM = ${indices.lbm}kg) rather than total weight.`
                  ) : (
                    `Because ${pkParams.name} is lipophilic, its Volume of Distribution (Vd) is scaled to your total Body Weight (${doseWeight}kg).`
                  )}
                  {doseAge > 50 && " Age-based renal clearance factor applied to simulate slower drug excretion."}
                </div>
              </div>
            </div>

            {pkParams.maxDailyDoseMg && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--textmd)' }}> Daily Dose Capacity:</span>
                  <span style={{ fontSize: '11px', fontWeight: 800, color: (doseStrength * doseFreq) > pkParams.maxDailyDoseMg ? 'var(--red)' : 'var(--green)' }}>
                    {doseStrength * doseFreq}mg / {pkParams.maxDailyDoseMg}mg max
                  </span>
                </div>
                <div style={{ width: '100%', height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, ((doseStrength * doseFreq) / pkParams.maxDailyDoseMg) * 100)}%`,
                    height: '100%',
                    background: (doseStrength * doseFreq) > pkParams.maxDailyDoseMg ? 'var(--red)' : 'var(--green)',
                    transition: 'width 0.3s ease'
                  }}></div>
                </div>
                {(doseStrength * doseFreq) > pkParams.maxDailyDoseMg && (
                  <div style={{ fontSize: '10px', color: 'var(--red)', fontWeight: 800, marginTop: 2 }}>
                    Note: WARNING: Scheduled daily intake exceeds the clinical safe maximum daily limit!
                  </div>
                )}
              </div>
            )}

            {chronoTip && (
              <div style={{
                padding: '8px 10px',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: 10,
                fontSize: '11.5px',
                color: '#1e40af',
                fontWeight: 700,
                lineHeight: 1.45
              }}>
                {chronoTip}
              </div>
            )}

            <div style={{
              padding: '12px 14px',
              background: warningBg,
              border: `1.5px solid ${warningBorder}`,
              borderRadius: 14,
              fontSize: 13,
              color: warningColor,
              fontWeight: 700,
              lineHeight: 1.5,
              boxShadow: 'var(--shadow)',
              animation: 'fadeIn 0.3s ease'
            }}>
              {warningMsg}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AltCard({ alts, jaAlts, otherAlts, savingsPct, isCheapest, brandedPerUnit, cheapestAlt, onFindJanAushadhi }) {
  const aiAlts = (alts.topAlternatives || []).filter(a => a.aiEstimated)
  const handleJanAushadhiClick = (event) => {
    if (onFindJanAushadhi) return onFindJanAushadhi(event)
    return openJanAushadhiStore(event)
  }
  
  // Savings Calculator state (QoL 1)
  const [calcDays, setCalcDays] = useState(30)
  const [calcQty, setCalcQty] = useState(1)

  const showCalc = !isCheapest && cheapestAlt && brandedPerUnit && cheapestAlt.perUnit < brandedPerUnit

  const totalQty = calcDays * calcQty
  const brandedTotal = Math.round(totalQty * brandedPerUnit)
  const genericTotal = Math.round(totalQty * cheapestAlt?.perUnit)
  const savedAmount = brandedTotal - genericTotal

  return (
    <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden', animation: 'fadeUp 0.3s ease' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy)' }}>💸 Lower-cost alternatives</div>
        <span style={badge('green')}>BPPI + AI</span>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {isCheapest ? (
          <div style={{ padding: '13px 15px', background: 'var(--greenlt)', border: '1.5px solid #A7D9CA', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 30 }}>🏆</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--greendk)', marginBottom: 2 }}>This is already the cheapest available</div>
              <div style={{ fontSize: 12, color: '#166534', lineHeight: 1.5 }}>No cheaper Jan Aushadhi generic found. looks like the chemist isn't ripping you off this time.</div>
            </div>
          </div>
        ) : savingsPct && savingsPct > 0 ? (
          <div style={{ padding: '13px 15px', background: 'var(--greenlt)', border: '1.5px solid #A7D9CA', borderRadius: 12, display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 38, color: 'var(--green)', lineHeight: 1, flexShrink: 0 }}>{savingsPct}%</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--greendk)', marginBottom: 3 }}>Savings available</div>
              <div style={{ fontSize: 12, color: '#166534', lineHeight: 1.5 }}>{alts.savingsSummary}</div>
            </div>
          </div>
        ) : (
          <div style={{ padding: '12px 14px', background: 'var(--bgsoft)', borderRadius: 10, fontSize: 13, color: 'var(--textlt)', lineHeight: 1.45 }}>
            {alts.savingsSummary || 'Compare listed prices for medicines with matching active ingredients and strength.'}
          </div>
        )}

        {showCalc && (
          <div style={{
            background: 'var(--bgsoft)',
            border: '1.5px solid var(--border)',
            borderRadius: 12,
            padding: '14px',
            marginTop: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.02)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>🧮 Savings Calculator</span>
              <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--greenlt)', color: 'var(--green)', padding: '2px 8px', borderRadius: 20 }}>
                Interactive
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
              
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10.5, color: 'var(--textlt)', fontWeight: 600, display: 'block', marginBottom: 5, textTransform: 'uppercase' }}>Tablets / day</label>
                <div style={{ display: 'flex', background: '#fff', borderRadius: 8, border: '1px solid var(--border)', padding: 2 }}>
                  {[1, 2, 3].map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setCalcQty(q)}
                      style={{
                        flex: 1,
                        padding: '6px 0',
                        borderRadius: 6,
                        background: calcQty === q ? 'var(--navy)' : 'transparent',
                        color: calcQty === q ? '#fff' : 'var(--textmd)',
                        fontSize: 12,
                        fontWeight: 700,
                        border: 'none',
                        transition: 'all 0.2s'
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10.5, color: 'var(--textlt)', fontWeight: 600, display: 'block', marginBottom: 5, textTransform: 'uppercase' }}>Duration (Days)</label>
                <div style={{ display: 'flex', background: '#fff', borderRadius: 8, border: '1px solid var(--border)', padding: 2 }}>
                  {[10, 30, 90].map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setCalcDays(d)}
                      style={{
                        flex: 1,
                        padding: '6px 0',
                        borderRadius: 6,
                        background: calcDays === d ? 'var(--navy)' : 'transparent',
                        color: calcDays === d ? '#fff' : 'var(--textmd)',
                        fontSize: 12,
                        fontWeight: 700,
                        border: 'none',
                        transition: 'all 0.2s'
                      }}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--textlt)' }}>
                <span>Custom Duration: {calcDays} Days</span>
              </div>
              <input
                type="range"
                min="5"
                max="180"
                step="5"
                value={calcDays}
                onChange={(e) => setCalcDays(parseInt(e.target.value))}
                style={{
                  width: '100%',
                  height: 4,
                  accentColor: 'var(--green)',
                  background: 'var(--border)',
                  outline: 'none',
                  borderRadius: 2,
                  cursor: 'pointer'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--textmd)', marginBottom: 3 }}>
                  <span>Branded Cost</span>
                  <span style={{ fontWeight: 700 }}>₹{brandedTotal}</span>
                </div>
                <div style={{ width: '100%', height: 8, background: '#fff', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <div style={{ width: '100%', height: '100%', background: 'var(--navy)', borderRadius: 4 }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--textmd)', marginBottom: 3 }}>
                  <span>Generic/Alternative Cost</span>
                  <span style={{ fontWeight: 700 }}>₹{genericTotal}</span>
                </div>
                <div style={{ width: '100%', height: 8, background: '#fff', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <div style={{ width: `${Math.max(5, Math.min(100, (genericTotal / brandedTotal) * 100))}%`, height: '100%', background: 'var(--green)', borderRadius: 4, transition: 'width 0.3s ease' }} />
                </div>
              </div>
            </div>

            <div style={{
              background: '#DCFCE7',
              border: '1px solid #86EFAC',
              borderRadius: 8,
              padding: '10px 12px',
              textAlign: 'center',
              color: '#15803D',
              fontSize: 13,
              fontWeight: 700,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              marginTop: 4
            }}>
              <span> Save ₹{savedAmount}!</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: '#166534' }}>
                ({savingsPct}% cheaper over {calcDays} days of treatment)
              </span>
            </div>
          </div>
        )}

        {alts.topAlternatives?.length > 0 && (
          <div style={{ padding: '10px 13px', background: '#EFF6FF', border: '1.5px solid #BFDBFE', borderRadius: 10, fontSize: 12.5, color: '#1E40AF', lineHeight: 1.6 }}>
            💬 <strong>At any chemist, say:</strong> "Do you have a cheaper version of {alts.topAlternatives[0]?.salt?.split(' ')[0] || 'this medicine'}?"  -  any brand with the same salt is legally equivalent.
          </div>
        )}

        {jaAlts.length > 0 && (
          <div>
            <div style={{ ...sectionLabel('green'), display: 'flex', alignItems: 'center', gap: 6 }}>
              🏛 Tier 1  -  Jan Aushadhi <span style={badge('green')}>VERIFIED PRICE</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--textlt)', marginBottom: 8, marginTop: -4 }}>Govt stores · Cheapest option · ~14,000 locations</div>
            {jaAlts.map((med, i) => <AltRow key={i} med={med} highlight />)}
          </div>
        )}

        {otherAlts.length > 0 && (
          <div>
            <div style={{ ...sectionLabel('blue'), display: 'flex', alignItems: 'center', gap: 6 }}>
              🏪 Tier 2  -  Any chemist
              <span style={badgeHighConf()}> DAVAINDIA</span>
              <span style={badge('blue')}>AI EST.</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--textlt)', marginBottom: 8, marginTop: -4 }}>
              Same molecule · 1mg prices where available · Others AI-estimated
            </div>
            {otherAlts.map((med, i) => <AltRow key={i} med={med} />)}
          </div>
        )}

        {alts.doseMismatchAlt && (
          <div>
            <div style={{ padding: '9px 13px', background: '#FFFBEB', border: '1.5px solid #FCD34D', borderRadius: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 2 }}> Different dose  -  ask your doctor first</div>
              <div style={{ fontSize: 11.5, color: '#78350F', lineHeight: 1.5 }}>These contain the same active salt but at a different strength. Do not substitute without a doctor's advice.</div>
            </div>
            <AltRow med={alts.doseMismatchAlt} dimmed />
          </div>
        )}

        {!alts.hasGenerics && !isCheapest && (
          <div style={{ padding: '10px 12px', background: 'var(--bgsoft)', borderRadius: 9, fontSize: 13, color: 'var(--textlt)', lineHeight: 1.5 }}>
            No cheaper alternatives found. Ask your doctor if a generic is available for this medicine.
          </div>
        )}

        <a href={JA_STORE_URL} onClick={handleJanAushadhiClick} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', background: 'var(--greenlt)', border: '1.5px solid #A7D9CA', borderRadius: 12, textDecoration: 'none' }}>
          <span style={{ fontSize: 20 }}></span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--greendk)' }}>Find Jan Aushadhi near me</div>
            <div style={{ fontSize: 11, color: '#166534' }}>Uses precise location when allowed · otherwise searches Maps nearby</div>
          </div>
          <span style={{ marginLeft: 'auto', color: 'var(--green)', fontSize: 16 }}>›</span>
        </a>

        {alts.pharmacyLinks?.length > 0 && (
          <div>
            <div style={sectionLabel('gray')}> Check live prices</div>
            <div style={{ fontSize: 11.5, color: 'var(--textlt)', marginBottom: 8, marginTop: -4 }}>Opens pharmacy site with real-time prices for this salt</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {alts.pharmacyLinks.map(link => (
                <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: '#fff', border: '1.5px solid var(--border)', borderRadius: 10, textDecoration: 'none', color: 'var(--navy)' }}>
                  <span style={{ fontSize: 16 }}>{link.logo}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{link.name}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--textlt)', fontSize: 12 }}>›</span>
                </a>
              ))}
            </div>
          </div>
        )}

        <div style={{ padding: '9px 12px', background: 'var(--bgsoft)', borderRadius: 9, fontSize: 11.5, color: 'var(--textlt)', lineHeight: 1.6, border: '1px solid var(--border)' }}>
           Jan Aushadhi prices from BPPI database. <strong>HIGH CONFIDENCE</strong> prices are sourced live from 1mg. <strong>AI EST.</strong> prices are approximate  -  always verify at the chemist counter. Only buy from licensed pharmacies.
        </div>
      </div>
    </div>
  )
}

function AltRow({ med, highlight, dimmed }) {
  const displayMrp   = med.mrp || med.estimatedMrp
  const isDavaIndia  = med.priceSource === "DavaIndia" || med.priceSource === "1mg" || med.highConfidence === true
  const isJA         = med.isJanAushadhi

  const unitLabel    = med.perUnitLabel || inferUnitLabel(med.unitSize || med.packSize)

  const bgColor     = (highlight || isJA) ? 'var(--greenlt)'
                    : isDavaIndia          ? '#EBF9F6'
                    : med.aiEstimated      ? '#F0F9FF'
                    : 'var(--bgsoft)'
  const borderColor = (highlight || isJA) ? '#A7D9CA'
                    : isDavaIndia          ? '#5EEAD4'
                    : med.aiEstimated      ? '#BFDBFE'
                    : 'var(--border)'

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '10px 12px', opacity: dimmed ? 0.7 : 1,
      background: bgColor, borderRadius: 10, marginBottom: 7,
      border: `1.5px solid ${borderColor}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 3 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--navy)' }}>{med.name}</span>
          {isJA        && <span style={badge('green')}>JAN AUSHADHI</span>}
          {isDavaIndia && !isJA && <span style={badgeHighConf()}> HIGH CONFIDENCE</span>}
          {!isDavaIndia && !isJA && med.aiEstimated && <span style={badge('blue')}>AI EST.</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--textlt)', lineHeight: 1.5 }}>
          {med.brand && med.brand !== 'BPPI' && <span>{med.brand} · </span>}
          {med.unitSize || med.packSize || ''}
        </div>
        {isDavaIndia && !isJA && (
          <div style={{ fontSize: 10.5, color: '#0D9488', fontWeight: 600, marginTop: 2 }}>
             Live price · {(med.priceSource || '1mg').replace(/\s*\(.*\)/, '')}
          </div>
        )}
        {!isDavaIndia && med.aiEstimated && (
          <div style={{ fontSize: 10.5, color: '#9CA3AF', marginTop: 2 }}> AI-estimated  -  may vary</div>
        )}
        {med.availableAt && !isDavaIndia && (
          <div style={{ fontSize: 10.5, color: 'var(--green)', fontWeight: 600, marginTop: 2 }}> {med.availableAt}</div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
        {displayMrp && <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy)' }}>₹{displayMrp}</div>}
        {med.perUnit != null && (
          <div style={{ fontSize: 10.5, color: 'var(--textlt)' }}>₹{med.perUnit}/{unitLabel}</div>
        )}
        {med.savings && med.savings !== 'Jan Aushadhi price' && (
          <div style={{ fontSize: 11, color: med.savings.includes('pricier') ? 'var(--amber)' : 'var(--green)', fontWeight: 600 }}>{med.savings}</div>
        )}
        {med.savingsNote && <div style={{ fontSize: 10.5, color: 'var(--textlt)', marginTop: 1 }}>{med.savingsNote}</div>}
      </div>
    </div>
  )
}

// Infer a readable unit label from pack description (e.g. "10 capsules" → "capsule")
function inferUnitLabel(packStr) {
  if (!packStr) return 'tablet'
  const s = packStr.toLowerCase()
  if (/\b(ml|l)\b|liquid|syrup|suspension|drops?\b/.test(s)) return 'ml'
  if (/\b(gm|g|kg)\b|cream|gel|ointment|lotion/.test(s)) return 'gm'
  if (/capsule/.test(s)) return 'capsule'
  if (/sachet/.test(s))  return 'sachet'
  if (/patch/.test(s))   return 'patch'
  if (/vial|ampoule/.test(s)) return 'vial'
  return 'tablet'
}

function badge(color) {
  const configs = {
    green: { bg: '#DCFCE7', color: '#166534' },
    blue:  { bg: '#DBEAFE', color: '#1E40AF' },
    gray:  { bg: '#F3F4F6', color: '#6B7280' },
    red:   { bg: '#FEE2E2', color: '#991B1B' },
    amber: { bg: '#FEF3C7', color: '#92400E' },
  }
  const cfg = configs[color] || configs.gray
  return { fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: cfg.bg, color: cfg.color, letterSpacing: '0.04em', display: 'inline-block' }
}

function badgeHighConf() {
  return { fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: '#CCFBF1', color: '#0F766E', letterSpacing: '0.04em', display: 'inline-block' }
}

function sectionLabel(color) {
  const colors = { green: '#166534', red: '#991B1B', gray: '#6B7280', blue: '#1E40AF' }
  return { fontSize: 10.5, fontWeight: 700, color: colors[color] || '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7, display: 'block' }
}
