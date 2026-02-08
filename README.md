# Jarvis Desktop Assistant

A clipboard-first AI desktop assistant for macOS that leverages Google Gemini, ElevenLabs, and other AI services to provide context-aware assistance.

## Features

- **Voice Input**: Push-to-talk with speech-to-text using Gradium
- **Text Processing**: Intelligent text rewriting, explaining, and querying
- **Image Generation & Editing**: Create and modify images using Gemini
- **Image Analysis**: Explain and analyze clipboard images
- **Weather Queries**: Get weather information for any location
- **Text-to-Speech**: Read text aloud using ElevenLabs (NEW!)
- **Memory System**: Save and recall important user information
- **Context-Aware**: Adapts tone and behavior based on active application

## Setup

### Prerequisites

- Node.js (v18 or higher)
- pnpm
- macOS (for full functionality)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd jarvis
```

2. Install dependencies:
```bash
pnpm install
```

3. Configure environment variables:

Create a `.env` file in the root directory with the following keys:

```env
# Required: Gemini API Key for text and image processing
GEMINI_API_KEY=your_gemini_api_key_here

# Optional: Model configurations
GEMINI_TEXT_MODEL=gemini-2.5-flash-lite
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image

# Required: Gradium API for speech-to-text
GRADIUM_API_KEY=your_gradium_api_key_here
GRADIUM_STT_REGION=us
GRADIUM_STT_MODEL=default

# Required: Weather API
WEATHER_API_KEY=your_weather_api_key_here

# Required for TTS: ElevenLabs API Key
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
```

### Getting API Keys

1. **Gemini API**: Get from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. **Gradium API**: Get from [Gradium](https://gradium.ai)
3. **Weather API**: Get from [WeatherAPI.com](https://www.weatherapi.com/)
4. **ElevenLabs API**: Get from [ElevenLabs](https://elevenlabs.io)

### Running the App

Development mode:
```bash
pnpm dev
```

Build for production:
```bash
pnpm build
```

## Usage

### Keyboard Shortcuts

- **Alt+Space**: Push-to-talk (voice input)
- **Alt+Shift+Space**: Push-to-talk (dictation mode)

### Text-to-Speech Feature

The TTS feature allows Jarvis to read text aloud using ElevenLabs in two ways:

#### 1. Read Existing Content
Copy text to your clipboard and have it read aloud:

1. Copy text (e.g., an article, email, or document)
2. Press **Alt+Space** and say:
   - "Read this aloud"
   - "Read this article"
   - "Speak this text"

#### 2. Read Generated Responses (NEW!)
Have any response read aloud instead of copied/inserted:

1. Press **Alt+Space** and say:
   - "What's the weather in New York? **Read it out loud**"
   - "Tell me about Apple stock. **Speak it**"
   - "Explain what HTML is. **Say it aloud**"
   - "What's 25 times 47? **Read it out loud**"

Jarvis will:
- Generate the response (weather, calculations, explanations, etc.)
- Clean up the text (remove markdown, HTML, code blocks, etc.)
- Convert it to speech using ElevenLabs
- Play the audio automatically

**Features:**
- 🎯 Works with ANY query (weather, text, calculations, explanations)
- 🧹 Automatically cleans text for better speech quality
- 🔊 Uses natural-sounding ElevenLabs voices
- ⚡ Supports up to 5000 characters (~5 minutes of speech)
- 🔄 Automatic fallback to clipboard if TTS fails
- 👤 Default voice: Adam (customizable in code)

**Use Cases:**
- 🚗 Hands-free information while driving
- 🍳 Get instructions while cooking
- 🏃 Stay informed while exercising
- 👀 Rest your eyes while working
- ♿ Accessibility support

### Other Voice Commands

- **Text Rewriting**: "Rewrite this more formally"
- **Text Explanation**: "Explain this code"
- **Direct Queries**: "What's the weather in New York?"
- **Image Generation**: "Create a sunset logo"
- **Image Editing**: "Make this image darker"
- **Image Analysis**: "Describe this image"

## Architecture

### Services

- **gemini-service.ts**: Text processing and task routing
- **gemini-image-service.ts**: Image generation and editing
- **gradium-stt-service.ts**: Speech-to-text
- **elevenlabs-tts-service.ts**: Text-to-speech (NEW!)
- **weather-service.ts**: Weather information
- **memory-service.ts**: User memory management
- **context-service.ts**: Clipboard and app context capture
- **app-tone-service.ts**: Tone adaptation based on active app

### Task Routing

The app uses an intelligent router to determine the appropriate action:

1. **text_task**: General text processing
2. **image_edit**: Edit existing clipboard images
3. **image_generate**: Generate new images
4. **image_explain**: Analyze and explain images
5. **weather_query**: Fetch weather information
6. **tts_read_aloud**: Read text aloud (NEW!)

## Development

### Project Structure

```
src/
├── main/              # Electron main process
│   ├── services/      # Backend services
│   ├── ipc.ts         # IPC handlers
│   └── index.ts       # Main entry point
├── renderer/          # React frontend
└── preload/           # Preload scripts
```

### Adding New Features

1. Create a new service in `src/main/services/`
2. Add route type to `TaskRouterRoute` in `gemini-service.ts`
3. Update router system prompt to detect new commands
4. Add handler in `task-runner.ts`
5. Register IPC channels if needed

## Troubleshooting

### TTS Not Working

1. Verify `ELEVENLABS_API_KEY` is set in `.env`
2. Check that text is copied to clipboard before asking to read aloud
3. Look at logs for API errors: `~/Library/Logs/jarvis-desktop-mvp/`

### No Audio Playback

- **macOS**: Ensure system audio is enabled
- **Linux**: Install `paplay`, `aplay`, or `ffplay`
- **Windows**: Audio playback should work out of the box

### Voice Recognition Issues

1. Grant microphone permissions when prompted
2. Verify `GRADIUM_API_KEY` is correct
3. Check internet connection

## Contributing

Contributions are welcome! Please follow the existing code style and add tests for new features.

## License

[Add your license here]

## Acknowledgments

- Google Gemini for AI processing
- ElevenLabs for text-to-speech
- Gradium for speech-to-text
- WeatherAPI for weather data
