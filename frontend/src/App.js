import React, { useState } from 'react';
import './App.css';
import LandingPage from './components/LandingPage';
import ChatInterface from './components/ChatInterface';

function App() {
  const [showChat, setShowChat] = useState(false);
  const [initialQuery, setInitialQuery] = useState('');

  const handleStartChat = (query = '') => {
    setInitialQuery(query);
    setShowChat(true);
  };

  const handleServiceClick = (service) => {
    // Pre-fill query based on service
    const queries = {
      healthcare: 'healthcare support',
      senior: 'senior living programs',
      city: 'city services'
    };
    handleStartChat(queries[service] || '');
  };

  if (showChat) {
    return <ChatInterface initialQuery={initialQuery} onBack={() => setShowChat(false)} />;
  }

  return <LandingPage onStartChat={handleStartChat} onServiceClick={handleServiceClick} />;
}

export default App;
