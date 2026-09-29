import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';

export default function HealthCard({ profile, onSaveProfile }) {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    bloodGroup: '',
    allergies: '',
    chronicConditions: '',
    emergencyName: '',
    emergencyPhone: '',
    weight: 70,
    height: 170,
    age: 30,
    gender: 'male'
  });
  const [qrUrl, setQrUrl] = useState('');
  const [showQrModal, setShowQrModal] = useState(false);

  useEffect(() => {
    if (profile) {
      setFormData({
        name: profile.name || '',
        bloodGroup: profile.bloodGroup || '',
        allergies: profile.allergies || '',
        chronicConditions: profile.chronicConditions || '',
        emergencyName: profile.emergencyName || '',
        emergencyPhone: profile.emergencyPhone || '',
        weight: profile.weight || 70,
        height: profile.height || 170,
        age: profile.age || 30,
        gender: profile.gender || 'male'
      });
    }
  }, [profile]);

  useEffect(() => {

    const qrPayload = `--- MEDILENS EMERGENCY MEDICAL ID ---
Patient: ${formData.name || 'Not Specified'}
Age: ${formData.age || '30'} | Gender: ${formData.gender || 'male'}
Weight: ${formData.weight || '70'} kg | Height: ${formData.height || '170'} cm
Blood Group: ${formData.bloodGroup || 'N/A'}
Allergies: ${formData.allergies || 'None Logged'}
Chronic Conditions: ${formData.chronicConditions || 'None Logged'}
Emergency Contact: ${formData.emergencyName || 'Not Set'} ${formData.emergencyPhone ? `(${formData.emergencyPhone})` : ''}
---------------------------------
Zero-Knowledge Offline Medical Pass`;

    QRCode.toDataURL(
      qrPayload,
      {
        errorCorrectionLevel: 'H',
        margin: 4,
        width: 300,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      },
      (err, url) => {
        if (!err) {
          setQrUrl(url);
        } else {
          console.error("QR Code generation error:", err);
        }
      }
    );
  }, [formData]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'weight' || name === 'height' || name === 'age' ? (parseFloat(value) || '') : value
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSaveProfile) {
      onSaveProfile(formData);
    }
    setIsEditing(false);
  };

  return (
    <div className="health-card-container">
      <div className="health-card-header">
        <h3> Digital Emergency Health Card</h3>
        <p className="card-subtitle">offline card designed to be scanned on the first try by older, dust-covered barcode scanners in government hospitals. i stored this whole card in your local browser storage. no databases, no server logs, absolutely zero cloud tracking.</p>
      </div>

      <div className="health-card-body" style={{ animation: 'fadeUp 0.4s ease' }}>
        {!isEditing ? (
          <div>
            <div className="emergency-wallet-card">
              <div className="wallet-card-overlay"></div>
              <div className="wallet-header">
                <span className="wallet-logo">
                  <span className="wallet-logo-icon"></span>
                  MEDICAL EMERGENCY CARD
                </span>
                <span className="wallet-type">OFFLINE VAULT</span>
              </div>

              <div className="wallet-body" style={{ gap: '12px' }}>
                <div className="wallet-info-side">
                  <div className="wallet-field">
                    <span className="wallet-label">PATIENT NAME</span>
                    <span className="wallet-value highlight">{formData.name || 'NOT SET'}</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '2px' }}>
                    <div className="wallet-field">
                      <span className="wallet-label">AGE / GENDER</span>
                      <span className="wallet-value" style={{ fontSize: '11px', fontWeight: 800 }}>
                        {formData.age || '30'}y / {(formData.gender || 'male').substring(0, 1).toUpperCase()}
                      </span>
                    </div>
                    <div className="wallet-field">
                      <span className="wallet-label">WEIGHT</span>
                      <span className="wallet-value" style={{ fontSize: '11px', fontWeight: 800 }}>{formData.weight || '70'} kg</span>
                    </div>
                    <div className="wallet-field">
                      <span className="wallet-label">HEIGHT</span>
                      <span className="wallet-value" style={{ fontSize: '11px', fontWeight: 800 }}>{formData.height || '170'} cm</span>
                    </div>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '2px' }}>
                    <div className="wallet-field">
                      <span className="wallet-label">BLOOD TYPE</span>
                      <div>
                        <span className="wallet-blood-badge">{formData.bloodGroup || 'N/A'}</span>
                      </div>
                    </div>
                    <div className="wallet-field">
                      <span className="wallet-label">ALLERGIES</span>
                      <div>
                        <span className="wallet-allergies-badge" style={{ backgroundColor: formData.allergies ? '#E11D48' : '#64748B' }}>
                          {formData.allergies || 'None Logged'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="wallet-field">
                    <span className="wallet-label">CHRONIC CONDITIONS</span>
                    <span className="wallet-value" style={{ fontSize: '11.5px', lineHeight: 1.2 }}>{formData.chronicConditions || 'None Logged'}</span>
                  </div>
                </div>

                <div className="wallet-qr-side">
                  {qrUrl ? (
                    <div className="wallet-qr-box" onClick={() => setShowQrModal(true)}>
                      <img src={qrUrl} alt="Emergency QR Code" className="wallet-qr-img" />
                    </div>
                  ) : (
                    <div style={{ fontSize: '10px', color: '#94a3b8' }}>Generating QR...</div>
                  )}
                  <span className="wallet-qr-caption"> Tap to expand</span>
                </div>
              </div>

              <div className="wallet-footer">
                <div className="wallet-field">
                  <span className="wallet-label">EMERGENCY CONTACT</span>
                  <span className="wallet-contact-name">{formData.emergencyName || 'NOT SET'}</span>
                </div>
                {formData.emergencyPhone && (
                  <div className="wallet-field" style={{ alignItems: 'flex-end' }}>
                    <span className="wallet-label">CALL PHONE</span>
                    <span className="wallet-contact-phone">{formData.emergencyPhone}</span>
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '14px' }}>
              <button className="btn-secondary" onClick={() => setIsEditing(true)}>
                 Edit Emergency Card
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="health-card-form glass-card">
            <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--navy)', marginBottom: '4px' }}>
               Edit Emergency Profile Card
            </div>
            <p style={{ fontSize: '12px', color: 'var(--textlt)', marginBottom: '10px', lineHeight: 1.5 }}>
              i stored this whole card in your local browser storage. no databases, no server logs, absolutely zero cloud tracking. if you lose this device or clear your browser cache, this card is gone forever. so don't do stupid stuff. (when you save this card, it encodes it as a high-error-correction offline QR code designed to be ugly so that older, dust-covered barcode scanners in government hospitals can read it instantly).
            </p>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="card-name">👤 Full Name</label>
                <input
                  id="card-name"
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="Your name"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="card-blood">🩸 Blood Group</label>
                <select
                  id="card-blood"
                  name="bloodGroup"
                  value={formData.bloodGroup}
                  onChange={handleInputChange}
                >
                  <option value="">Select blood group...</option>
                  <option value="A+">A+</option>
                  <option value="A-">A-</option>
                  <option value="B+">B+</option>
                  <option value="B-">B-</option>
                  <option value="AB+">AB+</option>
                  <option value="AB-">AB-</option>
                  <option value="O+">O+</option>
                  <option value="O-">O-</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="card-age"> Age (years)</label>
                <input
                  id="card-age"
                  type="number"
                  name="age"
                  value={formData.age}
                  onChange={handleInputChange}
                  placeholder="e.g. 30"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="card-gender">⚧ Gender</label>
                <select
                  id="card-gender"
                  name="gender"
                  value={formData.gender}
                  onChange={handleInputChange}
                  required
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="card-weight">⚖️ Weight (kg)</label>
                <input
                  id="card-weight"
                  type="number"
                  name="weight"
                  value={formData.weight}
                  onChange={handleInputChange}
                  placeholder="e.g. 70"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="card-height">📏 Height (cm)</label>
                <input
                  id="card-height"
                  type="number"
                  name="height"
                  value={formData.height}
                  onChange={handleInputChange}
                  placeholder="e.g. 170"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="card-allergies">️ Allergies (medications or foods)</label>
                <input
                  id="card-allergies"
                  type="text"
                  name="allergies"
                  value={formData.allergies}
                  onChange={handleInputChange}
                  placeholder="e.g. Penicillin, Peanuts"
                />
              </div>

              <div className="form-group">
                <label htmlFor="card-chronic"> Chronic Conditions</label>
                <input
                  id="card-chronic"
                  type="text"
                  name="chronicConditions"
                  value={formData.chronicConditions}
                  onChange={handleInputChange}
                  placeholder="e.g. Asthma, Diabetes"
                />
              </div>

              <div className="form-group">
                <label htmlFor="card-em-name">📞 Emergency Contact Name</label>
                <input
                  id="card-em-name"
                  type="text"
                  name="emergencyName"
                  value={formData.emergencyName}
                  onChange={handleInputChange}
                  placeholder="e.g. Spouse/Parent Name"
                />
              </div>

              <div className="form-group">
                <label htmlFor="card-em-phone">📱 Emergency Phone</label>
                <input
                  id="card-em-phone"
                  type="tel"
                  name="emergencyPhone"
                  value={formData.emergencyPhone}
                  onChange={handleInputChange}
                  placeholder="e.g. +91 98765 43210"
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn-primary">💾 Save Card</button>
              <button type="button" className="btn-tertiary" onClick={() => setIsEditing(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      {showQrModal && (
        <div className="modal-overlay" onClick={() => setShowQrModal(false)}>
          <div className="modal-content qr-large-modal" onClick={e => e.stopPropagation()}>
            <h4 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--navy)', marginBottom: '8px' }}>
               Emergency Responder QR Card
            </h4>
            <p style={{ fontSize: '12px', color: 'var(--textlt)', marginBottom: '16px' }}>
              First responders can scan this to read your critical medical profiles offline.
            </p>
            <div className="large-qr-wrapper" style={{ 
              boxShadow: 'var(--shadowmd)',
              background: '#ffffff',
              padding: '16px',
              borderRadius: '16px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              margin: '0 auto 16px',
              width: '260px',
              height: '260px'
            }}>
              <img 
                src={qrUrl} 
                alt="Emergency QR Code" 
                style={{ 
                  display: 'block', 
                  width: '100%', 
                  height: '100%', 
                  objectFit: 'contain',
                  imageRendering: 'pixelated'
                }} 
              />
            </div>
            <div className="qr-card-data-summary" style={{ boxShadow: 'var(--shadow)' }}>
              <p><strong>👤 Name:</strong> {formData.name || 'N/A'}</p>
              <p><strong> Age / Gender:</strong> {formData.age || '30'} years / {formData.gender || 'male'}</p>
              <p><strong>⚖️ Weight / Height:</strong> {formData.weight || '70'} kg / {formData.height || '170'} cm</p>
              <p><strong>🩸 Blood Group:</strong> {formData.bloodGroup || 'N/A'}</p>
              <p><strong>️ Allergies:</strong> {formData.allergies || 'None logged'}</p>
              <p><strong> Conditions:</strong> {formData.chronicConditions || 'None logged'}</p>
              <p><strong>📞 Emergency Contact:</strong> {formData.emergencyName} ({formData.emergencyPhone})</p>
            </div>
            <button className="btn-primary" style={{ width: '100%' }} onClick={() => setShowQrModal(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
