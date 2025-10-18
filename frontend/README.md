# Frontend

This directory will contain the Next.js 14 App Router UI for the Cloud-only ACQ-style Advisor.

Planned features:
- Chat UI with streamed assistant responses.
- Left pane step badges that update live.
- Toggle between "Server Mode (RAG)" and "Direct AI (Puter)".
- Settings for model choice and "thinking vs chat" mode.
- Puter.js integration via CDN for Qwen models (no API keys).

Deployment:
- Built and deployed on Vercel via vercel.json configuration and GitHub Actions (CI).