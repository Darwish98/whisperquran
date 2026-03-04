# WhisperQuran

Quran recitation web app with real-time speech recognition and tajweed verification.

## Stack

- **Frontend:** React + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** FastAPI + NVIDIA FastConformer CTC (NeMo)
- **Auth:** Supabase
- **Audio CDN:** cdn.islamic.network

## Getting Started

```sh
# Install dependencies
npm i

# Start the development server
npm run dev
```

## Environment Variables

Create a `.env` file:

```
VITE_WS_URL=ws://localhost:8000/ws/transcribe
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Backend

See the `whisperquranBE` repository for the FastAPI backend setup.
