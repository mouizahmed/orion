# Overlay Mode Architecture

## Overview
Overlay Mode transforms Orion into an AI-powered assistant that provides contextual insights and note-taking capabilities while overlaying on top of other applications. This mode supports both meeting scenarios (with audio) and general screen analysis (screen-only).

## Mode Types

### 1. Meeting Mode
- **Screen capture** + **audio recording**
- Live transcription of spoken content
- AI-powered meeting insights and summaries
- Real-time action item extraction
- Speaker identification and timestamps

### 2. Insight Mode (Screen-Only)
- **Screen capture only** (no audio recording)
- AI analysis of visible screen content
- Context-aware suggestions based on what's displayed
- Ask questions about documents, websites, applications
- Smart note-taking suggestions

## UI Components

### Floating Panels System

#### 1. **Live Insights Panel**
- **Position**: Top-left overlay
- **Content**:
  - Real-time AI analysis
  - Key topics and themes
  - Suggested actions
  - Context-aware tips
- **Features**:
  - Draggable and resizable
  - Collapsible/expandable
  - Auto-hide when not active

#### 2. **Transcript Panel** (Meeting Mode Only)
- **Position**: Left side overlay
- **Content**:
  - Live speech-to-text transcription
  - Speaker identification
  - Timestamps
  - Searchable transcript history
- **Features**:
  - Auto-scroll with live content
  - Export transcript functionality
  - Keyword highlighting

#### 3. **AI Response Panel**
- **Position**: Center-right overlay
- **Content**:
  - AI-generated responses to user queries
  - Follow-up question suggestions
  - Explanations of screen content
  - Meeting summaries (in meeting mode)
- **Features**:
  - Chat-like interface
  - Copy/save responses
  - Reference linking to source content

#### 4. **Notes Panel** 📝
- **Position**: Bottom or right side overlay
- **Content**:
  - **Rich text editor** with markdown support
  - Real-time note synchronization
  - Auto-save functionality
  - Integration with main /. notes
- **Features**:
  - **Markdown editing** with live preview
  - **Smart suggestions** based on screen content
  - **Quick capture** from AI insights
  - **Tagging system** for easy organization
  - **Templates** for different note types (meeting, analysis, etc.)
  - **Drag-and-drop** content from other panels

### Overlay Controls

#### 5. **Control Bar**
- **Position**: Top-center, minimal floating bar
- **Controls**:
  - Record/Pause (meeting mode)
  - Screen capture toggle
  - Show/hide individual panels
  - Ask AI input field
  - Mode switcher (Meeting ↔ Insight)
  - Exit to Dashboard
- **Features**:
  - Always visible but unobtrusive
  - Keyboard shortcuts support
  - Status indicators (recording, analyzing, etc.)

## Notes Panel Detailed Specifications

### Core Features
- **Markdown Editor**: Full markdown support with syntax highlighting
- **Live Preview**: Side-by-side markdown and rendered view
- **Auto-save**: Continuous saving every 30 seconds or on content change
- **Smart Capture**: One-click capture from AI insights or transcript
- **Cross-Reference**: Link notes to specific moments in recordings/transcripts

### Note Types & Templates
1. **Meeting Notes Template**:
   ```markdown
   # [Meeting Title] - [Date]

   ## Attendees
   - [Auto-populated from audio analysis]

   ## Key Topics
   - [AI-suggested topics from transcript]

   ## Action Items
   - [ ] [Auto-extracted from conversation]

   ## Decisions Made
   - [AI-identified decisions]

   ## Next Steps
   - [Follow-up items]
   ```

2. **Analysis Notes Template**:
   ```markdown
   # Screen Analysis - [Date/Time]

   ## Context
   Application: [Auto-detected]
   Content Type: [Document/Website/Code/etc.]

   ## Key Insights
   - [AI-generated insights]

   ## Questions & Answers
   Q: [User question]
   A: [AI response]

   ## References
   - [Links to relevant content]
   ```

3. **Quick Capture Template**:
   ```markdown
   # Quick Note - [Timestamp]

   [Captured content]

   Tags: #[auto-suggested-tags]
   ```

### Integration Features
- **Sync with Dashboard**: All overlay notes appear in main app
- **Export Options**: PDF, plain text, rich markdown
- **Search Integration**: Full-text search across all overlay notes
- **Tagging System**: Auto-tagging based on content analysis
- **Version History**: Track changes and revisions

## Technical Implementation

### Window Management
- **Overlay Windows**: Always-on-top, click-through options
- **Multi-Monitor Support**: Intelligent panel placement
- **Persistence**: Remember panel positions and sizes
- **Performance**: Efficient rendering for minimal system impact

### Screen Capture
- **Desktop Duplication API** (Windows)
- **Screen Recording API** (macOS)
- **Selective Capture**: Option to capture specific windows/regions
- **Privacy Controls**: Exclude sensitive applications

### Audio Processing (Meeting Mode)
- **Real-time Speech-to-Text**: Using cloud services (Azure/Google)
- **Source Separation**: Keep microphone and system audio as separate transcript channels
- **Noise Cancellation**: Filter background noise
- **Privacy**: Local processing options for sensitive meetings

### AI Integration
- **Context Analysis**: Send screen content to AI for analysis
- **Natural Language Queries**: Ask questions about visible content
- **Smart Suggestions**: Proactive insights based on content
- **Learning**: Improve suggestions based on user behavior

## User Experience Flow

### Entering Overlay Mode
1. User clicks "Enter Overlay Mode" from Dashboard
2. Main window minimizes to system tray
3. Overlay panels appear with smooth animation
4. Control bar shows available options
5. Screen capture begins (with user permission)

### During Overlay Session
1. **AI continuously analyzes** screen content
2. **Live insights** appear in real-time
3. **User can ask questions** via control bar
4. **Notes panel** available for continuous note-taking
5. **Smart suggestions** appear based on context

### Note-Taking Workflow
1. **Auto-capture**: AI suggests relevant content to save
2. **Manual capture**: User selects text/insights to add to notes
3. **Live editing**: Real-time markdown editing with preview
4. **Smart tagging**: Automatic tag suggestions based on content
5. **Cross-referencing**: Link notes to specific screen moments

### Exiting Overlay Mode
1. User clicks "Return to Dashboard" or uses keyboard shortcut
2. All notes auto-saved and synced
3. Overlay panels hide with animation
4. Main dashboard window restores
5. Session summary available in dashboard

## Privacy & Security
- **Permission-based**: Explicit user consent for screen/audio capture
- **Selective Exclusion**: Block capture of password managers, private apps
- **Local Processing**: Option to keep AI analysis local
- **Data Encryption**: All captured content encrypted at rest
- **Auto-cleanup**: Configurable retention policies for captured data

## Keyboard Shortcuts
- `Ctrl/Cmd + Shift + O`: Toggle Overlay Mode
- `Ctrl/Cmd + Shift + N`: Quick note capture
- `Ctrl/Cmd + Shift + A`: Ask AI about screen content
- `Ctrl/Cmd + Shift + H`: Hide/show all panels
- `Ctrl/Cmd + Shift + R`: Start/stop recording (meeting mode)
- `Ctrl/Cmd + Shift + S`: Take screenshot with annotation

## Future Enhancements
- **Multi-language Support**: Transcription in various languages
- **Integration APIs**: Connect with Slack, Teams, Notion, etc.
- **Custom AI Models**: Train on user-specific content
- **Collaboration**: Real-time sharing of overlay insights
- **Mobile Companion**: View insights on mobile device
- **Meeting Preparation**: AI briefings before scheduled meetings
