import { useEffect, useRef, useState } from 'react';
import Hero from './components/Hero';
import PipelineRail from './components/PipelineRail';
import Report from './components/Report';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

export default function App() {
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [viewMode, setViewMode] = useState('report');
  const [isPaused, setIsPaused] = useState(false);
  const pollRef = useRef(null);

  async function startScan(repoUrl) {
    setSubmitError(null);
    setJob(null);
    setIsPaused(false);
    try {
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: repoUrl }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setJobId(data.job_id);
    } catch (err) {
      setSubmitError(err.message || 'Could not start the scan. Is the backend running?');
    }
  }

  useEffect(() => {
    if (!jobId || isPaused) return;

    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        setJob(data);
        if (data.stage === 'done' || data.stage === 'failed') {
          clearInterval(pollRef.current);
        }
      } catch {
        // transient network blip while polling, next tick will retry
      }
    }

    poll();
    pollRef.current = setInterval(poll, 1400);
    return () => clearInterval(pollRef.current);
  }, [jobId, isPaused]);

  function reset() {
    clearInterval(pollRef.current);
    setJobId(null);
    setJob(null);
    setSubmitError(null);
    setViewMode('report');
    setIsPaused(false);
  }

  const isDone = job && job.stage === 'done';
  const isFailed = job && job.stage === 'failed';

  return (
    <div className="shell">
      <TopBar 
        onReset={reset} 
        showReset={!!jobId} 
        job={job}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        isPaused={isPaused}
        setIsPaused={setIsPaused}
      />

      <main className={`main ${(isDone && (viewMode === 'code' || viewMode === 'review')) || !jobId || (jobId && !isDone && !isFailed) ? 'main--full-bleed' : ''}`}>
        {!jobId && (
          <Hero onSubmit={startScan} error={submitError} />
        )}

        {jobId && !isDone && !isFailed && (
          <PipelineRail job={job} />
        )}

        {isFailed && (
          <div className="fail-panel">
            <div className="fail-title">Scan failed</div>
            <div className="fail-detail mono">{job.error || job.stage_detail}</div>
            <button className="btn-ghost" onClick={reset}>Try another repo</button>
          </div>
        )}

        {isDone && job.result && (
          <Report
            job={job}
            onReset={reset}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        )}
      </main>


    </div>
  );
}

function TopBar({ onReset, showReset, job, viewMode, onViewModeChange, isPaused, setIsPaused }) {
  const isDone = job && job.stage === 'done';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand" onClick={showReset ? onReset : undefined} role={showReset ? 'button' : undefined}>
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="3" stroke="#ffffff" strokeWidth="1.6" />
              <path d="M3 9.5h18" stroke="#ffffff" strokeWidth="1.6" />
              <circle cx="7" cy="6.3" r="0.9" fill="#ffffff" />
            </svg>
          </span>
          <span className="brand-name">Github Scanner</span>
        </div>
      </div>

      {isDone && (
        <div className="topbar-center">
          <span className="topbar-repo mono">{job.repo_url}</span>
          <span className="topbar-badge">Scan complete</span>
        </div>
      )}

      <div className="topbar-right">
        {isDone && (
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === 'report' ? 'active' : ''}`}
              onClick={() => onViewModeChange('report')}
            >
              Report
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'code' ? 'active' : ''}`}
              onClick={() => onViewModeChange('code')}
            >
              Code
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'review' ? 'active' : ''}`}
              onClick={() => onViewModeChange('review')}
            >
              Review
            </button>
          </div>
        )}
        {showReset && (
          <>
            <button 
              className="btn-ghost small" 
              style={{ marginRight: '8px', color: isPaused ? '#f59e0b' : '#ffffff' }}
              onClick={() => setIsPaused(!isPaused)}
            >
              {isPaused ? 'Resume UI' : 'Pause UI'}
            </button>
            <button className="btn-ghost small" onClick={onReset}>New scan</button>
          </>
        )}
      </div>
    </header>
  );
}
