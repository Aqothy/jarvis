# ElevenLabs Text-to-Speech Integration Guide

## Overview

Jarvis now includes ElevenLabs text-to-speech capabilities, allowing it to read text aloud from your clipboard.

## Quick Start

### 1. Get ElevenLabs API Key

1. Visit [ElevenLabs](https://elevenlabs.io)
2. Sign up or log in
3. Navigate to your profile → API Keys
4. Generate a new API key
5. Copy the API key

### 2. Configure Environment

Add your ElevenLabs API key to `.env`:

```env
ELEVENLABS_API_KEY=your_actual_api_key_here
```

### 3. Use the Feature

**Example Use Case: Reading an Article**

1. Open an article in your browser
2. Select and copy the article text (Cmd+A, Cmd+C)
3. Press **Alt+Space** (push-to-talk)
4. Say: "Read this article aloud"
5. Jarvis will read the article using natural-sounding speech

**Voice Commands That Trigger TTS:**
- "Read this aloud"
- "Read this article"
- "Speak this text"
- "Narrate this"
- "Read this out loud"
- "Say this aloud"

## Features

### Automatic Text Cleaning

The TTS service automatically cleans text for better speech quality:

- ✅ Removes markdown code blocks
- ✅ Removes inline code
- ✅ Converts markdown links to plain text
- ✅ Removes HTML tags
- ✅ Removes URLs
- ✅ Removes markdown formatting (bold, italic, headers)
- ✅ Normalizes whitespace

**Example:**

Input:
```
# My Article

Check out [this link](https://example.com)!

Here's some `code` and a code block:
```python
print("hello")
```

This is **bold** text.
```

Cleaned Output:
```
My Article Check out this link! Here's some code This is bold text.
```

### Text Length Limits

- Maximum: 5000 characters (~5 minutes of speech)
- If text exceeds limit, it will be truncated with "..."
- Notification will show when truncation occurs

### Voice Customization

Default voice is "Adam". To use a different voice:

1. Get available voices from [ElevenLabs Voice Library](https://elevenlabs.io/voice-library)
2. Modify the service (edit `elevenlabs-tts-service.ts`):

```typescript
private static defaultVoice = "Rachel"; // Change to your preferred voice
```

Popular voices:
- Adam (default) - American male
- Rachel - American female
- Domi - American female
- Antoni - American male
- Bella - American female

## How It Works

### Architecture

```
User says "Read this aloud"
  ↓
Task Router detects TTS request
  ↓
ElevenLabsTtsService.readAloud()
  ├─ Extract & clean clipboard text
  ├─ Call ElevenLabs API
  ├─ Save audio to local file
  └─ Play audio using system player
```

### File Storage

Audio files are saved temporarily to:
```
~/Library/Application Support/jarvis-desktop-mvp/tts/
```

Files are automatically cleaned up when a new TTS request is made.

## Troubleshooting

### Issue: "ELEVENLABS_API_KEY is not set"

**Solution:**
1. Make sure you added the API key to `.env`
2. Restart the application after adding the key
3. Verify the key is correct (no extra spaces)

### Issue: "No text found to read aloud"

**Solution:**
1. Make sure you copied text to clipboard first
2. Try copying the text again
3. Verify clipboard contains text (not an image)

### Issue: No audio plays

**Solution (macOS):**
```bash
# Test if afplay works
afplay /System/Library/Sounds/Ping.aiff
```

**Solution (Linux):**
```bash
# Install audio player
sudo apt-get install alsa-utils  # For aplay
# or
sudo apt-get install pulseaudio-utils  # For paplay
```

### Issue: "Failed to fetch voices"

**Solution:**
1. Check internet connection
2. Verify API key is valid
3. Check ElevenLabs API status
4. Service will fallback to default voice

### Issue: Poor speech quality

**Solution:**
1. Check that text was properly cleaned
2. Try a different voice
3. Adjust voice settings in code:

```typescript
voice_settings: {
  stability: 0.5,        // 0-1, higher = more consistent
  similarity_boost: 0.75 // 0-1, higher = more like original voice
}
```

## API Usage & Costs

ElevenLabs offers:
- **Free Tier**: 10,000 characters/month
- **Starter**: 30,000 characters/month ($5)
- **Creator**: 100,000 characters/month ($22)
- **Pro**: 500,000 characters/month ($99)

**Average Usage:**
- Short email: ~500 characters
- Medium article: ~3,000 characters
- Long article: ~5,000 characters

Monitor your usage at: [ElevenLabs Dashboard](https://elevenlabs.io/subscription)

## Advanced Configuration

### Change Voice Model

Edit `elevenlabs-tts-service.ts`:

```typescript
body: JSON.stringify({
  text,
  model_id: "eleven_multilingual_v2", // Change this
  voice_settings: {
    stability: 0.5,
    similarity_boost: 0.75,
  },
}),
```

Available models:
- `eleven_monolingual_v1` - English only (default)
- `eleven_multilingual_v2` - 29 languages
- `eleven_turbo_v2` - Faster, lower latency
- `eleven_flash_v2_5` - Ultra-fast

### Add Custom Voices

1. Create a voice on ElevenLabs (voice cloning)
2. Get the voice ID from your dashboard
3. Use voice ID directly instead of name:

```typescript
const voiceId = "your_custom_voice_id";
const response = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
  // ...
);
```

## Testing

Test the integration manually:

1. Copy some text: "Hello, this is a test of the text to speech system."
2. Press Alt+Space
3. Say: "Read this aloud"
4. Should hear: "Hello, this is a test of the text to speech system."

## Code Examples

### Read Custom Text

```typescript
import { ElevenLabsTtsService } from "./services/elevenlabs-tts-service";

// Read specific text
const result = await ElevenLabsTtsService.readAloud({
  text: "Hello world!",
  voiceName: "Adam"
});

if (result.success) {
  console.log("Speech played successfully");
} else {
  console.error("TTS failed:", result.error);
}
```

### Generate Without Playing

```typescript
// Generate audio file without auto-playing
const result = await ElevenLabsTtsService.textToSpeech({
  text: "Hello world!",
  voiceName: "Rachel",
  autoPlay: false // Don't play automatically
});

console.log("Audio saved to:", result.audioFilePath);
```

## Future Enhancements

Potential improvements:
- [ ] Voice selection UI
- [ ] Playback controls (pause, resume, stop)
- [ ] Speed control
- [ ] Save audio files permanently
- [ ] Read selected text (not just clipboard)
- [ ] Multi-language support
- [ ] Queue multiple TTS requests

## Support

For issues or questions:
1. Check logs: `~/Library/Logs/jarvis-desktop-mvp/main.log`
2. Enable debug logging in `elevenlabs-tts-service.ts`
3. Verify API key and quota on ElevenLabs dashboard
