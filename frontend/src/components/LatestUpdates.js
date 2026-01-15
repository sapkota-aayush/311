import React from 'react';
import './LatestUpdates.css';

const LatestUpdates = ({ onBack }) => {
  // Prototype: curated items so you can judge UI/flow quickly.
  // Authorized sources only (official domains).
  const items = [
    {
      source: 'cityofkingston.ca',
      date: 'June 12, 2025',
      title:
        'Kingston’s new Special Constable Appointment Strategy aims to improve community safety and enforcement responses',
      summary:
        'City to appoint five senior officials as special constables to address safety concerns, police pressures, and encampment enforcement.',
      url: 'https://www.cityofkingston.ca/news/posts/kingston-s-new-special-constable-appointment-strategy-aims-to-improve-community-safety-and-enforcement-responses/',
    },
    {
      source: 'cityofkingston.ca',
      date: 'January 03, 2025',
      title: 'New 2025 Municipal Fees and Charges Now In Effect',
      summary:
        'Updates to municipal fees effective now; full list approved by Council on Dec. 17, 2024, available online.',
      // Using an official City bylaw page (authorized) as the reference entry point.
      url: 'https://www.cityofkingston.ca/bylaws-and-animal-services/commonly-requested-bylaws/bylaw-library/fees-and-charges-bylaw/',
    },
    {
      source: 'cityofkingston.ca',
      date: 'January 15, 2026',
      title: 'Winter parking restrictions in effect',
      summary:
        'Overnight on-street parking restrictions due to weather; prohibited 1–7 a.m. citywide (and 12–7 a.m. near Kingston General Hospital) until lifted.',
      url: 'https://www.cityofkingston.ca/news/posts/winter-parking-restrictions-in-effect/',
    },
    {
      source: 'cityofkingston.ca',
      date: 'January 06, 2025',
      title: 'Public Notice: 2025 operating and capital budget presentations',
      summary:
        'Schedule for Council meetings on 2025/2026 budgets (including utilities); presentations and dates are listed in the notice.',
      url: 'https://www.cityofkingston.ca/news/posts/public-notice-2025-operating-and-capital-budget-presentations/',
    },
    {
      source: 'cityofkingston.ca',
      date: 'Recent (2025)',
      title: 'City of Kingston receives Bird-Friendly City certification',
      summary:
        'Certification recognizing bird conservation efforts and related urban wildlife initiatives.',
      url: 'https://www.cityofkingston.ca/news/posts/city-of-kingston-receives-bird-friendly-city-certification/',
    },
    {
      source: 'cityofkingston.ca',
      date: 'Recent (2025)',
      title: 'Rental market vacancy rates drop slightly despite strong housing growth in 2025',
      summary:
        'Vacancy rate reported at 1.8%; new builds added 500+ units but demand continues to outpace supply.',
      url: 'https://www.cityofkingston.ca/news/posts/rental-market-vacancy-rates-drop-slightly-despite-strong-housing-growth-in-2025/',
    },
    {
      source: 'cityofkingston.ca',
      date: 'December 2025',
      title: 'Weekly Traffic Report (roadwork and closures)',
      summary:
        'Roadwork and closures affecting major streets. Use the weekly report series to stay up to date on detours and impacts.',
      // Closest available weekly traffic report in the current sitemap snapshot.
      url: 'https://www.cityofkingston.ca/news/posts/weekly-traffic-report-nov-29-dec-5/',
    },
    {
      source: 'cityofkingston.ca',
      date: 'January 2026',
      title: 'Ring in the New Year at K‑Town Countdown',
      summary:
        'Community New Year’s celebration with event details and activities; open the post for the full schedule.',
      url: 'https://www.cityofkingston.ca/news/posts/ring-in-the-new-year-at-k-town-countdown/',
    },
  ];

  return (
    <div className="updates-page">
      <div className="updates-header">
        <button className="updates-back" onClick={onBack}>
          <img
            src="/Black-Kingston-Logo.png"
            alt="City of Kingston"
            className="updates-logo"
          />
          <span className="material-symbols-outlined">arrow_back</span>
          Back
        </button>
        <div className="updates-titlewrap">
          <div className="updates-title">Latest information</div>
          <div className="updates-subtitle">Official links to what’s happening around Kingston.</div>
        </div>
      </div>

      <div className="updates-content">
        <div className="updates-list">
          {items.map((it) => (
            <div key={it.url} className="updates-item">
              <div className="updates-meta">
                <span className="updates-badge">{it.source}</span>
                <span className="updates-dot">•</span>
                <span className="updates-date">{it.date}</span>
              </div>

              <div className="updates-item-title">{it.title}</div>
              <div className="updates-item-snippet">{it.summary}</div>

              <div className="updates-actions">
                <a
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="updates-link"
                >
                  <span className="material-symbols-outlined">open_in_new</span>
                  Read full article
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LatestUpdates;

