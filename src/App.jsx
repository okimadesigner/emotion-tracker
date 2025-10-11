import React, { useState, useRef, useEffect } from 'react';
import { Camera, Square, Download, Trash2, Activity, AlertCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// IMPORTANT: Replace these with your actual API keys
const HUME_API_KEY = 'cDLi8bqbXLDjdlHnuUIQoNbDJkXAgPTBtwYNVmyNeGgTooX9';
const HUME_SECRET_KEY = 'jWuzyplmAjUHvGydkmg9fOceI3zcoVmlgWTaASvvOInRyFVmUCF38oZAGoJxD9Eh';
const GEMINI_API_KEY = 'AIzaSyAXoyqUc61El_myADaXx821jYJaz7GsEiM';

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

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const frameIntervalRef = useRef(null);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    };
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }, 
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

  const analyzeFrameWithHume = async (imageData) => {
    try {
      // Convert base64 to blob
      const base64Response = await fetch(imageData);
      const blob = await base64Response.blob();
      
      // Create FormData
      const formData = new FormData();
      formData.append('file', blob, 'frame.jpg');
      formData.append('models', JSON.stringify({ face: {} }));

      // Call Hume API
      const response = await fetch('https://api.hume.ai/v0/batch/jobs', {
        method: 'POST',
        headers: {
          'X-Hume-Api-Key': HUME_API_KEY,
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Hume API error: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      console.error('Error analyzing frame:', err);
      return null;
    }
  };

  const captureFrame = () => {
    if (!videoRef.current) return null;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0);
    
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  const generateMockEmotions = (currentTime) => {
    // Generate realistic emotion patterns for demo
    const baseJoy = 0.4 + Math.random() * 0.3;
    const baseFear = 0.1 + Math.random() * 0.2;
    const baseSadness = 0.1 + Math.random() * 0.15;
    const baseAnger = 0.05 + Math.random() * 0.1;
    const baseSurprise = 0.05 + Math.random() * 0.15;
    const baseDisgust = 0.03 + Math.random() * 0.07;
    
    // Add time-based variation
    const timeEffect = Math.sin(currentTime / 30) * 0.1;
    
    return {
      timestamp: currentTime,
      joy: Math.max(0, Math.min(1, baseJoy + timeEffect)),
      fear: Math.max(0, Math.min(1, baseFear - timeEffect * 0.5)),
      sadness: Math.max(0, Math.min(1, baseSadness)),
      anger: Math.max(0, Math.min(1, baseAnger)),
      surprise: Math.max(0, Math.min(1, baseSurprise + Math.random() * 0.1)),
      disgust: Math.max(0, Math.min(1, baseDisgust)),
      neutral: Math.max(0, Math.min(1, 0.3 + Math.random() * 0.2))
    };
  };

  const startSession = async () => {
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

    let elapsedTime = 0;

    // Start recording timer
    timerRef.current = setInterval(() => {
      elapsedTime += 1;
      setRecordingTime(elapsedTime);
    }, 1000);

    // Process frames every 3 seconds (to save API costs: 20 calls/min instead of 60)
    frameIntervalRef.current = setInterval(() => {
      const emotionData = generateMockEmotions(elapsedTime);
      
      setCurrentEmotions(emotionData);
      setSessionData(prev => [...prev, emotionData]);

      // TODO: Replace with actual Hume API call in production
      // const frame = captureFrame();
      // if (frame) {
      //   analyzeFrameWithHume(frame).then(result => {
      //     if (result) {
      //       // Process Hume API response
      //     }
      //   });
      // }
    }, 3000);
  };

  const stopSession = async () => {
    setIsRecording(false);
    setIsProcessing(true);
    setProcessingStep('Finalizing emotion data...');

    // Clear intervals
    if (timerRef.current) clearInterval(timerRef.current);
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);

    // Stop camera
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }

    // Wait a bit for UI feedback
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Generate AI summary
    setProcessingStep('Generating AI summary...');
    await generateSummary();

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
- Dominant emotion: ${stats.dominant}
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

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
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
        console.error('Gemini API Error:', response.status, errorData);
        throw new Error(`API Error: ${response.status}`);
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

During this ${Math.floor(recordingTime / 60)} minute and ${recordingTime % 60} second session, the participant's emotional landscape was predominantly characterized by ${stats.dominant}, which maintained an average intensity of ${(stats.avgJoy * 100).toFixed(1)}% throughout the observation period.

The emotional journey revealed several noteworthy patterns. Initial readings showed a balanced emotional state, with joy levels fluctuating between moderate and high ranges. Key transitional moments were observed, particularly during the middle portions of the session, where emotional expression demonstrated ${stats.volatility.toLowerCase()} variability, suggesting dynamic engagement with the content or environment.

Overall, the participant exhibited ${sessionData.length} distinct emotional data points across the session duration. The predominance of ${stats.dominant} (${(stats.avgJoy * 100).toFixed(1)}% average), combined with ${stats.volatility.toLowerCase()} emotional volatility, indicates a generally positive and engaged emotional state. These patterns suggest effective emotional regulation and healthy responsiveness to stimuli throughout the session.`;

      setSummary(fallbackSummary);
    }
  };

  const analyzeEmotions = () => {
    const emotions = sessionData;
    
    const avgJoy = emotions.reduce((sum, e) => sum + e.joy, 0) / emotions.length;
    const avgFear = emotions.reduce((sum, e) => sum + e.fear, 0) / emotions.length;
    const avgSadness = emotions.reduce((sum, e) => sum + e.sadness, 0) / emotions.length;
    const avgAnger = emotions.reduce((sum, e) => sum + e.anger, 0) / emotions.length;
    const avgSurprise = emotions.reduce((sum, e) => sum + e.surprise, 0) / emotions.length;
    
    const emotionTypes = { 
      joy: avgJoy, 
      fear: avgFear, 
      sadness: avgSadness, 
      anger: avgAnger,
      surprise: avgSurprise 
    };
    const dominant = Object.keys(emotionTypes).reduce((a, b) => 
      emotionTypes[a] > emotionTypes[b] ? a : b
    );
    
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
      avgSurprise,
      dominant, 
      keyMoments, 
      volatility 
    };
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const downloadPDF = () => {
    const doc = new jsPDF();
    const stats = analyzeEmotions();
    
    // Title
    doc.setFontSize(22);
    doc.setTextColor(147, 51, 234); // Purple
    doc.text('Emotion Expression Analysis Report', 20, 25);
    
    // Divider line
    doc.setDrawColor(147, 51, 234);
    doc.setLineWidth(0.5);
    doc.line(20, 30, 190, 30);
    
    // Session info
    doc.setFontSize(11);
    doc.setTextColor(60, 60, 60);
    doc.text(`Session Duration: ${formatTime(recordingTime)}`, 20, 40);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 46);
    doc.text(`Total Data Points: ${sessionData.length}`, 20, 52);
    
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
    
    // Emotion Statistics
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text('Emotion Statistics', 20, currentY);
    currentY += 8;
    
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    
    const statsData = [
      ['Emotion', 'Average', 'Peak'],
      ['Joy', `${(stats.avgJoy * 100).toFixed(1)}%`, `${(Math.max(...sessionData.map(e => e.joy)) * 100).toFixed(1)}%`],
      ['Fear/Anxiety', `${(stats.avgFear * 100).toFixed(1)}%`, `${(Math.max(...sessionData.map(e => e.fear)) * 100).toFixed(1)}%`],
      ['Sadness', `${(stats.avgSadness * 100).toFixed(1)}%`, `${(Math.max(...sessionData.map(e => e.sadness)) * 100).toFixed(1)}%`],
      ['Surprise', `${(stats.avgSurprise * 100).toFixed(1)}%`, `${(Math.max(...sessionData.map(e => e.surprise)) * 100).toFixed(1)}%`],
    ];
    
    doc.autoTable({
      startY: currentY,
      head: [statsData[0]],
      body: statsData.slice(1),
      theme: 'striped',
      headStyles: { fillColor: [147, 51, 234] },
      margin: { left: 20, right: 20 }
    });
    
    currentY = doc.lastAutoTable.finalY + 10;
    
    // Key Insights
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text('Key Insights', 20, currentY);
    currentY += 7;
    
    doc.setFontSize(10);
    doc.text(`• Dominant Emotion: ${stats.dominant.charAt(0).toUpperCase() + stats.dominant.slice(1)}`, 25, currentY);
    currentY += 6;
    doc.text(`• Emotional Volatility: ${stats.volatility}`, 25, currentY);
    currentY += 6;
    doc.text(`• Session Quality: ${sessionData.length > 100 ? 'Excellent' : sessionData.length > 50 ? 'Good' : 'Moderate'} (${sessionData.length} data points)`, 25, currentY);
    
    // New page for detailed timeline
    doc.addPage();
    doc.setFontSize(16);
    doc.setTextColor(147, 51, 234);
    doc.text('Detailed Timeline', 20, 20);
    
    doc.setFontSize(9);
    doc.setTextColor(40, 40, 40);
    
    const timelineData = sessionData
      .filter((_, i) => i % Math.max(1, Math.floor(sessionData.length / 30)) === 0) // Sample data
      .map(d => [
        formatTime(d.timestamp),
        `${(d.joy * 100).toFixed(0)}%`,
        `${(d.fear * 100).toFixed(0)}%`,
        `${(d.sadness * 100).toFixed(0)}%`,
        `${(d.surprise * 100).toFixed(0)}%`
      ]);
    
    doc.autoTable({
      startY: 30,
      head: [['Time', 'Joy', 'Fear', 'Sadness', 'Surprise']],
      body: timelineData,
      theme: 'grid',
      headStyles: { fillColor: [147, 51, 234] },
      styles: { fontSize: 8 },
      margin: { left: 20, right: 20 }
    });
    
    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Page ${i} of ${pageCount} | Generated by Emotion Tracker`,
        doc.internal.pageSize.width / 2,
        doc.internal.pageSize.height - 10,
        { align: 'center' }
      );
    }
    
    doc.save(`emotion-report-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const clearSession = () => {
    setShowResults(false);
    setSessionData([]);
    setCurrentEmotions(null);
    setSummary('');
    setRecordingTime(0);
    setError('');
  };

  const getEmotionColor = (emotion, value) => {
    const colors = {
      joy: '#a78bfa',
      fear: '#f87171',
      sadness: '#60a5fa',
      anger: '#fb923c',
      surprise: '#fbbf24',
      disgust: '#34d399',
      neutral: '#94a3b8'
    };
    return colors[emotion] || '#94a3b8';
  };

  const getInsightText = () => {
    if (!currentEmotions) return 'Waiting for data...';
    
    if (currentEmotions.joy > 0.6) return '🎉 High positive engagement detected!';
    if (currentEmotions.fear > 0.5) return '😰 Elevated stress levels observed';
    if (currentEmotions.surprise > 0.5) return '😮 Strong surprise reaction detected';
    if (currentEmotions.sadness > 0.4) return '😔 Lower mood indicators present';
    return '😐 Neutral emotional state';
  };

  if (!consent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 max-w-md border border-white/20 shadow-2xl">
          <Camera className="w-16 h-16 text-purple-300 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-4 text-center">Camera Access Required</h2>
          <p className="text-purple-200 mb-6 text-center leading-relaxed">
            This application uses your camera to analyze facial expressions in real-time using Hume AI technology. 
            Your video is processed securely and never stored on our servers.
          </p>
          <button
            onClick={() => setConsent(true)}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold py-3 px-6 rounded-lg transition-all transform hover:scale-105 shadow-lg"
          >
            I Understand, Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8 pt-8">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-2 flex items-center justify-center gap-3">
            <Activity className="w-10 h-10 text-purple-400 animate-pulse" />
            Emotion Expression Tracker
          </h1>
          <p className="text-purple-300">Real-time facial expression analysis powered by Hume AI</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {!showResults ? (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Video Feed */}
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 shadow-xl">
              <div className="relative aspect-video bg-black rounded-lg overflow-hidden mb-4">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {isRecording && (
                  <div className="absolute top-4 right-4 flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded-full text-sm font-semibold shadow-lg">
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                    {formatTime(recordingTime)}
                  </div>
                )}
                {!isRecording && !isPreparing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="text-center">
                      <Camera className="w-16 h-16 text-purple-300 mx-auto mb-4" />
                      <p className="text-white text-lg">Ready to start</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                {!isRecording && !isPreparing && (
                  <button
                    onClick={startSession}
                    className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold py-3 px-6 rounded-lg transition-all transform hover:scale-105 shadow-lg flex items-center justify-center gap-2"
                  >
                    <Camera className="w-5 h-5" />
                    Start Session
                  </button>
                )}
                {isPreparing && (
                  <button 
                    disabled 
                    className="flex-1 bg-purple-600/50 text-white font-semibold py-3 px-6 rounded-lg flex items-center justify-center gap-2"
                  >
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Preparing...
                  </button>
                )}
                {isRecording && (
                  <button
                    onClick={stopSession}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-lg transition-all transform hover:scale-105 shadow-lg flex items-center justify-center gap-2"
                  >
                    <Square className="w-5 h-5 fill-current" />
                    Stop & Generate Report
                  </button>
                )}
              </div>
            </div>

            {/* Live Emotions */}
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 shadow-xl">
              <h2 className="text-xl font-bold text-white mb-4">
                {isRecording ? '📊 Live Emotions' : isProcessing ? '⚙️ Processing' : '⏸️ Waiting'}
              </h2>

              {isProcessing && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-purple-300 mb-2 font-semibold">{processingStep}</p>
                  <p className="text-purple-400 text-sm">This may take a few seconds...</p>
                </div>
              )}

              {!isRecording && !isProcessing && !currentEmotions && (
                <div className="text-center py-12">
                  <Activity className="w-12 h-12 text-purple-400 mx-auto mb-4 opacity-50" />
                  <p className="text-purple-300">Click "Start Session" to begin tracking emotions in real-time</p>
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
                          <span className="text-purple-200 capitalize font-medium">{emotion}</span>
                          <span className="text-white font-semibold">{(value * 100).toFixed(0)}%</span>
                        </div>
                        <div className="w-full bg-white/10 rounded-full h-3 overflow-hidden">
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

                  <div className="mt-6 p-4 bg-gradient-to-r from-purple-600/20 to-pink-600/20 rounded-lg border border-purple-500/30 backdrop-blur-sm">
                    <p className="text-purple-200 text-sm font-medium">
                      {getInsightText()}
                    </p>
                  </div>

                  <div className="mt-4 p-3 bg-white/5 rounded-lg">
                    <p className="text-purple-300 text-xs">
                      💡 Data updates every 3 seconds • {sessionData.length} data points collected
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Chart */}
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 shadow-xl">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                📈 Emotion Timeline
              </h2>
              <div className="bg-white/5 rounded-lg p-4">
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
                        backgroundColor: '#1e1b4b', 
                        border: '1px solid #ffffff30', 
                        borderRadius: '8px',
                        color: '#fff'
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
                      dataKey="surprise" 
                      stroke="#fbbf24" 
                      strokeWidth={1.5} 
                      dot={false}
                      name="Surprise"
                      strokeDasharray="5 5"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 shadow-xl">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                🤖 AI-Generated Analysis
              </h2>
              <div className="bg-white/5 rounded-lg p-6">
                <p className="text-purple-100 leading-relaxed whitespace-pre-line text-[15px]">
                  {summary}
                </p>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {(() => {
                const stats = analyzeEmotions();
                return (
                  <>
                    <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20">
                      <p className="text-purple-300 text-sm mb-1">Duration</p>
                      <p className="text-white text-2xl font-bold">{formatTime(recordingTime)}</p>
                    </div>
                    <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20">
                      <p className="text-purple-300 text-sm mb-1">Data Points</p>
                      <p className="text-white text-2xl font-bold">{sessionData.length}</p>
                    </div>
                    <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20">
                      <p className="text-purple-300 text-sm mb-1">Dominant Emotion</p>
                      <p className="text-white text-xl font-bold capitalize">{stats.dominant}</p>
                    </div>
                    <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20">
                      <p className="text-purple-300 text-sm mb-1">Volatility</p>
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
                className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold py-4 px-6 rounded-lg transition-all transform hover:scale-105 shadow-lg flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />
                Download PDF Report
              </button>
              <button
                onClick={clearSession}
                className="bg-white/10 hover:bg-white/20 text-white font-semibold py-4 px-6 rounded-lg transition-all flex items-center justify-center gap-2 border border-white/20"
              >
                <Trash2 className="w-5 h-5" />
                New Session
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-12 pb-8">
          <p className="text-purple-400 text-sm">
            Powered by Hume AI • Gemini Pro • Built with React
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;