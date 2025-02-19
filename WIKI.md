# Bolt to GitLab Extension - Developer Wiki

## 1. Project Overview

Bolt to GitLab is a Chrome extension that automates the process of capturing ZIP file downloads from bolt.new and pushing them to GitLab repositories. This extension is built with modern web technologies and follows best practices for Chrome extension development.

### 1.1 Key Features
- Automatic ZIP file interception from bolt.new
- In-browser ZIP file extraction
- Direct GitLab repository integration
- Secure credential storage
- Real-time processing status updates
- Multi-repository support
- Custom commit messages
- Projects management dashboard

### 1.2 Tech Stack
- **Frontend Framework**: Svelte
- **Language**: TypeScript
- **Build Tool**: Vite
- **Styling**: TailwindCSS
- **UI Components**: shadcn-svelte
- **ZIP Processing**: fflate
- **Package Manager**: npm

## 2. Getting Started

### 2.1 Prerequisites
- Node.js (v16 or later)
- npm (included with Node.js)
- Chrome browser
- Git

### 2.2 Development Environment Setup

1. Clone the repository:
```bash
git clone https://gitlab.com/AbdulsalamMasrie/bolt-to-gitlab.git
cd bolt-to-gitlab
```

2. Install dependencies:
```bash
# For development
npm install

# For clean install (CI/CD)
npm ci
```

3. Start development server:
```bash
# Development with hot reload
npm run watch

# OR build for production
npm run build
```

4. Load in Chrome:
- Navigate to `chrome://extensions/`
- Enable "Developer mode"
- Click "Load unpacked"
- Select the `dist` directory

## 3. Project Architecture

### 3.1 Directory Structure
```
.
├── assets/                # Extension icons and assets
├── src/
│   ├── background.ts     # Extension background service
│   ├── content/          # Content scripts
│   ├── lib/             # Core library and utilities
│   ├── popup/           # Extension popup UI
│   ├── services/        # Service modules
│   ├── styles/          # Global styles
│   └── types/           # TypeScript type definitions
├── manifest.json         # Chrome extension manifest
└── package.json         # Project dependencies
```

### 3.2 Core Components

#### Background Service (src/background.ts)
- Handles ZIP file download interception
- Manages GitLab API communication
- Coordinates between content scripts and popup

#### Content Scripts (src/content/)
- Injects UI elements into bolt.new
- Manages upload status display
- Handles user interactions on the webpage

#### Popup UI (src/popup/)
- Manages extension settings
- Displays project status
- Handles GitLab token configuration

#### Service Modules (src/services/)
- `GitLabService`: Handles GitLab API integration
- `GitLabTokenValidator`: Validates GitLab tokens
- `buttonInjector`: Manages UI button injection
- `zipHandler`: Processes ZIP files

## 4. Development Workflow

### 4.1 Development Commands
```bash
# Start development with hot reload
npm run watch

# Build for production
npm run build

# Type checking
npm run check

# Linting
npm run lint
npm run lint:fix  # Auto-fix linting issues

# Formatting
npm run format
npm run format:fix  # Auto-fix formatting issues
```

### 4.2 Code Quality
- ESLint for TypeScript and Svelte
- Prettier for code formatting
- TypeScript for type safety
- Svelte compiler warnings

### 4.3 Best Practices
1. Always run linting before committing:
```bash
npm run lint
```

2. Fix any linting issues:
```bash
npm run lint -- --fix
```

3. Ensure TypeScript types are correct:
```bash
npm run check
```

## 5. Extension Architecture

### 5.1 Manifest Configuration
The `manifest.json` file defines:
- Extension metadata
- Permissions required
- Service worker configuration
- Content script injection
- Host permissions

### 5.2 Required Permissions
- `storage`: For settings and token storage
- `activeTab`: For interacting with bolt.new
- `tabs`: For tab management
- Host permissions for bolt.new and GitLab API

### 5.3 Service Worker
- Handles background tasks
- Manages GitLab API requests
- Coordinates ZIP file processing

### 5.4 Content Scripts
- Injected into bolt.new pages
- Add GitLab integration UI
- Handle user interactions

## 6. Contributing Guidelines

### 6.1 Branch Naming Convention
```bash
git checkout -b feature/my-new-feature
```

### 6.2 PR Process
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run linting and type checking
5. Commit changes
6. Push to your fork
7. Create a Pull Request

### 6.3 Code Style
- Follow TypeScript best practices
- Use Svelte's recommended patterns
- Maintain consistent component structure
- Follow TailwindCSS class ordering

## 7. Build and Deployment

### 7.1 Build Process
```bash
# Production build
npm run build

# Output directory: dist/
```

### 7.2 Build Output
- Compiled JavaScript
- Bundled CSS
- Extension manifest
- Assets and icons

## 8. API Integration

### 8.1 GitLab API
- REST API communication
- Token-based authentication
- Repository operations
- Error handling

### 8.2 Token Management
- Secure storage in Chrome's storage API
- Token validation
- Permission verification

## 9. UI Components

### 9.1 shadcn-svelte Components
- Button
- Input
- Alert
- Modal
- Progress

### 9.2 Custom Components
- UploadStatus
- GitLabSettings
- ProjectStatus
- NewUserGuide

### 9.3 Styling
- TailwindCSS for utility classes
- Custom theme configuration
- Responsive design

## 10. Security Considerations

### 10.1 Token Storage
- Tokens stored in Chrome's secure storage
- No plaintext storage
- Token validation before storage

### 10.2 API Communication
- HTTPS only
- Token-based authentication
- Rate limiting handling

### 10.3 ZIP Processing
- In-browser processing
- No external service dependencies
- Secure file handling

## 11. Troubleshooting

### 11.1 Common Issues
1. Build Issues
   - Clear node_modules and reinstall
   - Check Node.js version
   - Verify package.json dependencies

2. GitLab Integration
   - Verify token permissions
   - Check API rate limits
   - Validate repository settings

3. Development
   - Hot reload not working
   - Type checking errors
   - Linting issues

### 11.2 Debugging Tips
- Use Chrome DevTools
- Check background service worker logs
- Monitor network requests
- Verify storage state
