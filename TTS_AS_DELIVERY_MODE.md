# TTS as a Delivery Mode

## Overview

Text-to-Speech (TTS) is now available as a delivery mode for **any** Jarvis query. Instead of inserting text at cursor or copying to clipboard, you can have Jarvis speak the response aloud.

## Two TTS Use Cases

### 1. Read Existing Content (Original Feature)
Read text that's already in your clipboard:

**Examples:**
- "Read this article aloud"
- "Read this email"
- "Speak this text"

**How it works:**
- Uses clipboard content as input
- Cleans and reads the text
- No new information is generated

### 2. Read Generated Responses (NEW!)
Have Jarvis generate a response AND read it aloud:

**Examples:**
- "What's the weather in New York? Read it out loud."
- "Tell me about Apple stock. Speak it."
- "Explain what HTML is and read it aloud."
- "What's 25 times 47? Say it out loud."

**How it works:**
- Jarvis generates the response first
- Then reads the response using TTS
- Response is spoken, not inserted/copied

## Usage Examples

### Weather Query + TTS
```
User: "What's the weather in San Francisco? Read it out loud."

Jarvis:
1. Fetches weather for San Francisco
2. Formats: "Current temperature is 65°F with partly cloudy skies..."
3. Speaks the weather information
4. Nothing is copied/inserted
```

### Stock Information + TTS
```
User: "What's the stock price of Apple? Speak it."

Jarvis:
1. Generates response with stock info
2. Speaks: "Apple Inc. is currently trading at..."
3. Nothing is copied/inserted
```

### Explanation + TTS
```
User: "Explain what quantum computing is. Read this out loud."

Jarvis:
1. Generates explanation
2. Speaks the full explanation
3. Nothing is copied/inserted
```

### Math + TTS
```
User: "What's 127 times 89? Say it aloud."

Jarvis:
1. Calculates: 11,303
2. Speaks: "127 times 89 equals 11,303"
3. Nothing is copied/inserted
```

## Trigger Phrases

Add any of these to your request to enable TTS delivery:
- ✅ "read it out loud"
- ✅ "read this out loud"
- ✅ "speak it"
- ✅ "say it aloud"
- ✅ "read it aloud"
- ✅ "narrate it"
- ✅ "tell me aloud"

**Examples:**
- "What's the capital of France? Read it out loud."
- "How do I make coffee? Speak it."
- "What's the meaning of life? Say it aloud."

## How It Works

### Architecture

```
User Query: "What's the weather? Read it out loud."
        ↓
Task Router detects:
  - route: "weather_query" (main task)
  - deliveryMode: "tts" (how to deliver)
        ↓
Weather Service generates response:
  "Current temperature is 72°F..."
        ↓
deliverTextOutput() with mode="tts"
        ↓
ElevenLabsTtsService.readAloud()
        ↓
🔊 Audio Output
```

### Delivery Modes Comparison

| Mode | What Happens | Use Case |
|------|-------------|----------|
| **insert** | Text inserted at cursor | Editing documents |
| **clipboard** | Text copied to clipboard | Copy for later use |
| **none** | Nothing happens | Image tasks |
| **tts** ⭐ NEW | Text read aloud | Hands-free information |

## Advanced Examples

### Combining Features

**Weather + TTS:**
```
"What's the weather forecast for tomorrow in Seattle? Read it out loud."
→ Generates forecast, then speaks it
```

**Rewrite + TTS:**
```
[Clipboard contains: "hey how r u"]
"Make this more formal. Read it out loud."
→ Rewrites to "Hello, how are you?", then speaks it
```

**Explain + TTS:**
```
[Clipboard contains code]
"Explain this code and speak it."
→ Generates explanation, then speaks it
```

**Direct Query + TTS:**
```
"Tell me 3 fun facts about Mars. Say them aloud."
→ Generates facts, then speaks them
```

## Comparison: Two TTS Modes

### Mode 1: Read Clipboard Content
**Command:** "Read this article aloud"
- Input: Existing clipboard content
- Process: Clean text → TTS
- Route: `tts_read_aloud`
- Delivery: `none`

### Mode 2: Generate & Read
**Command:** "What's the weather? Read it out loud."
- Input: User query
- Process: Generate response → TTS
- Route: `weather_query` (or `text_task`)
- Delivery: `tts`

## Error Handling

### TTS Fails
If TTS fails for any reason:
1. Error notification is shown
2. Response automatically falls back to clipboard
3. User gets the text content as backup

**Example:**
```
User: "What's the weather? Read it out loud."

[TTS fails due to API error]

Jarvis:
- Shows: "TTS failed: API error. Response copied to clipboard."
- Clipboard contains: "Current temperature is 72°F..."
```

### No API Key
If `ELEVENLABS_API_KEY` is not set:
- TTS will fail
- Fallback to clipboard automatically
- Error message explains the issue

## Configuration

### Voice Selection
Default voice is "Adam". To change:

Edit `elevenlabs-tts-service.ts`:
```typescript
private static defaultVoice = "Rachel"; // Change to preferred voice
```

### Text Length Limit
Maximum 5000 characters (~5 minutes of speech).
Text is auto-truncated if longer.

To change limit, edit `elevenlabs-tts-service.ts`:
```typescript
const maxLength = 5000; // Adjust as needed
```

## Router Logic

The router intelligently detects delivery mode:

### Detection Rules
1. **Existing content + "read this"** → `tts_read_aloud` route
2. **New query + "read it out loud"** → Original route + `tts` delivery
3. **No TTS phrase** → Normal delivery (insert/clipboard)

### Examples

| Command | Route | Delivery Mode |
|---------|-------|---------------|
| "Read this article" | `tts_read_aloud` | `none` |
| "Weather? Read it aloud" | `weather_query` | `tts` |
| "What's the time?" | `text_task` | `clipboard` |
| "Explain code and speak it" | `text_task` | `tts` |

## Implementation Details

### Type Changes
```typescript
// Added "tts" to delivery modes
export type TextDeliveryMode = "insert" | "clipboard" | "none" | "tts";
```

### Router Prompt Update
Router now detects:
- Read existing content → `tts_read_aloud` route
- Read generated response → `tts` delivery mode

### Delivery Handler
New `deliverTextOutput()` TTS case:
```typescript
if (params.deliveryMode === "tts") {
  notify("Jarvis", "Reading response aloud...");
  const ttsResult = await ElevenLabsTtsService.readAloud({
    text: params.transformedText,
  });
  // Handle success/failure
}
```

## Testing

### Test Cases

1. **Weather + TTS:**
   ```
   "What's the weather? Read it out loud."
   Expected: Speaks weather info
   ```

2. **Stock + TTS:**
   ```
   "Apple stock price. Speak it."
   Expected: Speaks stock info
   ```

3. **Math + TTS:**
   ```
   "What's 50 times 50? Say it aloud."
   Expected: Speaks "2500"
   ```

4. **Explanation + TTS:**
   ```
   "What is AI? Read it out loud."
   Expected: Speaks AI explanation
   ```

5. **Fallback:**
   ```
   [No API key configured]
   "Weather? Read it aloud."
   Expected: Falls back to clipboard
   ```

6. **Read Clipboard:**
   ```
   [Clipboard has article text]
   "Read this article aloud"
   Expected: Speaks clipboard content
   ```

## Performance

### Response Time
- Query processing: ~1-2s (Gemini)
- TTS generation: ~2-3s (ElevenLabs)
- **Total: ~3-5s** for generate + speak

### API Usage
Each TTS request uses:
- 1 Gemini API call (generate response)
- 1 ElevenLabs API call (text-to-speech)

## Troubleshooting

### Issue: TTS not triggering
**Solution:** Make sure to include trigger phrase:
- ✅ "Weather? **Read it out loud**"
- ❌ "Weather?" (no TTS phrase)

### Issue: Wrong mode triggered
**Solution:** Be specific:
- "Read **this** article" → Reads clipboard
- "Tell me about X. Read **it** aloud" → Reads response

### Issue: Response too long
**Solution:** TTS auto-truncates at 5000 chars.
For longer content:
- Ask for summary: "Summarize this. Read it aloud."
- Split request: Ask for specific parts

## Benefits

### Hands-Free Operation
Perfect for:
- 🚗 Driving (get info without looking)
- 🍳 Cooking (follow instructions hands-free)
- 🏃 Exercising (stay informed while active)
- 👀 Eye strain (rest your eyes)

### Multitasking
Listen while:
- Working on another task
- Moving around
- Taking notes
- Reviewing documents

### Accessibility
Helpful for:
- Visual impairments
- Reading difficulties
- Screen fatigue
- Learning by listening

## Examples by Use Case

### News & Information
```
"Latest news about SpaceX. Read it out loud."
"Who won the game yesterday? Speak it."
"What's trending on Twitter? Say it aloud."
```

### Learning & Education
```
"Explain photosynthesis. Read it aloud."
"How do you calculate percentages? Speak it."
"What are the steps to solve this? Read it out loud."
```

### Productivity
```
"Summarize my clipboard text. Read it aloud."
"What are my tasks for today? Speak them."
"Read this email and summarize it aloud."
```

### Entertainment
```
"Tell me a joke. Say it aloud."
"What's a fun fact about space? Read it out loud."
"Give me a random trivia question. Speak it."
```

## Future Enhancements

Potential improvements:
- [ ] Playback speed control
- [ ] Pause/resume functionality
- [ ] Voice selection via command
- [ ] Multi-language support
- [ ] Save audio file option
- [ ] Replay last TTS

## Summary

TTS is now available as a delivery mode for **any** query:
- ✅ Works with all task types (weather, text, queries, etc.)
- ✅ Just add "read it out loud" to any request
- ✅ Automatic fallback to clipboard if TTS fails
- ✅ Same natural voices as before
- ✅ No new setup required

**Try it now:**
```
"What's the weather in your city? Read it out loud."
```
