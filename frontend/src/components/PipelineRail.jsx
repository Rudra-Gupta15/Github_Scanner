import React, { useState, useEffect } from 'react';
import './PipelineRail.css';

const STAGE_META = [
  { key: 'queued', label: 'Queued', desc: 'Job received' },
  { key: 'cloning', label: 'Clone', desc: 'git clone' },
  { key: 'scanning', label: 'Walk tree', desc: 'Index files' },
  { key: 'analyzing', label: 'Analysis', desc: 'Static checks' },
  { key: 'triaging', label: 'LLM triage', desc: 'AI inspection' },
  { key: 'done', label: 'Report', desc: 'Findings ready' },
];

function stageIndex(stage) {
  const idx = STAGE_META.findIndex((s) => s.key === stage);
  return idx === -1 ? 0 : idx;
}

export default function PipelineRail({ job }) {
  const stage = job?.stage || 'queued';
  const detail = job?.stage_detail || '';
  const currentIdx = stageIndex(stage);

  // Live timer for elapsed time
  const [elapsed, setElapsed] = useState(0);
  
  useEffect(() => {
    if (!job?.created_at) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor(Date.now() / 1000 - job.created_at));
    }, 1000);
    return () => clearInterval(interval);
  }, [job?.created_at]);

  const formatTime = (secs) => {
    if (secs < 0) secs = 0;
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const formatTimeFull = (secs) => {
    if (secs < 0) secs = 0;
    const h = Math.floor(secs / 3600).toString().padStart(2, '0');
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const startedAt = job?.created_at 
    ? new Date(job.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    : '--:--';

  return (
    <section className="pipeline-layout">
      <div className="pipeline-card-container">
        <div className="pipeline-header">
          <div className="repo-pill mono">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
            </svg>
            {job?.repo_url || 'Unknown Repository'}
          </div>
          <div className="status-pill">
            <span className="status-dot"></span>
            Connected
          </div>
        </div>

        <div className="pipeline-body">
          <div className="pipeline-sidebar">
            {STAGE_META.map((s, i) => {
              const state = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'pending';
              return (
                <div className={`rail-step-vertical ${state === 'active' ? 'rail-step-active-bg' : ''}`} key={s.key}>
                  <div className="rail-node-col">
                    <div className={`rail-node rail-node-${state}`}>
                      {state === 'done' ? <CheckIcon /> : state === 'active' ? <SpinIcon /> : <DotIcon />}
                    </div>
                    {i < STAGE_META.length - 1 && (
                      <div className={`rail-connector-vertical ${i < currentIdx ? 'rail-connector-done' : ''}`} />
                    )}
                  </div>
                  <div className="rail-label-col">
                    <div className={`rail-step-name ${state === 'pending' ? 'dim' : state === 'active' ? 'active-text' : ''}`}>{i + 1}. {s.label}</div>
                    <div className="rail-step-desc">{s.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pipeline-main">
            <LogViewer active={currentIdx} detail={detail} />
            
            <div className="stats-row">
              <div className="stat-card">
                <div className="stat-icon stat-icon-purple">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
                </div>
                <div className="stat-info">
                  <div className="stat-label">Current Phase</div>
                  <div className="stat-value" style={{textTransform: 'capitalize'}}>{stage}</div>
                  <div className="stat-subtext text-purple" style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px'}}>{detail || 'Working...'}</div>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon stat-icon-green">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
                </div>
                <div className="stat-info">
                  <div className="stat-label">LLM Engine</div>
                  <div className="stat-value">Ollama</div>
                  <div className="stat-subtext">Static + AI Triage</div>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon stat-icon-orange">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                </div>
                <div className="stat-info">
                  <div className="stat-label">Time Started</div>
                  <div className="stat-value">{startedAt}</div>
                  <div className="stat-subtext">Local timezone</div>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon stat-icon-blue">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                </div>
                <div className="stat-info">
                  <div className="stat-label">Elapsed Time</div>
                  <div className="stat-value">{formatTimeFull(elapsed)}</div>
                  <div className="stat-subtext">Job running...</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LogViewer({ active, detail }) {
  return (
    <div className="log-viewer">
      <div className="log-header">
        <div className="mac-buttons">
          <div className="mac-btn close" />
          <div className="mac-btn min" />
          <div className="mac-btn max" />
        </div>
        <div className="log-title mono">
          <svg className="log-header-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
          reposcan-agent // task execution
        </div>
        <div className="log-header-right">
          <span className="live-dot"></span>
          <span className="live-text">Live</span>
        </div>
      </div>
      <div className="log-body mono">
        <div className="log-line"><span className="log-timestamp">00:00</span> <span className="log-msg">Initializing scan sequence...</span></div>
        {active > 0 && <div className="log-line"><span className="log-timestamp">00:02</span> <span className="log-msg">Fetching repository contents...</span></div>}
        {active > 1 && <div className="log-line"><span className="log-timestamp">00:04</span> <span className="log-msg">Building AST and walking directory tree...</span></div>}
        {active > 2 && <div className="log-line"><span className="log-timestamp">00:06</span> <span className="log-msg">Running static analyzers (pylint, eslint)...</span></div>}
        {active > 3 && <div className="log-line"><span className="log-timestamp">00:15</span> <span className="log-msg">Handing off to local LLM for triage...</span></div>}
        <div className="log-line active-log">
          <span className="log-timestamp">**:**</span> <span className="log-msg highlight-msg">{detail || 'Processing...'}</span>
          <span className="pulse-cursor" />
        </div>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M3 8.5L6.2 12L13 4.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpinIcon() {
  return <span className="spin-ring" />;
}

function DotIcon() {
  return <span className="pending-dot" />;
}
