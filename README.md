# Jarvis Desktop Assistant

A clipboard-first AI desktop assistant for macOS that leverages Google Gemini, ElevenLabs, and other AI services to provide context-aware assistance.

## Features

- **Global Voice Activation**: `Alt+Space` for assistant mode and `Alt+Shift+Space` for dictation mode
- **Streaming Speech-to-Text**: Real-time Gradium STT with persistent connection and automatic reconnect behavior
- **Dictation Cleanup Mode**: Cleans spoken filler/corrections and inserts polished text directly at cursor
- **Clipboard-First Context Engine**: Uses clipboard text/image plus active app/window title to drive task routing
- **Intelligent Task Router**: Routes requests into `text_task`, `image_edit`, `image_generate`, `image_explain`, `weather_query`, `webpage_read`, `background_remove`, and `calendar_list`
- **Text Workflows**:
  - Clipboard rewrite
  - Clipboard explanation
  - Direct Q&A
  - Context-aware drafting with app-specific tone adaptation
- **Smart Tone + Model Selection**: Picks formal/casual/technical/creative/neutral tone based on active app; switches to coding-focused model in coding environments
- **Image Workflows**:
  - Generate new images from prompt
  - Edit clipboard images from prompt
  - Explain/analyze clipboard images
  - Remove background from clipboard images (Remove.bg)
- **Website Read/Summarize**: Reads and summarizes webpage content from explicit URL or URL found in clipboard
- **Weather Intelligence**: Weather for any location, optional Celsius/Fahrenheit handling, and current-location fallback
- **Google Calendar Integration (Read-only)**:
  - OAuth connect flow from Settings or voice command (`/auth-calendar`)
  - List events for today, this week, or upcoming
  - Human-friendly event time formatting
- **Memory System**: Persistent user memory notes editable in Settings and reused in prompts
- **Text-to-Speech Output**:
  - Provider toggle: Gradium or ElevenLabs
  - Optional "Speak responses" mode
  - Automatic fallback to overlay if TTS fails
  - `Ctrl+C` stops active playback
- **Multi-Window Desktop UX**:
  - Settings window
  - Floating push-to-talk pill with live waveform and state indicators
  - Response overlay for text/image results with transcript/context metadata, quick Copy, and `Esc` dismiss
- **Permissions + OS Integration**:
  - Microphone and Accessibility permission checks/request flow
  - Cursor text insertion with clipboard-preserving paste fallback
  - Menu bar tray app with global shortcuts and native notifications

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

# Required for background removal: Remove.bg API Key
REMOVEBG_API_KEY=your_removebg_api_key_here

# Optional: Google Calendar API (for calendar features)
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback
```

### Getting API Keys

1. **Gemini API**: Get from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. **Gradium API**: Get from [Gradium](https://gradium.ai)
3. **Weather API**: Get from [WeatherAPI.com](https://www.weatherapi.com/)
4. **ElevenLabs API**: Get from [ElevenLabs](https://elevenlabs.io)
5. **Remove.bg API**: Get from [Remove.bg](https://www.remove.bg/api) (50 free images/month)
6. **Google Calendar API** (Optional): Follow the setup guide below

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

The TTS feature allows Jarvis to read text aloud using your selected provider (Gradium or ElevenLabs) in two ways:

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
- Convert it to speech using your selected provider
- Play the audio automatically

**Features:**
- 🎯 Works with ANY query (weather, text, calculations, explanations)
- 🧹 Cleans formatting noise before speech for better playback quality
- 🔊 Supports both Gradium and ElevenLabs providers
- ⚡ ElevenLabs path supports up to 5000 characters per read-aloud call
- 🔄 Automatic fallback to response overlay if TTS fails
- ⏹️ Press `Ctrl+C` to stop active playback

**Use Cases:**
- 🚗 Hands-free information while driving
- 🍳 Get instructions while cooking
- 🏃 Stay informed while exercising
- 👀 Rest your eyes while working
- ♿ Accessibility support

### Background Removal Feature

Remove backgrounds from images with a simple voice command:

1. Copy an image to your clipboard (e.g., a product photo, portrait, or any image)
2. Press **Alt+Space** and say:
   - "Remove the background"
   - "Delete the background from this image"
   - "Make the background transparent"
   - "Remove background"

Jarvis will:
- Process the image using Remove.bg's AI
- Remove the background automatically
- Show the result image in the response overlay
- Let you copy the processed image from the overlay

**Use Cases:**
- 📸 Product photography for e-commerce
- 👤 Profile pictures and avatars
- 🎨 Graphic design and photo editing
- 📊 Presentations and marketing materials
- 🖼️ Social media content creation

**Technical Details:**
- High-quality AI-powered background removal
- Supports PNG and JPG/JPEG formats
- Output is always PNG with transparency
- Free tier: 50 images/month
- After free tier: $0.20/image

### Google Calendar Feature

Access and view your Google Calendar events with simple voice commands:

#### Setup (One-time)

1. **Create Google Cloud Project**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one
   - Enable the Google Calendar API

2. **Create OAuth2 Credentials**:
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - Choose "Desktop app" as application type
   - Download the credentials JSON
   - Copy `client_id` and `client_secret` to your `.env` file

3. **Configure OAuth Consent Screen**:
   - Add your email as a test user
   - Add scope: `https://www.googleapis.com/auth/calendar.readonly`

4. **Authenticate**:
   - Open Jarvis Settings and click **Connect Google Calendar**
   - Or run the command `/auth-calendar`
   - Follow the OAuth flow in your browser
   - Grant read-only access to your calendar

#### Usage

Press **Alt+Space** and say:
- "What's on my calendar today?"
- "Show me my upcoming events"
- "What meetings do I have this week?"
- "List my calendar events"
- "What's my schedule for today?"

Jarvis will:
- Connect to your Google Calendar
- Retrieve your events
- Display them in an easy-to-read format
- Show event times, titles, and locations

**Features:**
- 📅 View today's, this week's, or upcoming events
- 🔒 Read-only access (cannot modify your calendar)
- ⏰ Smart time formatting (shows "Today at 2:00 PM")
- 📍 Displays event locations when available
- 🔄 Automatic token refresh for seamless access

**Privacy:**
- Only reads calendar data (cannot create or modify events)
- Credentials stored locally on your device
- Calendar access is handled through Google's OAuth + Calendar APIs

### Other Voice Commands

- **Text Rewriting**: "Rewrite this more formally"
- **Text Explanation**: "Explain this code"
- **Direct Queries**: "What's the weather in New York?"
- **Image Generation**: "Create a sunset logo"
- **Image Editing**: "Make this image darker"
- **Image Analysis**: "Describe this image"
- **Website Summary**: "Summarize this webpage" (uses URL from clipboard if needed)
- **Calendar Auth Command**: "/auth-calendar"

## Architecture

### Services

- **gemini-service.ts**: Text processing and task routing
- **gemini-image-service.ts**: Image generation and editing
- **gradium-stt-service.ts**: Speech-to-text
- **elevenlabs-tts-service.ts**: Text-to-speech
- **background-removal-service.ts**: Background removal (NEW!)
- **weather-service.ts**: Weather information
- **calendar-service.ts**: Google Calendar event retrieval and formatting
- **calendar-auth-helper.ts**: Google OAuth flow handling
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
6. **webpage_read**: Read and summarize website content
7. **background_remove**: Remove image backgrounds
8. **calendar_list**: List calendar events

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

### Background Removal Not Working

1. Verify `REMOVEBG_API_KEY` is set in `.env`
2. Ensure you have copied an image to clipboard before asking to remove background
3. Check that your API key has remaining credits (50 free/month)
4. Supported formats: PNG, JPG, JPEG
5. Look at logs for API errors: `~/Library/Logs/jarvis-desktop-mvp/`

### No Audio Playback

- **macOS**: Ensure system audio is enabled
- **Linux**: Install `paplay`, `aplay`, or `ffplay`
- **Windows**: Audio playback should work out of the box

### Voice Recognition Issues

1. Grant microphone permissions when prompted
2. Verify `GRADIUM_API_KEY` is correct
3. Check internet connection

### Google Calendar Not Working

1. Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in `.env`
2. Ensure Google Calendar API is enabled in your Google Cloud project
3. Check that your OAuth consent screen is configured with test users
4. Make sure the redirect URI matches: `http://localhost:3000/oauth2callback`
5. Try re-authenticating by running the calendar authentication flow again
   - Use Settings → Google Calendar → Connect Google Calendar
   - Or run `/auth-calendar`
6. Look at logs for API errors: `~/Library/Logs/jarvis-desktop-mvp/`

## Contributing

Contributions are welcome! Please follow the existing code style and add tests for new features.

## License

[Add your license here]

## Acknowledgments

- Google Gemini for AI processing
- ElevenLabs for text-to-speech
- Gradium for speech-to-text
- WeatherAPI for weather data
