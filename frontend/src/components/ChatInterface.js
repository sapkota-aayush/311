import React, { useState, useRef, useEffect, useCallback } from 'react';
import './ChatInterface.css';

const ChatInterface = ({ initialQuery = '', onBack }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('en'); // 'en' or 'fr'
  const [vizOpenByMessageId, setVizOpenByMessageId] = useState({});
  const [isListening, setIsListening] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState('incorrect');
  const [reportNote, setReportNote] = useState('');
  const [reportCopied, setReportCopied] = useState(false);
  const messagesContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const initialQuerySubmitted = useRef(false);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordTimerRef = useRef(null);

  const canUseSpeechRecognition = () => {
    return typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  };

  const canUseSpeechSynthesis = () => {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined';
  };

  const canUseMediaRecorder = () => {
    return typeof window !== 'undefined' && 'MediaRecorder' in window && navigator?.mediaDevices?.getUserMedia;
  };

  // Mobile viewport stabilization (iOS keyboard can change viewport height)
  useEffect(() => {
    const setVh = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--app-vh', `${vh}px`);
    };
    setVh();
    window.addEventListener('resize', setVh);
    window.addEventListener('orientationchange', setVh);
    return () => {
      window.removeEventListener('resize', setVh);
      window.removeEventListener('orientationchange', setVh);
    };
  }, []);

  // Translation map for UI text
  const translations = {
    en: {
      placeholder: "Ask me anything about Kingston city services...",
      disclaimer: "AI can make mistakes. Verify important info at",
      backToHome: "Back to Home",
      welcomeTitle: "How can I help you today?",
      welcomeSubtitle: "Ask about waste schedules, parking bylaws, or upcoming city events.",
      botName: "Kingston AI Assistant"
    },
    fr: {
      placeholder: "Posez-moi n'importe quelle question sur les services municipaux de Kingston...",
      disclaimer: "L'IA peut faire des erreurs. Vérifiez les informations importantes sur",
      backToHome: "Retour à l'accueil",
      welcomeTitle: "Comment puis-je vous aider aujourd'hui?",
      welcomeSubtitle: "Posez des questions sur les horaires de collecte, les règlements de stationnement ou les événements à venir.",
      botName: "Assistant IA de Kingston"
    }
  };

  // Auto-submit initial query if provided (only once)
  useEffect(() => {
    if (initialQuery && !initialQuerySubmitted.current && messages.length === 0) {
      initialQuerySubmitted.current = true;
      setTimeout(() => {
        handleSubmit(null, initialQuery);
      }, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const scrollToBottom = useCallback((shouldScroll = true) => {
    // Avoid pushing the welcome screen up on initial load (mobile especially)
    if (!shouldScroll) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom(messages.length > 0);
  }, [messages.length, scrollToBottom]);

  // Auto-focus input on mount (for mobile keyboard)
  useEffect(() => {
    // Small delay to ensure page is fully loaded
    const timer = setTimeout(() => {
      if (inputRef.current && messages.length === 0) {
        inputRef.current.focus();
        // Keep the welcome section anchored at the top when the keyboard opens
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = 0;
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [messages.length]);

  // Cleanup speech resources on unmount
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch (e) {
        // ignore
      }
      try {
        if (canUseSpeechSynthesis()) window.speechSynthesis.cancel();
      } catch (e) {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If user switches language while speaking, stop current speech.
  useEffect(() => {
    try {
      if (canUseSpeechSynthesis()) window.speechSynthesis.cancel();
    } catch (e) {
      // ignore
    }
    setSpeakingMessageId(null);
  }, [language]);

  const startListening = () => {
    if (!canUseSpeechRecognition()) return;
    if (isListening) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    recognitionRef.current = rec;
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = language === 'fr' ? 'fr-CA' : 'en-CA';

    let finalTranscript = '';

    rec.onstart = () => setIsListening(true);
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const txt = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) finalTranscript += txt;
        else interim += txt;
      }
      const combined = (finalTranscript + ' ' + interim).trim().replace(/\s+/g, ' ');
      if (combined) setInput(combined);
    };

    try {
      rec.start();
    } catch (e) {
      setIsListening(false);
    }
  };

  const stopListening = () => {
    try {
      recognitionRef.current?.stop();
    } catch (e) {
      // ignore
    }
    setIsListening(false);
  };

  const transcribeWithWhisper = async (blob) => {
    const baseUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';
    const url = `${baseUrl}/audio/transcribe`;
    const form = new FormData();
    form.append('audio', blob, 'recording.webm');
    // backend expects language as query param; send it as part of URL to keep it simple
    const qs = language ? `?language=${encodeURIComponent(language)}` : '';
    const res = await fetch(url + qs, { method: 'POST', body: form });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || 'Transcription failed');
    }
    const data = await res.json();
    return (data?.text || '').toString().trim();
  };

  const startRecording = async () => {
    if (!canUseMediaRecorder() || isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];

      // Pick a supported mime type (improves reliability across browsers)
      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
      ];
      let mimeType = '';
      for (const t of preferredTypes) {
        try {
          if (window.MediaRecorder && window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(t)) {
            mimeType = t;
            break;
          }
        } catch (e) {
          // ignore
        }
      }
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = rec;

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        // Stop microphone
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        if (recordTimerRef.current) {
          clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        setRecordingSeconds(0);

        const blob = new Blob(recordedChunksRef.current, { type: mimeType || 'audio/webm' });
        if (!blob || blob.size < 2000) return;
        try {
          setIsTranscribing(true);
          const text = await transcribeWithWhisper(blob);
          if (text) setInput(text);
        } catch (e) {
          console.error(e);
        } finally {
          setIsTranscribing(false);
        }
      };

      setIsRecording(true);
      setRecordingSeconds(0);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      recordTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);

      // Collect chunks periodically; helps ensure we get data even on short recordings
      rec.start(250);
    } catch (e) {
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    try {
      mediaRecorderRef.current?.stop();
    } catch (e) {
      // ignore
    }
    setIsRecording(false);
  };

  const speakMessage = (message) => {
    const text = (message?.text || '').toString().trim();
    if (!text) return;

    // Toggle stop if already speaking this message
    if (speakingMessageId === message.id) {
      try {
        if (canUseSpeechSynthesis()) window.speechSynthesis.cancel();
      } catch (e) {
        // ignore
      }
      setSpeakingMessageId(null);
      return;
    }

    const tryAiTts = async () => {
      const baseUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';
      const url = `${baseUrl}/audio/speak`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language, voice: 'alloy' }),
      });
      if (!res.ok) throw new Error('TTS failed');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      audio.onended = () => {
        URL.revokeObjectURL(objectUrl);
        setSpeakingMessageId(null);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setSpeakingMessageId(null);
      };
      audio.play();
    };

    setSpeakingMessageId(message.id);
    tryAiTts().catch(() => {
      // fallback to browser speech
      if (!canUseSpeechSynthesis()) {
        setSpeakingMessageId(null);
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utter = new window.SpeechSynthesisUtterance(text);
        utter.lang = language === 'fr' ? 'fr-CA' : 'en-CA';
        utter.rate = 1.0;
        utter.pitch = 1.0;
        utter.onend = () => setSpeakingMessageId(null);
        utter.onerror = () => setSpeakingMessageId(null);
        window.speechSynthesis.speak(utter);
      } catch (e) {
        setSpeakingMessageId(null);
      }
    });
  };

  const handleSubmit = async (e, queryOverride = null) => {
    e?.preventDefault();
    const queryText = queryOverride || input.trim();
    if (!queryText || loading) return;

    const userMessage = {
      type: 'user',
      text: queryText,
      timestamp: new Date(),
      id: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    // Create a placeholder bot message for streaming
    const botMessageId = Date.now() + 1;
    const botMessage = {
      type: 'bot',
      text: '',
      results: [],
      timestamp: new Date(),
      id: botMessageId,
      streaming: true
    };
    setMessages(prev => [...prev, botMessage]);

    try {
      const baseUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';
      const apiUrl = `${baseUrl}/query/stream`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: queryText,
          top_k: 3,
          language: language // Send language preference to backend
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const accumulatedTextRef = { current: '' };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'text' && data.content) {
                accumulatedTextRef.current += data.content;
                
                setMessages(prev => prev.map(msg => 
                  msg.id === botMessageId 
                    ? { ...msg, text: accumulatedTextRef.current }
                    : msg
                ));
                scrollToBottom(true);
              } else if (data.type === 'results') {
                setMessages(prev => prev.map(msg => 
                  msg.id === botMessageId 
                    ? { ...msg, results: data.results || [] }
                    : msg
                ));
              } else if (data.type === 'done' || data.done) {
                setMessages(prev => prev.map(msg => 
                  msg.id === botMessageId 
                    ? { ...msg, streaming: false }
                    : msg
                ));
              } else if (data.type === 'error') {
                throw new Error(data.content);
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }

      // Finalize the message
      setMessages(prev => prev.map(msg => 
        msg.id === botMessageId 
          ? { ...msg, streaming: false, text: accumulatedTextRef.current.trim() }
          : msg
      ));

    } catch (error) {
      console.error('Error querying backend:', error);
      
      setMessages(prev => {
        const filtered = prev.filter(msg => msg.id !== botMessageId);
        filtered.push({
          type: 'bot',
          text: `Sorry, I'm having trouble connecting right now. Error: ${error.message}. Please check if the backend is running or contact 311 at 613-546-0000.`,
          timestamp: new Date(),
          id: botMessageId
        });
        return filtered;
      });
    } finally {
      setLoading(false);
    }
  };

  // Clean and format text
  const renderFormattedText = (text) => {
    if (!text) return text;
    
    const lines = text.split('\n');
    const elements = [];
    let currentList = [];
    let listType = null;
    let keyCounter = 0;
    
    const flushList = () => {
      if (currentList.length > 0) {
        const Tag = listType === 'numbered' ? 'ol' : 'ul';
        elements.push(
          <Tag key={`list-${keyCounter++}`} className="message-list">
            {currentList.map((item, idx) => (
              <li key={idx}>{formatText(item)}</li>
            ))}
          </Tag>
        );
        currentList = [];
        listType = null;
      }
    };
    
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        flushList();
        return;
      }
      
      // Clean up asterisks from headings (e.g., *Paymentus** -> Paymentus:)
      let cleaned = trimmed.replace(/^\*+|\*+$/g, '').trim();
      
      // Detect headings (ends with colon, not too long)
      if (cleaned.endsWith(':') && cleaned.length < 80) {
        flushList();
        const headingText = cleaned.slice(0, -1).trim();
        elements.push(
          <h3 key={`heading-${keyCounter++}`} className="message-heading">
            {formatText(headingText)}
          </h3>
        );
        return;
      }
      
      // Detect numbered lists
      const numberedMatch = cleaned.match(/^(\d+)\.\s*(.+)$/);
      if (numberedMatch) {
        // Only flush if we're switching list types
        if (listType && listType !== 'numbered') flushList();
        listType = 'numbered';
        currentList.push(numberedMatch[2].trim());
        return;
      }
      
      // Detect bullet lists
      if (cleaned.match(/^[-*•]\s+/)) {
        // Only flush if we're switching list types
        if (listType && listType !== 'bullet') flushList();
        listType = 'bullet';
        const content = cleaned.replace(/^[-*•]\s+/, '').trim();
        if (content) {
          currentList.push(content);
        }
        return;
      }
      
      // Regular paragraph
      flushList();
      if (cleaned) {
        elements.push(
          <p key={`para-${keyCounter++}`} className="message-paragraph">
            {formatText(cleaned)}
          </p>
        );
      }
    });
    
    flushList();
    return elements.length > 0 ? elements : text;
  };
  
  // Simple text formatter for bold and links
  const formatText = (text) => {
    if (!text) return text;
    
    const parts = [];
    let lastIndex = 0;
    
    // Match bold text (**text**)
    const boldRegex = /\*\*(.+?)\*\*/g;
    let match;
    
    while ((match = boldRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
      }
      parts.push({ type: 'bold', content: match[1] });
      lastIndex = match.index + match[0].length;
    }
    
    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.substring(lastIndex) });
    }
    
    if (parts.length === 0) {
      parts.push({ type: 'text', content: text });
    }
    
    const result = [];
    parts.forEach((part, idx) => {
      if (part.type === 'bold') {
        result.push(<strong key={idx}>{part.content}</strong>);
      } else {
        // Check for URLs in text parts
        const urlRegex = /(https?:\/\/[^\s)]+)/g;
        const urlParts = part.content.split(urlRegex);
        urlParts.forEach((urlPart, urlIdx) => {
          if (urlRegex.test(urlPart)) {
            result.push(
              <a
                key={`${idx}-${urlIdx}`}
                href={urlPart}
                target="_blank"
                rel="noopener noreferrer"
                className="message-link"
              >
                {urlPart}
              </a>
            );
          } else if (urlPart) {
            result.push(<span key={`${idx}-${urlIdx}`}>{urlPart}</span>);
          }
        });
      }
    });
    
    return result.length > 0 ? result : text;
  };

  // Function to determine if results should be shown
  const shouldShowResults = (messageText, results) => {
    if (!messageText || !results || results.length === 0) return false;

    // If there are no links, there's nothing to show.
    const hasLinks = results.some(r => r && r.source_url);
    if (!hasLinks) return false;
    
    const text = (messageText || '').trim();
    const textLower = text.toLowerCase();

    // Only hide sources for actual greeting-style responses.
    // IMPORTANT: avoid substring matches like "this" containing "hi".
    const greetingRegexes = [
      /^(hi|hello|hey)\b/i,
      /^good (morning|afternoon|evening)\b/i,
      /^how are you\b/i,
      /^how can i help\b/i,
      /^what can i help\b/i,
    ];

    if (greetingRegexes.some(r => r.test(textLower))) {
      return false;
    }
    
    if (text.split(' ').length < 10 && /\bhelp\b/i.test(textLower)) {
      return false;
    }

    // For any real Q&A response: if the backend gave us links, show them.
    return true;
  };

  const t = translations[language];

  const humanizeSlug = (slug) => {
    if (!slug) return '';
    const decoded = decodeURIComponent(slug);
    const cleaned = decoded
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return '';
    // Title-case-ish without being too aggressive
    return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const titleFromUrl = (url) => {
    try {
      const u = new URL(url);
      const parts = (u.pathname || '').split('/').filter(Boolean);
      if (parts.length === 0) return u.hostname.replace(/^www\./, '');

      // Prefer last 2 path segments for better specificity (e.g., "Bylaws — Noise")
      const tail = parts.slice(-2).map(humanizeSlug).filter(Boolean);
      const joined = tail.join(' — ');
      return joined || u.hostname.replace(/^www\./, '');
    } catch (e) {
      return (url || '').trim();
    }
  };

  const normalizeUrlForDedupe = (url) => {
    try {
      const u = new URL(url);
      // Strip query/hash and trailing slash
      const path = (u.pathname || '').replace(/\/+$/, '');
      return `${u.origin}${path}`;
    } catch (e) {
      return (url || '').trim().replace(/\/+$/, '');
    }
  };

  const getSourceLabel = (result) => {
    const url = (result?.source_url || '').trim();
    let host = '';
    try {
      host = url ? new URL(url).hostname.replace(/^www\./, '') : '';
    } catch (e) {
      host = '';
    }

    const category = (result?.category || '').toLowerCase();
    // Dynamic search already provides human titles in `content`
    if (category === 'dynamic_search') {
      const title = (result?.content || '').trim();
      return title || host || 'Official source';
    }

    // Prefer an explicit title if backend provides one, else derive from URL path.
    const explicitTitle = (result?.title || result?.page_title || '').toString().trim();
    if (explicitTitle) return explicitTitle;

    if (url) return titleFromUrl(url);
    return host || 'Official source';
  };

  const getFreshnessBadge = (result) => {
    const lastmod = (result?.lastmod || '').toString().trim();
    if (lastmod) {
      // Show date part only for simplicity
      const date = lastmod.split('T')[0];
      return `Updated ${date}`;
    }

    return null;
  };

  const dedupeSources = (results, limit = 6) => {
    if (!Array.isArray(results)) return [];
    const out = [];
    const seen = new Set();
    for (const r of results) {
      const url = (r?.source_url || '').trim();
      if (!url) continue;
      const key = normalizeUrlForDedupe(url);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  };

  const canVisualize = (message) => {
    const results = message?.results || [];
    if (!Array.isArray(results) || results.length === 0) return false;

    // Demo visualization: property tax (public, non-personal).
    return results.some((r) => {
      const url = (r?.source_url || '').toLowerCase();
      const category = (r?.category || '').toLowerCase();
      const topic = (r?.topic || '').toLowerCase();
      return category === 'property_tax' || topic.includes('property') || url.includes('/property-taxes/');
    });
  };

  const VizCard = () => {
    // Minimal, safe visualization: tax-bill timeline (no personal data).
    const items = [
      { label: 'Interim bill due', month: 'Feb' },
      { label: 'Final bill due', month: 'Jun' },
    ];

    const monthIndex = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
    const bars = items.map((it) => ({ ...it, value: monthIndex[it.month] || 0 }));

    // Bar chart demo: compare number of instalments for common pre-authorized plans.
    const plans = [
      { label: 'Monthly pre-authorized plan', value: 10, suffix: 'instalments' },
      { label: 'Due-date instalment plan', value: 2, suffix: 'instalments' },
    ];
    const maxPlan = Math.max(...plans.map((p) => p.value));

    return (
      <div className="viz-card" role="region" aria-label="Visualization">
        <div className="viz-title">Property tax timeline (typical)</div>
        <div className="viz-subtitle">Common due months for interim and final bills (confirm via official sources).</div>

        <div className="viz-chart">
          <div className="viz-axis">
            {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m) => (
              <div key={m} className="viz-tick">{m}</div>
            ))}
          </div>
          <div className="viz-rows">
            {bars.map((b) => (
              <div key={b.label} className="viz-row">
                <div className="viz-row-label">{b.label}</div>
                <div className="viz-row-barwrap">
                  <div className="viz-row-bar" style={{ width: `${(b.value / 12) * 100}%` }} />
                  <div className="viz-row-dot" style={{ left: `${(b.value / 12) * 100}%` }} />
                </div>
                <div className="viz-row-value">{b.month}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="viz-divider" />

        <div className="viz-title">Pre-authorized payment plans (instalments)</div>
        <div className="viz-subtitle">A quick comparison of how many payments each plan typically uses.</div>

        <div className="viz-bars">
          {plans.map((p) => (
            <div key={p.label} className="viz-bar-row">
              <div className="viz-bar-label">{p.label}</div>
              <div className="viz-bar-track" aria-label={`${p.label}: ${p.value} ${p.suffix}`}>
                <div className="viz-bar-fill" style={{ width: `${(p.value / maxPlan) * 100}%` }} />
              </div>
              <div className="viz-bar-value">{p.value}</div>
            </div>
          ))}
        </div>

        <div className="viz-note">Tip: Use the “Official Sources” links below to confirm dates and options.</div>
      </div>
    );
  };

  const buildReportPayload = () => {
    if (!reportTarget) return null;
    const idx = messages.findIndex((m) => m?.id === reportTarget?.id);
    const prevUser = idx > 0 ? messages.slice(0, idx).reverse().find((m) => m?.type === 'user') : null;
    const sources = Array.isArray(reportTarget?.results)
      ? reportTarget.results
          .map((r) => r?.source_url)
          .filter(Boolean)
          .slice(0, 8)
      : [];

    return {
      type: 'kingston_ai_report',
      created_at: new Date().toISOString(),
      language,
      reason: reportReason,
      note: (reportNote || '').trim(),
      user_query: prevUser?.text || '',
      assistant_answer: reportTarget?.text || '',
      sources,
    };
  };

  const openReport = (message) => {
    setReportCopied(false);
    setReportReason('incorrect');
    setReportNote('');
    setReportTarget(message);
    setReportOpen(true);
  };

  const copyReport = async () => {
    const payload = buildReportPayload();
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 1500);
    } catch (e) {
      // fallback: no-op
      setReportCopied(false);
    }
  };

  const submitReport = async () => {
    const payload = buildReportPayload();
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setReportOpen(false);
    } catch (e) {
      // If clipboard isn't available, download instead (still no backend)
      downloadReport();
      setReportOpen(false);
    }
  };

  const downloadReport = () => {
    const payload = buildReportPayload();
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kingston-ai-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="chat-interface">
      {onBack && (
        <div className="chat-header">
          <button className="back-button" onClick={onBack}>
            <img 
              src="/Black-Kingston-Logo.png" 
              alt="City of Kingston" 
              className="header-logo"
            />
            <span className="material-symbols-outlined">arrow_back</span>
            {t.backToHome}
          </button>
          <div className="language-selector">
            <select 
              value={language} 
              onChange={(e) => setLanguage(e.target.value)}
              className="language-select"
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
            </select>
          </div>
        </div>
      )}
      {!onBack && (
        <div className="chat-header-top">
          <div className="language-selector">
            <select 
              value={language} 
              onChange={(e) => setLanguage(e.target.value)}
              className="language-select"
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
            </select>
          </div>
        </div>
      )}
      <div className="messages-container" ref={messagesContainerRef}>
        {messages.length === 0 && (
          <div className="welcome-section">
            <h1 className="welcome-title">{t.welcomeTitle}</h1>
            <p className="welcome-subtitle">{t.welcomeSubtitle}</p>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={message.id || index} className={`message ${message.type}`}>
            {message.type === 'user' ? (
              <div className="user-message-bubble">
                <p>{message.text}</p>
              </div>
            ) : (
              <div className="bot-message-card">
                <div className="bot-message-header">
                  <div className="bot-avatar">
                    <img 
                      src="/Black-Kingston-Logo.png" 
                      alt="City of Kingston" 
                      className="avatar-logo"
                    />
                  </div>
                  <h3 className="bot-name">{t.botName}</h3>
                  {canUseSpeechSynthesis() && message.text && !message.streaming && (
                    <button
                      type="button"
                      className="tts-button"
                      onClick={() => speakMessage(message)}
                      aria-label={speakingMessageId === message.id ? 'Stop speaking' : 'Speak answer'}
                      title={speakingMessageId === message.id ? 'Stop' : 'Speak'}
                    >
                      <span className="material-symbols-outlined">
                        {speakingMessageId === message.id ? 'stop_circle' : 'volume_up'}
                      </span>
                    </button>
                  )}
                  {message.text && !message.streaming && (
                    <button
                      type="button"
                      className="report-button"
                      onClick={() => openReport(message)}
                      aria-label="Report this response"
                      title="Report"
                    >
                      <span className="material-symbols-outlined">flag</span>
                    </button>
                  )}
                </div>
                <div className="bot-message-content">
                  {message.streaming && !message.text ? (
                    <div className="loading-dots">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  ) : message.text ? (
                    <>
                      <div className="message-text-content">
                        {renderFormattedText(message.text)}
                        {message.streaming && (
                          <span className="streaming-cursor">▋</span>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>

                {canVisualize(message) && (
                  <div className="viz-toggle-wrap">
                    <button
                      type="button"
                      className="viz-toggle"
                      onClick={() =>
                        setVizOpenByMessageId((prev) => ({
                          ...prev,
                          [message.id]: !prev?.[message.id],
                        }))
                      }
                    >
                      <span className="material-symbols-outlined">bar_chart</span>
                      {vizOpenByMessageId?.[message.id] ? 'Hide visualization' : 'Visualize'}
                    </button>
                  </div>
                )}

                {canVisualize(message) && vizOpenByMessageId?.[message.id] && <VizCard />}

                {message.results && message.results.length > 0 && shouldShowResults(message.text, message.results) && (
                  <div className="message-sources">
                    <p className="sources-label">Official Sources</p>
                    <div className="sources-list">
                      {dedupeSources(message.results, 6).map((result, idx) => (
                        <a 
                          key={idx}
                          href={result.source_url} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="source-link"
                        >
                          <span className="material-symbols-outlined">link</span>
                          <span className="source-link-text">{getSourceLabel(result)}</span>
                          {getFreshnessBadge(result) && (
                            <span className="source-freshness">{getFreshnessBadge(result)}</span>
                          )}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-container">
        <form onSubmit={handleSubmit} className="input-form">
          {(isRecording || isTranscribing) && (
            <div className="voice-status" aria-live="polite">
              {isRecording ? (
                <>
                  <span className="voice-dot" />
                  Recording… {recordingSeconds}s (tap to stop)
                </>
              ) : (
                <>
                  <span className="voice-spinner" />
                  Transcribing…
                </>
              )}
            </div>
          )}
          <div className="input-pill">
            <button
              type="button"
              className="pill-icon-button"
              aria-label="More options"
              title="More"
              disabled={loading}
              onClick={() => {
                // Placeholder for future: attachments / quick actions
              }}
            >
              <span className="material-symbols-outlined">add</span>
            </button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.placeholder}
              className="pill-input"
              disabled={loading}
            />
            <div className="pill-actions">
              {(canUseMediaRecorder() || canUseSpeechRecognition()) && (
                <button
                  type="button"
                  className={`pill-icon-button mic ${isRecording ? 'recording' : (isListening ? 'listening' : '')}`}
                  onClick={() => {
                    // Prefer AI transcription when MediaRecorder is available, otherwise fall back to browser speech recognition.
                    if (canUseMediaRecorder()) {
                      isRecording ? stopRecording() : startRecording();
                    } else {
                      isListening ? stopListening() : startListening();
                    }
                  }}
                  aria-label={isRecording || isListening ? 'Stop voice input' : 'Start voice input'}
                  title={isRecording ? 'Stop recording' : 'Start recording'}
                  disabled={loading || isTranscribing}
                >
                  <span className="material-symbols-outlined">
                    {isRecording ? 'stop_circle' : (isListening ? 'mic' : 'mic')}
                  </span>
                </button>
              )}
              <button type="submit" className="pill-send-button" disabled={loading || !input.trim()}>
                <span className="material-symbols-outlined">arrow_upward</span>
              </button>
            </div>
          </div>
          <p className="input-disclaimer">{t.disclaimer} <a href="https://www.cityofkingston.ca" target="_blank" rel="noopener noreferrer">kingston.ca</a></p>
        </form>
      </div>

      {reportOpen && (
        <div className="report-modal-overlay" role="dialog" aria-modal="true" aria-label="Report a response">
          <div className="report-modal">
            <div className="report-modal-header">
              <div className="report-modal-title">Report a response</div>
              <button
                type="button"
                className="report-close"
                onClick={() => setReportOpen(false)}
                aria-label="Close"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="report-modal-body">
              <div className="report-help">
                Please don’t include personal info. This creates a shareable report you can send to the team.
              </div>

              <label className="report-label">
                Reason
                <select
                  className="report-select"
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                >
                  <option value="incorrect">Incorrect / outdated</option>
                  <option value="missing">Missing details</option>
                  <option value="confusing">Confusing / unclear</option>
                  <option value="broken_link">Broken / wrong link</option>
                  <option value="other">Other</option>
                </select>
              </label>

              <label className="report-label">
                Note (optional)
                <textarea
                  className="report-textarea"
                  rows={4}
                  value={reportNote}
                  onChange={(e) => setReportNote(e.target.value)}
                  placeholder="What was wrong, and what should it say instead?"
                />
              </label>

              <div className="report-actions">
                <button type="button" className="report-secondary" onClick={downloadReport}>
                  <span className="material-symbols-outlined">download</span>
                  Download
                </button>
                <button type="button" className="report-secondary" onClick={copyReport}>
                  <span className="material-symbols-outlined">content_copy</span>
                  {reportCopied ? 'Copied' : 'Copy'}
                </button>
                <button type="button" className="report-primary" onClick={submitReport}>
                  <span className="material-symbols-outlined">flag</span>
                  Submit report
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatInterface;
