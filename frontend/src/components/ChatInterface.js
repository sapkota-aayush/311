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
      const submitInitialQuery = async () => {
        const userMessage = {
          type: 'user',
          text: initialQuery,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, userMessage]);
        setLoading(true);

        try {
          const apiUrl = process.env.NODE_ENV === 'production' ? '/query' : 'http://localhost:8000/query';
          const response = await axios.post(apiUrl, {
            query: initialQuery,
            top_k: 3
          }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
          });

          if (response.data.answer || (response.data.results && response.data.results.length > 0)) {
            const botMessage = {
              type: 'bot',
              text: response.data.answer || formatResponse(response.data.results || response.data.results),
              results: response.data.results || response.data.results,
              timestamp: new Date()
            };
            setMessages(prev => [...prev, botMessage]);
          }
        } catch (error) {
          console.error('Error:', error);
          setMessages(prev => [...prev, {
            type: 'bot',
            text: "Sorry, I'm having trouble connecting right now. Please try again later or contact 311 at 613-546-0000.",
            timestamp: new Date()
          }]);
        } finally {
          setLoading(false);
        }
      };

      setTimeout(submitInitialQuery, 500);
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

    try {
      // Use full URL in development to ensure connection
      const apiUrl = process.env.NODE_ENV === 'production' ? '/query' : 'http://localhost:8000/query';
      
      const response = await axios.post(apiUrl, {
        query: queryText,
        top_k: 3
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      const results = response.data.results;

      if (response.data.answer || (results && results.length > 0)) {
        // Use the direct answer from backend (LangChain)
        const botMessage = {
          type: 'bot',
          text: response.data.answer || formatResponse(response.data.results || results),
          results: response.data.results || results,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, botMessage]);
      } else {
        setMessages(prev => [...prev, {
          type: 'bot',
          text: "I couldn't find specific information about that. Please try rephrasing your question or contact 311 directly at 613-546-0000.",
          timestamp: new Date()
        }]);
      }
    } catch (error) {
      console.error('Error querying backend:', error);
      console.error('Error details:', error.response?.data || error.message);
      
      // More specific error messages
      let errorMessage = "Sorry, I'm having trouble connecting right now.";
      
      if (error.code === 'ECONNREFUSED') {
        errorMessage = "Unable to connect to the server. Please make sure the backend is running on http://localhost:8000";
      } else if (error.response?.status === 500) {
        errorMessage = "The server encountered an error. Please try again or contact 311 at 613-546-0000.";
      } else if (error.response?.status >= 400) {
        errorMessage = "There was an error processing your request. Please try again or contact 311 at 613-546-0000.";
      }
      
      setMessages(prev => [...prev, {
        type: 'bot',
        text: `${errorMessage}\n\nIf you need immediate assistance, please contact 311 at 613-546-0000.`,
        timestamp: new Date()
      }]);
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

  // Function to convert URLs in text to clickable links
  const renderTextWithLinks = (text) => {
    if (!text) return text;
    
    // URL regex pattern
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    
    return parts.map((part, index) => {
      if (urlRegex.test(part)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="message-link"
          >
            {part}
          </a>
        );
      }
      return <span key={index}>{part}</span>;
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
          <div key={index} className={`message ${message.type}`}>
            <div className="message-content">
              <div className="message-text">{renderTextWithLinks(message.text)}</div>
              {message.results && message.results.length > 0 && shouldShowResults(message.text, message.results) && (
                <div className="message-results">
                  <div className="results-header">Additional Information:</div>
                  {message.results.slice(1).map((result, idx) => (
                    <div key={idx} className="result-item">
                      <div className="result-topic">{result.topic?.replace(/_/g, ' ')}</div>
                      <div className="result-preview">{result.content.substring(0, 150)}...</div>
                      {result.source_url && (
                        <a href={result.source_url} target="_blank" rel="noopener noreferrer" className="result-link">
                          Learn more →
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
