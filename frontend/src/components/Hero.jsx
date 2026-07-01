import { useState } from 'react';
import './Hero.css';

export default function Hero({ onSubmit, error }) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  
  const [reposList, setReposList] = useState([]);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  function normalize(input) {
    let v = input.trim();
    if (!v) return v;
    if (!v.startsWith('http://') && !v.startsWith('https://')) {
      v = 'https://' + v;
    }
    return v;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    const trimmedValue = value.trim();
    if (!trimmedValue) return;

    let isRepoUrl = false;
    let usernameToFetch = trimmedValue;
    
    if (trimmedValue.includes('github.com/')) {
      const path = trimmedValue.split('github.com/')[1].split('?')[0].replace(/\/$/, '');
      const parts = path.split('/');
      if (parts.length === 1 && parts[0] !== '') {
        // It's a user profile URL, e.g., https://github.com/octocat
        usernameToFetch = parts[0];
        isRepoUrl = false;
      } else {
        // It has multiple parts, likely a repo e.g., octocat/Hello-World
        isRepoUrl = true;
      }
    } else if (trimmedValue.includes('/') || trimmedValue.includes('.')) {
      isRepoUrl = true;
    } else {
      isRepoUrl = false; // Just a simple string like "octocat"
    }

    if (isRepoUrl) {
      const url = normalize(value);
      if (!url) return;
      onSubmit(url);
      return;
    }

    setIsFetching(true);
    setFetchError('');
    setReposList([]);

    try {
      const response = await fetch(`https://api.github.com/users/${usernameToFetch}/repos?sort=updated&per_page=100`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('User not found on GitHub.');
        }
        throw new Error('Failed to fetch repositories.');
      }
      const data = await response.json();
      if (data.length === 0) {
        throw new Error('User has no public repositories.');
      }
      setReposList(data);
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setIsFetching(false);
    }
  }

  function handleRepoSelect(repoUrl) {
    onSubmit(repoUrl);
  }

  return (
    <section className="hero">
      <div className="hero-left">
        <img src="/github_bg.png" alt="GitHub Code Editor Background" className="hero-left-image" />
      </div>

      <div className="hero-right">
        <div className="hero-content">
          <div className="hero-eyebrow mono">
            <span className="pulse-dot" aria-hidden="true" />
            repo&nbsp;→&nbsp;system&nbsp;→&nbsp;clone&nbsp;→&nbsp;analyze
          </div>
          
          <h1 className="hero-title">
            Paste a repo.<br />
            <span className="hero-title-accent">Find what's broken.</span>
          </h1>
          
          <p className="hero-sub">
            Your tester drops a public repo URL. We clone it locally, run it through
            static analyzers, then hand it to a local LLM over Ollama to explain,
            rank, and catch what the linters miss — no cloud, no upload, nothing
            leaves this machine.
          </p>
        </div>

        <div className="hero-action">
          <h2 className="hero-action-title">Start a scan</h2>
          <form className="hero-form" onSubmit={handleSubmit}>
            <div className="input-group">
              <label className="input-label">Repository URL or GitHub Username</label>
              <div className={`input-row ${touched && !value.trim() ? 'input-row-error' : ''}`}>
                <span className="input-icon mono" aria-hidden="true">/repo</span>
                <input
                  className="repo-input mono"
                  type="text"
                  placeholder="github.com/owner/repository OR octocat"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setReposList([]);
                    setFetchError('');
                  }}
                  autoFocus
                  spellCheck={false}
                />
              </div>
            </div>
            
            <button type="submit" className="btn-scan btn-scan-full" disabled={isFetching}>
              {isFetching ? 'Fetching...' : 'Scan / Find'}
            </button>
            
            {touched && !value.trim() && (
              <div className="input-hint error-text">Paste a repo URL or username to get started.</div>
            )}
            {error && <div className="input-hint error-text">{error}</div>}
            {fetchError && <div className="input-hint error-text">{fetchError}</div>}
          </form>

          {reposList.length > 0 && (
            <div className="repos-list-container">
              <h3 className="repos-list-title">Select a repository ({reposList.length} found):</h3>
              <div className="repos-list">
                {reposList.map((repo) => (
                  <button 
                    key={repo.id} 
                    className="repo-item-btn mono" 
                    onClick={() => handleRepoSelect(repo.html_url)}
                  >
                    <span className="repo-name">{repo.name}</span>
                    {repo.language && <span className="repo-lang">{repo.language}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
