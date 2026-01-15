import React, { useEffect, useState } from 'react';
import './App.css';
import LandingPage from './components/LandingPage';
import ChatInterface from './components/ChatInterface';
import LatestUpdates from './components/LatestUpdates';

function App() {
  const [view, setView] = useState('home'); // 'home' | 'chat' | 'updates'
  const [initialQuery, setInitialQuery] = useState('');

  // Ensure navigation between views always starts at the top (prevents "home looks hidden")
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  const handleStartChat = (query = '') => {
    setInitialQuery(query);
    setView('chat');
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

  if (view === 'chat') {
    return <ChatInterface initialQuery={initialQuery} onBack={() => setView('home')} />;
  }

  if (view === 'updates') {
    return <LatestUpdates onBack={() => setView('home')} />;
  }

  return (
    <LandingPage
      onStartChat={handleStartChat}
      onServiceClick={handleServiceClick}
      onShowUpdates={() => setView('updates')}
    />
  );
}

export default App;
