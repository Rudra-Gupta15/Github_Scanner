import { useMemo, useState } from 'react';
import IdeView from './IdeView';
import ReviewView from './ReviewView';
import './Report.css';

const SEVERITY_META = {
  high: { label: 'High', color: 'var(--danger)' },
  medium: { label: 'Medium', color: 'var(--warning)' },
  low: { label: 'Low', color: 'var(--info)' },
};

const CATEGORY_LABEL = {
  bug: 'Bug',
  vulnerability: 'Vulnerability',
  code_smell: 'Code smell',
};

function getFileMeta(stats, file) {
  if (!stats || !stats.file_meta) return null;
  const norm = file.replace(/\\/g, '/');

  if (stats.file_meta[norm]) return stats.file_meta[norm];

  const lowerNorm = norm.toLowerCase();
  let key = Object.keys(stats.file_meta).find(k => k.toLowerCase() === lowerNorm);
  if (key) return stats.file_meta[key];

  const basename = norm.split('/').pop().toLowerCase();
  key = Object.keys(stats.file_meta).find(k => {
    const kBase = k.replace(/\\/g, '/').split('/').pop().toLowerCase();
    return kBase === basename;
  });
  if (key) return stats.file_meta[key];

  return null;
}

// Rough, readable complexity read — not a formal metric, just a quick gut-check
// derived from scale (lines/files) and issue density (issues per 100 lines).
function getComplexityRead(stats, summary) {
  const totalLines = stats?.total_lines || 0;
  const totalFiles = stats?.total_files_analyzed || 0;
  const totalIssues = (summary?.high || 0) + (summary?.medium || 0) + (summary?.low || 0);
  const avgFileSize = totalFiles ? totalLines / totalFiles : 0;
  const density = totalLines ? (totalIssues / totalLines) * 100 : 0;

  let score = 0;
  if (avgFileSize > 300) score += 2;
  else if (avgFileSize > 150) score += 1;
  if (density > 5) score += 2;
  else if (density > 2) score += 1;
  if (totalFiles > 40) score += 1;

  if (score >= 4) return { label: 'High', color: 'var(--danger)' };
  if (score >= 2) return { label: 'Moderate', color: 'var(--warning)' };
  return { label: 'Low', color: 'var(--info)' };
}

export default function Report({ job, onReset, viewMode, onViewModeChange }) {
  const { result, repo_url } = job;
  const { stats, findings, summary, ollama_status, model_used } = result;
  const [severityFilter, setSeverityFilter] = useState('all');
  const [expandedFile, setExpandedFile] = useState(null);

  const grouped = useMemo(() => {
    const byFile = {};
    for (const f of findings) {
      if (severityFilter !== 'all' && f.severity !== severityFilter) continue;
      if (!byFile[f.file]) byFile[f.file] = [];
      byFile[f.file].push(f);
    }
    return Object.entries(byFile).sort((a, b) => b[1].length - a[1].length);
  }, [findings, severityFilter]);

  // Top offenders: ranked by issues-per-100-lines, not raw count, so a small
  // messy file outranks a big file that just happens to have more issues.
  const topOffenders = useMemo(() => {
    const byFile = {};
    for (const f of findings) {
      if (!byFile[f.file]) byFile[f.file] = { high: 0, medium: 0, low: 0, total: 0 };
      byFile[f.file][f.severity] = (byFile[f.file][f.severity] || 0) + 1;
      byFile[f.file].total += 1;
    }
    return Object.entries(byFile)
      .map(([file, counts]) => {
        const meta = getFileMeta(stats, file);
        const lines = meta?.lines || 0;
        const density = lines ? (counts.total / lines) * 100 : counts.total;
        return { file, counts, lines, density };
      })
      .sort((a, b) => b.density - a.density)
      .slice(0, 5);
  }, [findings, stats]);

  const ollamaUsed = !!model_used;
  const totalIssues = summary.high + summary.medium + summary.low;
  const complexity = getComplexityRead(stats, summary);

  const languages = useMemo(() => {
    const items = [
      { label: 'Python', value: stats?.python_files || 0, color: '#3b82f6' },
      { label: 'JavaScript', value: stats?.javascript_files || 0, color: '#f59e0b' },
      { label: 'TypeScript', value: stats?.typescript_files || 0, color: '#10b981' },
    ].filter(i => i.value > 0);
    return items;
  }, [stats]);

  if (viewMode === 'code') {
    return (
      <section className="report-full">
        <IdeView job={job} />
      </section>
    );
  }

  if (viewMode === 'review') {
    return (
      <section className="report-full">
        <ReviewView job={job} />
      </section>
    );
  }

  return (
    <section className="report">

      {/* ===================== 01 — OVERVIEW ===================== */}
      <ReportSection
        index="01"
        title="Overview"
        subtitle="What this repo is made of, before we talk about what's wrong with it."
      >
        <div className="overview-grid">
          <div className="overview-stats">
            <StatBlock label="Files analyzed" value={stats?.total_files_analyzed ?? '—'} />
            <StatBlock label="Lines scanned" value={(stats?.total_lines ?? 0).toLocaleString()} />
            <StatBlock label="Folders covered" value={stats?.total_folders ?? '—'} />
            <StatBlock
              label="Complexity"
              value={complexity.label}
              valueColor={complexity.color}
            />
          </div>

          <div className="overview-side">
            <div className="overview-block">
              <span className="overview-block-label">Languages detected</span>
              {languages.length === 0 ? (
                <span className="overview-empty">No language data available</span>
              ) : (
                <div className="lang-pills">
                  {languages.map(l => (
                    <span key={l.label} className="lang-pill">
                      <span className="lang-dot" style={{ background: l.color }} />
                      {l.label} <span className="lang-pill-count">{l.value}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="overview-block">
              <span className="overview-block-label">Static analyzers</span>
              <span className="overview-value mono">ESLint, Pylint, Bandit</span>
            </div>

            <div className="overview-block">
              <span className="overview-block-label">LLM explanation engine</span>
              <span className="overview-value mono">{model_used || 'None (static only)'}</span>
              <span className={`overview-status ${ollamaUsed ? 'status-on' : 'status-off'}`}>
                <span className="status-dot" />
                {ollamaUsed ? 'Online & explaining' : ollama_status}
              </span>
            </div>
          </div>
        </div>
      </ReportSection>

      <SectionDivider />

      {/* ===================== 02 — HEALTH ANALYSIS ===================== */}
      <ReportSection
        index="02"
        title="Health Analysis"
        subtitle="How clean the code is, what kind of problems show up, and where they cluster."
      >
        <div className="health-top-row">
          <SeverityStrip
            summary={summary}
            activeFilter={severityFilter}
            onFilterChange={(s) => setSeverityFilter(severityFilter === s ? 'all' : s)}
          />
          <CodeHealthChart stats={stats} summary={summary} />
          <SeverityChart summary={summary} />
        </div>

        <div className="dashboard-charts-grid">
          <CategoryChart findings={findings} />
          <LanguageChart stats={stats} />
          <TopRulesChart findings={findings} />
          <TopFilesChart stats={stats} />
        </div>

        {topOffenders.length > 0 && (
          <div className="offenders-card">
            <h3 className="analytics-title">Fix These First</h3>
            <p className="offenders-sub">Ranked by issues per 100 lines — small messy files outrank big files with scattered issues.</p>
            <div className="offenders-list">
              {topOffenders.map((o, i) => (
                <div className="offender-row" key={o.file}>
                  <span className="offender-rank">{i + 1}</span>
                  <span className="offender-file mono" title={o.file}>{o.file}</span>
                  <span className="offender-density mono">{o.density.toFixed(1)} / 100 lines</span>
                  <span className="offender-badges">
                    {['high', 'medium', 'low'].map(sev =>
                      o.counts[sev] ? (
                        <span key={sev} className={`badge badge-${sev}`}>{o.counts[sev]}</span>
                      ) : null
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </ReportSection>

      <SectionDivider />

      {/* ===================== 03 — FINDINGS BY FILE ===================== */}
      <ReportSection
        index="03"
        title="Findings by File"
        subtitle="Every issue, where it lives, and — where available — an AI explanation and fix."
      >
        {severityFilter !== 'all' && (
          <button className="filter-chip" onClick={() => setSeverityFilter('all')}>
            Showing {SEVERITY_META[severityFilter].label} only ×
          </button>
        )}

        {grouped.length === 0 && (
          <div className="empty-state">
            {findings.length === 0
              ? 'No issues found. Either this repo is clean, or there was nothing in scope to analyze.'
              : 'No issues match this filter.'}
          </div>
        )}

        {grouped.length > 0 && (
          <div className="file-groups-table">
            <div className="file-table-header">
              <span className="th-file">Source/File Path</span>
              <span className="th-lang">Language</span>
              <span className="th-lines">Total Lines</span>
              <span className="th-issues">Severity Distribution</span>
            </div>

            {grouped.map(([file, issues]) => (
              <FileGroup
                key={file}
                file={file}
                issues={issues}
                meta={getFileMeta(stats, file)}
                expanded={expandedFile === file}
                onToggle={() => setExpandedFile(expandedFile === file ? null : file)}
              />
            ))}
          </div>
        )}
      </ReportSection>

      {totalIssues === 0 && (
        <>
          <SectionDivider />
          <ReportSection index="04" title="All Clear" subtitle="Nothing left to triage.">
            <div className="empty-state all-clear">
              No high, medium, or low severity issues were found across {stats?.total_files_analyzed ?? 0} files.
            </div>
          </ReportSection>
        </>
      )}
    </section>
  );
}

// --- Section scaffolding ---

function ReportSection({ index, title, subtitle, children }) {
  return (
    <div className="report-section">
      <div className="section-heading">
        <span className="section-index mono">{index}</span>
        <div className="section-heading-text">
          <h2 className="section-title">{title}</h2>
          {subtitle && <p className="section-subtitle">{subtitle}</p>}
        </div>
      </div>
      <div className="section-body">{children}</div>
    </div>
  );
}

function SectionDivider() {
  return <div className="section-divider" />;
}

function StatBlock({ label, value, valueColor }) {
  return (
    <div className="stat-block">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
    </div>
  );
}

function SeverityStrip({ summary, activeFilter, onFilterChange }) {
  return (
    <div className="severity-strip">
      {['high', 'medium', 'low'].map(sev => (
        <button
          key={sev}
          className={`severity-pill severity-pill-${sev} ${activeFilter === sev ? 'active' : ''}`}
          onClick={() => onFilterChange(sev)}
        >
          <span className="severity-pill-value">{summary[sev]}</span>
          <span className="severity-pill-label">{SEVERITY_META[sev].label}</span>
        </button>
      ))}
    </div>
  );
}

function SeverityChart({ summary }) {
  const total = summary.high + summary.medium + summary.low;
  if (total === 0) return null;

  const h = (summary.high / total) * 100;
  const m = (summary.medium / total) * 100;

  const bg = `conic-gradient(var(--danger) 0% ${h}%, var(--warning) ${h}% ${h + m}%, var(--info) ${h + m}% 100%)`;

  return (
    <div className="severity-chart-card">
      <div className="doughnut-wrap">
        <div className="doughnut" style={{ background: bg }}>
          <div className="doughnut-hole">
            <span className="doughnut-total">{total}</span>
            <span className="doughnut-label">Issues</span>
          </div>
        </div>
      </div>
      <div className="doughnut-legend">
        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--danger)' }}></span>High ({summary.high})</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--warning)' }}></span>Medium ({summary.medium})</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--info)' }}></span>Low ({summary.low})</div>
      </div>
    </div>
  );
}

function CodeHealthChart({ stats, summary }) {
  const totalIssues = summary.high + summary.medium + summary.low;
  const totalLines = stats?.total_lines || 0;
  if (totalLines === 0) return null;

  const cleanLines = Math.max(0, totalLines - totalIssues);
  const cleanPct = (cleanLines / totalLines) * 100;

  const bg = `conic-gradient(#10b981 0% ${cleanPct}%, var(--danger-dim) ${cleanPct}% 100%)`;

  return (
    <div className="severity-chart-card">
      <div className="doughnut-wrap">
        <div className="doughnut" style={{ background: bg }}>
          <div className="doughnut-hole">
            <span className="doughnut-total">{Math.round(cleanPct)}%</span>
            <span className="doughnut-label">Clean Code</span>
          </div>
        </div>
      </div>
      <div className="doughnut-legend">
        <div className="legend-item"><span className="legend-dot" style={{ background: '#10b981' }}></span>Clean ({cleanLines})</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--danger-dim)' }}></span>Issues ({totalIssues})</div>
      </div>
    </div>
  );
}

function FileGroup({ file, issues, meta, expanded, onToggle }) {
  const counts = issues.reduce((acc, i) => {
    acc[i.severity] = (acc[i.severity] || 0) + 1;
    return acc;
  }, {});

  const total = issues.length;

  return (
    <div className="file-group">
      <button className="file-group-header" onClick={onToggle}>
        <span className="file-path mono">
          <span className={`chevron ${expanded ? 'chevron-open' : ''}`}>›</span> {file}
        </span>

        <span className="file-lang">
          {meta?.language || '—'}
        </span>

        <span className="file-lines mono">
          {meta ? meta.lines.toLocaleString() : '—'}
        </span>

        <div className="file-distribution">
          <FileSeverityBar counts={counts} total={total} />
          <span className="file-badges">
            {['high', 'medium', 'low'].map((sev) =>
              counts[sev] ? (
                <span key={sev} className={`badge badge-${sev}`}>{counts[sev]}</span>
              ) : null
            )}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="issue-list">
          {issues
            .sort((a, b) => a.line - b.line)
            .map((issue, i) => (
              <IssueRow key={i} issue={issue} />
            ))}
        </div>
      )}
    </div>
  );
}

function FileSeverityBar({ counts, total }) {
  if (total === 0) return null;
  const h = ((counts.high || 0) / total) * 100;
  const m = ((counts.medium || 0) / total) * 100;
  const l = ((counts.low || 0) / total) * 100;

  return (
    <div className="file-mini-chart" title="Issue severity distribution">
      {h > 0 && <div className="mini-chart-segment" style={{ width: `${h}%`, background: 'var(--danger)' }} />}
      {m > 0 && <div className="mini-chart-segment" style={{ width: `${m}%`, background: 'var(--warning)' }} />}
      {l > 0 && <div className="mini-chart-segment" style={{ width: `${l}%`, background: 'var(--info)' }} />}
    </div>
  );
}

function IssueRow({ issue }) {
  const sevMeta = SEVERITY_META[issue.severity] || SEVERITY_META.low;

  const hasRealExplanation = issue.explanation && issue.explanation !== issue.message;
  const hasRealFix = issue.suggested_fix && !issue.suggested_fix.includes('LLM unavailable');
  const showLlmBlock = hasRealExplanation || hasRealFix;

  return (
    <div className="issue-row">
      <div className="issue-indicator" style={{ background: sevMeta.color }} />
      <div className="issue-content">
        <div className="issue-header">
          <span className="issue-line">Line {issue.line}</span>
          <span className={`issue-badge badge-${issue.severity}`}>{sevMeta.label}</span>
          <span className="issue-category">{CATEGORY_LABEL[issue.category] || issue.category}</span>
          <span className="issue-tool">{issue.tool}</span>
        </div>
        <div className="issue-message">{issue.message}</div>

        {showLlmBlock && (
          <div className="issue-llm">
            <div className="llm-header">
              <span className="llm-icon">🤖</span> AI Analysis
            </div>
            {hasRealExplanation && (
              <div className="llm-explanation">{issue.explanation}</div>
            )}
            {hasRealFix && (
              <div className="llm-fix">
                <div className="llm-fix-label">Suggested Fix</div>
                <div className="llm-fix-code mono">{issue.suggested_fix}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Analytics charts ---

function CategoryChart({ findings }) {
  const cats = findings.reduce((acc, f) => {
    acc[f.category] = (acc[f.category] || 0) + 1;
    return acc;
  }, {});

  const items = [
    { label: 'Bug', value: cats.bug || 0, color: 'var(--danger)' },
    { label: 'Vulnerability', value: cats.vulnerability || 0, color: 'var(--danger)' },
    { label: 'Code Smell', value: cats.code_smell || 0, color: 'var(--warning)' },
  ].filter(i => i.value > 0).sort((a, b) => b.value - a.value);

  const max = Math.max(...items.map(i => i.value), 1);

  return (
    <div className="analytics-card">
      <h3 className="analytics-title">Issues by Category</h3>
      {items.length === 0 ? <div className="analytics-empty">No issues found</div> : (
        <div className="bar-chart">
          {items.map(item => (
            <div className="bar-row" key={item.label}>
              <div className="bar-header">
                <span className="bar-label">{item.label}</span>
                <span className="bar-value">{item.value}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(item.value / max) * 100}%`, background: item.color }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LanguageChart({ stats }) {
  if (!stats) return null;
  const items = [
    { label: 'Python', value: stats.python_files || 0, color: '#3b82f6' },
    { label: 'JavaScript', value: stats.javascript_files || 0, color: '#f59e0b' },
    { label: 'TypeScript', value: stats.typescript_files || 0, color: '#10b981' },
  ].filter(i => i.value > 0).sort((a, b) => b.value - a.value);

  const max = Math.max(...items.map(i => i.value), 1);

  return (
    <div className="analytics-card">
      <h3 className="analytics-title">Files by Language</h3>
      {items.length === 0 ? <div className="analytics-empty">No files analyzed</div> : (
        <div className="bar-chart">
          {items.map(item => (
            <div className="bar-row" key={item.label}>
              <div className="bar-header">
                <span className="bar-label">{item.label}</span>
                <span className="bar-value">{item.value}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(item.value / max) * 100}%`, background: item.color }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopRulesChart({ findings }) {
  const rules = findings.reduce((acc, f) => {
    const r = f.rule || 'Unknown';
    acc[r] = (acc[r] || 0) + 1;
    return acc;
  }, {});

  const items = Object.entries(rules)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({ label, value, color: 'var(--info)' }));

  const max = Math.max(...items.map(i => i.value), 1);

  return (
    <div className="analytics-card">
      <h3 className="analytics-title">Top 5 Common Errors</h3>
      {items.length === 0 ? <div className="analytics-empty">No errors found</div> : (
        <div className="bar-chart">
          {items.map(item => (
            <div className="bar-row" key={item.label}>
              <div className="bar-header">
                <span className="bar-label" title={item.label}>{item.label}</span>
                <span className="bar-value">{item.value}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(item.value / max) * 100}%`, background: item.color }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopFilesChart({ stats }) {
  const meta = stats?.file_meta || {};
  const files = Object.entries(meta).map(([file, m]) => ({
    label: file.split('/').pop(),
    value: m.lines || 0,
    color: 'var(--signal)'
  }));

  const items = files.sort((a, b) => b.value - a.value).slice(0, 5);
  const max = Math.max(...items.map(i => i.value), 1);

  return (
    <div className="analytics-card">
      <h3 className="analytics-title">Largest Files (Lines of Code)</h3>
      {items.length === 0 ? <div className="analytics-empty">No files analyzed</div> : (
        <div className="bar-chart">
          {items.map(item => (
            <div className="bar-row" key={item.label}>
              <div className="bar-header">
                <span className="bar-label" title={item.label}>{item.label}</span>
                <span className="bar-value">{item.value}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(item.value / max) * 100}%`, background: item.color }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}