import React, { useState, useRef, useCallback } from 'react'
import { scanMedicine, scanPrescription, compressAndEncode, lookupMedicineNameOnly } from '../services/geminiService.js'
import { readBarcode } from '../services/barcodeService.js'
import ResultsPanel, { BloodstreamSimulator } from '../components/ResultsPanel.jsx'
import PrescriptionResultsPanel from '../components/PrescriptionResultsPanel.jsx'
import HamMenu from '../components/HamMenu.jsx'
import HealthCard from '../components/HealthCard.jsx'
import { useLang, useSetPage } from '../App.jsx'
import { useT } from '../i18n/translations.js'

import { processImageWasm } from '../services/wasmService.js'
import { encryptData, decryptData } from '../services/cryptoService.js'
import ARScanner from '../components/ARScanner.jsx'
import { checkInteractions, checkTherapeuticDuplication, orchestrateMedicationSchedule, flagPotentialSideEffects } from '../services/interactionService.js'
import { getSecureLogs, saveSecureLogs, cacheCSVDatabase, getCachedCSVDatabase, saveEncryptedProfile, getEncryptedProfile, listProfileIds, deleteProfile as dbDeleteProfile } from '../services/dbServiceIndexedDB.js'
import { startReminderLoop, stopReminderLoop } from '../services/notificationService.js'
import SearchWorker from '../wasm/search.worker.js?worker'
import { getPKParameters, simulatePharmacokinetics, checkDosageSafety } from '../services/pharmacokineticsService.js'
import InteractionGraphVisualizer from '../components/InteractionGraphVisualizer.jsx'
import { parseSalts, matchQuality } from '../services/dbService.js'
import { extractLocalLabelDetails, hasCatalogIngredientMatch, hasVerifiedMedicineEvidence, isExpiryMonthExpired, resolveKnownMedicineBrand, selectBestMedicineOcrText } from '../services/localMedicineLabel.js'
import { JA_STORE_URL, openJanAushadhiStore } from '../services/storeLocator.js'

const VIEWS = { HOME: 'home', LOADING: 'loading', RESULTS: 'results', ERROR: 'error', AR: 'ar' }

const loadTesseract = async () => {
  if (window.Tesseract) return window.Tesseract;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error('Tesseract script loaded, but Tesseract is not defined.'));
    };
    script.onerror = () => reject(new Error('Failed to load Tesseract.js from CDN.'));
    document.head.appendChild(script);
  });
};

let tesseractWorkerPromise = null;

const getTesseractWorker = async () => {
  if (tesseractWorkerPromise) return tesseractWorkerPromise;
  tesseractWorkerPromise = (async () => {
    try {
      const Tesseract = await loadTesseract();
      const workerPromise = Tesseract.createWorker('eng');
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("OCR engine initialization timed out after 20 seconds.")), 20000)
      });
      try {
        return await Promise.race([workerPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      tesseractWorkerPromise = null;
      throw err;
    }
  })();
  return tesseractWorkerPromise;
};

const NOISE_WORDS = new Set([
  'tablets', 'capsules', 'capsule', 'tablet', 'mg', 'mcg', 'ml', 'g', 'b.no', 'batch', 'expiry', 
  'exp', 'mfg', 'mrp', 'manufacturing', 'date', 'rs', 'price', 'rx', 'only', 'composition', 
  'directions', 'dosage', 'warnings', 'keep', 'reach', 'children', 'store', 'cool', 'dry', 
  'place', 'manufactured', 'by', 'marketed', 'india', 'ltd', 'limited', 'pvt', 'pharmaceuticals', 
  'pharma', 'laboratories', 'labs', 'co', 'incorporated', 'inc', 'warning', 'prescriptions', 
  'schedule', 'drug', 'caution', 'licensed', 'user', 'under', 'patent', 'ip', 'bp', 'usp',
  'contains', 'each', 'film', 'coated', 'colour', 'titanium', 'dioxide'
]);

function extractCandidateQueries(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const candidates = [];
  for (let line of lines) {
    // Replace non-alphanumeric (except space) with space
    let cleaned = line.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

    let tokens = cleaned.split(/\s+/).map(t => t.trim()).filter(Boolean);

    let filteredTokens = tokens.filter(token => {

      if (/^\d+$/.test(token)) return false;

      if (NOISE_WORDS.has(token)) return false;

      return token.length >= 3;
    });
    
    if (filteredTokens.length > 0) {
      candidates.push(filteredTokens.join(' '));
    }
  }
  return [...new Set(candidates)];
}

const LOCAL_DRUG_TEMPLATES = {
  paracetamol: {
    whatItDoes: "A widely used pain reliever (analgesic) and fever reducer (antipyretic). It helps alleviate mild to moderate pain.",
    commonUses: ["Fever reduction", "Mild to moderate pain relief", "Headache", "Muscle ache"],
    prescriptionRequired: false,
    sideEffects: ["Nausea", "Allergic reactions (rare)", "Liver damage (in high doses)"],
    importantWarnings: ["Do not exceed 4000mg per day to avoid liver toxicity", "Avoid alcohol while taking this medication", "Check other cold/flu meds for paracetamol content"]
  },
  atorvastatin: {
    whatItDoes: "A statin medication used to prevent cardiovascular disease and lower lipid levels (cholesterol). It works by reducing cholesterol production in the liver.",
    commonUses: ["Hypercholesterolemia (high cholesterol)", "Prevention of cardiovascular disease", "Lowering LDL cholesterol"],
    prescriptionRequired: true,
    sideEffects: ["Muscle aches (myalgia)", "Headache", "Nausea", "Elevated liver enzymes"],
    importantWarnings: ["Report unexplained muscle pain immediately", "Avoid grapefruit juice during treatment", "Not safe during pregnancy"]
  },
  metformin: {
    whatItDoes: "An oral diabetes medicine that helps control blood sugar levels for people with type 2 diabetes. It improves insulin sensitivity and reduces glucose production by the liver.",
    commonUses: ["Type 2 Diabetes Mellitus", "Insulin resistance", "Polycystic Ovary Syndrome (PCOS)"],
    prescriptionRequired: true,
    sideEffects: ["Gastrointestinal upset (diarrhea, nausea)", "Metallic taste", "Vitamin B12 deficiency"],
    importantWarnings: ["Take with meals to minimize stomach upset", "Risk of lactic acidosis (rare but serious)", "Inform doctor before contrast dye scans"]
  },
  pantoprazole: {
    whatItDoes: "A proton pump inhibitor (PPI) that decreases the amount of acid produced in the stomach, allowing the esophagus and stomach lining to heal.",
    commonUses: ["Gastroesophageal Reflux Disease (GERD)", "Acid reflux relief", "Stomach ulcer healing", "Zollinger-Ellison syndrome"],
    prescriptionRequired: true,
    sideEffects: ["Headache", "Diarrhea", "Flatulence", "Joint pain"],
    importantWarnings: ["Typically taken 30-60 minutes before breakfast", "Long-term use may cause low magnesium levels", "May increase risk of bone fractures with prolonged use"]
  },
  ibuprofen: {
    whatItDoes: "A nonsteroidal anti-inflammatory drug (NSAID) that reduces hormones causing pain and inflammation in the body.",
    commonUses: ["Inflammation and swelling reduction", "Pain relief (dental, menstrual, joint)", "Fever reduction"],
    prescriptionRequired: false,
    sideEffects: ["Stomach upset/heartburn", "Increased blood pressure", "Dizziness", "Fluid retention"],
    importantWarnings: ["Take with food to protect stomach lining", "Avoid if you have active stomach ulcers", "May increase cardiovascular risk with long-term use"]
  },
  amoxicillin: {
    whatItDoes: "A penicillin-type antibiotic used to treat a wide variety of bacterial infections. It works by stopping the growth of bacteria.",
    commonUses: ["Bacterial infections", "Ear, nose, and throat infections", "Pneumonia", "Urinary tract infections (UTIs)"],
    prescriptionRequired: true,
    sideEffects: ["Nausea", "Diarrhea", "Skin rash", "Yeast infection"],
    importantWarnings: ["Complete the entire prescribed course even if symptoms disappear", "Does not treat viral infections like flu or common cold", "Seek emergency help if allergic reaction occurs"]
  },
  cetirizine: {
    whatItDoes: "An antihistamine that reduces the effects of natural chemical histamine in the body, relieving allergy symptoms.",
    commonUses: ["Seasonal allergy symptoms", "Hives/itching", "Runny nose/sneezing", "Watery eyes"],
    prescriptionRequired: false,
    sideEffects: ["Drowsiness", "Dry mouth", "Fatigue", "Headache"],
    importantWarnings: ["May cause drowsiness; avoid driving or operating machinery", "Avoid alcohol while taking this medication", "Consult doctor if symptoms do not improve in 3 days"]
  },
  amlodipine: {
    whatItDoes: "A calcium channel blocker that dilates (widens) blood vessels and improves blood flow, lowering blood pressure and reducing workload on the heart.",
    commonUses: ["Hypertension (high blood pressure)", "Angina (chest pain)", "Coronary artery disease"],
    prescriptionRequired: true,
    sideEffects: ["Swelling of ankles/feet (edema)", "Dizziness", "Flushing", "Palpitations"],
    importantWarnings: ["Rise slowly from sitting/lying positions to prevent dizziness", "Do not stop taking abruptly without consulting doctor", "Monitor blood pressure regularly"]
  },
  lisinopril: {
    whatItDoes: "An ACE inhibitor that relaxes blood vessels, lowering blood pressure and improving survival rates after heart attacks.",
    commonUses: ["Hypertension (high blood pressure)", "Heart failure management", "Post-heart attack recovery"],
    prescriptionRequired: true,
    sideEffects: ["Persistent dry cough", "Dizziness", "Headache", "Hyperkalemia (high potassium)"],
    importantWarnings: ["Risk of severe allergic reaction (angioedema - swelling of face/lips)", "Do not use if pregnant (fetal toxicity)", "Avoid potassium supplements unless advised by doctor"]
  },
  omeprazole: {
    whatItDoes: "A proton pump inhibitor (PPI) that suppresses gastric acid secretion by blocking the acid-producing pumps in the stomach.",
    commonUses: ["GERD/acid reflux", "Stomach and duodenal ulcers", "Erosive esophagitis"],
    prescriptionRequired: false,
    sideEffects: ["Nausea", "Diarrhea", "Headache", "Abdominal pain"],
    importantWarnings: ["Take in the morning before food", "Not intended for immediate heartburn relief", "Long-term use may affect B12 absorption"]
  }
};

const genericFallbackTemplate = {
  whatItDoes: "Used to treat symptoms under the guidance of a healthcare professional. Contains active ingredients to manage targeted physiological conditions.",
  commonUses: ["Symptomatic relief", "Maintenance therapy"],
  prescriptionRequired: true,
  sideEffects: ["Nausea", "Dizziness", "Headache"],
  importantWarnings: ["Follow your doctor's exact dosage instructions", "Do not share this medication with others", "Store in a cool, dry place out of reach of children"]
};

function getLocalMedicineInfo(saltName) {
  const norm = (saltName || '').toLowerCase();
  for (const key of Object.keys(LOCAL_DRUG_TEMPLATES)) {
    if (norm.includes(key)) {
      return LOCAL_DRUG_TEMPLATES[key];
    }
  }
  return genericFallbackTemplate;
}

export default function Scanner() {
  const { lang, setLang } = useLang()
  const t = useT(lang)
  const setPage = useSetPage()
  const [view, setView]           = useState(VIEWS.HOME)
  const [results, setResults]     = useState(null)
  const [error, setError]         = useState(null)
  const [preview, setPreview]     = useState(null)
  const [step, setStep]           = useState(0)
  const [barcodeHit, setBarcodeHit] = useState(false)
  const [hamOpen, setHamOpen]     = useState(false)
  const [scanMode, setScanMode]   = useState('medicine')
  const cameraRef = useRef(null)
  const uploadRef = useRef(null)

  const [wasmEnabled, setWasmEnabled] = useState(true)
  const [wasmFilter, setWasmFilter] = useState(1)
  const [processedPreview, setProcessedPreview] = useState(null)

  const [localOcrEnabled, setLocalOcrEnabled] = useState(true)

  const [useAsyncQueue, setUseAsyncQueue] = useState(true)
  const [activeStepId, setActiveStepId] = useState(null)
  const [completedStepIds, setCompletedStepIds] = useState([])

  const [bookmarks, setBookmarks] = useState([])
  const [isVaultLocked, setIsVaultLocked] = useState(false)
  const [vaultPin, setVaultPin] = useState('')
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [showPinSetup, setShowPinSetup] = useState(false)
  const [newPin, setNewPin] = useState('')

  const [profiles, setProfiles] = useState([])
  const [activeProfileId, setActiveProfileId] = useState('praveen')
  const [activeTab, setActiveTab] = useState('cabinet')
  const [symptomInput, setSymptomInput] = useState('')
  const [profileInput, setProfileInput] = useState('')
  const [showAddProfile, setShowAddProfile] = useState(false)

  const activeProfile = (profiles && activeProfileId && profiles.find(p => p && p.id === activeProfileId)) || profiles?.[0] || {
    id: 'praveen',
    name: 'Praveen Shivagonda',
    bloodGroup: '',
    allergies: '',
    chronicConditions: '',
    emergencyName: '',
    emergencyPhone: '',
    cabinet: [],
    adherence: {},
    symptoms: [],
    reminderTimes: { Morning: '08:00', Afternoon: '13:00', Evening: '18:00', Bedtime: '22:00' }
  };
  const cabinet = activeProfile?.cabinet || [];

  const [activeInteractions, setActiveInteractions] = useState([])
  const [activeDuplications, setActiveDuplications] = useState([])
  const [activeSchedule, setActiveSchedule] = useState({ schedule: { 'Morning': [], 'Afternoon': [], 'Evening': [], 'Bedtime': [] }, notes: [] })

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchWorker, setSearchWorker] = useState(null)
  const [searchStatus, setSearchStatus] = useState('Initializing search engine...')

  const [selectedCabinetIndex, setSelectedCabinetIndex] = useState(0)
  const cabinetSearchQueryRef = useRef('')
  const [cabinetSearchResults, setCabinetSearchResults] = useState(null)
  const [isCabinetSearching, setIsCabinetSearching] = useState(false)

  const cabinetAddQueryRef = useRef('')
  const [cabinetAddQuery, setCabinetAddQuery] = useState('')
  const [cabinetAddResults, setCabinetAddResults] = useState(null)
  const [isCabinetAddSearching, setIsCabinetAddSearching] = useState(false)

  const [showCabinet3D, setShowCabinet3D] = useState(true)
  const [showManualAddModal, setShowManualAddModal] = useState(false)
  const [manualAddForm, setManualAddForm] = useState({
    brandName: '',
    saltComposition: '',
    strength: 500,
    strengthUnit: 'mg',
    form: 'Tablet',
    pillCount: 30,
    mfgDate: '',
    expiryDate: '',
    batchNumber: '',
    idealTime: 'Morning',
    foodRelation: 'With or without food',
    frequency: 3
  })

  const selectedMed = cabinet[selectedCabinetIndex] || cabinet[0] || null
  const [cabDoseStrength, setCabDoseStrength] = useState(500)
  const [cabDoseFreq, setCabDoseFreq] = useState(3)
  const [cabScrubTime, setCabScrubTime] = useState(0)

  const handleCabinetSearch = useCallback((query) => {
    if (!query) {
      setCabinetSearchResults(null)
      setIsCabinetSearching(false)
      return
    }
    cabinetSearchQueryRef.current = query
    if (searchWorker) {
      setIsCabinetSearching(true)
      searchWorker.postMessage({
        type: 'search',
        data: { query }
      })
    }
  }, [searchWorker])

  const handleCabinetAddSearch = useCallback((query) => {
    setCabinetAddQuery(query)
    if (!query) {
      setCabinetAddResults(null)
      setIsCabinetAddSearching(false)
      return
    }
    cabinetAddQueryRef.current = query
    if (searchWorker) {
      setIsCabinetAddSearching(true)
      searchWorker.postMessage({
        type: 'search',
        data: { query }
      })
    }
  }, [searchWorker])

  React.useEffect(() => {
    if (selectedMed) {
      let parsedDose = 500;
      if (typeof selectedMed.strength === 'number') {
        parsedDose = selectedMed.strength;
      } else {
        const m = (selectedMed.saltComposition || '').match(/(\d+)\s*(mg|mcg|g)/i)
        parsedDose = m ? parseInt(m[1]) : 500;
      }
      
      let parsedFreq = 3;
      if (typeof selectedMed.frequency === 'number') {
        parsedFreq = selectedMed.frequency;
      }
      
      setCabDoseStrength(parsedDose)
      setCabDoseFreq(parsedFreq)
      setCabScrubTime(0)
      handleCabinetSearch(selectedMed.saltComposition || selectedMed.brandName)
    }
  }, [selectedCabinetIndex, selectedMed?.brandName, selectedMed?.saltComposition, selectedMed?.strength, selectedMed?.frequency, handleCabinetSearch])

  React.useEffect(() => {
    let active = true;
    let worker = null;

    getTesseractWorker().catch(err => {
      console.warn("Tesseract pre-warm failed (will retry on scan):", err);
    });

    async function initSearch() {
      try {
        setSearchStatus('Loading drug databases...');
        let cdscoText = await getCachedCSVDatabase('cdsco');
        let jaText = await getCachedCSVDatabase('jan_aushadhi');

        if (!cdscoText || !jaText) {
          setSearchStatus('Downloading database indexes for offline search...');
          const [cdscoRes, jaRes] = await Promise.all([
            fetch('/data/cdsco.csv'),
            fetch('/data/jan_aushadhi.csv')
          ]);
          if (!cdscoRes.ok || !jaRes.ok) throw new Error('Failed to fetch static CSV records from host.');
          
          cdscoText = await cdscoRes.text();
          jaText = await jaRes.text();

          await cacheCSVDatabase('cdsco', cdscoText);
          await cacheCSVDatabase('jan_aushadhi', jaText);
        }

        if (!active) return;
        setSearchStatus('Initializing search thread worker...');
        
        worker = new SearchWorker();
        worker.onmessage = (e) => {
          if (!active) return;
          const { type, query: respQuery, cdsco, ja, success, error } = e.data;
          if (type === 'initialized') {
            if (success) {
              setSearchWorker(worker);
              setSearchStatus('Offline search ready.');
            } else {
              setSearchStatus(`Failed to initialize search: ${error}`);
            }
          } else if (type === 'results') {
            if (respQuery && respQuery === cabinetAddQueryRef.current) {
              setCabinetAddResults({ cdsco, ja });
              setIsCabinetAddSearching(false);
            } else if (respQuery && respQuery === cabinetSearchQueryRef.current) {
              setCabinetSearchResults({ cdsco, ja });
              setIsCabinetSearching(false);
            } else {
              setSearchResults({ cdsco, ja });
              setIsSearching(false);
            }
          } else if (type === 'error') {
            console.error('Search worker error:', error);
            setIsSearching(false);
            setIsCabinetSearching(false);
            setIsCabinetAddSearching(false);
          }
        };

        worker.postMessage({
          type: 'init',
          data: { cdscoText, jaText }
        });
      } catch (err) {
        console.error('Failed to setup search worker:', err);
        setSearchStatus('Search unavailable: offline database load failed.');
      }
    }

    initSearch();

    return () => {
      active = false;
      if (worker) worker.terminate();
    };
  }, []);

  const handleSearchChange = (query) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }
    if (searchWorker) {
      setIsSearching(true);
      searchWorker.postMessage({
        type: 'search',
        data: { query }
      });
    }
  };

  React.useEffect(() => {
    const cleanCabinet = (cabinet || []).filter(Boolean)
    if (cleanCabinet.length >= 2) {
      const activeSalts = cleanCabinet.map(item => item.saltComposition || '')
      const collisions = checkInteractions(activeSalts)
      const dups = checkTherapeuticDuplication(activeSalts)
      setActiveInteractions(collisions)
      setActiveDuplications(dups)
    } else {
      setActiveInteractions([])
      setActiveDuplications([])
    }

    if (cleanCabinet.length > 0) {
      const sched = orchestrateMedicationSchedule(cleanCabinet)
      setActiveSchedule(sched)
    } else {
      setActiveSchedule({ schedule: { 'Morning': [], 'Afternoon': [], 'Evening': [], 'Bedtime': [] }, notes: [] })
    }
  }, [profiles, activeProfileId])

  // Save all profiles to IndexedDB (either encrypted or plain)
  const saveAllProfiles = async (updatedProfiles, pin = vaultPin) => {
    setProfiles(updatedProfiles)
    for (const prof of updatedProfiles) {
      const plainStr = JSON.stringify(prof)
      if (pin) {
        const cipher = await encryptData(plainStr, pin)
        await saveEncryptedProfile(prof.id, cipher)
      } else {
        await saveEncryptedProfile(prof.id, plainStr)
      }
    }
  }

  const loadAllData = async (pin = vaultPin) => {
    try {

      let savedStr = await getSecureLogs()
      if (!savedStr) {
        try { savedStr = localStorage.getItem('medilens_bookmarks'); } catch(e){}
        if (savedStr) {
          await saveSecureLogs(savedStr)
          localStorage.removeItem('medilens_bookmarks')
        } else {
          savedStr = '[]'
        }
      }
      
      let parsedBookmarks = []
      if (savedStr.includes(':') && savedStr.split(':').length === 3) {
        if (!pin) {
          setIsVaultLocked(true)
          return
        }
        const decrypted = await decryptData(savedStr, pin)
        parsedBookmarks = JSON.parse(decrypted)
      } else {
        parsedBookmarks = JSON.parse(savedStr)
      }
      parsedBookmarks.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      setBookmarks(parsedBookmarks)

      const keys = await listProfileIds()
      let loadedProfiles = []
      for (const k of keys) {
        try {
          const cipher = await getEncryptedProfile(k)
          if (cipher) {
            let plain
            if (cipher.includes(':') && cipher.split(':').length === 3) {
              if (!pin) {
                setIsVaultLocked(true)
                return
              }
              plain = await decryptData(cipher, pin)
            } else {
              plain = cipher
            }
            loadedProfiles.push(JSON.parse(plain))
          }
        } catch (errKey) {
          console.error("Skipping corrupted key:", k, errKey)
        }
      }
      
      if (loadedProfiles.length === 0) {
        const defaultProf = {
          id: 'praveen',
          name: 'Praveen Shivagonda',
          bloodGroup: 'O+',
          allergies: '',
          chronicConditions: '',
          emergencyName: '',
          emergencyPhone: '',
          cabinet: [],
          adherence: {},
          symptoms: [],
          reminderTimes: { Morning: '08:00', Afternoon: '13:00', Evening: '18:00', Bedtime: '22:00' }
        }
        const serialized = JSON.stringify(defaultProf)
        if (pin) {
          const cipher = await encryptData(serialized, pin)
          await saveEncryptedProfile('praveen', cipher)
        } else {
          await saveEncryptedProfile('praveen', serialized)
        }
        loadedProfiles = [defaultProf]
      }
      
      setProfiles(loadedProfiles)
      let activeId = loadedProfiles[0]?.id || 'praveen'; try { activeId = localStorage.getItem('medilens_active_profile_id') || activeId; } catch(e){}
      setActiveProfileId(activeId)
      setIsVaultLocked(false)
    } catch (e) {
      console.error("Failed to load secure vault data:", e)
    }
  }

  const toggleCabinetItem = useCallback(async (bookmark, e) => {
    if (e) e.stopPropagation()
    const updated = profiles.map(p => {
      if (p.id === activeProfileId) {
        const cab = p.cabinet || []
        const isAlreadyIn = cab.some(item => item.brandName === bookmark.brandName && item.saltComposition === bookmark.saltComposition)
        const nextCab = isAlreadyIn 
          ? cab.filter(item => !(item.brandName === bookmark.brandName && item.saltComposition === bookmark.saltComposition))
          : [...cab, { 
              brandName: bookmark.brandName, 
              saltComposition: bookmark.saltComposition, 
              pillCount: 30, 
              notificationsEnabled: true,
              meta: {
                idealTime: 'Morning',
                foodRelation: 'With or without food',
                rationale: 'Standard maintenance dosing.'
              }
            }]
        return { ...p, cabinet: nextCab }
      }
      return p
    })
    await saveAllProfiles(updated)
  }, [profiles, activeProfileId])

  const handleSaveHealthCard = async (formData) => {
    const updated = profiles.map(p => {
      if (p.id === activeProfileId) {
        return { ...p, ...formData }
      }
      return p
    })
    await saveAllProfiles(updated)
  }

  const handleLogSymptom = async (text) => {
    if (!text.trim()) return
    const updated = profiles.map(p => {
      if (p.id === activeProfileId) {
        const sym = p.symptoms || []
        return { 
          ...p, 
          symptoms: [...sym, { text: text.trim(), date: new Date().toLocaleDateString() }] 
        }
      }
      return p
    })
    await saveAllProfiles(updated)
    setSymptomInput('')
  }

  const handleDeleteSymptom = async (idx) => {
    const updated = profiles.map(p => {
      if (p.id === activeProfileId) {
        const sym = p.symptoms || []
        return { ...p, symptoms: sym.filter((_, i) => i !== idx) }
      }
      return p
    })
    await saveAllProfiles(updated)
  }

  const handleToggleNotification = async (med) => {
    const updated = profiles.map(p => {
      if (p.id === activeProfileId) {
        const nextCab = (p.cabinet || []).map(item => {
          if (item.brandName === med.brandName && item.saltComposition === med.saltComposition) {
            return { ...item, notificationsEnabled: !item.notificationsEnabled }
          }
          return item
        })
        return { ...p, cabinet: nextCab }
      }
      return p
    })
    await saveAllProfiles(updated)
  }

  const handleUpdatePillCount = async (med, diff) => {
    const updated = profiles.map(p => {
      if (p.id === activeProfileId) {
        const nextCab = (p.cabinet || []).map(item => {
          if (item.brandName === med.brandName && item.saltComposition === med.saltComposition) {
            const count = Math.max(0, (item.pillCount || 0) + diff)
            return { ...item, pillCount: count }
          }
          return item
        })
        return { ...p, cabinet: nextCab }
      }
      return p
    })
    await saveAllProfiles(updated)
  }

  // Update specific fields of a cabinet item (MFG, Expiry, Batch, etc.)
  const handleUpdateCabinetItem = async (med, fields) => {
    const updated = profiles.map(p => {
      if (p.id === activeProfileId) {
        const nextCab = (p.cabinet || []).map(item => {
          if (item.brandName === med.brandName && item.saltComposition === med.saltComposition) {
            return { ...item, ...fields }
          }
          return item
        })
        return { ...p, cabinet: nextCab }
      }
      return p
    })
    await saveAllProfiles(updated)
  }

  const handleUpdateReminderTime = async (slot, val) => {
    const updated = profiles.map(p => {
      if (p.id === activeProfileId) {
        const times = p.reminderTimes || { Morning: '08:00', Afternoon: '13:00', Evening: '18:00', Bedtime: '22:00' }
        return { ...p, reminderTimes: { ...times, [slot]: val } }
      }
      return p
    })
    await saveAllProfiles(updated)
  }

  const handleToggleAdherence = async (dateStr, slot) => {
    const updated = profiles.map(p => {
      if (p.id === activeProfileId) {
        const ad = p.adherence || {}
        const todayAd = ad[dateStr] || { Morning: false, Afternoon: false, Evening: false, Bedtime: false }
        const nextTodayAd = { ...todayAd, [slot]: !todayAd[slot] }
        return { ...p, adherence: { ...ad, [dateStr]: nextTodayAd } }
      }
      return p
    })
    await saveAllProfiles(updated)
  }

  const handleAddProfile = async (name) => {
    if (!name.trim()) return
    const cleanId = name.toLowerCase().trim().replace(/[^a-z0-9]/g, '_')
    if (profiles.some(p => p.id === cleanId)) return
    
    const newProf = {
      id: cleanId,
      name: name.trim(),
      bloodGroup: '',
      allergies: '',
      chronicConditions: '',
      emergencyName: '',
      emergencyPhone: '',
      cabinet: [],
      adherence: {},
      symptoms: [],
      reminderTimes: { Morning: '08:00', Afternoon: '13:00', Evening: '18:00', Bedtime: '22:00' }
    }
    const nextProfiles = [...profiles, newProf]
    await saveAllProfiles(nextProfiles)
    setActiveProfileId(cleanId)
    try { localStorage.setItem('medilens_active_profile_id', cleanId); } catch(e){}
    setProfileInput('')
    setShowAddProfile(false)
  }

  const handleDeleteProfile = async (profileId) => {
    if (profiles.length <= 1) return
    const updated = profiles.filter(p => p.id !== profileId)
    setProfiles(updated)
    await dbDeleteProfile(profileId)
    const nextId = updated[0].id
    setActiveProfileId(nextId)
    try { localStorage.setItem('medilens_active_profile_id', nextId); } catch(e){}
  }

  React.useEffect(() => {
    if (activeProfile && activeProfile.cabinet && activeProfile.cabinet.length > 0) {
      const times = activeProfile.reminderTimes || { Morning: '08:00', Afternoon: '13:00', Evening: '18:00', Bedtime: '22:00' }
      startReminderLoop(activeProfile.cabinet, times, (item, slot) => {
        alert(` Reminder: It is time to take your ${item.brandName} (${slot} dose).`)
      })
    }
    return () => {
      stopReminderLoop()
    }
  }, [profiles, activeProfileId])

  React.useEffect(() => {
    if (view === VIEWS.HOME) {
      loadAllData()
    }
  }, [view])

  const handleSelectBookmark = (bookmark) => {
    setResults(bookmark.results)
    setPreview(bookmark.results?.preview || null)
    setView(VIEWS.RESULTS)
  }

  const handleDeleteBookmark = async (e, bookmark) => {
    e.stopPropagation()
    try {
      const updated = bookmarks.filter(b => !(b.brandName === bookmark.brandName && b.saltComposition === bookmark.saltComposition))
      setBookmarks(updated)
      
      if (vaultPin) {
        const cipher = await encryptData(JSON.stringify(updated), vaultPin)
        await saveSecureLogs(cipher)
      } else {
        await saveSecureLogs(JSON.stringify(updated))
      }
    } catch (err) {
      console.error(err)
    }
  }

  const toggleBookmark = async (res) => {
    try {
      const alreadyBookmarked = bookmarks.some(b => b.brandName === res.brandName && b.saltComposition === res.saltComposition)
      let updated
      if (alreadyBookmarked) {
        updated = bookmarks.filter(b => !(b.brandName === res.brandName && b.saltComposition === res.saltComposition))
      } else {
        updated = [...bookmarks, {
          brandName: res.brandName,
          saltComposition: res.saltComposition,
          timestamp: Date.now(),
          results: res
        }]
      }
      setBookmarks(updated)
      
      if (vaultPin) {
        const cipher = await encryptData(JSON.stringify(updated), vaultPin)
        await saveSecureLogs(cipher)
      } else {
        await saveSecureLogs(JSON.stringify(updated))
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleUnlockVault = async (pin) => {
    try {
      await loadAllData(pin)
      setVaultPin(pin)
      setIsVaultLocked(false)
      setPinError('')
      setPinInput('')
    } catch (err) {
      setPinError(t.incorrectPin || 'Incorrect PIN or corrupted vault.')
    }
  }

  const handleSetupPin = async (pin) => {
    if (!/^\d{4}$/.test(pin)) {
      setPinError('PIN must be exactly 4 digits.')
      return
    }
    try {
      const cipher = await encryptData(JSON.stringify(bookmarks), pin)
      await saveSecureLogs(cipher)
      await saveAllProfiles(profiles, pin)
      setVaultPin(pin)
      setShowPinSetup(false)
      setNewPin('')
      setPinError('')
    } catch (err) {
      setPinError('Failed to encrypt vault.')
    }
  }

  const handleDisableEncryption = async () => {
    try {
      await saveSecureLogs(JSON.stringify(bookmarks))
      await saveAllProfiles(profiles, '')
      setVaultPin('')
      setPinError('')
    } catch (err) {
      setPinError('Failed to disable encryption.')
    }
  }

  const handleResetVault = async () => {
    if (!window.confirm('Are you sure you want to reset your vault? This will clear corrupted keys and restore default settings.')) return;
    try {
      const keys = await listProfileIds();
      for (const k of keys) {
        await dbDeleteProfile(k);
      }
      await saveSecureLogs('[]');
      try { localStorage.removeItem('medilens_bookmarks'); } catch(e){}
      setVaultPin('');
      setIsVaultLocked(false);
      setPinError('');
      await loadAllData('');
    } catch (err) {
      console.error(err);
    }
  }

  const handleGlobalSearch = async (queryText) => {
    if (!queryText || !queryText.trim()) return;
    setView(VIEWS.LOADING);
    setError(null);
    setStep(1);
    setBarcodeHit(false);
    setProcessedPreview(null);
    setCompletedStepIds([]);
    setActiveStepId(null);
    setPreview(null);
    try {
      setActiveStepId('started');
      const res = await lookupMedicineNameOnly(queryText.trim());
      setCompletedStepIds(['started', 'vision', 'db', 'scraping', 'summary']);
      setActiveStepId(null);
      setResults(res);
      setView(VIEWS.RESULTS);
    } catch (err) {
      setError(err.message || 'Failed to complete global online search.');
      setView(VIEWS.ERROR);
    }
  };

  const handleSelectSearchResult = (result, type) => {
    let queryText = '';
    if (type === 'cdsco') {
      queryText = result.row['Drug Name'] || '';
    } else {
      queryText = result.row['Generic Name'] || result.row['Drug Name'] || '';
    }
    if (queryText) {
      handleGlobalSearch(queryText);
    }
  };

  const startAnalysis = useCallback(async (finalBase64, barcodeData, originalImage = null) => {
    try {
      if (barcodeData && barcodeData.isEmergencyCard) {
        setStep(3)
        const mockResult = {
          isEmergencyCard: true,
          emergencyProfile: barcodeData,
          preview: `data:image/jpeg;base64,${finalBase64}`
        }
        setResults(mockResult)
        setView(VIEWS.RESULTS)
        return
      }

      if (localOcrEnabled && scanMode === 'medicine') {

        setActiveStepId('started')
        setCompletedStepIds([])
        await new Promise(r => setTimeout(r, 400))

        // 1. Vision Step (OCR)
        setCompletedStepIds(prev => [...prev, 'started'])
        setActiveStepId('vision')
        
        let extractedText = '';
        try {
          const worker = await getTesseractWorker();
          const { data: { text: processedText } } = await worker.recognize(`data:image/jpeg;base64,${finalBase64}`);
          extractedText = processedText;
          if (originalImage) {
            try {
              const { data: { text: originalText } } = await worker.recognize(originalImage);
              extractedText = selectBestMedicineOcrText(processedText, originalText);
            } catch (originalOcrErr) {
              console.warn('Original image OCR fallback failed:', originalOcrErr);
            }
          }
        } catch (tessErr) {
          console.error("Local Tesseract OCR failed:", tessErr);
          throw new Error("Local OCR Engine failed. Please verify internet connection or toggle settings.");
        }

        if (!extractedText || !extractedText.trim()) {
          throw new Error("No text detected on the medicine strip. Try again with a clearer photo.");
        }

        const labelDetails = extractLocalLabelDetails(extractedText)
        const knownBrand = resolveKnownMedicineBrand(extractedText)

        // 2. Database Step (Query search database via search worker)
        setCompletedStepIds(prev => [...prev, 'vision'])
        setActiveStepId('db')

        if (!searchWorker) {
          throw new Error("Local offline database is still initializing. Please wait a moment and try again.");
        }

        const candidates = knownBrand
          ? [knownBrand.saltComposition]
          : extractCandidateQueries(extractedText);
        if (candidates.length === 0) {
          setResults({
            productType: 'NOT_MEDICINE',
            cannotReadReason: 'No medicine could be identified in this image. Scan a medicine package with its name or active ingredient visible.',
            preview: `data:image/jpeg;base64,${finalBase64}`,
          });
          setView(VIEWS.RESULTS);
          return;
        }

        const getSearchResultsPromise = (queryStr) => {
          return new Promise((resolve) => {
            const handler = (e) => {
              if (e.data.type === 'results' && e.data.query === queryStr) {
                searchWorker.removeEventListener('message', handler);
                resolve({ cdsco: e.data.cdsco, ja: e.data.ja });
              } else if (e.data.type === 'error') {
                searchWorker.removeEventListener('message', handler);
                resolve({ cdsco: [], ja: [] });
              }
            };
            searchWorker.addEventListener('message', handler);
            searchWorker.postMessage({
              type: 'search',
              data: { query: queryStr }
            });
          });
        };

        const allSearchResults = await Promise.all(
          candidates.map(c => getSearchResultsPromise(c))
        );

        let bestCdscoMatch = null;
        let bestJaMatch = null;
        let bestCdscoScore = 0;
        let bestJaScore = 0;
        let bestCandidate = knownBrand ? candidates[0] : '';
        let highestOverallScore = 0;

        allSearchResults.forEach((res, idx) => {
          const cand = candidates[idx];
          const expectedSalts = knownBrand ? parseSalts(knownBrand.saltComposition) : null;
          const candCdscoMatch = knownBrand
            ? (res.cdsco || []).find(match => matchQuality(expectedSalts, parseSalts(match.row['Strength'] || '')) === 'exact') || null
            : (res.cdsco || []).find(match => hasCatalogIngredientMatch(extractedText, match)) || null;
          const candJaMatch = knownBrand
            ? (res.ja || []).find(match => matchQuality(expectedSalts, parseSalts(match.row['Generic Name'] || '')) === 'exact') || null
            : (res.ja || []).find(match => hasCatalogIngredientMatch(extractedText, match)) || null;
          const candCdscoScore = candCdscoMatch ? candCdscoMatch.score : 0;
          const candJaScore = candJaMatch ? candJaMatch.score : 0;
          const candMaxScore = Math.max(candCdscoScore, candJaScore);

          if (candMaxScore > highestOverallScore) {
            highestOverallScore = candMaxScore;
            bestCandidate = cand;
            bestCdscoMatch = candCdscoMatch;
            bestCdscoScore = candCdscoScore;
            bestJaMatch = candJaMatch;
            bestJaScore = candJaScore;
          }
        });

        if (!hasVerifiedMedicineEvidence({
          text: extractedText,
          labelDetails,
          knownBrand,
          catalogMatches: [bestCdscoMatch, bestJaMatch],
        })) {
          setResults({
            productType: 'NOT_MEDICINE',
            cannotReadReason: 'No medicine could be verified in this image. Scan a medicine package with its name, active ingredient, or package details visible.',
            preview: `data:image/jpeg;base64,${finalBase64}`,
          });
          setView(VIEWS.RESULTS);
          return;
        }

        let saltName = '';
        if (knownBrand) {
          saltName = knownBrand.saltComposition;
        } else if (bestJaMatch) {
          saltName = bestJaMatch.row['Generic Name'];
        } else if (bestCdscoMatch) {
          saltName = bestCdscoMatch.row['Drug Name'];
        }

        let brandName = knownBrand?.brandName || '';
        // Find other candidate that represents the brand (exclude short noise candidates < 4 chars)
        if (!knownBrand) {
          const otherCandidates = candidates.filter(c =>
            c !== bestCandidate &&
            c.trim().length >= 4 &&
            !saltName.toLowerCase().includes(c.toLowerCase()) &&
            !c.toLowerCase().includes(saltName.toLowerCase())
          );
          if (otherCandidates.length > 0) {
            brandName = otherCandidates[0].split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          } else if (bestJaMatch) {
            brandName = 'Jan Aushadhi';
          } else {
            brandName = bestCandidate.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          }
        }

        // 3. Scraping / Summary step (simulate locally)
        setCompletedStepIds(prev => [...prev, 'db'])
        setActiveStepId('scraping')
        await new Promise(r => setTimeout(r, 300))

        setCompletedStepIds(prev => [...prev, 'scraping'])
        setActiveStepId('summary')
        await new Promise(r => setTimeout(r, 300))

        const cdscoRes = bestCdscoMatch 
          ? {
              found: true,
              badge: ` ${saltName} is CDSCO-approved`,
              indication: bestCdscoMatch.row['Indication'] || null,
              approvalDate: bestCdscoMatch.row['Approval Date'] || null,
            }
          : { found: false, badge: 'Salt not found in CDSCO registry.' };

        const localInfo = getLocalMedicineInfo(saltName);

        const allAlts = [];
        const jaMatchesForBest = allSearchResults[candidates.indexOf(bestCandidate)]?.ja || [];
        
        const qSalts = parseSalts(saltName);
        const filteredMatches = jaMatchesForBest.filter(match => {
          const item = match.row;
          const pSalts = parseSalts(item['Generic Name'] || '');
          const quality = matchQuality(qSalts, pSalts);
          return quality === 'exact';
        });

        filteredMatches.slice(0, 4).forEach(match => {
          const item = match.row;
          const mrp = parseFloat(item['MRP']) || 0;
          const unitSizeStr = item['Unit Size'] || '';
          const numMatch = unitSizeStr.match(/(\d+)/);
          let count = 1;
          if (numMatch) {
            count = parseInt(numMatch[1]);
          } else if (/pair/i.test(unitSizeStr)) {
            count = 2;
          }
          allAlts.push({
            name: item['Generic Name'],
            brand: 'Jan Aushadhi',
            mrp,
            packSize: item['Unit Size'],
            perUnit: count > 0 ? Math.round((mrp / count) * 100) / 100 : mrp,
            priceSource: 'Jan Aushadhi (Local DB)',
            highConfidence: true,
            aiEstimated: false,
            isJanAushadhi: true,
          });
        });

        const finalResult = {
          productType: 'MEDICINE',
          brandName,
          saltComposition: saltName,
          manufacturer: labelDetails.manufacturer,
          mrp: labelDetails.mrp,
          unitSize: labelDetails.unitSize,
          batchNumber: labelDetails.batchNumber,
          expiryDate: labelDetails.expiryDate,
          manufacturingDate: null,
          isExpired: isExpiryMonthExpired(labelDetails.expiryDate),
          confidence: knownBrand ? 95 : Math.round(Math.min(99, Math.max(70, Math.max(bestCdscoScore, bestJaScore) * 10))),
          saltSource: 'LOCAL_OCR',
          authenticity: {
            status: cdscoRes.found ? 'LIKELY_GENUINE' : 'CANNOT_DETERMINE',
            reason: cdscoRes.found ? 'Matches national CDSCO registration database.' : 'Missing in CDSCO database. Verify with pharmacist.',
            cdscoBadge: cdscoRes.badge,
            cdscoFound: cdscoRes.found,
            approvalDate: cdscoRes.approvalDate,
          },
          medicineInfo: {
            whatItDoes: localInfo.whatItDoes,
            commonUses: localInfo.commonUses,
            prescriptionRequired: localInfo.prescriptionRequired,
            sideEffects: localInfo.sideEffects,
            importantWarnings: localInfo.importantWarnings,
          },
          alternatives: {
            hasGenerics: allAlts.length > 0,
            janAushadhiAvailable: allAlts.length > 0,
            topAlternatives: allAlts,
            disclaimer: 'Alternatives listed from local Jan Aushadhi offline registry. Verify rates at retail stores.',
          },
          dataSource: {
            salt: 'Local Tesseract OCR + Gov Database',
            alts: 'Jan Aushadhi Offline DB',
            cdsco: cdscoRes.found ? 'CDSCO Approved' : 'Unregistered',
            cdscoFound: cdscoRes.found,
          }
        };

        setCompletedStepIds(prev => [...prev, 'summary'])
        setActiveStepId(null)
        
        finalResult.preview = `data:image/jpeg;base64,${finalBase64}`
        setResults(finalResult)
        setView(VIEWS.RESULTS)
        return
      }

      if (!useAsyncQueue) {

        let res
        if (scanMode === 'prescription') {
          await new Promise(r => setTimeout(r, 600))
          res = await scanPrescription(finalBase64, 'image/jpeg')
          setStep(3)
          await new Promise(r => setTimeout(r, 300))
          if (res.data?.cannotRead) throw new Error(res.data.cannotReadReason || 'Could not read the prescription.')
          res.isPrescription = true
        } else {
          await new Promise(r => setTimeout(r, 300))
          res = await scanMedicine(finalBase64, 'image/jpeg', barcodeData)
          setStep(3)
          await new Promise(r => setTimeout(r, 300))
          if (res.cannotRead) throw new Error(res.cannotReadReason || 'Could not read the medicine. Try a clearer photo.')
        }
        res.preview = `data:image/jpeg;base64,${finalBase64}`
        setResults(res)
        setView(VIEWS.RESULTS)
      } else {

        const response = await fetch('/api/scan-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: finalBase64,
            scanMode,
            barcodeData
          })
        })

        if (!response.ok) {
          throw new Error(`Server returned HTTP ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let buffer = ''
        let scanResult = null

        while (true) {
          const { value, done } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop()

          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('data:')) {
              const dataStr = trimmed.slice(5).trim()
              if (dataStr === ': keep-alive') continue
              try {
                const event = JSON.parse(dataStr)

                if (event.step === 'started') {
                  setActiveStepId('started')
                } else if (event.step === 'vision_start') {
                  setCompletedStepIds(prev => [...prev, 'started'])
                  setActiveStepId('vision')
                } else if (event.step === 'db_start') {
                  setCompletedStepIds(prev => [...prev, 'vision'])
                  setActiveStepId('db')
                } else if (event.step === 'scraping_start') {
                  setCompletedStepIds(prev => [...prev, 'db'])
                  setActiveStepId('scraping')
                } else if (event.step === 'summary_start') {
                  setCompletedStepIds(prev => [...prev, 'scraping'])
                  setActiveStepId('summary')
                } else if (event.step === 'completed') {
                  setCompletedStepIds(prev => [...prev, 'summary'])
                  setActiveStepId(null)
                  scanResult = event.data
                } else if (event.step === 'failed') {
                  throw new Error(event.message || 'Background analysis failed.')
                }
              } catch (parseErr) {
                console.error("Failed to parse event packet:", parseErr)
              }
            }
          }
        }

        if (scanResult) {
          if (scanMode === 'prescription') {
            scanResult.isPrescription = true
          }
          scanResult.preview = `data:image/jpeg;base64,${finalBase64}`
          setResults(scanResult)
          setView(VIEWS.RESULTS)
        } else {
          throw new Error('Connection closed prematurely by host.')
        }
      }
    } catch (err) {
      setError(err.message)
      setView(VIEWS.ERROR)
    }
  }, [scanMode, useAsyncQueue, localOcrEnabled, searchWorker])

function base64ToBlob(base64, mime = 'image/jpeg') {
  const byteString = atob(base64)
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }
  return new Blob([ab], { type: mime })
}

  const handleCapturedFrame = useCallback(async (base64, directBarcodeText = null) => {
    setView(VIEWS.LOADING)
    setError(null)
    setStep(1)
    setBarcodeHit(false)
    setProcessedPreview(null)
    setCompletedStepIds([])
    setActiveStepId(null)
    setPreview(`data:image/jpeg;base64,${base64}`)
    
    let barcodeData = null
    if (directBarcodeText) {
      console.log("Using direct barcode text from camera stream:", directBarcodeText)
      barcodeData = await readBarcode(directBarcodeText)
    } else {
      try {
        const blob = base64ToBlob(base64)
        barcodeData = await readBarcode(blob)
      } catch (e) {
        console.error("Barcode reading error from captured frame:", e)
      }
    }
    
    if (barcodeData) setBarcodeHit(true)
    
    await startAnalysis(base64, barcodeData)
  }, [startAnalysis])

  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    if (file.size > 30 * 1024 * 1024) { alert('Image too large (max 30MB).'); return }
    
    setView(VIEWS.LOADING)
    setError(null)
    setStep(1)
    setBarcodeHit(false)
    setProcessedPreview(null)
    setCompletedStepIds([])
    setActiveStepId(null)

    if (preview) URL.revokeObjectURL(preview)
    setPreview(URL.createObjectURL(file))

    try {

      const timeoutPromise = (promise, ms) => {
        return new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), ms);
          promise.then(
            (res) => { clearTimeout(timer); resolve(res); },
            () => { clearTimeout(timer); resolve(null); }
          );
        });
      };

      const barcodePromise = scanMode === 'medicine' 
        ? timeoutPromise(readBarcode(file), 1500) 
        : Promise.resolve(null)
      
      let finalBase64 = null
      if (wasmEnabled) {
        setActiveStepId('started')
        try {
          const result = await processImageWasm(file, wasmFilter)
          finalBase64 = result.base64
          setProcessedPreview(`data:image/jpeg;base64,${finalBase64}`)
        } catch (wasmErr) {
          console.error("WASM filter failed, falling back to client-side compression:", wasmErr)
        }
      }

      if (!finalBase64) {
        finalBase64 = await compressAndEncode(file)
      }

      const barcodeData = await barcodePromise
      if (barcodeData) setBarcodeHit(true)
      
      await startAnalysis(finalBase64, barcodeData, file)
    } catch (err) {
      setError(err.message)
      setView(VIEWS.ERROR)
    }
  }, [preview, scanMode, wasmEnabled, wasmFilter, startAnalysis])

  const handleChange = useCallback((e) => {
    const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''
  }, [handleFile])

  const reset = useCallback(() => {
    setView(VIEWS.HOME); setResults(null); setError(null); setStep(0)
  }, [])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'transparent', position: 'relative' }}>

      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 14px 56px', background: 'var(--navy)', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, background: 'var(--green)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', fontSize: 15 }}>ML</div>
          <div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 17, lineHeight: 1.1 }}>MediLens</div>
            <div style={{ color: '#c7e8df', fontSize: 10.5 }}>Medicine insights</div>
          </div>
        </div>
        <button id="menu-toggle-btn" onClick={() => setHamOpen(o => !o)} style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4.5 }}>
          {[0,1,2].map(i => <span key={i} style={{ width: 17, height: 1.5, background: hamOpen && i===1 ? 'transparent' : '#fff', borderRadius: 1, display: 'block',
            transform: hamOpen ? (i===0 ? 'translateY(6px) rotate(45deg)' : i===2 ? 'translateY(-6px) rotate(-45deg)' : 'none') : 'none', transition: 'all 0.25s' }} />)}
        </button>
      </header>

      <HamMenu 
        open={hamOpen} 
        onClose={() => setHamOpen(false)} 
        lang={lang} 
        setLang={setLang} 
        t={t} 
        onScan={() => { setHamOpen(false); if (view !== VIEWS.HOME) reset(); setActiveTab('cabinet'); }} 
        onCabinet={() => { setHamOpen(false); if (view !== VIEWS.HOME) reset(); setActiveTab('cabinet'); }}
        onReminders={() => { setHamOpen(false); if (view !== VIEWS.HOME) reset(); setActiveTab('reminders'); }}
        onHealthCard={() => { setHamOpen(false); if (view !== VIEWS.HOME) reset(); setActiveTab('healthcard'); }}
        onSymptoms={() => { setHamOpen(false); if (view !== VIEWS.HOME) reset(); setActiveTab('symptoms'); }}
      />

      <div className="notice-strip" style={{ background: '#FEF3C7', borderBottom: '1px solid #FCD34D', padding: '7px 16px', textAlign: 'center' }}>
        <span style={{ fontSize: 11.5, color: '#92400E' }}>Beta: <strong>Beta</strong>  -  {t.betaBanner || 'AI results may not be 100% accurate. Verify with your pharmacist.'}</span>
      </div>

      {view === VIEWS.HOME    && (
        <HomeView
          t={t}
          setPage={setPage}
          bookmarks={bookmarks}
          handleSelectBookmark={handleSelectBookmark}
          handleDeleteBookmark={handleDeleteBookmark}
          onCamera={(mode) => { 
            setScanMode(mode);
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
              setView(VIEWS.AR);
            } else {
              cameraRef.current?.click();
            }
          }}
          onUpload={(mode) => { setScanMode(mode); uploadRef.current?.click() }}
          
          wasmEnabled={wasmEnabled}
          setWasmEnabled={setWasmEnabled}
          wasmFilter={wasmFilter}
          setWasmFilter={setWasmFilter}
          useAsyncQueue={useAsyncQueue}
          setUseAsyncQueue={setUseAsyncQueue}
          localOcrEnabled={localOcrEnabled}
          setLocalOcrEnabled={setLocalOcrEnabled}
          
          vaultPin={vaultPin}
          isVaultLocked={isVaultLocked}
          setIsVaultLocked={setIsVaultLocked}
          pinInput={pinInput}
          setPinInput={setPinInput}
          pinError={pinError}
          setPinError={setPinError}
          handleUnlockVault={handleUnlockVault}
          showPinSetup={showPinSetup}
          setShowPinSetup={setShowPinSetup}
          newPin={newPin}
          setNewPin={setNewPin}
          handleSetupPin={handleSetupPin}
          handleDisableEncryption={handleDisableEncryption}
          cabinet={cabinet}
          toggleCabinetItem={toggleCabinetItem}
          activeInteractions={activeInteractions}
          activeDuplications={activeDuplications}
          activeSchedule={activeSchedule}
          searchQuery={searchQuery}
          handleSearchChange={handleSearchChange}
          searchResults={searchResults}
          isSearching={isSearching}
          searchStatus={searchStatus}
          handleSelectSearchResult={handleSelectSearchResult}
          handleGlobalSearch={handleGlobalSearch}
          
          profiles={profiles}
          activeProfileId={activeProfileId}
          setActiveProfileId={setActiveProfileId}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          symptomInput={symptomInput}
          setSymptomInput={setSymptomInput}
          profileInput={profileInput}
          setProfileInput={setProfileInput}
          showAddProfile={showAddProfile}
          setShowAddProfile={setShowAddProfile}
          activeProfile={activeProfile}
          handleSaveHealthCard={handleSaveHealthCard}
          handleLogSymptom={handleLogSymptom}
          handleDeleteSymptom={handleDeleteSymptom}
          handleToggleNotification={handleToggleNotification}
          handleUpdatePillCount={handleUpdatePillCount}
          handleUpdateReminderTime={handleUpdateReminderTime}
          handleToggleAdherence={handleToggleAdherence}
          handleAddProfile={handleAddProfile}
          handleDeleteProfile={handleDeleteProfile}
          selectedCabinetIndex={selectedCabinetIndex}
          setSelectedCabinetIndex={setSelectedCabinetIndex}
          cabinetSearchResults={cabinetSearchResults}
          setCabinetSearchResults={setCabinetSearchResults}
          isCabinetSearching={isCabinetSearching}
          setIsCabinetSearching={setIsCabinetSearching}
          selectedMed={selectedMed}
          cabDoseStrength={cabDoseStrength}
          setCabDoseStrength={setCabDoseStrength}
          cabDoseFreq={cabDoseFreq}
          setCabDoseFreq={setCabDoseFreq}
          cabScrubTime={cabScrubTime}
          setCabScrubTime={setCabScrubTime}
          handleUpdateCabinetItem={handleUpdateCabinetItem}
          cabinetAddQuery={cabinetAddQuery}
          cabinetAddResults={cabinetAddResults}
          isCabinetAddSearching={isCabinetAddSearching}
          handleCabinetAddSearch={handleCabinetAddSearch}
          showCabinet3D={showCabinet3D}
          setShowCabinet3D={setShowCabinet3D}
          showManualAddModal={showManualAddModal}
          setShowManualAddModal={setShowManualAddModal}
          manualAddForm={manualAddForm}
          setManualAddForm={setManualAddForm}
          saveAllProfiles={saveAllProfiles}
        />
      )}
      {view === VIEWS.AR      && <ARScanner onCapture={handleCapturedFrame} onCancel={reset} t={t} />}
      {view === VIEWS.LOADING && (
        <LoadingView 
          t={t} 
          step={step} 
          preview={preview} 
          processedPreview={processedPreview}
          barcodeHit={barcodeHit} 
          activeStepId={activeStepId}
          completedStepIds={completedStepIds}
        />
      )}
      {view === VIEWS.RESULTS && results && (
        results?.isEmergencyCard ? (
          <EmergencyCardResultView results={results} onReset={reset} t={t} />
        ) : results?.isPrescription ? (
          <PrescriptionResultsPanel results={results} preview={preview} onReset={reset} t={t} lang={lang} bookmarks={bookmarks} onToggleBookmark={toggleBookmark} />
        ) : (
          <ResultsPanel 
            results={results} 
            preview={preview} 
            onReset={reset} 
            t={t} 
            lang={lang} 
            isBookmarked={bookmarks.some(b => b.brandName === results.brandName && b.saltComposition === results.saltComposition)}
            onToggleBookmark={() => toggleBookmark(results)}
            profile={activeProfile}
          />
        )
      )}
      {view === VIEWS.ERROR   && <ErrorView error={error} onReset={reset} t={t} />}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleChange} style={{ display: 'none' }} />
      <input ref={uploadRef} type="file" accept="image/*" onChange={handleChange} style={{ display: 'none' }} />
    </div>
  )
}

function FAQItem({ question, answer }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div style={{ border: '1.5px solid var(--border)', borderRadius: 10, background: '#fff', overflow: 'hidden', marginBottom: 8, boxShadow: 'var(--shadow)' }}>
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'none',
          padding: '10px 12px',
          fontSize: '12.5px',
          fontWeight: 700,
          color: 'var(--navy)',
          cursor: 'pointer',
          textAlign: 'left'
        }}
      >
        <span>{question}</span>
        <span style={{ fontSize: 10, transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
      </button>
      {isOpen && (
        <div style={{ padding: '10px 12px', fontSize: '11.5px', color: 'var(--textmd)', borderTop: '1.5px solid var(--border)', background: 'var(--bgsoft)', lineHeight: 1.5 }}>
          {answer}
        </div>
      )}
    </div>
  );
}

function EmergencyCardResultView({ results, onReset, t }) {
  const profile = results.emergencyProfile || {};
  return (
    <div style={{ padding: '20px', maxWidth: '480px', margin: '0 auto', animation: 'fadeUp 0.4s ease' }}>
      <div style={{
        background: 'linear-gradient(135deg, #E11D48 0%, #9F1239 100%)',
        color: '#fff',
        borderRadius: '20px 20px 0 0',
        padding: '24px 20px',
        textAlign: 'center',
        boxShadow: 'var(--shadowmd)'
      }}>
        <div style={{ fontSize: '24px', marginBottom: '8px' }}></div>
        <h2 style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '0.05em', margin: 0 }}>EMERGENCY MEDICAL ID</h2>
        <p style={{ fontSize: '11px', opacity: 0.85, margin: '4px 0 0' }}>READ LOCALLY WITH MEDILENS</p>
      </div>

      <div style={{
        background: '#fff',
        border: '1.5px solid var(--border)',
        borderTop: 'none',
        borderRadius: '0 0 20px 20px',
        padding: '20px',
        boxShadow: 'var(--shadowmd)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        
        <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px', textAlign: 'left' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--textlt)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>PATIENT NAME</span>
          <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--navy)', marginTop: '2px' }}>{profile.name || 'Not Specified'}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', textAlign: 'left' }}>
          <div style={{ background: 'var(--bgsoft)', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--textlt)', textTransform: 'uppercase' }}>BLOOD GROUP</span>
            <div>
              <span style={{
                background: 'var(--red)',
                color: '#fff',
                padding: '4px 10px',
                borderRadius: '6px',
                fontWeight: 800,
                fontSize: '14px',
                display: 'inline-block'
              }}>{profile.bloodGroup || 'N/A'}</span>
            </div>
          </div>

          <div style={{ background: 'var(--bgsoft)', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--textlt)', textTransform: 'uppercase' }}>ALLERGIES</span>
            <div style={{
              fontSize: '12px',
              fontWeight: 700,
              color: profile.allergies && profile.allergies.toLowerCase() !== 'none' && profile.allergies.toLowerCase() !== 'none logged' ? 'var(--red)' : 'var(--textlt)'
            }}>{profile.allergies || 'None Logged'}</div>
          </div>
        </div>

        <div style={{ background: 'var(--bgsoft)', borderRadius: '12px', padding: '14px', textAlign: 'left' }}>
          <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--textlt)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>CHRONIC CONDITIONS</span>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--navy)', lineHeight: 1.4 }}>{profile.chronicConditions || 'None Logged'}</div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--textlt)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>EMERGENCY CONTACT</span>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--navy)' }}>{profile.emergencyName || 'Not Specified'}</div>
              <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--green)', marginTop: '2px' }}>{profile.emergencyPhone || 'N/A'}</div>
            </div>
            {profile.emergencyPhone && (
              <a 
                href={`tel:${profile.emergencyPhone.replace(/\s+/g, '')}`} 
                style={{
                  background: 'var(--green)',
                  color: '#fff',
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  boxShadow: 'var(--shadow)'
                }}
              >
                📞
              </a>
            )}
          </div>
        </div>

        <button 
          onClick={onReset}
          style={{
            marginTop: '8px',
            width: '100%',
            height: '44px',
            background: 'var(--navy)',
            color: '#fff',
            borderRadius: '12px',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: 'var(--shadow)'
          }}
        >
           Return to Scanner
        </button>
      </div>
    </div>
  );
}

function HomeView({ 
  t, setPage, bookmarks, handleSelectBookmark, handleDeleteBookmark, onCamera, onUpload,
  wasmEnabled, setWasmEnabled, wasmFilter, setWasmFilter, useAsyncQueue, setUseAsyncQueue,
  localOcrEnabled, setLocalOcrEnabled,
  vaultPin, isVaultLocked, setIsVaultLocked, pinInput, setPinInput, pinError, setPinError,
  handleUnlockVault, showPinSetup, setShowPinSetup, newPin, setNewPin, handleSetupPin,
  handleDisableEncryption,
  cabinet, toggleCabinetItem, activeInteractions, activeDuplications, activeSchedule,
  searchQuery, handleSearchChange, searchResults, isSearching, searchStatus, handleSelectSearchResult, handleGlobalSearch,
  
  profiles, activeProfileId, setActiveProfileId, activeTab, setActiveTab,
  symptomInput, setSymptomInput, profileInput, setProfileInput, showAddProfile, setShowAddProfile,
  activeProfile, handleSaveHealthCard, handleLogSymptom, handleDeleteSymptom,
  handleToggleNotification, handleUpdatePillCount, handleUpdateReminderTime, handleToggleAdherence,
  handleAddProfile, handleDeleteProfile,

  selectedCabinetIndex, setSelectedCabinetIndex,
  cabinetSearchResults, setCabinetSearchResults,
  isCabinetSearching, setIsCabinetSearching,
  selectedMed,
  cabDoseStrength, setCabDoseStrength,
  cabDoseFreq, setCabDoseFreq,
  cabScrubTime, setCabScrubTime,
  handleUpdateCabinetItem,
  cabinetAddQuery,
  cabinetAddResults,
  isCabinetAddSearching,
  handleCabinetAddSearch,
  showCabinet3D,
  setShowCabinet3D,
  showManualAddModal,
  setShowManualAddModal,
  manualAddForm,
  setManualAddForm,
  saveAllProfiles
}) {
  const [showPrivacySchool, setShowPrivacySchool] = useState(false)
  const [schoolTab, setSchoolTab] = useState('diary')

  const handleQuickAdd = async (medName, saltName) => {
    const updated = profiles.map(p => {
      if (p.id === activeProfileId) {
        const cab = p.cabinet || [];
        const isAlreadyIn = cab.some(item => item.brandName === medName && item.saltComposition === saltName);
        if (isAlreadyIn) return p;
        const nextCab = [...cab, {
          brandName: medName,
          saltComposition: saltName,
          pillCount: 30,
          notificationsEnabled: true,
          meta: {
            idealTime: 'Morning',
            foodRelation: 'With or without food',
            rationale: 'Quick-added from search suggestions.'
          }
        }];
        return { ...p, cabinet: nextCab };
      }
      return p;
    });
    await saveAllProfiles(updated);
    handleCabinetAddSearch('');
  };

  const handleUndoDose = async (log, lIdx) => {
    const updated = profiles.map(p => {
      if (p.id === activeProfileId) {
        const nextCab = (p.cabinet || []).map(item => {
          if (item.brandName === log.medName) {
            return { ...item, pillCount: (item.pillCount || 0) + 1 };
          }
          return item;
        });
        const nextHistory = (p.doseHistory || []).filter((_, idx) => idx !== lIdx);
        return { ...p, cabinet: nextCab, doseHistory: nextHistory };
      }
      return p;
    });
    await saveAllProfiles(updated);
  };

  const handleManualAddSubmit = async (e) => {
    e.preventDefault();
    if (!manualAddForm.brandName || !manualAddForm.saltComposition) {
      alert("Please fill in both the Medicine Name and Salt Composition.");
      return;
    }
    const newItem = {
      brandName: manualAddForm.brandName.trim(),
      saltComposition: manualAddForm.saltComposition.trim(),
      strength: parseInt(manualAddForm.strength) || 500,
      strengthUnit: manualAddForm.strengthUnit || 'mg',
      form: manualAddForm.form || 'Tablet',
      frequency: parseInt(manualAddForm.frequency) || 3,
      pillCount: parseInt(manualAddForm.pillCount) || 30,
      notificationsEnabled: true,
      expiryDate: manualAddForm.expiryDate || '',
      mfgDate: manualAddForm.mfgDate || '',
      batchNumber: manualAddForm.batchNumber.trim() || '',
      productType: manualAddForm.form === 'Syrup' || manualAddForm.form === 'Drops' ? 'ALLOPATHIC' : (manualAddForm.brandName.toLowerCase().includes('ayur') ? 'AYURVEDIC' : 'ALLOPATHIC'),
      meta: {
        idealTime: manualAddForm.idealTime,
        foodRelation: manualAddForm.foodRelation,
        rationale: 'Manually added dosage schedule.'
      }
    };
    
    const updated = profiles.map(p => {
      if (p.id === activeProfileId) {
        const cab = p.cabinet || [];
        return { ...p, cabinet: [...cab, newItem] };
      }
      return p;
    });
    
    await saveAllProfiles(updated);
    setShowManualAddModal(false);
    setManualAddForm({
      brandName: '',
      saltComposition: '',
      strength: 500,
      strengthUnit: 'mg',
      form: 'Tablet',
      pillCount: 30,
      mfgDate: '',
      expiryDate: '',
      batchNumber: '',
      idealTime: 'Morning',
      foodRelation: 'With or without food',
      frequency: 3
    });
  };
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'transparent', padding: '0 18px 32px 18px', animation: 'fadeIn 0.4s ease' }}>

      <div className="hero-copy" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '40px 0 32px', animation: 'fadeUp 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both' }}>
        <div className="hero-kicker" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--greenlt)', color: 'var(--greendk)', padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 20, boxShadow: '0 2px 8px rgba(15,122,90,0.1)' }}>
          <span style={{ fontSize: 14 }}>✨</span> {t.knowYourMedicine || 'Know Your Medicine'}
        </div>

        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#0f172a', lineHeight: 1.25, marginBottom: 16, fontFamily: "'Outfit', sans-serif" }}>
          Know what's inside your medicine.<br />
          <span className="chaos-highlighter" style={{ fontSize: 26, color: '#000', marginTop: 8 }}>Compare ingredients and prices.</span>
        </h1>

        <p style={{ fontSize: 16, color: '#475569', lineHeight: 1.6, maxWidth: 360, margin: '0 auto 36px', fontFamily: "'Kalam', cursive", fontWeight: 700 }}>
          Scan a medicine pack to identify its active ingredients and compare available government-listed generic options.
        </p>

        <div className="hero-mark" aria-hidden="true"><span>Rx</span></div>

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12, animation: 'fadeUp 0.4s ease 0.3s both' }}>
          <button onClick={() => onCamera('medicine')} style={{ width: '100%', height: 60, background: 'linear-gradient(135deg, var(--green), #0D9488)', borderRadius: 16, color: '#fff', fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: '0 8px 16px rgba(15,122,90,0.25)', border: 'none', cursor: 'pointer', transition: 'transform 0.2s' }}>
            <span style={{ fontSize: 22 }}></span> {t.scanMedicineBtn ? t.scanMedicineBtn.replace(/^[\s]+/, '') : 'Scan Medicine Strip'}
          </button>
          
          <button onClick={() => onCamera('prescription')} style={{ width: '100%', height: 60, background: 'linear-gradient(135deg, var(--navy), var(--navylt))', borderRadius: 16, color: '#fff', fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: '0 8px 16px rgba(26,43,74,0.25)', border: 'none', cursor: 'pointer', transition: 'transform 0.2s' }}>
            <span style={{ fontSize: 22 }}></span> {t.scanPrescriptionBtn ? t.scanPrescriptionBtn.replace(/^[\s]+/, '') : 'Scan Prescription'}
          </button>

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => onUpload('medicine')} style={{ flex: 1, height: 44, background: 'rgba(255,255,255,0.7)', border: '1.5px solid var(--border)', borderRadius: 12, color: 'var(--textmd)', fontSize: 13, fontWeight: 600, cursor: 'pointer', backdropFilter: 'blur(8px)' }}>
              {t.uploadStrip || 'Upload Strip'}
            </button>
            <button onClick={() => onUpload('prescription')} style={{ flex: 1, height: 44, background: 'rgba(255,255,255,0.7)', border: '1.5px solid var(--border)', borderRadius: 12, color: 'var(--textmd)', fontSize: 13, fontWeight: 600, cursor: 'pointer', backdropFilter: 'blur(8px)' }}>
              {t.uploadRx || 'Upload Rx'}
            </button>
          </div>
        </div>
      </div>

      <div className="glass-surface" style={{
        background: '#fff',
        border: '1.5px solid var(--border)',
        borderRadius: 16,
        padding: '16px',
        marginTop: '16px',
        marginBottom: '20px',
        boxShadow: 'var(--shadow)',
        animation: 'fadeUp 0.5s ease 0.35s both',
        position: 'relative'
      }}>
        <div className="washi-tape">SEARCH DATABASE</div>
        <h3 style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--navy)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
           Search by medicine name or salt
        </h3>
        <p style={{ fontSize: 11, color: 'var(--textlt)', margin: '0 0 12px 0' }}>
          Search by brand or active ingredient. Local database matching helps find likely registry records.
        </p>

        <div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleGlobalSearch(searchQuery) }}
              placeholder="Search e.g. Crocin, Paracetamol, Atorvastatin..."
              style={{
                flex: 1,
                height: 46,
                padding: '0 12px',
                borderRadius: 10,
                border: '1.5px solid var(--bordermd)',
                fontSize: 13.5,
                color: 'var(--navy)',
                outline: 'none',
                background: '#fff',
                boxSizing: 'border-box',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--green)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--bordermd)'}
            />
            <button className="glass-primary"
              onClick={() => handleGlobalSearch(searchQuery)}
              style={{
                height: 46,
                padding: '0 16px',
                background: 'linear-gradient(135deg, var(--green), #0D9488)',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontSize: 13.5,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 10px rgba(15,122,90,0.15)',
                transition: 'transform 0.2s'
              }}
            >
              Search
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--textlt)', marginTop: 6, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>Status:</span> {searchStatus}
          </div>
        </div>

        {searchQuery && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10, maxHeight: 220, overflowY: 'auto' }}>
            {isSearching && (
              <div style={{ fontSize: 12, color: 'var(--textlt)', padding: '6px 0', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--border)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                Computing scoring ranks...
              </div>
            )}

            {!isSearching && (!searchResults || (searchResults.cdsco.length === 0 && searchResults.ja.length === 0)) && (
              <div style={{ fontSize: 12, color: 'var(--textlt)', padding: '6px 0', textAlign: 'center' }}>
                No matches found phonetically or by keyword relevance.
              </div>
            )}

            {searchResults && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {searchResults.cdsco.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--navy)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                      Approved CDSCO Formulations:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {searchResults.cdsco.map((res, ridx) => (
                        <div
                          key={ridx}
                          onClick={() => handleSelectSearchResult(res, 'cdsco')}
                          style={{ padding: '8px 10px', background: 'var(--bgsoft)', borderRadius: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                          onMouseOver={(e) => e.currentTarget.style.background = 'var(--greenlt)'}
                          onMouseOut={(e) => e.currentTarget.style.background = 'var(--bgsoft)'}
                        >
                          <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {res.row['Drug Name']}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--textlt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              Indication: {res.row['Indication'] || 'Maintenance Therapy'}
                            </div>
                          </div>
                          <span style={{ fontSize: 9.5, padding: '2px 6px', background: 'var(--greenlt)', color: 'var(--green)', borderRadius: 4, fontWeight: 700, marginLeft: 8 }}>
                            Score: {res.score.toFixed(1)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {searchResults.ja.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--orange)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4, marginTop: 6 }}>
                      Jan Aushadhi Generic Alternatives:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {searchResults.ja.map((res, ridx) => (
                        <div
                          key={ridx}
                          onClick={() => handleSelectSearchResult(res, 'ja')}
                          style={{ padding: '8px 10px', background: 'var(--bgsoft)', borderRadius: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                          onMouseOver={(e) => e.currentTarget.style.background = 'var(--safflt)'}
                          onMouseOut={(e) => e.currentTarget.style.background = 'var(--bgsoft)'}
                        >
                          <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {res.row['Generic Name']}
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--textlt)' }}>
                              MRP: ₹{res.row['MRP']} ({res.row['Unit Size']})
                            </div>
                          </div>
                          <span style={{ fontSize: 9.5, padding: '2px 6px', background: 'var(--safflt)', color: 'var(--saffron)', borderRadius: 4, fontWeight: 700, marginLeft: 8 }}>
                            Score: {res.score.toFixed(1)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, animation: 'fadeUp 0.5s ease 0.4s both' }}>
        {[
          ['▦', 'CDSCO DB', '3,300+ tracked'],
          ['₹', 'Jan Aushadhi', 'Live mapping'],
          ['✦', 'AI Assistant', 'Instant insights'],
          ['🔒', 'Secure', 'Private scans']
        ].map(([icon, title, sub]) => (
          <div key={title} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1.5px solid var(--bgsoft)', borderRadius: 12, padding: '10px 12px', boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--bgsoft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{icon}</div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy)', lineHeight: 1.2 }}>{title}</div>
              <div style={{ fontSize: 10.5, color: 'var(--textlt)' }}>{sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="glass-surface settings-surface" style={{ 
        background: '#fff', 
        border: '1.5px solid var(--border)', 
        borderRadius: 16, 
        padding: '16px', 
        marginTop: '20px', 
        animation: 'fadeUp 0.5s ease 0.3s both',
        boxShadow: 'var(--shadow)'
      }}>
        <h3 style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--navy)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          ️ Settings & Device Security
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={wasmEnabled} onChange={e => setWasmEnabled(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--green)' }} />
              📸 Smart Camera Enhancer
            </label>
            <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'var(--greenlt)', color: 'var(--green)' }}>WASM (LOCAL)</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--textlt)', paddingLeft: 22, lineHeight: 1.45 }}>
            Applies local image cleanup to improve text contrast before recognition. Image enhancement runs in your browser.
          </div>
          {wasmEnabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 22, marginTop: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--textlt)', fontWeight: 600 }}>Filter Mode:</span>
              <select value={wasmFilter} onChange={e => setWasmFilter(parseInt(e.target.value))} style={{ fontSize: 11.5, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--navy)', background: '#fff', fontWeight: 600 }}>
                <option value={1}>Adaptive Binarization</option>
                <option value={2}>Sobel Edge Detection</option>
                <option value={3}>Contrast Stretching</option>
              </select>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={useAsyncQueue} onChange={e => setUseAsyncQueue(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--green)' }} />
               Fast Analysis Mode
            </label>
            <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'var(--safflt)', color: 'var(--saffron)' }}>ASYNC STREAM</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--textlt)', paddingLeft: 22, lineHeight: 1.45 }}>
            Runs analysis asynchronously to keep the interface responsive. Server-assisted analysis requires an internet connection.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={localOcrEnabled} onChange={e => setLocalOcrEnabled(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--green)' }} />
              🔎 Local OCR Engine (Offline)
            </label>
            <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'var(--greenlt)', color: 'var(--green)' }}>LOCAL OCR</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--textlt)', paddingLeft: 22, lineHeight: 1.45 }}>
            Recognizes medicine-pack text in your browser with Tesseract.js. Processing speed depends on your device.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Private Local Lock (PIN)
            </span>
            <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: vaultPin ? 'var(--greenlt)' : 'var(--bgsoft)', color: vaultPin ? 'var(--green)' : 'var(--textlt)' }}>
              {vaultPin ? 'SECURED (AES-256)' : 'UNLOCKED (PLAIN)'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--textlt)', paddingLeft: 22, lineHeight: 1.45 }}>
            Encrypts saved medicine history in this browser using PBKDF2 and AES-GCM. Keep your PIN secure; it cannot be recovered if lost.
          </div>

          <div style={{ paddingLeft: 22, display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {!vaultPin ? (
              <button onClick={() => setShowPinSetup(true)} style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, background: 'var(--greenlt)', color: 'var(--green)', fontWeight: 700 }}>
                🔑 Set up Lock PIN
              </button>
            ) : (
              <>
                <button onClick={() => { setIsVaultLocked(true); setBookmarks([]) }} style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, background: 'var(--bgsoft)', color: 'var(--navy)', fontWeight: 700 }}>
                  [Locked] Lock History Now
                </button>
                <button onClick={handleDisableEncryption} style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, background: 'var(--redlt)', color: 'var(--red)', fontWeight: 700 }}>
                  [Unlocked] Remove PIN Lock
                </button>
              </>
            )}
          </div>

          {showPinSetup && (
            <div style={{ margin: '8px 0 0 22px', padding: '10px', border: '1.5px solid var(--border)', borderRadius: 10, background: 'var(--bgsoft)', display: 'flex', flexDirection: 'column', gap: 6, animation: 'fadeIn 0.25s' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--navy)' }}>Create a 4-Digit Security PIN:</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="password" maxLength={4} pattern="\d*" value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g,''))} placeholder="1234" style={{ width: 80, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--bordermd)', fontSize: 12, textAlign: 'center', letterSpacing: '0.2em' }} />
                <button onClick={() => handleSetupPin(newPin)} style={{ fontSize: 11.5, padding: '6px 12px', borderRadius: 6, background: 'var(--green)', color: '#fff', fontWeight: 700 }}>Save</button>
                <button onClick={() => { setShowPinSetup(false); setNewPin(''); setPinError('') }} style={{ fontSize: 11.5, padding: '6px 12px', borderRadius: 6, background: '#fff', border: '1px solid var(--border)', color: 'var(--textlt)' }}>Cancel</button>
              </div>
              {pinError && <div style={{ fontSize: 10.5, color: 'var(--red)', fontWeight: 700 }}>{pinError}</div>}
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
          <button 
            type="button"
            onClick={() => setShowPrivacySchool(!showPrivacySchool)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--greenlt)',
              border: '1.5px solid rgba(13,138,104,0.15)',
              borderRadius: 10,
              padding: '10px 14px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 800,
              color: 'var(--greendk)'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>🏫 Privacy & Security School</span>
            <span>{showPrivacySchool ? '▲ Hide Guide' : '▼ Learn How It Works'}</span>
          </button>
          
          {showPrivacySchool && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12, animation: 'fadeIn 0.3s ease' }}>
              <style>{`
                .scene-container {
                  position: relative;
                  width: 140px;
                  height: 140px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background: radial-gradient(circle at center, rgba(13,138,104,0.08) 0%, transparent 70%);
                  border-radius: 16px;
                  overflow: hidden;
                  border: 1px solid rgba(13,138,104,0.06);
                }
                .svg-notebook-hover {
                  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .svg-notebook-hover:hover {
                  transform: translateY(-4px) scale(1.06);
                  filter: drop-shadow(0 12px 24px rgba(13,138,104,0.22));
                }
                .svg-safe-hover {
                  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .svg-safe-hover:hover {
                  transform: translateY(-4px) scale(1.04);
                  filter: drop-shadow(0 12px 24px rgba(0,0,0,0.25));
                }
                .svg-safe-hover:hover .svg-safe-dial {
                  transform: rotate(150deg);
                }
                .svg-magnifier-hover {
                  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .svg-magnifier-hover:hover {
                  transform: translateY(-4px);
                }
                .svg-magnifier-hover:hover .svg-lens-group {
                  transform: translate(-3px, -3px) scale(1.05);
                  transform-origin: 45px 45px;
                }
                .svg-laser-line {
                  animation: scanMove 2.5s ease-in-out infinite alternate;
                }
                @keyframes scanMove {
                  0% { transform: translateY(-22px); }
                  100% { transform: translateY(22px); }
                }
              `}</style>

              <div style={{ fontSize: 11.5, color: 'var(--greendk)', lineHeight: 1.5, background: 'var(--greenlt)', padding: 12, borderRadius: 8, fontWeight: 600 }}>
                 <strong>Local processing is available:</strong> With Local OCR enabled, medicine-photo text recognition and registry matching run in your browser. Other scan modes may send images to configured analysis services.
              </div>

              <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                {[
                  { id: 'diary', label: '📓 Local Diary', sub: 'Data Location' },
                  { id: 'vault', label: '🔑 Secret Vault', sub: 'PIN Encryption' },
                  { id: 'camera', label: ' Magnifying Glass', sub: 'On-Device Vision' }
                ].map(tab => {
                  const active = schoolTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSchoolTab(tab.id)}
                      style={{
                        flex: 1,
                        padding: '6px 4px',
                        borderRadius: 8,
                        fontSize: '11px',
                        fontWeight: 700,
                        border: active ? '1.5px solid var(--green)' : '1.5px solid var(--border)',
                        background: active ? 'var(--greenlt)' : '#fff',
                        color: active ? 'var(--greendk)' : 'var(--textmd)',
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all 0.15s',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 2
                      }}
                    >
                      <span style={{ fontSize: '11px' }}>{tab.label}</span>
                      <span style={{ fontSize: '9px', fontWeight: 500, opacity: 0.75 }}>{tab.sub}</span>
                    </button>
                  )
                })}
              </div>

              <div style={{ background: 'var(--bgsoft)', border: '1.5px solid var(--border)', borderRadius: 12, padding: 14 }}>
                {schoolTab === 'diary' && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
                      <div>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--red)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Note: THE RISK / THE DANGER</div>
                        <div style={{ fontSize: '12px', color: 'var(--navy)', fontWeight: 600, marginTop: 2, lineHeight: 1.4 }}>
                          Most health apps upload your scanned prescriptions, searches, and symptom history to remote cloud servers. If that database gets hacked or sold, some data broker now knows about your weird rash. No thanks.
                        </div>
                      </div>
                      
                      <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--green)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>📓 THE METAPHOR (HOW IT WORKS)</div>
                        <div style={{ fontSize: '12.5px', color: 'var(--navy)', fontWeight: 800, marginTop: 2 }}>The Private Notebook Under Your Pillow</div>
                        <p style={{ fontSize: '11.5px', color: 'var(--textmd)', marginTop: 4, marginBottom: 0, lineHeight: 1.55 }}>
                          Your saved cabinet and profile data are stored in this browser. Local OCR keeps medicine-photo recognition on-device; AI-assisted scan modes may use configured remote services.
                        </p>
                      </div>

                      <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--blue)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>🔧 THE CODE STUFF (NO CORPORATE JARGON)</div>
                        <div style={{ fontSize: '11.5px', color: 'var(--textmd)', marginTop: 4, lineHeight: 1.5 }}>
                          - <strong>Isolated Sandbox:</strong> We store your cabinet list inside the browser's local sandbox (IndexedDB and localStorage).<br />
                          - <strong>Local Registry Matching:</strong> Drug indexing runs in a separate background Web Worker in your browser.<br />
                          - <strong>Permanent Shredding:</strong> Because there is no database server, deleting your browser cache permanently shreds and deletes your records forever.
                        </div>
                      </div>

                      <div style={{ marginTop: 4, padding: '8px 10px', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--green)' }}>🟢 LIVE SECURITY AUDIT:</span>
                        <span style={{ fontSize: '11px', color: 'var(--navy)', fontWeight: 600 }}>
                          Local Database active. Saved scans: {bookmarks ? bookmarks.length : 0} | Cabinet items: {cabinet ? cabinet.length : 0}
                        </span>
                      </div>
                    </div>

                     <div style={{ flex: '0 0 140px', display: 'flex', justifyContent: 'center', margin: '0 auto' }}>
                      <div className="scene-container" style={{ background: 'radial-gradient(circle at center, rgba(13,138,104,0.08) 0%, transparent 70%)', border: '1px solid rgba(13,138,104,0.06)' }}>
                        <svg viewBox="0 0 100 100" width="90" height="90" className="svg-notebook-hover">
                          <rect x="25" y="15" width="50" height="70" rx="6" fill="url(#bookGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                          <path d="M29 15 v70" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" />
                          <path d="M30 15 v70" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
                          <rect x="23" y="15" width="6" height="70" rx="3" fill="#044e39" />
                          <rect x="71" y="18" width="4" height="64" rx="1" fill="#f8fafc" opacity="0.9" />
                          <path d="M48 15 v35 l4 -4 l4 4 v-35" fill="#ef4444" />
                          <circle cx="50" cy="50" r="6" fill="#fff" opacity="0.9" />
                          <path d="M47 50 h6 M50 47 v6" stroke="#0d8a68" strokeWidth="1.2" strokeLinecap="round" />
                          <defs>
                            <linearGradient id="bookGrad" x1="0" y1="0" x2="1" y2="1">
                              <stop offset="0%" stopColor="#0d8a68" />
                              <stop offset="100%" stopColor="#054f38" />
                            </linearGradient>
                          </defs>
                        </svg>
                      </div>
                    </div>
                  </div>
                )}

                {schoolTab === 'vault' && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
                      <div>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--red)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Note: THE RISK / THE DANGER</div>
                        <div style={{ fontSize: '12px', color: 'var(--navy)', fontWeight: 600, marginTop: 2, lineHeight: 1.4 }}>
                          If a nosy roommate, family member, or friend gets their hands on your unlocked phone, they can open this page and browse your entire pill stash and chronic symptoms. Awkward.
                        </div>
                      </div>
                      
                      <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--green)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>🔑 THE METAPHOR (HOW IT WORKS)</div>
                        <div style={{ fontSize: '12.5px', color: 'var(--navy)', fontWeight: 800, marginTop: 2 }}>The Secret Cipher Steel Safe</div>
                        <p style={{ fontSize: '11.5px', color: 'var(--textmd)', marginTop: 4, marginBottom: 0, lineHeight: 1.55 }}>
                          Setting a 4-digit PIN locks your cabinet in an unbreakable steel safe. i used native browser Crypto subtle APIs. it does the PBKDF2 key stretching inside the browser, which is why it might take a fraction of a second to lock/unlock. math takes cpu cycles to scramble the records into random noise.
                        </p>
                      </div>

                      <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--blue)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>🔧 THE CODE STUFF (NO CORPORATE JARGON)</div>
                        <div style={{ fontSize: '11.5px', color: 'var(--textmd)', marginTop: 4, lineHeight: 1.5 }}>
                          - <strong>PIN Stretching:</strong> We take your 4-digit PIN and stretch it 100,000 times using PBKDF2 to generate a strong 256-bit key.<br />
                          - <strong>AES-GCM Encryption:</strong> Scrambles data using standard browser Web Crypto parameters. It is cryptographically unreadable without the PIN.<br />
                          - <strong>Zero-Knowledge:</strong> The PIN is never stored. If you lose it, we cannot reset it. Write it on your arm or something.
                        </div>
                      </div>

                      <div style={{ marginTop: 4, padding: '8px 10px', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: vaultPin ? 'var(--green)' : 'var(--orange)' }}>
                          {vaultPin ? '🔒 VAULT ACTIVE:' : 'UNLOCKED:'}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--navy)', fontWeight: 600 }}>
                          {vaultPin ? 'Your history is encrypted on-device with AES-256.' : 'No PIN lock is set. History is stored in plain text.'}
                        </span>
                      </div>
                    </div>

                     <div style={{ flex: '0 0 140px', display: 'flex', justifyContent: 'center', margin: '0 auto' }}>
                      <div className="scene-container" style={{ background: 'radial-gradient(circle at center, rgba(148,163,184,0.08) 0%, transparent 70%)', border: '1px solid rgba(148,163,184,0.06)' }}>
                        <svg viewBox="0 0 100 100" width="90" height="90" className="svg-safe-hover">
                          <circle cx="50" cy="50" r="38" fill="url(#safeBodyGrad)" stroke="#475569" strokeWidth="1.5" />
                          <circle cx="50" cy="50" r="34" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.8" />
                          <g className="svg-safe-dial" style={{ transformOrigin: '50px 50px', transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                            <circle cx="50" cy="50" r="24" fill="url(#safeDialGrad)" stroke="#1e293b" strokeWidth="1.2" />
                            {Array.from({ length: 12 }).map((_, i) => {
                              const angle = (i * 30 * Math.PI) / 180;
                              const x1 = 50 + 17 * Math.cos(angle);
                              const y1 = 50 + 17 * Math.sin(angle);
                              const x2 = 50 + 20 * Math.cos(angle);
                              const y2 = 50 + 20 * Math.sin(angle);
                              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />;
                            })}
                            <circle cx="50" cy="50" r="10" fill="#0f172a" stroke="#94a3b8" strokeWidth="1" />
                            <line x1="50" y1="30" x2="50" y2="38" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
                          </g>
                          <defs>
                            <linearGradient id="safeBodyGrad" x1="0" y1="0" x2="1" y2="1">
                              <stop offset="0%" stopColor="#334155" />
                              <stop offset="100%" stopColor="#0f172a" />
                            </linearGradient>
                            <linearGradient id="safeDialGrad" x1="0" y1="0" x2="1" y2="1">
                              <stop offset="0%" stopColor="#64748b" />
                              <stop offset="100%" stopColor="#334155" />
                            </linearGradient>
                          </defs>
                        </svg>
                      </div>
                    </div>
                  </div>
                )}

                {schoolTab === 'camera' && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
                      <div>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--red)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Note: THE RISK / THE DANGER</div>
                        <div style={{ fontSize: '12px', color: 'var(--navy)', fontWeight: 600, marginTop: 2, lineHeight: 1.4 }}>
                          Most documents scanner apps ship your raw camera snapshots to cloud server farms for image cleanup, which exposes your active camera stream to remote servers. Creepy.
                        </div>
                      </div>
                      
                      <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--green)', letterSpacing: '0.04em', textTransform: 'uppercase' }}> THE METAPHOR (HOW IT WORKS)</div>
                        <div style={{ fontSize: '12.5px', color: 'var(--navy)', fontWeight: 800, marginTop: 2 }}>The Built-in Magnifying Glass</div>
                        <p style={{ fontSize: '11.5px', color: 'var(--textmd)', marginTop: 4, marginBottom: 0, lineHeight: 1.55 }}>
                          Instead of uploading frames, we load a virtual magnifying glass directly inside your browser tab. the WebAssembly module is compiled from about 200 lines of Rust to crop, binarize, and sharpen blurry medicine labels offline. i wanted it to be as lightweight as possible. the source code is open.
                        </p>
                      </div>

                      <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--blue)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>🔧 THE CODE STUFF (NO CORPORATE JARGON)</div>
                        <div style={{ fontSize: '11.5px', color: 'var(--textmd)', marginTop: 4, lineHeight: 1.5 }}>
                          - <strong>WebAssembly Enhancements:</strong> Image filters are compiled to a tiny 8KB WebAssembly binary loaded in the browser sandbox.<br />
                          - <strong>On-Device CV:</strong> We run adaptive thresholding and Sobel filters off the main thread so your screen never stutters.<br />
                          - <strong>Focus auto-trigger:</strong> Measures frame blur at 60fps and only snaps the photo when the label is actually sharp and readable.
                        </div>
                      </div>

                      <div style={{ marginTop: 4, padding: '8px 10px', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: wasmEnabled ? 'var(--green)' : 'var(--textlt)' }}>
                          {wasmEnabled ? '🟢 WASM ACTIVE:' : '⚪ WASM OFF:'}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--navy)', fontWeight: 600 }}>
                          {wasmEnabled ? 'Camera frames pre-processed locally in WebAssembly.' : 'WASM enhancer is disabled. Using raw capture fallback.'}
                        </span>
                      </div>
                    </div>

                     <div style={{ flex: '0 0 140px', display: 'flex', justifyContent: 'center', margin: '0 auto' }}>
                      <div className="scene-container" style={{ background: 'radial-gradient(circle at center, rgba(16,185,129,0.08) 0%, transparent 70%)', border: '1px solid rgba(16,185,129,0.06)' }}>
                        <svg viewBox="0 0 100 100" width="90" height="90" className="svg-magnifier-hover">
                          <rect x="15" y="15" width="70" height="70" rx="8" fill="#1e293b" opacity="0.15" />
                          <line x1="10" y1="50" x2="90" y2="50" stroke="#10b981" strokeWidth="1.2" opacity="0.5" className="svg-laser-line" />
                          <g className="svg-lens-group">
                            <path d="M60 60 l18 18" stroke="#475569" strokeWidth="4.5" strokeLinecap="round" />
                            <path d="M60 60 l18 18" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" />
                            <circle cx="45" cy="45" r="20" fill="url(#lensGrad)" stroke="#94a3b8" strokeWidth="2.2" />
                            <circle cx="45" cy="45" r="16" fill="none" stroke="rgba(16,185,129,0.25)" strokeWidth="0.8" />
                            <path d="M36 36 a10 10 0 0 1 10 0" fill="none" stroke="#fff" strokeWidth="1.2" opacity="0.4" strokeLinecap="round" />
                          </g>
                          <defs>
                            <radialGradient id="lensGrad" cx="50%" cy="50%" r="50%">
                              <stop offset="0%" stopColor="rgba(16,185,129,0.22)" />
                              <stop offset="70%" stopColor="rgba(16,185,129,0.05)" />
                              <stop offset="100%" stopColor="rgba(255,255,255,0.12)" />
                            </radialGradient>
                          </defs>
                        </svg>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {isVaultLocked ? (
        <div style={{ 
          marginTop: 24, 
          background: '#fff', 
          border: '1.5px solid var(--border)', 
          borderRadius: 16, 
          padding: '16px', 
          textAlign: 'center',
          boxShadow: 'var(--shadow)',
          animation: 'fadeUp 0.5s ease 0.35s both'
        }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🔒</div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>Saved Medicines Vault</h3>
          <p style={{ fontSize: 11.5, color: 'var(--textlt)', marginBottom: 12 }}>Your local scan history is encrypted. Enter your 4-digit PIN to unlock it.</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
            <input type="password" maxLength={4} pattern="\d*" value={pinInput} onChange={e => setPinInput(e.target.value.replace(/\D/g,''))} placeholder="••••" style={{ width: 80, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--bordermd)', fontSize: 13, textAlign: 'center', letterSpacing: '0.2em' }} />
            <button onClick={() => handleUnlockVault(pinInput)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, background: 'var(--green)', color: '#fff', fontWeight: 600 }}>Unlock</button>
          </div>
          {pinError && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8, fontWeight: 600 }}>{pinError}</div>}
          <div style={{ marginTop: 12 }}>
            <button onClick={handleResetVault} style={{ background: 'transparent', border: 'none', color: 'var(--textlt)', fontSize: 11, textDecoration: 'underline', cursor: 'pointer' }}>Note: Reset Corrupted Vault</button>
          </div>
        </div>
      ) : (
        bookmarks && bookmarks.length > 0 && (
          <div style={{ marginTop: 24, marginBottom: 12, animation: 'fadeUp 0.5s ease 0.35s both' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              Saved Medicines ({bookmarks.length}) {vaultPin && <span style={{ fontSize: 10.5, color: 'var(--textlt)', fontWeight: 400 }}>(Encrypted)</span>}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
              {bookmarks.map((b, idx) => {
                const isInCabinet = cabinet.some(item => item.brandName === b.brandName && item.saltComposition === b.saltComposition);
                return (
                  <div
                    key={idx}
                    onClick={() => handleSelectBookmark(b)}
                    style={{
                      background: '#fff',
                      border: isInCabinet ? '1.5px solid var(--green)' : '1.5px solid var(--border)',
                      borderRadius: 12,
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.01)',
                      transition: 'all 0.15s'
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = 'var(--green)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = isInCabinet ? 'var(--green)' : 'var(--border)';
                      e.currentTarget.style.transform = 'none';
                    }}
                  >
                    <div 
                      onClick={(e) => { e.stopPropagation(); toggleCabinetItem(b, e); }} 
                      title="Add/remove from interaction check cabinet"
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        width: 28, 
                        height: 28, 
                        borderRadius: 8, 
                        border: `1.5px solid ${isInCabinet ? 'var(--green)' : 'var(--bordermd)'}`, 
                        background: isInCabinet ? 'var(--green)' : '#fff',
                        color: isInCabinet ? '#fff' : 'transparent',
                        fontWeight: 900,
                        fontSize: 14,
                        cursor: 'pointer',
                        flexShrink: 0,
                        transition: 'all 0.2s'
                      }}
                    >
                      
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.brandName}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--textlt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.saltComposition}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteBookmark(e, b)}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: 'transparent',
                        color: 'var(--textlt)',
                        fontSize: 14,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'color 0.2s'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.color = 'var(--red)'}
                      onMouseOut={(e) => e.currentTarget.style.color = 'var(--textlt)'}
                    >
                      
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}

      {!isVaultLocked && (
        <div style={{ 
          marginTop: 20, 
          background: '#fff', 
          border: '1.5px solid var(--border)', 
          borderRadius: 16, 
          padding: '16px', 
          boxShadow: 'var(--shadow)',
          animation: 'fadeUp 0.5s ease 0.4s both'
        }}>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14, background: 'var(--navy)', color: '#fff', padding: '10px 14px', borderRadius: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>👤</span>
              <select 
                value={activeProfileId} 
                onChange={e => {
                  setActiveProfileId(e.target.value);
                  try { localStorage.setItem('medilens_active_profile_id', e.target.value); } catch(e){}
                }}
                style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, outline: 'none', cursor: 'pointer' }}
              >
                {profiles.map(p => <option key={p.id} value={p.id} style={{ color: 'var(--navy)' }}>{p.id === 'praveen' && p.name === 'Praveen Shivagonda' ? 'Demo Profile' : p.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setShowAddProfile(o => !o)} style={{ fontSize: 12, fontWeight: 700, padding: '4px 8px', background: 'rgba(255,255,255,0.15)', borderRadius: 6, color: '#fff' }}>
                {showAddProfile ? 'Cancel' : ' User'}
              </button>
              {profiles.length > 1 && (
                <button onClick={() => { if(confirm(`Delete profile for ${activeProfile.name}?`)) handleDeleteProfile(activeProfileId) }} style={{ fontSize: 12, fontWeight: 700, padding: '4px 8px', background: 'var(--red)', borderRadius: 6, color: '#fff' }}>
                  
                </button>
              )}
            </div>
          </div>

          {showAddProfile && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, padding: 12, background: 'var(--bgsoft)', borderRadius: 10, animation: 'fadeIn 0.25s' }}>
              <input 
                type="text" 
                value={profileInput} 
                onChange={e => setProfileInput(e.target.value)} 
                placeholder="Family member's name..." 
                style={{ flex: 1, height: 36, padding: '0 8px', borderRadius: 6, border: '1px solid var(--bordermd)', fontSize: 13 }}
              />
              <button onClick={() => handleAddProfile(profileInput)} style={{ padding: '0 12px', background: 'var(--green)', color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 700 }}>Add</button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
            <button className={`btn-tab ${activeTab === 'cabinet' ? 'active' : ''}`} onClick={() => setActiveTab('cabinet')}> Cabinet</button>
            <button className={`btn-tab ${activeTab === 'reminders' ? 'active' : ''}`} onClick={() => setActiveTab('reminders')}> Daily Schedule</button>
            <button className={`btn-tab ${activeTab === 'healthcard' ? 'active' : ''}`} onClick={() => setActiveTab('healthcard')}> Medical ID</button>
            <button className={`btn-tab ${activeTab === 'symptoms' ? 'active' : ''}`} onClick={() => setActiveTab('symptoms')}>Note: Track Symptoms</button>
          </div>

          {activeTab === 'cabinet' && (
            <div>
              <style>{`
                .cabinet-3d-container {
                  background: #fff;
                  border-radius: 16px;
                  padding: 20px;
                  box-shadow: var(--shadow);
                  display: flex;
                  flex-direction: column;
                  gap: 24px;
                  border: 1px solid var(--border);
                  margin-bottom: 24px;
                }
                .cabinet-shelf-3d {
                  position: relative;
                  height: auto;
                  min-height: 100px;
                  border-bottom: 1.5px solid var(--border);
                  display: flex;
                  align-items: center;
                  justify-content: space-around;
                  padding: 12px 0;
                }
                .cabinet-shelf-ledge {
                  position: absolute;
                  bottom: -1px;
                  left: 10%;
                  right: 10%;
                  height: 1px;
                  background: linear-gradient(to right, transparent, var(--border), transparent);
                }
                .med-box-hoverable {
                  width: 65px;
                  height: 85px;
                  border-radius: 10px;
                  background: #fff;
                  border: 1.5px solid var(--border);
                  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s;
                  cursor: pointer;
                  position: relative;
                  display: flex;
                  flex-direction: column;
                  justify-content: space-between;
                  padding: 6px;
                  box-sizing: border-box;
                  overflow: hidden;
                }
                .med-box-hoverable:hover {
                  transform: translateY(-6px) !important;
                  box-shadow: var(--shadowmd) !important;
                }
                .slot-empty-dotted {
                  width: 65px;
                  height: 85px;
                  border: 1.5px dashed var(--bordermd);
                  border-radius: 10px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  cursor: pointer;
                  transition: all 0.2s;
                  background: transparent;
                }
                .slot-empty-dotted:hover {
                  border-color: var(--green);
                  background: var(--greenlt);
                  transform: translateY(-4px);
                }
                .svg-capsule-pulse {
                  transition: transform 0.2s ease;
                }
                .svg-capsule-pulse:hover {
                  transform: scale(1.15) rotate(5deg);
                }
                @keyframes pulseBorder {
                  0%, 100% { border-color: #ef4444; box-shadow: 0 0 5px rgba(239,68,68,0.2); }
                  50% { border-color: #f87171; box-shadow: 0 0 12px rgba(239,68,68,0.5); }
                }
                .danger-overdose-banner {
                  animation: pulseBorder 1.5s infinite;
                }
              `}</style>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                <h4 style={{ fontSize: 16, fontWeight: 800, color: 'var(--navy)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                   {t.cabinetTitle || 'My Medicine Cabinet'}
                </h4>
                
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button 
                    onClick={() => setShowCabinet3D(!showCabinet3D)}
                    style={{ fontSize: 11.5, fontWeight: 700, padding: '6px 12px', background: showCabinet3D ? 'var(--navy)' : 'var(--bgsoft)', color: showCabinet3D ? '#fff' : 'var(--navy)', border: '1.5px solid var(--border)', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    {showCabinet3D ? ' Switch to List View' : '🖥️ Switch to 3D Shelves'}
                  </button>
                  <button 
                    onClick={() => setShowManualAddModal(true)}
                    style={{ fontSize: 11.5, fontWeight: 700, padding: '6px 12px', background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', boxShadow: '0 4px 10px rgba(13,138,104,0.15)' }}
                  >
                     Add Custom Medicine
                  </button>
                </div>
              </div>

              <div style={{ position: 'relative', marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={cabinetAddQuery}
                    onChange={(e) => handleCabinetAddSearch(e.target.value)}
                    placeholder=" Search CDSCO/Jan Aushadhi database to add immediately..."
                    style={{ flex: 1, height: 42, padding: '0 12px', borderRadius: 10, border: '1.5px solid var(--bordermd)', fontSize: 13, color: 'var(--navy)', background: '#fff', outline: 'none' }}
                  />
                  {cabinetAddQuery && (
                    <button 
                      onClick={() => handleCabinetAddSearch('')} 
                      style={{ padding: '0 12px', background: 'var(--bgsoft)', color: 'var(--textmd)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 12, cursor: 'pointer' }}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {cabinetAddQuery && (
                  <div style={{ position: 'absolute', top: '46px', left: 0, right: 0, background: '#fff', border: '1.5px solid var(--border)', borderRadius: 12, maxHeight: 220, overflowY: 'auto', padding: 8, boxShadow: '0 10px 25px rgba(0,0,0,0.08)', zIndex: 10 }}>
                    {isCabinetAddSearching ? (
                      <div style={{ fontSize: 12, color: 'var(--textlt)', padding: '12px 0', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--border)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                        Querying database indexes...
                      </div>
                    ) : (!cabinetAddResults || (cabinetAddResults.cdsco.length === 0 && cabinetAddResults.ja.length === 0)) ? (
                      <div style={{ fontSize: 12, color: 'var(--textlt)', padding: '12px 0', textAlign: 'center' }}>
                        No exact match. Click "Add Custom Medicine" to enter details manually.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {cabinetAddResults.cdsco.length > 0 && (
                          <div>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--navy)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 4px', borderBottom: '1px solid var(--border)', marginBottom: 4, textAlign: 'left' }}>
                              CDSCO Approved Salts
                            </div>
                            {cabinetAddResults.cdsco.slice(0, 3).map((res, rid) => (
                              <div key={rid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: 'var(--bgsoft)', borderRadius: 8, marginBottom: 4 }}>
                                <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{res.row['Drug Name']}</div>
                                  <div style={{ fontSize: 10, color: 'var(--textlt)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>Composition: {res.row['Drug Name']} | Indication: {res.row['Indication'] || 'Maintenance'}</div>
                                </div>
                                <button 
                                  onClick={() => handleQuickAdd(res.row['Drug Name'], res.row['Drug Name'])} 
                                  style={{ fontSize: 11, fontWeight: 800, background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
                                >
                                   Add
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {cabinetAddResults.ja.length > 0 && (
                          <div>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--orange)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 4px', borderBottom: '1px solid var(--border)', marginBottom: 4, marginTop: 4, textAlign: 'left' }}>
                              Jan Aushadhi Generics
                            </div>
                            {cabinetAddResults.ja.slice(0, 3).map((res, rid) => (
                              <div key={rid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: 'var(--safflt)', borderRadius: 8, marginBottom: 4 }}>
                                <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{res.row['Generic Name']}</div>
                                  <div style={{ fontSize: 10.5, color: 'var(--textlt)' }}>Govt Generic | MRP: ₹{res.row['MRP']} ({res.row['Unit Size']})</div>
                                </div>
                                <button 
                                  onClick={() => handleQuickAdd(res.row['Generic Name'], res.row['Generic Name'])} 
                                  style={{ fontSize: 11, fontWeight: 800, background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
                                >
                                   Add
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {cabinet.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {showCabinet3D ? (
                    <div className="cabinet-3d-container">
                      <div className="cabinet-shelf-3d">
                        <div className="cabinet-shelf-ledge"></div>
                        <div className="slot-empty-dotted" onClick={() => setShowManualAddModal(true)}>
                          <span style={{ fontSize: 24, color: '#10b981' }}></span>
                        </div>
                        <div className="slot-empty-dotted" onClick={() => setShowManualAddModal(true)}>
                          <span style={{ fontSize: 24, color: '#10b981' }}></span>
                        </div>
                        <div className="slot-empty-dotted" onClick={() => setShowManualAddModal(true)}>
                          <span style={{ fontSize: 24, color: '#10b981' }}></span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <p style={{ fontSize: 13, color: 'var(--textlt)', margin: 0, lineHeight: 1.6, textAlign: 'left' }}>
                    Your cabinet is empty. Search for a medicine such as Crocin or Calpol above, or add an item manually to get started.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 20, flexDirection: 'row', flexWrap: 'wrap', width: '100%', alignItems: 'flex-start' }}>

                  <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    
                    {showCabinet3D ? (
                      /* 3D Shelves View */
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--textlt)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8, textAlign: 'left' }}>
                          🖥️ Virtual Cabinet Shelves
                        </div>
                        
                        <div className="cabinet-3d-container">
                          {(() => {
                            const itemsPerShelf = 3;
                            const numShelves = Math.max(1, Math.ceil(cabinet.length / itemsPerShelf));
                            const shelvesRows = [];
                            for (let i = 0; i < numShelves; i++) {
                              shelvesRows.push(cabinet.slice(i * itemsPerShelf, (i + 1) * itemsPerShelf));
                            }
                            
                            return shelvesRows.map((shelfItems, sIdx) => (
                              <div key={sIdx} className="cabinet-shelf-3d">
                                <div className="cabinet-shelf-ledge"></div>
                                {shelfItems.map((item, idx) => {
                                  const realIdx = sIdx * itemsPerShelf + idx;
                                  const maxPills = 30;
                                  const stockPct = Math.min(100, Math.max(0, ((item.pillCount || 0) / maxPills) * 100));
                                  const isLowStock = (item.pillCount || 0) <= 5;
                                  const isExpired = item.expiryDate && new Date(item.expiryDate) < new Date();
                                  const isSelected = selectedCabinetIndex === realIdx;
                                  
                                  const saltLower = (item.saltComposition || '').toLowerCase();
                                  const isAntibiotic = saltLower.includes('amoxicillin') || saltLower.includes('penicillin') || saltLower.includes('cef') || saltLower.includes('cipro');
                                  const isPainKiller = saltLower.includes('paracetamol') || saltLower.includes('ibuprofen') || saltLower.includes('diclofenac') || saltLower.includes('naproxen');
                                  const isAyurvedic = item.productType === 'AYURVEDIC';
                                  const isSupplement = item.productType === 'SUPPLEMENT';
                                  let boxColor = '#6366f1';
                                  if (isAyurvedic || isSupplement) {
                                    boxColor = '#10b981';
                                  } else if (isAntibiotic) {
                                    boxColor = '#ef4444';
                                  } else if (isPainKiller) {
                                    boxColor = '#f59e0b';
                                  }

                                  return (
                                    <div 
                                      key={idx} 
                                      onClick={() => setSelectedCabinetIndex(realIdx)}
                                      className="med-box-hoverable"
                                      style={{
                                        transform: isSelected ? 'translateY(-6px)' : 'translateY(0)',
                                        boxShadow: isSelected ? 'var(--shadowmd)' : 'var(--shadow)',
                                        border: isSelected ? '1.5px solid var(--green)' : '1.5px solid var(--border)',
                                        borderTop: `4px solid ${boxColor}`
                                      }}
                                      title={`${item.brandName} - ${item.saltComposition} (${item.pillCount} pills)`}
                                    >
                                      
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                                        <span style={{ fontSize: '11px' }}>
                                          {isAyurvedic || isSupplement ? '' : isAntibiotic ? '' : isPainKiller ? '' : ''}
                                        </span>
                                        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                          {isLowStock && <span style={{ fontSize: '9px' }}>Note:</span>}
                                          {isExpired && <span style={{ fontSize: '7px', background: 'var(--red)', color: '#fff', padding: '1px 3px', borderRadius: 3, fontWeight: 800 }}>EXP</span>}
                                        </div>
                                      </div>
                                      
                                      <div style={{ textAlign: 'left', overflow: 'hidden', width: '100%', marginTop: 4 }}>
                                        <div style={{ fontSize: '9.5px', fontWeight: 800, color: 'var(--navy)', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                          {item.brandName}
                                        </div>
                                        <div style={{ fontSize: '7px', color: 'var(--textlt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                                          {item.saltComposition}
                                        </div>
                                      </div>

                                      <div style={{ height: '3px', background: 'var(--bgsoft)', borderRadius: '2px', overflow: 'hidden', marginTop: '4px', width: '100%' }}>
                                        <div style={{ height: '100%', width: `${stockPct}%`, background: isLowStock ? 'var(--red)' : 'var(--green)' }} />
                                      </div>
                                    </div>
                                  );
                                })}

                                {shelfItems.length < itemsPerShelf && Array.from({ length: itemsPerShelf - shelfItems.length }).map((_, emptyIdx) => (
                                  <div key={`empty-${emptyIdx}`} className="slot-empty-dotted" onClick={() => setShowManualAddModal(true)}>
                                    <span style={{ fontSize: '20px', color: '#475569' }}>＋</span>
                                  </div>
                                ))}
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    ) : (
                      /* Flat List View */
                      <>
                        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--textlt)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4, textAlign: 'left' }}>
                          Cabinet Inventory List ({cabinet.length})
                        </div>
                        {cabinet.map((item, idx) => {
                          const maxPills = 30;
                          const stockPct = Math.min(100, Math.max(0, ((item.pillCount || 0) / maxPills) * 100));
                          const isLowStock = (item.pillCount || 0) <= 5;
                          const barColor = isLowStock ? 'var(--red)' : 'var(--green)';
                          const isSelected = selectedCabinetIndex === idx;

                          return (
                            <div 
                              key={idx} 
                              onClick={() => setSelectedCabinetIndex(idx)}
                              style={{ 
                                display: 'flex', 
                                flexDirection: 'column', 
                                gap: 8, 
                                padding: '14px 16px', 
                                background: isSelected ? 'rgba(13,138,104,0.04)' : 'var(--bgcard)', 
                                border: isSelected ? '2px solid var(--green)' : '1.5px solid var(--border)', 
                                borderRadius: 16,
                                boxShadow: isSelected ? '0 4px 12px rgba(13,138,104,0.1)' : 'var(--shadow)',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                position: 'relative'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                                  <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.brandName}</span>
                                    {isSelected && <span style={{ fontSize: 9, background: 'var(--green)', color: '#fff', padding: '1px 5px', borderRadius: 10, fontWeight: 800, flexShrink: 0 }}>ACTIVE</span>}
                                  </div>
                                  <div style={{ fontSize: 11.5, color: 'var(--textlt)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.saltComposition}</div>
                                </div>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleCabinetItem(item, e);
                                  }} 
                                  style={{ 
                                    width: 24, 
                                    height: 24, 
                                    borderRadius: '50%', 
                                    background: 'var(--redlt)', 
                                    color: 'var(--red)', 
                                    fontWeight: 800, 
                                    fontSize: 13, 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'center',
                                    border: 'none',
                                    cursor: 'pointer',
                                    flexShrink: 0
                                  }}
                                >
                                  ×
                                </button>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: 11.5, color: 'var(--textmd)', fontWeight: 700 }}>
                                     Stock Level: {item.pillCount || 0} / {maxPills} pills
                                  </span>
                                  {isLowStock && (
                                    <span style={{ fontSize: 10, color: 'var(--red)', fontWeight: 800, animation: 'pulse 1.5s infinite' }}>
                                      Note: Low Stock
                                    </span>
                                  )}
                                </div>
                                <div className="stock-bar-container" style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                                  <div className="stock-bar-fill" style={{ height: '100%', width: `${stockPct}%`, backgroundColor: barColor, transition: 'width 0.3s' }}></div>
                                </div>
                              </div>

                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, borderTop: '1px dashed var(--border)', paddingTop: 10, marginTop: 4 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUpdatePillCount(item, -1);
                                    }} 
                                    title="Take 1 pill"
                                    style={{ 
                                      width: 28, 
                                      height: 28, 
                                      background: '#fff', 
                                      border: '1.5px solid var(--border)', 
                                      borderRadius: '50%', 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      justifyContent: 'center', 
                                      fontSize: 15, 
                                      fontWeight: 800, 
                                      cursor: 'pointer',
                                      boxShadow: 'var(--shadow)' 
                                    }}
                                  >
                                    -
                                  </button>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUpdatePillCount(item, 30);
                                    }} 
                                    style={{ 
                                      padding: '0 10px', 
                                      height: 28, 
                                      background: 'var(--bgsoft)', 
                                      border: '1.5px solid var(--border)', 
                                      borderRadius: 14, 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      justifyContent: 'center', 
                                      fontSize: 11, 
                                      fontWeight: 700, 
                                      color: 'var(--navy)',
                                      cursor: 'pointer',
                                      boxShadow: 'var(--shadow)' 
                                    }}
                                  >
                                    +30 pills
                                  </button>
                                </div>

                                <label style={{ fontSize: 11.5, color: 'var(--textmd)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 700 }} onClick={e => e.stopPropagation()}>
                                  <input 
                                    type="checkbox" 
                                    checked={!!item.notificationsEnabled} 
                                    onChange={() => handleToggleNotification(item)}
                                    style={{ accentColor: 'var(--green)', width: 14, height: 14 }} 
                                  />
                                  Reminders On
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}

                    {cabinet.length >= 2 && (
                      <div style={{ borderTop: '1.5px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {activeInteractions.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left' }}>
                              Note: Dangerous Combinations Found:
                            </div>
                            {activeInteractions.map((col, idx) => (
                              <div key={idx} style={{ 
                                padding: '12px 14px', 
                                background: 'var(--redlt)', 
                                border: '1.5px solid #FECACA', 
                                borderLeft: '5px solid var(--red)',
                                borderRadius: 14,
                                boxShadow: 'var(--shadow)',
                                textAlign: 'left'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--red)' }}>{col.title}</span>
                                  <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 8px', borderRadius: 6, background: 'var(--red)', color: '#fff' }}>{col.severity}</span>
                                </div>
                                <div style={{ fontSize: 11.5, color: '#991B1B', fontWeight: 700, marginBottom: 6 }}>Clash: {col.saltA} + {col.saltB}</div>
                                <p style={{ fontSize: 12.5, color: '#7F1D1D', margin: 0, lineHeight: 1.5 }}>{col.explanation}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {activeDuplications.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--saffron)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left' }}>
                              Note: Double Dosing Warning:
                            </div>
                            {activeDuplications.map((dup, idx) => (
                              <div key={idx} style={{ 
                                padding: '12px 14px', 
                                background: 'var(--safflt)', 
                                border: '1.5px solid #FCD34D', 
                                borderLeft: '5px solid var(--saffron)',
                                borderRadius: 14,
                                boxShadow: 'var(--shadow)',
                                textAlign: 'left'
                              }}>
                                <div style={{ fontSize: 13, fontWeight: 800, color: '#92400E', marginBottom: 4 }}>
                                  {dup.title} ({dup.className})
                                </div>
                                <p style={{ fontSize: 12.5, color: '#78350F', margin: 0, lineHeight: 1.5 }}>{dup.explanation}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {activeInteractions.length === 0 && activeDuplications.length === 0 && (
                          <div style={{ 
                            padding: '12px 14px', 
                            background: 'var(--greenlt)', 
                            border: '1.5px solid #86EFAC', 
                            borderRadius: 14, 
                            fontSize: 13, 
                            color: 'var(--greendk)', 
                            fontWeight: 700, 
                            textAlign: 'center',
                            boxShadow: 'var(--shadow)'
                          }}>
                            [Verified] Safe: No drug clashes or overlaps found in your cabinet.
                          </div>
                        )}
                        <InteractionGraphVisualizer cabinet={cabinet} />
                      </div>
                    )}
                  </div>

                  {selectedMed && (() => {
                    const pkParams = getPKParameters(selectedMed.saltComposition || selectedMed.brandName);
                    
                    const saltLower = (selectedMed.saltComposition || '').toLowerCase();
                    const isAntibiotic = saltLower.includes('amoxicillin') || saltLower.includes('penicillin') || saltLower.includes('cef') || saltLower.includes('cipro');
                    const isPainKiller = saltLower.includes('paracetamol') || saltLower.includes('ibuprofen') || saltLower.includes('diclofenac') || saltLower.includes('naproxen');
                    const isAyurvedic = selectedMed.productType === 'AYURVEDIC';
                    const isSupplement = selectedMed.productType === 'SUPPLEMENT';
                    let capTopColor = '#f59e0b';
                    let capBottomColor = '#f8fafc';
                    if (isAyurvedic || isSupplement) {
                      capTopColor = '#10b981';
                    } else if (isAntibiotic) {
                      capTopColor = '#ef4444';
                      capBottomColor = '#3b82f6';
                    } else if (isPainKiller) {
                      capTopColor = '#ef4444';
                    }

                    const parsedDose = (() => {
                      const m = (selectedMed.saltComposition || '').match(/(\d+)\s*(mg|mcg|g)/i);
                      return m ? parseInt(m[1]) : 500;
                    })();

                    const cabDoseTimes = cabDoseFreq === 1 ? [0] 
                                    : cabDoseFreq === 2 ? [0, 12] 
                                    : cabDoseFreq === 3 ? [0, 8, 16] 
                                    : [0, 6, 12, 18];
                    const cabPkData = pkParams ? simulatePharmacokinetics(
                      pkParams, 
                      cabDoseStrength, 
                      cabDoseTimes, 
                      activeProfile.weight || 70, 
                      activeProfile.height || 170, 
                      activeProfile.age || 30, 
                      activeProfile.gender || 'male', 
                      24
                    ) : [];
                    
                    const maxConc = pkParams ? Math.max(0.01, ...cabPkData.map(d => d.conc), pkParams.minToxicConc * 1.2) : 10;
                    const currentPoint = cabPkData.find(d => d.time === cabScrubTime) || cabPkData[0] || { time: 0, conc: 0 };
                    const currentConc = currentPoint.conc;

                    const isExpired = selectedMed.expiryDate && new Date(selectedMed.expiryDate) < new Date();
                    const isExpiringSoon = selectedMed.expiryDate && !isExpired && (new Date(selectedMed.expiryDate) - new Date()) < (30 * 24 * 60 * 60 * 1000);

                    const ad = activeProfile.adherence || {};
                    let totalDoseSlotsLogged = 0;
                    let totalDaysWithLogs = 0;
                    Object.entries(ad).forEach(([dateStr, slotObj]) => {
                      const slots = Object.values(slotObj);
                      if (slots.some(v => v === true)) {
                        totalDaysWithLogs++;
                        totalDoseSlotsLogged += slots.filter(v => v === true).length;
                      }
                    });
                    const compliancePct = totalDaysWithLogs > 0 ? Math.min(100, Math.round((totalDoseSlotsLogged / (totalDaysWithLogs * 3)) * 100)) : 100;

                    const getX = (t) => 35 + (t / 24) * 290;
                    const getY = (c) => 15 + (1 - (c / maxConc)) * 140;

                    const pathD = cabPkData.length > 0 ? cabPkData.map((d, idx) => {
                      return `${idx === 0 ? 'M' : 'L'} ${getX(d.time)} ${getY(d.conc)}`;
                    }).join(' ') : '';
                    const areaD = pathD ? `${pathD} L ${getX(24)} ${getY(0)} L ${getX(0)} ${getY(0)} Z` : '';

                    const safetyResult = checkDosageSafety(
                      selectedMed.saltComposition || selectedMed.brandName,
                      cabDoseStrength,
                      cabDoseFreq,
                      activeProfile.weight || 70,
                      activeProfile.height || 170,
                      activeProfile.age || 30,
                      activeProfile.gender || 'male'
                    );

                    return (
                      <div style={{ 
                        flex: '2 2 400px', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: 16, 
                        background: '#fff', 
                        border: '1.5px solid var(--border)', 
                        borderRadius: 18, 
                        padding: 20, 
                        boxShadow: 'var(--shadow)',
                        animation: 'fadeUp 0.3s ease'
                      }}>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                          <div style={{ textAlign: 'left' }}>
                            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--green)', background: 'var(--greenlt)', padding: '2px 8px', borderRadius: 8, letterSpacing: '0.04em' }}> SMART CABINET HUB</span>
                            <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--navy)', margin: '4px 0 2px' }}>{selectedMed.brandName}</h3>
                            <div style={{ fontSize: 12.5, color: 'var(--textmd)', fontWeight: 600 }}>{selectedMed.saltComposition}</div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg viewBox="0 0 40 40" width="36" height="36" className="svg-capsule-pulse" style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.1))', cursor: 'pointer' }} title="Active composition indicator">
                              <g transform="rotate(45 20 20)">
                                
                                <path d="M14 20 A6 6 0 0 1 26 20 h-12" fill={capTopColor} stroke="rgba(0,0,0,0.1)" strokeWidth="0.5" />
                                
                                <path d="M14 20 A6 6 0 0 0 26 20 h-12" fill={capBottomColor} stroke="rgba(0,0,0,0.1)" strokeWidth="0.5" />
                                
                                <line x1="14" y1="20" x2="26" y2="20" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                              </g>
                            </svg>
                          </div>
                        </div>

                        <div style={{ background: 'var(--bgsoft)', borderRadius: 14, padding: 14, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--navy)', textAlign: 'left' }}> Batch & Expiry Tracker</span>
                          
                          {isExpired && (
                            <div style={{ padding: '8px 10px', background: 'var(--redlt)', border: '1px solid #FCA5A5', color: 'var(--red)', borderRadius: 8, fontSize: 11.5, fontWeight: 700, textAlign: 'left' }}>
                              Error: EXPIRED! Please dispose of this medication safely. Do not consume.
                            </div>
                          )}
                          {isExpiringSoon && (
                            <div style={{ padding: '8px 10px', background: 'var(--safflt)', border: '1px solid #FCD34D', color: '#92400E', borderRadius: 8, fontSize: 11.5, fontWeight: 700, textAlign: 'left' }}>
                              Note: EXPIRING SOON: This medicine expires in less than 30 days!
                            </div>
                          )}

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left' }}>
                              <label style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--textlt)' }}>BATCH NO.</label>
                              <input 
                                type="text" 
                                value={selectedMed.batchNumber || ''} 
                                onChange={e => handleUpdateCabinetItem(selectedMed, { batchNumber: e.target.value })}
                                placeholder="e.g. B2502"
                                style={{ height: 32, padding: '0 8px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 12, outline: 'none', background: '#fff' }}
                              />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left' }}>
                              <label style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--textlt)' }}>MFG. DATE</label>
                              <input 
                                type="date" 
                                value={selectedMed.mfgDate || ''} 
                                onChange={e => handleUpdateCabinetItem(selectedMed, { mfgDate: e.target.value })}
                                style={{ height: 32, padding: '0 6px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 11, outline: 'none', background: '#fff' }}
                              />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left' }}>
                              <label style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--textlt)' }}>EXP. DATE</label>
                              <input 
                                type="date" 
                                value={selectedMed.expiryDate || ''} 
                                onChange={e => handleUpdateCabinetItem(selectedMed, { expiryDate: e.target.value })}
                                style={{ height: 32, padding: '0 6px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 11, outline: 'none', background: '#fff' }}
                              />
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 14, padding: '12px 14px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ textAlign: 'left' }}>
                              <div style={{ fontSize: 12, color: '#1e40af', fontWeight: 800 }}> Medication Adherence Rate</div>
                              <div style={{ fontSize: 18, color: '#1e3a8a', fontWeight: 900, marginTop: 2 }}>{compliancePct}% compliance</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 11, color: '#1e40af', fontWeight: 800 }}> Stock Level</div>
                              <div id="cabinet-stock-level" style={{ fontSize: 16, color: '#1e3a8a', fontWeight: 900, marginTop: 2 }}>Stock Level: {selectedMed.pillCount || 0} / 30 pills</div>
                            </div>
                          </div>
                          <button 
                            onClick={async () => {
                              const currentCount = selectedMed.pillCount || 0;
                              if (currentCount <= 0) {
                                alert("No pills left in stock! Please add pills before logging intake.");
                                return;
                              }
                              const nextCount = Math.max(0, currentCount - 1);
                              const dateStr = new Date().toDateString();
                              const now = new Date();
                              const hours = now.getHours();
                              let slot = 'Morning';
                              if (hours >= 12 && hours < 16) slot = 'Afternoon';
                              else if (hours >= 16 && hours < 21) slot = 'Evening';
                              else if (hours >= 21 || hours < 6) slot = 'Bedtime';

                              const nextHistory = [
                                {
                                  medName: selectedMed.brandName,
                                  saltName: selectedMed.saltComposition,
                                  timestamp: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
                                  date: dateStr,
                                  slot: slot
                                },
                                ...(activeProfile.doseHistory || [])
                              ].slice(0, 50);

                              const updated = profiles.map(p => {
                                if (p.id === activeProfileId) {
                                  const nextCab = (p.cabinet || []).map(item => {
                                    if (item.brandName === selectedMed.brandName && item.saltComposition === selectedMed.saltComposition) {
                                      return { ...item, pillCount: nextCount };
                                    }
                                    return item;
                                  });
                                  const ad = p.adherence || {};
                                  const todayAd = ad[dateStr] || { Morning: false, Afternoon: false, Evening: false, Bedtime: false };
                                  const nextTodayAd = { ...todayAd, [slot]: true };
                                  return { 
                                    ...p, 
                                    cabinet: nextCab, 
                                    adherence: { ...ad, [dateStr]: nextTodayAd },
                                    doseHistory: nextHistory
                                  };
                                }
                                return p;
                              });
                              await saveAllProfiles(updated);
                            }}
                            style={{ 
                              padding: '10px 16px', 
                              background: '#2563eb', 
                              color: '#fff', 
                              borderRadius: 10, 
                              fontSize: 12.5, 
                              fontWeight: 800, 
                              border: 'none',
                              cursor: 'pointer',
                              boxShadow: '0 4px 10px rgba(37,99,235,0.2)'
                            }}
                          >
                             Log Dose Taken
                          </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--navy)' }}>⚖️ Daily Safety Check</span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: safetyResult.safe ? '#166534' : '#991b1b', background: safetyResult.safe ? '#dcfce7' : '#fef2f2', padding: '1px 8px', borderRadius: 10 }}>
                              {safetyResult.safe ? 'SAFE LIMIT' : 'LIMIT EXCEEDED'}
                            </span>
                          </div>
                          
                          {!safetyResult.safe ? (
                            <div className="danger-overdose-banner" style={{ background: '#fef2f2', border: '2px solid #ef4444', borderRadius: 14, padding: '12px 14px', textAlign: 'left' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                <span style={{ fontSize: 16 }}>Note:</span>
                                <span style={{ fontSize: 13, fontWeight: 800, color: '#991b1b' }}>DANGEROUS OVERDOSE WARNING</span>
                              </div>
                              <p style={{ fontSize: 12.5, color: '#b91c1c', margin: 0, lineHeight: 1.4, fontWeight: 600, textAlign: 'left' }}>
                                {safetyResult.reason}
                              </p>
                            </div>
                          ) : (
                            <div style={{ background: 'var(--greenlt)', border: '1px solid #a7d9ca', borderRadius: 14, padding: '10px 12px', fontSize: 12, color: 'var(--greendk)', fontWeight: 700, textAlign: 'left' }}>
                              [Verified] {safetyResult.reason}
                            </div>
                          )}
                        </div>

                        {pkParams && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--navy)' }}>🩸 Active Bloodstream Simulation</span>
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#166534', background: '#dcfce7', padding: '1px 8px', borderRadius: 10 }}>ADAPTIVE PK</span>
                            </div>
                            
                            <div style={{ background: 'var(--bgsoft)', borderRadius: 14, padding: 8, border: '1px solid var(--border)', display: 'flex', justifyContent: 'center' }}>
                              <svg width="100%" height="150" viewBox="0 0 340 150" style={{ maxWidth: 340 }}>
                                <defs>
                                  <linearGradient id="cab-curve-grad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#0D8A68" stopOpacity="0.25" />
                                    <stop offset="100%" stopColor="#0D8A68" stopOpacity="0.0" />
                                  </linearGradient>
                                </defs>

                                {[0, 6, 12, 18, 24].map(t => (
                                  <g key={t}>
                                    <line x1={getX(t)} y1="15" x2={getX(t)} y2="125" stroke="rgba(0,0,0,0.05)" strokeWidth="1" />
                                    <text x={getX(t)} y="140" fontSize="9" fill="var(--textlt)" textAnchor="middle">{t}h</text>
                                  </g>
                                ))}

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

                                <line x1="35" y1={getY(pkParams.minEffectiveConc)} x2="325" y2={getY(pkParams.minEffectiveConc)} stroke="var(--amber)" strokeWidth="1" strokeDasharray="3,3" />
                                
                                {areaD && <path d={areaD} fill="url(#cab-curve-grad)" />}
                                {pathD && <path d={pathD} fill="none" stroke="#0d8a68" strokeWidth="2.5" />}

                                <line x1={getX(cabScrubTime)} y1="15" x2={getX(cabScrubTime)} y2="125" stroke="#3b82f6" strokeWidth="1" strokeDasharray="2,2" />
                                <circle cx={getX(cabScrubTime)} cy={getY(currentConc)} r="4" fill="#3b82f6" stroke="#fff" strokeWidth="1" />

                                <line x1="35" y1="15" x2="35" y2="125" stroke="var(--border)" strokeWidth="1.2" />
                                <line x1="35" y1="125" x2="325" y2="125" stroke="var(--border)" strokeWidth="1.2" />
                              </svg>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: '#1e293b', padding: 12, borderRadius: 12 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '11px', fontWeight: 800, color: '#94a3b8' }}>🕒 SCRUB TIMELINE: {cabScrubTime.toFixed(1)}h</span>
                                <span style={{ fontSize: '11px', fontWeight: 900, color: currentConc > pkParams.minToxicConc ? '#ef4444' : currentConc > pkParams.minEffectiveConc ? '#10b981' : '#f59e0b' }}>
                                  {currentConc < 1.0 ? currentConc.toFixed(3) : currentConc.toFixed(1)} mcg/mL
                                </span>
                              </div>
                              <input 
                                type="range" 
                                min="0" 
                                max="24" 
                                step="0.25" 
                                value={cabScrubTime} 
                                onChange={e => setCabScrubTime(parseFloat(e.target.value))} 
                                style={{ width: '100%', accentColor: '#10b981', cursor: 'pointer' }} 
                              />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, background: 'var(--bgsoft)', padding: 10, borderRadius: 12, border: '1px solid var(--border)' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left' }}>
                                <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--navy)' }}>Strength:</label>
                                <select 
                                  value={cabDoseStrength}
                                  onChange={e => setCabDoseStrength(parseInt(e.target.value))}
                                  style={{ height: 26, fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid var(--border)', background: '#fff', color: 'var(--navy)' }}
                                >
                                  {[Math.round(parsedDose / 2), parsedDose, parsedDose * 2].filter(v => v > 0).map(v => (
                                    <option key={v} value={v}>{v}mg</option>
                                  ))}
                                </select>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left' }}>
                                <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--navy)' }}>Frequency:</label>
                                <select 
                                  value={cabDoseFreq}
                                  onChange={e => setCabDoseFreq(parseInt(e.target.value))}
                                  style={{ height: 26, fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid var(--border)', background: '#fff', color: 'var(--navy)' }}
                                >
                                  <option value="1">Once a day</option>
                                  <option value="2">2x a day</option>
                                  <option value="3">3x a day</option>
                                  <option value="4">4x a day</option>
                                </select>
                              </div>
                            </div>

                            <div style={{ background: '#f8fafc', border: '1.5px solid var(--border)', borderRadius: 12, padding: '10px 12px', textAlign: 'left' }}>
                              <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--navy)', marginBottom: 4 }}> Scientific Dosing Parameters:</div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', fontSize: 11, color: 'var(--textmd)' }}>
                                <div>• <strong>Half-life:</strong> {pkParams.halfLifeElimination} hrs (Ke: {(Math.log(2)/pkParams.halfLifeElimination).toFixed(2)})</div>
                                <div>• <strong>Volume of Distr. (Vd):</strong> {pkParams.vd} L/kg</div>
                                <div>• <strong>Bioavailability (F):</strong> {Math.round(pkParams.bioavailability * 100)}%</div>
                                <div>• <strong>Active Composition:</strong> {pkParams.partition === 'lipophilic' ? 'Lipophilic (Fat solubility)' : 'Hydrophilic (Water solubility)'}</div>
                              </div>
                            </div>

                          </div>
                        )}

                        <div style={{ borderTop: '1.5px dashed var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--navy)' }}>🏛 Jan Aushadhi generic equivalents</span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)', background: 'var(--greenlt)', padding: '1px 8px', borderRadius: 8 }}>SAVINGS FINDER</span>
                          </div>

                          {isCabinetSearching ? (
                            <div style={{ fontSize: 12, color: 'var(--textlt)', fontStyle: 'italic', padding: '6px 0', textAlign: 'left' }}> Searching local CDSCO & BPPI databases...</div>
                          ) : cabinetSearchResults && cabinetSearchResults.ja && cabinetSearchResults.ja.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {cabinetSearchResults.ja.slice(0, 2).map((jaMed, jIdx) => {
                                return (
                                  <div key={jIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--greenlt)', border: '1px solid #a7d9ca', borderRadius: 10, padding: '8px 12px' }}>
                                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{jaMed.row['Generic Name']}</div>
                                      <div style={{ fontSize: 10.5, color: '#166534', marginTop: 1 }}>Govt Price: ₹{jaMed.row['MRP']} ({jaMed.row['Unit Size']})</div>
                                    </div>
                                    <a 
                                      href={JA_STORE_URL}
                                      onClick={openJanAushadhiStore}
                                      target="_blank" 
                                      rel="noopener noreferrer" 
                                      style={{ fontSize: 11, fontWeight: 800, background: 'var(--green)', color: '#fff', textDecoration: 'none', padding: '4px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4 }}
                                    >
                                       Store
                                    </a>
                                  </div>
                                );
                              })}
                              
                              <div style={{ fontSize: 11, color: 'var(--textmd)', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 10px', lineHeight: 1.4, textAlign: 'left' }}>
                                 Tip: You can legally substitute {selectedMed.brandName} with these government-approved generics. Find nearest Kendra store link above.
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: 'var(--textlt)', fontStyle: 'italic', textAlign: 'left' }}>
                              No generic alternatives found in the offline Jan Aushadhi catalog. Please ask your local pharmacist for equivalent options.
                            </div>
                          )}
                        </div>

                      </div>
                    );
                  })()}

                </div>
              )}

              <div style={{ marginTop: 24, borderTop: '1.5px solid var(--border)', paddingTop: 16 }}>
                <h4 style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--navy)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}>
                  ⏳ Recent Intake Logs ({activeProfile.doseHistory ? activeProfile.doseHistory.length : 0})
                </h4>
                
                {!activeProfile.doseHistory || activeProfile.doseHistory.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--textlt)', margin: 0, fontStyle: 'italic', textAlign: 'left' }}>
                    No intake logs recorded yet. Tap "Log Dose Taken" inside a cabinet medicine card to record.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 160, overflowY: 'auto', paddingRight: 4 }}>
                    {activeProfile.doseHistory.map((log, lIdx) => (
                      <div key={lIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bgsoft)', border: '1.5px solid var(--border)', borderRadius: 12, padding: '10px 14px' }}>
                        <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--navy)' }}>
                            Logged 1 dose of {log.medName}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--textlt)', marginTop: 1 }}>
                            Slot: {log.slot} | {log.date} at {log.timestamp}
                          </div>
                        </div>
                        <button 
                          onClick={() => handleUndoDose(log, lIdx)}
                          style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', background: 'var(--redlt)', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}
                        >
                          Undo
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {showManualAddModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
                  <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 20, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', padding: 20, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                      <h4 style={{ fontSize: 16, fontWeight: 800, color: 'var(--navy)', margin: 0 }}> Add Custom Medicine</h4>
                      <button onClick={() => setShowManualAddModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--textlt)' }}>×</button>
                    </div>
                    
                    <form onSubmit={handleManualAddSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--textlt)' }}>MEDICINE BRAND NAME *</label>
                        <input id="cabinet-brand-name" type="text" value={manualAddForm.brandName} onChange={e => setManualAddForm({...manualAddForm, brandName: e.target.value})} placeholder="e.g. Crocin, Lipitor" style={{ height: 38, padding: '0 10px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13 }} required />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--textlt)' }}>ACTIVE SALT COMPOSITION *</label>
                        <input id="cabinet-salt-composition" type="text" value={manualAddForm.saltComposition} onChange={e => setManualAddForm({...manualAddForm, saltComposition: e.target.value})} placeholder="e.g. Paracetamol, Atorvastatin" style={{ height: 38, padding: '0 10px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13 }} required />
                      </div>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--textlt)' }}>STRENGTH VALUE</label>
                          <input id="cabinet-strength-value" type="number" value={manualAddForm.strength} onChange={e => setManualAddForm({...manualAddForm, strength: parseInt(e.target.value) || 0})} style={{ height: 36, padding: '0 10px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13 }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--textlt)' }}>UNIT</label>
                          <select id="cabinet-strength-unit" value={manualAddForm.strengthUnit} onChange={e => setManualAddForm({...manualAddForm, strengthUnit: e.target.value})} style={{ height: 36, padding: '0 8px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, background: '#fff' }}>
                            <option value="mg">mg</option>
                            <option value="mcg">mcg</option>
                            <option value="g">g</option>
                            <option value="ml">ml</option>
                          </select>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--textlt)' }}>FORM</label>
                          <select id="cabinet-form" value={manualAddForm.form} onChange={e => setManualAddForm({...manualAddForm, form: e.target.value})} style={{ height: 36, padding: '0 8px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, background: '#fff' }}>
                            <option value="Tablet">Tablet</option>
                            <option value="Capsule">Capsule</option>
                            <option value="Syrup">Syrup</option>
                            <option value="Drops">Drops</option>
                            <option value="Cream">Cream</option>
                            <option value="Injection">Injection</option>
                            <option value="Inhaler">Inhaler</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--textlt)' }}>INITIAL PILL COUNT</label>
                          <input id="cabinet-pill-count" type="number" value={manualAddForm.pillCount} onChange={e => setManualAddForm({...manualAddForm, pillCount: parseInt(e.target.value) || 0})} style={{ height: 36, padding: '0 10px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13 }} />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--textlt)' }}>MFG. DATE</label>
                          <input id="cabinet-mfg-date" type="date" value={manualAddForm.mfgDate} onChange={e => setManualAddForm({...manualAddForm, mfgDate: e.target.value})} style={{ height: 36, padding: '0 6px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 12 }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--textlt)' }}>EXP. DATE</label>
                          <input id="cabinet-expiry-date" type="date" value={manualAddForm.expiryDate} onChange={e => setManualAddForm({...manualAddForm, expiryDate: e.target.value})} style={{ height: 36, padding: '0 6px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 12 }} />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--textlt)' }}>BATCH NUMBER</label>
                          <input id="cabinet-batch-number" type="text" value={manualAddForm.batchNumber} onChange={e => setManualAddForm({...manualAddForm, batchNumber: e.target.value})} placeholder="e.g. B2502" style={{ height: 36, padding: '0 10px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13 }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--textlt)' }}>INTAKE RELATION</label>
                          <select id="cabinet-food-relation" value={manualAddForm.foodRelation} onChange={e => setManualAddForm({...manualAddForm, foodRelation: e.target.value})} style={{ height: 36, padding: '0 8px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, background: '#fff' }}>
                            <option value="Before food">Before food</option>
                            <option value="With food">With food</option>
                            <option value="After food">After food</option>
                            <option value="With or without food">With or without food</option>
                          </select>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--textlt)' }}>DAILY SLOT</label>
                          <select id="cabinet-ideal-time" value={manualAddForm.idealTime} onChange={e => setManualAddForm({...manualAddForm, idealTime: e.target.value})} style={{ height: 36, padding: '0 8px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, background: '#fff' }}>
                            <option value="Morning">Morning</option>
                            <option value="Afternoon">Afternoon</option>
                            <option value="Evening">Evening</option>
                            <option value="Bedtime">Bedtime</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--textlt)' }}>DAILY FREQ</label>
                          <select id="cabinet-frequency" value={manualAddForm.frequency} onChange={e => setManualAddForm({...manualAddForm, frequency: parseInt(e.target.value) || 1})} style={{ height: 36, padding: '0 8px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, background: '#fff' }}>
                            <option value="1">1x a day</option>
                            <option value="2">2x a day</option>
                            <option value="3">3x a day</option>
                            <option value="4">4x a day</option>
                          </select>
                        </div>
                      </div>

                      <button type="submit" style={{ height: 44, background: 'linear-gradient(135deg, var(--green), #0d9488)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 8, boxShadow: '0 4px 12px rgba(13,138,104,0.2)' }}>
                        Save Medicine to Cabinet
                      </button>
                    </form>
                  </div>
                </div>
              )}

            </div>
          )}

          {activeTab === 'reminders' && (
            <div>
              
              <h4 style={{ fontSize: 15, fontWeight: 800, color: 'var(--navy)', marginBottom: 12 }}> Set Daily Pill Times</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                {Object.entries(activeProfile.reminderTimes || { Morning: '08:00', Afternoon: '13:00', Evening: '18:00', Bedtime: '22:00' }).map(([slot, time]) => {
                  let slotLabel = slot;
                  let slotIcon = '🌅';
                  if (slot === 'Morning') { slotLabel = 'Morning'; slotIcon = '🌅'; }
                  if (slot === 'Afternoon') { slotLabel = 'Afternoon'; slotIcon = '☀️'; }
                  if (slot === 'Evening') { slotLabel = 'Evening'; slotIcon = '🌇'; }
                  if (slot === 'Bedtime') { slotLabel = 'Bedtime'; slotIcon = '🌙'; }

                  return (
                    <div key={slot} style={{ 
                      display: 'flex', 
                      flexDirection: 'column', 
                      gap: 4, 
                      background: 'var(--bgcard)', 
                      border: '1.5px solid var(--border)',
                      padding: '10px 12px', 
                      borderRadius: 14,
                      boxShadow: 'var(--shadow)'
                    }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--textlt)' }}>{slotIcon} {slotLabel}</span>
                      <input 
                        type="time" 
                        value={time} 
                        onChange={(e) => handleUpdateReminderTime(slot, e.target.value)} 
                        style={{ 
                          fontSize: 13, 
                          padding: '6px 8px', 
                          border: '1.5px solid var(--border)', 
                          borderRadius: 8, 
                          background: '#fff', 
                          width: '100%', 
                          outline: 'none',
                          color: 'var(--navy)',
                          fontWeight: 600
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              <div style={{ 
                padding: 16, 
                marginBottom: 24, 
                background: '#fff', 
                border: '2.5px solid var(--charcoal)', 
                borderRadius: 12, 
                boxShadow: 'var(--shadow)',
                boxSizing: 'border-box'
              }}>
                <h5 style={{ fontSize: 13, fontWeight: 800, color: 'var(--charcoal)', margin: '0 0 12px 0', fontFamily: 'var(--font-mono)' }}> ADHERENCE HEATMAP (LAST 30 DAYS)</h5>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 6, justifyContent: 'center', marginBottom: 12 }}>
                  {Array.from({ length: 30 }).map((_, i) => {
                    const d = new Date();
                    d.setDate(d.getDate() - (29 - i));
                    const dayKey = d.toDateString();
                    const dayAd = (activeProfile.adherence || {})[dayKey] || {};
                    const count = Object.values(dayAd).filter(Boolean).length;
                    
                    let bg = '#e2e8f0';
                    if (count === 1) bg = '#dcfce7';
                    if (count === 2) bg = '#bbf7d0';
                    if (count === 3) bg = '#4ade80';
                    if (count >= 4) bg = '#22c55e';

                    const formattedDate = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

                    return (
                      <div
                        key={i}
                        title={`${formattedDate}: ${count} dose(s) taken`}
                        style={{
                          aspectRatio: '1',
                          background: bg,
                          border: '1.5px solid var(--charcoal)',
                          borderRadius: 4,
                          position: 'relative',
                          cursor: 'pointer'
                        }}
                      />
                    );
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--textmd)', fontFamily: 'var(--font-mono)' }}>
                  <span>29 days ago</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>Missed</span>
                    <div style={{ width: 10, height: 10, background: '#e2e8f0', border: '1px solid var(--charcoal)', borderRadius: 2 }} />
                    <div style={{ width: 10, height: 10, background: '#22c55e', border: '1px solid var(--charcoal)', borderRadius: 2 }} />
                    <span>All Doses</span>
                  </div>
                  <span>Today</span>
                </div>
              </div>

              <h4 style={{ fontSize: 15, fontWeight: 800, color: 'var(--navy)', marginBottom: 12 }}>[Verified] Check Off Taken Pills</h4>
              {(() => {
                const dateStr = new Date().toDateString();
                const ad = activeProfile.adherence || {};
                const todayAd = ad[dateStr] || { Morning: false, Afternoon: false, Evening: false, Bedtime: false };

                const activeSlots = ['Morning', 'Afternoon', 'Evening', 'Bedtime'];
                const completedAll = activeSlots.every(slot => !!todayAd[slot]);

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--greenlt)', border: '1.5px solid #86EFAC', padding: 14, borderRadius: 16, marginBottom: 16, boxShadow: 'var(--shadow)' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--greendk)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Did you take your medicine today?</span>
                      <span style={{ opacity: 0.8 }}>{new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    </div>

                    {completedAll ? (
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        gap: 8, 
                        background: '#fff', 
                        border: '1.5px solid var(--green)', 
                        padding: '10px 14px', 
                        borderRadius: 12, 
                        color: 'var(--greendk)', 
                        fontWeight: 800, 
                        fontSize: 13,
                        textAlign: 'center',
                        animation: 'popIn 0.3s ease'
                      }}>
                        <span>🎉</span> All done for today! Great job taking your meds.
                      </div>
                    ) : null}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                      {activeSlots.map(slot => {
                        const isChecked = !!todayAd[slot];
                        let slotIcon = '🌅';
                        if (slot === 'Afternoon') slotIcon = '☀️';
                        if (slot === 'Evening') slotIcon = '🌇';
                        if (slot === 'Bedtime') slotIcon = '🌙';

                        return (
                          <button 
                            key={slot}
                            onClick={() => handleToggleAdherence(dateStr, slot)}
                            style={{
                              padding: '10px 4px',
                              borderRadius: 12,
                              border: `1.5px solid ${isChecked ? 'var(--green)' : 'var(--border)'}`,
                              background: isChecked ? 'var(--green)' : '#fff',
                              color: isChecked ? '#fff' : 'var(--textmd)',
                              fontSize: 11.5,
                              fontWeight: 700,
                              textAlign: 'center',
                              transition: 'all 0.2s',
                              cursor: 'pointer',
                              boxShadow: 'var(--shadow)',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 2
                            }}
                          >
                            <span style={{ fontSize: 16 }}>{slotIcon}</span>
                            <span>{isChecked ? '' : ''} {slot}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {activeSchedule && activeSchedule.schedule && (
                <div style={{ borderTop: '1.5px solid var(--border)', paddingTop: 16 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--navy)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                     Your Pill Schedule for Today:
                  </div>
                  
                  {activeSchedule.notes && activeSchedule.notes.map((note, nidx) => (
                    <div key={nidx} style={{ 
                      padding: '10px 14px', 
                      background: 'var(--safflt)', 
                      border: '1px solid #FCD34D', 
                      borderRadius: 12, 
                      fontSize: 12.5, 
                      color: '#92400E', 
                      marginBottom: 12, 
                      fontWeight: 700, 
                      lineHeight: 1.5,
                      boxShadow: 'var(--shadow)'
                    }}>
                       {note.message}
                    </div>
                  ))}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'relative', paddingLeft: 16 }}>
                    <div style={{ position: 'absolute', left: 4, top: 8, bottom: 8, width: 3, background: 'linear-gradient(180deg, var(--green) 0%, var(--saffron) 50%, var(--navy) 100%)', borderRadius: 2 }} />
                    
                    {Object.entries(activeSchedule.schedule).map(([timeOfDay, meds]) => {
                      let icon = '🌅';
                      let bulletColor = 'var(--green)';
                      if (timeOfDay === 'Morning') { icon = '🌅 Morning'; bulletColor = 'var(--green)'; }
                      if (timeOfDay === 'Afternoon') { icon = '☀️ Afternoon'; bulletColor = 'var(--saffron)'; }
                      if (timeOfDay === 'Evening') { icon = '🌇 Evening'; bulletColor = 'var(--saffron)'; }
                      if (timeOfDay === 'Bedtime') { icon = '🌙 Bedtime'; bulletColor = 'var(--navy)'; }

                      return (
                        <div key={timeOfDay} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ 
                            position: 'absolute', 
                            left: -20, 
                            top: 4, 
                            width: 11, 
                            height: 11, 
                            borderRadius: '50%', 
                            background: bulletColor, 
                            border: '2.5px solid #fff', 
                            boxShadow: '0 0 0 1.5px ' + bulletColor 
                          }} />
                          
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--navy)' }}>{icon}</span>
                            <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 6, background: 'var(--bgsoft)', color: 'var(--textmd)' }}>
                              {meds.length} {meds.length === 1 ? 'med' : 'meds'}
                            </span>
                          </div>

                          {meds.length === 0 ? (
                            <div style={{ fontSize: 12, color: 'var(--textlt)', paddingLeft: 4, fontStyle: 'italic' }}>
                              No medicines scheduled.
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 4 }}>
                              {meds.map((med, midx) => {
                                let friendlyFood = med.foodRelation;
                                if (med.foodRelation.includes('Empty')) friendlyFood = '🍽️ Take on empty stomach';
                                if (med.foodRelation.includes('After')) friendlyFood = '🍲 Take after eating';

                                return (
                                  <div key={midx} style={{ 
                                    padding: '10px 12px', 
                                    background: 'var(--bgcard)', 
                                    border: '1.5px solid var(--border)', 
                                    borderRadius: 12,
                                    boxShadow: 'var(--shadow)'
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--navy)' }}>{med.brandName}</span>
                                      <span style={{ fontSize: 10, fontWeight: 800, color: med.foodRelation.includes('Empty') ? 'var(--red)' : 'var(--green)', background: med.foodRelation.includes('Empty') ? 'var(--redlt)' : 'var(--greenlt)', padding: '2px 8px', borderRadius: 6 }}>
                                        {friendlyFood}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 11.5, color: 'var(--textlt)', marginTop: 2 }}>{med.saltComposition}</div>
                                    <div style={{ fontSize: 12, color: 'var(--textmd)', marginTop: 6, borderTop: '1px dashed var(--border)', paddingTop: 6, fontStyle: 'italic', lineHeight: 1.45 }}>
                                       {med.rationale}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'healthcard' && (
            <HealthCard profile={activeProfile} onSaveProfile={handleSaveHealthCard} />
          )}

          {activeTab === 'symptoms' && (
            <div>
              <h4 style={{ fontSize: 15, fontWeight: 800, color: 'var(--navy)', marginBottom: 10 }}>Note: Track How You Feel (Side Effects)</h4>

              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input 
                  type="text" 
                  value={symptomInput} 
                  onChange={e => setSymptomInput(e.target.value)} 
                  placeholder="e.g. Headache, feeling dizzy, stomach pain..." 
                  style={{ 
                    flex: 1, 
                    height: 44, 
                    padding: '0 12px', 
                    borderRadius: 10, 
                    border: '1.5px solid var(--border)', 
                    fontSize: 13.5,
                    outline: 'none',
                    color: 'var(--navy)'
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--green)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                  onKeyDown={e => { if (e.key === 'Enter') handleLogSymptom(symptomInput) }}
                />
                <button 
                  onClick={() => handleLogSymptom(symptomInput)} 
                  style={{ 
                    padding: '0 16px', 
                    background: 'var(--green)', 
                    color: '#fff', 
                    borderRadius: 10, 
                    fontSize: 13.5, 
                    fontWeight: 700, 
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow)' 
                  }}
                >
                   Add
                </button>
              </div>

              {(() => {
                const cabSalts = cabinet.map(c => c.saltComposition);
                const symTexts = (activeProfile.symptoms || []).map(s => s.text);
                const warnings = flagPotentialSideEffects(cabSalts, symTexts);

                if (warnings.length > 0) {
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                         Warnings: A pill you take might be causing this!
                      </div>
                      {warnings.map((w, idx) => (
                        <div key={idx} style={{ 
                          padding: '12px 14px', 
                          background: 'var(--redlt)', 
                          border: '1.5px solid #FECACA', 
                          borderLeft: '5px solid var(--red)',
                          borderRadius: 14, 
                          fontSize: 13, 
                          color: '#991B1B', 
                          fontWeight: 600, 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: 4,
                          boxShadow: 'var(--shadow)'
                        }}>
                          <div>{w.explanation}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--textmd)', fontStyle: 'italic', marginTop: 4, borderTop: '1px dashed rgba(225,29,72,0.15)', paddingTop: 4 }}>
                             Your medicine with <strong>{w.salt}</strong> can cause <strong>{w.symptom}</strong>. We recommend talking to your doctor or pharmacist.
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                }
                return null;
              })()}

              <h5 style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--navy)', marginBottom: 8 }}> My Logged Symptoms</h5>
              {(!activeProfile.symptoms || activeProfile.symptoms.length === 0) ? (
                <p style={{ fontSize: 12.5, color: 'var(--textlt)', margin: 0, fontStyle: 'italic', lineHeight: 1.5 }}>
                  No symptoms logged. Type how you are feeling above to check if any of your medicines are causing it.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflowY: 'auto' }}>
                  {activeProfile.symptoms.map((s, sidx) => (
                    <div key={sidx} style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', 
                      background: 'var(--bgsoft)', 
                      padding: '8px 12px', 
                      borderRadius: 10, 
                      fontSize: 13,
                      boxShadow: 'var(--shadow)'
                    }}>
                      <div>
                        <span style={{ fontWeight: 700, color: 'var(--navy)' }}>{s.text}</span>
                        <span style={{ fontSize: 10.5, color: 'var(--textlt)', marginLeft: 8 }}>({s.date})</span>
                      </div>
                      <button onClick={() => handleDeleteSymptom(sidx)} style={{ color: 'var(--red)', fontSize: 14, fontWeight: 700, border: 'none', background: 'transparent', cursor: 'pointer' }}></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ textAlign: 'center', padding: '16px 0 4px', display: 'flex', justifyContent: 'center', gap: 20 }}>
        <button id="footer-privacy-link" onClick={() => setPage('privacy')} style={{ fontSize: 11.5, color: 'var(--textlt)', fontWeight: 500 }}>
          {t.privacyTitle || 'Privacy Policy'}
        </button>
        <button id="footer-terms-link" onClick={() => setPage('terms')} style={{ fontSize: 11.5, color: 'var(--textlt)', fontWeight: 500 }}>
          {t.termsTitle || 'Terms of Service'}
        </button>
      </div>
    </div>
  )
}

function LoadingView({ t, step, preview, processedPreview, barcodeHit, activeStepId, completedStepIds }) {
  const steps = [
    { id: 'started', label: 'Initializing Scan Engine', tag: 'System' },
    { id: 'vision', label: 'Reading Label (Llama Vision OCR)', tag: 'Vision' },
    { id: 'db', label: 'CDSCO Approval & Jan Aushadhi DB matches', tag: 'Registry' },
    { id: 'scraping', label: 'Live e-Pharmacy price comparison', tag: 'Scraper' },
    { id: 'summary', label: 'Compiling Patient Warning profiles', tag: 'AI Summary' }
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', animation: 'fadeIn 0.3s ease' }}>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        {preview && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--textlt)', textTransform: 'uppercase', marginBottom: 4 }}>Original</span>
            <div style={{ width: 68, height: 68, borderRadius: 10, overflow: 'hidden', border: '1.5px solid var(--border)', boxShadow: 'var(--shadow)' }}>
              <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          </div>
        )}
        
        {processedPreview && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', animation: 'popIn 0.35s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', marginBottom: 4 }}>WASM Filtered</span>
            <div style={{ width: 68, height: 68, borderRadius: 10, overflow: 'hidden', border: '2px solid var(--green)', boxShadow: '0 4px 10px rgba(15,122,90,0.15)' }}>
              <img src={processedPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          </div>
        )}
      </div>

      <div style={{ width: 52, height: 52, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--green)', animation: 'spin 0.9s linear infinite', marginBottom: 18 }} />
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>{t.analysing || 'Analyzing...'}</div>
      <div style={{ fontSize: 13, color: 'var(--textlt)', marginBottom: 28 }}>{t.checkingThree || 'Checking three sources at once'}</div>
      
      <div style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {steps.map((s, i) => {
          const isDone = completedStepIds.includes(s.id);
          const isActive = activeStepId === s.id;
          
          return (
            <div key={s.id} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 12, 
              padding: '11px 14px', 
              background: isDone ? 'var(--greenlt)' : (isActive ? 'var(--safflt)' : 'var(--bgcard)'), 
              border: `1.5px solid ${isDone ? '#A7D9CA' : (isActive ? 'var(--saffron)' : 'var(--border)')}`, 
              borderRadius: 11, 
              opacity: (isDone || isActive) ? 1 : 0.5,
              transition: 'all 0.3s ease' 
            }}>
              <div style={{ 
                width: 24, 
                height: 24, 
                borderRadius: '50%', 
                background: isDone ? 'var(--green)' : (isActive ? 'var(--saffron)' : 'var(--bgsoft)'), 
                border: `1.5px solid ${isDone ? 'var(--green)' : (isActive ? 'var(--saffron)' : 'var(--bordermd)')}`, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                fontSize: 12, 
                color: (isDone || isActive) ? '#fff' : 'var(--textlt)', 
                fontWeight: 700, 
                flexShrink: 0
              }}>{isDone ? '' : i+1}</div>
              
              <span style={{ 
                fontSize: 13, 
                color: isDone ? 'var(--greendk)' : (isActive ? 'var(--navy)' : 'var(--textmd)'), 
                flex: 1, 
                fontWeight: (isDone || isActive) ? 600 : 400 
              }}>{s.label}</span>
              
              <span style={{ 
                fontSize: 9.5, 
                fontWeight: 700, 
                padding: '2px 7px', 
                borderRadius: 4, 
                background: isDone ? 'rgba(15,122,90,0.15)' : (isActive ? 'rgba(232,119,34,0.15)' : 'var(--bgsoft)'), 
                color: isDone ? 'var(--green)' : (isActive ? 'var(--saffron)' : 'var(--textlt)'), 
                letterSpacing: '0.04em' 
              }}>{s.tag}</span>
            </div>
          );
        })}
      </div>
    </div>
  )
}

function ErrorView({ error, onReset, t }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
      <div style={{ background: 'var(--redlt)', border: '1.5px solid #FECACA', borderRadius: 16, padding: '24px 20px', textAlign: 'center', width: '100%', maxWidth: 360 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>Note:</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--red)', marginBottom: 8 }}>{t.scanFailed || 'Scan failed'}</div>
        <p style={{ fontSize: 13, color: '#7F1D1D', lineHeight: 1.6, marginBottom: 20 }}>{error}</p>
        <button onClick={onReset} style={{ background: 'var(--red)', color: '#fff', padding: '12px 28px', borderRadius: 10, fontSize: 14, fontWeight: 600 }}>{t.tryAgain || 'Try Again'}</button>
      </div>
    </div>
  )
}
