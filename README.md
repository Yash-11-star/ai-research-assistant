# AI Research Assistant

A web application for finding, organizing, and understanding research papers. Users can search arXiv, save papers to a local library, upload their own PDFs, and use Google Gemini to summarize a paper or answer questions about it. Summaries and answers are based on the paper's actual text, not just its title or abstract.

## Features

- **Research paper search**: search arXiv by topic or keywords; results show title, authors, year, abstract, and links to the paper page and PDF.
- **Persistent paper library**: save search results to a local SQLite database; the library survives page refreshes and server restarts. Duplicate saves are detected.
- **PDF upload and metadata extraction**: upload a paper (PDF, up to 20 MB). Its full text is extracted, and the title, authors, year, and abstract are identified automatically. Every extracted field is checked against the PDF text, and fields that can't be confirmed are left blank instead of guessed.
- **AI paper summary**: a structured summary (TL;DR, problem, approach, methods, datasets & experiments, results, limitations) generated from the paper's full text.
- **Paper Q&A with evidence quotes**: ask a natural-language question about a paper and get an answer with supporting quotes copied from the paper.
- **Light/dark responsive UI**: follows the system color scheme, works on desktop and phone-width screens, and is keyboard accessible.

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 6, plain CSS (no UI framework) |
| Backend | Node.js, Express 4 |
| Storage | SQLite via Node's built-in `node:sqlite` module (no ORM) |
| External services | [arXiv API](https://info.arxiv.org/help/api/) for search; [Google Gemini API](https://ai.google.dev/) for metadata extraction, summaries, and Q&A |
| PDF processing | [`unpdf`](https://github.com/unjs/unpdf) (Mozilla pdf.js) |
| Other packages | `multer` (file uploads), `fast-xml-parser` (arXiv Atom feeds), `dotenv` (configuration), `cors` |

## Project structure

```
hw1-research-assistant/
├── client/                    React + Vite frontend
│   ├── index.html
│   ├── vite.config.js         Dev server; proxies /api to the backend
│   └── src/
│       ├── App.jsx            Layout, navigation, hash-based routing
│       ├── api.js             Backend API client
│       ├── components/
│       │   └── PaperCard.jsx  Paper display shared by all pages
│       └── pages/
│           ├── SearchPage.jsx
│           ├── LibraryPage.jsx
│           ├── UploadPage.jsx
│           └── PaperPage.jsx  Paper details, AI summary, Q&A
└── server/                    Express backend
    ├── .env.example           Configuration template
    ├── data/                  SQLite database and uploaded PDFs (created at runtime, not committed)
    └── src/
        ├── index.js           App setup and error handling
        ├── db.js              SQLite schema and queries
        ├── routes/            papers, search, upload, ai (summary + questions)
        └── services/
            ├── arxiv.js       arXiv search and result normalization
            ├── pdf.js         PDF validation and text extraction
            ├── metadata.js    Gemini metadata extraction + verification against the PDF
            ├── content.js     Gets a paper's text (stored, or downloaded once from arXiv)
            ├── context.js     Chooses which text to send for very long papers
            ├── llm.js         Summary and Q&A prompts, evidence verification
            └── gemini.js      Gemini REST client with retries and model fallback
```

## Prerequisites

- **Node.js 22.13 or newer** (required for the built-in `node:sqlite` module; developed and tested on Node 24)
- **npm** (bundled with Node.js)
- **A Google Gemini API key**: free from [Google AI Studio](https://aistudio.google.com/apikey)

## Setup

From a fresh clone:

```bash
# 1. Install server dependencies
cd server
npm install

# 2. Create your local configuration from the template
cp .env.example .env

# 3. Edit server/.env and set your key:
#    GEMINI_API_KEY=<your Gemini API key>

# 4. Install client dependencies
cd ../client
npm install
```

## Running the project

The backend and frontend run as two separate processes, so use **two terminals**.

**Terminal 1: backend** (from the project root)

```bash
cd server
npm install
node src/index.js
```

The API listens on **http://localhost:3001** (`npm start` does the same).

**Terminal 2: frontend** (from the project root)

```bash
cd client
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser. The Vite dev server forwards all `/api` requests to the backend, so the backend must be running.

To check that the backend is up: `curl http://localhost:3001/api/health`

## Environment variables

Set in `server/.env`. This file holds your API key and is **not committed** (it is listed in `.gitignore`); `server/.env.example` is the committed template.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | none | Google Gemini API key. Used only by the server. |
| `GEMINI_MODEL` | No | `gemini-3.5-flash` | Primary Gemini model. |
| `GEMINI_FALLBACK_MODEL` | No | `gemini-3.8-flash,gemini-3.5-flash-lite` | Comma-separated models tried in order when the primary model is overloaded or out of quota. |
| `PORT` | No | `3001` | Backend port. If changed, also update the proxy target in `client/vite.config.js`. |

## Usage

1. **Search Papers**: enter a topic (e.g. `transformer attention`) and press Search.
2. **Save**: click **Save to Library** on a result. Papers already in your library are marked **✓ Saved**.
3. **My Library**: browse saved and uploaded papers; delete papers you no longer need.
4. **Upload PDF**: choose a research-paper PDF and click **Upload**. Metadata extraction takes a few seconds.
5. **Open a paper**: in My Library, click **Open paper**.
6. **Generate Summary**: produces a sectioned summary of the paper.
7. **Ask a question**: type a question (e.g. *What datasets are used?*) and press Enter. The answer is shown with **Evidence from paper**.

## How the AI features stay grounded

- **Paper content, not metadata.** Summaries and answers are generated from the paper's extracted full text. Uploaded PDFs are extracted on upload. For papers saved from arXiv search, the server downloads and extracts the PDF the first time a summary or question is requested, then stores the text so it is not downloaded again.
- **Instructions to the model.** Gemini is told to use only the paper text, not to invent details, and to say when something is not stated in the paper.
- **Evidence verification.** Each quote Gemini offers as evidence is checked against the paper text by the server. Quotes that cannot be found are removed, and if no quote can be verified, the UI shows a warning to double-check the answer.
- **"Not enough information" is a normal answer.** If the paper does not contain the answer, the app says so instead of answering from general knowledge.
- **Metadata verification.** For uploads, the title, authors, year, and abstract proposed by Gemini are kept only if they can be found in the PDF text.

## Known limitations

- **Search ranking is basic.** The app uses arXiv's own relevance ranking; for an exact title, adding an author name or keyword helps.
- **Scanned PDFs are not supported.** Image-only PDFs without a text layer cannot be processed (there is no OCR).
- **Gemini free-tier limits.** Quotas are small and per model, per day. When a model is overloaded or out of quota the server falls back to the next configured model (possibly with lower answer quality), and requests fail with a clear message if all models are unavailable.
- **Metadata extraction depends on PDF layout.** Unusual layouts can leave some fields blank (they are not guessed), and a publication year is taken from what the PDF states (e.g. a venue line or arXiv stamp), which can differ from arXiv's first-submission year.
- **Very long documents** (over about 120,000 characters) are not sent in full; the beginning, the end, and the sections most relevant to the question are used instead. Typical conference papers are sent in full.
- **Single-user, local app.** There is no authentication; summaries and answers are not saved and are cleared on a page refresh.

## Security and privacy notes

- **The Gemini API key stays on the server.** The browser only talks to the backend; the key is never sent to the frontend or included in responses.
- **Uploaded files stay local.** PDFs are stored in `server/data/uploads/` under randomly generated names (the original filename is never used as a path), and the database is `server/data/papers.db`. Neither is committed.
- **Restricted downloads.** When the server fetches a PDF for a saved search result, it only downloads from arXiv hosts over HTTPS, so a crafted paper link cannot make the server request other addresses.
- **Input validation.** Uploads are limited to 20 MB and must be real PDFs (checked by file content, not just the extension). All API inputs are validated.

## API overview

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/search?q=<text>` | Search arXiv (up to 10 results) |
| GET | `/api/papers` | List saved and uploaded papers |
| GET | `/api/papers/:id` | Get one paper |
| POST | `/api/papers` | Save a paper (e.g. a search result) |
| DELETE | `/api/papers/:id` | Delete a paper and its uploaded PDF |
| POST | `/api/papers/upload` | Upload a PDF (`multipart/form-data`, field `file`) |
| POST | `/api/papers/:id/summary` | Generate an AI summary |
| POST | `/api/papers/:id/questions` | Ask a question: `{ "question": "..." }` |

## About

Built by Yash Tembhurnikar for Homework 1 of CS 59300 – Advanced Software Engineering at Purdue University.
