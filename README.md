[![Python](https://img.shields.io/badge/TypeScript-85.3%25-blue.svg?style=flat)](https://github.com/yosephfetene/Ethiopian-Premier-League-RAG)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg?style=flat)](https://nextjs.org)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat)](CONTRIBUTING.md)
[![last commit](https://img.shields.io/github/last-commit/yosephfetene/Ethiopian-Premier-League-RAG)](https://github.com/yosephfetene/Ethiopian-Premier-League-RAG/commits/main)

# 🏆 Ethiopian Premier League RAG Chatbot

> Ask anything about Ethiopia's top football league — and get intelligent, grounded answers.

This is an AI-powered chatbot that uses **Retrieval-Augmented Generation (RAG)** to answer questions about the **Ethiopian Premier League**. It retrieves relevant context from a curated knowledge base before generating responses, so you get accurate, up-to-date football insights rather than hallucinated guesses.

Built with **Next.js**, **TypeScript**, and a modern RAG pipeline, the app runs entirely in your browser-facing stack — just set your API keys and go.

👉 [Live Demo](#) *(coming soon)*

---

## ✨ Features

🎉 **Ask football questions naturally**
- Club histories, player stats, season results, league standings
- Match outcomes, top scorers, championship records

🎉 **RAG-powered accuracy**
- Answers are grounded in a real knowledge base, not just model memory
- Retrieves the most relevant documents before generating a response

🎉 **Clean, responsive UI**
- Built with Next.js App Router and modern React
- Works on desktop and mobile

---

## 🗂️ Project Structure

```
Ethiopian-Premier-League-RAG/
├── app/               # Next.js App Router — pages, API routes, components
├── scripts/           # Data ingestion and knowledge base preparation scripts
├── next.config.ts     # Next.js configuration
├── tsconfig.json      # TypeScript configuration
└── package.json
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- An OpenAI (or compatible) API key

### Installation

```bash
git clone https://github.com/yosephfetene/Ethiopian-Premier-League-RAG.git
cd Ethiopian-Premier-League-RAG
npm install
```

### Environment Variables

Create a `.env.local` file in the root:

```env
OPENAI_API_KEY=your_openai_api_key_here
# Add any other required keys (e.g., vector DB credentials)
```

### Run the Development Server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧠 How It Works

```
User Question
     │
     ▼
┌─────────────┐     ┌──────────────────────┐
│  Query      │────▶│  Vector Store        │
│  Embedding  │     │  (EPL Knowledge Base)│
└─────────────┘     └──────────┬───────────┘
                               │ Top-K relevant docs
                               ▼
                    ┌──────────────────────┐
                    │  LLM (e.g. GPT-4)    │
                    │  + Retrieved Context │
                    └──────────┬───────────┘
                               │
                               ▼
                         AI Answer ✅
```

1. **Ingest** — EPL data (clubs, players, history, seasons) is chunked and embedded into a vector store via the `scripts/` directory.
2. **Retrieve** — At query time, the user's question is embedded and matched against stored vectors to find the most relevant passages.
3. **Generate** — The retrieved context is passed to the LLM alongside the question, producing a grounded, accurate response.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React, TypeScript |
| Styling | CSS Modules / Tailwind |
| RAG Pipeline | LangChain / custom retrieval |
| LLM | OpenAI GPT (configurable) |
| Vector Store | Configurable (e.g. Pinecone, FAISS, Chroma) |
| Deployment | Vercel (recommended) |

---

## 📦 Preparing the Knowledge Base

The `scripts/` directory contains utilities for loading and embedding EPL data. To populate your vector store:

```bash
node scripts/ingest.js
# or
npx ts-node scripts/ingest.ts
```

*(Check individual script files for exact usage and required env vars.)*

---

## 🚢 Deploy on Vercel

The easiest deployment path is [Vercel](https://vercel.com/new):

```bash
npm run build
```

Or connect your GitHub repo to Vercel for automatic deployments on every push. Make sure to set your environment variables in the Vercel dashboard.

---

## 🤝 Contributing

Contributions are very welcome! Whether it's adding more EPL data, improving the retrieval pipeline, or polishing the UI — open a PR.

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

---

## 👤 Author

**Yoseph Fetene** — [@yosephfetene](https://github.com/yosephfetene)

---

## 📄 License

This project is open source. See the [LICENSE](LICENSE) file for details.

---

*ኢትዮጵያ ፕሪሚየር ሊግ — Ethiopia's top football, now answerable by AI.*
