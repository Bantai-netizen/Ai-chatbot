import type { VercelRequest, VercelResponse } from '@vercel/node';

type RetrievalResult = {
  content: string;
  similarity: number;
  metadata: {
    module?: string | null;
    lesson?: string | null;
    timestamp?: string | null;
    speaker?: string | null;
    source?: string | null;
  };
};

const STEP_EVENTS = {
  course: 'Searching course...',
  mindset: 'Searching mindset...',
  calls: 'Searching calls...',
  synth: 'Synthesizing...'
};

function detectPrimaryKB(query: string): 'course' | 'mindset' | 'calls' {
  const q = query.toLowerCase();
  const courseSignals = ['concept', 'strategy', 'framework', 'module', 'lesson', 'training'];
  const mindsetSignals = ['belief', 'motivation', 'mindset', 'fear', 'procrastination', 'worksheet', 'reflection', 'tools'];
  const callsSignals = ['troubleshoot', 'example', 'call', 'recording', 'case', 'stuck', 'issue', 'problem'];

  if (courseSignals.some(s => q.includes(s))) return 'course';
  if (mindsetSignals.some(s => q.includes(s))) return 'mindset';
  if (callsSignals.some(s => q.includes(s))) return 'calls';
  // default to course
  return 'course';
}

function getBaseUrl(req: VercelRequest): string {
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  const proto = (req.headers['x-forwarded-proto'] || 'https') as string;
  return `${proto}://${host}`;
}

async function retrieve(baseUrl: string, which: 'course' | 'mindset' | 'calls', query: string): Promise<RetrievalResult[]> {
  const url = `${baseUrl}/api/retrieve/${which}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query })
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  return (data.results || []) as RetrievalResult[];
}

function sseWrite(res: VercelResponse, event: string, data: any) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
}

function formatAnswerTemplate(course: RetrievalResult[], mindset: RetrievalResult[], calls: RetrievalResult[], query: string): string {
  const topCourse = course[0];
  const topMindset = mindset[0];
  const topCall = calls[0];

  const citeCourse = topCourse && topCourse.similarity >= 0.65 ? `(${topCourse.metadata.module || 'Module'}, ${topCourse.metadata.lesson || 'Lesson'}, ${topCourse.metadata.timestamp || 'timestamp'})` : '';
  const citeCall = topCall && topCall.similarity >= 0.65 ? `(${topCall.metadata.source || 'call'}, ${topCall.metadata.timestamp || 'timestamp'})` : '';
  const citeMindset = topMindset && topMindset.similarity >= 0.65 ? `(${topMindset.metadata.module || 'Mindset'}, ${topMindset.metadata.lesson || 'Worksheet'}, ${topMindset.metadata.timestamp || 'timestamp'})` : '';

  // Guardrail: refuse if none exceed 0.65
  const hasGood = [topCourse, topMindset, topCall].some(r => r && r.similarity >= 0.65);
  if (!hasGood) {
    const suggestModules = [
      course[0]?.metadata.module,
      course[1]?.metadata.module,
      course[2]?.metadata.module
    ].filter(Boolean);
    return [
      'I don’t have high-confidence material to advise from right now (no retrieved chunk exceeded 0.65 similarity).',
      `Please review: ${Array.from(new Set(suggestModules)).slice(0,3).join(', ') || 'the core training modules'}.`,
      'After reviewing, ask again with details like the exact module and lesson.'
    ].join(' ');
  }

  const fromTrainingQuotes = course.slice(0, 2).map(r => `“${r.content.slice(0, 240)}...” ${citeCourse}`).join('\n');
  const pitfalls = calls.slice(0, 2).map(r => `- ${r.content.slice(0, 200)} ${citeCall}`).join('\n');
  const mindsetShift = topMindset ? `${topMindset.content.slice(0, 300)} ${citeMindset}` : 'Adopt the recommended mindset from the training materials.';

  const implSteps = [
    'Clarify the objective based on the core concept.',
    'Identify the relevant module and lesson; extract 2–3 actionable tactics.',
    'Schedule time blocks; define inputs/outputs for each step.',
    'Run a small test; collect feedback; iterate.'
  ].map((s, i) => `${i+1}. ${s}`).join('\n');

  const toolsResources = mindset.slice(0, 2).map(r => `- ${r.metadata.lesson || 'Worksheet'}: ${r.content.slice(0, 160)} ${citeMindset}`).join('\n');

  return [
    '## Core Concept',
    topCourse ? topCourse.content.slice(0, 400) : 'Refer to the course core concept.',
    '## From The Training (with quotes + module/timestamp)',
    fromTrainingQuotes || 'See the training for detailed guidance.',
    '## Implementation Steps',
    implSteps,
    '## Common Pitfalls (from calls)',
    pitfalls || '- Review call recordings to avoid common mistakes.',
    '## Mindset Shift Required',
    mindsetShift,
    '## Tools & Resources (worksheets)',
    toolsResources || '- Use the provided worksheets to structure reflection.'
  ].join('\n\n');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const stream = (req.query.stream || req.query.s) ? true : false;
  const query = (req.method === 'POST' ? (req.body?.query || req.body) : (req.query.q || req.query.query)) as string;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: "Missing 'query' parameter or body" });
  }

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const baseUrl = getBaseUrl(req);
    const primary = detectPrimaryKB(query);

    // Emit step events
    if (primary === 'course') sseWrite(res, 'step', STEP_EVENTS.course);
    if (primary === 'mindset') sseWrite(res, 'step', STEP_EVENTS.mindset);
    if (primary === 'calls') sseWrite(res, 'step', STEP_EVENTS.calls);

    const primaryRes = await retrieve(baseUrl, primary, query);

    // Fallback searches
    const secondaries: ('course'|'mindset'|'calls')[] = ['course', 'mindset', 'calls'].filter(s => s !== primary);
    for (const sec of secondaries) {
      sseWrite(res, 'step', STEP_EVENTS[sec]);
    }
    const [secA, secB] = secondaries;
    const [resA, resB] = await Promise.all([
      retrieve(baseUrl, secA, query),
      retrieve(baseUrl, secB, query)
    ]);

    sseWrite(res, 'step', STEP_EVENTS.synth);

    const course = primary === 'course' ? primaryRes : (secA === 'course' ? resA : resB);
    const mindset = primary === 'mindset' ? primaryRes : (secA === 'mindset' ? resA : resB);
    const calls = primary === 'calls' ? primaryRes : (secA === 'calls' ? resA : resB);

    const answer = formatAnswerTemplate(course, mindset, calls, query);

    // Stream tokens
    const tokens = answer.split(/(\s+)/);
    for (const t of tokens) {
      sseWrite(res, 'token', t);
      // keep within Vercel Hobby limits; minimal delay
    }
    sseWrite(res, 'done', 'true');
    res.end();
  } else {
    const baseUrl = getBaseUrl(req);
    const primary = detectPrimaryKB(query);
    const primaryRes = await retrieve(baseUrl, primary, query);
    const secondaries: ('course'|'mindset'|'calls')[] = ['course', 'mindset', 'calls'].filter(s => s !== primary);
    const [secA, secB] = secondaries;
    const [resA, resB] = await Promise.all([
      retrieve(baseUrl, secA, query),
      retrieve(baseUrl, secB, query)
    ]);

    const course = primary === 'course' ? primaryRes : (secA === 'course' ? resA : resB);
    const mindset = primary === 'mindset' ? primaryRes : (secA === 'mindset' ? resA : resB);
    const calls = primary === 'calls' ? primaryRes : (secA === 'calls' ? resA : resB);

    const answer = formatAnswerTemplate(course, mindset, calls, query);
    return res.status(200).json({ answer, steps: ['search', 'synth'], primary });
  }
}