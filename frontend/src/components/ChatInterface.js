import React, { useState, useRef, useEffect } from 'react';
import './ChatInterface.css';

const ChatInterface = ({ initialQuery = '', onBack }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const initialQuerySubmitted = useRef(false);

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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
          top_k: 3
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
                scrollToBottom();
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
        flushList();
        listType = 'numbered';
        currentList.push(numberedMatch[2].trim());
        return;
      }
      
      // Detect bullet lists
      if (cleaned.match(/^[-*•]\s+/)) {
        flushList();
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
    
    const textLower = messageText.toLowerCase();
    const greetingPatterns = [
      "hi", "hello", "hey", "how can i help", "what can i help",
      "how are you", "good morning", "good afternoon", "good evening"
    ];
    
    if (greetingPatterns.some(pattern => textLower.includes(pattern))) {
      return false;
    }
    
    if (messageText.split(' ').length < 10 && textLower.includes('help')) {
      return false;
    }
    
    const meaningfulResults = results.filter(result => {
      const content = (result.content || '').toLowerCase();
      return !content.includes('section menu') && 
             !content.includes('learn more') &&
             content.length > 50;
    });
    
    return meaningfulResults.length > 0;
  };

  return (
    <div className="chat-interface">
      {onBack && (
        <div className="chat-header">
          <button className="back-button" onClick={onBack}>
            <span className="material-symbols-outlined">arrow_back</span>
            Back to Home
          </button>
        </div>
      )}
      <div className="messages-container">
        {messages.length === 0 && (
          <div className="welcome-section">
            <h1 className="welcome-title">How can I help you today?</h1>
            <p className="welcome-subtitle">Ask about waste schedules, parking bylaws, or upcoming city events.</p>
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
                  <h3 className="bot-name">Kingston AI Assistant</h3>
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
                {message.results && message.results.length > 0 && shouldShowResults(message.text, message.results) && (
                  <div className="message-sources">
                    <p className="sources-label">Official Sources</p>
                    <div className="sources-list">
                      {message.results.filter(r => r.source_url).slice(0, 3).map((result, idx) => (
                        <a 
                          key={idx}
                          href={result.source_url} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="source-link"
                        >
                          <span className="material-symbols-outlined">link</span>
                          <span>{result.topic?.replace(/_/g, ' ') || 'Learn more'}</span>
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
          <div className="input-wrapper">
            <span className="input-icon material-symbols-outlined">chat_bubble</span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask me anything about Kingston city services..."
              className="chat-input"
              disabled={loading}
            />
            <button type="submit" className="send-button" disabled={loading || !input.trim()}>
              <span className="material-symbols-outlined">send</span>
            </button>
          </div>
          <p className="input-disclaimer">AI can make mistakes. Verify important info at <a href="https://www.cityofkingston.ca" target="_blank" rel="noopener noreferrer">kingston.ca</a></p>
        </form>
      </div>
    </div>
  );
};

export default ChatInterface;
