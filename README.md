# OpenAI Voice Chat

A web application that allows users to interact with OpenAI's voice API in real-time.

## Features

- Real-time voice recording
- Speech-to-text using OpenAI's Whisper API
- Text processing with OpenAI's GPT-4o
- Text-to-speech using OpenAI's TTS API
- Simple, responsive UI with Tailwind CSS

## Prerequisites

- Node.js and npm installed
- An OpenAI API key

## Setup

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/openai-voice-chat.git
   cd openai-voice-chat
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory and add your OpenAI API key:
   ```
   PORT=3000
   OPENAI_API_KEY=your_openai_api_key_here
   ```

4. Start the server:
   ```
   npm run dev
   ```

5. Open your browser and navigate to `http://localhost:3000`

## Usage

1. Click the "Press to Talk" button
2. Speak your message
3. Release the button to send your message to OpenAI
4. Listen to the AI's response

## Technology Stack

- Frontend: HTML, CSS (Tailwind), JavaScript
- Backend: Node.js, Express
- APIs: OpenAI (Whisper for STT, GPT-4o for chat, TTS for speech)

## License

ISC

## Note

This is a simple demo application. For production use, you should implement proper error handling, authentication, and other security measures. 