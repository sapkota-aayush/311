import React from 'react';
import './LatestUpdates.css';

const LatestUpdates = ({ onBack }) => {
  // Prototype: curated items so you can judge UI/flow quickly.
  // Authorized sources only (official domains).
  const items = [
    {
      source: 'cityofkingston.ca',
      date: 'January 13, 2026',
      title: 'Downtown event parking is closer than you think',
      summary: 'Official City update about parking for downtown events. Open the post for details.',
      url: 'https://www.cityofkingston.ca/news/posts/downtown-event-parking-is-closer-than-you-think/',
    },
    {
      source: 'cityofkingston.ca',
      date: 'January 13, 2026',
      title:
        "City Hall’s Market Wing Cultural Space presents “A History Exposed: The Enslavement of Black People in Canada”",
      summary: 'Official City update about an exhibit/event at City Hall. Open the post for details.',
      url: 'https://www.cityofkingston.ca/news/posts/city-hall-s-market-wing-cultural-space-presents-a-history-exposed-the-enslavement-of-black-people-in-canada/',
    },
    {
      source: 'cityofkingston.ca',
      date: 'January 12, 2026',
      title: "Big ideas wanted: Applications open for the 2026 Mayor’s Innovation Challenge",
      summary: 'Official City update about applications and timelines for the Mayor’s Innovation Challenge.',
      url: 'https://www.cityofkingston.ca/news/posts/big-ideas-wanted-applications-open-for-the-2026-mayor-s-innovation-challenge/',
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
      date: 'January 2026',
      title: 'Ring in the New Year at K‑Town Countdown',
      summary:
        'Community New Year’s celebration with event details and activities; open the post for the full schedule.',
      url: 'https://www.cityofkingston.ca/news/posts/ring-in-the-new-year-at-k-town-countdown/',
    },
    {
      source: 'cityofkingston.ca',
      date: 'January 9, 2026',
      title: 'Weekly Traffic Report: Jan. 9–15',
      summary: 'Official weekly traffic report with roadwork/closures and detours. Open the post for details.',
      url: 'https://www.cityofkingston.ca/news/posts/weekly-traffic-report-jan-9-15/',
    },
    {
      source: 'cityofkingston.ca',
      date: 'January 5, 2026',
      title: 'Public Notice',
      summary: 'Official City public notice. Open the post for the full notice details.',
      url: 'https://www.cityofkingston.ca/news/posts/public-notice/',
    },
    {
      source: 'cityofkingston.ca',
      date: 'January 2, 2026',
      title: 'Scam alert: fake parking ticket text messages circulating in Kingston',
      summary: 'Official City alert about scam text messages related to parking tickets.',
      url: 'https://www.cityofkingston.ca/news/posts/scam-alert-fake-parking-ticket-text-messages-circulating-in-kingston/',
    },
    {
      source: 'cityofkingston.ca',
      date: 'January 2, 2026',
      title:
        'Accessible transportation programs in Kingston continue following significant changes to local Taxi Commission',
      summary: 'Official City update about accessible transportation services and local taxi commission changes.',
      url: 'https://www.cityofkingston.ca/news/posts/accessible-transportation-programs-in-kingston-continue-following-significant-changes-to-local-taxi-commission/',
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

