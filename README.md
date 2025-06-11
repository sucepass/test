# File Uploader

A robust file upload system built with React, Node.js, and MongoDB, featuring concurrent upload management and S3 storage integration.

## Features

- 🚀 Concurrent file uploads (2 files at a time)
- 📤 Drag and drop interface
- 📊 Real-time upload progress
- 🔄 Automatic retry on failure
- 🔒 Secure file handling
- 📱 Responsive design using Shopify Polaris
- 💾 S3-compatible storage integration
- 📝 MongoDB for file metadata storage

## Tech Stack

- **Frontend:**
  - React with TypeScript
  - Shopify Polaris UI
  - React Dropzone
  - XMLHttpRequest for progress tracking

- **Backend:**
  - Node.js with Express
  - MongoDB for metadata
  - AWS S3 for storage
  - Multer for file handling

## Prerequisites

- Node.js (v14 or higher)
- MongoDB instance
- AWS S3 bucket (or compatible storage)
- npm or yarn

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Server
PORT=3001
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb://localhost:27017/file-uploader

# AWS S3
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=your_region
AWS_BUCKET_NAME=your_bucket_name
```

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd file-uploader
```

2. Install dependencies:
```bash
npm install
```

3. Start the development servers:
```bash
# Start both frontend and backend
npm run dev:all

# Or start them separately
npm run dev:client  # Frontend
npm run dev:server  # Backend
```

## Usage

1. Open your browser and navigate to `http://localhost:5173`
2. Drag and drop files or click to select them
3. Files will be uploaded automatically with progress tracking
4. Failed uploads will be retried automatically

## Development Notes

### Time Taken
- Initial setup: 15 minutes
- Core functionality: 20 minutes
- UI/UX improvements: 10 minutes
- Testing and bug fixes: 15 minutes

### Trade-offs Made

1. **Concurrent Uploads**
   - Limited to 2 concurrent uploads to prevent server overload
   - Queue system ensures reliable uploads but may increase total upload time

2. **Progress Tracking**
   - Using XMLHttpRequest instead of Fetch API for better progress tracking
   - Slightly more complex code but better user experience

3. **Error Handling**
   - Comprehensive error handling adds complexity but improves reliability
   - Automatic retries may increase server load but improve success rate

4. **Storage**
   - S3 integration provides reliable storage but adds complexity
   - MongoDB for metadata adds overhead but enables better file management

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
