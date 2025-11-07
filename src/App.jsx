import React, { useState, useRef, useEffect } from 'react';
import ColorBends from './components/ColorBends';
import { Camera, Square, Download, Plus, Activity, AlertCircle, ChevronDown, Play } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// ADD AFTER IMPORTS:
const perfMonitor = {
  humeCallTimes: [],
  geminiCallTimes: [],

  trackHume(duration) {
    this.humeCallTimes.push(duration);
    if (this.humeCallTimes.length > 50) this.humeCallTimes.shift();
  },

  trackGemini(duration) {
    this.geminiCallTimes.push(duration);
  },

  getAverageHumeTime() {
    if (this.humeCallTimes.length === 0) return 0;
    return (this.humeCallTimes.reduce((a, b) => a + b, 0) / this.humeCallTimes.length).toFixed(0);
  }
};

// Optimized REST-only setup
const HUME_API_KEYS = [
  import.meta.env.VITE_HUME_API_KEY_1,
  import.meta.env.VITE_HUME_API_KEY_2,
  import.meta.env.VITE_HUME_API_KEY_3,
  import.meta.env.VITE_HUME_API_KEY_4,
  import.meta.env.VITE_HUME_API_KEY_5,
  import.meta.env.VITE_HUME_API_KEY_6,
  import.meta.env.VITE_HUME_API_KEY_7,
  import.meta.env.VITE_HUME_API_KEY_8,
  import.meta.env.VITE_HUME_API_KEY_9,
  import.meta.env.VITE_HUME_API_KEY_10,
].filter(key => key);

const GEMINI_API_KEYS = [
  import.meta.env.VITE_GEMINI_API_KEY_1,
  import.meta.env.VITE_GEMINI_API_KEY_2,
  import.meta.env.VITE_GEMINI_API_KEY_3,
].filter(key => key);

// ADD THIS:
const getNextGeminiKey = () => {
  const key = GEMINI_API_KEYS[currentGeminiKeyIndex];
  currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
  return key;
};

let currentHumeKeyIndex = 0;
let currentGeminiKeyIndex = 0;
let globalCallCount = 0; // Development tracking

let lastRotationTime = 0;
const ROTATION_COOLDOWN = 1000; // 1 second cooldown between rotations

// Memory-safe session management
const MAX_SESSION_POINTS = 800; // ~20 minutes at 1.5s intervals



const canRotateKey = () => {
  const now = Date.now();
  if (now - lastRotationTime < ROTATION_COOLDOWN) {
    return false;
  }
  lastRotationTime = now;
  return true;
};



// WebSocket-based emotion analysis (browser-compatible)
const analyzeWithWebSocket = (frameData) => {
  return new Promise((resolve) => {
    const key = HUME_API_KEYS[currentHumeKeyIndex];
    const startTime = Date.now();

    // Create WebSocket connection with API key in URL
    const ws = new WebSocket(`wss://api.hume.ai/v0/stream/models?apikey=${key}`);

    let hasResponse = false;
    let connectionTimeout;

    ws.onopen = () => {
      console.log('✅ WebSocket connected to Hume AI');

      // Send configuration and frame data
      ws.send(JSON.stringify({
        models: {
          face: {}
        },
        raw_text: false,
        data: frameData
      }));

      // Set timeout for response
      connectionTimeout = setTimeout(() => {
        if (!hasResponse) {
          console.warn('⏱️ WebSocket timeout - no response after 5s');
          ws.close();
          resolve(null);
        }
      }, 5000);
    };

    ws.onmessage = (event) => {
      if (hasResponse) return; // Only process first response
      hasResponse = true;
      clearTimeout(connectionTimeout);

      try {
        const data = JSON.parse(event.data);
        perfMonitor.trackHume(Date.now() - startTime);

        console.log('🔍 Hume WebSocket Response:', data);

        // ✅ CHECK FOR RATE LIMIT, QUOTA, OR CREDIT EXHAUSTION ERRORS
        const isRateLimited =
          data?.error?.includes('rate limit') ||
          data?.error?.includes('quota') ||
          data?.error?.includes('out of credits') ||
          data?.error?.includes('credit limit') ||
          data?.code === 'rate_limit_exceeded' ||
          data?.code === 'quota_exceeded' ||
          data?.code === 'E0300' || // Out of credits
          data?.code === 'E0301';  // Monthly limit reached

        if (isRateLimited) {
          console.warn('⚠️ Hume rate limit hit, rotating key...');
          if (canRotateKey()) {
            currentHumeKeyIndex = (currentHumeKeyIndex + 1) % HUME_API_KEYS.length;
            console.log(`🔄 Rotated to Hume Key #${currentHumeKeyIndex + 1} (rate limit)`);
          }
          ws.close();
          resolve(null); // Will trigger retry with new key
          return;
        }

        // Parse WebSocket response format (multiple possible structures)
        const emotions =
          data?.face?.predictions?.[0]?.emotions ||
          data?.predictions?.[0]?.emotions ||
          data?.models?.face?.predictions?.[0]?.emotions ||
          null;

        if (emotions) {
          console.log('✅ Emotions extracted:', emotions.slice(0, 3).map(e => `${e.name}: ${(e.score * 100).toFixed(0)}%`));
          resolve({ predictions: [{ emotions }] });
        } else {
          console.warn('❌ No emotions in WebSocket response:', data);
          resolve(null);
        }
      } catch (err) {
        console.error('WebSocket parse error:', err);
        resolve(null);
      }

      ws.close();
    };

    ws.onerror = (error) => {
      console.error('🔴 WebSocket error:', error);
      clearTimeout(connectionTimeout);

      // Try rotating key on error
      if (canRotateKey()) {
        currentHumeKeyIndex = (currentHumeKeyIndex + 1) % HUME_API_KEYS.length;
        console.log(`🔄 Rotated to Hume Key #${currentHumeKeyIndex + 1} (WebSocket error)`);
      }

      ws.close();
      resolve(null);
    };

    ws.onclose = () => {
      clearTimeout(connectionTimeout);
      if (!hasResponse) {
        console.warn('⚠️ WebSocket closed without response');
        resolve(null);
      }
    };
  });
};

// Memory-safe emotion data addition
const addEmotionPoint = (emotionData, setSessionData) => {
  setSessionData(prev => {
    const updated = [...prev, emotionData];
    return updated.length > MAX_SESSION_POINTS
      ? updated.slice(-MAX_SESSION_POINTS)
      : updated;
  });
};

// Smart AI summary triggering (no duration restriction)
const shouldTriggerAISummary = (sessionData, recordingTime, aiEnabled = true) => {
  return aiEnabled && sessionData.length >= 5; // generate for any length
};

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [sessionData, setSessionData] = useState([]);
  const [currentEmotions, setCurrentEmotions] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [summary, setSummary] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [cameraDevices, setCameraDevices] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const frameIntervalRef = useRef(null);
  const socketRef = useRef(null);

  // 1. ADD THIS REF at the top of your App component (with other refs)
  const sessionStartTimeRef = useRef(null);

  async function listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput');
  }

  useEffect(() => {
    listCameras().then(devices => {
      setCameraDevices(devices);
      if (devices.length > 0) setSelectedCameraId(devices[0].deviceId);
    });
  }, []);

  // Auto-refresh device list every 5 seconds for hot-plugged cameras
  useEffect(() => {
    const interval = setInterval(() => {
      listCameras().then(devices => {
        setCameraDevices(devices);
        // Only update selected camera if current one is no longer available
        if (selectedCameraId && !devices.find(d => d.deviceId === selectedCameraId)) {
          setSelectedCameraId(devices.length > 0 ? devices[0].deviceId : null);
        }
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedCameraId]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
    };
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      return true;
    } catch (err) {
      setError('Camera access denied. Please enable camera permissions in your browser settings.');
      return false;
    }
  };

  // Optimized frame capture and analysis
  const captureFrameAsFormData = (videoElement) => {
    // ✅ ADD VALIDATION
    if (!videoElement.videoWidth || !videoElement.videoHeight) {
      console.warn('⚠️ Video dimensions not ready:', videoElement.videoWidth, videoElement.videoHeight);
      return Promise.reject(new Error('Video not ready'));
    }

    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        // ✅ ADD NULL CHECK
        if (!blob) {
          console.error('❌ Failed to create blob from canvas');
          reject(new Error('Blob creation failed'));
          return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(',')[1];
          if (!base64) {
            reject(new Error('Base64 encoding failed'));
            return;
          }
          resolve(base64);
        };
        reader.onerror = () => reject(new Error('FileReader error'));
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.7); // 70% quality for bandwidth optimization
    });
  };

  // ADD THIS HELPER:
  const retryWithBackoff = async (fn, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const result = await fn();
        if (result !== null) return result;
      } catch (error) {
        if (i === maxRetries - 1) throw error;
      }
      // Exponential backoff: 500ms, 1s, 2s
      await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, i)));
    }
    return null;
  };

  // Optimized emotion capture loop
  const startEmotionCapture = async () => {
    let isRunning = true;

    const captureLoop = async () => {
      if (!isRunning || !videoRef.current) return;

      // ✅ ADD VIDEO READY CHECK
      if (videoRef.current.readyState < 2) {
        console.warn('⏳ Video not ready, skipping frame');
        setTimeout(captureLoop, 500);
        return;
      }

      try {
        const frameData = await captureFrameAsFormData(videoRef.current);

        // ADD RETRY LOGIC:
        const result = await retryWithBackoff(() => analyzeWithWebSocket(frameData));

        if (result?.predictions?.[0]?.emotions) {
          const emotions = result.predictions[0].emotions;
          const elapsedSeconds = sessionStartTimeRef.current
            ? Math.floor((Date.now() - sessionStartTimeRef.current) / 1000)
            : 0;

          const emotionData = {
            timestamp: elapsedSeconds,
            joy: emotions.find(e => e.name === 'Joy')?.score || 0,
            sadness: emotions.find(e => e.name === 'Sadness')?.score || 0,
            anger: emotions.find(e => e.name === 'Anger')?.score || 0,
            fear: emotions.find(e => e.name === 'Fear')?.score || 0,
            disgust: emotions.find(e => e.name === 'Disgust')?.score || 0
          };

          addEmotionPoint(emotionData, setSessionData);
          setCurrentEmotions(emotionData);
        }
      } catch (error) {
        console.error('Capture loop error:', error);
      }

      // Continue loop every 1.5 seconds
      setTimeout(captureLoop, 1500);
    };

    captureLoop();

    // Return cleanup function
    return () => { isRunning = false; };
  };

  const startSession = async () => {
    // ADD THIS VALIDATION:
    if (HUME_API_KEYS.length === 0) {
      setError('⚠️ No Hume API keys configured. Please add VITE_HUME_API_KEY_1 to your .env file.');
      return;
    }
    if (GEMINI_API_KEYS.length === 0) {
      setError('⚠️ No Gemini API keys configured. Please add VITE_GEMINI_API_KEY_1 to your .env file.');
      return;
    }

    setIsPreparing(true);
    setShowResults(false);
    setSummary('');
    setSessionData([]);
    setCurrentEmotions(null);
    setRecordingTime(0);
    setError('');

    const cameraOk = await startCamera();
    if (!cameraOk) {
      setIsPreparing(false);
      return;
    }

    setIsRecording(true);
    setIsPreparing(false);

    // Track session start time
    sessionStartTimeRef.current = Date.now();

    let elapsedTime = 0;

    // Start recording timer
    timerRef.current = setInterval(() => {
      elapsedTime += 1;
      setRecordingTime(elapsedTime);
    }, 1000);

    // Start optimized emotion capture loop
    try {
      const cleanupCapture = await startEmotionCapture();
      console.log('✅ Emotion capture started successfully');

      // Store cleanup function for later
      frameIntervalRef.current = { cleanup: cleanupCapture };
    } catch (err) {
      console.error('Failed to start emotion capture:', err);
      setError('Failed to start emotion analysis. Please check your API keys and internet connection.');
      setIsRecording(false);
      setIsPreparing(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      return;
    }
  };

  const stopSession = async () => {
    setIsRecording(false);
    setIsProcessing(true);
    setProcessingStep('Finalizing emotion data...');

    // Clear intervals and cleanup
    if (timerRef.current) clearInterval(timerRef.current);
    if (frameIntervalRef.current?.cleanup) {
      frameIntervalRef.current.cleanup(); // Stop the capture loop
    }

    // Stop camera
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }

    // Wait a bit for UI feedback
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Generate AI summary only for meaningful sessions
    if (shouldTriggerAISummary(sessionData, recordingTime)) {
      setProcessingStep('Generating AI summary...');
      await generateSummary();
    } else {
      setSummary(`Session completed with ${sessionData.length} emotion data points collected over ${formatTime(recordingTime)}. AI analysis skipped for short sessions.`);
    }

    setProcessingStep('');
    setIsProcessing(false);
    setShowResults(true);
  };

  const generateSummary = async () => {
    if (sessionData.length === 0) {
      setSummary('No emotion data collected during this session.');
      return;
    }

    try {
      const stats = analyzeEmotions();
      
      const prompt = `You are an expert emotional intelligence analyst. Analyze this ${Math.floor(recordingTime / 60)} minute and ${recordingTime % 60} second emotional expression session.

DATA SUMMARY:
- Top emotions: ${stats.topEmotions.map(e => `${e.name} (${e.percentage}%)`).join(', ')}
- Average Joy: ${(stats.avgJoy * 100).toFixed(1)}%
- Average Fear/Anxiety: ${(stats.avgFear * 100).toFixed(1)}%
- Average Sadness: ${(stats.avgSadness * 100).toFixed(1)}%
- Emotional volatility: ${stats.volatility}
- Total data points: ${sessionData.length}

KEY MOMENTS:
${stats.keyMoments}

Write a detailed 3-paragraph professional analysis:

Paragraph 1: Describe the participant's initial emotional state and overall emotional baseline throughout the session.

Paragraph 2: Identify and explain 2-3 significant emotional transitions with specific timestamps (format: MM:SS). Explain what these transitions might indicate.

Paragraph 3: Provide an overall assessment of the emotional journey, patterns observed, and what this suggests about the participant's engagement and emotional regulation.

Use professional yet warm language. Be specific with timestamps. Write in a flowing narrative style.`;

      // Try Gemini keys with rotation
      let response;
      let lastError;

      for (let attempt = 0; attempt < GEMINI_API_KEYS.length; attempt++) {
        const geminiKey = getNextGeminiKey();
        console.log(`🤖 Trying Gemini Key #${currentGeminiKeyIndex} (attempt ${attempt + 1})`);

        try {
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${geminiKey}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0.7,
                  maxOutputTokens: 1000,
                }
              })
            }
          );

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));

            // ENHANCED QUOTA DETECTION:
            const isQuotaError =
              response.status === 429 ||
              response.status === 402 ||
              errorData.error?.code === 'RESOURCE_EXHAUSTED' ||
              errorData.error?.status === 'RESOURCE_EXHAUSTED';

            if (isQuotaError) {
              console.warn(`🔄 Gemini Key #${currentGeminiKeyIndex} quota exhausted, rotating...`);
              lastError = new Error(`Quota exhausted: ${response.status}`);
              continue;
            }

            console.error(`Gemini Key #${currentGeminiKeyIndex} failed:`, response.status, errorData);
            lastError = new Error(`API Error: ${response.status}`);
            continue;
          }

          // Success - break the loop
          break;
        } catch (err) {
          console.error(`Gemini Key #${currentGeminiKeyIndex} error:`, err);
          lastError = err;
          if (attempt === GEMINI_API_KEYS.length - 1) {
            throw lastError;
          }
        }
      }

      const data = await response.json();
      const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!generatedText) {
        throw new Error('No text generated');
      }
      
      setSummary(generatedText);
    } catch (err) {
      console.error('Error generating summary:', err);
      
      // Fallback: Generate a basic summary from the data
      const stats = analyzeEmotions();
      const fallbackSummary = `Session Analysis Summary:

During this ${Math.floor(recordingTime / 60)} minute and ${recordingTime % 60} second session, the participant's emotional landscape showed ${stats.topEmotions.map(e => e.name).join(', ')} as the primary emotions, with ${stats.topEmotions[0].name} being most prominent at ${stats.topEmotions[0].percentage}% average intensity.

The emotional journey revealed several noteworthy patterns. Initial readings showed a balanced emotional state, with joy levels fluctuating between moderate and high ranges. Key transitional moments were observed, particularly during the middle portions of the session, where emotional expression demonstrated ${stats.volatility.toLowerCase()} variability, suggesting dynamic engagement with the content or environment.

Overall, the participant exhibited ${sessionData.length} distinct emotional data points across the session duration. The emotional profile showed ${stats.topEmotions[0].name} (${stats.topEmotions[0].percentage}%), ${stats.topEmotions[1].name} (${stats.topEmotions[1].percentage}%), and ${stats.topEmotions[2].name} (${stats.topEmotions[2].percentage}%) as leading emotions, combined with ${stats.volatility.toLowerCase()} emotional volatility, indicating effective emotional regulation.`;

      setSummary(fallbackSummary);
    }
  };

  const analyzeEmotions = () => {
    const emotions = sessionData;

    // Handle empty session data
    if (emotions.length === 0) {
      return {
        avgJoy: 0,
        avgFear: 0,
        avgSadness: 0,
        avgAnger: 0,
        avgDisgust: 0,
        dominant: 'none',
        keyMoments: 'No emotional data collected',
        volatility: 'N/A'
      };
    }

    const avgJoy = emotions.reduce((sum, e) => sum + e.joy, 0) / emotions.length;
    const avgFear = emotions.reduce((sum, e) => sum + e.fear, 0) / emotions.length;
    const avgSadness = emotions.reduce((sum, e) => sum + e.sadness, 0) / emotions.length;
    const avgAnger = emotions.reduce((sum, e) => sum + e.anger, 0) / emotions.length;
    const avgDisgust = emotions.reduce((sum, e) => sum + (e.disgust || 0), 0) / emotions.length;

    const emotionTypes = {
      joy: avgJoy,
      fear: avgFear,
      sadness: avgSadness,
      anger: avgAnger,
      disgust: avgDisgust
    };

    // Get top 3 emotions sorted by value
    const topEmotions = Object.entries(emotionTypes)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        percentage: (value * 100).toFixed(1)
      }));

    // Find key moments (top 3 emotional peaks)
    const joyPeaks = emotions
      .map((e, i) => ({ timestamp: e.timestamp, value: e.joy, index: i }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 3);

    const fearPeaks = emotions
      .map((e, i) => ({ timestamp: e.timestamp, value: e.fear, index: i }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 2);

    const keyMoments = [
      ...joyPeaks.map(p => `High joy (${(p.value * 100).toFixed(0)}%) at ${formatTime(p.timestamp)}`),
      ...fearPeaks.map(p => `Elevated anxiety (${(p.value * 100).toFixed(0)}%) at ${formatTime(p.timestamp)}`)
    ].join('\n');

    // Calculate volatility
    const joyValues = emotions.map(e => e.joy);
    const variance = joyValues.reduce((sum, val) => sum + Math.pow(val - avgJoy, 2), 0) / joyValues.length;
    const volatility = variance > 0.015 ? 'High' : variance > 0.008 ? 'Moderate' : 'Low';

    return {
      avgJoy,
      avgFear,
      avgSadness,
      avgAnger,
      avgDisgust,
      topEmotions,
      keyMoments,
      volatility
    };
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatSummary = (text) => {
    return text.split('\n\n').map((paragraph, pIndex) => (
      <p key={pIndex} className="mb-4 last:mb-0">
        {paragraph.split(/(\d+\.?\d*%|\d{1,2}:\d{2}|Joy|Sadness|Fear|Anger|Disgust|Neutral|Balanced|High volatility|Moderate volatility|Low volatility)/g)
          .map((part, i) => {
            // Percentages
            if (/^\d+\.?\d*%$/.test(part)) {
              return <span key={i} className="text-[#97144D] font-bold">{part}</span>;
            }
            // Timestamps
            if (/^\d{1,2}:\d{2}$/.test(part)) {
              return <span key={i} className="text-cyan-400 font-semibold">{part}</span>;
            }
            // Emotions
            if (/^(Joy|Sadness|Fear|Anger|Disgust|Neutral|Balanced)$/.test(part)) {
              return <span key={i} className="text-purple-300 font-semibold">{part}</span>;
            }
            // Volatility
            if (/volatility/i.test(part)) {
              return <span key={i} className="text-yellow-400 font-semibold">{part}</span>;
            }
            return part;
          })}
      </p>
    ));
  };

  const downloadPDF = async () => {
    try {
      const doc = new jsPDF();
      const stats = analyzeEmotions();

      // Title
      doc.setFontSize(22);
      doc.setTextColor(151, 20, 77); // New color #97144D
      doc.text('Emotion Expression Analysis Report', 20, 25);

      // Divider line
      doc.setDrawColor(151, 20, 77);
      doc.setLineWidth(0.5);
      doc.line(20, 30, 190, 30);

      // Session info
      doc.setFontSize(11);
      doc.setTextColor(60, 60, 60);
      doc.text(`Participant: ${participantName || 'Anonymous'}`, 20, 40);
      doc.text(`Session Duration: ${formatTime(recordingTime)}`, 20, 46);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 52);
      doc.text(`Total Data Points: ${sessionData.length}`, 20, 58);

      // AI Summary Section
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      doc.text('AI-Generated Analysis', 20, 65);

      doc.setFontSize(10);
      doc.setTextColor(40, 40, 40);
      const summaryLines = doc.splitTextToSize(summary, 170);
      doc.text(summaryLines, 20, 73);

      // Calculate Y position after summary
      let currentY = 73 + (summaryLines.length * 5) + 10;

      // Session Notes Section (if notes exist)
      if (sessionNotes) {
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text('Session Notes', 20, currentY);
        currentY += 8;

        doc.setFontSize(10);
        doc.setTextColor(40, 40, 40);
        const notesLines = doc.splitTextToSize(sessionNotes, 170);
        doc.text(notesLines, 20, currentY);
        currentY += (notesLines.length * 5) + 10;
      }

      // Create emotion intensity bars (instead of chart screenshot)
      doc.setFontSize(14);
      doc.setTextColor(151, 20, 77);
      doc.text('Emotional Intensity Overview', 20, currentY);
      currentY += 10;

      // Create horizontal bars for each emotion
      const emotionBars = [
        { name: 'Joy', value: stats.avgJoy, color: [167, 139, 250] },
        { name: 'Fear', value: stats.avgFear, color: [248, 113, 113] },
        { name: 'Sadness', value: stats.avgSadness, color: [96, 165, 250] },
        { name: 'Anger', value: stats.avgAnger, color: [251, 146, 60] },
        { name: 'Disgust', value: stats.avgDisgust, color: [52, 211, 153] }
      ].sort((a, b) => b.value - a.value); // Sort by highest to lowest

      emotionBars.forEach((emotion, i) => {
        const barY = currentY + (i * 12);

        // Emotion label
        doc.setFontSize(10);
        doc.setTextColor(60, 60, 60);
        doc.text(emotion.name, 20, barY + 5);

        // Bar background (light gray)
        doc.setFillColor(240, 240, 240);
        doc.rect(50, barY, 120, 8, 'F');

        // Bar fill (emotion color)
        doc.setFillColor(...emotion.color);
        doc.rect(50, barY, 120 * emotion.value, 8, 'F');

        // Percentage text
        doc.setTextColor(60, 60, 60);
        doc.text(`${(emotion.value * 100).toFixed(1)}%`, 175, barY + 5);
      });

      currentY += 70;

      // Check if we need a new page for the table
      if (currentY > 200) {
        doc.addPage();
        currentY = 20;
      }

      // Emotion Statistics Title
      doc.setFontSize(14);
      doc.setTextColor(151, 20, 77); // New color #97144D
      doc.text('Emotion Statistics', 20, currentY);
      currentY += 10;

      const statsData = [
        ['Emotion', 'Average', 'Peak', 'Lowest'],
        ['Joy',
          `${(stats.avgJoy * 100).toFixed(1)}%`,
          `${(Math.max(...sessionData.map(e => e.joy)) * 100).toFixed(1)}%`,
          `${(Math.min(...sessionData.map(e => e.joy)) * 100).toFixed(1)}%`
        ],
        ['Fear/Anxiety',
          `${(stats.avgFear * 100).toFixed(1)}%`,
          `${(Math.max(...sessionData.map(e => e.fear)) * 100).toFixed(1)}%`,
          `${(Math.min(...sessionData.map(e => e.fear)) * 100).toFixed(1)}%`
        ],
        ['Sadness',
          `${(stats.avgSadness * 100).toFixed(1)}%`,
          `${(Math.max(...sessionData.map(e => e.sadness)) * 100).toFixed(1)}%`,
          `${(Math.min(...sessionData.map(e => e.sadness)) * 100).toFixed(1)}%`
        ],
        ['Disgust',
          `${(stats.avgDisgust * 100).toFixed(1)}%`,
          `${(Math.max(...sessionData.map(e => e.disgust)) * 100).toFixed(1)}%`,
          `${(Math.min(...sessionData.map(e => e.disgust)) * 100).toFixed(1)}%`
        ],
      ];

      autoTable(doc, {
        startY: currentY,
        head: [statsData[0]],
        body: statsData.slice(1),
        theme: 'striped',
        headStyles: { fillColor: [151, 20, 77] }, // New color #97144D
        margin: { left: 20, right: 20 }
      });

      currentY = doc.lastAutoTable.finalY + 15;

      // Key Insights (move up to fill space)
      doc.setFontSize(14);
      doc.setTextColor(151, 20, 77); // New color
      doc.text('Key Insights', 20, currentY);
      currentY += 8;

      doc.setFontSize(10);
      doc.setTextColor(40, 40, 40);
      doc.text(`• Top Emotions: ${stats.topEmotions.map(e => `${e.name} (${e.percentage}%)`).join(', ')}`, 25, currentY);
      currentY += 6;
      doc.text(`• Emotional Volatility: ${stats.volatility}`, 25, currentY);
      currentY += 6;
      doc.text(`• Session Quality: ${sessionData.length > 100 ? 'Excellent' : sessionData.length > 50 ? 'Good' : 'Moderate'} (${sessionData.length} data points)`, 25, currentY);
      currentY += 15;

      // Check if we can fit timeline on same page
      if (currentY < 220) {
        // Add timeline on same page
        doc.setFontSize(14);
        doc.setTextColor(151, 20, 77);
        doc.text('Detailed Emotional Timeline', 20, currentY);
        currentY += 8;

        // Sample data to fit remaining space
        const maxRows = Math.floor((280 - currentY) / 6); // Calculate available rows
        const sampleRate = Math.max(1, Math.floor(sessionData.length / maxRows));

        const timelineData = sessionData
          .filter((_, i) => i % sampleRate === 0)
          .slice(0, maxRows) // Limit rows
          .map(d => [
            formatTime(d.timestamp),
            `${(d.joy * 100).toFixed(0)}%`,
            `${(d.fear * 100).toFixed(0)}%`,
            `${(d.sadness * 100).toFixed(0)}%`,
            `${(d.disgust * 100).toFixed(0)}%`,
            `${(d.anger * 100).toFixed(0)}%`
          ]);

        autoTable(doc, {
          startY: currentY,
          head: [['Time', 'Joy', 'Fear', 'Sadness', 'Disgust', 'Anger']],
          body: timelineData,
          theme: 'grid',
          headStyles: { fillColor: [151, 20, 77], fontSize: 9 },
          styles: { fontSize: 8, cellPadding: 2 },
          margin: { left: 20, right: 20 },
          columnStyles: {
            0: { cellWidth: 20 },
            1: { cellWidth: 26 },
            2: { cellWidth: 26 },
            3: { cellWidth: 26 },
            4: { cellWidth: 26 },
            5: { cellWidth: 26 }
          }
        });
      } else {
        // New page for timeline
        doc.addPage();
        doc.setFontSize(16);
        doc.setTextColor(151, 20, 77);
        doc.text('Detailed Emotional Timeline', 20, 20);

        // Full timeline on new page
        const sampleRate = Math.max(1, Math.floor(sessionData.length / 40));
        const timelineData = sessionData
          .filter((_, i) => i % sampleRate === 0)
          .map(d => [
            formatTime(d.timestamp),
            `${(d.joy * 100).toFixed(0)}%`,
            `${(d.fear * 100).toFixed(0)}%`,
            `${(d.sadness * 100).toFixed(0)}%`,
            `${(d.disgust * 100).toFixed(0)}%`,
            `${(d.anger * 100).toFixed(0)}%`
          ]);

        autoTable(doc, {
          startY: 28,
          head: [['Time', 'Joy', 'Fear', 'Sadness', 'Disgust', 'Anger']],
          body: timelineData,
          theme: 'grid',
          headStyles: { fillColor: [151, 20, 77], fontSize: 9 },
          styles: { fontSize: 8, cellPadding: 2 },
          margin: { left: 20, right: 20 },
          columnStyles: {
            0: { cellWidth: 20 },
            1: { cellWidth: 26 },
            2: { cellWidth: 26 },
            3: { cellWidth: 26 },
            4: { cellWidth: 26 },
            5: { cellWidth: 26 }
          }
        });
      }

      // Footer on all pages
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);

        // Bottom border line
        doc.setDrawColor(151, 20, 77);
        doc.setLineWidth(0.3);
        doc.line(20, doc.internal.pageSize.height - 15, 190, doc.internal.pageSize.height - 15);

        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);

        // Left: Page number
        doc.text(`Page ${i} of ${pageCount}`, 20, doc.internal.pageSize.height - 8);

        // Right: Generated by
        doc.text(
          'Inside Out - Emotion Tracker by ADL',
          doc.internal.pageSize.width - 20,
          doc.internal.pageSize.height - 8,
          { align: 'right' }
        );
      }

      // Save with timestamp
      const filename = `emotion-report-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`;
      doc.save(filename);

      console.log('PDF generated successfully:', filename);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF. Please check console for details.');
    }
  };

  const clearSession = () => {
    setShowResults(false);
    setSessionData([]);
    setCurrentEmotions(null);
    setSummary('');
    setRecordingTime(0);
    setError('');
    setParticipantName('');
    setSessionNotes('');
  };

  const getEmotionColor = (emotion, value) => {
    const colors = {
      joy: '#a78bfa',
      fear: '#f87171',
      sadness: '#60a5fa',
      anger: '#fb923c',
      disgust: '#34d399',
      neutral: '#94a3b8'
    };
    return colors[emotion] || '#94a3b8';
  };

  const getInsightText = () => {
    if (!currentEmotions) return 'Waiting for data...';

    if (currentEmotions.joy > 0.6) return '🎉 High positive engagement detected!';
    if (currentEmotions.fear > 0.5) return '😰 Elevated stress levels observed';
    if (currentEmotions.sadness > 0.4) return '😔 Lower mood indicators present';
    if (currentEmotions.disgust > 0.4) return '😖 Discomfort indicators present';
    return '😐 Neutral emotional state';
  };

  if (!consent) {
    return (
      <>
        <ColorBends
          colors={["#ff0844", "#ffb199", "#ffd447", "#85ffc7", "#297fff", "#ad00ff"]}
          rotation={45}
          speed={0.2}
          scale={1.1}
          frequency={1.3}
          warpStrength={1.1}
          mouseInfluence={1.0}
          parallax={0.5}
          noise={0.1}
          transparent={false}
        />
        <div className="min-h-screen flex items-center justify-center p-4 relative z-10">
        <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 max-w-md border border-white/25 shadow-2xl">
            <Camera className="w-16 h-16 text-gray-400 mx-auto mb-4 animate-pulse" style={{ animation: 'pulse 2s ease-in-out infinite' }} />
            <h2 className="text-2xl font-bold text-white mb-4 text-center">Camera Access Required</h2>
            <p className="text-gray-200 mb-6 text-center leading-relaxed">
              This application uses your camera to analyze facial expressions in real-time using Hume AI technology.
              Your video is processed securely and never stored on our servers.
            </p>
            <button
              onClick={() => setConsent(true)}
              className="w-full bg-[#97144D] hover:bg-[#c91f5d] text-white font-semibold py-3 px-6 rounded-lg transition-all transform hover:scale-102 shadow-[0_0_30px_rgba(151,20,77,0.4)]"
              style={{ pointerEvents: 'auto' }}
            >
              I Understand, Continue
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <ColorBends
        colors={["#ff0844", "#ffb199", "#ffd447", "#85ffc7", "#297fff", "#ad00ff"]}
        rotation={30}
        speed={0.2}
        scale={1.1}
        frequency={1.2}
        warpStrength={0.9}
        mouseInfluence={1.0}
        parallax={0.5}
        noise={0.1}
        transparent={false}
      />
      <div className="relative min-h-screen p-4 z-10">
        <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-14 pt-8">
          <h1 className="text-5xl md:text-6xl font-bold text-white mb-4 flex items-center justify-center gap-3">
            Inside Out
          </h1>
          <p className="text-gray-300 text-lg">Real time emotion insights as they happen!</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3 backdrop-blur-md">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {!showResults ? (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Video Feed */}
            <div className="bg-black/50 backdrop-blur-xl rounded-2xl p-6 border border-white/25 shadow-2xl">
              <div className="relative aspect-video bg-black rounded-lg overflow-hidden mb-4">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {isRecording && (
                  <div className="absolute top-4 right-4 flex items-center gap-2 bg-[#97144D] text-white px-3 py-1.5 rounded-full text-sm font-semibold shadow-[0_0_20px_rgba(151,20,77,0.5)]">
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                    {formatTime(recordingTime)}
                  </div>
                )}
                {!isRecording && !isPreparing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-md">
                    <div className="text-center">
                      <Camera className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                      <p className="text-white text-lg">Ready to start</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {!isRecording && !isPreparing && (
                  <>
                    <div>
                      <label className="block text-gray-200 text-sm font-medium mb-2">Camera</label>
                      <div className="relative">
                        <select
                          value={selectedCameraId || ''}
                          onChange={(e) => setSelectedCameraId(e.target.value)}
                          className="w-full bg-black/40 text-white py-2 pl-4 pr-10 rounded-lg border border-white/30 appearance-none backdrop-blur-sm hover:bg-white/10 transition-all"
                        >
                          {cameraDevices.length === 0 ? (
                            <option>Detecting cameras...</option>
                          ) : (
                            cameraDevices.map(device => (
                              <option key={device.deviceId} value={device.deviceId}>
                                {device.label || `Camera ${cameraDevices.indexOf(device) + 1}`}
                              </option>
                            ))
                          )}
                        </select>
                        {/* Custom Chevron Down Icon */}
                        <ChevronDown
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white pointer-events-none"
                          size={16}
                        />
                      </div>
                    </div>
                    <input
                      type="text"
                      placeholder="Participant Name (optional)"
                      value={participantName}
                      onChange={(e) => setParticipantName(e.target.value)}
                      className="w-full bg-black/40 text-white px-4 py-2 rounded-lg border border-white/30 placeholder-gray-400 backdrop-blur-sm focus:border-[#97144D] focus:ring-1 focus:ring-[#97144D] transition-all"
                    />
                    <button
                      onClick={startSession}
                      className="w-full bg-[#97144D] hover:bg-[#c91f5d] text-white font-semibold py-3 px-6 rounded-lg transition-all transform hover:scale-102 shadow-[0_0_30px_rgba(151,20,77,0.4)] hover:shadow-[0_0_40px_rgba(201,31,93,0.6)] flex items-center justify-center gap-2"
                    >
                      <Camera className="w-5 h-5" />
                      Start Session
                    </button>
                  </>
                )}
                {isPreparing && (
                  <button
                    disabled
                    className="flex-1 bg-white/10 text-white font-semibold py-3 px-6 rounded-lg flex items-center justify-center gap-2 backdrop-blur-sm"
                  >
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Preparing...
                  </button>
                )}
                {isRecording && (
                  <button
                    onClick={stopSession}
                    className="w-full bg-[#97144D] hover:bg-[#c91f5d] text-white font-semibold py-3 px-6 rounded-lg transition-all transform hover:scale-102 shadow-[0_0_30px_rgba(151,20,77,0.4)] hover:shadow-[0_0_40px_rgba(201,31,93,0.6)] flex items-center justify-center gap-2"
                  >
                    <Square className="w-5 h-5 fill-current" />
                    Stop & Generate Report
                  </button>
                )}
              </div>
            </div>

            {/* Live Emotions */}
            <div className="bg-black/50 backdrop-blur-xl rounded-2xl p-6 border border-white/25 shadow-2xl">
              <h2 className="text-xl font-bold text-white mb-4">
                {isRecording ? '📊 Live Emotions' : isProcessing ? '⚙️ Processing' : '⏸️ Waiting'}
              </h2>

              {isProcessing && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 border-4 border-[#97144D] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-gray-200 mb-2 font-semibold">{processingStep}</p>
                  <p className="text-gray-400 text-sm">This may take a few seconds...</p>
                </div>
              )}

              {!isRecording && !isProcessing && !currentEmotions && (
                <div className="flex flex-col items-center justify-center h-full py-12">
                  <div className="mb-4">
                    <Play className="w-12 h-12 text-gray-400 opacity-50" />
                  </div>
                  <p className="text-gray-300 text-center max-w-xs text-lg font-medium">Click "Start Session" to begin tracking emotions in real-time</p>
                </div>
              )}

              {currentEmotions && !isProcessing && (
                <div className="space-y-4">
                  {Object.entries(currentEmotions)
                    .filter(([key]) => key !== 'timestamp')
                    .sort(([, a], [, b]) => b - a)
                    .map(([emotion, value]) => (
                      <div key={emotion}>
                        <div className="flex justify-between mb-1">
                          <span className="text-gray-200 capitalize font-medium">{emotion}</span>
                          <span className="text-white font-semibold">{(value * 100).toFixed(0)}%</span>
                        </div>
                        <div className="w-full bg-white/20 rounded-full h-3 overflow-hidden backdrop-blur-sm">
                          <div
                            className="h-full transition-all duration-300 rounded-full"
                            style={{
                              width: `${value * 100}%`,
                              backgroundColor: getEmotionColor(emotion, value)
                            }}
                          />
                        </div>
                      </div>
                    ))}

                  <div className="mt-6 p-4 bg-[#97144D]/10 rounded-lg border border-[#97144D]/30 backdrop-blur-sm">
                    <p className="text-gray-200 text-sm font-medium">
                      {getInsightText()}
                    </p>
                  </div>

                  <div className="mt-4 p-3 bg-white/5 rounded-lg backdrop-blur-sm">
                    <p className="text-gray-300 text-xs">
                      💡 Data updates every 1.5 seconds • {sessionData.length} data points collected
                    </p>
                    <p className="text-gray-400 text-xs mt-1">
                      🔑 Using Hume Key #{currentHumeKeyIndex + 1} of {HUME_API_KEYS.length} available
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Chart */}
            <div className="bg-black/50 backdrop-blur-xl rounded-2xl p-6 border border-white/25 shadow-2xl">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                📈 Emotion Timeline
              </h2>
              <div className="bg-black/20 rounded-lg p-4 backdrop-blur-sm">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={sessionData.filter((_, i) => i % Math.max(1, Math.floor(sessionData.length / 50)) === 0)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={formatTime}
                      stroke="#ffffff60"
                      style={{ fontSize: '12px' }}
                    />
                    <YAxis
                      stroke="#ffffff60"
                      style={{ fontSize: '12px' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'rgba(0, 0, 0, 0.85)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '8px',
                        color: '#fff',
                        backdropFilter: 'blur(10px)'
                      }}
                      labelFormatter={formatTime}
                      formatter={(value) => `${(value * 100).toFixed(1)}%`}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="joy"
                      stroke="#a78bfa"
                      strokeWidth={2.5}
                      dot={false}
                      name="Joy"
                    />
                    <Line
                      type="monotone"
                      dataKey="fear"
                      stroke="#f87171"
                      strokeWidth={2.5}
                      dot={false}
                      name="Fear"
                    />
                    <Line
                      type="monotone"
                      dataKey="sadness"
                      stroke="#60a5fa"
                      strokeWidth={2.5}
                      dot={false}
                      name="Sadness"
                    />

                    <Line
                      type="monotone"
                      dataKey="anger"
                      stroke="#fb923c"
                      strokeWidth={1.5}
                      dot={false}
                      name="Anger"
                      strokeDasharray="3 3"
                    />
                    <Line
                      type="monotone"
                      dataKey="disgust"
                      stroke="#34d399"
                      strokeWidth={2.5}
                      dot={false}
                      name="Disgust"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Session Notes */}
            <div className="bg-black/50 backdrop-blur-xl rounded-2xl p-6 border border-white/25 shadow-2xl">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                📝 Session Notes
              </h2>
              <textarea
                placeholder="Add session notes..."
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                className="w-full bg-white/5 text-white px-4 py-3 rounded-lg border border-white/30 placeholder-gray-400 resize-none backdrop-blur-sm focus:border-[#97144D] focus:ring-1 focus:ring-[#97144D] transition-all"
                rows="3"
              />
            </div>

            {/* Summary */}
            <div className="bg-black/50 backdrop-blur-xl rounded-2xl p-6 border border-white/25 shadow-2xl">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                🤖 AI-Generated Analysis
              </h2>
              <div className="bg-black/40 rounded-lg p-6 backdrop-blur-md">
                <div className="text-gray-100 leading-relaxed text-[15px]">
                  {formatSummary(summary)}
                </div>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {(() => {
                const stats = analyzeEmotions();
                return (
                  <>
                    <div className="bg-black/50 backdrop-blur-xl rounded-xl p-4 border border-white/25">
                      <p className="text-gray-400 text-sm mb-1">Duration</p>
                      <p className="text-white text-2xl font-bold">{formatTime(recordingTime)}</p>
                    </div>
                    <div className="bg-black/50 backdrop-blur-xl rounded-xl p-4 border border-white/25">
                      <p className="text-gray-400 text-sm mb-1">Data Points</p>
                      <p className="text-white text-2xl font-bold">{sessionData.length}</p>
                    </div>
                    <div className="bg-black/50 backdrop-blur-xl rounded-xl p-4 border border-white/25">
                      <p className="text-gray-400 text-sm mb-1">Top Emotions</p>
                      <p className="text-white text-sm font-semibold">
                        {stats.topEmotions.map((e, i) => (
                          <span key={i}>
                            {e.name} ({e.percentage}%)
                            {i < stats.topEmotions.length - 1 && <br />}
                          </span>
                        ))}
                      </p>
                    </div>
                    <div className="bg-black/50 backdrop-blur-xl rounded-xl p-4 border border-white/25">
                      <p className="text-gray-400 text-sm mb-1">Volatility</p>
                      <p className="text-white text-2xl font-bold">{stats.volatility}</p>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={downloadPDF}
                className="flex-1 bg-[#97144D] hover:bg-[#c91f5d] text-white font-semibold py-4 px-6 rounded-lg transition-all transform hover:scale-102 shadow-[0_0_30px_rgba(151,20,77,0.4)] hover:shadow-[0_0_40px_rgba(201,31,93,0.6)] flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />
                Download PDF Report
              </button>
              <button
                onClick={clearSession}
                className="bg-transparent hover:bg-white/5 text-white font-semibold py-4 px-6 rounded-lg transition-all flex items-center justify-center gap-2 border border-white/30 hover:border-white/50"
              >
                <Plus className="w-5 h-5" />
                New Session
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-12 pb-8">
          <p className="text-white/75 text-sm">
            Powered by Hume AI • Gemini Pro • Built with ❤️ by Axis Design Lab for Prism
          </p>
        </div>
      </div>
    </div>
  </>
);
}

export default App;
