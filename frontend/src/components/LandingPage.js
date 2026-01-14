import React, { useState, useEffect } from 'react';
import './LandingPage.css';

const LandingPage = ({ onStartChat, onServiceClick }) => {
  const exampleQuestions = [
    'How do I apply for a parking permit?',
    'When is my garbage collection day?',
    'What are the property tax payment options?',
    'Where can I dispose of hazardous waste?',
    'How do I report a noise complaint?',
    'What are the fire permit requirements?',
    'How do I renew my parking permit?',
    'What goes in the blue box?'
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
        <div className="nav-status">
          <div className="status-item">
            <span className="status-label">System Status</span>
            <span className="status-value">
              <span className="status-dot"></span> Active Response
            </span>
          </div>
          <div className="status-divider"></div>
          <div className="status-item">
            <span className="status-label">Library</span>
            <span className="status-value italic">Health & Senior Verified</span>
          </div>
        </div>
      </nav>

      <main className="landing-main">
        <div className="landing-content">
          <div className="hero-section">
            <h1 className="hero-title">
              Ask Anything About<br/>
              <span className="hero-subtitle">City of Kingston</span>
            </h1>
            <p className="hero-description">
              Get instant, accurate answers to all your city service questions
            </p>
          </div>

          <div className="services-card">
            <div className="city-services-highlight">
              <div className="highlight-icon-wrapper">
                <div className="service-icon city">
                  <span className="material-symbols-outlined">chat_bubble</span>
                </div>
                <div className="icon-glow"></div>
              </div>
              <h3 className="highlight-title">Your City Assistant</h3>
              <p className="highlight-description">
                Ask any question about city services, policies, programs, or municipal information. We provide comprehensive answers from official City of Kingston sources.
              </p>
            </div>

            <div className="search-section">
              <div className="search-container-new">
                <div className="search-icon-new">
                  <span className="material-symbols-outlined">search</span>
                </div>
                <input
                  className="search-input-new"
                  type="text"
                  placeholder="What would you like to know about Kingston?"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && e.target.value.trim()) {
                      onStartChat(e.target.value.trim());
                    }
                  }}
                />
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
            </div>

            <div className="features-bar">
              <div className="features-left">
                <button className="feature-button">
                  <span className="material-symbols-outlined">settings_voice</span>
                  Voice Assist
                </button>
                <button className="feature-button">
                  <span className="material-symbols-outlined">text_increase</span>
                  Readability
                </button>
              </div>
              <div className="features-right">
                <span className="material-symbols-outlined">verified_user</span>
                Official City Channel
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
