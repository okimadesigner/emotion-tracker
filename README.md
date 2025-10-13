# 🎭 Emotion Expression Tracker

> Real-time facial emotion analysis in the browser — no backend, all AI, zero fluff.

[![Deployed on Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?logo=vercel)](https://your-app-url.vercel.app)
[![Built with React + Vite](https://img.shields.io/badge/React%20+%20Vite-61DAFB?logo=react)](https://vitejs.dev)

---

### ✨ Features
- 📹 **Webcam capture** with real-time frame streaming  
- 🤖 **Emotion detection** via [Hume AI](https://hume.ai) (28+ emotions, WebSocket)  
- 📊 **Interactive timeline** with Recharts  
- 🧠 **AI narrative summary** powered by **Gemini Pro**  
- 📄 **One-click PDF report** (jsPDF + autotable)  
- 🎨 **Glassmorphic UI** with Tailwind CSS  

---

### ⚡ Tech Stack
- **Frontend**: React 18 + Vite  
- **Styling**: Tailwind CSS (`backdrop-blur`, gradients)  
- **Icons**: Lucide React  
- **Charts**: Recharts  
- **PDF**: jsPDF + jspdf-autotable  
- **AI**: Hume AI (vision) + Google Gemini Pro (text)  
- **Hosting**: Vercel (free tier, auto-deploy)  

---

### 🌐 How It Works
1. User grants webcam access  
2. Frames sent to Hume AI every 2s via WebSocket  
3. Emotion scores update live chart  
4. On stop → Gemini summarizes emotions  
5. PDF report generated & downloaded — **all client-side**

> 🔒 **Privacy-first**: Video never leaves the browser. API keys secured via Vercel env vars.
