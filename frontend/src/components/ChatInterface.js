import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './ChatInterface.css';

const ChatInterface = ({ initialQuery = '', onBack }) => {
  const [messages, setMessages] = useState([
    {
      type: 'bot',
      text: "Hello! I'm the City of Kingston 311 assistant. I can help answer questions about city services, policies, and information. What can I help you with today?",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const initialQuerySubmitted = useRef(false);

  // Auto-submit initial query if provided (only once)
  useEffect(() => {
    if (initialQuery && !initialQuerySubmitted.current && messages.length === 1) {
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
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    // Create a placeholder bot message for streaming
    const botMessageId = Date.now();
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
      let accumulatedText = '';

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
                // Clean up extra spaces
                const cleanContent = data.content.replace(/\s+/g, ' ').trim();
                accumulatedText += cleanContent;
                
                // Update the streaming message
                setMessages(prev => prev.map(msg => 
                  msg.id === botMessageId 
                    ? { ...msg, text: accumulatedText }
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
          ? { ...msg, streaming: false, text: accumulatedText.trim() }
          : msg
      ));

    } catch (error) {
      console.error('Error querying backend:', error);
      
      // Remove the streaming message and add error message
      setMessages(prev => {
        const filtered = prev.filter(msg => msg.id !== botMessageId);
        filtered.push({
          type: 'bot',
          text: "Sorry, I'm having trouble connecting right now. Please try again or contact 311 at 613-546-0000.",
          timestamp: new Date()
        });
        return filtered;
      });
    } finally {
      setLoading(false);
    }
  };

  const formatResponse = (results) => {
    if (!results || results.length === 0) {
      return "I couldn't find specific information about that. Please try rephrasing your question.";
    }

    // Check if first result is a direct answer from OpenAI
    const firstResult = results[0];
    let response = '';
    
    if (firstResult.topic === 'direct_answer') {
      // First result is the direct answer - use it directly
      response = firstResult.content;
    } else {
      // No direct answer generated, use first result content
      const content = firstResult.content;
      const preview = content.substring(0, 300);
      response = preview;
      if (content.length > 300) {
        response += '...';
      }
    }

    // Add source URL if available (skip if it's the direct answer result)
    if (firstResult.source_url && firstResult.topic !== 'direct_answer') {
      response += `\n\nFor more information, visit: ${firstResult.source_url}`;
    }

    // Add fallback contact info
    response += '\n\nIf you need further assistance, please contact 311 at 613-546-0000.';

    return response;
  };

  // Function to determine if results should be shown
  const shouldShowResults = (messageText, results) => {
    if (!messageText || !results || results.length === 0) return false;
    
    const textLower = messageText.toLowerCase();
    
    // Don't show results for greetings
    const greetingPatterns = [
      "hi", "hello", "hey", "how can i help", "what can i help",
      "how are you", "good morning", "good afternoon", "good evening"
    ];
    
    if (greetingPatterns.some(pattern => textLower.includes(pattern))) {
      return false;
    }
    
    // Don't show if message is too short (likely greeting)
    if (messageText.split(' ').length < 10 && textLower.includes('help')) {
      return false;
    }
    
    // Only show if there are meaningful results (not just navigation/menu items)
    const meaningfulResults = results.filter(result => {
      const content = (result.content || '').toLowerCase();
      // Filter out menu/navigation content
      return !content.includes('section menu') && 
             !content.includes('learn more') &&
             content.length > 50; // Must have substantial content
    });
    
    return meaningfulResults.length > 0;
  };

  // Function to render formatted text with markdown support
  const renderFormattedText = (text) => {
    if (!text) return text;
    
    // Split by lines to handle lists and formatting
    const lines = text.split('\n');
    const elements = [];
    let listItems = [];
    let inCodeBlock = false;
    let codeBlockContent = [];
    
    lines.forEach((line, lineIndex) => {
      // Handle code blocks
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          // End code block
          elements.push(
            <pre key={`code-${lineIndex}`} className="message-code-block">
              <code>{codeBlockContent.join('\n')}</code>
            </pre>
          );
          codeBlockContent = [];
          inCodeBlock = false;
        } else {
          // Start code block
          inCodeBlock = true;
        }
        return;
      }
      
      if (inCodeBlock) {
        codeBlockContent.push(line);
        return;
      }
      
      // Process numbered lists
      const numberedListMatch = line.match(/^(\d+)\.\s+(.+)$/);
      if (numberedListMatch) {
        listItems.push({ type: 'numbered', content: numberedListMatch[2] });
        return;
      }
      
      // Process bullet lists
      const bulletListMatch = line.match(/^[-*]\s+(.+)$/);
      if (bulletListMatch) {
        listItems.push({ type: 'bullet', content: bulletListMatch[1] });
        return;
      }
      
      // If we have accumulated list items and hit a non-list line, render them
      if (listItems.length > 0) {
        const listType = listItems[0].type === 'numbered' ? 'ol' : 'ul';
        elements.push(
          React.createElement(
            listType,
            { key: `list-${lineIndex}`, className: 'message-list' },
            listItems.map((item, idx) => (
              <li key={idx}>{formatInlineMarkdown(item.content)}</li>
            ))
          )
        );
        listItems = [];
      }
      
      // Process regular lines
      if (line.trim()) {
        elements.push(
          <p key={`line-${lineIndex}`} className="message-paragraph">
            {formatInlineMarkdown(line)}
          </p>
        );
      } else {
        // Empty line for spacing
        elements.push(<br key={`br-${lineIndex}`} />);
      }
    });
    
    // Handle any remaining list items
    if (listItems.length > 0) {
      const listType = listItems[0].type === 'numbered' ? 'ol' : 'ul';
      elements.push(
        React.createElement(
          listType,
          { key: 'list-final', className: 'message-list' },
          listItems.map((item, idx) => (
            <li key={idx}>{formatInlineMarkdown(item.content)}</li>
          ))
        )
      );
    }
    
    return elements.length > 0 ? elements : text;
  };
  
  // Function to format inline markdown (bold, links, etc.) - with space cleanup
  const formatInlineMarkdown = (text) => {
    if (!text) return text;
    
    // Clean up extra spaces first (but preserve single spaces)
    text = text.replace(/\s+/g, ' ').trim();
    
    const parts = [];
    let currentIndex = 0;
    
    // Pattern to match: **bold**, URLs, or regular text
    const patterns = [
      { regex: /\*\*(.+?)\*\*/g, type: 'bold' },
      { regex: /(https?:\/\/[^\s\)]+)/g, type: 'url' }
    ];
    
    // Find all matches
    const matches = [];
    patterns.forEach(({ regex, type }) => {
      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          type,
          content: match[1] || match[0],
          fullMatch: match[0]
        });
      }
    });
    
    // Sort matches by position
    matches.sort((a, b) => a.start - b.start);
    
    // Remove overlapping matches (prefer bold over URLs if they overlap)
    const filteredMatches = [];
    matches.forEach(match => {
      const overlaps = filteredMatches.some(existing => 
        (match.start < existing.end && match.end > existing.start)
      );
      if (!overlaps) {
        filteredMatches.push(match);
      }
    });
    
    // Build the parts array
    filteredMatches.forEach((match) => {
      // Add text before match
      if (match.start > currentIndex) {
        const beforeText = text.substring(currentIndex, match.start);
        if (beforeText.trim()) {
          parts.push({ type: 'text', content: beforeText });
        }
      }
      
      // Add the formatted match
      if (match.type === 'bold') {
        parts.push({ type: 'bold', content: match.content });
      } else if (match.type === 'url') {
        parts.push({ type: 'url', content: match.content });
      }
      
      currentIndex = match.end;
    });
    
    // Add remaining text
    if (currentIndex < text.length) {
      const remainingText = text.substring(currentIndex);
      if (remainingText.trim()) {
        parts.push({ type: 'text', content: remainingText });
      }
    }
    
    // If no matches, return original text with URL linking
    if (parts.length === 0) {
      const urlRegex = /(https?:\/\/[^\s\)]+)/g;
      const urlParts = text.split(urlRegex);
      return urlParts.map((part, idx) => {
        if (urlRegex.test(part)) {
          return (
            <a
              key={idx}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="message-link"
            >
              {part}
            </a>
          );
        }
        return part ? <span key={idx}>{part}</span> : null;
      }).filter(Boolean);
    }
    
    // Render parts
    return parts.map((part, idx) => {
      if (part.type === 'bold') {
        return <strong key={idx}>{part.content}</strong>;
      } else if (part.type === 'url') {
        return (
          <a
            key={idx}
            href={part.content}
            target="_blank"
            rel="noopener noreferrer"
            className="message-link"
          >
            {part.content}
          </a>
        );
      }
      return <span key={idx}>{part.content}</span>;
    });
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
        {messages.map((message, index) => (
          <div key={message.id || index} className={`message ${message.type}`}>
            <div className="message-content">
              {message.type === 'bot' && (
                <div className="message-avatar">
                  <img 
                    src="/Black-Kingston-Logo.png" 
                    alt="City of Kingston" 
                    className="avatar-logo"
                  />
                </div>
              )}
              {message.type === 'user' && (
                <div className="message-avatar user-avatar">
                  <span className="material-symbols-outlined">person</span>
                </div>
              )}
              <div className="message-text-wrapper">
                <div className="message-text">
                  {message.streaming && !message.text ? (
                    <div className="loading-dots">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  ) : (
                    renderFormattedText(message.text)
                  )}
                  {message.streaming && message.text && (
                    <span className="streaming-cursor">▋</span>
                  )}
                </div>
                {message.results && message.results.length > 0 && shouldShowResults(message.text, message.results) && (
                  <div className="message-results">
                    <div className="results-header">
                      <span className="material-symbols-outlined">info</span>
                      Additional Information
                    </div>
                    {message.results.slice(1).map((result, idx) => (
                      <div key={idx} className="result-item">
                        <div className="result-topic">{result.topic?.replace(/_/g, ' ')}</div>
                        <div className="result-preview">{result.content.substring(0, 150)}...</div>
                        {result.source_url && (
                          <a href={result.source_url} target="_blank" rel="noopener noreferrer" className="result-link">
                            <span className="material-symbols-outlined">open_in_new</span>
                            Learn more
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="message-time">
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="message bot">
            <div className="message-content">
              <div className="loading-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="input-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your question here..."
          className="chat-input"
          disabled={loading}
        />
        <button type="submit" className="send-button" disabled={loading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
};

export default ChatInterface;
