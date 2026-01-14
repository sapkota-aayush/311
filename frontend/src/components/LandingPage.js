import React, { useState } from 'react';
import './LandingPage.css';

const LandingPage = ({ onStartChat }) => {
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
            <h1 className="hero-title">
              Ask Anything About<br/>
              <span className="hero-subtitle">City of Kingston</span>
            </h1>
            <p className="hero-description">
              Get answers to all your questions about city services, policies, and information
            </p>
          </div>

          <div className="cta-section">
            <button 
              className="start-chat-button"
              onClick={() => onStartChat('')}
            >
              <span className="button-icon">
                <span className="material-symbols-outlined">chat_bubble</span>
              </span>
              <span className="button-text">Get All Your Answers</span>
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
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
