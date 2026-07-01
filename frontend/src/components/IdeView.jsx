import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderCode, MessageSquare, Bot, User } from 'lucide-react';
import FileTree from './FileTree';
import './IdeView.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

export default function IdeView({ job }) {
  const { id: jobId, result } = job;
  const findings = result?.findings || [];

  const [tree, setTree] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [fileLoading, setFileLoading] = useState(false);

  // Chat state
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatEndRef = useRef(null);
  const abortRef = useRef(null);

  // ---------- Fetch file tree on mount ----------
  useEffect(() => {
    fetch(`${API_BASE}/api/jobs/${jobId}/tree`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setTree)
      .catch(() => setTree([]));
  }, [jobId]);

  // ---------- Fetch file content when selected ----------
  const handleFileSelect = useCallback(
    async (path) => {
      setSelectedFile(path);
      setFileLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/api/jobs/${jobId}/file?path=${encodeURIComponent(path)}`
        );
        if (res.ok) {
          const data = await res.json();
          setFileContent(data.content);
        } else {
          setFileContent('// Could not load file');
        }
      } catch {
        setFileContent('// Network error loading file');
      } finally {
        setFileLoading(false);
      }
    },
    [jobId]
  );

  // ---------- Bug lines for the current file ----------
  const fileBugs = useMemo(() => {
    if (!selectedFile) return {};
    const bugs = {};
    for (const f of findings) {
      // Normalize path separators for comparison
      const fPath = f.file?.replace(/\\/g, '/');
      const selPath = selectedFile?.replace(/\\/g, '/');
      if (fPath === selPath && f.line) {
        if (!bugs[f.line]) bugs[f.line] = [];
        bugs[f.line].push(f);
      }
    }
    return bugs;
  }, [findings, selectedFile]);

  // ---------- Chat ----------
  const sendChat = useCallback(
    async (e) => {
      e.preventDefault();
      const question = chatInput.trim();
      if (!question || chatStreaming) return;

      setChatInput('');
      setMessages((prev) => [...prev, { role: 'user', text: question }]);
      setChatStreaming(true);

      // Add empty assistant message that we'll stream into
      const assistantIdx = messages.length + 1;
      setMessages((prev) => [...prev, { role: 'assistant', text: '' }]);

      try {
        const controller = new AbortController();
        abortRef.current = controller;

        const res = await fetch(`${API_BASE}/api/jobs/${jobId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question }),
          signal: controller.signal,
        });

        if (!res.ok) {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: 'assistant',
              text: '⚠️ Could not get a response from the server.',
            };
            return updated;
          });
          setChatStreaming(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const payload = line.slice(6).trim();
              if (payload === '[DONE]') continue;
              try {
                const parsed = JSON.parse(payload);
                if (parsed.token) {
                  accumulated += parsed.token;
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      role: 'assistant',
                      text: accumulated,
                    };
                    return updated;
                  });
                }
              } catch {
                // skip malformed SSE data
              }
            }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: 'assistant',
              text: '⚠️ Connection error. Is the backend running?',
            };
            return updated;
          });
        }
      } finally {
        setChatStreaming(false);
        abortRef.current = null;
      }
    },
    [chatInput, chatStreaming, jobId, messages.length]
  );

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ---------- Render ----------
  const lines = fileContent?.split('\n') || [];

  return (
    <div className="ide-layout">
      {/* Left: File Tree */}
      <div className="ide-panel ide-tree-panel">
        <FileTree tree={tree} onFileSelect={handleFileSelect} selectedPath={selectedFile} />
      </div>

      {/* Center: Code Viewer */}
      <div className="ide-panel ide-code-panel">
        {!selectedFile ? (
          <div className="ide-placeholder">
            <FolderCode size={64} color="#FBBF24" className="ide-placeholder-icon" strokeWidth={1.5} />
            <div className="ide-placeholder-text">Select a file from the explorer</div>
            <div className="ide-placeholder-sub">
              Bug lines will be highlighted with colored markers
            </div>
          </div>
        ) : fileLoading ? (
          <div className="ide-placeholder">
            <div className="ide-loading-spinner" />
            <div className="ide-placeholder-text">Loading...</div>
          </div>
        ) : (
          <>
            <div className="ide-file-tab">
              <span className="ide-file-tab-name mono">{selectedFile}</span>
              {Object.keys(fileBugs).length > 0 && (
                <span className="ide-file-tab-bugs">
                  {Object.values(fileBugs).flat().length} issue
                  {Object.values(fileBugs).flat().length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="ide-code-scroll">
              <table className="ide-code-table">
                <tbody>
                  {lines.map((line, i) => {
                    const lineNum = i + 1;
                    const bugs = fileBugs[lineNum];
                    const hasBug = !!bugs;
                    const severity = hasBug
                      ? bugs.some((b) => b.severity === 'high')
                        ? 'high'
                        : bugs.some((b) => b.severity === 'medium')
                        ? 'medium'
                        : 'low'
                      : null;

                    return (
                      <tr
                        key={i}
                        className={`ide-code-line ${hasBug ? `ide-line-bug ide-line-${severity}` : ''}`}
                        id={hasBug ? `bug-line-${lineNum}` : undefined}
                      >
                        <td className="ide-gutter">
                          {hasBug && <span className={`ide-gutter-mark ide-gutter-${severity}`} />}
                          <span className="ide-line-num">{lineNum}</span>
                        </td>
                        <td className="ide-code-cell">
                          <pre className="ide-code-pre">{line || '\n'}</pre>
                          {hasBug && (
                            <div className={`ide-bug-annotation ide-bug-${severity}`}>
                              {bugs.map((b, bi) => (
                                <div key={bi} className="ide-bug-item">
                                  <span className={`ide-bug-sev ide-sev-${b.severity}`}>
                                    {b.severity?.toUpperCase()}
                                  </span>
                                  <span className="ide-bug-msg">{b.message}</span>
                                  {b.explanation && b.explanation !== b.message && (
                                    <div className="ide-bug-explain">{b.explanation}</div>
                                  )}
                                  {b.suggested_fix && (
                                    <div className="ide-bug-fix">
                                      💡 <span className="mono">{b.suggested_fix}</span>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Right: Chat Panel */}
      <div className="ide-panel ide-chat-panel">
        <div className="ide-chat-header">
          <MessageSquare size={16} color="#60A5FA" className="ide-chat-icon" />
          <span>Ask about this repo</span>
        </div>

        <div className="ide-chat-messages">
          {messages.length === 0 && (
            <div className="ide-chat-empty">
              <Bot size={48} color="#8B5CF6" className="ide-chat-empty-icon" strokeWidth={1.5} />
              <div>Ask anything about the scan results, bugs found, or code quality.</div>
              <div className="ide-chat-empty-hint">
                Try: "What are the most critical bugs?" or "Explain the security issues"
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`ide-chat-msg ide-chat-${msg.role}`}>
              <div className="ide-chat-avatar">
                {msg.role === 'user' ? <User size={16} color="#10B981" /> : <Bot size={16} color="#8B5CF6" />}
              </div>
              <div className="ide-chat-bubble">
                {msg.text || (chatStreaming && i === messages.length - 1 ? (
                  <span className="ide-chat-typing">Thinking...</span>
                ) : '')}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <form className="ide-chat-form" onSubmit={sendChat}>
          <input
            className="ide-chat-input"
            type="text"
            placeholder="Ask about the bugs..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            disabled={chatStreaming}
          />
          <button
            className="ide-chat-send"
            type="submit"
            disabled={chatStreaming || !chatInput.trim()}
          >
            {chatStreaming ? '⏳' : '→'}
          </button>
        </form>
      </div>
    </div>
  );
}
