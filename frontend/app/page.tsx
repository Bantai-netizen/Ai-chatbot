'use client';

import { useEffect, useRef, useState } from 'react';

type StepEvent = 'Searching course...' | 'Searching mindset...' | 'Searching calls...' | 'Synthesizing...';

export default function Page() {
  const [mode, setMode] = useState<'server' | 'direct'>('server');
  const [model, setModel] = useState<'qwen/qwen3-235b-a22b:free' | 'qwen/qwq-32b:free'>('qwen/qwen3-235b-a22b:free');
  const [thinking, setThinking] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [answer, setAnswer] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close();
      }
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSteps([]);
    setAnswer('');
    setLoading(true);

    if (mode === 'server') {
      const url = `/api/advise?stream=true`;
      const es = new EventSource(url, { withCredentials: false });
      esRef.current = es;

      es.addEventListener('open', () => {
        // send query via fetch to initiate stream if needed; here we rely on SSE only for output, a POST would be required;
        // instead, use fetch to initiate, then listen to events:
        es.close();
        // fallback: use fetch with streaming disabled
        fetch('/api/advise?stream=true', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query })
        }).then(async (resp) => {
          // No need to process here; SSE handled in server; but vercel SSE from POST is supported by fetch event-stream
          // Implement a client-side SSE using ReadableStream:
          const reader = resp.body?.getReader();
          if (!reader) return;
          const decoder = new TextDecoder();
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            for (let i = 0; i < parts.length - 1; i++) {
              const block = parts[i];
              const lines = block.split('\n');
              let event = '';
              let data = '';
              for (const line of lines) {
                if (line.startsWith('event:')) event = line.replace('event:', '').trim();
                if (line.startsWith('data:')) data = line.replace('data:', '').trim();
              }
              if (event === 'step') {
                setSteps((prev) => [...prev, data as StepEvent]);
              } else if (event === 'token') {
                setAnswer((prev) => prev + data);
              } else if (event === 'done') {
                setLoading(false);
              }
            }
            buf = parts[parts.length - 1];
          }
        }).catch(() => setLoading(false));
      });

    } else {
      // Direct AI via Puter.js (client-side). No backend.
      setLoading(true);
      try {
        // @ts-ignore
        const puter = (window as any).puter;
        if (!puter || !puter.ai) throw new Error('Puter.js not loaded');
        const stream = await puter.ai.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: 'You are an ACQ-style advisor providing helpful guidance.' },
            { role: 'user', content: query }
          ],
          stream: true,
          thinking: thinking ? 'small' : 'none'
        });

        for await (const chunk of stream) {
          const t = chunk?.choices?.[0]?.delta?.content || '';
          setAnswer((prev) => prev + (t || ''));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside style={{ width: 280, borderRight: '1px solid #eee', padding: 12 }}>
        <h3>Steps</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {steps.map((s, i) => (
            <span key={i} style={{ padding: '6px 10px', borderRadius: 8, background: '#f5f5f5' }}>{s}</span>
          ))}
        </div>
        <hr />
        <h3>Mode</h3>
        <label>
          <input type="radio" name="mode" checked={mode === 'server'} onChange={() => setMode('server')} />
          Server Mode (RAG)
        </label>
        <label style={{ marginLeft: 8 }}>
          <input type="radio" name="mode" checked={mode === 'direct'} onChange={() => setMode('direct')} />
          Direct AI (Puter)
        </label>
        <hr />
        <h3>Settings</h3>
        <div>
          <label>Model</label>
          <select value={model} onChange={(e) => setModel(e.target.value as any)}>
            <option value="qwen/qwen3-235b-a22b:free">Qwen3 235B (free)</option>
            <option value="qwen/qwq-32b:free">QWQ 32B (free)</option>
          </select>
        </div>
        <div style={{ marginTop: 8 }}>
          <label>
            <input type="checkbox" checked={thinking} onChange={(e) => setThinking(e.target.checked)} />
            Thinking vs Chat
          </label>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 16 }}>
        <h2>ACQ Advisor</h2>
        <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask for concept, implementation, or mindset..."
            style={{ flex: 1, padding: 10, border: '1px solid #ccc', borderRadius: 6 }}
          />
          <button disabled={loading} type="submit" style={{ padding: '10px 14px' }}>
            {loading ? 'Working...' : 'Ask'}
          </button>
        </form>
        <div style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}>
          {answer}
        </div>
      </main>
    </div>
  );
}