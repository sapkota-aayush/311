import React, { useState } from 'react';
import './LandingPage.css';

const LandingPage = ({ onStartChat, onShowUpdates }) => {
  const mostAskedQuestions = [
    'When is my garbage collection day?',
    'What are the noise bylaw quiet hours in Kingston?',
    'How do I apply for a parking permit?',
    'How do I pay a parking ticket?',
    'What are the property tax payment options?',
    'Do I need a fire permit for a backyard fire pit in Kingston?',
    'Where can I dispose of hazardous waste?',
    'How do I report a pothole?',
  ];

  const exampleQuestions = [
    'How do I apply for a parking permit?',
    'When is my garbage collection day?',
    'What are the property tax payment options?',
    'Where can I dispose of hazardous waste?',
    'How do I report a noise complaint?',
    'What are the fire permit requirements?',
    'How do I renew my parking permit?',
    'What goes in the blue box?',
    'How do I pay my property taxes?',
    'What are the parking bylaws?',
    'Where is the waste collection calendar?',
    'How do I get a fire permit?',
    'What are the recycling rules?',
    'How do I report a pothole?',
    'What are the noise bylaws?',
    'How do I get a building permit?',
    'What are the water billing options?',
    'Where can I find city events?',
    'How do I register for recreation programs?',
    'What are the snow removal policies?',
    'How do I apply for a business license?',
    'What are the pet bylaws?'
  ];

  return (
    <div className="landing-page">
      <nav className="landing-nav">
        <div className="nav-left">
          <div className="logo-container">
            <img 
              src="/Black-Kingston-Logo.png" 
              alt="City of Kingston Logo" 
              className="kingston-logo"
            />
            <div className="logo-text">
              <span className="logo-title">Kingston</span>
              <span className="logo-subtitle">Ontario · Canada</span>
            </div>
          </div>
        </div>
      </nav>

      <main className="landing-main">
        <div className="landing-content">
          <div className="hero-section">
            <div className="hero-badge">
              <span className="material-symbols-outlined">verified</span>
              Official sources, clearly cited
            </div>
            <h1 className="hero-title">
              Kingston 311 Assistant<br />
              <span className="hero-subtitle">Answers you can verify</span>
            </h1>
            <p className="hero-description">
              Ask about bylaws, permits, waste, parking, taxes, and city services — with official links and updated timestamps when available.
            </p>
          </div>

          <div className="cta-grid">
            <div className="cta-card cta-primary">
              <div className="cta-card-top">
                <div className="cta-icon">
                  <span className="material-symbols-outlined">chat_bubble</span>
                </div>
                <div className="cta-copy">
                  <div className="cta-title">Get answers</div>
                  <div className="cta-subtitle">Ask a question and see the official sources underneath.</div>
                </div>
              </div>
              <button className="cta-button" onClick={() => onStartChat('')}>
                Start chat
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
            </div>

            <div className="cta-card">
              <div className="cta-card-top">
                <div className="cta-icon alt">
                  <span className="material-symbols-outlined">news</span>
                </div>
                <div className="cta-copy">
                  <div className="cta-title">Latest information</div>
                  <div className="cta-subtitle">Browse official 2026 updates and alerts from the City.</div>
                </div>
              </div>
              <button className="cta-button secondary" onClick={() => onShowUpdates && onShowUpdates()}>
                See latest
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
            </div>
          </div>

          <div className="example-questions">
            <p className="example-label">Try asking:</p>
            <div className="scrolling-ticker">
              <div className="ticker-wrapper">
                {exampleQuestions.concat(exampleQuestions).map((question, index) => (
                  <button
                    key={index}
                    className="ticker-item"
                    onClick={() => onStartChat(question)}
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="most-asked">
            <div className="most-asked-shell">
              <div className="most-asked-header">
                <h2 className="most-asked-title">Most asked questions</h2>
                <p className="most-asked-subtitle">Tap one to start.</p>
              </div>
              <div className="most-asked-list">
                {mostAskedQuestions.map((q) => (
                  <button
                    key={q}
                    className="most-asked-item"
                    onClick={() => onStartChat(q)}
                  >
                    <span className="most-asked-text">{q}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="landing-footer">
        <div className="footer-links">
          <a href="#" className="footer-link">Accessibility</a>
          <a href="#" className="footer-link">Bylaw Search</a>
          <a href="#" className="footer-link">Privacy & Security</a>
        </div>
        <div className="footer-copyright">
          <div className="copyright-text">© 2024 The City of Kingston</div>
          <div className="copyright-tagline">Innovation For All Ages</div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
